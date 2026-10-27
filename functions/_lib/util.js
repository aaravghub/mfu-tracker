// Shared helpers for the MFU Tracker API (no dependencies).
export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
  });

const hex = buf => [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
export const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
export const randomHex = (bytes = 32) => hex(crypto.getRandomValues(new Uint8Array(bytes)));

export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Constant-time comparison of two secrets of any length.
export async function secretsMatch(a, b) {
  return timingSafeEqual(await sha256(String(a)), await sha256(String(b)));
}

async function pbkdf2(password, saltHex) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256));
}
export async function makePassword(password) {
  const salt = randomHex(16);
  return { salt, hash: await pbkdf2(password, salt) };
}
export async function checkPassword(password, salt, hash) {
  if (!salt || !hash) return false;
  return timingSafeEqual(await pbkdf2(password, salt), hash);
}

export const isHttpUrl = v => {
  if (typeof v !== 'string') return false;
  try { const u = new URL(v); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
};
export const isEmail = v => typeof v === 'string' && v.length <= 254 && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v);
export const cleanEmail = v => String(v || '').trim().toLowerCase();

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const clientKey = request => request.headers.get('CF-Connecting-IP') || 'local';

// Login throttling: max failures per window, stored in D1 so it works across isolates.
export async function isBlocked(env, key, max = 8, windowSec = 900) {
  const row = await env.DB.prepare('SELECT count,window_start FROM login_attempts WHERE key=?').bind(key).first();
  return !!row && row.count >= max && Math.floor(Date.now() / 1000) - row.window_start <= windowSec;
}
export async function recordFail(env, key, windowSec = 900) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'INSERT INTO login_attempts(key,count,window_start) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN ?-window_start>? THEN 1 ELSE count+1 END, window_start=CASE WHEN ?-window_start>? THEN ? ELSE window_start END'
  ).bind(key, now, now, windowSec, now, windowSec, now).run();
}
export const clearFails = (env, key) => env.DB.prepare('DELETE FROM login_attempts WHERE key=?').bind(key).run();
