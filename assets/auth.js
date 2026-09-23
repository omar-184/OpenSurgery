
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

  // ---- academic profile ----
  OS.LEVELS = [
    {id:"student", name:"Medical student", desc:"A short summary of each topic, written for finals."},
    {id:"resident", name:"Resident / trainee", desc:"The full cited textbook article."},
    {id:"consultant", name:"Consultant", desc:"The full article with NICE and UK guidance woven through it."}
  ];
  OS.levelName = function(id){
    for(var i=0;i<OS.LEVELS.length;i++) if(OS.LEVELS[i].id === id) return OS.LEVELS[i].name;
    return "";
  };
  function escHtml(t){ return String(t).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
  OS.levelPickerHtml = function(name, selected){
    return OS.LEVELS.map(function(l){
      return '<label class="level-opt"><input type="radio" name="'+name+'" value="'+l.id+'"'+(l.id===selected?" checked":"")+'>'+
        '<span class="lv-name">'+escHtml(l.name)+'</span><span class="lv-desc">'+escHtml(l.desc)+'</span></label>';
    }).join("");
  };
  // ISO 3166-1 alpha-2, plus XK. Names come from the browser, so there is
  // no list of country names to maintain here.
  var COUNTRY_CODES = ("AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ "+
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR "+
    "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP "+
    "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT "+
    "MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW "+
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG "+
    "UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW").split(" ");
  var regionNames = null;
  try{ regionNames = new Intl.DisplayNames(["en"], {type:"region"}); }catch(e){}
  OS.countryName = function(code){
    if(!code) return "";
    try{ return (regionNames && regionNames.of(code)) || code; }catch(e){ return code; }
  };
  OS.countryOptions = function(selected){
    return COUNTRY_CODES.map(function(c){ return [c, OS.countryName(c)]; })
      .sort(function(a,b){ return a[1].localeCompare(b[1]); })
      .map(function(p){ return '<option value="'+p[0]+'"'+(p[0]===selected?" selected":"")+'>'+escHtml(p[1])+'</option>'; })
      .join("");
  };

  // ---- sign-in wall ----
  // Every page except home, about, login and 404 needs an account. This is a
  // client-side wall on a static site: it steers people to sign in, it does
  // not hide the HTML from anyone who reads the source.
  var de = document.documentElement;
  var access = de.getAttribute("data-access") || "public";
  var offline = false;
  function cachedSignedIn(){ try{ return !!localStorage.getItem("os-signed-in"); }catch(e){ return false; } }
  function hereFromRoot(){
    var depth = (root.match(/\.\.\//g) || []).length;
    return location.pathname.split("/").slice(-(depth + 1)).join("/") + location.search + location.hash;
  }
  OS.applyUser = function(user){
    try{
      if(user){
        localStorage.setItem("os-signed-in", "1");
        if(user.academic_level) localStorage.setItem("os-level", user.academic_level);
        else localStorage.removeItem("os-level");
        // Just what the header menu shows, so it can be drawn before the API answers.
        localStorage.setItem("os-user", JSON.stringify({display_name: user.display_name, email: user.email,
          auth_provider: user.auth_provider, role: user.role, academic_level: user.academic_level, country: user.country}));
      } else {
        localStorage.removeItem("os-signed-in"); localStorage.removeItem("os-level"); localStorage.removeItem("os-user");
      }
    }catch(e){}
    if(user && user.academic_level) de.setAttribute("data-level", user.academic_level);
    else de.removeAttribute("data-level");
  };
  // Someone who has never signed in on this device cannot be let in by the
  // server's answer (the login page picks up a live session if there is one),
  // so send them straight to it instead of waiting on a sleeping API.
  var gated = access !== "public" && access !== "login";
  if(gated && API && !cachedSignedIn()){
    location.replace(root + "login.html?next=" + encodeURIComponent(hereFromRoot()));
  }
  // The API sleeps when idle (Render free plan) and can take a minute to wake.
  // Draw the header from the last known profile now and refresh it when the
  // API answers; signed-out visitors get the "Log in" link at once.
  var cachedUser = null;
  try{ cachedUser = cachedSignedIn() ? JSON.parse(localStorage.getItem("os-user") || "null") : null; }catch(e){}
  if(!cachedSignedIn()) renderAuthArea(null);
  else if(cachedUser) renderAuthArea(cachedUser);
  var slowTimer = setTimeout(function(){ de.classList.add("auth-slow"); }, 4000);
  function unwait(){ clearTimeout(slowTimer); de.classList.remove("auth-wait", "auth-slow", "auth-offline"); }

  var mePromise = API ? req("/api/auth/me").then(function(r){ return r.ok ? r.json() : null; })
                          .catch(function(){ offline = true; return null; })
                       : Promise.resolve(null);
  OS.user = mePromise;

  function showOnboarding(user){
    if(document.querySelector(".onb-back")) return;
    var back = document.createElement("div");
    back.className = "onb-back";
    back.innerHTML =
      '<div class="onb" role="dialog" aria-modal="true" aria-labelledby="onb-title">'+
        '<div class="auth-state-label">One more step</div>'+
        '<h2 id="onb-title">Tell us about your training</h2>'+
        '<p class="onb-sub">Each article is shown at your level. You can change this any time in Profile settings.</p>'+
        '<fieldset class="level-pick"><legend>Academic level</legend>'+
          OS.levelPickerHtml("onb-level", user.academic_level)+'</fieldset>'+
        '<div class="auth-field"><label for="onb-country">Country</label>'+
          '<select id="onb-country"><option value="">Choose your country\u2026</option>'+OS.countryOptions(user.country)+'</select></div>'+
        '<div class="auth-error" id="onb-error"></div>'+
        '<button type="button" class="btn fill" id="onb-save" style="width:100%;margin-top:.6rem">Continue</button>'+
      '</div>';
    document.body.appendChild(back);
    de.classList.add("onb-open");
    var err = back.querySelector("#onb-error");
    var first = back.querySelector("input[type=radio]");
    if(first) first.focus();
    back.querySelector("#onb-save").addEventListener("click", function(){
      var btn = this;
      var picked = back.querySelector('input[name="onb-level"]:checked');
      var country = back.querySelector("#onb-country").value;
      err.classList.remove("show");
      if(!picked || !country){ err.textContent = "Please choose your level and your country."; err.classList.add("show"); return; }
      btn.disabled = true;
      req("/api/auth/me", {method:"PATCH", body: JSON.stringify({academic_level: picked.value, country: country})})
        .then(function(r){ return r.ok ? r.json() : r.json().then(function(d){ throw new Error(typeof d.detail === "string" ? d.detail : "Could not save."); }); })
        .then(function(updated){
          OS.applyUser(updated);
          renderAuthArea(updated);
          back.remove(); de.classList.remove("onb-open");
          showToast("Saved. You're reading as: " + OS.levelName(updated.academic_level) + ".");
        })
        .catch(function(e){ btn.disabled = false; err.textContent = (e && e.message) || "Network error, try again."; err.classList.add("show"); });
    });
  }
  OS.showOnboarding = showOnboarding;
  OS.renderAuthArea = function(u){ renderAuthArea(u); };

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
          '<div class="who"><div class="name"></div><div class="role"></div><div class="lvl"></div></div>'+
          '<div class="items">'+
            '<a href="'+root+'dashboard.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>Dashboard</a>'+
            '<a href="'+root+'settings.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>Profile Settings</a>'+
          ((user.role === "admin" || user.role === "editor") ? '<a href="'+root+'admin.html"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>Edit site content</a>' : '')+
          '</div>'+
          '<div class="logout-item"><button type="button" class="menu-item" id="logout-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>Log out</button></div>'+
        '</div>'+
      '</div>';
    area.querySelector("#avatar-btn").textContent = initials(user.display_name);
    area.querySelector(".who .name").textContent = user.display_name;
    area.querySelector(".who .role").textContent = user.email || (user.auth_provider === "google" ? "Signed in with Google" : "");
    area.querySelector(".who .lvl").textContent =
      [OS.levelName(user.academic_level), OS.countryName(user.country)].filter(Boolean).join(" \u00b7 ");

    var menu = document.getElementById("profile-menu"), btn = document.getElementById("avatar-btn");
    btn.addEventListener("click", function(e){ e.stopPropagation(); menu.classList.toggle("open"); });
    document.addEventListener("click", function(e){ if(!menu.contains(e.target) && e.target!==btn) menu.classList.remove("open"); });
    document.getElementById("logout-btn").addEventListener("click", function(){
      req("/api/auth/logout", {method:"POST"}).then(function(){ OS.applyUser(null); location.reload(); });
    });
  }

  mePromise.then(function(user){
    if(user || !offline || !cachedUser) renderAuthArea(user);
    if(!user){
      if(offline){
        // The API is down or asleep, which is not a signed-out answer: someone
        // who was signed in keeps reading rather than being bounced.
        if(cachedSignedIn() || access === "public" || access === "login") unwait();
        else { clearTimeout(slowTimer); de.classList.add("auth-offline"); }
        return;
      }
      OS.applyUser(null);
      if(access !== "public" && access !== "login"){
        location.replace(root + "login.html?next=" + encodeURIComponent(hereFromRoot()));
        return;
      }
      unwait();
      return;
    }
    OS.applyUser(user);
    unwait();
    OS.claimLocalProgress();
    if((!user.academic_level || !user.country) && access !== "login") showOnboarding(user);
  });
})();
