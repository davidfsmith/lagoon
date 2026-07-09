// Web Push client: subscribe/unsubscribe via the service worker's PushManager and
// register the subscription with our Lambda. Gated by the `notifications` flag; the
// enable toggle lives in Settings. Browser-only APIs (navigator.serviceWorker,
// PushManager, Notification) — only urlBase64ToUint8Array is pure/unit-tested.
import { VAPID_PUBLIC_KEY, PUSH_REGISTER_URL } from "./config.js";

// VAPID public key (URL-safe base64) -> Uint8Array for applicationServerKey.
export function urlBase64ToUint8Array(base64) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
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
    body: JSON.stringify({ subscription: sub.toJSON() }),
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
