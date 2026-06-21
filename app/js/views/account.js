import { fmtDate, prettyCourse, wcEmoji } from "./format.js";
import { londonParts } from "../tz.js";
import { weatherAt } from "../weather.js";
import { getToken, saveCache } from "../store.js";
import { cancelParticipant } from "../api.js";
import { bookingKeys, activeParticipants } from "../model.js";
import { BOOKING_LIMIT } from "../config.js";
import { downloadIcsForBooking } from "../calendar.js";
import { logout } from "../app.js";

const riderName = (p, me) =>
  (p.contact || {}).id === (me || {}).id ? "You" : ((p.contact || {}).firstName || "Rider");

const wxLine = (w) =>
  w ? `${wcEmoji(w.code)} ${Math.round(w.temp)}° · wind ${Math.round(w.windSpeed)} · rain ${w.precipProb}%${w.uv != null ? ` · UV ${Math.round(w.uv)}` : ""}` : "";

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
    .filter(b => (b.status || "").toLowerCase() === "confirmed" && b.courseRun && new Date(b.courseRun.startDate) >= new Date()
      && (!Array.isArray(b.participants) || activeParticipants(b).length > 0)) // hide bookings cancelled down to no riders
    .sort((a, b) => a.courseRun.startDate < b.courseRun.startDate ? -1 : 1);
  // Per-rider tally of active upcoming bookings vs the per-rider cap, so you can
  // see at a glance who still has room to book. Roster = membership members + you,
  // so a rider with zero bookings still shows (e.g. "Hamish — 0 / 4").
  const counts = {};
  for (const b of upcoming) for (const p of activeParticipants(b)) {
    const cid = (p.contact || {}).id;
    if (cid != null) counts[cid] = (counts[cid] || 0) + 1;
  }
  const roster = []; const seenIds = new Set();
  const addRider = (id, name) => { if (id != null && !seenIds.has(id)) { seenIds.add(id); roster.push({ id, name }); } };
  addRider(me.id, "You");
  for (const mem of (m && m.members) || []) addRider(mem.id, mem.firstName || "Rider");
  for (const b of upcoming) for (const p of activeParticipants(b)) addRider((p.contact || {}).id, (p.contact || {}).firstName || "Rider");
  const capsHtml = roster.length
    ? `<div class="caps">` + roster.map(r => {
        const n = counts[r.id] || 0;
        return `<div class="cap${n >= BOOKING_LIMIT ? " full" : ""}"><span>${r.name}</span><span class="capn">${n} / ${BOOKING_LIMIT}</span></div>`;
      }).join("") + `</div>`
    : "";

  const hourly = (state.weather && state.weather.hourly) || [];
  const bkHtml = `<div class="t" style="margin-top:16px">Your upcoming bookings</div>${capsHtml}` + (upcoming.length
    ? upcoming.map(b => {
        const lp = londonParts(b.courseRun.startDate);
        const name = prettyCourse((b.courseRun.course || {}).name);
        const wx = wxLine(weatherAt(hourly, b.courseRun.startDate));
        const riderRows = activeParticipants(b).map(p =>
          `<div class="rider"><span>${riderName(p, me)}</span>
             <button class="bkcancel" data-pid="${p.id}">Cancel</button></div>`).join("")
          || `<div class="rider muted"><span>booked</span></div>`;
        return `<div class="bkcard">
          <div class="bkcard-hd">
            <div class="bktm">${fmtDate(lp.date)} · <b>${lp.time}</b></div>
            <button class="bkcal" data-bid="${b.id}" aria-label="Add to calendar">📅 Add</button>
          </div>
          <div class="bksub">${name}</div>
          ${wx ? `<div class="bksub">${wx}</div>` : ""}
          <div class="riders">${riderRows}</div></div>`;
      }).join("")
    : `<div class="bkrow muted">None.</div>`);

  view.innerHTML = `<h2>Bookings</h2>${memHtml}${passHtml}${bkHtml}`;
  for (const btn of view.querySelectorAll(".bkcancel")) {
    btn.addEventListener("click", () => onCancel(btn, view, state, go));
  }
  for (const btn of view.querySelectorAll(".bkcal")) {
    btn.addEventListener("click", () => {
      const b = (state.meBookings || []).find(x => x.id === Number(btn.dataset.bid));
      if (b) downloadIcsForBooking(b);
    });
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
    saveCache(state); // persist so the cancellation survives a later cache fallback
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
  s.textContent = `.card{background:var(--surface);border-radius:14px;padding:12px;margin-bottom:10px}
    .t{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin-bottom:8px}
    .small{font-size:11px}
    .bkrow{display:flex;justify-content:space-between;align-items:center;background:var(--surface);border-radius:12px;padding:11px 12px;margin-bottom:8px}
    .bktm{font-weight:600;font-size:14px}.bktm b{color:var(--accent)}
    .bksub{font-size:11px;color:var(--muted);margin-top:3px}
    .bktag{background:var(--chip-bg);border:1px solid var(--chip-border);color:var(--accent);font-size:11px;font-weight:600;padding:3px 9px;border-radius:7px;white-space:nowrap}
    .caps{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}
    .cap{display:flex;gap:8px;align-items:center;background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:7px 11px;font-size:13px}
    .cap .capn{color:var(--good);font-weight:700}
    .cap.full{border-color:var(--danger-border)}.cap.full .capn{color:var(--danger)}
    .bkcard{background:var(--surface);border-radius:12px;padding:11px 12px;margin-bottom:8px}
    .bkcard-hd{display:flex;justify-content:space-between;align-items:center;gap:8px}
    .bkcal{background:none;border:1px solid var(--border);color:var(--accent);font-size:11px;font-weight:600;padding:3px 10px;border-radius:7px;cursor:pointer;white-space:nowrap}
    .bkcard .bksub{margin:3px 0 4px}
    .rider{display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-top:1px solid var(--border);font-size:13px}
    .bkcancel{background:none;border:1px solid var(--danger-border);color:var(--danger);font-size:11px;font-weight:600;padding:3px 11px;border-radius:7px;cursor:pointer}
    .bkcancel:disabled{opacity:.5}`;
  document.head.appendChild(s);
}
