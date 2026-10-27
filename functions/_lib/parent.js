import { json, cleanEmail, isEmail, checkPassword, makePassword, sha256, randomHex, isBlocked, recordFail, clearFails, clientKey } from './util.js';
import { getSession, startSession, endSession } from './auth.js';
import { mailConfigured, sendMessages, siteUrl, wrap } from './mail.js';
import { esc } from './util.js';

const PARENT_SESSION_SECONDS = 7 * 24 * 3600;
const TOKEN_SECONDS = 7 * 24 * 3600;

// Creates a one-time "set your password" link for a parent.
export async function createSetupLink(env, request, parentId) {
  const token = randomHex(32);
  await env.DB.prepare('DELETE FROM password_tokens WHERE parent_id=?').bind(parentId).run();
  await env.DB.prepare('INSERT INTO password_tokens(token_hash,parent_id,expires_at) VALUES(?,?,?)').bind(await sha256(token), parentId, Math.floor(Date.now() / 1000) + TOKEN_SECONDS).run();
  return siteUrl(env, request) + '/#setup=' + token;
}

export async function emailSetupLinks(env, request, items) {
  // items: [{parent, link, reset}]
  if (!mailConfigured(env)) return { sent: 0, failed: items.length, error: 'Email is not configured.' };
  const msgs = items.map(({ parent, link, reset }) => {
    const hi = parent.name ? `Hi ${parent.name},` : 'Hello,';
    const lead = reset ? 'Use the button below to choose a new password for your MFU parent portal account.' : 'You have been invited to the MFU parent portal, where you can follow your child\'s progress and see upcoming evaluations, competitions and forms.';
    return {
      to: parent.email,
      subject: reset ? 'Reset your MFU parent portal password' : 'Your MFU parent portal invitation',
      html: wrap(`<p style="margin:0 0 14px">${esc(hi)}</p><p style="margin:0 0 18px;line-height:1.55">${esc(lead)}</p><p style="margin:0 0 18px"><a href="${esc(link)}" style="display:inline-block;background:#f26b21;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:8px">Set my password</a></p><p style="color:#536075;font-size:13px;margin:0">This link works for 7 days. Sign in with this email address afterwards.</p>`),
      text: `${hi}\n\n${lead}\n\nSet your password: ${link}\n\nThis link works for 7 days.`
    };
  });
  return sendMessages(env, msgs);
}

async function childrenFor(env, parentId) {
  const students = (await env.DB.prepare("SELECT s.id,s.first_name,s.last_name,s.center_id,s.photo_url,s.pole_level,s.rope_level,s.yoga_level FROM parent_students ps JOIN students s ON s.id=ps.student_id WHERE ps.parent_id=? AND COALESCE(s.active,1)=1 ORDER BY s.first_name").bind(parentId).all()).results;
  const out = [];
  for (const s of students) {
    const [batches, agg, recent, skills, routines] = await env.DB.batch([
      env.DB.prepare('SELECT b.name,b.days,b.start_time,b.end_time FROM batch_students bs JOIN batches b ON b.id=bs.batch_id WHERE bs.student_id=? ORDER BY b.name').bind(s.id),
      env.DB.prepare("SELECT status,COUNT(*) n FROM student_attendance WHERE student_id=? AND attendance_date>=date('now','-90 days') GROUP BY status").bind(s.id),
      env.DB.prepare('SELECT sa.attendance_date,sa.status,b.name AS batch FROM student_attendance sa LEFT JOIN batches b ON b.id=sa.batch_id WHERE sa.student_id=? ORDER BY sa.attendance_date DESC LIMIT 8').bind(s.id),
      env.DB.prepare("SELECT sk.id,sk.apparatus,sk.level,sk.name,sk.description,sk.video_url,COALESCE(p.status,'not_started') AS status FROM skills sk LEFT JOIN student_skill_progress p ON p.skill_id=sk.id AND p.student_id=? WHERE COALESCE(sk.active,1)=1 ORDER BY sk.apparatus,sk.level,sk.sort_order,sk.name").bind(s.id),
      env.DB.prepare('SELECT apparatus,content,photo_url FROM routines WHERE student_id=?').bind(s.id)
    ]);
    const att = { present: 0, late: 0, absent: 0, excused: 0 };
    for (const r of agg.results) att[r.status] = r.n;
    out.push({ ...s, batches: batches.results, attendance: att, recent_attendance: recent.results, skills: skills.results, routines: routines.results });
  }
  return out;
}

export async function handleParent(path, method, request, env) {
  const sub = path.replace(/^parent\/?/, '');
  const body = method === 'POST' ? await request.json().catch(() => ({})) : {};

  if (sub === 'login' && method === 'POST') {
    const email = cleanEmail(body.email), key = 'parent:' + email + ':' + clientKey(request);
    if (await isBlocked(env, key)) return json({ error: 'Too many attempts. Please wait 15 minutes and try again.' }, 429);
    const p = isEmail(email) ? await env.DB.prepare('SELECT id,password_hash,password_salt,active FROM parents WHERE email=?').bind(email).first() : null;
    const ok = p && p.active !== 0 && typeof body.password === 'string' && await checkPassword(body.password, p.password_salt, p.password_hash);
    if (!ok) { await recordFail(env, key); return json({ error: 'Incorrect email or password.' }, 401); }
    await clearFails(env, key);
    await env.DB.prepare("UPDATE parents SET last_login=datetime('now') WHERE id=?").bind(p.id).run();
    return json({ ok: true, role: 'parent' }, 200, { 'set-cookie': await startSession(env, 'parent', PARENT_SESSION_SECONDS, p.id) });
  }

  if (sub === 'forgot' && method === 'POST') {
    const email = cleanEmail(body.email), key = 'forgot:' + clientKey(request);
    const generic = json({ ok: true, message: 'If that email has a parent account, a link to set a password is on its way.' });
    if (!isEmail(email) || await isBlocked(env, key, 5, 3600)) return generic;
    await recordFail(env, key, 3600);
    const p = await env.DB.prepare('SELECT id,email,name,password_hash FROM parents WHERE email=? AND COALESCE(active,1)=1').bind(email).first();
    if (p && mailConfigured(env)) await emailSetupLinks(env, request, [{ parent: p, link: await createSetupLink(env, request, p.id), reset: !!p.password_hash }]);
    return generic;
  }

  if (sub === 'set-password' && method === 'POST') {
    const pw = body.password;
    if (typeof body.token !== 'string' || typeof pw !== 'string' || pw.length < 8 || pw.length > 200) return json({ error: 'Choose a password with at least 8 characters.' }, 400);
    const th = await sha256(body.token);
    const row = await env.DB.prepare('SELECT parent_id,expires_at FROM password_tokens WHERE token_hash=?').bind(th).first();
    if (!row || row.expires_at < Math.floor(Date.now() / 1000)) return json({ error: 'This link has expired. Ask for a new one from the sign-in page.' }, 400);
    const { salt, hash } = await makePassword(pw);
    await env.DB.batch([
      env.DB.prepare('UPDATE parents SET password_hash=?,password_salt=?,last_login=datetime(\'now\') WHERE id=?').bind(hash, salt, row.parent_id),
      env.DB.prepare('DELETE FROM password_tokens WHERE parent_id=?').bind(row.parent_id),
      env.DB.prepare("DELETE FROM sessions WHERE role='parent' AND parent_id=?").bind(row.parent_id)
    ]);
    return json({ ok: true, role: 'parent' }, 200, { 'set-cookie': await startSession(env, 'parent', PARENT_SESSION_SECONDS, row.parent_id) });
  }

  // Everything below needs a parent session.
  const s = await getSession(request, env);
  if (!s || s.role !== 'parent' || !s.parent_id) return json({ error: 'Please sign in.' }, 401);
  const parent = await env.DB.prepare('SELECT id,email,name FROM parents WHERE id=? AND COALESCE(active,1)=1').bind(s.parent_id).first();
  if (!parent) { await endSession(request, env); return json({ error: 'Please sign in.' }, 401); }

  if (sub === 'password' && method === 'POST') {
    const cur = await env.DB.prepare('SELECT password_hash,password_salt FROM parents WHERE id=?').bind(parent.id).first();
    if (!(await checkPassword(String(body.current || ''), cur.password_salt, cur.password_hash))) return json({ error: 'Your current password is incorrect.' }, 400);
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 200) return json({ error: 'New password must be at least 8 characters.' }, 400);
    const { salt, hash } = await makePassword(body.password);
    await env.DB.prepare('UPDATE parents SET password_hash=?,password_salt=? WHERE id=?').bind(hash, salt, parent.id).run();
    return json({ ok: true });
  }

  if (sub === 'home' && method === 'GET') {
    const children = await childrenFor(env, parent.id);
    const centers = [...new Set(children.map(c => c.center_id).filter(Boolean))];
    const marks = centers.map(() => '?').join(',');
    const events = (await env.DB.prepare("SELECT id,title,event_type,event_date,event_time,location,center_id,details,signup_url FROM events WHERE event_date>=date('now','-1 day') AND (center_id IS NULL OR center_id=''" + (centers.length ? ' OR center_id IN (' + marks + ')' : '') + ') ORDER BY event_date,event_time').bind(...centers).all()).results;
    const links = (await env.DB.prepare('SELECT id,title,url,category,description FROM links ORDER BY category,title').all()).results;
    const shop = (await env.DB.prepare('SELECT id,title,url,category,price,description FROM shop_items ORDER BY category,title').all()).results;
    return json({ parent, children, events, links, shop });
  }

  return json({ error: 'Unknown API route.' }, 404);
}
