
(function(){
  var root = document.body.dataset.root || "";
  var idx = null, palette, input, results, sel = -1;
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
    var hits = !q ? idx.slice(0,12) : idx.filter(function(t){ return t.title.toLowerCase().indexOf(q)>=0 || t.cat.toLowerCase().indexOf(q)>=0; }).slice(0,14);
    results.innerHTML = hits.map(function(t){ return '<a href="'+root+t.url+'">'+t.title+'<small>'+t.cat+'</small></a>'; }).join("");
  }
  function open(){
    if(!palette) build();
    if(!idx){ fetch(root+"assets/search.json").then(function(r){return r.json();}).then(function(d){ idx=d; render(); }); }
    else render();
    palette.classList.add("open"); input.value=""; input.focus();
  }
  function close(){ palette.classList.remove("open"); }
  document.addEventListener("keydown", function(e){
    if((e.metaKey||e.ctrlKey) && e.key.toLowerCase()==="k"){ e.preventDefault(); palette && palette.classList.contains("open") ? close() : open(); }
  });
  var trigger = document.getElementById("search-trigger");
  if(trigger) trigger.addEventListener("click", function(e){ e.preventDefault(); open(); });
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
})();
