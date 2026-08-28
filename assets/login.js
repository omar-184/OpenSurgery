
(function(){
  function ready(fn){ if(document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  ready(function(){
    var next = new URLSearchParams(location.search).get("next") || (document.body.dataset.root || "") + "index.html";
    var errBox = document.getElementById("auth-error");
    function showErr(msg){ errBox.textContent = msg; errBox.classList.add("show"); }
    function clearErr(){ errBox.textContent = ""; errBox.classList.remove("show"); }

    OS.user.then(function(user){ if(user) location.href = next; });

    function afterAuth(){
      OS.claimLocalProgress().then(function(){ location.href = next; });
    }

    var skip = document.getElementById("skip-btn");
    if(skip) skip.addEventListener("click", function(){ location.href = next; });

    var showSignupBtn = document.getElementById("show-signup");
    var showLoginLink = document.getElementById("show-login");
    var signupPanel = document.getElementById("signup-panel");
    if(showSignupBtn) showSignupBtn.addEventListener("click", function(){ signupPanel.style.display = "block"; signupPanel.dataset.mode = "register"; signupPanel.scrollIntoView({behavior:"smooth", block:"nearest"}); });
    if(showLoginLink) showLoginLink.addEventListener("click", function(e){
      e.preventDefault();
      var isRegister = signupPanel.dataset.mode !== "login";
      signupPanel.dataset.mode = isRegister ? "login" : "register";
      document.getElementById("name-field").style.display = isRegister ? "none" : "block";
      document.getElementById("confirm-field").style.display = isRegister ? "none" : "block";
      document.getElementById("signup-submit").textContent = isRegister ? "Log in" : "Create account";
      document.getElementById("signup-title").textContent = isRegister ? "Log in" : "Create account — expanded";
      showLoginLink.textContent = isRegister ? "New here? Create an account" : "Already have an account? Log in";
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
    if(gBtn && gClientId && window.google && google.accounts && google.accounts.id){
      google.accounts.id.initialize({
        client_id: gClientId,
        callback: function(resp){
          OS.req("/api/auth/google", {method:"POST", body: JSON.stringify({id_token: resp.credential})})
            .then(function(r){ if(r.ok) return afterAuth(); return r.json().then(function(d){ showErr(d.detail || "Google sign-in failed."); }); })
            .catch(function(){ showErr("Network error — is the API reachable?"); });
        }
      });
      gBtn.addEventListener("click", function(){ google.accounts.id.prompt(); });
    } else if(gBtn){
      gBtn.addEventListener("click", function(){ showErr("Google sign-in isn't configured yet."); });
    }
  });
})();
