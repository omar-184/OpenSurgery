
(function(){
  var $ = function(id){ return document.getElementById(id); };
  var docs = [], byPath = {}, cur = null, curBody = "", mode = "md", tab = "all", blocks = null;

  function esc(s){ var d = document.createElement("div"); d.textContent = s == null ? "" : s; return d.innerHTML; }
  function ready(fn){ if(document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }

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
              (d.edited ? '<span class="dot" title="edited on the site"></span>' : "") +
              "</button>";
    });
    list.innerHTML = html;
  }

  /* ---------------- editor ---------------- */
  function editorText(){
    return mode === "q" && blocks ? serializeBlocks(blocks) : $("editor").value;
  }
  function dirty(){ return cur && editorText() !== curBody; }

  function markDirty(){
    $("save-btn").disabled = !dirty();
    $("dirty").textContent = dirty() ? "Unsaved changes" : "";
    renderChecks();
  }

  function openDoc(path){
    if(dirty() && !confirm("You have unsaved changes. Discard them?")) return;
    OS.req("/api/admin/docs/" + path).then(function(r){
      if(!r.ok) return r.json().then(function(j){ OS.showToast(j.detail || "Could not open that document."); });
      return r.json().then(function(d){
        cur = d; curBody = d.body; blocks = null; mode = "md";
        $("editor").value = d.body;
        $("doc-title").textContent = d.kind === "question-bank"
          ? catName(d.category_slug) + " question bank" : d.title;
        $("doc-path").textContent = d.path;
        $("revert-btn").disabled = !d.edited;
        $("mode-q").style.display = d.kind === "question-bank" ? "" : "none";
        $("editor-panes").style.display = "";
        $("admin-empty").style.display = "none";
        $("meta").textContent = d.edited
          ? "Edited on the site" + (d.updated_by ? " by " + d.updated_by : "") +
            (d.updated_at ? " · " + d.updated_at.slice(0, 16).replace("T", " ") : "") +
            " · " + d.revisions + " revision(s)"
          : "Matches the repo";
        setMode("md");
        renderList();
        markDirty();
      });
    });
  }

  function setMode(m){
    if(!cur) return;
    if(m === "q" && cur.kind !== "question-bank") return;
    if(m === "q" && mode === "md") blocks = parseQuestions($("editor").value);
    if(m === "md" && mode === "q" && blocks) $("editor").value = serializeBlocks(blocks);
    mode = m;
    $("mode-md").classList.toggle("on", m === "md");
    $("mode-q").classList.toggle("on", m === "q");
    $("editor").style.display = m === "md" ? "" : "none";
    $("qedit").style.display = m === "q" ? "" : "none";
    if(m === "q") renderQuestions();
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
    var text = editorText();
    $("save-btn").disabled = true;
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
      $("revert-btn").disabled = false;
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
          blocks = null; setMode("md");
          cur.edited = false;
          if(byPath[cur.path]) byPath[cur.path].edited = false;
          $("revert-btn").disabled = true;
          $("meta").textContent = "Matches the repo";
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
            $("editor").value = rev.body; blocks = null; setMode("md"); markDirty();
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
    OS.req("/api/admin/docs/" + path, {
      method:"PUT", body: JSON.stringify({body:skeleton, title:title, kind:"topic", note:"created in the editor"})
    }).then(function(r){
      if(!r.ok) return r.json().then(function(j){ OS.showToast(j.detail || "Could not create that page."); });
      return loadDocs().then(function(){ openDoc(path); OS.showToast("Created. It reaches the site after a pull and a rebuild."); });
    });
  }

  /* ---------------- users ---------------- */
  function showUsers(){
    OS.req("/api/admin/users").then(function(r){ return r.json(); }).then(function(rows){
      var html = '<div class="admin-users"><table><thead><tr><th>Name</th><th>Email</th>' +
        "<th>Sign-in</th><th>Role</th><th></th></tr></thead><tbody>";
      rows.forEach(function(u){
        html += "<tr><td class=\"nm\">" + esc(u.display_name) + "</td><td>" + esc(u.email || "—") +
          "</td><td>" + esc(u.auth_provider) + '</td><td><span class="role-pill ' + u.role + '">' +
          u.role + "</span></td><td>" +
          '<button type="button" class="abtn' + (u.role === "admin" ? " danger" : "") +
          '" data-user="' + u.id + '" data-role="' + (u.role === "admin" ? "user" : "admin") + '">' +
          (u.role === "admin" ? "Remove admin" : "Make admin") + "</button></td></tr>";
      });
      $("users-panel").innerHTML = html + "</tbody></table></div>";
    });
  }

  function wireUsers(){
    $("users-panel").addEventListener("click", function(e){
      var b = e.target.closest("button[data-user]");
      if(!b) return;
      var role = b.getAttribute("data-role");
      if(!confirm(role === "admin" ? "Give this account full editing access to the site's content?"
                                    : "Remove this account's editing access?")) return;
      OS.req("/api/admin/users/" + b.getAttribute("data-user"), {
        method:"PATCH", body: JSON.stringify({role:role})
      }).then(function(r){
        if(!r.ok) return r.json().then(function(j){ OS.showToast(j.detail || "Could not change that."); });
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
      renderList();
    });
  }

  function setTab(t){
    tab = t;
    ["all","articles","questions","edited","users"].forEach(function(k){
      var b = $("tab-" + k);
      if(b) b.classList.toggle("on", k === t);
    });
    var users = t === "users";
    $("users-panel").style.display = users ? "" : "none";
    $("editor-panes").style.display = users || !cur ? "none" : "";
    $("admin-empty").style.display = users || cur ? "none" : "";
    $("doc-browse").style.display = users ? "none" : "";
    if(users) showUsers(); else renderList();
  }

  ready(function(){
    if(!OS.apiConfigured){
      $("admin-gate").innerHTML = '<div class="admin-note">This build has no API configured, so there is nothing to edit. Set <code>API_BASE</code> in <code>build.py</code>.</div>';
      return;
    }
    OS.user.then(function(user){
      if(!user){ location.replace("login.html"); return; }
      if(user.role !== "admin"){
        $("admin-gate").innerHTML = '<div class="admin-note">This page is for site administrators. ' +
          "You are signed in as " + esc(user.display_name) + ".</div>";
        return;
      }
      $("admin-gate").style.display = "none";
      $("admin-shell").style.display = "";

      $("filter").addEventListener("input", renderList);
      $("doc-list").addEventListener("click", function(e){
        var b = e.target.closest("button.doc");
        if(b) openDoc(b.getAttribute("data-path"));
      });
      ["all","articles","questions","edited","users"].forEach(function(k){
        var b = $("tab-" + k);
        if(b) b.addEventListener("click", function(){ setTab(k); });
      });
      $("editor").addEventListener("input", markDirty);
      $("save-btn").addEventListener("click", save);
      $("revert-btn").addEventListener("click", revert);
      $("history-btn").addEventListener("click", history);
      $("new-btn").addEventListener("click", newTopic);
      $("mode-md").addEventListener("click", function(){ setMode("md"); });
      $("mode-q").addEventListener("click", function(){ setMode("q"); });
      wireQuestionEditor();
      wireUsers();

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
