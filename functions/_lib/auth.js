import { randomHex, sha256 } from './util.js';

const COOKIE = 'mfu_session';
export const sessionCookie = (token, seconds) =>
  `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${seconds}`;

export function readToken(request) {
  const c = (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='));
  return c ? c.slice(COOKIE.length + 1) : null;
}

// Signed-in sessions end after 20 minutes without any activity.
export const IDLE_SECONDS = 20 * 60;

export async function getSession(request, env) {
  const token = readToken(request);
  if (!token) return null;
  const hash = await sha256(token), now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare('SELECT role,student_id,parent_id,coach_id,expires_at,last_seen FROM sessions WHERE token_hash=?').bind(hash).first();
  if (!row || row.expires_at < now) return null;
  if (row.last_seen && now - row.last_seen > IDLE_SECONDS) { await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(hash).run(); return null; }
  // Only write when a minute has passed, so normal browsing doesn't write on every request.
  if (!row.last_seen || now - row.last_seen > 60) await env.DB.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=?').bind(now, hash).run();
  return row;
}

// Creates a session and returns the Set-Cookie header value.
export async function startSession(env, role, seconds, parentId = null, coachId = null) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now).run();
  const token = randomHex(32);
  await env.DB.prepare('INSERT INTO sessions(token_hash,role,parent_id,coach_id,expires_at,last_seen) VALUES(?,?,?,?,?,?)').bind(await sha256(token), role, parentId, coachId, now + seconds, now).run();
  return sessionCookie(token, seconds);
}

export async function endSession(request, env) {
  const token = readToken(request);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run();
}
