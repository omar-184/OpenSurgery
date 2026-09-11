
(function(){
  var $ = function(id){ return document.getElementById(id); };
  var docs = [], byPath = {}, cur = null, curBody = "", mode = "md", tab = "all", blocks = null;

  function esc(s){ var d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; }
  function ready(fn){ if(document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }

  /* ---------------- visual editor ----------------
     An article is edited the way the page renders it, not as markdown. The
     document is parsed into blocks, each holding the source lines it came
     from; a block whose fields still match what was parsed is written back
     verbatim, so editing one paragraph cannot reflow the two hundred around
     it. Same idea as the question editor, applied to prose. */
  var vblocks = null, vlead = "", vtail = "";

  function escHtml(s){
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function rep(s, n){ return n > 0 ? new Array(n + 1).join(s) : ""; }

  /* --- inline markdown <-> editable HTML --- */
  function emphasize(html){
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function(_, t, u){
      return '<a href="#" data-href="' + escHtml(u) + '" title="' + escHtml(u) + '">' + t + "</a>";
    });
    html = html.replace(/\*\*(.+?)\*\*(?!\*)/g, "<b>$1</b>");
    return html.replace(/\*([^*]+)\*/g, "<i>$1</i>");
  }

  function citeChip(cite){
    return '<span class="cite-chip" contenteditable="false" data-cite="' + escHtml(cite) +
           '" title="Click to edit this citation">(' +
           escHtml(cite).replace(/\*([^*]+)\*/g, "<i>$1</i>") + ")</span>";
  }

  function mdInline(s){
    /* Citations are pulled out before emphasis runs: their text contains
       *Book Title*, which the italic pass would otherwise eat. Walking the
       string in segments avoids needing a placeholder to protect them. */
    var out = "", rx = /\((Source: [^)]*)\)/g, last = 0, m;
    while((m = rx.exec(s)) !== null){
      out += emphasize(escHtml(s.slice(last, m.index)));
      out += citeChip(m[1]);
      last = m.index + m[0].length;
    }
    return out + emphasize(escHtml(s.slice(last)));
  }

  /* Selecting "a word " and pressing Bold would otherwise emit "**a word **",
     which puts the marker on the wrong side of the space. The whitespace is
     moved outside the markers instead. */
  function wrap(inner, mark){
    var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
    return m[2] ? m[1] + mark + m[2] + mark + m[3] : inner;
  }

  function mdFromNode(node){
    var out = "";
    for(var i = 0; i < node.childNodes.length; i++){
      var n = node.childNodes[i];
      /* inlineOf() collapses runs of whitespace, and JS \s covers the
         non-breaking spaces contenteditable likes to insert. */
      if(n.nodeType === 3){ out += n.nodeValue; continue; }
      if(n.nodeType !== 1) continue;
      if(n.classList && n.classList.contains("cite-chip")){
        out += "(" + n.getAttribute("data-cite") + ")"; continue;
      }
      var tag = n.tagName;
      if(tag === "BR"){ out += " "; continue; }
      var inner = mdFromNode(n);
      if(tag === "B" || tag === "STRONG") out += wrap(inner, "**");
      else if(tag === "I" || tag === "EM") out += wrap(inner, "*");
      else if(tag === "A") out += "[" + inner + "](" + (n.getAttribute("data-href") || n.getAttribute("href") || "") + ")";
      else out += inner;
    }
    return out;
  }

  function inlineOf(el){ return mdFromNode(el).replace(/\s+/g, " ").replace(/^ +| +$/g, ""); }

  /* --- parsing --- */
  var FIG_RE = /^!\[(.*)\]\((\S+)\)$/;
  var HEAD_RE = /^(#{1,4})\s+(.*)$/;
  var UK_RE = /^:::\s*uk\b\s*(.*)$/i;

  function isTableRow(s){
    return s.charAt(0) === "|" && s.charAt(s.length - 1) === "|" && (s.split("|").length - 1) >= 2;
  }
  function isTableSep(s){ return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(s); }
  function tableCells(s){
    s = s.trim();
    if(s.charAt(0) === "|") s = s.slice(1);
    if(s.charAt(s.length - 1) === "|") s = s.slice(0, -1);
    return s.split("|").map(function(c){ return c.trim(); });
  }

  function vFingerprint(b){
    if(b.type === "uk") return JSON.stringify(["uk", b.label]);
    return JSON.stringify([b.type, b.level, b.text, b.items, b.head, b.rows, b.alt, b.src]);
  }

  function newBlock(type, raw, fields){
    var b = {type: type, raw: raw, gap: 0};
    for(var k in fields) b[k] = fields[k];
    b.orig = vFingerprint(b);
    return b;
  }

  function parseBlocks(lines, i, inFence){
    var blocks = [], lead = 0;
    while(i < lines.length){
      var line = lines[i], s = line.trim();
      if(!s){
        if(blocks.length) blocks[blocks.length - 1].gap++; else lead++;
        i++; continue;
      }
      if(inFence && s === ":::") break;

      var m = UK_RE.exec(s);
      if(m){
        var inner = parseBlocks(lines, i + 1, true);
        var uk = newBlock("uk", null, {label: m[1].trim(), children: inner.blocks, childLead: inner.lead});
        uk.rawOpen = line;
        i = inner.next;
        uk.rawClose = (i < lines.length) ? lines[i] : ":::";
        if(i < lines.length && lines[i].trim() === ":::") i++;
        blocks.push(uk); continue;
      }
      if(s === ":::"){ blocks.push(newBlock("other", line, {})); i++; continue; }

      m = FIG_RE.exec(s);
      if(m){ blocks.push(newBlock("figure", line, {alt: m[1], src: m[2]})); i++; continue; }

      m = HEAD_RE.exec(s);
      if(m){ blocks.push(newBlock("heading", line, {level: m[1].length, text: m[2]})); i++; continue; }

      if(isTableRow(s)){
        var tstart = i, head = null, sep = null, rows = [];
        while(i < lines.length && isTableRow(lines[i].trim())){
          var t = lines[i].trim();
          if(isTableSep(t)) sep = t;
          else if(head === null) head = tableCells(t);
          else rows.push(tableCells(t));
          i++;
        }
        blocks.push(newBlock("table", lines.slice(tstart, i).join("\n"),
                             {head: head || [], sep: sep, rows: rows}));
        continue;
      }

      if(s.slice(0, 2) === "- "){
        var lstart = i, items = [];
        while(i < lines.length && lines[i].trim().slice(0, 2) === "- "){
          items.push(lines[i].trim().slice(2)); i++;
        }
        blocks.push(newBlock("list", lines.slice(lstart, i).join("\n"), {items: items}));
        continue;
      }

      /* Anything else is prose. Consecutive lines join into one paragraph,
         which is what md_to_html does when it renders the page. */
      var pstart = i, parts = [];
      while(i < lines.length){
        var ps = lines[i].trim();
        if(!ps || ps === ":::" || UK_RE.test(ps) || FIG_RE.test(ps) || HEAD_RE.test(ps)
           || isTableRow(ps) || ps.slice(0, 2) === "- ") break;
        parts.push(ps); i++;
      }
      blocks.push(newBlock("para", lines.slice(pstart, i).join("\n"), {text: parts.join(" ")}));
    }
    return {blocks: blocks, lead: lead, next: i};
  }

  function parseDocument(md){
    vtail = /\n*$/.exec(md)[0];
    var body = md.slice(0, md.length - vtail.length);
    var r = parseBlocks(body.split("\n"), 0, false);
    vlead = rep("\n", r.lead);
    return r.blocks;
  }

  /* --- serializing --- */
  function rebuildBlock(b){
    if(b.type === "heading") return rep("#", b.level) + " " + b.text;
    if(b.type === "para") return b.text;
    if(b.type === "figure") return "![" + b.alt + "](" + b.src + ")";
    if(b.type === "list") return b.items.map(function(t){ return "- " + t; }).join("\n");
    if(b.type === "table"){
      var n = b.head.length;
      var sep = (b.sep && tableCells(b.sep).length === n) ? b.sep : "|" + rep(" --- |", n);
      var out = ["| " + b.head.join(" | ") + " |", sep];
      b.rows.forEach(function(r){
        var cells = r.slice(0, n);
        while(cells.length < n) cells.push("");
        out.push("| " + cells.join(" | ") + " |");
      });
      return out.join("\n");
    }
    return b.raw;
  }

  function blockText(b){
    if(b.type === "uk"){
      var open = (b.orig === vFingerprint(b) && b.rawOpen != null) ? b.rawOpen : "::: uk " + b.label;
      return open + "\n" + serializeList(b.children, b.childLead || 0) + (b.rawClose || ":::");
    }
    return (b.raw != null && b.orig === vFingerprint(b)) ? b.raw : rebuildBlock(b);
  }

  /* Always ends with at least one newline, so a caller can append the next
     thing straight onto it. */
  function serializeList(blocks, lead){
    var s = rep("\n", lead);
    blocks.forEach(function(b){ s += blockText(b) + rep("\n", 1 + b.gap); });
    return s;
  }

  function serializeDocument(){
    return vlead + serializeList(vblocks, 0).replace(/\n+$/, "") + vtail;
  }

  /* --- addressing: "3" is a top-level block, "3.1" its second child --- */
  function blockAt(path){
    var parts = String(path).split("."), list = vblocks, b = null;
    for(var i = 0; i < parts.length; i++){
      b = list[+parts[i]];
      if(!b) return null;
      list = b.children || [];
    }
    return b;
  }
  function listOf(path){
    var parts = String(path).split(".");
    if(parts.length === 1) return vblocks;
    return blockAt(parts.slice(0, -1).join(".")).children;
  }
  function indexOf(path){ var p = String(path).split("."); return +p[p.length - 1]; }

  /* --- figure sources: the same mapping build.py uses --- */
  function figWebSrc(src){
    var m = /^(img|fig):\/\/(\w+)\/([\w.\-]+)\.png$/.exec(src);
    if(m) return "assets/" + (m[1] === "img" ? "figs" : "figs2") + "/" + m[2] + "/" + m[3] + ".jpg";
    m = /^svg:\/\/([\w.\-]+\.svg)$/.exec(src);
    if(m) return "assets/infographics/" + m[1];
    return src;
  }

  function ctlBar(path){
    return '<div class="vctl">' +
      '<button type="button" data-act="up" data-path="' + path + '" title="Move up">↑</button>' +
      '<button type="button" data-act="down" data-path="' + path + '" title="Move down">↓</button>' +
      '<button type="button" data-act="add" data-path="' + path + '" title="Insert a block below">+</button>' +
      '<button type="button" data-act="del" data-path="' + path + '" title="Delete this block">✕</button>' +
      "</div>";
  }

  function renderBlock(b, path){
    var body = "";
    if(b.type === "heading"){
      var h = "h" + Math.min(b.level, 4);
      body = "<" + h + ' contenteditable="true" data-edit="text" data-path="' + path + '">' +
             mdInline(b.text) + "</" + h + ">";
    } else if(b.type === "para"){
      body = '<p contenteditable="true" data-edit="text" data-path="' + path + '">' +
             mdInline(b.text) + "</p>";
    } else if(b.type === "list"){
      body = '<ul contenteditable="true" data-edit="items" data-path="' + path + '">' +
             b.items.map(function(t){ return "<li>" + mdInline(t) + "</li>"; }).join("") + "</ul>";
    } else if(b.type === "figure"){
      var web = figWebSrc(b.src);
      var media = /\.svg$/.test(web)
        ? '<div class="vsvg" data-svg="' + escHtml(web) + '">loading diagram…</div>'
        : '<img src="' + escHtml(web) + '" alt="" loading="lazy">';
      body = "<figure>" + media +
        '<figcaption contenteditable="true" data-edit="alt" data-path="' + path + '">' +
        mdInline(b.alt) + "</figcaption></figure>" +
        '<div class="vsrc"><label>Image</label><input type="text" data-edit="src" data-path="' +
        path + '" value="' + escHtml(b.src) + '"></div>';
    } else if(b.type === "table"){
      var head = "<tr>" + b.head.map(function(c, ci){
        return '<th contenteditable="true" data-edit="cell" data-path="' + path +
               '" data-row="-1" data-col="' + ci + '">' + mdInline(c) + "</th>";
      }).join("") + "</tr>";
      var rows = b.rows.map(function(r, ri){
        var cells = [];
        for(var ci = 0; ci < b.head.length; ci++){
          cells.push('<td contenteditable="true" data-edit="cell" data-path="' + path +
                     '" data-row="' + ri + '" data-col="' + ci + '">' + mdInline(r[ci] || "") + "</td>");
        }
        return "<tr>" + cells.join("") +
          '<td class="vrowctl"><button type="button" data-act="delrow" data-path="' + path +
          '" data-row="' + ri + '" title="Delete row">✕</button></td></tr>';
      }).join("");
      body = '<div class="table-wrap"><table><thead>' + head + "</thead><tbody>" + rows +
        "</tbody></table></div>" +
        '<div class="vsrc"><button type="button" class="abtn" data-act="addrow" data-path="' + path +
        '">Add row</button><button type="button" class="abtn" data-act="addcol" data-path="' + path +
        '">Add column</button><button type="button" class="abtn" data-act="delcol" data-path="' + path +
        '">Delete last column</button></div>';
    } else if(b.type === "uk"){
      body = '<div class="uk-note"><input class="uk-label-input" type="text" data-edit="label" data-path="' +
        path + '" value="' + escHtml(b.label) + '" placeholder="UK Guideline">' +
        '<div class="vchildren">' +
        b.children.map(function(c, i){ return renderBlock(c, path + "." + i); }).join("") +
        '</div><div class="vsrc"><button type="button" class="abtn" data-act="addchild" data-path="' +
        path + '">Add a paragraph inside this note</button></div></div>';
    } else {
      body = '<pre class="vraw">' + escHtml(b.raw) + "</pre>";
    }
    return '<div class="vblock" data-path="' + path + '" data-type="' + b.type + '">' +
           ctlBar(path) + body + "</div>";
  }

  function renderVisual(){
    var host = $("visual");
    host.innerHTML = '<article class="vdoc">' +
      vblocks.map(function(b, i){ return renderBlock(b, String(i)); }).join("") +
      "</article>" +
      '<div class="vsrc" style="margin-top:1rem"><button type="button" class="abtn" data-act="addend">' +
      "Add a block at the end</button></div>";
    /* Inline diagrams are SVG so they can follow the page's light/dark
       variables; an <img> could not. */
    var pending = host.querySelectorAll(".vsvg[data-svg]");
    for(var i = 0; i < pending.length; i++){
      (function(el){
        fetch(el.getAttribute("data-svg")).then(function(r){ return r.ok ? r.text() : null; })
          .then(function(svg){ if(svg) el.innerHTML = svg.replace(/<\?xml[^>]*\?>\s*/, ""); })
          .catch(function(){ el.textContent = "diagram not found"; });
      })(pending[i]);
    }
  }

  /* --- reading edits back out of the DOM --- */
  function pullField(el){
    var b = blockAt(el.getAttribute("data-path"));
    if(!b) return;
    var field = el.getAttribute("data-edit");
    if(field === "items"){
      var lis = el.querySelectorAll("li");
      b.items = [];
      for(var i = 0; i < lis.length; i++){
        var t = inlineOf(lis[i]);
        if(t) b.items.push(t);
      }
      if(!b.items.length) b.items = [""];
    } else if(field === "cell"){
      var row = +el.getAttribute("data-row"), col = +el.getAttribute("data-col");
      if(row < 0) b.head[col] = inlineOf(el);
      else { b.rows[row] = b.rows[row] || []; b.rows[row][col] = inlineOf(el); }
    } else if(field === "src" || field === "label"){
      b[field] = el.value;
    } else {
      b[field] = inlineOf(el);
    }
    markDirty();
  }

  function blankBlock(type){
    if(type === "heading") return newBlock("heading", null, {level: 2, text: "New section"});
    if(type === "list") return newBlock("list", null, {items: ["First point"]});
    if(type === "figure") return newBlock("figure", null, {alt: "Caption", src: "fig://bailey/x.png"});
    if(type === "table") return newBlock("table", null,
      {head: ["Column", "Column"], sep: null, rows: [["", ""]]});
    if(type === "uk") return newBlock("uk", null,
      {label: "NICE", children: [newBlock("para", null, {text: "Guidance text."})], childLead: 0});
    return newBlock("para", null, {text: "New paragraph."});
  }

  function wireVisual(){
    var host = $("visual");

    host.addEventListener("input", function(e){
      var el = e.target.closest ? e.target.closest("[data-edit]") : null;
      if(el) pullField(el);
    });
    host.addEventListener("blur", function(e){
      var el = e.target.closest ? e.target.closest("[data-edit]") : null;
      if(el) pullField(el);
    }, true);

    host.addEventListener("click", function(e){
      var chip = e.target.closest(".cite-chip");
      if(chip){
        var cur = chip.getAttribute("data-cite");
        var next = prompt("Citation — the text inside the brackets:", cur);
        if(next === null) return;
        next = next.trim();
        var holder = chip.closest("[data-edit]");
        if(!next) chip.parentNode.removeChild(chip);
        else {
          chip.setAttribute("data-cite", next);
          chip.innerHTML = "(" + escHtml(next).replace(/\*([^*]+)\*/g, "<i>$1</i>") + ")";
        }
        if(holder) pullField(holder);
        return;
      }
      var btn = e.target.closest("button[data-act]");
      if(!btn) return;
      var act = btn.getAttribute("data-act"), path = btn.getAttribute("data-path");
      var list, i, b;
      if(act === "addend"){
        var t0 = pickType();
        if(t0){ vblocks.push(blankBlock(t0)); renderVisual(); markDirty(); }
        return;
      }
      list = listOf(path); i = indexOf(path); b = list[i];
      if(act === "up" && i > 0){ list.splice(i - 1, 0, list.splice(i, 1)[0]); }
      else if(act === "down" && i < list.length - 1){ list.splice(i + 1, 0, list.splice(i, 1)[0]); }
      else if(act === "del"){
        if(!confirm("Delete this " + b.type + " block?")) return;
        var gap = b.gap;
        list.splice(i, 1);
        if(list.length && i > 0) list[i - 1].gap = Math.max(list[i - 1].gap, gap);
      }
      else if(act === "add"){
        var t = pickType();
        if(!t) return;
        var nb = blankBlock(t);
        nb.gap = b.gap || 1;
        list.splice(i + 1, 0, nb);
      }
      else if(act === "addchild"){
        b.children.push(newBlock("para", null, {text: "Guidance text."}));
        b.children[b.children.length - 2] && (b.children[b.children.length - 2].gap = 1);
      }
      else if(act === "addrow"){ b.rows.push(b.head.map(function(){ return ""; })); }
      else if(act === "delrow"){ b.rows.splice(+btn.getAttribute("data-row"), 1); }
      else if(act === "addcol"){
        b.head.push("Column"); b.sep = null;
        b.rows.forEach(function(r){ r.push(""); });
      }
      else if(act === "delcol"){
        if(b.head.length <= 1) return;
        b.head.pop(); b.sep = null;
        b.rows.forEach(function(r){ r.pop(); });
      }
      else return;
      renderVisual(); markDirty();
    });

    /* Enter inside a paragraph or heading splits it into a new block, the way
       a document editor behaves — rather than dropping a <div> into the
       markdown. Lists keep the browser's own Enter handling. */
    host.addEventListener("keydown", function(e){
      if(e.key !== "Enter" || e.shiftKey) return;
      var el = e.target.closest ? e.target.closest('[data-edit="text"]') : null;
      if(!el) return;
      e.preventDefault();
      var path = el.getAttribute("data-path"), b = blockAt(path);
      pullField(el);
      var list = listOf(path), i = indexOf(path);
      var nb = newBlock("para", null, {text: ""});
      nb.gap = 1;
      if(!b.gap) b.gap = 1;
      list.splice(i + 1, 0, nb);
      renderVisual(); markDirty();
      var next = host.querySelector('[data-path="' + (list === vblocks ? String(i + 1) :
                 path.split(".").slice(0, -1).join(".") + "." + (i + 1)) + '"][data-edit]');
      if(next) next.focus();
    });
  }

  function pickType(){
    var t = prompt("Add which block?\n\n  p = paragraph\n  h = heading\n  l = bullet list\n" +
                   "  t = table\n  f = figure\n  u = UK guideline note", "p");
    if(!t) return null;
    t = t.trim().toLowerCase().charAt(0);
    return {p: "para", h: "heading", l: "list", t: "table", f: "figure", u: "uk"}[t] || null;
  }

  /* --- the formatting toolbar --- */
  function wireFormatBar(){
    function focused(){
      var el = document.activeElement;
      return (el && el.closest && el.closest("#visual [data-edit]")) ? el : null;
    }
    function run(cmd){
      var el = focused();
      if(!el){ OS.showToast("Put the cursor in some text first."); return; }
      document.execCommand(cmd, false, null);
      pullField(el);
    }
    $("fmt-bold").addEventListener("mousedown", function(e){ e.preventDefault(); run("bold"); });
    $("fmt-italic").addEventListener("mousedown", function(e){ e.preventDefault(); run("italic"); });
    $("fmt-link").addEventListener("mousedown", function(e){
      e.preventDefault();
      var el = focused();
      if(!el){ OS.showToast("Select the words to link first."); return; }
      var url = prompt("Link to:", "https://");
      if(!url) return;
      document.execCommand("createLink", false, url);
      var a = el.querySelector('a[href="' + url + '"]');
      if(a) a.setAttribute("data-href", url);
      pullField(el);
    });
    $("fmt-cite").addEventListener("mousedown", function(e){
      e.preventDefault();
      var el = focused();
      if(!el){ OS.showToast("Put the cursor where the citation goes first."); return; }
      var cite = prompt("Citation — the text inside the brackets:",
                        "Source: *Bailey & Love 28e*, Ch. ");
      if(!cite) return;
      document.execCommand("insertHTML", false, citeChip(cite.trim()) + " ");
      pullField(el);
    });
  }

  /* ---------------- question parsing ----------------
     Mirrors parse_questions() in build.py so the structured editor sees the
     same questions the quiz does. The file is kept as a list of blocks —
     every line that is not a question passes through untouched — so
     serializing back cannot lose headings, blank lines or stray prose. */
  var OPT_LETTERS = "ABCDEF";

  function parseQuestions(md){
    var out = [], lines = md.split("\n");
    for(var i = 0; i < lines.length; i++){
      var line = lines[i];
      /* "- Q1:" appears alongside "- Q:", and the separator inside
         (Answer: …) is an em dash in some books and a hyphen in others.
         Both are captured so a rebuilt line keeps the file's own style. */
      var m = /^(\s*-\s*Q\d*:)[ \t]*([\s\S]*)$/.exec(line);
      if(!m){ out.push({type:"raw", text:line}); continue; }
      var prefix = m[1], body = m[2].replace(/\s+$/, "");
      var source = "", answer = "", answerText = "", sep = " — ";
      var ms = /\((Source:[^)]*)\)\s*$/.exec(body);
      if(ms){ source = ms[1]; body = body.slice(0, ms.index).replace(/\s+$/, ""); }
      var ma = /\(Answer:\s*([A-F])\b([\s.:—-]*)([\s\S]*)\)\s*$/.exec(body);
      if(ma){ answer = ma[1]; sep = ma[2] || ""; answerText = ma[3].replace(/\s+$/, "");
              body = body.slice(0, ma.index).replace(/\s+$/, ""); }
      var marks = [], pos = 0;
      for(var k = 0; k < OPT_LETTERS.length; k++){
        /* Safari before 16.4 throws on a lookbehind, so the leading space is
           matched as a group and stepped over instead. */
        var rx = new RegExp("(^|\\s)" + OPT_LETTERS[k] + "\\.\\s");
        var mm = rx.exec(body.slice(pos));
        if(!mm) break;
        var lead = mm[1] ? mm[1].length : 0;
        marks.push([mm.index + lead + pos, mm.index + mm[0].length + pos]);
        pos = mm.index + mm[0].length + pos;
      }
      var stem = body, opts = [];
      if(marks.length >= 2){
        stem = body.slice(0, marks[0][0]).replace(/\s+$/, "");
        for(var j = 0; j < marks.length; j++){
          var end = (j + 1 < marks.length) ? marks[j+1][0] : body.length;
          /* build.py drops a trailing "." when it renders an option; the
             markdown keeps it, and so must this. */
          opts.push(body.slice(marks[j][1], end).replace(/\s+$/, ""));
        }
      }
      var q = {type:"q", raw:line, prefix:prefix, stem:stem, options:opts,
               answer:answer, sep:sep, answerText:answerText, source:source};
      q.orig = fingerprint(q);
      out.push(q);
    }
    return out;
  }

  /* Everything a person can change in the structured editor, in one string.
     A question whose fingerprint still matches the one taken at parse time
     is written back as the exact line that was read — so opening a file in
     the question editor and saving it cannot reflow the 1,200 questions
     nobody touched. Only edited questions get a rebuilt line. */
  function fingerprint(q){
    return JSON.stringify([q.stem, q.options, q.answer, q.answerText, q.source]);
  }

  /* A question is one line, so anything a textarea may hold that would break
     that -- a newline, a tab -- collapses to a space. */
  function flat(s){ return (s == null ? "" : s).replace(/[\r\n\t]+/g, " ").replace(/^\s+|\s+$/g, ""); }

  function serializeQuestion(q){
    if(q.raw != null && q.orig === fingerprint(q)) return q.raw;
    var parts = [(q.prefix || "- Q:") + " " + flat(q.stem)];
    for(var i = 0; i < q.options.length; i++){
      var o = flat(q.options[i]);
      if(o) parts.push(OPT_LETTERS[i] + ". " + o);
    }
    var line = parts.join(" ");
    if(q.answer){
      var txt = flat(q.answerText);
      var sep = (q.sep == null) ? " — " : q.sep;
      if(txt && !/\s$/.test(sep)) sep += " ";
      line += " (Answer: " + q.answer + (txt ? sep + txt : "") + ")";
    }
    if(q.source) line += " (" + flat(q.source) + ")";
    return line;
  }

  function serializeBlocks(bs){
    return bs.map(function(b){ return b.type === "raw" ? b.text : serializeQuestion(b); }).join("\n");
  }

  /* ---------------- checks ---------------- */
  var TOPIC_SECTIONS = ["Summary","Definition","Pathophysiology","Clinical features","Etiology",
    "Diagnosis","Scoring and Severity","Treatment and Management","Surgeries","Complications","Prognosis"];

  function runChecks(doc, text){
    var out = [];
    var opens = (text.match(/^:::[ \t]+\S/gm) || []).length;
    var closes = (text.match(/^:::[ \t]*$/gm) || []).length;
    if(opens !== closes){
      out.push(["bad", opens + " ::: block(s) opened but " + closes + " closed — an unclosed fence swallows the rest of the page into the callout."]);
    } else if(opens){
      out.push(["ok", opens + " guideline callout(s), all closed."]);
    }
    if(doc.kind === "question-bank"){
      var qs = parseQuestions(text).filter(function(b){ return b.type === "q"; });
      var keyed = qs.filter(function(q){ return q.answer && q.options.length >= 2; }).length;
      var thin = qs.filter(function(q){ return q.options.length && q.options.length < 2; }).length;
      out.push(["ok", qs.length + " question(s), " + keyed + " with an answer key."]);
      if(thin) out.push(["warn", thin + " question(s) have a single option — they will render as self-check."]);
      var nosrc = qs.filter(function(q){ return !q.source; }).length;
      if(nosrc) out.push(["warn", nosrc + " question(s) carry no (Source: …) citation."]);
    } else if(doc.kind === "topic"){
      if(!/^#\s+\S/m.test(text)) out.push(["bad", "No '# Title' heading — the page needs one for its title."]);
      var heads = (text.match(/^##\s+(.+)$/gm) || []).map(function(h){ return h.replace(/^##\s+/, "").trim(); });
      var missing = TOPIC_SECTIONS.filter(function(s){ return heads.indexOf(s) === -1; });
      out.push(["ok", heads.length + " section(s): " + (heads.join(", ") || "none")]);
      if(missing.length && missing.length < TOPIC_SECTIONS.length){
        out.push(["warn", "Not using the standard eleven sections — missing: " + missing.join(", ") + ". Fine for a procedure page."]);
      }
      var cites = (text.match(/\(Source:[^)]*\)/g) || []).length;
      var figs = (text.match(/\]\((?:fig|img):\/\//g) || []).length;
      out.push([cites ? "ok" : "warn", cites + " citation(s)" + (figs ? ", " + figs + " figure reference(s)" : "")]);
      var paras = text.split(/\n\s*\n/).filter(function(p){
        return p.trim() && !/^[#>|!\-*:]/.test(p.trim()) && p.indexOf("(Source:") === -1 && p.length > 90;
      }).length;
      if(paras) out.push(["warn", paras + " long paragraph(s) end without a (Source: …) citation."]);
    }
    return out;
  }

  function renderChecks(){
    var box = $("checks");
    if(!cur){ box.innerHTML = ""; return; }
    var rows = runChecks(cur, editorText());
    box.innerHTML = '<div class="t">Checks</div>' + rows.map(function(r){
      return '<div class="ck ' + r[0] + '">' + (r[0] === "bad" ? "✖" : r[0] === "warn" ? "⚠" : "✓") +
             " <span>" + esc(r[1]) + "</span></div>";
    }).join("");
  }

  /* ---------------- sidebar ---------------- */
  function catName(slug){
    var names = window.OS_CATEGORY_NAMES || {};
    return names[slug] || slug;
  }

  function visibleDocs(){
    var q = ($("filter").value || "").toLowerCase().trim();
    return docs.filter(function(d){
      if(tab === "articles" && d.kind !== "topic") return false;
      if(tab === "questions" && d.kind !== "question-bank") return false;
      if(tab === "edited" && !d.edited) return false;
      if(!q) return true;
      return (d.title + " " + d.path + " " + catName(d.category_slug)).toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderList(){
    var list = $("doc-list"), items = visibleDocs(), html = "", lastCat = null;
    if(!items.length){ list.innerHTML = '<div class="no-results">Nothing matches.</div>'; return; }
    items.forEach(function(d){
      if(d.category_slug !== lastCat){
        lastCat = d.category_slug;
        html += '<div class="cat">' + esc(catName(lastCat)) + "</div>";
      }
      var label = d.kind === "question-bank" ? "Question bank"
                : d.kind === "index" ? "Category index" : d.title;
      html += '<button type="button" class="doc' + (cur && cur.path === d.path ? " on" : "") +
              '" data-path="' + esc(d.path) + '">' +
              '<span class="nm">' + esc(label) + "</span>" +
              (d.kind === "question-bank" ? '<span class="k">Q</span>' : "") +
              (d.new_file ? '<span class="k">new</span>' : "") +
              (d.pending ? '<span class="k pend" title="a proposal is waiting">' + (isAdmin() ? "review" : "proposed") + "</span>" : "") +
              (d.edited ? '<span class="dot" title="edited on the site"></span>' : "") +
              "</button>";
    });
    list.innerHTML = html;
  }

  /* ---------------- editor ---------------- */
  function editorText(){
    if(mode === "visual" && vblocks) return serializeDocument();
    if(mode === "q" && blocks) return serializeBlocks(blocks);
    return $("editor").value;
  }
  function dirty(){ return cur && editorText() !== curBody; }

  function markDirty(){
    $("save-btn").disabled = !dirty();
    $("dirty").textContent = dirty() ? "Unsaved changes" : "";
    renderChecks();
    if(cur && cur.proposal) renderDiff();
  }

  function openDoc(path){
    if(dirty() && !confirm("You have unsaved changes. Discard them?")) return;
    OS.req("/api/admin/docs/" + path).then(function(r){
      if(!r.ok) return r.json().then(function(j){ OS.showToast(j.detail || "Could not open that document."); });
      return r.json().then(function(d){
        /* An editor with an open proposal on this page carries on from it;
           an admin always opens the live text and reviews from the
           Proposals tab. */
        showDoc(d, (!isAdmin() && d.my_proposal) ? d.my_proposal : null);
      });
    });
  }

  function setMode(m){
    if(!cur) return;
    if(m === "q" && cur.kind !== "question-bank") return;
    if(m === "visual" && cur.kind === "question-bank") return;
    /* Leaving a structured pane writes what it holds back into the textarea,
       so whichever pane is shown next starts from the current text. */
    if(mode === "q" && blocks && m !== "q") $("editor").value = serializeBlocks(blocks);
    if(mode === "visual" && vblocks && m !== "visual") $("editor").value = serializeDocument();
    if(m === "q" && mode !== "q") blocks = parseQuestions($("editor").value);
    if(m === "visual" && mode !== "visual") vblocks = parseDocument($("editor").value);
    mode = m;
    $("mode-visual").classList.toggle("on", m === "visual");
    $("mode-md").classList.toggle("on", m === "md");
    $("mode-q").classList.toggle("on", m === "q");
    $("editor").style.display = m === "md" ? "" : "none";
    $("qedit").style.display = m === "q" ? "" : "none";
    $("visual").style.display = m === "visual" ? "" : "none";
    $("vbar").style.display = m === "visual" ? "" : "none";
    if(m === "q") renderQuestions();
    if(m === "visual") renderVisual();
    markDirty();
  }

  /* ---------------- structured question editor ---------------- */
  function renderQuestions(){
    var wrap = $("qedit"), html = "", qn = 0;
    blocks.forEach(function(b, i){
      if(b.type === "raw"){
        if(/^###\s+/.test(b.text)){
          html += '<div class="qgroup-head"><input type="text" data-raw="' + i + '" value="' +
                  esc(b.text.replace(/^###\s+/, "")) + '" aria-label="Topic heading"></div>';
        }
        return;
      }
      qn++;
      html += '<div class="qcard" data-q="' + i + '">' +
        '<div class="row"><span class="lbl">Question ' + qn + '</span>' +
        '<span style="margin-left:auto"></span>' +
        '<button type="button" class="x" data-del="' + i + '" title="Delete this question">✕</button></div>' +
        '<textarea data-f="stem" rows="2" aria-label="Question stem">' + esc(b.stem) + "</textarea>";
      for(var k = 0; k < b.options.length; k++){
        html += '<div class="qopt' + (b.answer === OPT_LETTERS[k] ? " correct" : "") + '">' +
          '<input type="radio" name="ans-' + i + '" data-ans="' + OPT_LETTERS[k] + '"' +
          (b.answer === OPT_LETTERS[k] ? " checked" : "") + ' aria-label="Mark ' + OPT_LETTERS[k] + ' correct">' +
          '<span class="mk">' + OPT_LETTERS[k] + '.</span>' +
          '<input type="text" class="grow" data-opt="' + k + '" value="' + esc(b.options[k]) + '" style="flex:1">' +
          '<button type="button" class="x" data-delopt="' + k + '" title="Remove option">✕</button></div>';
      }
      html += '<div class="row"><button type="button" class="abtn" data-addopt="1">Add option</button>' +
              (b.options.length ? "" : '<span style="font-size:.8rem;color:var(--text3)">No options — shows as a self-check question.</span>') +
              "</div>" +
        '<div><div class="lbl">Explanation shown after answering</div>' +
        '<textarea data-f="answerText" rows="2" aria-label="Explanation">' + esc(b.answerText) + "</textarea></div>" +
        '<div><div class="lbl">Citation</div>' +
        '<input type="text" data-f="source" value="' + esc(b.source) +
        '" placeholder="Source: *Schwartz’s ABSITE*, Ch. 17 Breast" aria-label="Citation"></div>' +
        '<div class="row"><button type="button" class="abtn" data-addq="' + i + '">Add a question below</button></div>' +
        "</div>";
    });
    if(!blocks.some(function(b){ return b.type === "q"; })){
      html += '<div class="admin-empty">No questions in this file yet. ' +
              '<button type="button" class="abtn" data-addq="-1">Add one</button></div>';
    }
    wrap.innerHTML = html;
  }

  function qcardIndex(el){
    var card = el.closest("[data-q]");
    return card ? parseInt(card.getAttribute("data-q"), 10) : -1;
  }

  function wireQuestionEditor(){
    var wrap = $("qedit");
    wrap.addEventListener("input", function(e){
      var t = e.target;
      if(t.hasAttribute("data-raw")){
        blocks[parseInt(t.getAttribute("data-raw"), 10)].text = "### " + t.value;
        markDirty(); return;
      }
      var i = qcardIndex(t);
      if(i < 0) return;
      if(t.hasAttribute("data-f")) blocks[i][t.getAttribute("data-f")] = t.value;
      else if(t.hasAttribute("data-opt")) blocks[i].options[parseInt(t.getAttribute("data-opt"), 10)] = t.value;
      markDirty();
    });
    wrap.addEventListener("change", function(e){
      var t = e.target;
      if(!t.hasAttribute("data-ans")) return;
      var i = qcardIndex(t);
      if(i < 0) return;
      blocks[i].answer = t.getAttribute("data-ans");
      renderQuestions(); markDirty();
    });
    wrap.addEventListener("click", function(e){
      var t = e.target.closest("button");
      if(!t) return;
      var i = qcardIndex(t);
      if(t.hasAttribute("data-del")){
        if(!confirm("Delete this question?")) return;
        blocks.splice(parseInt(t.getAttribute("data-del"), 10), 1);
      } else if(t.hasAttribute("data-delopt") && i >= 0){
        var k = parseInt(t.getAttribute("data-delopt"), 10);
        blocks[i].options.splice(k, 1);
        if(blocks[i].answer && OPT_LETTERS.indexOf(blocks[i].answer) >= blocks[i].options.length) blocks[i].answer = "";
      } else if(t.hasAttribute("data-addopt") && i >= 0){
        if(blocks[i].options.length < 6) blocks[i].options.push("");
      } else if(t.hasAttribute("data-addq")){
        var at = parseInt(t.getAttribute("data-addq"), 10);
        var blank = {type:"q", raw:null, prefix:"- Q:", stem:"", options:["", "", "", ""],
                     answer:"", sep:" — ", answerText:"", source:""};
        blocks.splice(at < 0 ? blocks.length : at + 1, 0, blank);
      } else return;
      renderQuestions(); markDirty();
    });
  }

  /* ---------------- save / revert / history ---------------- */
  function save(){
    if(!cur || !dirty()) return;
    if(cur.proposal && isAdmin()) return;      // reviewing: approve or reject instead
    var text = editorText();
    $("save-btn").disabled = true;
    if(!isAdmin()){ submitProposal(text); return; }
    OS.req("/api/admin/docs/" + cur.path, {
      method:"PUT", body: JSON.stringify({body:text, note:$("note").value || null})
    }).then(function(r){
      if(!r.ok) return r.json().then(function(j){
        OS.showToast(j.detail || "Save failed."); $("save-btn").disabled = false;
      });
      curBody = text;
      $("note").value = "";
      var d = byPath[cur.path];
      if(d){ d.edited = true; }
      cur.edited = true;
      applyReviewUi();
      $("meta").textContent = "Edited on the site · saved just now";
      OS.showToast("Saved. Run `python tools/admin_sync.py pull` locally to bring it into the repo.");
      renderList(); markDirty();
    });
  }

  function revert(){
    if(!cur) return;
    if(!confirm("Discard the site's edits to this file and go back to what the repo has?")) return;
    OS.req("/api/admin/docs/" + cur.path + "/revert", {method:"POST"}).then(function(r){
      if(!r.ok) return r.json().then(function(j){ OS.showToast(j.detail || "Could not revert."); });
      return r.json().then(function(res){
        if(res.deleted){
          docs = docs.filter(function(d){ return d.path !== cur.path; });
          delete byPath[cur.path];
          cur = null; curBody = "";
          $("editor-panes").style.display = "none";
          $("admin-empty").style.display = "";
          OS.showToast("Page deleted.");
        } else {
          curBody = res.body;
          $("editor").value = res.body;
          blocks = null; vblocks = null;
          mode = "md";
          setMode(cur.kind === "question-bank" ? "q" : "visual");
          cur.edited = false;
          if(byPath[cur.path]) byPath[cur.path].edited = false;
          applyReviewUi();
          OS.showToast("Reverted to the repo version.");
        }
        renderList(); markDirty();
      });
    });
  }

  function history(){
    if(!cur) return;
    OS.req("/api/admin/docs/" + cur.path + "/revisions").then(function(r){ return r.json(); })
      .then(function(rows){
        if(!rows.length){ OS.showToast("No saved revisions for this file yet."); return; }
        var lines = rows.map(function(x, i){
          return (i + 1) + ") " + (x.created_at || "").slice(0, 16).replace("T", " ") +
                 " · " + (x.author || "?") + " · " + x.chars + " chars" +
                 (x.note ? " · " + x.note : "");
        }).join("\n");
        var pick = prompt("Revisions for " + cur.path + ":\n\n" + lines +
                          "\n\nType a number to load it into the editor (it is not saved until you press Save):");
        var n = parseInt(pick, 10);
        if(!n || n < 1 || n > rows.length) return;
        OS.req("/api/admin/revisions/" + rows[n-1].id).then(function(r2){ return r2.json(); })
          .then(function(rev){
            $("editor").value = rev.body; blocks = null; vblocks = null;
            mode = "md";
            setMode(cur.kind === "question-bank" ? "q" : "visual");
            markDirty();
            OS.showToast("Loaded revision from " + (rev.created_at || "").slice(0, 16).replace("T", " ") +
                         " — press Save to keep it.");
          });
      });
  }

  function newTopic(){
    var cats = {};
    docs.forEach(function(d){ cats[d.category_slug] = 1; });
    var catList = Object.keys(cats).sort();
    var cat = prompt("Which category?\n\n" + catList.join(", "));
    if(!cat) return;
    cat = cat.trim().toLowerCase();
    if(catList.indexOf(cat) === -1){ OS.showToast("Unknown category."); return; }
    var title = prompt("Title of the new page (e.g. Perianal Fistula):");
    if(!title) return;
    var slug = title.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-|-$/g, "");
    slug = (prompt("File name (slug):", slug) || "").trim();
    if(!slug) return;
    var path = "content/" + cat + "/" + slug + ".md";
    if(byPath[path]){ OS.showToast("That page already exists."); openDoc(path); return; }
    var skeleton = "# " + title + "\n\n" + ["Summary","Definition","Pathophysiology","Clinical features",
      "Etiology","Diagnosis","Scoring and Severity","Treatment and Management","Surgeries",
      "Complications","Prognosis"].map(function(s){
        return "## " + s + "\n*Not covered in source textbooks.*\n";
      }).join("\n");
    if(!isAdmin()){
      OS.req("/api/admin/proposals/for/" + path, {
        method:"PUT", body: JSON.stringify({body:skeleton, title:title, kind:"topic", note:"new page"})
      }).then(function(r){
        if(!r.ok) return r.json().then(function(j){ OS.showToast(j.detail || "Could not propose that page."); });
        return r.json().then(function(res){
          OS.showToast("Proposed. Fill it in and update the proposal; an admin approves it.");
          openProposal(res.proposal.id);
        });
      });
      return;
    }
    OS.req("/api/admin/docs/" + path, {
      method:"PUT", body: JSON.stringify({body:skeleton, title:title, kind:"topic", note:"created in the editor"})
    }).then(function(r){
      if(!r.ok) return r.json().then(function(j){ OS.showToast(j.detail || "Could not create that page."); });
      return loadDocs().then(function(){ openDoc(path); OS.showToast("Created. It reaches the site after a pull and a rebuild."); });
    });
  }

  /* ---------------- proposals & review ----------------
     An editor's Save does not touch the live text: it becomes a proposal an
     admin reads as a diff and approves or rejects. Approval is what writes
     the document, exactly as an admin's own Save would. */
  var me = null;
  function isAdmin(){ return !!(me && me.role === "admin"); }

  function when(iso){ return iso ? iso.slice(0, 16).replace("T", " ") : ""; }

  /* --- a line diff for the review panel --- */
  function lcsDiff(A, B){
    var n = A.length, m = B.length;
    if(n * m > 6000000){
      // Far beyond anything in content/; a crude fallback rather than a hang.
      var out0 = [];
      for(var k = 0; k < Math.max(n, m); k++){
        if(A[k] === B[k]) out0.push([" ", A[k]]);
        else { if(k < n) out0.push(["-", A[k]]); if(k < m) out0.push(["+", B[k]]); }
      }
      return out0;
    }
    var L = [];
    for(var i = 0; i <= n; i++) L.push(new Int32Array(m + 1));
    for(i = n - 1; i >= 0; i--)
      for(var j = m - 1; j >= 0; j--)
        L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    var out = []; i = 0; j = 0;
    while(i < n && j < m){
      if(A[i] === B[j]){ out.push([" ", A[i]]); i++; j++; }
      else if(L[i + 1][j] >= L[i][j + 1]){ out.push(["-", A[i]]); i++; }
      else { out.push(["+", B[j]]); j++; }
    }
    while(i < n) out.push(["-", A[i++]]);
    while(j < m) out.push(["+", B[j++]]);
    return out;
  }

  /* Word-level marks inside a changed line, so a one-word edit in a
     200-word paragraph is visible at a glance. */
  function wordMarks(oldLine, newLine){
    var a = oldLine.split(/(\s+)/), b = newLine.split(/(\s+)/);
    var d = lcsDiff(a, b), del = "", ins = "";
    d.forEach(function(x){
      var t = escHtml(x[1]);
      if(x[0] === " "){ del += t; ins += t; }
      else if(x[0] === "-") del += "<del>" + t + "</del>";
      else ins += "<ins>" + t + "</ins>";
    });
    return [del, ins];
  }

  function renderDiff(){
    var box = $("diffpanel");
    if(!cur || !cur.proposal){ box.style.display = "none"; return; }
    box.style.display = "";
    var d = lcsDiff((cur.liveBody || "").split("\n"), editorText().split("\n"));
    var html = "", changed = 0, skipped = 0;
    function flushSkip(){ if(skipped){ html += '<div class="dl ctx">… ' + skipped + " unchanged line(s)</div>"; skipped = 0; } }
    for(var i = 0; i < d.length; i++){
      var op = d[i][0], line = d[i][1];
      if(op === " "){
        var near = (i > 0 && d[i - 1][0] !== " ") || (i + 1 < d.length && d[i + 1][0] !== " ");
        if(near){ flushSkip(); html += '<div class="dl same">' + escHtml(line) + "</div>"; }
        else skipped++;
        continue;
      }
      flushSkip(); changed++;
      if(op === "-" && i + 1 < d.length && d[i + 1][0] === "+"){
        var wm = wordMarks(line, d[i + 1][1]);
        html += '<div class="dl del">' + wm[0] + '</div><div class="dl ins">' + wm[1] + "</div>";
        i++;                      // one edited line, not a removal plus an addition
      } else {
        html += '<div class="dl ' + (op === "-" ? "del" : "ins") + '">' + escHtml(line) + "</div>";
      }
    }
    flushSkip();
    var head = cur.new_file ? "New page — everything below is added."
             : changed ? changed + " changed line(s) against the live text"
             : "No difference from the live text.";
    if(cur.proposal.stale) head += ' · <span class="stale">⚠ the page changed after this was written; the diff is against today’s text</span>';
    box.innerHTML = '<div class="t">Changes</div><div class="dh">' + head + "</div>" + html;
  }

  /* --- buttons and status line for the current document --- */
  function applyReviewUi(){
    var p = cur && cur.proposal, admin = isAdmin();
    $("save-btn").style.display = (p && admin) ? "none" : "";
    $("save-btn").textContent = admin ? "Save" : (p ? "Update proposal" : "Submit for approval");
    $("approve-btn").style.display = (p && admin) ? "" : "none";
    $("reject-btn").style.display = (p && admin) ? "" : "none";
    $("withdraw-btn").style.display = (p && !admin) ? "" : "none";
    $("revert-btn").style.display = (admin && !p) ? "" : "none";
    $("revert-btn").disabled = !(cur && cur.edited);
    $("history-btn").style.display = cur && cur.new_file ? "none" : "";
    var meta;
    if(p && admin){
      meta = "Proposal by " + (p.author || "?") + " · submitted " + when(p.updated_at || p.created_at) +
             (p.note ? " · “" + p.note + "”" : "") +
             " · edit the text if you like, then approve or reject";
    } else if(p){
      meta = "Your proposal, waiting for an admin · submitted " + when(p.updated_at || p.created_at) +
             (p.note ? " · “" + p.note + "”" : "");
    } else if(cur && cur.edited){
      meta = "Edited on the site" + (cur.updated_by ? " by " + cur.updated_by : "") +
             (cur.updated_at ? " · " + when(cur.updated_at) : "") +
             " · " + (cur.revisions || 0) + " revision(s)";
    } else {
      meta = "Matches the repo";
    }
    $("meta").textContent = meta;
    renderDiff();
  }

  /* Everything openDoc and openProposal share once the text is in hand. */
  function showDoc(d, prop){
    cur = d; cur.proposal = prop || null; cur.liveBody = d.body;
    curBody = prop ? prop.body : d.body;
    blocks = null; vblocks = null; mode = "md";
    $("editor").value = curBody;
    $("doc-title").textContent = d.kind === "question-bank"
      ? catName(d.category_slug) + " question bank" : d.title;
    $("doc-path").textContent = d.path;
    $("mode-q").style.display = d.kind === "question-bank" ? "" : "none";
    $("mode-visual").style.display = d.kind === "question-bank" ? "none" : "";
    $("editor-panes").style.display = "";
    $("admin-empty").style.display = "none";
    /* Articles open in the visual editor, question banks in the question
       editor -- both round-trip untouched content verbatim, so opening a
       file in one cannot rewrite it. */
    setMode(d.kind === "question-bank" ? "q" : "visual");
    applyReviewUi();
    renderList();
    markDirty();
  }

  function openProposal(id){
    if(dirty() && !confirm("You have unsaved changes. Discard them?")) return;
    OS.req("/api/admin/proposals/" + id).then(function(r){
      if(!r.ok) return r.json().then(function(j){ OS.showToast(j.detail || "Could not open that proposal."); });
      return r.json().then(function(p){
        setTab("all");
        var d = byPath[p.path] || {path:p.path, kind:p.kind, category_slug:p.category_slug,
                                    title:p.title, edited:false, revisions:0, new_file:true};
        d = Object.assign({}, d, {body:p.current_body, new_file: p.new_file || d.new_file});
        showDoc(d, p);
      });
    });
  }

  function approve(){
    var p = cur && cur.proposal;
    if(!p) return;
    var text = editorText();
    if(!confirm("Approve and apply this proposal? It becomes the live text of " + cur.path +
                (text !== p.body ? " (with your edits)." : "."))) return;
    OS.req("/api/admin/proposals/" + p.id + "/approve", {
      method:"POST", body: JSON.stringify({body:text, note:$("note").value || null})
    }).then(function(r){
      if(!r.ok) return r.json().then(function(j){ OS.showToast(j.detail || "Could not approve."); });
      $("note").value = "";
      OS.showToast("Approved. It reaches the site after `admin_sync.py pull` and a rebuild.");
      return loadDocs().then(function(){ openDoc(cur.path); });
    });
  }

  function reject(){
    var p = cur && cur.proposal;
    if(!p) return;
    var note = prompt("Reject this proposal? A short reason helps the editor:", $("note").value || "");
    if(note === null) return;
    OS.req("/api/admin/proposals/" + p.id + "/reject", {
      method:"POST", body: JSON.stringify({note: note || null})
    }).then(function(r){
      if(!r.ok) return r.json().then(function(j){ OS.showToast(j.detail || "Could not reject."); });
      $("note").value = "";
      OS.showToast("Rejected.");
      return loadDocs().then(function(){ if(!cur.new_file) openDoc(cur.path); else setTab("proposals"); });
    });
  }

  function withdraw(){
    var p = cur && cur.proposal;
    if(!p) return;
    if(!confirm("Withdraw your proposal? Your changes to this page will be discarded.")) return;
    OS.req("/api/admin/proposals/" + p.id, {method:"DELETE"}).then(function(r){
      if(!r.ok) return r.json().then(function(j){ OS.showToast(j.detail || "Could not withdraw."); });
      OS.showToast("Withdrawn.");
      curBody = editorText();   // so the unsaved-changes guard does not fire on the reload
      return loadDocs().then(function(){ if(!cur.new_file) openDoc(cur.path); else setTab("proposals"); });
    });
  }

  function submitProposal(text){
    OS.req("/api/admin/proposals/for/" + cur.path, {
      method:"PUT", body: JSON.stringify({body:text, note:$("note").value || null,
                                          kind:cur.kind, title:cur.title})
    }).then(function(r){
      if(!r.ok) return r.json().then(function(j){
        OS.showToast(j.detail || "Could not submit."); $("save-btn").disabled = false;
      });
      return r.json().then(function(res){
        if(!res.saved){ OS.showToast("Nothing to submit — the text matches the live page."); markDirty(); return; }
        curBody = text;
        cur.proposal = res.proposal; cur.proposal.body = text;
        $("note").value = "";
        if(byPath[cur.path]) byPath[cur.path].pending = 1;
        OS.showToast("Submitted. An admin will review it before it goes on the site.");
        loadDocs();
        applyReviewUi(); markDirty();
      });
    });
  }

  /* --- the proposals tab --- */
  function showProposals(){
    var admin = isAdmin();
    OS.req("/api/admin/proposals?status=" + (admin ? "pending" : "all"))
      .then(function(r){ return r.json(); }).then(function(res){
        var rows = res.proposals, panel = $("proposals-panel");
        if(!rows.length){
          panel.innerHTML = '<div class="admin-empty">' + (admin
            ? "No proposals waiting for review."
            : "You have not proposed any changes yet. Open a page, edit it, and press <b>Submit for approval</b>.") +
            "</div>";
          return;
        }
        var html = '<div class="admin-users"><table><thead><tr><th>Page</th>' +
          (admin ? "<th>By</th>" : "<th>Status</th>") + "<th>When</th><th>Note</th><th></th></tr></thead><tbody>";
        rows.forEach(function(p){
          var open = p.status === "pending";
          html += "<tr" + (open ? ' class="click" data-open="' + p.id + '"' : "") + '><td class="nm">' +
            esc(p.title) + '<span class="path">' + esc(p.path) + "</span>" +
            (p.new_file ? ' <span class="k">new page</span>' : "") +
            (p.stale ? ' <span class="stale" title="The page changed after this was written">⚠ stale</span>' : "") +
            "</td><td>" + (admin ? esc(p.author || "?") : '<span class="role-pill ' + p.status + '">' + p.status + "</span>") +
            "</td><td>" + esc(when(p.updated_at || p.created_at)) + "</td><td>" +
            esc(p.note || "") +
            (p.status === "rejected" && p.review_note ? '<div class="rev-note">Reason: ' + esc(p.review_note) + "</div>" : "") +
            (p.status !== "pending" && p.reviewer ? '<div class="rev-note">' + p.status + " by " + esc(p.reviewer) + "</div>" : "") +
            "</td><td>" +
            (open ? '<button type="button" class="abtn" data-open="' + p.id + '">' + (admin ? "Review" : "Continue") + "</button>"
                  : '<button type="button" class="abtn" data-dismiss="' + p.id + '" title="Remove from this list">Clear</button>') +
            "</td></tr>";
        });
        panel.innerHTML = html + "</tbody></table></div>";
      });
  }

  function wireProposals(){
    $("proposals-panel").addEventListener("click", function(e){
      var b = e.target.closest("[data-open]");
      if(b){ openProposal(+b.getAttribute("data-open")); return; }
      var d = e.target.closest("button[data-dismiss]");
      if(d){
        OS.req("/api/admin/proposals/" + d.getAttribute("data-dismiss"), {method:"DELETE"})
          .then(function(){ showProposals(); });
      }
    });
    $("approve-btn").addEventListener("click", approve);
    $("reject-btn").addEventListener("click", reject);
    $("withdraw-btn").addEventListener("click", withdraw);
  }

  /* ---------------- users ---------------- */
  function showUsers(){
    OS.req("/api/admin/users").then(function(r){ return r.json(); }).then(function(rows){
      var html = '<div class="admin-users"><table><thead><tr><th>Name</th><th>Email</th>' +
        "<th>Sign-in</th><th>Role</th><th></th></tr></thead><tbody>";
      rows.forEach(function(u){
        var sel = '<select class="role-select" data-user="' + u.id + '" aria-label="Role for ' + esc(u.display_name) + '">' +
          ["user", "editor", "admin"].map(function(r){
            return '<option value="' + r + '"' + (u.role === r ? " selected" : "") + ">" +
                   {user:"Reader", editor:"Editor", admin:"Admin"}[r] + "</option>";
          }).join("") + "</select>";
        html += "<tr><td class=\"nm\">" + esc(u.display_name) + "</td><td>" + esc(u.email || "—") +
          "</td><td>" + esc(u.auth_provider) + '</td><td><span class="role-pill ' + u.role + '">' +
          u.role + "</span></td><td>" + sel + "</td></tr>";
      });
      $("users-panel").innerHTML =
        '<div class="admin-note" style="margin-bottom:1rem"><b>Reader</b> saves progress only. ' +
        "<b>Editor</b> can change any article or question, but every save becomes a proposal " +
        "that waits for an admin. <b>Admin</b> edits directly, reviews proposals and manages accounts.</div>" +
        html + "</tbody></table></div>";
    });
  }

  function wireUsers(){
    $("users-panel").addEventListener("change", function(e){
      var sel = e.target.closest("select[data-user]");
      if(!sel) return;
      var role = sel.value;
      var ask = {admin: "Give this account full admin access — direct edits, reviewing proposals and managing accounts?",
                 editor: "Make this account an editor? Their saves become proposals you approve.",
                 user: "Remove this account's editing access?"}[role];
      if(!confirm(ask)){ showUsers(); return; }
      OS.req("/api/admin/users/" + sel.getAttribute("data-user"), {
        method:"PATCH", body: JSON.stringify({role:role})
      }).then(function(r){
        if(!r.ok) return r.json().then(function(j){ OS.showToast(j.detail || "Could not change that."); showUsers(); });
        OS.showToast("Updated."); showUsers();
      });
    });
  }

  /* ---------------- boot ---------------- */
  function loadDocs(){
    return OS.req("/api/admin/docs").then(function(r){ return r.json(); }).then(function(res){
      docs = res.docs; byPath = {};
      docs.forEach(function(d){ byPath[d.path] = d; });
      $("edited-count").textContent = res.edited_count
        ? res.edited_count + " file(s) edited on the site and waiting to be pulled"
        : "Everything here matches the repo.";
      $("tab-proposals").textContent = (isAdmin() ? "Proposals to review" : "My proposals") +
        (res.pending_count ? " (" + res.pending_count + ")" : "");
      $("tab-proposals").classList.toggle("attention", !!(isAdmin() && res.pending_count));
      renderList();
    });
  }

  function setTab(t){
    tab = t;
    ["all","articles","questions","edited","users","proposals"].forEach(function(k){
      var b = $("tab-" + k);
      if(b) b.classList.toggle("on", k === t);
    });
    var users = t === "users", props = t === "proposals", panel = users || props;
    $("users-panel").style.display = users ? "" : "none";
    $("proposals-panel").style.display = props ? "" : "none";
    $("editor-panes").style.display = panel || !cur ? "none" : "";
    $("admin-empty").style.display = panel || cur ? "none" : "";
    $("doc-browse").style.display = panel ? "none" : "";
    if(users) showUsers(); else if(props) showProposals(); else renderList();
  }

  ready(function(){
    if(!OS.apiConfigured){
      $("admin-gate").innerHTML = '<div class="admin-note">This build has no API configured, so there is nothing to edit. Set <code>API_BASE</code> in <code>build.py</code>.</div>';
      return;
    }
    OS.user.then(function(user){
      if(!user){ location.replace("login.html"); return; }
      if(user.role !== "admin" && user.role !== "editor"){
        $("admin-gate").innerHTML = '<div class="admin-note">This page is for the site\u2019s editors and administrators. ' +
          "You are signed in as " + esc(user.display_name) + ".</div>";
        return;
      }
      me = user;
      $("admin-gate").style.display = "none";
      $("admin-shell").style.display = "";
      if(!isAdmin()){
        $("tab-users").style.display = "none";
        $("editor-banner").style.display = "";
      }

      $("filter").addEventListener("input", renderList);
      $("doc-list").addEventListener("click", function(e){
        var b = e.target.closest("button.doc");
        if(b) openDoc(b.getAttribute("data-path"));
      });
      ["all","articles","questions","edited","users","proposals"].forEach(function(k){
        var b = $("tab-" + k);
        if(b) b.addEventListener("click", function(){ setTab(k); });
      });
      $("editor").addEventListener("input", markDirty);
      $("save-btn").addEventListener("click", save);
      $("revert-btn").addEventListener("click", revert);
      $("history-btn").addEventListener("click", history);
      $("new-btn").addEventListener("click", newTopic);
      $("mode-visual").addEventListener("click", function(){ setMode("visual"); });
      $("mode-md").addEventListener("click", function(){ setMode("md"); });
      $("mode-q").addEventListener("click", function(){ setMode("q"); });
      wireQuestionEditor();
      wireVisual();
      wireFormatBar();
      wireUsers();
      wireProposals();

      document.addEventListener("keydown", function(e){
        if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s"){ e.preventDefault(); save(); }
      });
      window.addEventListener("beforeunload", function(e){
        if(dirty()){ e.preventDefault(); e.returnValue = ""; }
      });

      loadDocs();
    });
  });
})();
