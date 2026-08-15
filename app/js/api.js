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

// Create pending booking(s) for a course run — one participant per rider, each under the
// membership that makes it £0. WRITE. Returns the pending-order/booking response.
export async function createPendingBookings(courseRunId, participants, token, fetchImpl = fetch) {
  const res = await fetchImpl(`${API_BASE}/me/orders/pending/bookings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ courseRun: { id: courseRunId }, groupParticipantsCount: 0, participants }),
  });
  if (res.status === 401) { const e = new Error("unauthorized"); e.code = 401; throw e; }
  if (!res.ok) throw new Error(`createBooking ${res.status}`);
  return res.json();
}

// The pending order ("cart") including its total — read to assert £0 before completing.
export async function getPendingOrder(token, fetchImpl = fetch) {
  const res = await fetchImpl(`${API_BASE}/me/orders/pending`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) { const e = new Error("unauthorized"); e.code = 401; throw e; }
  if (!res.ok) throw new Error(`pendingOrder ${res.status}`);
  return res.json();
}

// Complete a £0 (membership-covered) checkout. WRITE — real booking confirmation.
// The API sometimes returns an empty body on success, so a JSON-parse failure still counts as ok.
export async function completeFreeOrder(token, fetchImpl = fetch) {
  const res = await fetchImpl(`${API_BASE}/me/cart/giftVoucherPayment`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (res.status === 401) { const e = new Error("unauthorized"); e.code = 401; throw e; }
  if (!res.ok) throw new Error(`completeFreeOrder ${res.status}`);
  return res.json().catch(() => true);
}

// Paginate ascending runs until we pass horizonISO or exhaust results.
export async function getCourseRuns(courseId, fetchImpl = fetch) {
  // The API orders runs by runId (creation order), NOT startDate — dates are
  // scattered across every page. So fetch ALL pages and let the caller filter by
  // horizon (runsToSlots). Breaking pagination on a startDate comparison would
  // truncate mid-list and undercount available sessions.
  let page = 1; const all = [];
  for (;;) {
    const res = await fetchImpl(`${API_BASE}/public/courseRuns?course=${courseId}&itemsPerPage=100&page=${page}`);
    if (!res.ok) throw new Error("courseRuns " + res.status);
    const json = await res.json();
    const data = json.data || [];
    all.push(...data);
    const meta = json.meta || {};
    if (!data.length) break;
    if (page * (meta.itemsPerPage || 100) >= (meta.filteredCount || 0)) break;
    page++;
  }
  return all;
}
