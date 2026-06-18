import { fmtDate, prettyCourse } from "./format.js";
import { londonParts } from "../tz.js";
import { getToken } from "../store.js";
import { cancelParticipant } from "../api.js";
import { bookingKeys } from "../model.js";
import { logout } from "../app.js";

const riderName = (p, me) =>
  (p.contact || {}).id === (me || {}).id ? "You" : ((p.contact || {}).firstName || "Rider");

export function renderAccount(view, state, go) {
  const me = state.me || {};

  const m = (state.memberships || [])[0];
  const memHtml = `<div class="t">Membership</div>` + (m
    ? `<div class="bkrow">
        <div><div class="bktm">${(m.membershipType && m.membershipType.name) || "Member"}</div>
          <div class="bksub">${m.expiryDate ? "expires " + fmtDate(m.expiryDate.slice(0, 10)) : "no expiry"}</div></div>
        <span class="bktag">${m.status || ""}</span></div>`
    : `<div class="bkrow muted">No membership found.</div>`);

  const passes = (state.packages || []).filter(p => (p.remainTokens || 0) > 0);
  const passHtml = `<div class="t" style="margin-top:16px">Ride passes</div>` + (passes.length
    ? passes.map(p => {
        const title = ((p.package && p.package.title) || "Pass").replace(/^Package\s*-\s*/i, "");
        return `<div class="bkrow">
          <div><div class="bktm">${title}</div><div class="bksub">ride pass</div></div>
          <span class="bktag">${p.remainTokens}/${p.totalTokens} left</span></div>`;
      }).join("")
    : `<div class="bkrow muted">No ride-pass tokens remaining.</div>`);

  const upcoming = (state.meBookings || [])
    .filter(b => (b.status || "").toLowerCase() === "confirmed" && b.courseRun && new Date(b.courseRun.startDate) >= new Date())
    .sort((a, b) => a.courseRun.startDate < b.courseRun.startDate ? -1 : 1);
  const bkHtml = `<div class="t" style="margin-top:16px">Your upcoming bookings</div>` + (upcoming.length
    ? upcoming.map(b => {
        const lp = londonParts(b.courseRun.startDate);
        const name = prettyCourse((b.courseRun.course || {}).name);
        const riderRows = (b.participants || []).map(p =>
          `<div class="rider"><span>${riderName(p, me)}</span>
             <button class="bkcancel" data-pid="${p.id}">Cancel</button></div>`).join("")
          || `<div class="rider muted"><span>booked</span></div>`;
        return `<div class="bkcard">
          <div class="bktm">${fmtDate(lp.date)} · <b>${lp.time}</b></div>
          <div class="bksub">${name}</div>
          <div class="riders">${riderRows}</div></div>`;
      }).join("")
    : `<div class="bkrow muted">None.</div>`);

  view.innerHTML = `<h2>Account</h2>${memHtml}${passHtml}${bkHtml}
    <button class="primary" id="logout" style="margin-top:14px">Log out</button>`;
  view.querySelector("#logout").addEventListener("click", () => logout());
  for (const btn of view.querySelectorAll(".bkcancel")) {
    btn.addEventListener("click", () => onCancel(btn, view, state, go));
  }
  injectAccountStyles();
}

async function onCancel(btn, view, state, go) {
  const pid = Number(btn.dataset.pid);
  let booking, participant;
  for (const b of state.meBookings || []) {
    const p = (b.participants || []).find(x => x.id === pid);
    if (p) { booking = b; participant = p; break; }
  }
  if (!booking) return;
  const me = state.me || {};
  const isYou = (participant.contact || {}).id === me.id;
  const who = isYou ? "your" : `${(participant.contact || {}).firstName}'s`;
  const lp = londonParts(booking.courseRun.startDate);
  const what = `${prettyCourse((booking.courseRun.course || {}).name)}, ${fmtDate(lp.date)} ${lp.time}`;
  if (!confirm(`Cancel ${who} place on ${what}? This frees the spot and can't be undone here.`)) return;

  btn.disabled = true;
  btn.textContent = "Cancelling…";
  try {
    await cancelParticipant(pid, getToken());
    // optimistic local update so the UI reflects the cancellation immediately
    booking.participants = (booking.participants || []).filter(x => x.id !== pid);
    if (!booking.participants.length) {
      state.meBookings = (state.meBookings || []).filter(b => b !== booking);
    }
    // keep the agenda's "booked" flags consistent without a full reload
    const keys = bookingKeys(state.meBookings || []);
    for (const d of state.agenda || []) for (const s of d.slots) s.booked = keys.has(s.key);
    renderAccount(view, state, go);
  } catch (e) {
    if (e.code === 401) { logout(); return; }
    btn.disabled = false;
    btn.textContent = "Cancel";
    alert("Couldn't cancel — the booking system refused (you may be past the cancellation cut-off). Try the website.");
  }
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
    .bktag{background:#13241f;border:1px solid #2dd4bf55;color:#2dd4bf;font-size:11px;font-weight:600;padding:3px 9px;border-radius:7px;white-space:nowrap}
    .bkcard{background:#16181c;border-radius:12px;padding:11px 12px;margin-bottom:8px}
    .bkcard .bksub{margin:3px 0 4px}
    .rider{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-top:1px solid #23262c;font-size:13px}
    .bkcancel{background:none;border:1px solid #5a2f2f;color:#f87171;font-size:11px;font-weight:600;padding:3px 11px;border-radius:7px;cursor:pointer}
    .bkcancel:disabled{opacity:.5}`;
  document.head.appendChild(s);
}
