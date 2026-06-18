export function fmtDate(date) {
  return new Date(date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
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
