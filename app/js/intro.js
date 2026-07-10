// First-run walkthrough: a small welcome carousel that explains the basics.
// Shows once (remembered in localStorage); replayable from Settings via showIntro().

import { isOn } from "./features.js";

const SEEN_KEY = "lagoon.introSeen";
const VERSION = 2; // bump to re-show the intro after a significant change (v2: conditions slide)

const SLIDES = [
  { emoji: "🏄", title: "Welcome to Hove Lagoon",
    body: "Live wakeboarding availability, your bookings and the weather — straight from the Lagoon booking system." },
  { emoji: "🔑", title: "Sign in with your Lagoon account",
    body: "It uses your existing Hove Lagoon booking login — the same email & password as the website. There's no separate sign-up, and your password is never stored." },
  { emoji: "🗓️", title: "Find a session",
    body: "The <b>Availability</b> tab lists free sessions for the next few weeks. Tap the chips to filter by type; “Last refreshed” shows how current it is." },
  { emoji: "🌤️", title: "Reading the conditions",
    body: "Each day card packs in the forecast: the sky icon, <b>temp range</b> (°C), <b>☔ chance of rain</b>, <b>UV</b>, and wind as <b>direction speed(gust)</b> in km/h — so <b>🌬 NE 24(45)</b> is a north-easterly wind, 24 gusting 45. The chips below are the sessions: <b>time · type · spaces free</b>." },
  { emoji: "🔥", title: "Grab a last-minute spot",
    body: "The <b>Last-minute</b> tab surfaces sessions happening soon — filter by <b>Today / Tomorrow / Weekend</b>. A <b>“just opened ↑”</b> tag flags spots that freed up since you last looked, so you can pounce on cancellations. Prefer to open here? Set it in Settings → Default page." },
  { emoji: "🔔", title: "Get a nudge when a spot opens",
    body: "Turn on <b>spot-opened alerts</b> in Settings and the app will notify you when a session frees up on the days you ride and can reach — even when the app is closed. Choose your days, session types and travel time.",
    gate: () => isOn("notifications") },
  { emoji: "⬇️", title: "Pull down to refresh",
    body: "Drag down from the top of the list to fetch the latest availability — no need to close and reopen the app." },
  { emoji: "🎟️", title: "Your bookings",
    body: "The <b>Bookings</b> tab shows your booked sessions, how many each rider has vs the limit, and lets you cancel a place." },
];

export function maybeShowIntro() {
  let seen = null;
  try { seen = JSON.parse(localStorage.getItem(SEEN_KEY)); } catch { seen = null; }
  if (seen !== VERSION) showIntro();
}

export function showIntro() {
  injectStyles();
  if (document.getElementById("intro")) return; // already open
  let i = 0;
  const slides = SLIDES.filter((s) => !s.gate || s.gate());

  const el = document.createElement("div");
  el.id = "intro";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.innerHTML = `
    <div class="intro-card">
      <button class="intro-skip" aria-label="Close">Skip</button>
      <div class="intro-emoji"></div>
      <h3 class="intro-title"></h3>
      <p class="intro-body"></p>
      <div class="intro-dots"></div>
      <div class="intro-nav">
        <button class="intro-back">‹ Back</button>
        <button class="intro-next primary"></button>
      </div>
    </div>`;
  document.body.appendChild(el);

  const card = el.querySelector(".intro-card");
  const emoji = el.querySelector(".intro-emoji");
  const title = el.querySelector(".intro-title");
  const body = el.querySelector(".intro-body");
  const dots = el.querySelector(".intro-dots");
  const back = el.querySelector(".intro-back");
  const next = el.querySelector(".intro-next");

  dots.innerHTML = slides.map(() => `<span class="intro-dot"></span>`).join("");
  const dotEls = [...dots.querySelectorAll(".intro-dot")];

  function render() {
    const s = slides[i];
    emoji.textContent = s.emoji;
    title.textContent = s.title;
    body.innerHTML = s.body;
    dotEls.forEach((d, n) => d.classList.toggle("on", n === i));
    back.style.visibility = i === 0 ? "hidden" : "visible";
    next.textContent = i === slides.length - 1 ? "Got it" : "Next ›";
  }
  function close() {
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(VERSION)); } catch { /* ignore */ }
    document.removeEventListener("keydown", onKey);
    el.remove();
  }
  function nextStep() { if (i < slides.length - 1) { i++; render(); } else close(); }
  function prevStep() { if (i > 0) { i--; render(); } }
  function onKey(e) {
    if (e.key === "Escape") close();
    else if (e.key === "ArrowRight") nextStep();
    else if (e.key === "ArrowLeft") prevStep();
  }

  next.addEventListener("click", nextStep);
  back.addEventListener("click", prevStep);
  el.querySelector(".intro-skip").addEventListener("click", close);
  el.addEventListener("click", (e) => { if (e.target === el) close(); }); // tap backdrop
  document.addEventListener("keydown", onKey);

  render();
  card.scrollIntoView({ block: "center" });
  next.focus();
}

function injectStyles() {
  if (document.getElementById("intro-css")) return;
  const s = document.createElement("style"); s.id = "intro-css";
  s.textContent = `
    #intro{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;
      background:rgba(0,0,0,.6);padding:20px;animation:intro-fade .15s ease}
    .intro-card{position:relative;width:100%;max-width:340px;background:var(--surface);
      border:1px solid var(--border);border-radius:18px;padding:26px 22px 18px;text-align:center;
      box-shadow:0 12px 40px var(--shadow);animation:intro-pop .18s ease}
    .intro-skip{position:absolute;top:12px;right:12px;background:none;border:none;color:var(--muted);
      font-size:13px;cursor:pointer;padding:4px 6px}
    .intro-emoji{font-size:46px;line-height:1;margin:6px 0 12px}
    .intro-title{margin:0 0 8px;font-size:19px}
    .intro-body{margin:0 0 18px;font-size:14px;color:var(--muted);line-height:1.55}
    .intro-body b{color:var(--text)}
    .intro-dots{display:flex;gap:7px;justify-content:center;margin-bottom:18px}
    .intro-dot{width:7px;height:7px;border-radius:50%;background:var(--border)}
    .intro-dot.on{background:var(--accent)}
    .intro-nav{display:flex;align-items:center;justify-content:space-between;gap:10px}
    .intro-back{background:none;border:1px solid var(--border);color:var(--muted);border-radius:10px;
      padding:10px 18px;font-size:14px;cursor:pointer;min-width:96px}
    .intro-next{background:var(--accent);color:var(--accent-ink);border:none;border-radius:10px;
      padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer;min-width:96px}
    @keyframes intro-fade{from{opacity:0}to{opacity:1}}
    @keyframes intro-pop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}`;
  document.head.appendChild(s);
}
