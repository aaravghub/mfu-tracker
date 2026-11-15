import { json, cleanEmail, isEmail, clientKey, isBlocked, recordFail, clearFails, checkPassword, makePassword, passwordProblem } from './util.js';
import { getSession, startSession } from './auth.js';
import { studentDetail, portalBody } from './parent.js';
import { savePhoto } from './photos.js';

// Student accounts: a student signs up, MFU links the request to their student record, then they sign in and see
// the same portal parents see, about themselves only.

const SESSION_SECONDS = 7 * 24 * 3600;

export async function handleStudent(path, method, request, env) {
  if (!path.startsWith('student/')) return null;
  const sub = path.slice('student/'.length);
  const body = method === 'POST' && sub !== 'photo' ? await request.json().catch(() => ({})) : {};

  if (sub === 'login' && method === 'POST') {
    const email = cleanEmail(body.email), key = 'student:' + email + ':' + clientKey(request);
    if (await isBlocked(env, key)) return json({ error: 'Too many attempts. Please wait 15 minutes and try again.' }, 429);
    const s = isEmail(email) ? await env.DB.prepare('SELECT id,password_hash,password_salt FROM students WHERE lower(email)=? AND COALESCE(active,1)=1').bind(email).first() : null;
    if (!s || typeof body.password !== 'string' || !await checkPassword(body.password, s.password_salt, s.password_hash)) { await recordFail(env, key); return json({ error: 'Incorrect email or password.' }, 401); }
    await clearFails(env, key);
    await env.DB.prepare("UPDATE students SET last_login=datetime('now') WHERE id=?").bind(s.id).run();
    return json({ ok: true, role: 'student' }, 200, { 'set-cookie': await startSession(env, 'student', SESSION_SECONDS, null, null, s.id) });
  }

  // Sign-up: waits for MFU to link it to the right student record.
  if (sub === 'signup' && method === 'POST') {
    const email = cleanEmail(body.email), first = String(body.first_name || '').trim().slice(0, 80), last = String(body.last_name || '').trim().slice(0, 80);
    if (!first || !last || !isEmail(email)) return json({ error: 'Enter your name and email.' }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.dob || '')) return json({ error: 'Enter your date of birth.' }, 400);
    { const bad = passwordProblem(body.password, email); if (bad) return json({ error: bad }, 400); }
    if (await env.DB.prepare('SELECT 1 FROM students WHERE lower(email)=?').bind(email).first()) return json({ error: 'There is already a student account for that email. Sign in instead.' }, 400);
    const { salt, hash } = await makePassword(body.password);
    await env.DB.prepare("INSERT INTO student_requests(id,first_name,last_name,dob,email,parent_email,password_hash,password_salt,status,created_at) VALUES(?,?,?,?,?,?,?,?,'pending',datetime('now'))")
      .bind(crypto.randomUUID(), first, last, body.dob, email, cleanEmail(body.parent_email) || null, hash, salt).run();
    return json({ ok: true });
  }

  const s = await getSession(request, env);
  if (!s || s.role !== 'student' || !s.student_id) return json({ error: 'Please sign in.' }, 401);
  const me = await env.DB.prepare('SELECT id,first_name,last_name,center_id,photo_url,pole_level,rope_level,yoga_level,email FROM students WHERE id=? AND COALESCE(active,1)=1').bind(s.student_id).first();
  if (!me) return json({ error: 'Please sign in.' }, 401);

  if (sub === 'home' && method === 'GET') {
    const children = [await studentDetail(env, me)];
    return json(await portalBody(env, { id: null, name: me.first_name, email: me.email }, children));
  }
  if (sub === 'photo' && method === 'POST') return savePhoto(env, 'student', me.id, request, me.first_name);
  if (sub === 'tour' && method === 'POST') { await env.DB.prepare('UPDATE students SET tour_done=1 WHERE id=?').bind(me.id).run(); return json({ ok: true }); }
  return json({ error: 'Unknown API route.' }, 404);
}

// Admin and coaches: student sign-ups waiting to be linked to a student record.
export async function handleStudentRequests(path, method, request, env) {
  const [root, id] = path.split('/');
  if (root !== 'student-requests') return null;
  if (method === 'GET') return json((await env.DB.prepare("SELECT id,first_name,last_name,dob,email,parent_email,status,created_at FROM student_requests WHERE status='pending' ORDER BY created_at").all()).results);
  if (method === 'POST' && id) {
    const b = await request.json().catch(() => ({}));
    const r = await env.DB.prepare("SELECT * FROM student_requests WHERE id=? AND status='pending'").bind(id).first();
    if (!r) return json({ error: 'Already handled.' }, 404);
    if (b.action === 'reject') { await env.DB.prepare("UPDATE student_requests SET status='rejected',password_hash='',password_salt='' WHERE id=?").bind(id).run(); return json({ ok: true }); }
    if (!b.student_id) return json({ error: 'Choose the student this account belongs to.' }, 400);
    const res = await env.DB.batch([
      env.DB.prepare('UPDATE students SET email=?,password_hash=?,password_salt=?,dob=COALESCE(dob,?) WHERE id=?').bind(r.email, r.password_hash, r.password_salt, r.dob, b.student_id),
      env.DB.prepare("UPDATE student_requests SET status='linked',student_id=?,password_hash='',password_salt='' WHERE id=?").bind(b.student_id, id)
    ]);
    if (!res[0].meta.changes) return json({ error: 'Student not found.' }, 404);
    return json({ ok: true });
  }
  return json({ error: 'Method not allowed.' }, 405);
}
