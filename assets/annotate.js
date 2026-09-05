
(function(){
  function ready(fn){ if(document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }

  var COLORS = ["amber","green","blue","pink"];
  var KIND_LABEL = {highlight:"Highlight", underline:"Underline", strike:"Strikethrough", note:"Note"};
  // annotation mode arms one of these; selecting text then applies it directly
  var TOOLS = COLORS.map(function(c){
    return {key:"highlight:" + c, act:"highlight", color:c, label:"Highlight " + c, face:""};
  }).concat([
    {key:"underline", act:"underline", label:"Underline", face:"<u>U</u>"},
    {key:"strike", act:"strike", label:"Strikethrough", face:"<s>S</s>"},
    {key:"note", act:"note", label:"Add note", face:"✎"},
    {key:"erase", act:"erase", label:"Eraser — click a mark, or select text, to remove", face:"⌫"}
  ]);

  var article, SLUG, annos = [], toolbar, panel, panelList, filterKey = "";
  var dock, mode = false, tool = null;

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
  function removeAnnos(ids){
    if(!ids || !ids.length) return;
    var kill = {};
    ids.forEach(function(id){ kill[id] = 1; });
    annos = annos.filter(function(a){ return !kill[a.id]; });
    renderAll(); renderPanel();
    ids.forEach(drop);
  }
  function removeAnno(id){ removeAnnos([id]); }
  // Only ever the marks this script painted: a data-anno-id is the proof one
  // came from the user. The article's own <mark> runs (figures, key values)
  // carry neither the class nor the id, so the eraser cannot reach them.
  function annoIdsIn(range){
    var seen = {}, out = [], marks = article.querySelectorAll("mark.anno[data-anno-id]");
    for(var i = 0; i < marks.length; i++){
      if(!range.intersectsNode(marks[i])) continue;
      var id = marks[i].getAttribute("data-anno-id");
      if(!seen[id]){ seen[id] = 1; out.push(id); }
    }
    return out;
  }
  function selectionRange(){
    var sel = window.getSelection();
    if(!sel || sel.isCollapsed || !sel.rangeCount) return null;
    var r = sel.getRangeAt(0);
    return article.contains(r.commonAncestorContainer) ? r : null;
  }
  function eraseSelection(){
    var r = selectionRange();
    if(!r) return;
    var ids = annoIdsIn(r);
    if(!ids.length) return;
    window.getSelection().removeAllRanges();
    hideToolbar();
    removeAnnos(ids);
  }
  function eraseAll(){
    if(!annos.length) return;
    if(!window.confirm("Remove all " + annos.length + " marks on this page? This cannot be undone.")) return;
    removeAnnos(annos.map(function(a){ return a.id; }));
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
      '<button type="button" data-act="note" aria-label="Add note (N)">✎</button>' +
      '<button type="button" data-act="erase" aria-label="Erase marks in selection (E)" hidden>⌫</button>';
    toolbar.innerHTML = html;
    document.body.appendChild(toolbar);
    toolbar.addEventListener("mousedown", function(e){ e.preventDefault(); });
    toolbar.addEventListener("click", function(e){
      var b = e.target.closest("button[data-act]");
      if(!b) return;
      var act = b.getAttribute("data-act");
      if(act === "erase") return eraseSelection();
      create(act, b.getAttribute("data-color"));
    });
  }
  function showToolbar(){
    // in annotation mode the armed tool applies on selection, so the floating
    // bar would only be a second way to do the same thing
    if(mode && tool) return hideToolbar();
    var sel = window.getSelection();
    if(!sel || sel.isCollapsed || !sel.rangeCount) return hideToolbar();
    var r = sel.getRangeAt(0);
    if(!article.contains(r.commonAncestorContainer)) return hideToolbar();
    var box = r.getBoundingClientRect();
    if(!box.width && !box.height) return hideToolbar();
    var er = toolbar.querySelector('button[data-act="erase"]');
    if(er) er.hidden = !annoIdsIn(r).length;
    toolbar.classList.add("open");
    var top = box.top + window.pageYOffset - toolbar.offsetHeight - 10;
    var left = box.left + window.pageXOffset + box.width / 2 - toolbar.offsetWidth / 2;
    left = Math.max(8, Math.min(left, document.documentElement.clientWidth - toolbar.offsetWidth - 8));
    if(top < window.pageYOffset + 8) top = box.bottom + window.pageYOffset + 10;
    toolbar.style.top = top + "px";
    toolbar.style.left = left + "px";
  }
  function hideToolbar(){ if(toolbar) toolbar.classList.remove("open"); }

  // ---------- annotation mode: bottom dock ----------
  function buildDock(){
    dock = document.createElement("div");
    dock.id = "anno-dock";
    var html = '<div class="ad-in" role="toolbar" aria-label="Annotation tools">';
    TOOLS.forEach(function(t){
      html += '<button type="button" data-tool="' + t.key + '" aria-pressed="false"' +
        (t.color ? ' class="anno-swatch anno-c-' + t.color + '"' : "") +
        ' aria-label="' + t.label + '" title="' + t.label + '">' + (t.face || "") + "</button>";
    });
    html += '<span class="ad-sep"></span>' +
      '<button type="button" class="ad-text ad-wipe" data-wipe="1">Erase all</button>' +
      '<span class="ad-hint" id="ad-hint"></span>' +
      '<span class="ad-sep"></span>' +
      '<button type="button" class="ad-text" data-exit="1">Done</button></div>';
    dock.innerHTML = html;
    document.body.appendChild(dock);
    dock.addEventListener("mousedown", function(e){ e.preventDefault(); });
    dock.addEventListener("click", function(e){
      var b = e.target.closest("button");
      if(!b) return;
      if(b.hasAttribute("data-exit")) return setMode(false);
      if(b.hasAttribute("data-wipe")) return eraseAll();
      var key = b.getAttribute("data-tool");
      if(key) setTool(tool && tool.key === key ? null : key);
    });
  }
  function setTool(key){
    tool = null;
    for(var i = 0; i < TOOLS.length && key; i++){
      if(TOOLS[i].key === key) tool = TOOLS[i];
    }
    if(dock){
      dock.querySelectorAll("button[data-tool]").forEach(function(b){
        b.setAttribute("aria-pressed", tool && b.getAttribute("data-tool") === tool.key ? "true" : "false");
      });
    }
    document.documentElement.classList.toggle("anno-erase", !!(mode && tool && tool.act === "erase"));
    try{ localStorage.setItem("os-anno-tool", tool ? tool.key : ""); }catch(e){}
    if(tool) hideToolbar();
    renderHint();
  }
  function renderHint(){
    var h = document.getElementById("ad-hint");
    if(!h) return;
    h.textContent = !tool ? "Pick a tool, or select text for the usual popup"
      : tool.act === "erase" ? "Click a mark, or select text, to erase"
      : "Select text to " + (tool.act === "highlight" ? "highlight" : tool.label.toLowerCase());
  }
  function setMode(on){
    mode = !!on;
    document.documentElement.classList.toggle("anno-mode", mode);
    document.documentElement.classList.toggle("anno-erase", !!(mode && tool && tool.act === "erase"));
    var cb = document.getElementById("anno-mode-toggle");
    if(cb) cb.checked = mode;
    if(mode){ hideToolbar(); renderHint(); }
    try{ localStorage.setItem("os-anno-mode", mode ? "1" : "0"); }catch(e){}
  }
  // with a tool armed the selection is the whole gesture -- no popup to answer
  function applyArmed(){
    if(!mode || !tool || !selectionRange()) return;
    if(tool.act === "erase") return eraseSelection();
    create(tool.act, tool.color || null);
  }

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
    var badges = document.querySelectorAll(".rail-action .anno-count");
    for(var b = 0; b < badges.length; b++){
      badges[b].textContent = annos.length ? annos.length : "";
    }
    if(!rows.length){
      panelList.innerHTML = '<p class="ap-empty">' +
        (annos.length ? "Nothing matches this filter." :
         "Close this panel, then select any text in the article to highlight it or attach a note.") + "</p>";
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
    // marks switch: top of the article, on the same row as the UK toggle and
    // built to the same pill so the two line up
    var tools = document.querySelector(".title-tools");
    if(tools){
      var lab = document.createElement("label");
      lab.className = "uk-toggle"; lab.setAttribute("for", "anno-toggle");
      lab.innerHTML = '<span class="switch"><input type="checkbox" id="anno-toggle" checked>' +
        '<span class="slider"></span></span>Marks';
      tools.appendChild(lab);
      var cb = lab.querySelector("input");
      cb.addEventListener("change", function(){
        document.documentElement.classList.toggle("annos-off", !cb.checked);
        try{ localStorage.setItem("os-annos-off", cb.checked ? "0" : "1"); }catch(e){}
      });
      try{
        if(localStorage.getItem("os-annos-off") === "1"){
          cb.checked = false;
          document.documentElement.classList.add("annos-off");
        }
      }catch(e){}
      // annotation mode: same pill, off unless asked for, so nothing about the
      // ordinary select-then-choose flow changes for anyone who ignores it
      var modeLab = document.createElement("label");
      modeLab.className = "uk-toggle"; modeLab.setAttribute("for", "anno-mode-toggle");
      modeLab.innerHTML = '<span class="switch"><input type="checkbox" id="anno-mode-toggle">' +
        '<span class="slider"></span></span>Annotate';
      tools.appendChild(modeLab);
      modeLab.querySelector("input").addEventListener("change", function(e){ setMode(e.target.checked); });
    }
    // panel entry: the first thing in the contents side menu, above the
    // section list on the rail and above the drawer's "On this page" header
    function entryButton(){
      var b = document.createElement("button");
      b.type = "button"; b.className = "rail-action";
      b.innerHTML = '<svg class="ra-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>' +
        '<span class="ra-label">Notes &amp; highlights</span>' +
        '<span class="anno-count"></span>';
      b.addEventListener("click", function(){
        var d = document.getElementById("rail-drawer");
        if(d) d.classList.remove("open");
        openPanel();
      });
      return b;
    }
    var rail = document.querySelector(".rail");
    if(rail) rail.insertBefore(entryButton(), rail.firstChild);
    var top = document.querySelector("#rail-drawer .rd-top");
    if(top) top.insertBefore(entryButton(), top.firstChild);
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
      if(m) hitMark(m);
    });
    article.addEventListener("keydown", function(e){
      if(e.key !== "Enter" && e.key !== " ") return;
      var m = e.target.closest && e.target.closest("mark.anno");
      if(!m) return;
      e.preventDefault(); hitMark(m);
    });
    // the armed tool fires once the drag settles, not mid-selection
    article.addEventListener("mouseup", function(){ setTimeout(applyArmed, 0); });
    article.addEventListener("touchend", function(){ setTimeout(applyArmed, 0); });
  }
  function hitMark(m){
    var id = m.getAttribute("data-anno-id");
    if(mode && tool && tool.act === "erase") return removeAnnos([id]);
    editNote(id);
  }
  function wireKeys(){
    document.addEventListener("keydown", function(e){
      if(e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target;
      if(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.nodeName))) return;
      // Escape leaves annotation mode, unless the panel is up and owns it
      if(e.key === "Escape" && mode && !(panel && panel.classList.contains("open"))){
        e.preventDefault(); return setMode(false);
      }
      var k = e.key.toLowerCase();
      var map = {h:"highlight", u:"underline", s:"strike", n:"note", e:"erase"};
      if(!map[k]) return;
      if(!selectionRange()) return;
      e.preventDefault();
      if(k === "e") return eraseSelection();
      create(map[k], k === "h" ? COLORS[0] : null);
    });
  }

  function init(){
    var btn = document.getElementById("mark-read-btn");
    article = document.querySelector("article");
    if(!article || !btn || !btn.dataset.topicSlug) return;   // topic pages only
    SLUG = btn.dataset.topicSlug;
    buildToolbar(); buildPanel(); buildDock(); buildControls();
    try{
      setTool(localStorage.getItem("os-anno-tool") || null);
      if(localStorage.getItem("os-anno-mode") === "1") setMode(true);
    }catch(e){}
    load().then(function(rows){
      annos = rows || [];
      renderAll(); renderPanel();
      wireSelection(); wireKeys();
    });
  }
  ready(init);
})();
