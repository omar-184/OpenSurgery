
(function(){
  var MODE = window.QUIZ_MODE, ALL = window.QUIZ_DATA || [];
  var params = new URLSearchParams(location.search);
  var topicFilter = params.get("topic");
  var QS = topicFilter ? ALL.filter(function(q){ return q.topic === topicFilter; }) : ALL;
  var mount = document.getElementById("quiz");
  if(!QS.length){ mount.innerHTML = "<p>No questions available for this selection.</p>"; return; }
  var state = QS.map(function(){ return {picked:null, locked:false, flagged:false}; });
  var cur = 0, finished = false, timerId = null;
  var examLeft = QS.length * 60;
  var startedAt = new Date().toISOString();

  function el(tag, cls, htmlStr){ var d=document.createElement(tag); if(cls)d.className=cls; if(htmlStr!=null)d.innerHTML=htmlStr; return d; }
  function answered(){ return state.filter(function(s){ return s.picked!==null || s.locked; }).length; }
  function gradeable(q){ return q.options.length>0 && q.answer; }

  function render(){
    if(finished) return renderResults();
    var q = QS[cur], st = state[cur];
    mount.innerHTML = "";
    var head = el("div","quiz-head");
    head.appendChild(el("div","progress","Question "+(cur+1)+" of "+QS.length+" · "+answered()+" answered"));
    if(MODE==="exam"){
      var t = el("div","timer"+(examLeft<=10?" low":""), fmt(examLeft));
      t.id = "timer"; head.appendChild(t);
    }
    mount.appendChild(head);

    var dots = el("div","dots");
    QS.forEach(function(_,i){
      var b = el("button",null,String(i+1));
      if(i===cur) b.classList.add("cur");
      if(state[i].picked!==null||state[i].locked) b.classList.add("done");
      if(state[i].flagged) b.classList.add("flagged");
      b.onclick = function(){ go(i); };
      dots.appendChild(b);
    });
    mount.appendChild(dots);

    var card = el("div","qcard");
    if(q.topic) card.appendChild(el("div","qtopic",q.topic));
    card.appendChild(el("div","stem",q.stem));
    if(q.options.length){
      q.options.forEach(function(opt,i){
        var letter = "ABCDEF"[i];
        var b = el("button","opt","<strong>"+letter+".</strong> "+opt);
        var showFb = MODE==="practice" && st.locked;
        if(st.picked===letter) b.classList.add("sel");
        if(showFb && gradeable(q)){
          // the good/bad tints are reinforced with a word, so the result is not
          // carried by colour alone
          if(letter===q.answer){ b.classList.add("good"); b.appendChild(el("span","opt-tag","Correct answer")); }
          else if(st.picked===letter){ b.classList.add("bad"); b.appendChild(el("span","opt-tag","Your answer")); }
        }
        if(st.locked) b.disabled = true;
        b.onclick = function(){ if(!st.locked){ st.picked = (st.picked===letter && MODE==="exam") ? null : letter; render(); } };
        card.appendChild(b);
      });
    } else {
      card.appendChild(el("p","qmeta","Open question. Formulate your answer, then reveal."));
      if(st.locked && q.answerText) card.appendChild(el("p","expl","<strong>Answer:</strong> "+q.answerText));
    }
    if(MODE==="practice" && st.locked){
      if(gradeable(q)){
        var verdict = el("p","qverdict "+(st.picked===q.answer?"ok":"no"),
          st.picked===q.answer ? "Correct." : "Incorrect — the answer is "+q.answer+".");
        verdict.setAttribute("role","status");
        verdict.setAttribute("aria-live","polite");
        card.appendChild(verdict);
      }
      if(gradeable(q) && q.answerText) card.appendChild(el("p","qmeta","<strong>Why:</strong> "+q.answerText));
      if(!gradeable(q) && q.options.length) card.appendChild(el("p","qmeta","Answer key pending for this question; check it against the source below."));
      card.appendChild(el("p","qmeta",q.source));
    }
    mount.appendChild(card);

    var nav = el("div","quiz-nav");
    var flag = el("button","btn ghost flag-btn"+(st.flagged?" on":""), st.flagged?"Flagged":"Flag");
    flag.onclick = function(){ st.flagged = !st.flagged; render(); };
    nav.appendChild(flag);
    if(MODE==="practice" && !st.locked){
      var sub = el("button","btn tint","Check answer");
      sub.onclick = function(){ st.locked = true; render(); };
      nav.appendChild(sub);
    }
    nav.appendChild(el("div","spacer"));
    if(cur>0){ var prev = el("button","btn ghost","Previous"); prev.onclick=function(){ go(cur-1); }; nav.appendChild(prev); }
    if(cur<QS.length-1){ var next = el("button","btn tint","Next"); next.onclick=function(){ go(cur+1); }; nav.appendChild(next); }
    var fin = el("button","btn fill", MODE==="exam" ? "Submit exam" : "Submit all");
    // Submitting ends the paper and scores every unanswered question wrong, so
    // confirm when questions are still blank. Running out of time still calls
    // finish() directly -- there is nothing left to confirm at that point.
    fin.onclick = function(){
      var blank = 0;
      for(var i=0;i<QS.length;i++){ if(state[i].picked===null) blank++; }
      if(blank && !confirm(blank===1
            ? "1 question is still unanswered and will be marked wrong. Submit anyway?"
            : blank+" questions are still unanswered and will be marked wrong. Submit anyway?")) return;
      finish();
    };
    nav.appendChild(fin);
    mount.appendChild(nav);
  }

  function fmt(s){ return Math.floor(s/60)+":"+String(s%60).padStart(2,"0"); }
  function go(i){ cur = i; render(); }

  function tick(){
    if(finished || MODE!=="exam") return;
    examLeft--;
    var t = document.getElementById("timer");
    if(t){ t.textContent = fmt(Math.max(examLeft,0)); t.classList.toggle("low", examLeft<=10); }
    if(examLeft<=0) finish();
  }

  function finish(){
    finished = true;
    if(timerId) clearInterval(timerId);
    if(window.OS && OS.recordAttempt){
      OS.recordAttempt({
        category_slug: window.QUIZ_CATEGORY, mode: MODE, topic_filter: topicFilter || null,
        started_at: startedAt, completed_at: new Date().toISOString(),
        answers: QS.map(function(q,i){
          return {question_id:q.id, topic:q.topic, picked:state[i].picked, correct:q.answer||null, flagged:state[i].flagged};
        })
      });
    }
    renderResults();
    window.scrollTo({top:0});
  }

  function renderResults(){
    mount.innerHTML = "";
    var g = 0, ok = 0;
    QS.forEach(function(q,i){
      if(gradeable(q)){ g++; if(state[i].picked===q.answer) ok++; }
    });
    var sum = el("div","result-sum");
    sum.appendChild(el("div","score", g ? ok+" / "+g : "Review"));
    sum.appendChild(el("div",null, g ? "correct of "+g+" scored questions"+(QS.length>g ? " ("+(QS.length-g)+" self-check)" : "") : "Self-check review"));
    mount.appendChild(sum);
    QS.forEach(function(q,i){
      var st = state[i], cls = "result-q", pill;
      if(gradeable(q)){
        if(st.picked===q.answer){ cls+=" ok"; pill='<span class="pill ok">Correct</span>'; }
        else if(st.picked){ cls+=" wrong"; pill='<span class="pill wrong">Incorrect</span>'; }
        else { pill='<span class="pill skip">Unanswered</span>'; }
      } else pill='<span class="pill skip">Self-check</span>';
      var d = el("div",cls, pill + '<div class="stem"><strong>Q'+(i+1)+'.</strong> '+q.stem+"</div>");
      q.options.forEach(function(opt,oi){
        var letter = "ABCDEF"[oi];
        var b = el("div","opt","<strong>"+letter+".</strong> "+opt);
        if(q.answer===letter) b.classList.add("good");
        else if(st.picked===letter) b.classList.add("bad");
        d.appendChild(b);
      });
      if(q.answerText) d.appendChild(el("div","expl","<strong>Why:</strong> "+q.answerText));
      d.appendChild(el("div","expl",q.source));
      mount.appendChild(d);
    });
    var back = el("div","quiz-nav");
    var again = el("button","btn tint","Try again");
    again.onclick = function(){ location.reload(); };
    back.appendChild(again);
    mount.appendChild(back);
  }

  render();
  if(MODE==="exam") timerId = setInterval(tick, 1000);
})();
