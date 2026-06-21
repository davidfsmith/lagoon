import { login } from "../api.js";
import { setToken } from "../store.js";
import { BOOKING_SITE } from "../config.js";

export function renderLogin(view, onLoggedIn) {
  view.innerHTML = `
    <h2>Sign in</h2>
    <p class="muted">Use your existing <b>Lagoon Watersports</b> account — the same
      email &amp; password you use to book sessions online. We only store an access
      token on this device, never your password.</p>
    <input id="email" type="email" placeholder="Email" autocomplete="username">
    <input id="password" type="password" placeholder="Password" autocomplete="current-password">
    <button class="primary" id="signin">Sign in</button>
    <p id="err" class="err"></p>
    <p class="signup">Don't have a Lagoon account?
      <a href="${BOOKING_SITE}" target="_blank" rel="noopener">Create one on the Lagoon booking site ↗</a></p>`;
  injectLoginStyles();
  const err = view.querySelector("#err");
  const btn = view.querySelector("#signin");
  btn.addEventListener("click", async () => {
    err.textContent = "";
    const email = view.querySelector("#email").value.trim();
    const password = view.querySelector("#password").value;
    if (!email || !password) { err.textContent = "Enter email and password."; return; }
    btn.disabled = true; btn.textContent = "Signing in…"; // show the click registered
    try {
      const token = await login(email, password);
      setToken(token);
      await onLoggedIn(); // navigates away on success
    } catch (e) {
      err.textContent = "Sign-in failed. Check your details.";
      btn.disabled = false; btn.textContent = "Sign in";
    }
  });
}

function injectLoginStyles() {
  if (document.getElementById("login-css")) return;
  const s = document.createElement("style"); s.id = "login-css";
  s.textContent = `
    .signup{margin-top:18px;font-size:13px;color:var(--muted)}
    .signup a{color:var(--accent);text-decoration:none;font-weight:600}`;
  document.head.appendChild(s);
}
