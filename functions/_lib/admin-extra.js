import { json, cleanEmail, isEmail, isHttpUrl, esc } from './util.js';
import { createSetupLink, emailSetupLinks } from './parent.js';
import { handleAttendance } from './attendance.js';
import { mailConfigured, sendMessages, renderEmail, siteUrl } from './mail.js';

const STATUS = new Set(['not_started', 'learning', 'mastered']);
const marks = a => a.map(() => '?').join(',');

async function setChildren(env, parentId, studentIds) {
  const ids = [...new Set((studentIds || []).filter(x => typeof x === 'string'))];
  const stmts = [env.DB.prepare('DELETE FROM parent_students WHERE parent_id=?').bind(parentId)];
  for (const sid of ids) stmts.push(env.DB.prepare('INSERT OR IGNORE INTO parent_students(parent_id,student_id) SELECT ?,id FROM students WHERE id=?').bind(parentId, sid));
  await env.DB.batch(stmts);
}

async function listParents(env) {
  const parents = (await env.DB.prepare('SELECT id,email,name,active,last_login,invited_at,created_at,(password_hash IS NOT NULL) AS has_password FROM parents ORDER BY name,email').all()).results;
  const links = (await env.DB.prepare("SELECT ps.parent_id,s.id,s.first_name,s.last_name FROM parent_students ps JOIN students s ON s.id=ps.student_id ORDER BY s.first_name").all()).results;
  return parents.map(p => ({ ...p, students: links.filter(l => l.parent_id === p.id).map(l => ({ id: l.id, name: l.first_name + ' ' + l.last_name })) }));
}

// Recipients = distinct parent emails from student records plus parent accounts linked to those students.
export async function recipientsFor(env, audience = {}) {
  let where = "COALESCE(s.active,1)=1", binds = [];
  if (audience.type === 'center' && audience.center_id) { where += ' AND s.center_id=?'; binds.push(audience.center_id); }
  if (audience.type === 'students') {
    const ids = (audience.student_ids || []).filter(x => typeof x === 'string');
    if (!ids.length) return [];
    where += ' AND s.id IN (' + marks(ids) + ')'; binds.push(...ids);
  }
  const map = new Map();
  const add = (email, name) => { email = cleanEmail(email); if (isEmail(email) && !map.has(email)) map.set(email, name || ''); else if (map.has(email) && !map.get(email) && name) map.set(email, name); };
  for (const r of (await env.DB.prepare(`SELECT s.parent_email,s.parent_name FROM students s WHERE ${where} AND s.parent_email IS NOT NULL`).bind(...binds).all()).results) add(r.parent_email, r.parent_name);
  for (const r of (await env.DB.prepare(`SELECT p.email,p.name FROM parents p JOIN parent_students ps ON ps.parent_id=p.id JOIN students s ON s.id=ps.student_id WHERE COALESCE(p.active,1)=1 AND ${where}`).bind(...binds).all()).results) add(r.email, r.name);
  return [...map].map(([email, name]) => ({ email, name }));
}

async function pick(env, table, ids, cols) {
  ids = (ids || []).filter(x => typeof x === 'string').slice(0, 50);
  if (!ids.length) return [];
  return (await env.DB.prepare(`SELECT ${cols} FROM ${table} WHERE id IN (${marks(ids)})`).bind(...ids).all()).results;
}

export async function handleAdminExtra(path, method, request, env, url) {
  const [root, id, action] = path.split('/');
  const body = (method === 'POST' || method === 'PUT') ? await request.clone().json().catch(() => null) : null;

  { const att = await handleAttendance(path, method, request, env, url, body); if (att) return att; }

  // ---- Parent accounts ----
  if (root === 'parents') {
    if (method === 'GET' && !id) return json(await listParents(env));

    if (method === 'POST' && id === 'sync') {
      // Create one account per distinct parent_email on student records, linked to all matching students.
      const rows = (await env.DB.prepare("SELECT id,parent_name,parent_email FROM students WHERE COALESCE(active,1)=1 AND parent_email IS NOT NULL AND TRIM(parent_email)<>''").all()).results;
      const byEmail = new Map();
      for (const r of rows) { const e = cleanEmail(r.parent_email); if (!isEmail(e)) continue; if (!byEmail.has(e)) byEmail.set(e, { name: r.parent_name || '', ids: [] }); byEmail.get(e).ids.push(r.id); }
      let created = 0, linked = 0;
      for (const [email, v] of byEmail) {
        let p = await env.DB.prepare('SELECT id FROM parents WHERE email=?').bind(email).first();
        if (!p) { const pid = crypto.randomUUID(); await env.DB.prepare('INSERT INTO parents(id,email,name) VALUES(?,?,?)').bind(pid, email, v.name).run(); p = { id: pid }; created++; }
        for (const sid of v.ids) { const r = await env.DB.prepare('INSERT OR IGNORE INTO parent_students(parent_id,student_id) VALUES(?,?)').bind(p.id, sid).run(); linked += r.meta.changes || 0; }
      }
      return json({ ok: true, created, linked, total: byEmail.size });
    }

    if (method === 'POST' && id === 'invite-pending') {
      const pending = (await env.DB.prepare("SELECT id,email,name FROM parents WHERE password_hash IS NULL AND COALESCE(active,1)=1").all()).results;
      if (!pending.length) return json({ ok: true, count: 0, sent: 0, failed: 0, links: [] });
      const items = [];
      for (const p of pending) items.push({ parent: p, link: await createSetupLink(env, request, p.id), reset: false });
      if (!mailConfigured(env)) return json({ ok: true, emailed: false, count: items.length, links: items.map(i => ({ email: i.parent.email, name: i.parent.name, link: i.link })) });
      const r = await emailSetupLinks(env, request, items);
      if (r.sent) await env.DB.prepare(`UPDATE parents SET invited_at=datetime('now') WHERE id IN (${marks(pending)})`).bind(...pending.map(p => p.id)).run();
      return json({ ok: true, emailed: true, count: items.length, sent: r.sent, failed: r.failed, error: r.error });
    }

    if (method === 'POST' && !id) {
      const email = cleanEmail(body?.email);
      if (!isEmail(email)) return json({ error: 'Enter a valid email address.' }, 400);
      if (await env.DB.prepare('SELECT 1 x FROM parents WHERE email=?').bind(email).first()) return json({ error: 'A parent account with that email already exists.' }, 400);
      const pid = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO parents(id,email,name) VALUES(?,?,?)').bind(pid, email, String(body.name || '').slice(0, 120)).run();
      await setChildren(env, pid, body.student_ids);
      return json({ ok: true, id: pid }, 201);
    }

    if (id && method === 'POST' && action === 'invite') {
      const p = await env.DB.prepare('SELECT id,email,name,password_hash FROM parents WHERE id=?').bind(id).first();
      if (!p) return json({ error: 'Not found' }, 404);
      const link = await createSetupLink(env, request, p.id);
      if (!mailConfigured(env)) return json({ ok: true, emailed: false, link });
      const r = await emailSetupLinks(env, request, [{ parent: p, link, reset: !!p.password_hash }]);
      if (r.sent) await env.DB.prepare("UPDATE parents SET invited_at=datetime('now') WHERE id=?").bind(p.id).run();
      return json({ ok: true, emailed: r.sent > 0, link: r.sent ? undefined : link, error: r.error });
    }

    if (id && method === 'PUT') {
      const cur = await env.DB.prepare('SELECT id FROM parents WHERE id=?').bind(id).first();
      if (!cur) return json({ error: 'Not found' }, 404);
      const sets = [], vals = [];
      if (body && 'email' in body) { const e = cleanEmail(body.email); if (!isEmail(e)) return json({ error: 'Enter a valid email address.' }, 400); const dup = await env.DB.prepare('SELECT id FROM parents WHERE email=? AND id<>?').bind(e, id).first(); if (dup) return json({ error: 'Another parent already uses that email.' }, 400); sets.push('email=?'); vals.push(e); }
      if (body && 'name' in body) { sets.push('name=?'); vals.push(String(body.name || '').slice(0, 120)); }
      if (body && 'active' in body) { sets.push('active=?'); vals.push(body.active ? 1 : 0); }
      if (sets.length) await env.DB.prepare(`UPDATE parents SET ${sets.join(',')} WHERE id=?`).bind(...vals, id).run();
      if (body && Array.isArray(body.student_ids)) await setChildren(env, id, body.student_ids);
      if (body && body.active === false) await env.DB.prepare("DELETE FROM sessions WHERE role='parent' AND parent_id=?").bind(id).run();
      return json({ ok: true });
    }

    if (id && method === 'DELETE') {
      await env.DB.batch([env.DB.prepare("DELETE FROM sessions WHERE parent_id=?").bind(id), env.DB.prepare('DELETE FROM parents WHERE id=?').bind(id)]);
      return json({ ok: true });
    }
  }

  // ---- Skill progress per student (shown to parents) ----
  if (root === 'student-progress') {
    if (method === 'GET') {
      const sid = url.searchParams.get('student_id');
      if (!sid) return json({ error: 'student_id is required' }, 400);
      return json((await env.DB.prepare('SELECT skill_id,status,started_date,mastered_date FROM student_skill_progress WHERE student_id=?').bind(sid).all()).results);
    }
    if (method === 'POST') {
      if (!body || !body.student_id || !Array.isArray(body.changes)) return json({ error: 'student_id and changes are required' }, 400);
      if (body.changes.length > 500) return json({ error: 'Too many changes at once.' }, 400);
      const stmts = [], dateOk = d => d == null || d === '' || (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z')));
      const todayUtc = new Date().toISOString().slice(0, 10);
      for (const c of body.changes) {
        if (!c || typeof c.skill_id !== 'string' || !STATUS.has(c.status)) return json({ error: 'Each change needs a skill_id and valid status.' }, 400);
        if (!dateOk(c.started_date) || !dateOk(c.mastered_date)) return json({ error: 'Dates must look like 2026-10-29.' }, 400);
        // Dates follow the status: nothing for not started, a start date while learning, a start and mastered date once mastered.
        const started = c.status === 'not_started' ? null : (c.started_date || null);
        const mastered = c.status === 'mastered' ? (c.mastered_date || todayUtc) : null;
        const startedFinal = c.status === 'learning' ? (started || todayUtc) : started;
        if (startedFinal && mastered && mastered < startedFinal) return json({ error: 'The mastered date cannot be before the date they started the skill.' }, 400);
        stmts.push(env.DB.prepare('INSERT INTO student_skill_progress(id,student_id,skill_id,status,started_date,mastered_date) VALUES(?,?,?,?,?,?) ON CONFLICT(student_id,skill_id) DO UPDATE SET status=excluded.status,started_date=excluded.started_date,mastered_date=excluded.mastered_date').bind(crypto.randomUUID(), body.student_id, c.skill_id, c.status, startedFinal, mastered));
      }
      if (stmts.length) await env.DB.batch(stmts);
      return json({ ok: true, saved: stmts.length });
    }
  }

  // ---- Email parents ----
  if (root === 'email') {
    if (id === 'status' && method === 'GET') {
      const log = (await env.DB.prepare('SELECT * FROM email_log ORDER BY created_at DESC LIMIT 15').all()).results;
      return json({ configured: mailConfigured(env), from: mailConfigured(env) ? 'automallakhamb@gmail.com' : null, log });
    }
    if (id === 'send' && method === 'POST') {
      if (!body) return json({ error: 'Expected JSON.' }, 400);
      const subject = String(body.subject || '').trim().slice(0, 200), message = String(body.message || '').trim().slice(0, 5000);
      if (!subject) return json({ error: 'Add a subject line.' }, 400);
      const events = await pick(env, 'events', body.event_ids, 'id,title,event_type,event_date,event_time,location,details,signup_url');
      events.sort((a, b) => a.event_date.localeCompare(b.event_date));
      const links = await pick(env, 'links', body.link_ids, 'id,title,url,description');
      const shop = await pick(env, 'shop_items', body.shop_ids, 'id,title,url,price,description');
      if (!message && !events.length && !links.length && !shop.length) return json({ error: 'Write a message or attach at least one event or link.' }, 400);
      const portalUrl = body.include_portal === false ? '' : siteUrl(env, request);
      const build = name => renderEmail({ greetingName: name, message, events, links, shop, portalUrl });

      if (body.dry_run) {
        const recips = await recipientsFor(env, body.audience);
        return json({ ok: true, recipients: recips.length, html: build('Parent').html });
      }
      if (!mailConfigured(env)) return json({ error: 'Gmail is not set up yet. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN in Cloudflare Pages settings.' }, 400);

      const isTest = !!body.test_to;
      let recips;
      if (isTest) { if (!isEmail(cleanEmail(body.test_to))) return json({ error: 'Enter a valid test email address.' }, 400); recips = [{ email: cleanEmail(body.test_to), name: 'there' }]; }
      else recips = await recipientsFor(env, body.audience);
      if (!recips.length) return json({ error: 'No parent emails match that audience. Add parent emails on student records first.' }, 400);
      if (recips.length > 1000) return json({ error: 'Too many recipients for one send. Narrow the audience by center.' }, 400);

      const msgs = recips.map(r => { const e = build(r.name ? r.name.split(/\s+/)[0] : ''); return { to: r.email, subject: (isTest ? '[TEST] ' : '') + subject, html: e.html, text: e.text }; });
      const r = await sendMessages(env, msgs);
      const aud = isTest ? 'test' : body.audience?.type === 'center' ? 'center:' + body.audience.center_id : body.audience?.type === 'students' ? 'selected students' : 'all parents';
      await env.DB.prepare('INSERT INTO email_log(id,subject,audience,total,sent,failed,is_test) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(), subject, aud, recips.length, r.sent, r.failed, isTest ? 1 : 0).run();
      if (!r.sent) return json({ error: r.error || 'The email provider rejected the message.', sent: 0, failed: r.failed }, 502);
      return json({ ok: true, total: recips.length, sent: r.sent, failed: r.failed, error: r.error || undefined });
    }
  }

  return null;
}
