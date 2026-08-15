// In-app booking sheet: book a £0 (membership-covered) session without leaving the app.
// SAFETY: this is a real WRITE flow with a strict rule — NEVER complete a booking that
// carries a cost. isFreeOrder() is the gate; anything it can't positively confirm as £0
// aborts to the real Lagoon checkout instead of guessing. Pattern: intro.js (fixed
// overlay + card, self-contained styles).
import { eligibleRidersFor, buildParticipants } from "../model.js";
import { createPendingBookings, getPendingOrder, completeFreeOrder } from "../api.js";
import { getToken, saveCache, getBookingTermsAgreed, setBookingTermsAgreed } from "../store.js";
import { BOOKING_SITE, BOOKING_LIMIT } from "../config.js";
import { londonParts } from "../tz.js";
// app.js is imported lazily (only on an actual 401), not statically — its top level
// touches `document` at module load, which would break importing isFreeOrder in the
// (DOM-less) node --test runner. Same runtime behaviour in the browser either way.

// £0 safety gate — returns true ONLY when it can positively confirm the pending order
// totals £0. Any money-shaped field (total/amount/due/price/balance/cost/net/gross)
// that's missing, non-numeric, or nonzero means we can't confirm £0, so this returns
// false (NOT free) and the caller must abort to the web checkout rather than complete
// in-app. Missing/unknown data must never be treated as "probably free".
//
// The real /me/orders/pending shape was never captured live, so this must NOT assume
// it's flat — a nested payable total (e.g. { total: 0, cart: { grandTotal: 25 } })
// would wrongly read as £0 if only top-level keys were scanned. So it recurses through
// the whole object graph (objects and arrays), collecting every numeric money-shaped
// field at any depth: free only if at least one was found AND every one of them is 0.
const MONEY_RE = /total|amount|due|price|balance|cost|net|gross/i;
const MAX_DEPTH = 12; // the order is plain JSON — this is a generous, defensive cap

// Depth-capped, cycle-guarded walk collecting every numeric money-shaped field into
// `state.money`. If the cap is hit while there's still unexplored structure below it
// (an object/array we didn't get to look inside), that's recorded as `state.truncated`
// — the cap is the ONE place this walk could miss a nonzero total, so isFreeOrder must
// treat a truncated walk as "can't confirm", never as "found none, must be £0".
function collectMoneyFields(node, depth, seen, state) {
  if (!node || typeof node !== "object") return;
  if (depth > MAX_DEPTH) { state.truncated = true; return; } // structure remains beyond the cap
  if (seen.has(node)) return; // cycle guard (defensive — JSON.parse can't cycle, but be safe)
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) collectMoneyFields(item, depth + 1, seen, state);
    return;
  }
  for (const key of Object.keys(node)) {
    const v = node[key];
    if (MONEY_RE.test(key) && typeof v === "number") state.money.push(v);
    else if (v && typeof v === "object") collectMoneyFields(v, depth + 1, seen, state);
  }
}

export function isFreeOrder(order) {
  if (!order || typeof order !== "object") return false;
  const state = { money: [], truncated: false };
  collectMoneyFields(order, 0, new Set(), state);
  if (state.truncated) return false;          // hit the depth cap with structure left unexplored → can't confirm (safe: false)
  if (state.money.length === 0) return false;  // can't confirm £0 anywhere → NOT free (safe: abort to web)
  return state.money.every(v => v === 0);      // every money field, at any depth, is zero → free
}

function webBookLink(session) {
  return `${BOOKING_SITE}/book?courseRunId=${session.runId}`;
}

// The same "Book ↗" fallback used everywhere else in the app (day.js/lastminute.js) —
// used here whenever in-app completion can't be safely confirmed.
function openWebFallback(session) {
  window.open(webBookLink(session), "_blank", "noopener");
}

export function openBookSheet(session, state, go, onBooked) {
  injectStyles();
  if (document.getElementById("book-sheet")) return; // already open

  const me = state.me || {};
  const riders = eligibleRidersFor(session, state.memberships, state.meBookings, me.id, BOOKING_LIMIT);
  const showTerms = !getBookingTermsAgreed(); // one-time, per device
  const time = londonParts(session.start).time;

  const el = document.createElement("div");
  el.id = "book-sheet";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.innerHTML = `
    <div class="book-card">
      <h3 class="book-title">Book — ${time} ${session.label}</h3>
      ${riders.length
        ? `<div class="book-riders">${riders.map(r => `
            <label class="book-rider">
              <input type="checkbox" class="book-rchk" value="${r.contactId}" ${r.contactId === me.id ? "checked" : ""}>
              <span>${r.name}</span>
            </label>`).join("")}</div>`
        : `<p class="muted small">No eligible riders for this session — try the website.</p>`}
      ${showTerms
        ? `<label class="book-terms">
            <input type="checkbox" id="book-terms-chk">
            <span>I agree to the <a href="${BOOKING_SITE}" target="_blank" rel="noopener">Lagoon terms</a></span>
          </label>`
        : ""}
      <p class="book-msg" id="book-msg"></p>
      <div class="book-actions">
        <button class="book-cancel">Cancel</button>
        <button class="book-confirm primary" ${riders.length ? "" : "disabled"}>Confirm</button>
      </div>
    </div>`;
  document.body.appendChild(el);

  const msg = el.querySelector("#book-msg");
  const termsChk = el.querySelector("#book-terms-chk");
  const confirmBtn = el.querySelector(".book-confirm");
  const cancelBtn = el.querySelector(".book-cancel");

  function close() { el.remove(); }
  function nudge(text) { msg.textContent = text; msg.classList.add("err"); }
  function setBusy(busy) {
    confirmBtn.disabled = busy; cancelBtn.disabled = busy;
    confirmBtn.textContent = busy ? "Booking…" : "Confirm";
  }

  cancelBtn.addEventListener("click", close);
  el.addEventListener("click", (e) => { if (e.target === el) close(); }); // tap backdrop

  // submitBooking(selectedRiders) — the £0 safety flow. Exact order matters:
  //   1. terms gate (required, never silently skipped)
  //   2. create the pending booking
  //   3. read the pending order back
  //   4. £0 gate — abort to web on anything but a confirmed £0 (steps 3-5 are the gate)
  //   5. complete the £0 checkout
  //   6. optimistic local reflect + re-render
  //   7. any failure -> never treated as success; 401 -> logout, else message + web fallback
  async function submitBooking(selectedRiders) {
    if (showTerms && !(termsChk && termsChk.checked)) {
      nudge("Please agree to the terms to continue.");   // keep required — do not submit
      return;
    }
    if (showTerms) setBookingTermsAgreed(true);
    msg.textContent = ""; msg.classList.remove("err");
    setBusy(true);
    try {
      await createPendingBookings(session.runId, buildParticipants(selectedRiders), getToken());
      const order = await getPendingOrder(getToken());
      // SAFETY GATE: only complete in-app when the pending order positively confirms £0.
      // Anything else (paid, unknown, malformed) aborts WITHOUT completing — the pending
      // booking simply expires unpaid — and hands off to the real checkout instead.
      if (!isFreeOrder(order)) {
        close();
        openWebFallback(session);
        return;
      }
      await completeFreeOrder(getToken());
      // Optimistic local reflect, shaped like a real /me/bookings entry so existing views
      // (account.js etc.) render it the same way. IDs are synthetic ("pending-…", never
      // colliding with real numeric ids) — a background/next refresh replaces this with
      // the real booking. saveCache persists it so it survives a later cache fallback.
      const cr = { id: session.runId, course: { id: session.courseId, name: session.label },
        startDate: session.start, endDate: session.end };
      const booking = {
        id: `pending-${session.runId}`, status: "confirmed", courseRun: cr,
        participants: selectedRiders.map(r => ({
          id: `pending-${session.runId}-${r.contactId}`, status: "confirmed",
          contact: { id: r.contactId, firstName: r.name === "You" ? undefined : r.name },
        })),
      };
      state.meBookings = [...(state.meBookings || []), booking];
      saveCache(state);
      close();
      onBooked(); // immediate optimistic re-render
      const names = selectedRiders.map(r => r.name).join(" & ");
      toast(`✓ Booked ${time} ${session.label} for ${names}`);
      // Then background-refresh so the synthetic "pending-…" entry is replaced by the real
      // booking (with real numeric ids) before the user reaches Bookings to cancel it —
      // same path the web-return flow uses. Fire-and-forget; failures fall back to cache.
      import("../app.js").then(m => m.refreshAfterBooking()).catch(() => {});
    } catch (e) {
      if (e && e.code === 401) { close(); const { logout } = await import("../app.js"); logout(); return; }
      // NEVER treat a thrown error as success — no optimistic update, no onBooked().
      close();
      alert("Couldn't complete the booking — opening the booking website instead.");
      openWebFallback(session);
    }
  }

  confirmBtn.addEventListener("click", () => {
    if (riders.length === 0) { close(); openWebFallback(session); return; }
    const selected = riders.filter(r => {
      const box = el.querySelector(`.book-rchk[value="${r.contactId}"]`);
      return box && box.checked;
    });
    if (selected.length === 0) { nudge("Pick at least one rider."); return; }
    submitBooking(selected);
  });
}

function injectStyles() {
  if (document.getElementById("book-css")) return;
  const s = document.createElement("style"); s.id = "book-css";
  s.textContent = `
    #book-sheet{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;
      background:rgba(10,10,10,.55);padding:20px}
    .book-card{width:100%;max-width:340px;background:var(--surface);border:1px solid var(--border);
      border-radius:16px;padding:20px;box-shadow:0 18px 55px var(--shadow)}
    .book-title{margin:0 0 14px;font-size:17px}
    .book-riders{display:flex;flex-direction:column;gap:8px;margin-bottom:12px}
    .book-rider{display:flex;align-items:center;gap:8px;font-size:14px}
    .book-terms{display:flex;align-items:center;gap:8px;font-size:14px;margin-bottom:8px;
      border-top:1px solid var(--border);padding-top:12px;margin-top:4px}
    .book-terms a{color:var(--accent)}
    /* index.html has a global input{width:100%;padding;margin;border} for the login fields —
       reset it for our checkboxes so they stay small and the label sits next to them. */
    .book-rider input[type=checkbox],.book-terms input[type=checkbox]{
      width:auto;flex:none;margin:0;padding:0;border:0;background:none;
      -webkit-appearance:checkbox;appearance:checkbox}
    .book-rider span,.book-terms span{flex:1;min-width:0}
    .book-msg{min-height:16px;font-size:12px;margin:0 0 8px}
    .book-msg.err{color:var(--danger)}
    .book-actions{display:flex;justify-content:flex-end;gap:10px}
    .book-cancel{background:none;border:1px solid var(--border);color:var(--muted);border-radius:10px;
      padding:9px 16px;font-size:14px;cursor:pointer}
    .book-confirm{background:var(--accent);color:var(--accent-ink);border:none;border-radius:10px;
      padding:9px 16px;font-size:14px;font-weight:600;cursor:pointer}
    .book-confirm:disabled{opacity:.5;cursor:default}
    #book-toast{position:fixed;left:50%;bottom:76px;transform:translateX(-50%) translateY(8px);
      z-index:60;max-width:88%;background:var(--accent);color:var(--accent-ink);font-size:14px;
      font-weight:600;padding:11px 16px;border-radius:12px;box-shadow:0 8px 30px var(--shadow);
      opacity:0;transition:opacity .18s ease,transform .18s ease;pointer-events:none;text-align:center}
    #book-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}`;
  document.head.appendChild(s);
}

// Brief success confirmation, auto-dismissed. Sits above the bottom nav; replaces any
// previous toast so rapid bookings don't stack.
function toast(text) {
  injectStyles();
  document.getElementById("book-toast")?.remove();
  const t = document.createElement("div");
  t.id = "book-toast"; t.setAttribute("role", "status"); t.textContent = text;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 250); }, 2800);
}
