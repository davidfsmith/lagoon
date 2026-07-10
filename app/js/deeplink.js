// Parse a notification cold-open hash "#day/<date>/<url-encoded key>" into a route
// target, or null. Used by app.js on boot to jump to a freed slot's Day view.
export function parseDayHash(hash) {
  const m = /^#day\/([^/]+)\/(.+)$/.exec(hash || "");
  return m ? { date: m[1], key: decodeURIComponent(m[2]) } : null;
}
