import { json, cleanEmail, isEmail, checkPassword, makePassword, sha256, randomHex, isBlocked, recordFail, clearFails, clientKey, esc, passwordProblem } from './util.js';
import { getSession, startSession } from './auth.js';
import { mailConfigured, sendMessages, siteUrl, wrap } from './mail.js';

const COACH_SESSION_SECONDS = 7 * 24 * 3600;
const TOKEN_SECONDS = 7 * 24 * 3600;

export async function createCoachSetupLink(env, request, coachId) {
  const token = randomHex(32);
  await env.DB.prepare('DELETE FROM coach_password_tokens WHERE coach_id=?').bind(coachId).run();
  await env.DB.prepare('INSERT INTO coach_password_tokens(token_hash,coach_id,expires_at) VALUES(?,?,?)').bind(await sha256(token), coachId, Math.floor(Date.now() / 1000) + TOKEN_SECONDS).run();
  return siteUrl(env, request) + '/#coach-setup=' + token;
}

async function emailCoachLink(env, coach, link, reset) {
  const hi = coach.name ? `Hi ${coach.name},` : 'Hello,';
  const lead = reset ? 'Use the button below to choose a new password for your MFU coach account.' : 'You now have an MFU Tracker coach account. Use it to take attendance, run evaluations, add notes and see meeting requests from parents.';
  return sendMessages(env, [{
    to: coach.email,
    subject: reset ? 'Reset your MFU coach password' : 'Your MFU coach account',
    html: wrap(`<p style="margin:0 0 14px">${esc(hi)}</p><p style="margin:0 0 18px;line-height:1.55">${esc(lead)}</p><p style="margin:0 0 18px"><a href="${esc(link)}" style="display:inline-block;background:#f26b21;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:8px">Set my password</a></p><p style="color:#536075;font-size:13px;margin:0">This link works for 7 days. Sign in on the Coach tab with this email address afterwards.</p>`),
    text: `${hi}\n\n${lead}\n\nSet your password: ${link}\n\nThis link works for 7 days.`
  }]);
}

const findCoach = (env, email) => env.DB.prepare('SELECT id,name,email,password_hash,password_salt,active FROM coaches WHERE lower(email)=? ORDER BY (password_hash IS NULL),rowid LIMIT 1').bind(email).first();

// Public coach routes: coach/login, coach/forgot, coach/set-password, coach/password.
export async function handleCoachAuth(path, method, request, env) {
  const sub = path.replace(/^coach\/?/, '');
  const body = method === 'POST' ? await request.json().catch(() => ({})) : {};

  if (sub === 'login' && method === 'POST') {
    const email = cleanEmail(body.email), key = 'coach:' + email + ':' + clientKey(request);
    if (await isBlocked(env, key)) return json({ error: 'Too many attempts. Please wait 15 minutes and try again.' }, 429);
    const c = isEmail(email) ? await findCoach(env, email) : null;
    const ok = c && c.active !== 0 && typeof body.password === 'string' && await checkPassword(body.password, c.password_salt, c.password_hash);
    if (!ok) { await recordFail(env, key); return json({ error: 'Incorrect email or password.' }, 401); }
    await clearFails(env, key);
    await env.DB.prepare("UPDATE coaches SET last_login=datetime('now') WHERE id=?").bind(c.id).run();
    return json({ ok: true, role: 'coach' }, 200, { 'set-cookie': await startSession(env, 'coach', COACH_SESSION_SECONDS, null, c.id) });
  }

  if (sub === 'forgot' && method === 'POST') {
    const email = cleanEmail(body.email), key = 'coach-forgot:' + clientKey(request);
    const generic = json({ ok: true, message: 'If that email belongs to a coach, a link to set a password is on its way.' });
    if (!isEmail(email) || await isBlocked(env, key, 5, 3600)) return generic;
    await recordFail(env, key, 3600);
    const c = await findCoach(env, email);
    if (c && c.active !== 0 && mailConfigured(env)) await emailCoachLink(env, c, await createCoachSetupLink(env, request, c.id), !!c.password_hash);
    return generic;
  }

  if (sub === 'set-password' && method === 'POST') {
    const pw = body.password;
    if (typeof body.token !== 'string') return json({ error: 'This link is not valid.' }, 400);
    const th = await sha256(body.token);
    const row = await env.DB.prepare('SELECT t.coach_id,t.expires_at,c.email FROM coach_password_tokens t JOIN coaches c ON c.id=t.coach_id WHERE t.token_hash=?').bind(th).first();
    if (!row || row.expires_at < Math.floor(Date.now() / 1000)) return json({ error: 'This link has expired. Ask the admin for a new one.' }, 400);
    { const bad = passwordProblem(pw, row.email); if (bad) return json({ error: bad }, 400); }
    const { salt, hash } = await makePassword(pw);
    await env.DB.batch([
      env.DB.prepare("UPDATE coaches SET password_hash=?,password_salt=?,last_login=datetime('now') WHERE id=?").bind(hash, salt, row.coach_id),
      env.DB.prepare('DELETE FROM coach_password_tokens WHERE coach_id=?').bind(row.coach_id),
      env.DB.prepare("DELETE FROM sessions WHERE role='coach' AND coach_id=?").bind(row.coach_id)
    ]);
    return json({ ok: true, role: 'coach' }, 200, { 'set-cookie': await startSession(env, 'coach', COACH_SESSION_SECONDS, null, row.coach_id) });
  }

  if (sub === 'password' && method === 'POST') {
    const s = await getSession(request, env);
    if (!s || s.role !== 'coach' || !s.coach_id) return json({ error: 'Please sign in.' }, 401);
    const cur = await env.DB.prepare('SELECT password_hash,password_salt FROM coaches WHERE id=?').bind(s.coach_id).first();
    if (!cur || !(await checkPassword(String(body.current || ''), cur.password_salt, cur.password_hash))) return json({ error: 'Your current password is incorrect.' }, 400);
    { const em = await env.DB.prepare('SELECT email FROM coaches WHERE id=?').bind(s.coach_id).first(); const bad = passwordProblem(body.password, em?.email); if (bad) return json({ error: bad }, 400); }
    const { salt, hash } = await makePassword(body.password);
    await env.DB.prepare('UPDATE coaches SET password_hash=?,password_salt=? WHERE id=?').bind(hash, salt, s.coach_id).run();
    return json({ ok: true });
  }

  return json({ error: 'Unknown API route.' }, 404);
}

// Admin-only: coach-accounts (list), coach-accounts/:id/invite, coach-accounts/:id/disable.
export async function handleCoachAccounts(path, method, request, env) {
  const [, id, action] = path.split('/');
  if (method === 'GET' && !id) {
    const rows = (await env.DB.prepare('SELECT id,name,email,center_id,active,last_login,invited_at,(password_hash IS NOT NULL) AS has_password FROM coaches ORDER BY name').all()).results;
    return json({ coaches: rows, email: mailConfigured(env) });
  }
  if (id && method === 'POST' && action === 'invite') {
    const c = await env.DB.prepare('SELECT id,name,email,password_hash FROM coaches WHERE id=?').bind(id).first();
    if (!c) return json({ error: 'Not found' }, 404);
    if (!isEmail(cleanEmail(c.email))) return json({ error: 'Add an email address to this coach first (Coaches page → Edit).' }, 400);
    const dup = await env.DB.prepare('SELECT COUNT(*) n FROM coaches WHERE lower(email)=lower(?)').bind(c.email).first();
    if (dup.n > 1) return json({ error: 'Two coaches share this email. Give each coach their own email first.' }, 400);
    const link = await createCoachSetupLink(env, request, c.id);
    if (!mailConfigured(env)) return json({ ok: true, emailed: false, link });
    const r = await emailCoachLink(env, { ...c, email: cleanEmail(c.email) }, link, !!c.password_hash);
    if (r.sent) await env.DB.prepare("UPDATE coaches SET invited_at=datetime('now') WHERE id=?").bind(c.id).run();
    return json({ ok: true, emailed: r.sent > 0, link: r.sent ? undefined : link, error: r.error });
  }
  if (id && method === 'POST' && action === 'revoke') {
    await env.DB.batch([
      env.DB.prepare('UPDATE coaches SET password_hash=NULL,password_salt=NULL WHERE id=?').bind(id),
      env.DB.prepare("DELETE FROM sessions WHERE role='coach' AND coach_id=?").bind(id),
      env.DB.prepare('DELETE FROM coach_password_tokens WHERE coach_id=?').bind(id)
    ]);
    return json({ ok: true });
  }
  return json({ error: 'Method not allowed.' }, 405);
}
