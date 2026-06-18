import { fmtDate, prettyCourse } from "./format.js";
import { londonParts } from "../tz.js";
import { logout } from "../app.js";

// Riders on a booking, with "you" for the account holder. Empty when it's just you.
function riders(b, me) {
  const meName = (me || {}).firstName;
  const named = (b.participants || [])
    .map(p => (p.contact || {}).firstName).filter(Boolean)
    .map(n => (n === meName ? "you" : n));
  if (named.length === 1 && named[0] === "you") return "";
  return named.join(" + ");
}

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
  const bkHtml = `<div class="t" style="margin-top:16px">Your upcoming bookings</div>` + (upcoming.length
    ? upcoming.map(b => {
        const lp = londonParts(b.courseRun.startDate);
        const note = riders(b, state.me);
        const sub = prettyCourse((b.courseRun.course || {}).name) + (note ? ` · ${note}` : "");
        return `<div class="bkrow">
          <div><div class="bktm">${fmtDate(lp.date)} · <b>${lp.time}</b></div><div class="bksub">${sub}</div></div>
          <span class="bktag">✓ Booked</span></div>`;
      }).join("")
    : `<div class="card muted">None.</div>`);

  view.innerHTML = `<h2>Account</h2>${memHtml}${passHtml}${bkHtml}
    <button class="primary" id="logout" style="margin-top:14px">Log out</button>`;
  view.querySelector("#logout").addEventListener("click", () => logout());
  injectAccountStyles();
}

function injectAccountStyles() {
  if (document.getElementById("acct-css")) return;
  const s = document.createElement("style"); s.id = "acct-css";
  s.textContent = `.card{background:#16181c;border-radius:14px;padding:12px;margin-bottom:10px}
    .t{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#6b7280;margin-bottom:8px}
    .small{font-size:11px}
    .bkrow{display:flex;justify-content:space-between;align-items:center;background:#16181c;border-radius:12px;padding:11px 12px;margin-bottom:8px}
    .bktm{font-weight:600;font-size:14px}.bktm b{color:#2dd4bf}
    .bksub{font-size:11px;color:#9aa0a6;margin-top:3px}
    .bktag{background:#13241f;border:1px solid #2dd4bf55;color:#2dd4bf;font-size:11px;font-weight:600;padding:3px 9px;border-radius:7px;white-space:nowrap}`;
  document.head.appendChild(s);
}
