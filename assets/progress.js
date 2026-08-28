
(function(){
  function ready(fn){ if(document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }

  var READ_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>';
  var UNREAD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>';

  function setBtnState(btn, isRead){
    btn.classList.toggle("is-read", isRead);
    btn.innerHTML = (isRead ? READ_ICON : UNREAD_ICON) + " " + (isRead ? "Read" : "Mark as read");
  }

  function wireMarkButton(){
    var btn = document.getElementById("mark-read-btn");
    if(!btn) return;
    var slug = btn.dataset.topicSlug;
    var nudge = document.getElementById("mark-read-nudge");

    OS.user.then(function(user){
      if(user){
        OS.req("/api/progress/topics").then(function(r){ return r.ok ? r.json() : []; }).then(function(rows){
          setBtnState(btn, rows.some(function(t){ return t.topic_slug === slug; }));
        });
      } else {
        var p = OS.pending();
        setBtnState(btn, p.topic_reads.indexOf(slug) >= 0);
      }
    });

    btn.addEventListener("click", function(){
      var willBeRead = !btn.classList.contains("is-read");
      OS.user.then(function(user){
        if(user){
          var req = willBeRead
            ? OS.req("/api/progress/topics/" + encodeURIComponent(slug) + "/read", {method:"PUT"})
            : OS.req("/api/progress/topics/" + encodeURIComponent(slug) + "/read", {method:"DELETE"});
          req.then(function(r){ if(r.ok) setBtnState(btn, willBeRead); });
        } else {
          var p = OS.pending();
          var i = p.topic_reads.indexOf(slug);
          if(willBeRead && i < 0) p.topic_reads.push(slug);
          if(!willBeRead && i >= 0) p.topic_reads.splice(i, 1);
          OS.savePending(p);
          setBtnState(btn, willBeRead);
          if(nudge) nudge.style.display = "block";
        }
      });
    });
  }

  function wireTopicListBadges(){
    var items = document.querySelectorAll("[data-topic-slug-row]");
    if(!items.length) return;
    OS.user.then(function(user){
      var readSet;
      if(user){
        return OS.req("/api/progress/topics").then(function(r){ return r.ok ? r.json() : []; }).then(function(rows){
          applyBadges(items, rows.map(function(t){ return t.topic_slug; }));
        });
      } else {
        applyBadges(items, OS.pending().topic_reads);
      }
    });
  }
  function applyBadges(items, slugs){
    var set = {}; slugs.forEach(function(s){ set[s] = true; });
    items.forEach(function(li){
      if(!set[li.dataset.topicSlugRow]) return;
      var right = li.querySelector(".row-right") || li.querySelector("a");
      var badge = document.createElement("span");
      badge.className = "read-badge";
      badge.innerHTML = READ_ICON + " Read";
      if(right && right.tagName === "A") right.insertBefore(badge, right.firstChild);
      else if(right) right.insertBefore(badge, right.firstChild);
    });
  }

  OS.recordAttempt = function(payload){
    OS.user.then(function(user){
      if(user){
        OS.req("/api/progress/quiz-attempts", {method:"POST", body: JSON.stringify(payload)}).then(function(r){
          if(r.ok) OS.showToast("Saved to your progress");
          else queueAttempt(payload);
        }).catch(function(){ queueAttempt(payload); });
      } else {
        queueAttempt(payload);
        OS.showToast("Sign in to save your scores");
      }
    });
  };
  function queueAttempt(payload){
    var p = OS.pending();
    p.quiz_attempts.push(payload);
    OS.savePending(p);
  }

  ready(function(){ wireMarkButton(); wireTopicListBadges(); });
})();
