export function fmtDate(date) {
  return new Date(date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

// Friendly "when" for a timestamp (ms): "just now", "5 min ago", "14:32" (today),
// or "Fri 20 Jun, 14:32" (older). Used for the last-refreshed indicator.
export function fmtWhen(ts, nowMs = Date.now()) {
  if (!ts) return "never";
  const d = new Date(ts);
  const mins = Math.floor((nowMs - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const sameDay = new Date(nowMs).toDateString() === d.toDateString();
  if (sameDay) return `today at ${time}`;
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}, ${time}`;
}
// WMO weather code -> emoji (coarse buckets)
export function wcEmoji(code) {
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤";
  if (code === 3) return "☁️";
  if (code <= 48) return "🌫";
  if (code <= 67) return "🌦";
  if (code <= 77) return "🌨";
  if (code <= 82) return "🌧";
  return "⛈";
}

// Shorten a raw Lagoon course name for display.
// "2026 Wakeboard -Tech - Ride Session 30" -> "Tech 30";
// "2026 Wakeboard - Skills Clinic" -> "Skills Clinic".
export function prettyCourse(name) {
  let n = (name || "").trim().replace(/^\d{4}\s+/, "").replace(/^Wakeboard\s*-\s*/i, "");
  const m = n.match(/^(Tech|Air)\s*-\s*Ride Session\s*(\d+)/i);
  return m ? `${m[1]} ${m[2]}` : n;
}
