/**
 * Kul-Kirti — admin-login.js
 * Externalized from admin-login.html so the page works under a strict CSP
 * (no inline script execution). Also validates the `?next` redirect target.
 */
(function initAdminLogin() {
  const form     = document.getElementById("admin-login-form");
  const errorEl  = document.getElementById("login-error");
  const loginBtn = document.getElementById("login-btn");
  if (!form || !errorEl || !loginBtn) return;
  let busy = false;

  /* Only same-origin relative paths starting with a single "/" are allowed.
     Rejects //evil.com, https://evil.com, backslash tricks and javascript:. */
  function safeDestination(raw) {
    if (!raw || typeof raw !== "string") return "/admin.html";
    if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/admin.html";
    try {
      const url = new URL(raw, location.origin);
      if (url.origin !== location.origin) return "/admin.html";
      return url.pathname + url.search + url.hash;
    } catch (_) {
      return "/admin.html";
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    loginBtn.disabled = true;
    loginBtn.innerHTML = "लोड हो रहा है...";
    errorEl.classList.remove("show");

    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email:    document.getElementById("admin-email").value,
          password: document.getElementById("admin-password").value,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        errorEl.textContent = data.error || "Login failed.";
        errorEl.classList.add("show");
        return;
      }
      const dest = safeDestination(new URLSearchParams(location.search).get("next"));
      window.location.assign(dest);
    } catch (_) {
      errorEl.textContent = "Network error — please try again.";
      errorEl.classList.add("show");
    } finally {
      busy = false;
      loginBtn.disabled = false;
      loginBtn.innerHTML = "Login <span>→</span>";
    }
  });
}());
