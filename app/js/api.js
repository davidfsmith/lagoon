import { API_BASE, API2_BASE } from "./config.js";

export async function login(email, password, fetchImpl = fetch) {
  const res = await fetchImpl(`${API_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error("login " + res.status);
  const data = await res.json();
  if (data.status !== "ok" || !data.token) throw new Error("login rejected");
  return data.token;
}

export async function authedGet(path, token, fetchImpl = fetch) {
  const res = await fetchImpl(`${API_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) { const e = new Error("unauthorized"); e.code = 401; throw e; }
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

// Cancel one rider's place on a booking (WRITE — real cancellation).
export async function cancelParticipant(participantId, token, fetchImpl = fetch) {
  const res = await fetchImpl(`${API2_BASE}/booking-order/cancelParticipant/${participantId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) { const e = new Error("unauthorized"); e.code = 401; throw e; }
  if (!res.ok) throw new Error(`cancel ${res.status}`);
  return true;
}

// Paginate ascending runs until we pass horizonISO or exhaust results.
export async function getCourseRuns(courseId, horizonISO, fetchImpl = fetch) {
  let page = 1; const all = [];
  for (;;) {
    const res = await fetchImpl(`${API_BASE}/public/courseRuns?course=${courseId}&itemsPerPage=100&page=${page}`);
    if (!res.ok) throw new Error("courseRuns " + res.status);
    const json = await res.json();
    const data = json.data || [];
    all.push(...data);
    const meta = json.meta || {};
    const last = data[data.length - 1];
    if (!data.length) break;
    if (last && last.startDate > horizonISO) break;
    if (page * (meta.itemsPerPage || 100) >= (meta.filteredCount || 0)) break;
    page++;
  }
  return all;
}
