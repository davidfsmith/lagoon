const TOKEN_KEY = "lagoon.token";
const CACHE_KEY = "lagoon.cache";

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }

export function saveCache(data) {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
}
export function loadCache() {
  const raw = localStorage.getItem(CACHE_KEY);
  return raw ? JSON.parse(raw) : null;
}
