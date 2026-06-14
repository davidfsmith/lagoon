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
