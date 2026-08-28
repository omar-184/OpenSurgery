
(function(){
  function ready(fn){ if(document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  function el(tag, cls, html){ var d = document.createElement(tag); if(cls) d.className = cls; if(html != null) d.innerHTML = html; return d; }
  function scoreClass(pct){ if(pct == null) return "none"; if(pct >= 80) return "good"; if(pct >= 60) return "amber"; return "bad"; }
  function timeAgo(iso){
    var d = (Date.now() - new Date(iso).getTime()) / 1000;
    if(d < 60) return "just now";
    if(d < 3600) return Math.floor(d/60) + "m ago";
    if(d < 86400) return Math.floor(d/3600) + "h ago";
    return Math.floor(d/86400) + "d ago";
  }

  ready(function(){
    OS.user.then(function(user){
      if(!user){
        location.href = (document.body.dataset.root || "") + "login.html?next=" +
          encodeURIComponent(location.pathname.split("/").pop());
        return;
      }
      document.getElementById("dash-who").textContent = "Signed in as " + (user.email || user.display_name);
      OS.req("/api/dashboard/summary").then(function(r){ return r.json(); }).then(render);
    });
  });

  function render(d){
    document.getElementById("stat-topics").textContent = d.topics_read + " / " + d.topics_total;
    document.getElementById("stat-topics-sub").textContent = d.topics_total
      ? Math.round(100 * d.topics_read / d.topics_total) + "% of the library" : "";
    var started = d.categories.filter(function(c){ return c.topics_read > 0; }).length;
    document.getElementById("stat-cats").textContent = started + " / " + d.categories.length;
    var attempted = d.categories.filter(function(c){ return c.quiz_attempts > 0; });
    var totalAttempts = d.categories.reduce(function(a,c){ return a + c.quiz_attempts; }, 0);
    document.getElementById("stat-quizzes").textContent = String(totalAttempts);
    document.getElementById("stat-quizzes-sub").textContent = "across " + attempted.length + " categories";
    var avgs = attempted.filter(function(c){ return c.quiz_avg_score_pct != null; }).map(function(c){ return c.quiz_avg_score_pct; });
    document.getElementById("stat-avg").textContent = avgs.length ? Math.round(avgs.reduce(function(a,b){return a+b;},0)/avgs.length) + "%" : "—";

    var catNames = window.OS_CATEGORY_NAMES || {};
    var list = document.getElementById("cat-list");
    list.innerHTML = "";
    d.categories.forEach(function(c){
      var pct = c.topics_total ? Math.round(100 * c.topics_read / c.topics_total) : 0;
      var chip = c.quiz_avg_score_pct == null ? '<span class="chip none">—</span>'
        : '<span class="chip ' + scoreClass(c.quiz_avg_score_pct) + '">' + Math.round(c.quiz_avg_score_pct) + '%</span>';
      list.appendChild(el("div", "cat-row",
        '<div class="name">' + (catNames[c.slug] || c.slug) + '</div>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="frac">' + c.topics_read + ' / ' + c.topics_total + '</div>' + chip));
    });

    var acts = d.recent_reads.map(function(r){ return {type:"read", when:r.read_at, label:r.title}; })
      .concat(d.recent_attempts.map(function(a){
        return {type:"quiz", when:a.completed_at,
          label: (catNames[a.category_slug] || a.category_slug) + (a.mode === "exam" ? " exam" : " practice") +
                 (a.score_pct != null ? " — " + Math.round(a.score_pct) + "%" : "")};
      }))
      .sort(function(a,b){ return new Date(b.when) - new Date(a.when); }).slice(0, 10);
    var activity = document.getElementById("activity");
    activity.innerHTML = "";
    if(!acts.length){ activity.appendChild(el("div", "empty-note", "No activity yet — read a topic or try a quiz.")); return; }
    var readIco = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>';
    var quizIco = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>';
    acts.forEach(function(a){
      activity.appendChild(el("div", "act-row",
        '<div class="ico ' + a.type + '">' + (a.type === "read" ? readIco : quizIco) + '</div>' +
        '<div class="what">' + (a.type === "read" ? "Read " : "") + escapeHtml(a.label) + '</div>' +
        '<div class="when">' + timeAgo(a.when) + '</div>'));
    });
  }
  function escapeHtml(s){ var d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
})();
