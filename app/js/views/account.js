import { fmtDate } from "./format.js";
import { londonParts } from "../tz.js";
import { logout } from "../app.js";

export function renderAccount(view, state, go) {
  const m = (state.memberships || [])[0];
  const memHtml = m
    ? `<div class="card"><div class="t">Membership</div>
        <div>${(m.membershipType && m.membershipType.name) || "Member"} · <b>${m.status}</b></div>
        <div class="muted small">expires ${m.expiryDate ? fmtDate(m.expiryDate.slice(0,10)) : "—"}</div></div>`
    : `<div class="card muted">No membership found.</div>`;

  const passes = (state.packages || []).filter(p => (p.remainTokens || 0) > 0);
  const passHtml = passes.length
    ? `<div class="card"><div class="t">Ride passes</div>` + passes.map(p =>
        `<div>${(p.package && p.package.title) || "Pass"} — <b>${p.remainTokens}</b>/${p.totalTokens} left</div>`).join("") + `</div>`
    : `<div class="card muted">No ride-pass tokens remaining.</div>`;

  const upcoming = (state.meBookings || [])
    .filter(b => (b.status || "").toLowerCase() === "confirmed" && b.courseRun && new Date(b.courseRun.startDate) >= new Date())
    .sort((a, b) => a.courseRun.startDate < b.courseRun.startDate ? -1 : 1);
  const bkHtml = `<div class="card"><div class="t">Your upcoming bookings</div>` + (upcoming.length
    ? upcoming.map(b => `<div>${fmtDate(londonParts(b.courseRun.startDate).date)} ${londonParts(b.courseRun.startDate).time} — ${(b.courseRun.course && b.courseRun.course.name) || ""}</div>`).join("")
    : `<div class="muted">None.</div>`) + `</div>`;

  view.innerHTML = `<h2>Account</h2>${memHtml}${passHtml}${bkHtml}
    <button class="primary" id="logout" style="margin-top:14px">Log out</button>`;
  view.querySelector("#logout").addEventListener("click", () => logout());
  injectAccountStyles();
}

function injectAccountStyles() {
  if (document.getElementById("acct-css")) return;
  const s = document.createElement("style"); s.id = "acct-css";
  s.textContent = `.card{background:#16181c;border-radius:14px;padding:12px;margin-bottom:10px}
    .card .t{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin-bottom:6px}
    .small{font-size:11px}`;
  document.head.appendChild(s);
}
