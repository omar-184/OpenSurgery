
(function(){
  window.OS = window.OS || {};
  var API = window.OS_API_BASE || "";
  var root = document.body.dataset.root || "";

  function req(path, opts){
    opts = opts || {};
    var headers = {};
    for(var k in (opts.headers||{})) headers[k] = opts.headers[k];
    if(opts.method && opts.method !== "GET") headers["X-Requested-With"] = "XMLHttpRequest";
    if(opts.body) headers["Content-Type"] = "application/json";
    var final = {credentials:"include"};
    for(var k2 in opts) final[k2] = opts[k2];
    final.headers = headers;
    return fetch(API + path, final);
  }
  OS.req = req;
  OS.apiConfigured = !!API;

  function showToast(msg){
    var t = document.getElementById("os-toast");
    if(!t){ t = document.createElement("div"); t.id = "os-toast"; t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(function(){ t.classList.remove("show"); }, 3200);
  }
  OS.showToast = showToast;

  function pending(){
    try{ return JSON.parse(localStorage.getItem("os-pending-progress") || "null") || {topic_reads:[], quiz_attempts:[], annotations:[]}; }
    catch(e){ return {topic_reads:[], quiz_attempts:[], annotations:[]}; }
  }
  function savePending(p){ try{ localStorage.setItem("os-pending-progress", JSON.stringify(p)); }catch(e){} }
  OS.pending = pending;
  OS.savePending = savePending;

  OS.claimLocalProgress = function(){
    var p = pending();
    if(!p.topic_reads.length && !p.quiz_attempts.length && !(p.annotations||[]).length) return Promise.resolve();
    return req("/api/progress/import", {method:"POST", body: JSON.stringify(p)}).then(function(r){
      if(r.ok){ localStorage.removeItem("os-pending-progress"); showToast("Your earlier progress on this device was saved."); }
    }).catch(function(){});
  };

  var mePromise = API ? req("/api/auth/me").then(function(r){ return r.ok ? r.json() : null; }).catch(function(){ return null; })
                       : Promise.resolve(null);
  OS.user = mePromise;

  function initials(name){
    var parts = (name||"").trim().split(/\s+/).filter(Boolean);
    if(!parts.length) return "?";
    return (parts[0].charAt(0) + (parts.length>1 ? parts[parts.length-1].charAt(0) : "")).toUpperCase();
  }

  function renderAuthArea(user){
    var area = document.getElementById("auth-area");
    if(!area) return;
    if(!user){
      var a = document.createElement("a");
      a.className = "auth-login-link"; a.href = root + "login.html"; a.textContent = "Log in";
      area.innerHTML = ""; area.appendChild(a);
      return;
    }
    area.innerHTML =
      '<div class="profile">'+
        '<button type="button" class="avatar-btn" id="avatar-btn"></button>'+
        '<div class="profile-menu" id="profile-menu">'+
          '<div class="who"><div class="name"></div><div class="role"></div></div>'+
          '<div class="items">'+
            '<a href="'+root+'dashboard.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>Dashboard</a>'+
            '<a href="'+root+'settings.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>Profile Settings</a>'+
          '</div>'+
          '<div class="logout-item"><button type="button" class="menu-item" id="logout-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>Log out</button></div>'+
        '</div>'+
      '</div>';
    area.querySelector("#avatar-btn").textContent = initials(user.display_name);
    area.querySelector(".who .name").textContent = user.display_name;
    area.querySelector(".who .role").textContent = user.email || (user.auth_provider === "google" ? "Signed in with Google" : "");

    var menu = document.getElementById("profile-menu"), btn = document.getElementById("avatar-btn");
    btn.addEventListener("click", function(e){ e.stopPropagation(); menu.classList.toggle("open"); });
    document.addEventListener("click", function(e){ if(!menu.contains(e.target) && e.target!==btn) menu.classList.remove("open"); });
    document.getElementById("logout-btn").addEventListener("click", function(){
      req("/api/auth/logout", {method:"POST"}).then(function(){ location.reload(); });
    });
  }

  mePromise.then(function(user){ renderAuthArea(user); if(user) OS.claimLocalProgress(); });
})();
