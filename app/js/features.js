// Feature gating for in-flight (beta) work. Soft, client-side: this controls what's
// shown by default, not security — the code still ships to everyone. Gate a feature
// with isOn("flagName", state); flags + the allowlist live in config.js.
import { BETA_TESTERS, FEATURES } from "./config.js";

const BETA_OPTIN_KEY = "lagoon.betaOptIn"; // set by a future Settings toggle (not built yet)

function inAllowlist(state) {
  const id = state && state.me && state.me.id;
  return id != null && BETA_TESTERS.includes(id);
}
function optedIn() {
  try { return localStorage.getItem(BETA_OPTIN_KEY) === "1"; } catch { return false; }
}

// Whether an audience tier is allowed for this user. Exported for testing.
export function tierAllows(tier, state) {
  switch (tier) {
    case "on": return true;
    case "internal": return inAllowlist(state);
    case "beta": return inAllowlist(state) || optedIn();
    default: return false; // "off", undefined, or unknown → safe default
  }
}

// Is a given feature flag enabled for this user?
export function isOn(flag, state) {
  return tierAllows(FEATURES[flag], state);
}

// Does this user have beta access at all? (allowlist now; + opt-in once that ships)
export function isBetaUser(state) {
  return inAllowlist(state) || optedIn();
}
