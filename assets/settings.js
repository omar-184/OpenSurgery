
(function(){
  function ready(fn){ if(document.readyState !== "loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  ready(function(){
    OS.user.then(function(user){
      if(!user){
        location.href = (document.body.dataset.root || "") + "login.html?next=settings.html";
        return;
      }
      document.getElementById("settings-email").textContent = user.email || "";
      document.getElementById("name-input").value = user.display_name;
      if(user.auth_provider === "google"){
        document.getElementById("password-section").style.display = "none";
        document.getElementById("google-note").style.display = "block";
      }
    });

    var nameErr = document.getElementById("name-error");
    document.getElementById("name-form").addEventListener("submit", function(e){
      e.preventDefault();
      nameErr.classList.remove("show");
      var name = document.getElementById("name-input").value.trim();
      if(!name){ nameErr.textContent = "Display name can't be empty."; nameErr.classList.add("show"); return; }
      OS.req("/api/auth/me", {method:"PATCH", body: JSON.stringify({display_name: name})}).then(function(r){
        if(r.ok){ OS.showToast("Display name updated."); return; }
        return r.json().then(function(d){ nameErr.textContent = d.detail || "Could not update."; nameErr.classList.add("show"); });
      });
    });

    var pwErr = document.getElementById("password-error");
    var pwForm = document.getElementById("password-form");
    if(pwForm) pwForm.addEventListener("submit", function(e){
      e.preventDefault();
      pwErr.classList.remove("show");
      var cur = document.getElementById("current-password-input").value;
      var next = document.getElementById("new-password-input").value;
      var confirm = document.getElementById("confirm-password-input").value;
      if(next.length < 8){ pwErr.textContent = "New password must be at least 8 characters."; pwErr.classList.add("show"); return; }
      if(next !== confirm){ pwErr.textContent = "Passwords don't match."; pwErr.classList.add("show"); return; }
      OS.req("/api/auth/change-password", {method:"POST", body: JSON.stringify({current_password: cur, new_password: next})}).then(function(r){
        if(r.ok){ OS.showToast("Password changed."); pwForm.reset(); return; }
        return r.json().then(function(d){ pwErr.textContent = d.detail || "Could not change password."; pwErr.classList.add("show"); });
      });
    });
  });
})();
