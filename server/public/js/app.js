(function () {
  const form = document.getElementById("login_form");
  if (!form) return;

  const adminToggle = document.getElementById("admin-login-toggle");
  const passwordField = document.getElementById("password-field");
  const passwordInput = document.getElementById("password");
  const togglePassword = document.getElementById("togglePassword");
  const submitBtn = document.getElementById("submitBtn");
  const msg = document.getElementById("formMessage");

  function setMessage(text, type) {
    if (!msg) return;
    msg.textContent = text || "";
    msg.style.color = type === "error" ? "#fca5a5" : type === "success" ? "#86efac" : "#9ca3af";
  }

  if (togglePassword && passwordInput) {
    togglePassword.addEventListener("click", function () {
      const nextType = passwordInput.type === "password" ? "text" : "password";
      passwordInput.type = nextType;
      togglePassword.textContent = nextType === "password" ? "Show" : "Hide";
    });
  }

  function syncAdminMode() {
    const isAdmin = !!(adminToggle && adminToggle.checked);
    if (!passwordField || !passwordInput) return;

    if (isAdmin) {
      passwordField.style.display = "none";
      passwordInput.required = false;
      passwordInput.value = "";
    } else {
      passwordField.style.display = "";
      passwordInput.required = true;
    }
  }

  if (adminToggle) adminToggle.addEventListener("change", syncAdminMode);
  syncAdminMode();

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    setMessage("", "muted");

    const data = new FormData(form);
    const payload = Object.fromEntries(data.entries());
    const isAdmin = !!(adminToggle && adminToggle.checked);
    if (isAdmin) payload.adminlogin = "1";

    const original = submitBtn ? submitBtn.textContent : "";
    if (submitBtn) {
      submitBtn.textContent = "Signing In...";
      submitBtn.disabled = true;
    }

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));

      if (res.ok && json && json.success) {
        setMessage("Login successful. Redirecting…", "success");
        const frontend = (window.__FRONTEND_URL__ || "").trim();
        if (frontend) {
          window.location.href = frontend.replace(/\/+$/, "") + "/";
        } else {
          window.location.href = "/dashboard";
        }
        return;
      }

      setMessage(json.message || "Login failed.", "error");
    } catch (err) {
      setMessage("Login error. Please try again.", "error");
    } finally {
      if (submitBtn) {
        submitBtn.textContent = original || "Sign In";
        submitBtn.disabled = false;
      }
    }
  });
})();

