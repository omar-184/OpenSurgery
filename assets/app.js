
(function(){
  var root = document.body.dataset.root || "";
  var idx = null, idxPromise = null;
  function loadIndex(cb){
    if(idx) return cb(idx);
    if(!idxPromise) idxPromise = fetch(root+"assets/search.json").then(function(r){return r.json();}).then(function(d){ idx=d; return d; });
    idxPromise.then(cb);
  }
  // Matches are scored, not just filtered. Without this the index order stands,
  // so a query like "pancreat" returned every Hepatobiliary & Pancreatic topic
  // in file order and pushed the three whose titles actually match to 4th, 5th
  // and 6th place behind topics that only matched the category name.
  function scoreIdx(t, q){
    var title = t.title.toLowerCase(), cat = t.cat.toLowerCase();
    var i = title.indexOf(q);
    if(i === 0) return 100 - title.length / 100;          // title starts with the query
    if(i > 0){                                            // whole-word match inside the title
      var w = /[\s(,–-]/.test(title.charAt(i-1));
      return (w ? 80 : 60) - title.length / 100;
    }
    if(cat.indexOf(q) >= 0) return 20 - title.length / 100;
    return -1;
  }
  function filterIdx(q){
    q = q.trim().toLowerCase();
    if(!q) return idx.slice(0,12);
    return idx.map(function(t){ return {t:t, s:scoreIdx(t,q)}; })
              .filter(function(x){ return x.s >= 0; })
              .sort(function(a,b){ return b.s - a.s; })
              .map(function(x){ return x.t; });
  }
  // ---- full text ------------------------------------------------------
  // A second, larger index holding each topic's prose by section. It is only
  // fetched once someone actually types, so an ordinary page view never pays
  // for it. Title matches above still win; this only adds topics whose text
  // mentions the term -- "Alvarado", "Tokyo", a drug name -- which the title
  // index alone can never find.
  var ft = null, ftPromise = null;
  function loadFull(cb){
    if(ft) return cb(ft);
    if(!ftPromise) ftPromise = fetch(root+"assets/fulltext.json")
      .then(function(r){ return r.json(); })
      .then(function(d){ ft = d; return d; })
      .catch(function(){ ft = []; return ft; });
    ftPromise.then(cb);
  }
  function esc(s){ return s.replace(/[&<>]/g, function(c){
    return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"; }); }
  function snippet(text, q){
    var i = text.toLowerCase().indexOf(q);
    if(i < 0) return "";
    var a = Math.max(0, i - 60), b = Math.min(text.length, i + q.length + 90);
    return (a > 0 ? "…" : "") + esc(text.slice(a, i))
         + "<mark>" + esc(text.slice(i, i + q.length)) + "</mark>"
         + esc(text.slice(i + q.length, b)) + (b < text.length ? "…" : "");
  }
  function fullHits(q, exclude){
    if(!ft || q.length < 3) return [];
    var seen = {}, out = [];
    exclude.forEach(function(t){ seen[t.url] = 1; });
    for(var i = 0; i < ft.length && out.length < 8; i++){
      var d = ft[i];
      if(seen[d.u]) continue;
      for(var j = 0; j < d.s.length; j++){
        var sec = d.s[j];
        if(sec[1].toLowerCase().indexOf(q) >= 0 ||
           (sec[0] && sec[0].toLowerCase().indexOf(q) >= 0)){
          out.push({title: d.t, cat: d.c, url: d.u,
                    section: sec[0], snip: snippet(sec[1], q)});
          seen[d.u] = 1;
          break;
        }
      }
    }
    return out;
  }
  function resultLinks(hits, extra, q){
    var html = hits.map(function(t){
      return '<a href="'+root+t.url+'">'+t.title+'<small>'+t.cat+'</small></a>'; }).join("");
    if(extra && extra.length){
      html += '<div class="ft-head">Mentioned in</div>' + extra.map(function(t){
        return '<a class="ft" href="'+root+t.url+'">'+t.title
             + (t.section ? '<small>'+t.section+'</small>' : '')
             + (t.snip ? '<span class="ft-snip">'+t.snip+'</span>' : '')+'</a>'; }).join("");
    }
    if(!html) return '<p class="no-results">Nothing matches that search.</p>';
    return html;
  }

  // ---- command palette (Ctrl/Cmd+K) ----
  var palette, input, results, sel = -1;
  function build(){
    palette = document.createElement("div"); palette.id = "palette";
    palette.innerHTML = '<div class="box"><input type="text" placeholder="Search topics"><div class="results"></div></div>';
    document.body.appendChild(palette);
    input = palette.querySelector("input"); results = palette.querySelector(".results");
    palette.addEventListener("pointerdown", function(e){ if(e.target === palette) close(); });
    input.addEventListener("input", render);
    input.addEventListener("keydown", function(e){
      var items = results.querySelectorAll("a");
      if(e.key === "ArrowDown"){ sel = Math.min(sel+1, items.length-1); mark(items); e.preventDefault(); }
      else if(e.key === "ArrowUp"){ sel = Math.max(sel-1, 0); mark(items); e.preventDefault(); }
      else if(e.key === "Enter" && items[sel >= 0 ? sel : 0]){ items[sel >= 0 ? sel : 0].click(); }
      else if(e.key === "Escape"){ close(); }
    });
  }
  function mark(items){ items.forEach(function(a,i){ a.classList.toggle("sel", i===sel); if(i===sel) a.scrollIntoView({block:"nearest"}); }); }
  function render(){
    sel = -1;
    var q = input.value.trim().toLowerCase();
    var hits = filterIdx(input.value);
    results.innerHTML = resultLinks(hits, fullHits(q, hits), q);
    // the body index arrives after the first keystroke; redraw when it lands
    if(q.length >= 3 && !ft) loadFull(function(){
      if(input.value.trim().toLowerCase() === q) render();
    });
  }
  function open(){
    if(!palette) build();
    loadIndex(render);
    palette.classList.add("open"); input.value=""; input.focus();
  }
  function close(){ palette.classList.remove("open"); }
  document.addEventListener("keydown", function(e){
    if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==="k"){ e.preventDefault(); palette && palette.classList.contains("open") ? close() : open(); }
  });
  var trigger = document.getElementById("search-trigger");
  if(trigger) trigger.addEventListener("click", function(){ open(); });

  // ---- inline hero search bar ----
  var heroInput = document.getElementById("hero-search-input");
  if(heroInput){
    var heroResults = document.getElementById("hero-search-results");
    function renderHero(){
      var q = heroInput.value.trim();
      if(!q){ heroResults.innerHTML = ""; heroResults.classList.remove("open"); return; }
      var lq = q.toLowerCase();
      var hits = filterIdx(q).slice(0,8);
      heroResults.innerHTML = resultLinks(hits, fullHits(lq, hits), lq);
      heroResults.classList.add("open");   // stays open on 0 hits to show the empty state
      if(lq.length >= 3 && !ft) loadFull(function(){
        if(heroInput.value.trim().toLowerCase() === lq) renderHero();
      });
    }
    heroInput.addEventListener("input", function(){ loadIndex(renderHero); });
    heroInput.addEventListener("focus", function(){ loadIndex(renderHero); });
    document.addEventListener("pointerdown", function(e){
      if(e.target !== heroInput && !heroResults.contains(e.target)) heroResults.classList.remove("open");
    });
  }

  // ---- light-mode toggle ----
  var themeBtn = document.getElementById("theme-toggle");
  if(themeBtn) themeBtn.addEventListener("click", function(){
    var de = document.documentElement;
    var isLight = de.getAttribute("data-theme") === "light";
    de.classList.add("theme-switching");
    if(isLight) de.removeAttribute("data-theme");
    else de.setAttribute("data-theme", "light");
    void de.offsetWidth;               // force the recalc while transitions are off
    setTimeout(function(){ de.classList.remove("theme-switching"); }, 50);
    try{ localStorage.setItem("os-theme", isLight ? "dark" : "light"); }catch(e){}
  });

  // ---- UK guidelines toggle ----
  var ukToggle = document.getElementById("uk-toggle");
  if(ukToggle){
    ukToggle.checked = !document.documentElement.classList.contains("hide-uk");
    ukToggle.addEventListener("change", function(){
      document.documentElement.classList.toggle("hide-uk", !ukToggle.checked);
      try{ localStorage.setItem("os-uk-guidelines", ukToggle.checked ? "1" : "0"); }catch(e){}
    });
  }

  var rail = document.querySelector(".rail");
  if(rail && "IntersectionObserver" in window){
    var links = {}, obs = new IntersectionObserver(function(es){
      es.forEach(function(en){ if(en.isIntersecting){
        rail.querySelectorAll("a").forEach(function(a){a.classList.remove("on");});
        var a = links[en.target.id]; if(a) a.classList.add("on");
      }});
    }, {rootMargin:"-10% 0px -75% 0px"});
    rail.querySelectorAll("a").forEach(function(a){
      var id = a.getAttribute("href").slice(1), h = document.getElementById(id);
      if(h){ links[id]=a; obs.observe(h); }
    });
  }

  // ---- mobile section drawer: the rail is hidden under 980px, so the same
  // links get a slide-in menu reachable from a floating button ----
  if(rail && rail.querySelector("a")){
    var fab = document.createElement("button");
    fab.id = "rail-fab"; fab.type = "button";
    fab.setAttribute("aria-label", "Sections"); fab.setAttribute("aria-expanded", "false");
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"'
      + ' stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>';
    var drawer = document.createElement("div"); drawer.id = "rail-drawer";
    drawer.innerHTML = '<div class="rd-panel" role="dialog" aria-modal="true" aria-label="Sections">'
      + '<div class="rd-top"><button type="button" class="rd-close" aria-label="Close">×</button></div>'
      + '<div class="rd-head">On this page</div>'
      + '<nav class="rd-links"></nav></div>';
    var rdLinks = drawer.querySelector(".rd-links"), railFocus = null;
    rail.querySelectorAll("a").forEach(function(a){
      var c = document.createElement("a");
      c.href = a.getAttribute("href"); c.textContent = a.textContent;
      c.addEventListener("click", closeRail);
      rdLinks.appendChild(c);
    });
    function syncActive(){
      var on = rail.querySelector("a.on"), href = on && on.getAttribute("href");
      rdLinks.querySelectorAll("a").forEach(function(a){
        a.classList.toggle("on", href != null && a.getAttribute("href") === href);
      });
    }
    function openRail(){
      syncActive();
      railFocus = document.activeElement;
      drawer.classList.add("open"); fab.setAttribute("aria-expanded", "true");
      drawer.querySelector(".rd-close").focus();
      document.addEventListener("keydown", onRailKey);
    }
    function closeRail(){
      if(!drawer.classList.contains("open")) return;
      drawer.classList.remove("open"); fab.setAttribute("aria-expanded", "false");
      document.removeEventListener("keydown", onRailKey);
      if(railFocus && railFocus.focus) railFocus.focus();
    }
    function onRailKey(e){ if(e.key === "Escape") closeRail(); }
    fab.addEventListener("click", openRail);
    drawer.addEventListener("click", function(e){ if(e.target === drawer) closeRail(); });
    drawer.querySelector(".rd-close").addEventListener("click", closeRail);
    document.body.appendChild(fab); document.body.appendChild(drawer);
  }

  // ---- figure image zoom: tap to enlarge, then click/scroll/pinch to zoom
  // in further and drag to pan; Esc, the close button, or the backdrop exit ----
  var lb, lbFrame, lbImg, lbCap, lastFocus;
  var ZOOM_STEP = 2.4, MAX_ZOOM = 4;
  var scale = 1, panX = 0, panY = 0;
  var pointerId = null, downX = 0, downY = 0, moved = false, dragging = false, startPanX = 0, startPanY = 0;

  function buildLb(){
    lb = document.createElement("div"); lb.id = "img-lightbox";
    lb.setAttribute("role", "dialog"); lb.setAttribute("aria-modal", "true");
    lb.setAttribute("aria-label", "Enlarged figure");
    lb.innerHTML = '<button class="lb-close" aria-label="Close">×</button>'
      + '<div class="lb-frame"><img alt="" draggable="false"></div><div class="lb-cap"></div>';
    document.body.appendChild(lb);
    lbFrame = lb.querySelector(".lb-frame"); lbImg = lb.querySelector("img"); lbCap = lb.querySelector(".lb-cap");
    lb.addEventListener("click", function(e){ if(e.target === lb) closeLb(); });
    lb.querySelector(".lb-close").addEventListener("click", closeLb);
    lbCap.addEventListener("click", function(){ lbCap.classList.toggle("expanded"); });
    lb.addEventListener("wheel", function(e){
      if(!lb.classList.contains("open")) return;
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, scale * Math.exp(-e.deltaY * 0.0015));
    }, {passive:false});
    lbImg.addEventListener("pointerdown", function(e){
      pointerId = e.pointerId; downX = e.clientX; downY = e.clientY; moved = false;
      dragging = scale > 1; startPanX = panX; startPanY = panY;
      lbImg.setPointerCapture(pointerId);
      if(dragging) lbImg.style.cursor = "grabbing";
    });
    lbImg.addEventListener("pointermove", function(e){
      if(pointerId === null || e.pointerId !== pointerId) return;
      var dx = e.clientX - downX, dy = e.clientY - downY;
      if(Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      if(dragging){
        panX = startPanX + dx; panY = startPanY + dy;
        clampPan(); applyTransform(false);
      }
    });
    function endDrag(e){
      if(pointerId === null || (e && e.pointerId !== pointerId)) return;
      if(!moved) zoomAt(downX, downY, scale > 1 ? 1 : ZOOM_STEP);
      dragging = false; pointerId = null; updateCursor();
    }
    lbImg.addEventListener("pointerup", endDrag);
    lbImg.addEventListener("pointercancel", endDrag);
  }
  function stageBox(){
    var cs = getComputedStyle(lb);
    return { w: lb.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
             h: lb.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) };
  }
  function clampPan(){
    var st = stageBox();
    var rw = lbImg.offsetWidth * scale, rh = lbImg.offsetHeight * scale;
    var maxX = Math.max(0, (rw - st.w) / 2), maxY = Math.max(0, (rh - st.h) / 2);
    panX = Math.min(maxX, Math.max(-maxX, panX));
    panY = Math.min(maxY, Math.max(-maxY, panY));
  }
  function applyTransform(withTransition){
    lbImg.style.transition = withTransition ? "transform .18s cubic-bezier(.32,.72,0,1)" : "none";
    lbImg.style.transform = "translate(" + panX + "px," + panY + "px) scale(" + scale + ")";
  }
  function updateCursor(){ lbImg.style.cursor = scale > 1 ? "grab" : "zoom-in"; }
  function zoomAt(clientX, clientY, target){
    target = Math.min(MAX_ZOOM, Math.max(1, target));
    var rect = lbFrame.getBoundingClientRect();
    var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    var ratio = target / scale;
    panX = (clientX - cx) * (1 - ratio) + panX * ratio;
    panY = (clientY - cy) * (1 - ratio) + panY * ratio;
    scale = target;
    clampPan();
    applyTransform(true);
    updateCursor();
  }
  function resetZoom(){ scale = 1; panX = 0; panY = 0; applyTransform(false); updateCursor(); }
  function openLb(img){
    if(!lb) buildLb();
    lastFocus = document.activeElement;
    lbImg.src = img.currentSrc || img.src;
    lbImg.alt = img.alt || "";
    resetZoom();
    var cap = img.closest("figure");
    cap = cap && cap.querySelector("figcaption");
    lbCap.classList.remove("expanded");
    lbCap.textContent = cap ? cap.textContent : "";
    lbCap.hidden = !cap;
    lb.classList.add("open");
    lb.querySelector(".lb-close").focus();
    document.addEventListener("keydown", onLbKey);
  }
  function closeLb(){
    if(!lb || !lb.classList.contains("open")) return;
    lb.classList.remove("open");
    document.removeEventListener("keydown", onLbKey);
    if(lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onLbKey(e){ if(e.key === "Escape") closeLb(); }
  function figImg(e){ return e.target.closest && e.target.closest("figure:not(.diagram) img"); }
  document.addEventListener("click", function(e){
    var img = figImg(e); if(img) openLb(img);
  });
  document.addEventListener("keydown", function(e){
    if(e.key !== "Enter" && e.key !== " ") return;
    var img = figImg(e); if(!img) return;
    e.preventDefault(); openLb(img);
  });

  // ---- home page: fade the Sources block in as it is scrolled to ----
  var srcHead = document.getElementById("sources");
  if(srcHead && "IntersectionObserver" in window){
    var grid = srcHead.parentNode.querySelector(".grid");
    var items = [srcHead];
    var sub = srcHead.nextElementSibling;
    if(sub && sub.classList.contains("section-sub")) items.push(sub);
    if(grid) items = items.concat(Array.prototype.slice.call(grid.children));
    document.documentElement.classList.add("js-reveal");
    items.forEach(function(el, i){
      el.classList.add("reveal");
      // stagger by column so a row lights up left-to-right, without the
      // last card of a 22-card grid waiting on 21 predecessors
      if(i > 1) el.style.transitionDelay = ((i - 2) % 4) * 70 + "ms";
    });
    // A rect sweep rather than an IntersectionObserver: an observer never
    // reports an element that travels from below the viewport to above it
    // within one frame, so a flick-scroll leaves those cards stuck at
    // opacity 0 for good. Comparing positions catches them because anything
    // already past the top satisfies the same test -- and because it is a
    // position test rather than a one-shot event, it runs equally well in
    // reverse when the page is scrolled back up.
    var hero = document.querySelector(".hero"), ticking = false;
    function sweep(){
      ticking = false;
      var h = window.innerHeight;
      var line = h * 0.88;                     // reveal a little before the edge
      for(var i = 0; i < items.length; i++){
        items[i].classList.toggle("in", items[i].getBoundingClientRect().top < line);
      }
      // hero fade runs on scroll position, finishing while it is still on
      // screen so the fade is actually witnessed rather than completing above
      // the fold; reversing back up unwinds it by the same measure
      if(hero){
        var end = Math.max(1, hero.getBoundingClientRect().bottom + window.pageYOffset - h * 0.45);
        var p = window.pageYOffset / end;
        hero.style.setProperty("--hero-fade", (p < 0 ? 0 : p > 1 ? 1 : p).toFixed(3));
      }
    }
    function onScroll(){
      if(ticking) return;
      ticking = true;
      window.requestAnimationFrame(sweep);
    }
    window.addEventListener("scroll", onScroll, {passive:true});
    window.addEventListener("resize", onScroll);
    sweep();
  }
})();
