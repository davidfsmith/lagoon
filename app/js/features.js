// Feature gating for in-flight work. Soft, client-side: this controls what's shown by
// default, not security — the code still ships to everyone. Gate a feature with
// isOn("flagName"); flags live in config.js. Two opt-in levels (both localStorage):
//   internal = developer opt-in (hidden, version-tap) — features mid-build
//   beta     = public opt-in (Settings toggle) — features that work but aren't GA
// internal sees everything beta does.
import { FEATURES } from "./config.js";
import { getBetaOptIn, getInternalOptIn } from "./store.js";

// Whether an audience tier is allowed for this user. Exported for testing.
export function tierAllows(tier) {
  switch (tier) {
    case "on": return true;
    case "beta": return getBetaOptIn() || getInternalOptIn();
    case "internal": return getInternalOptIn();
    default: return false; // "off", undefined, or unknown → safe default
  }
}

// Is a given feature flag enabled for this user?
export function isOn(flag) {
  return tierAllows(FEATURES[flag]);
}

// Does this user have any beta access at all?
export function isBetaUser() {
  return getBetaOptIn() || getInternalOptIn();
}

// Highest active level, for the badge: "internal" | "beta" | null.
export function accessTier() {
  if (getInternalOptIn()) return "internal";
  if (getBetaOptIn()) return "beta";
  return null;
}
