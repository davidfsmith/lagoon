// Light/dark theme. Modes: "system" (follow OS, default), "light", "dark".
// CSS does the actual theming via :root / :root.light / prefers-color-scheme;
// here we just set the documentElement class and persist the choice.
const KEY = "lagoon.theme";

export function getTheme() {
  return localStorage.getItem(KEY) || "system";
}

export function setTheme(mode) {
  if (mode === "system") localStorage.removeItem(KEY);
  else localStorage.setItem(KEY, mode);
  apply();
}

export function apply() {
  const mode = getTheme();
  const el = document.documentElement;
  el.classList.toggle("light", mode === "light");
  el.classList.toggle("dark", mode === "dark");
  // Match the mobile status-bar colour to the active background.
  const bg = getComputedStyle(document.body).backgroundColor;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && bg) meta.setAttribute("content", bg);
}
