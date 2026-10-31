import { json, cleanEmail, isEmail, checkPassword, makePassword, sha256, randomHex, isBlocked, recordFail, clearFails, clientKey, passwordProblem } from './util.js';
import { getSession, startSession, endSession } from './auth.js';
import { mailConfigured, sendMessages, siteUrl, wrap } from './mail.js';
import { esc } from './util.js';
import { parentExtras, handleParentFeatures } from './features.js';
import { parentForms, handleParentForms } from './forms.js';

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
  for (const s of students) out.push(await studentDetail(env, s));
  return out;
}

// Everything a parent sees about one child. The admin/coach student profile reuses it.
export async function studentDetail(env, s) {
  {
    const [batches, agg, recent, skills, routines] = await env.DB.batch([
      env.DB.prepare("SELECT b.name,b.days,b.start_time,b.end_time,0 AS drop_in FROM batch_students bs JOIN batches b ON b.id=bs.batch_id WHERE bs.student_id=? UNION SELECT b.name,b.days,b.start_time,b.end_time,1 FROM student_attendance sa JOIN batches b ON b.id=sa.batch_id WHERE sa.student_id=? AND sa.drop_in=1 AND sa.attendance_date>=date('now','-90 days') AND NOT EXISTS(SELECT 1 FROM batch_students x WHERE x.batch_id=sa.batch_id AND x.student_id=sa.student_id) ORDER BY 1").bind(s.id, s.id),
      env.DB.prepare("SELECT status,COUNT(*) n FROM student_attendance WHERE student_id=? AND attendance_date>=date('now','-90 days') GROUP BY status").bind(s.id),
      env.DB.prepare('SELECT sa.attendance_date,sa.status,sa.drop_in,b.name AS batch FROM student_attendance sa LEFT JOIN batches b ON b.id=sa.batch_id WHERE sa.student_id=? ORDER BY sa.attendance_date DESC LIMIT 8').bind(s.id),
      env.DB.prepare("SELECT sk.id,sk.apparatus,sk.level,sk.name,sk.description,sk.video_url,COALESCE(p.status,'not_started') AS status,p.started_date,p.mastered_date FROM skills sk LEFT JOIN student_skill_progress p ON p.skill_id=sk.id AND p.student_id=? WHERE COALESCE(sk.active,1)=1 ORDER BY sk.apparatus,sk.level,sk.sort_order,sk.name").bind(s.id),
      env.DB.prepare('SELECT apparatus,content,photo_url FROM routines WHERE student_id=?').bind(s.id)
    ]);
    const att = { present: 0, late: 0, absent: 0, excused: 0 };
    for (const r of agg.results) att[r.status] = r.n;
    return { ...s, batches: batches.results, attendance: att, recent_attendance: recent.results, skills: skills.results, routines: routines.results };
  }
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
    if (typeof body.token !== 'string') return json({ error: 'This link is not valid.' }, 400);
    const th = await sha256(body.token);
    const row = await env.DB.prepare('SELECT t.parent_id,t.expires_at,p.email FROM password_tokens t JOIN parents p ON p.id=t.parent_id WHERE t.token_hash=?').bind(th).first();
    if (!row || row.expires_at < Math.floor(Date.now() / 1000)) return json({ error: 'This link has expired. Ask for a new one from the sign-in page.' }, 400);
    { const bad = passwordProblem(pw, row.email); if (bad) return json({ error: bad }, 400); }
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
    { const bad = passwordProblem(body.password, parent.email); if (bad) return json({ error: bad }, 400); }
    const { salt, hash } = await makePassword(body.password);
    await env.DB.prepare('UPDATE parents SET password_hash=?,password_salt=? WHERE id=?').bind(hash, salt, parent.id).run();
    return json({ ok: true });
  }

  if (sub === 'tour' && method === 'POST') {
    await env.DB.prepare('UPDATE parents SET tour_done=1 WHERE id=?').bind(parent.id).run();
    return json({ ok: true });
  }

  if (sub === 'home' && method === 'GET') {
    const children = await childrenFor(env, parent.id);
    const centers = [...new Set(children.map(c => c.center_id).filter(Boolean))];
    const marks = centers.map(() => '?').join(',');
    const events = (await env.DB.prepare("SELECT id,title,event_type,event_date,event_time,location,center_id,details,signup_url FROM events WHERE event_date>=date('now','-1 day') AND (center_id IS NULL OR center_id=''" + (centers.length ? ' OR center_id IN (' + marks + ')' : '') + ') ORDER BY event_date,event_time').bind(...centers).all()).results;
    const links = (await env.DB.prepare('SELECT id,title,url,category,description FROM links ORDER BY category,title').all()).results;
    const shop = (await env.DB.prepare('SELECT id,title,url,category,price,description FROM shop_items ORDER BY category,title').all()).results;
    const extras = await parentExtras(env, parent, children);
    // Demos their children are in show up alongside evaluations and competitions.
    const seen = new Set();
    for (const c of children) for (const d of c.demos) if (d.demo_date >= new Date(Date.now() - 864e5).toISOString().slice(0, 10) && !seen.has(d.id)) { seen.add(d.id); events.push({ id: d.id, title: d.title, event_type: 'demo', event_date: d.demo_date, event_time: d.start_time, arrive_time: d.arrive_time, location: d.location, details: d.details }); }
    events.sort((a, b) => (a.event_date + (a.event_time || '')).localeCompare(b.event_date + (b.event_time || '')));
    const forms = await parentForms(env, parent, children);
    return json({ parent, children, events, links, shop, forms, ...extras });
  }

  { const f = await handleParentFeatures(sub, method, body, env, request, parent); if (f) return f; }
  { const f = await handleParentForms(sub, method, body, env, parent); if (f) return f; }

  return json({ error: 'Unknown API route.' }, 404);
}
