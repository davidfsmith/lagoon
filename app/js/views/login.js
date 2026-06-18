import { login } from "../api.js";
import { setToken } from "../store.js";

export function renderLogin(view, onLoggedIn) {
  view.innerHTML = `
    <h2>Sign in</h2>
    <p class="muted">Your Lagoon account. Only a token is stored on this device.</p>
    <input id="email" type="email" placeholder="Email" autocomplete="username">
    <input id="password" type="password" placeholder="Password" autocomplete="current-password">
    <button class="primary" id="signin">Sign in</button>
    <p id="err" class="err"></p>`;
  const err = view.querySelector("#err");
  view.querySelector("#signin").addEventListener("click", async () => {
    err.textContent = "";
    const email = view.querySelector("#email").value.trim();
    const password = view.querySelector("#password").value;
    if (!email || !password) { err.textContent = "Enter email and password."; return; }
    try {
      const token = await login(email, password);
      setToken(token);
      await onLoggedIn();
    } catch (e) { err.textContent = "Sign-in failed. Check your details."; }
  });
}
