import { randomHex, sha256 } from './util.js';

const COOKIE = 'mfu_session';
export const sessionCookie = (token, seconds) =>
  `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${seconds}`;

export function readToken(request) {
  const c = (request.headers.get('Cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='));
  return c ? c.slice(COOKIE.length + 1) : null;
}

export async function getSession(request, env) {
  const token = readToken(request);
  if (!token) return null;
  const row = await env.DB.prepare('SELECT role,student_id,parent_id,expires_at FROM sessions WHERE token_hash=?').bind(await sha256(token)).first();
  if (!row || row.expires_at < Math.floor(Date.now() / 1000)) return null;
  return row;
}

// Creates a session and returns the Set-Cookie header value.
export async function startSession(env, role, seconds, parentId = null) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now).run();
  const token = randomHex(32);
  await env.DB.prepare('INSERT INTO sessions(token_hash,role,parent_id,expires_at) VALUES(?,?,?,?)').bind(await sha256(token), role, parentId, now + seconds).run();
  return sessionCookie(token, seconds);
}

export async function endSession(request, env) {
  const token = readToken(request);
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run();
}
