// Web Push client: subscribe/unsubscribe via the service worker's PushManager and
// register the subscription with our Lambda. Gated by the `notifications` flag; the
// enable toggle lives in Settings. Browser-only APIs (navigator.serviceWorker,
// PushManager, Notification) — only urlBase64ToUint8Array is pure/unit-tested.
import { VAPID_PUBLIC_KEY, PUSH_REGISTER_URL } from "./config.js";
import { getNotifyPrefs } from "./store.js";

// VAPID public key (URL-safe base64) -> Uint8Array for applicationServerKey.
export function urlBase64ToUint8Array(base64) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Body for a subscribe / prefs-sync POST. Pure — unit-tested.
export function subscribeBody(subscription, prefs) {
  return JSON.stringify({ subscription, prefs });
}

// True if two prefs objects are equivalent (day/type order-independent). Pure — used to
// decide whether the server's echoed prefs differ from local (i.e. something was stripped).
export function prefsEqual(a, b) {
  if (!a || !b) return false;
  const sameSet = (x = [], y = []) => x.length === y.length && x.every(v => y.includes(v));
  return sameSet(a.days, b.days) && sameSet(a.types, b.types) &&
    (a.travelMins ?? null) === (b.travelMins ?? null);
}

// "unsupported" | "denied" | "granted-unsubscribed" | "subscribed"
export async function notifState() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
    return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? "subscribed" : "granted-unsubscribed";
}

// Request permission, subscribe, and POST the subscription to our Lambda.
// Returns true on success. Throws if permission is refused.
export async function subscribe() {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("permission " + perm);
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  await fetch(PUSH_REGISTER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: subscribeBody(sub.toJSON(), getNotifyPrefs()),
  });
  return true;
}

// Unsubscribe locally and tell the Lambda to drop it.
export async function unsubscribe() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await fetch(PUSH_REGISTER_URL, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
}

// Re-send prefs for the current subscription (upsert). Returns a result the caller can act
// on: { status: "ok", prefs } (server echoes what it stored, for reconciliation),
// { status: "failed" } (network/transient — surface it, don't swallow), or
// { status: "unsubscribed" } (no-op). Never rejects.
export async function syncPrefs() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return { status: "unsubscribed" };
  try {
    const res = await fetch(PUSH_REGISTER_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: subscribeBody(sub.toJSON(), getNotifyPrefs()),
    });
    if (!res.ok) return { status: "failed" };
    const data = await res.json().catch(() => ({}));
    return { status: "ok", prefs: data.prefs || null };
  } catch {
    return { status: "failed" };
  }
}
