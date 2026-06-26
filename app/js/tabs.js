// Shared underline tab bar, used by the Settings and Bookings pages so they match.
// tabs: [{ id, label }]. Render the bar with tabBarHtml(tabs, activeId), then wire
// clicks on `.tab` (data-tab) in the view to switch + re-render.
export function tabBarHtml(tabs, activeId) {
  return `<div class="tabbar">` + tabs.map(t =>
    `<button class="tab${t.id === activeId ? " active" : ""}" data-tab="${t.id}">${t.label}</button>`
  ).join("") + `</div>`;
}

export function injectTabStyles() {
  if (document.getElementById("tab-css")) return;
  const s = document.createElement("style"); s.id = "tab-css";
  s.textContent = `
    .tabbar{display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:16px}
    .tab{flex:1;background:none;border:none;border-bottom:2px solid transparent;color:var(--muted);
      padding:10px;font-size:14px;cursor:pointer;margin-bottom:-1px}
    .tab.active{color:var(--accent);border-bottom-color:var(--accent);font-weight:600}`;
  document.head.appendChild(s);
}
