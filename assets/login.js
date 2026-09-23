
(function(){
  function ready(fn){ if(document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  ready(function(){
    var next = new URLSearchParams(location.search).get("next") || "";
    // A relative path inside the site only: no scheme, no host, no leading slash.
    if(!/^[A-Za-z0-9_-][A-Za-z0-9_.\/-]*(\?[^#]*)?(#.*)?$/.test(next) || next.indexOf("//") >= 0) next = "index.html";
    var errBox = document.getElementById("auth-error");
    function showErr(msg){ errBox.textContent = msg; errBox.classList.add("show"); }
    function clearErr(){ errBox.textContent = ""; errBox.classList.remove("show"); }

    OS.user.then(function(user){ if(user) location.href = next; });

    function afterAuth(){
      OS.claimLocalProgress().then(function(){ location.href = next; });
    }

    var showSignupBtn = document.getElementById("show-signup");
    var showLoginBtn = document.getElementById("show-login-btn");
    var showLoginLink = document.getElementById("show-login");
    var signupPanel = document.getElementById("signup-panel");
    // One form serves both modes. Fields that are hidden must also stop being
    // required, or the browser silently refuses to submit the log-in form.
    function setMode(mode){
      var reg = mode === "register";
      signupPanel.dataset.mode = mode;
      signupPanel.style.display = "block";
      document.getElementById("name-field").style.display = reg ? "block" : "none";
      document.getElementById("confirm-field").style.display = reg ? "block" : "none";
      document.getElementById("name-input").required = reg;
      document.getElementById("confirm-input").required = reg;
      document.getElementById("password-input").autocomplete = reg ? "new-password" : "current-password";
      document.getElementById("signup-submit").textContent = reg ? "Create account" : "Log in";
      document.getElementById("signup-title").textContent = reg ? "Create account" : "Log in";
      showLoginLink.textContent = reg ? "Already have an account? Log in" : "New here? Create an account";
      clearErr();
      signupPanel.scrollIntoView({behavior:"smooth", block:"nearest"});
      document.getElementById(reg ? "name-input" : "email-input").focus({preventScroll:true});
    }
    if(showSignupBtn) showSignupBtn.addEventListener("click", function(){ setMode("register"); });
    if(showLoginBtn) showLoginBtn.addEventListener("click", function(){ setMode("login"); });
    if(showLoginLink) showLoginLink.addEventListener("click", function(e){
      e.preventDefault();
      setMode(signupPanel.dataset.mode === "login" ? "register" : "login");
    });

    var form = document.getElementById("signup-form");
    if(form) form.addEventListener("submit", function(e){
      e.preventDefault();
      clearErr();
      var mode = signupPanel.dataset.mode === "login" ? "login" : "register";
      var email = document.getElementById("email-input").value.trim();
      var pw = document.getElementById("password-input").value;
      if(mode === "register"){
        var name = document.getElementById("name-input").value.trim();
        var confirm = document.getElementById("confirm-input").value;
        if(pw.length < 8) return showErr("Password must be at least 8 characters.");
        if(pw !== confirm) return showErr("Passwords don't match.");
        OS.req("/api/auth/register", {method:"POST", body: JSON.stringify({email:email, password:pw, display_name:name})})
          .then(function(r){ if(r.ok) return afterAuth(); return r.json().then(function(d){ showErr(d.detail || "Could not create account."); }); })
          .catch(function(){ showErr("Network error — is the API reachable?"); });
      } else {
        OS.req("/api/auth/login", {method:"POST", body: JSON.stringify({email:email, password:pw})})
          .then(function(r){ if(r.ok) return afterAuth(); return r.json().then(function(d){ showErr(d.detail || "Incorrect email or password."); }); })
          .catch(function(){ showErr("Network error — is the API reachable?"); });
      }
    });

    var gClientId = window.OS_GOOGLE_CLIENT_ID;
    var gBtn = document.getElementById("google-btn");
    var gInitialized = false;
    function ensureGoogleInit(){
      if(gInitialized || !window.google || !google.accounts || !google.accounts.id) return gInitialized;
      google.accounts.id.initialize({
        client_id: gClientId,
        callback: function(resp){
          OS.req("/api/auth/google", {method:"POST", body: JSON.stringify({id_token: resp.credential})})
            .then(function(r){ if(r.ok) return afterAuth(); return r.json().then(function(d){ showErr(d.detail || "Google sign-in failed."); }); })
            .catch(function(){ showErr("Network error — is the API reachable?"); });
        }
      });
      gInitialized = true;
      return true;
    }
    // Google's own rendered button, not the One Tap prompt: One Tap goes quiet
    // for hours once someone dismisses it, which left our button doing nothing.
    var gSlot = document.getElementById("google-slot");
    function renderGoogle(){
      if(!gSlot || !ensureGoogleInit()) return false;
      if(gSlot.dataset.done) return true;
      gSlot.classList.add("ready");
      gBtn.style.display = "none";
      var w = Math.floor(gSlot.getBoundingClientRect().width || 320);
      var dark = document.documentElement.getAttribute("data-theme") !== "light";
      google.accounts.id.renderButton(gSlot, {type:"standard", size:"large", shape:"pill", text:"continue_with",
        logo_alignment:"center", locale:"en", theme: dark ? "filled_black" : "outline",
        width: Math.max(200, Math.min(400, w))});
      gSlot.dataset.done = "1";
      return true;
    }
    if(gBtn && gClientId){
      if(!renderGoogle()){
        var tries = 0, iv = setInterval(function(){ if(renderGoogle() || ++tries > 60) clearInterval(iv); }, 250);
      }
      gBtn.addEventListener("click", function(){
        if(!renderGoogle()) showErr("Google sign-in is still loading. If this persists, a browser extension may be blocking accounts.google.com.");
      });
    } else if(gBtn){
      gBtn.addEventListener("click", function(){ showErr("Google sign-in isn't configured yet."); });
    }
  });
})();
