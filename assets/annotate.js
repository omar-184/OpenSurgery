
(function(){
  function ready(fn){ if(document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }

  var COLORS = ["amber","green","blue","pink"];
  var KIND_LABEL = {highlight:"Highlight", underline:"Underline", strike:"Strikethrough", note:"Note"};

  var article, SLUG, annos = [], toolbar, panel, panelList, filterKey = "";

  // ---------- storage: the API when signed in, localStorage otherwise ----------
  function localAll(){
    var p = (window.OS && OS.pending) ? OS.pending() : {};
    return p.annotations || [];
  }
  function localSave(rows){
    if(!window.OS || !OS.pending) return;
    var p = OS.pending(); p.annotations = rows; OS.savePending(p);
  }
  function load(){
    if(!window.OS || !OS.user) return Promise.resolve([]);
    return OS.user.then(function(user){
      if(!user) return localAll().filter(function(a){ return a.topic_slug === SLUG; });
      return OS.req("/api/annotations?topic_slug=" + encodeURIComponent(SLUG))
        .then(function(r){ return r.ok ? r.json() : []; })
        .catch(function(){ return []; });
    });
  }
  function save(a){
    return OS.user.then(function(user){
      if(!user){
        var rows = localAll().filter(function(x){ return x.id !== a.id; });
        rows.push(a); localSave(rows); return;
      }
      return OS.req("/api/annotations/" + encodeURIComponent(a.id),
                    {method:"PUT", body: JSON.stringify(a)});
    });
  }
  function drop(id){
    return OS.user.then(function(user){
      if(!user){ localSave(localAll().filter(function(x){ return x.id !== id; })); return; }
      return OS.req("/api/annotations/" + encodeURIComponent(id), {method:"DELETE"});
    });
  }

  // ---------- anchoring ----------
  // Offsets into the article's flat text rot whenever the page is rebuilt, so
  // an annotation stores the quoted text plus a little context either side and
  // is re-found on load. range.toString() is used for positions so the flat
  // string and the DOM agree exactly, which means every text node counts --
  // whitespace-only ones included.
  function textNodes(){
    var out = [], w = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, {
      acceptNode: function(n){
        var p = n.parentNode;
        while(p && p !== article){
          if(p.nodeName === "SCRIPT" || p.nodeName === "STYLE") return NodeFilter.FILTER_REJECT;
          p = p.parentNode;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n; while((n = w.nextNode())) out.push(n);
    return out;
  }
  function buildIndex(){
    var nodes = textNodes(), text = "", map = [];
    for(var i = 0; i < nodes.length; i++){
      map.push({node: nodes[i], start: text.length});
      text += nodes[i].nodeValue;
    }
    return {text: text, map: map};
  }
  function posOf(node, off){
    var pre = document.createRange();
    pre.selectNodeContents(article);
    try{ pre.setEnd(node, off); }catch(e){ return null; }
    return pre.toString().length;
  }
  function locate(idx, pos){
    var lo = 0, hi = idx.map.length - 1, best = 0;
    while(lo <= hi){
      var mid = (lo + hi) >> 1;
      if(idx.map[mid].start <= pos){ best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    var e = idx.map[best];
    return {node: e.node, offset: Math.min(pos - e.start, e.node.nodeValue.length)};
  }
  function sectionFor(node){
    var el = node.nodeType === 1 ? node : node.parentNode;
    while(el && el !== article){
      var prev = el.previousElementSibling;
      while(prev){
        if(/^H[23]$/.test(prev.nodeName) && prev.id) return prev.id;
        prev = prev.previousElementSibling;
      }
      el = el.parentNode;
    }
    return null;
  }
  function sharedTail(a, b){ var i = 0; while(i < a.length && i < b.length &&
    a.charAt(a.length-1-i) === b.charAt(b.length-1-i)) i++; return i; }
  function sharedHead(a, b){ var i = 0; while(i < a.length && i < b.length &&
    a.charAt(i) === b.charAt(i)) i++; return i; }

  function findRange(a, idx){
    var t = idx.text, hits = [], i = t.indexOf(a.exact);
    while(i >= 0 && hits.length < 200){ hits.push(i); i = t.indexOf(a.exact, i + 1); }
    if(!hits.length) return null;
    var best = hits[0], score = -1;
    for(var k = 0; k < hits.length; k++){
      var p = hits[k];
      var pre = t.slice(Math.max(0, p - 40), p);
      var suf = t.slice(p + a.exact.length, p + a.exact.length + 40);
      var s = sharedTail(pre, a.prefix || "") + sharedHead(suf, a.suffix || "");
      if(s > score){ score = s; best = p; }
    }
    var st = locate(idx, best), en = locate(idx, best + a.exact.length);
    var r = document.createRange();
    try{ r.setStart(st.node, st.offset); r.setEnd(en.node, en.offset); }catch(e){ return null; }
    return r;
  }

  function paint(a, range){
    var parts = [], w = document.createTreeWalker(article, NodeFilter.SHOW_TEXT, null), n;
    while((n = w.nextNode())){
      if(!range.intersectsNode(n)) continue;
      var s = (n === range.startContainer) ? range.startOffset : 0;
      var e = (n === range.endContainer) ? range.endOffset : n.nodeValue.length;
      if(e > s) parts.push({node: n, s: s, e: e});
    }
    // split from the end so earlier offsets stay valid as the tree is mutated
    for(var i = parts.length - 1; i >= 0; i--){
      var p = parts[i], node = p.node;
      if(p.e < node.nodeValue.length) node.splitText(p.e);
      if(p.s > 0) node = node.splitText(p.s);
      var m = document.createElement("mark");
      m.className = "anno anno-" + a.kind + (a.color ? " anno-c-" + a.color : "");
      m.setAttribute("data-anno-id", a.id);
      m.setAttribute("tabindex", "0");
      m.setAttribute("role", "button");
      m.setAttribute("aria-label", KIND_LABEL[a.kind] + ": " + a.exact.slice(0, 60) +
        (a.note ? ". Note: " + a.note : ""));
      node.parentNode.replaceChild(m, node);
      m.appendChild(node);
      if(a.kind === "note"){
        var sup = document.createElement("span");
        sup.className = "anno-flag"; sup.textContent = "✎";
        sup.setAttribute("aria-hidden", "true");
        if(i === 0) m.appendChild(sup);
      }
    }
    return parts.length > 0;
  }

  function clearPaint(){
    var marks = article.querySelectorAll("mark.anno");
    for(var i = 0; i < marks.length; i++){
      var m = marks[i], f = m.querySelector(".anno-flag");
      if(f) f.remove();
      var parent = m.parentNode;
      while(m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
      parent.normalize();
    }
  }
  function renderAll(){
    clearPaint();
    var idx = buildIndex(), lost = 0;
    for(var i = 0; i < annos.length; i++){
      var r = findRange(annos[i], idx);
      var ok = r ? paint(annos[i], r) : false;
      annos[i]._lost = !ok;
      if(!ok) lost++;
      if(ok) idx = buildIndex();   // the DOM changed under us
    }
    return lost;
  }

  // ---------- creating and editing ----------
  function uid(){
    return "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function selectionInfo(){
    var sel = window.getSelection();
    if(!sel || sel.isCollapsed || !sel.rangeCount) return null;
    var r = sel.getRangeAt(0);
    if(!article.contains(r.commonAncestorContainer)) return null;
    var s = posOf(r.startContainer, r.startOffset);
    var e = posOf(r.endContainer, r.endOffset);
    if(s == null || e == null || e <= s) return null;
    var idx = buildIndex();
    var exact = idx.text.slice(s, e);
    if(!exact.trim()) return null;
    return {
      exact: exact,
      prefix: idx.text.slice(Math.max(0, s - 40), s),
      suffix: idx.text.slice(e, e + 40),
      section_id: sectionFor(r.startContainer)
    };
  }
  function create(kind, color){
    var info = selectionInfo();
    if(!info) return;
    var a = {
      id: uid(), topic_slug: SLUG, kind: kind, color: color || null,
      section_id: info.section_id, exact: info.exact,
      prefix: info.prefix, suffix: info.suffix, note: null
    };
    if(kind === "note"){
      var txt = window.prompt("Note on “" + info.exact.slice(0, 60) + "”");
      if(txt === null) return;
      a.note = txt;
    }
    annos.push(a);
    window.getSelection().removeAllRanges();
    hideToolbar();
    renderAll(); renderPanel();
    save(a);
  }
  function removeAnno(id){
    annos = annos.filter(function(a){ return a.id !== id; });
    renderAll(); renderPanel();
    drop(id);
  }
  function editNote(id){
    var a = annos.filter(function(x){ return x.id === id; })[0];
    if(!a) return;
    var txt = window.prompt("Note on “" + a.exact.slice(0, 60) + "”", a.note || "");
    if(txt === null) return;
    a.note = txt;
    if(a.kind !== "note" && txt) a.kind = a.kind;   // a highlight keeps its kind
    renderAll(); renderPanel();
    save(a);
  }

  // ---------- floating toolbar ----------
  function buildToolbar(){
    toolbar = document.createElement("div");
    toolbar.id = "anno-bar"; toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Annotate selection");
    var html = "";
    for(var i = 0; i < COLORS.length; i++){
      html += '<button type="button" class="anno-swatch anno-c-' + COLORS[i] +
              '" data-act="highlight" data-color="' + COLORS[i] +
              '" aria-label="Highlight ' + COLORS[i] + '"></button>';
    }
    html += '<span class="anno-sep"></span>' +
      '<button type="button" data-act="underline" aria-label="Underline (U)"><u>U</u></button>' +
      '<button type="button" data-act="strike" aria-label="Strikethrough (S)"><s>S</s></button>' +
      '<button type="button" data-act="note" aria-label="Add note (N)">✎</button>';
    toolbar.innerHTML = html;
    document.body.appendChild(toolbar);
    toolbar.addEventListener("mousedown", function(e){ e.preventDefault(); });
    toolbar.addEventListener("click", function(e){
      var b = e.target.closest("button[data-act]");
      if(!b) return;
      create(b.getAttribute("data-act"), b.getAttribute("data-color"));
    });
  }
  function showToolbar(){
    var sel = window.getSelection();
    if(!sel || sel.isCollapsed || !sel.rangeCount) return hideToolbar();
    var r = sel.getRangeAt(0);
    if(!article.contains(r.commonAncestorContainer)) return hideToolbar();
    var box = r.getBoundingClientRect();
    if(!box.width && !box.height) return hideToolbar();
    toolbar.classList.add("open");
    var top = box.top + window.pageYOffset - toolbar.offsetHeight - 10;
    var left = box.left + window.pageXOffset + box.width / 2 - toolbar.offsetWidth / 2;
    left = Math.max(8, Math.min(left, document.documentElement.clientWidth - toolbar.offsetWidth - 8));
    if(top < window.pageYOffset + 8) top = box.bottom + window.pageYOffset + 10;
    toolbar.style.top = top + "px";
    toolbar.style.left = left + "px";
  }
  function hideToolbar(){ if(toolbar) toolbar.classList.remove("open"); }

  // ---------- notes panel ----------
  function buildPanel(){
    panel = document.createElement("div");
    panel.id = "anno-panel";
    panel.innerHTML =
      '<div class="ap-panel" role="dialog" aria-modal="true" aria-label="Notes and highlights">' +
        '<div class="ap-head"><span>Notes &amp; highlights</span>' +
        '<button type="button" class="ap-close" aria-label="Close">×</button></div>' +
        '<div class="ap-filters"></div><div class="ap-list"></div></div>';
    document.body.appendChild(panel);
    panelList = panel.querySelector(".ap-list");
    var f = panel.querySelector(".ap-filters");
    var fh = '<button type="button" class="ap-f on" data-f="">All</button>';
    for(var i = 0; i < COLORS.length; i++){
      fh += '<button type="button" class="ap-f anno-c-' + COLORS[i] + '" data-f="' + COLORS[i] +
            '" aria-label="Only ' + COLORS[i] + '"></button>';
    }
    fh += '<button type="button" class="ap-f" data-f="note">Notes</button>';
    f.innerHTML = fh;
    f.addEventListener("click", function(e){
      var b = e.target.closest("button[data-f]"); if(!b) return;
      filterKey = b.getAttribute("data-f");
      f.querySelectorAll(".ap-f").forEach(function(x){ x.classList.toggle("on", x === b); });
      renderPanel();
    });
    panel.querySelector(".ap-close").addEventListener("click", closePanel);
    panel.addEventListener("click", function(e){ if(e.target === panel) closePanel(); });
    panelList.addEventListener("click", function(e){
      var del = e.target.closest("button[data-del]");
      if(del){ removeAnno(del.getAttribute("data-del")); return; }
      var ed = e.target.closest("button[data-edit]");
      if(ed){ editNote(ed.getAttribute("data-edit")); return; }
      var row = e.target.closest("[data-go]");
      if(row){
        var m = article.querySelector('mark.anno[data-anno-id="' + row.getAttribute("data-go") + '"]');
        if(m){ closePanel(); m.scrollIntoView({block:"center"}); m.classList.add("anno-ping");
               setTimeout(function(){ m.classList.remove("anno-ping"); }, 1200); }
      }
    });
  }
  function esc(s){ return String(s).replace(/[&<>"]/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]; }); }
  function renderPanel(){
    if(!panelList) return;
    var rows = annos.filter(function(a){
      if(!filterKey) return true;
      if(filterKey === "note") return !!a.note || a.kind === "note";
      return a.color === filterKey;
    });
    var btn = document.getElementById("anno-panel-btn");
    if(btn) btn.querySelector(".anno-count").textContent = annos.length ? annos.length : "";
    if(!rows.length){
      panelList.innerHTML = '<p class="ap-empty">' +
        (annos.length ? "Nothing matches this filter." :
         "Select any text in the article to highlight it or attach a note.") + "</p>";
      return;
    }
    panelList.innerHTML = rows.map(function(a){
      return '<div class="ap-item' + (a._lost ? " ap-lost" : "") + '" data-go="' + esc(a.id) + '">' +
        '<div class="ap-meta"><span class="ap-dot anno-c-' + esc(a.color || "none") + ' ap-k-' +
          esc(a.kind) + '"></span>' + esc(KIND_LABEL[a.kind]) +
          (a._lost ? ' <em>(passage changed)</em>' : "") + "</div>" +
        '<blockquote>' + esc(a.exact.slice(0, 220)) + "</blockquote>" +
        (a.note ? '<p class="ap-note">' + esc(a.note) + "</p>" : "") +
        '<div class="ap-actions">' +
          '<button type="button" data-edit="' + esc(a.id) + '">' +
            (a.note ? "Edit note" : "Add note") + "</button>" +
          '<button type="button" data-del="' + esc(a.id) + '">Delete</button>' +
        "</div></div>";
    }).join("");
  }
  function openPanel(){ panel.classList.add("open"); panel.querySelector(".ap-close").focus();
                        document.addEventListener("keydown", panelKey); }
  function closePanel(){ panel.classList.remove("open"); document.removeEventListener("keydown", panelKey); }
  function panelKey(e){ if(e.key === "Escape") closePanel(); }

  // ---------- controls in the title row ----------
  function buildControls(){
    var host = document.querySelector(".topic-actions") || article;
    var wrap = document.createElement("div");
    wrap.className = "anno-controls";
    wrap.innerHTML =
      '<button type="button" class="btn tint" id="anno-panel-btn">' +
        'Notes &amp; highlights <span class="anno-count"></span></button>' +
      '<button type="button" class="btn tint" id="anno-toggle-btn" aria-pressed="true">' +
        "Hide marks</button>";
    host.appendChild(wrap);
    document.getElementById("anno-panel-btn").addEventListener("click", openPanel);
    var t = document.getElementById("anno-toggle-btn");
    t.addEventListener("click", function(){
      var nowHidden = !document.documentElement.classList.contains("annos-off");
      document.documentElement.classList.toggle("annos-off", nowHidden);
      t.textContent = nowHidden ? "Show marks" : "Hide marks";
      t.setAttribute("aria-pressed", nowHidden ? "false" : "true");
      try{ localStorage.setItem("os-annos-off", nowHidden ? "1" : "0"); }catch(e){}
    });
    try{
      if(localStorage.getItem("os-annos-off") === "1"){
        document.documentElement.classList.add("annos-off");
        t.textContent = "Show marks"; t.setAttribute("aria-pressed", "false");
      }
    }catch(e){}
  }

  // ---------- wiring ----------
  function wireSelection(){
    document.addEventListener("selectionchange", function(){
      clearTimeout(showToolbar._t);
      showToolbar._t = setTimeout(showToolbar, 120);
    });
    document.addEventListener("mousedown", function(e){
      if(toolbar && !toolbar.contains(e.target)) hideToolbar();
    });
    article.addEventListener("click", function(e){
      var m = e.target.closest("mark.anno");
      if(m) editNote(m.getAttribute("data-anno-id"));
    });
    article.addEventListener("keydown", function(e){
      if(e.key !== "Enter" && e.key !== " ") return;
      var m = e.target.closest && e.target.closest("mark.anno");
      if(!m) return;
      e.preventDefault(); editNote(m.getAttribute("data-anno-id"));
    });
  }
  function wireKeys(){
    document.addEventListener("keydown", function(e){
      if(e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target;
      if(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.nodeName))) return;
      var k = e.key.toLowerCase();
      var map = {h:"highlight", u:"underline", s:"strike", n:"note"};
      if(!map[k]) return;
      var sel = window.getSelection();
      if(!sel || sel.isCollapsed || !sel.rangeCount) return;
      if(!article.contains(sel.getRangeAt(0).commonAncestorContainer)) return;
      e.preventDefault();
      create(map[k], k === "h" ? COLORS[0] : null);
    });
  }

  function init(){
    var btn = document.getElementById("mark-read-btn");
    article = document.querySelector("article");
    if(!article || !btn || !btn.dataset.topicSlug) return;   // topic pages only
    SLUG = btn.dataset.topicSlug;
    buildToolbar(); buildPanel(); buildControls();
    load().then(function(rows){
      annos = rows || [];
      renderAll(); renderPanel();
      wireSelection(); wireKeys();
    });
  }
  ready(init);
})();
