// Timezone helper. The Lagoon API serialises session times as UTC (a `+00:00`
// offset, even in summer). The booking site shows them in UK local time, so we
// must convert every instant to Europe/London for display and for matching
// against Open-Meteo (which we request in Europe/London). Never read the hour
// straight off the raw string — that's UTC and lands 1h early during BST.

const LONDON = "Europe/London";
const _fmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON,
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});

// iso: an absolute timestamp (e.g. "2026-06-16T17:30:00+00:00").
// Returns its Europe/London wall-clock parts.
export function londonParts(iso) {
  const m = Object.fromEntries(
    _fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value])
  );
  const hh = m.hour === "24" ? "00" : m.hour; // Intl can emit "24" at midnight
  return {
    date: `${m.year}-${m.month}-${m.day}`,        // "YYYY-MM-DD" (London)
    hourKey: `${m.year}-${m.month}-${m.day}T${hh}`, // "YYYY-MM-DDTHH" (London)
    time: `${hh}:${m.minute}`,                     // "HH:MM" (London)
  };
}
