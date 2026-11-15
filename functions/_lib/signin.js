import { json, cleanEmail, isEmail, clientKey, isBlocked, recordFail, clearFails, sha256, makePassword, passwordProblem } from './util.js';
import { getSession, startSession } from './auth.js';
import { sendMessages, wrap } from './mail.js';

// Sign-in without passwords by default: a 6-digit code sent to the email on file, or "Sign in with Google".
// Either way the account must already exist (MFU creates parent and coach accounts; new families use Sign up).
// Someone who signs in this way and has no password is asked to set one, so the same email also works with a password.

const SESSION = { parent: 7 * 24 * 3600, coach: 7 * 24 * 3600, admin: 43200 };
const CODE_SECONDS = 600, CODE_TRIES = 5;
const now = () => Math.floor(Date.now() / 1000);

// The account behind an email for one role. Coaches can sign in once MFU has invited them.
async function account(env, role, email) {
  if (role === 'parent') return env.DB.prepare('SELECT id,name,(password_hash IS NOT NULL) AS has_password FROM parents WHERE email=? AND COALESCE(active,1)=1').bind(email).first();
  if (role === 'coach') return env.DB.prepare('SELECT id,name,(password_hash IS NOT NULL) AS has_password FROM coaches WHERE lower(email)=? AND COALESCE(active,1)=1 AND (password_hash IS NOT NULL OR invited_at IS NOT NULL) ORDER BY (password_hash IS NULL) LIMIT 1').bind(email).first();
  if (role === 'admin') return email === cleanEmail(env.ADMIN_EMAIL || 'automallakhamb@gmail.com') ? { id: null, name: 'Admin', has_password: 1 } : null;
  return null;
}

async function signIn(env, role, acc) {
  if (role === 'parent') await env.DB.prepare("UPDATE parents SET last_login=datetime('now') WHERE id=?").bind(acc.id).run();
  if (role === 'coach') await env.DB.prepare("UPDATE coaches SET last_login=datetime('now') WHERE id=?").bind(acc.id).run();
  const cookie = await startSession(env, role, SESSION[role], role === 'parent' ? acc.id : null, role === 'coach' ? acc.id : null);
  return json({ ok: true, role, needs_password: !acc.has_password }, 200, { 'set-cookie': cookie });
}

// ---- Google ID tokens, checked against Google's published keys (no library needed) ----
let certs = { at: 0, keys: [] };
const b64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
export async function verifyGoogleToken(token, clientId, fetchKeys = () => fetch('https://www.googleapis.com/oauth2/v3/certs').then(r => r.json())) {
  const [h, p, sig] = String(token || '').split('.');
  if (!h || !p || !sig) throw Error('Bad Google sign-in.');
  const header = JSON.parse(new TextDecoder().decode(b64(h))), claims = JSON.parse(new TextDecoder().decode(b64(p)));
  if (Date.now() - certs.at > 36e5 || !certs.keys.some(k => k.kid === header.kid)) certs = { at: Date.now(), keys: (await fetchKeys()).keys || [] };
  const jwk = certs.keys.find(k => k.kid === header.kid);
  if (!jwk || header.alg !== 'RS256') throw Error('Bad Google sign-in.');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64(sig), new TextEncoder().encode(h + '.' + p))) throw Error('Bad Google sign-in.');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || claims.aud !== clientId || claims.exp < now() || !claims.email_verified) throw Error('Google sign-in expired or not for this app.');
  return { email: cleanEmail(claims.email), name: claims.name || '' };
}

export async function handleSignin(path, method, request, env) {
  if (!path.startsWith('signin/')) return null;
  const sub = path.slice('signin/'.length), body = method === 'POST' ? await request.json().catch(() => ({})) : {};
  const role = ['parent', 'coach', 'admin'].includes(body.role) ? body.role : 'parent';

  // The public Google client id, for the sign-in button.
  if (sub === 'config' && method === 'GET') return json({ google_client_id: env.GOOGLE_CLIENT_ID || null });

  // Send a code. The answer is the same whether or not the email has an account, so emails cannot be fished for.
  if (sub === 'code' && method === 'POST') {
    const email = cleanEmail(body.email), key = 'code:' + email + ':' + clientKey(request);
    if (!isEmail(email)) return json({ error: 'Enter your email.' }, 400);
    if (await isBlocked(env, key, 5)) return json({ error: 'Too many codes asked for. Wait 15 minutes, or use your password.' }, 429);
    await recordFail(env, key);
    const acc = await account(env, role, email);
    if (acc) {
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1e6).padStart(6, '0');
      await env.DB.prepare('INSERT INTO login_codes(email,role,code_hash,expires_at,tries) VALUES(?,?,?,?,0) ON CONFLICT(email,role) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,tries=0').bind(email, role, await sha256(code + email), now() + CODE_SECONDS).run();
      const r = await sendMessages(env, [{ to: email, subject: `${code} is your MFU Tracker code`, html: wrap(`<p style="margin:0 0 14px">Your sign-in code:</p><p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:0 0 14px">${code}</p><p style="margin:0;color:#555">It works for 10 minutes. If you didn't ask for it, ignore this email.</p>`), text: `Your MFU Tracker sign-in code: ${code}\n\nIt works for 10 minutes.` }], { cc: false });
      if (!r.sent) return json({ error: 'Could not send the code right now. Use your password, or try again later.' }, 503);
    }
    return json({ ok: true });
  }
  if (sub === 'code/verify' && method === 'POST') {
    const email = cleanEmail(body.email), code = String(body.code || '').replace(/\D/g, '');
    const row = await env.DB.prepare('SELECT code_hash,expires_at,tries FROM login_codes WHERE email=? AND role=?').bind(email, role).first();
    if (!row || row.expires_at < now() || row.tries >= CODE_TRIES) return json({ error: 'That code has expired. Ask for a new one.' }, 400);
    if (row.code_hash !== await sha256(code + email)) { await env.DB.prepare('UPDATE login_codes SET tries=tries+1 WHERE email=? AND role=?').bind(email, role).run(); return json({ error: 'That code is not right.' }, 400); }
    await env.DB.prepare('DELETE FROM login_codes WHERE email=? AND role=?').bind(email, role).run();
    await clearFails(env, 'code:' + email + ':' + clientKey(request));
    const acc = await account(env, role, email);
    return acc ? signIn(env, role, acc) : json({ error: 'No account for that email.' }, 404);
  }

  if (sub === 'google' && method === 'POST') {
    if (!env.GOOGLE_CLIENT_ID) return json({ error: 'Google sign-in is not set up.' }, 503);
    let g; try { g = await verifyGoogleToken(body.credential, env.GOOGLE_CLIENT_ID); } catch (e) { return json({ error: e.message }, 401); }
    const acc = await account(env, role, g.email);
    // No account yet: the browser opens Sign up with this email and name filled in.
    return acc ? signIn(env, role, acc) : json({ error: 'No account for ' + g.email + ' yet.', signup: { email: g.email, name: g.name } }, 404);
  }

  // Set a password after signing in with a code or Google (only when the account has none yet).
  if (sub === 'password' && method === 'POST') {
    const s = await getSession(request, env);
    const table = s?.role === 'parent' ? 'parents' : s?.role === 'coach' ? 'coaches' : null, id = s?.parent_id || s?.coach_id;
    if (!table || !id) return json({ error: 'Please sign in.' }, 401);
    const row = await env.DB.prepare(`SELECT email,(password_hash IS NOT NULL) AS has FROM ${table} WHERE id=?`).bind(id).first();
    if (!row || row.has) return json({ error: 'You already have a password. Change it from Account.' }, 400);
    { const bad = passwordProblem(body.password, row.email); if (bad) return json({ error: bad }, 400); }
    const { salt, hash } = await makePassword(body.password);
    await env.DB.prepare(`UPDATE ${table} SET password_hash=?,password_salt=? WHERE id=?`).bind(hash, salt, id).run();
    return json({ ok: true });
  }
  return json({ error: 'Unknown sign-in route.' }, 404);
}
