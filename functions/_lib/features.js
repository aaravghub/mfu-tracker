import { json, cleanEmail, isEmail, isHttpUrl, esc } from './util.js';
import { mailConfigured, sendMessages, siteUrl, wrap } from './mail.js';
import { createMeetEvent, deleteCalendarEvent, writeSpreadsheet } from './google.js';
import { recipientsFor } from './admin-extra.js';
import { studentDetail } from './parent.js';
import { practiceFor, decodeFiles, fileStatements, filesFor, fileResponse, parentCheckin } from './practice.js';

// Calendar & meetings, demos, evaluations, competition scores, notes, fitness, photos, parent requests and announcements.
const marks = a => a.map(() => '?').join(',');
const validDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z'));
const validTime = t => t == null || t === '' || (typeof t === 'string' && /^\d{2}:\d{2}$/.test(t));
const str = (v, max = 2000) => String(v ?? '').trim().slice(0, max);
const APPS = ['pole', 'rope', 'yoga'];
const STAT = new Set(['present', 'absent', 'late', 'excused']);
const METRIC = /^[a-z0-9_]{1,40}$/;
// One-minute timed sets. Each tap's time is kept so the app can graph when a student slowed down.
const REP_EXERCISES = new Set(['dasrang_1min', 'rope_climb_1min', 'pole_climb_1min', 'sadhi_adhi_1min']);
const today = () => new Date().toISOString().slice(0, 10);
export const adminEmail = env => cleanEmail(env.ADMIN_EMAIL || 'automallakhamb@gmail.com');
const all = async (env, sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results;
const one = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).first();
const fmtDate = d => { const t = new Date(String(d) + 'T00:00:00Z'); return isNaN(t) ? String(d) : t.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); };
const fmtTime = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); if (!m) return ''; const h = +m[1]; return `${((h + 11) % 12) + 1}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`; };
const para = s => esc(s).split(/\n{2,}/).map(p => `<p style="margin:0 0 14px;line-height:1.55">${p.replace(/\n/g, '<br>')}</p>`).join('');

// Sends the same short message to a list of {email,name}, one email each.
async function notify(env, people, subject, lines, extraHtml = '') {
  const seen = new Set(), list = [];
  for (const p of people) { const e = cleanEmail(p.email); if (isEmail(e) && !seen.has(e)) { seen.add(e); list.push({ email: e, name: p.name || '' }); } }
  if (!list.length || !mailConfigured(env)) return { sent: 0, failed: list.length, skipped: !mailConfigured(env) };
  const text = lines.join('\n\n');
  return sendMessages(env, list.map(p => ({
    to: p.email, subject,
    html: wrap(`<p style="margin:0 0 14px">${esc(p.name ? 'Hi ' + p.name.split(/\s+/)[0] + ',' : 'Hello,')}</p>${para(text)}${extraHtml}`),
    text: (p.name ? 'Hi ' + p.name.split(/\s+/)[0] + ',' : 'Hello,') + '\n\n' + text + '\n\n— Mallakhamb Federation USA'
  })));
}

export const coachesForStudent = (env, studentId) => all(env, 'SELECT DISTINCT c.id,c.name,c.email FROM batch_students bs JOIN batch_coaches bc ON bc.batch_id=bs.batch_id JOIN coaches c ON c.id=bc.coach_id WHERE bs.student_id=? AND COALESCE(c.active,1)=1', studentId);
const coachStudentIds = async (env, coachId) => (await all(env, 'SELECT DISTINCT bs.student_id FROM batch_coaches bc JOIN batch_students bs ON bs.batch_id=bc.batch_id WHERE bc.coach_id=?', coachId)).map(r => r.student_id);
const parseList = v => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };

/* ---------- evaluation helpers ---------- */
async function evalData(env, eventId) {
  const event = await one(env, 'SELECT * FROM events WHERE id=?', eventId);
  if (!event) return null;
  const [participants, reports, results] = await env.DB.batch([
    env.DB.prepare('SELECT ep.student_id,ep.coach_id,ep.coach2_id,ep.status,s.first_name,s.last_name,s.center_id,s.pole_level,s.rope_level,s.yoga_level,c.name AS coach_name,c2.name AS coach2_name FROM eval_participants ep JOIN students s ON s.id=ep.student_id LEFT JOIN coaches c ON c.id=ep.coach_id LEFT JOIN coaches c2 ON c2.id=ep.coach2_id WHERE ep.event_id=? ORDER BY s.last_name,s.first_name').bind(eventId),
    env.DB.prepare('SELECT r.*,s.first_name,s.last_name,s.center_id,s.pole_level,s.rope_level,s.yoga_level,c.name AS coach_name,c2.name AS coach2_name FROM eval_reports r JOIN students s ON s.id=r.student_id LEFT JOIN coaches c ON c.id=r.coach_id LEFT JOIN coaches c2 ON c2.id=r.coach2_id WHERE r.event_id=? ORDER BY s.last_name,s.first_name,r.apparatus').bind(eventId),
    env.DB.prepare('SELECT er.report_id,er.skill_id,er.result,sk.name,sk.level FROM eval_results er JOIN eval_reports r ON r.id=er.report_id JOIN skills sk ON sk.id=er.skill_id WHERE r.event_id=? ORDER BY sk.level,sk.sort_order,sk.name').bind(eventId)
  ]);
  return {
    event,
    participants: participants.results,
    reports: reports.results.map(r => ({ ...r, current_level: r[r.apparatus + '_level'], results: results.results.filter(x => x.report_id === r.id) }))
  };
}
const changeLabel = r => r.outcome === 'passed' && r.target_level > (r.from_level ?? r.target_level - 1) ? 'Increased' : 'Stayed the same';

/* ---------- parent portal additions ---------- */
export async function parentExtras(env, parent, children) {
  for (const c of children) {
    const [notes, fitness, photos, scores, evals, demos, reps, evalAtt] = await env.DB.batch([
      env.DB.prepare('SELECT n.id,n.worked_on,n.next_steps,n.author_name,n.created_at,b.name AS batch FROM student_notes n LEFT JOIN batches b ON b.id=n.batch_id WHERE n.student_id=? ORDER BY n.created_at DESC LIMIT 20').bind(c.id),
      env.DB.prepare('SELECT record_date,metric,value FROM fitness_records WHERE student_id=? ORDER BY record_date DESC LIMIT 200').bind(c.id),
      env.DB.prepare('SELECT id,url,caption,taken_date,created_at FROM student_photos WHERE student_id=? ORDER BY COALESCE(taken_date,created_at) DESC LIMIT 60').bind(c.id),
      env.DB.prepare('SELECT cs.event_id,cs.apparatus,cs.score,e.title,e.event_date,(SELECT COUNT(*)+1 FROM comp_scores x WHERE x.event_id=cs.event_id AND x.apparatus=cs.apparatus AND x.score>cs.score) AS rank,(SELECT COUNT(*) FROM comp_scores x WHERE x.event_id=cs.event_id AND x.apparatus=cs.apparatus) AS total FROM comp_scores cs JOIN events e ON e.id=cs.event_id WHERE cs.student_id=? ORDER BY e.event_date DESC').bind(c.id),
      env.DB.prepare("SELECT r.apparatus,r.from_level,r.target_level,r.outcome,e.title,e.event_date,(SELECT COUNT(*) FROM eval_results x WHERE x.report_id=r.id AND x.result='pass') AS passed,(SELECT COUNT(*) FROM eval_results x WHERE x.report_id=r.id) AS tried FROM eval_reports r JOIN events e ON e.id=r.event_id WHERE r.student_id=? AND e.finalized_at IS NOT NULL ORDER BY e.event_date DESC").bind(c.id),
      env.DB.prepare('SELECT d.id,d.title,d.demo_date,d.start_time,d.end_time,d.arrive_time,d.location,d.details,ds.status FROM demo_students ds JOIN demos d ON d.id=ds.demo_id WHERE ds.student_id=? ORDER BY d.demo_date DESC').bind(c.id),
      env.DB.prepare('SELECT id,exercise,record_date,total,duration,taps,created_at FROM rep_sessions WHERE student_id=? ORDER BY record_date DESC,created_at DESC LIMIT 30').bind(c.id),
      env.DB.prepare("SELECT e.id,e.title,e.event_date,ep.status FROM eval_participants ep JOIN events e ON e.id=ep.event_id WHERE ep.student_id=? ORDER BY e.event_date DESC").bind(c.id)
    ]);
    c.eval_attendance = evalAtt.results;
    // Demo routines for the demos this child is in (a routine with no performers listed is for the whole group).
    const demoIds = demos.results.map(d => d.id);
    const routines = demoIds.length ? await all(env, `SELECT id,demo_id,title,apparatus,content,video_url,student_ids FROM demo_routines WHERE demo_id IN (${marks(demoIds)}) ORDER BY sort_order,created_at`, ...demoIds) : [];
    for (const d of demos.results) d.routines = routines.filter(r => r.demo_id === d.id).map(r => ({ ...r, student_ids: parseList(r.student_ids) })).filter(r => !r.student_ids.length || r.student_ids.includes(c.id)).map(({ student_ids, ...r }) => r);
    Object.assign(c, { rep_sessions: reps.results.map(r => ({ ...r, taps: parseList(r.taps) })), notes: notes.results, fitness: fitness.results, photos: photos.results, comp_scores: scores.results, evaluations: evals.results.map(r => ({ ...r, change: changeLabel(r) })), demos: demos.results });
    c.coaches = (await coachesForStudent(env, c.id)).map(x => ({ id: x.id, name: x.name }));
    // Month-by-month numbers for the progress graphs (last 12 months).
    const [att, started, done] = await env.DB.batch([
      env.DB.prepare("SELECT substr(attendance_date,1,7) AS month,SUM(status IN ('present','late')) AS n FROM student_attendance WHERE student_id=? AND attendance_date>=date('now','start of month','-11 months') GROUP BY month").bind(c.id),
      env.DB.prepare("SELECT substr(started_date,1,7) AS month,COUNT(*) AS n FROM student_skill_progress WHERE student_id=? AND started_date>=date('now','start of month','-11 months') GROUP BY month").bind(c.id),
      env.DB.prepare("SELECT substr(mastered_date,1,7) AS month,COUNT(*) AS n FROM student_skill_progress WHERE student_id=? AND status='mastered' AND mastered_date>=date('now','start of month','-11 months') GROUP BY month").bind(c.id)
    ]);
    c.monthly = { attendance: att.results, started: started.results, completed: done.results };
  }
  // Home practice assigned by coaches.
  const practice = await practiceFor(env, children.map(c => c.id));
  for (const c of children) c.practice = practice.filter(a => a.student_id === c.id);
  const centers = [...new Set(children.map(c => c.center_id).filter(Boolean))];
  const announcements = await all(env, "SELECT a.id,a.title,a.body,a.pinned,a.created_at,a.created_by,a.form_id,f.title AS form_title FROM announcements a LEFT JOIN forms f ON f.id=a.form_id AND f.status='open' WHERE a.audience IN ('all','parents') AND (a.center_id IS NULL OR a.center_id=''" + (centers.length ? ' OR a.center_id IN (' + marks(centers) + ')' : '') + ') ORDER BY a.pinned DESC,a.created_at DESC LIMIT 50', ...centers);
  const meetings = (await all(env, "SELECT id,title,meeting_date,start_time,end_time,location,description,meet_url,attendees FROM meetings WHERE meeting_date>=date('now','-1 day') ORDER BY meeting_date,start_time"))
    .filter(m => parseList(m.attendees).map(cleanEmail).includes(cleanEmail(parent.email))).map(({ attendees, ...m }) => m);
  const requests = await all(env, 'SELECT r.id,r.kind,r.subject,r.message,r.preferred_times,r.status,r.reply,r.replied_by,r.replied_at,r.created_at,s.first_name,s.last_name FROM parent_requests r LEFT JOIN students s ON s.id=r.student_id WHERE r.parent_id=? ORDER BY r.created_at DESC LIMIT 50', parent.id);
  const files = await filesFor(env, requests.map(r => r.id));
  for (const r of requests) r.files = files.filter(f => f.request_id === r.id);
  return { announcements, meetings, requests };
}

export async function handleParentFeatures(sub, method, body, env, request, parent) {
  if (sub === 'requests' && method === 'POST') {
    const kind = body.kind === 'meeting' ? 'meeting' : 'question', subject = str(body.subject, 200), message = str(body.message, 4000), times = str(body.preferred_times, 500);
    if (!subject) return json({ error: 'Add a short subject.' }, 400);
    const kid = body.student_id ? await one(env, 'SELECT s.id,s.first_name,s.last_name FROM parent_students ps JOIN students s ON s.id=ps.student_id WHERE ps.parent_id=? AND s.id=?', parent.id, body.student_id) : null;
    if (!kid) return json({ error: 'Choose which child this is about.' }, 400);
    let files;
    try { files = decodeFiles(body.files); } catch (e) { return json({ error: e.message }, 400); }
    const rid = crypto.randomUUID();
    await env.DB.batch([env.DB.prepare('INSERT INTO parent_requests(id,parent_id,student_id,kind,subject,message,preferred_times) VALUES(?,?,?,?,?,?,?)').bind(rid, parent.id, kid.id, kind, subject, message, times), ...fileStatements(env, rid, files)]);
    const coaches = await coachesForStudent(env, kid.id);
    const who = (parent.name || parent.email) + ' (' + parent.email + ')';
    const lines = [`${who} sent a ${kind === 'meeting' ? 'meeting request' : 'question'} about ${kid.first_name} ${kid.last_name}.`, 'Subject: ' + subject];
    if (message) lines.push(message);
    if (times) lines.push('Times that work for them: ' + times);
    if (files.length) lines.push(`${files.length} file${files.length > 1 ? 's' : ''} attached (${files.map(f => f.name).join(', ')}) — open the request in MFU Tracker to see ${files.length > 1 ? 'them' : 'it'}.`);
    lines.push('Reply or schedule a meeting from Parent requests in MFU Tracker: ' + siteUrl(env, request));
    await notify(env, [{ email: adminEmail(env), name: 'Admin' }, ...coaches], (kind === 'meeting' ? 'Meeting request: ' : 'Parent question: ') + subject, lines);
    return json({ ok: true, id: rid, notified: coaches.length + 1, files: files.length }, 201);
  }
  if (sub.startsWith('request-files/') && method === 'GET') return fileResponse(env, sub.split('/')[1], parent.id);
  if (sub === 'practice/checkin' && method === 'POST') return parentCheckin(env, parent.id, body);
  return null;
}

/* ---------- admin & coach routes ---------- */
export async function handleFeatures(path, method, request, env, url, actor) {
  const [root, id, action] = path.split('/');
  const q = k => url.searchParams.get(k);
  const body = (method === 'POST' || method === 'PUT') ? await request.clone().json().catch(() => null) : null;
  const by = actor.name || (actor.role === 'admin' ? 'Admin' : 'Coach');

  // ---- calendar: everything with a date in a range ----
  if (root === 'calendar' && method === 'GET') {
    const from = validDate(q('from')) ? q('from') : today(), to = validDate(q('to')) ? q('to') : '9999-12-31';
    const [events, demos, meetings] = await env.DB.batch([
      env.DB.prepare('SELECT id,title,event_type,event_date AS date,event_time AS start_time,location,center_id FROM events WHERE event_date BETWEEN ? AND ? ORDER BY event_date').bind(from, to),
      env.DB.prepare('SELECT id,title,demo_date AS date,start_time,end_time,location,center_id FROM demos WHERE demo_date BETWEEN ? AND ? ORDER BY demo_date').bind(from, to),
      env.DB.prepare('SELECT id,title,meeting_date AS date,start_time,end_time,location,meet_url FROM meetings WHERE meeting_date BETWEEN ? AND ? ORDER BY meeting_date,start_time').bind(from, to)
    ]);
    return json({ events: events.results, demos: demos.results, meetings: meetings.results });
  }

  // ---- people you can invite to a meeting ----
  if (root === 'meeting-contacts' && method === 'GET') {
    const [coaches, students, parents, bs, bc, batches] = await env.DB.batch([
      env.DB.prepare("SELECT id,name,email FROM coaches WHERE COALESCE(active,1)=1 AND email IS NOT NULL AND TRIM(email)<>'' ORDER BY name"),
      env.DB.prepare("SELECT id,first_name,last_name,parent_name,parent_email FROM students WHERE COALESCE(active,1)=1 ORDER BY first_name,last_name"),
      env.DB.prepare('SELECT p.email,p.name,ps.student_id FROM parents p JOIN parent_students ps ON ps.parent_id=p.id WHERE COALESCE(p.active,1)=1'),
      env.DB.prepare('SELECT batch_id,student_id FROM batch_students'),
      env.DB.prepare('SELECT batch_id,coach_id FROM batch_coaches'),
      env.DB.prepare('SELECT id,name FROM batches WHERE COALESCE(active,1)=1 ORDER BY name')
    ]);
    const fam = new Map(), addFam = (email, name, sid) => { email = cleanEmail(email); if (!isEmail(email)) return; if (!fam.has(email)) fam.set(email, { email, name: name || '', student_ids: [] }); const f = fam.get(email); if (!f.name && name) f.name = name; if (!f.student_ids.includes(sid)) f.student_ids.push(sid); };
    for (const s of students.results) addFam(s.parent_email, s.parent_name, s.id);
    for (const p of parents.results) addFam(p.email, p.name, p.student_id);
    return json({
      coaches: coaches.results.map(c => ({ ...c, email: cleanEmail(c.email) })),
      families: [...fam.values()].map(f => ({ ...f, kids: f.student_ids.map(i => students.results.find(s => s.id === i)).filter(Boolean).map(s => s.first_name + ' ' + s.last_name) })),
      batches: batches.results.map(b => ({ ...b, student_ids: bs.results.filter(x => x.batch_id === b.id).map(x => x.student_id), coach_ids: bc.results.filter(x => x.batch_id === b.id).map(x => x.coach_id) }))
    });
  }

  // ---- meetings (optionally with a Google Meet link and calendar invite) ----
  if (root === 'meetings') {
    if (method === 'GET' && !id) return json((await all(env, 'SELECT * FROM meetings ORDER BY meeting_date DESC,start_time DESC LIMIT 300')).map(m => ({ ...m, attendees: parseList(m.attendees) })));
    if (method === 'POST' && !id) {
      const title = str(body?.title, 200), date = body?.meeting_date, start = body?.start_time || '', end = body?.end_time || '';
      if (!title || !validDate(date)) return json({ error: 'A title and a date are required.' }, 400);
      if (!validTime(start) || !validTime(end)) return json({ error: 'Times must look like 18:30.' }, 400);
      if (start && end && end <= start) return json({ error: 'The end time must be after the start time.' }, 400);
      const attendees = [...new Set((body.attendees || []).map(cleanEmail).filter(isEmail))].slice(0, 200);
      if (!attendees.length) return json({ error: 'Add at least one person to the meeting.' }, 400);
      const description = str(body.description, 4000), location = str(body.location, 300);
      let cal = null;
      if (body.google_meet || body.calendar) {
        try { cal = await createMeetEvent(env, { title, description, date, start, end, attendees, location, meet: !!body.google_meet, sendUpdates: body.send_email === false ? 'none' : 'all' }); }
        catch (e) { return json({ error: 'Could not create the Google calendar invite: ' + e.message }, 502); }
      }
      const mid = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO meetings(id,title,meeting_date,start_time,end_time,location,description,meet_url,calendar_event_id,calendar_url,attendees,request_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .bind(mid, title, date, start || null, end || null, location || null, description, cal?.meetUrl || (isHttpUrl(body.meet_url) ? body.meet_url : null), cal?.id || null, cal?.url || null, JSON.stringify(attendees), body.request_id || null, by).run();
      if (body.request_id) await env.DB.prepare("UPDATE parent_requests SET status='scheduled',meeting_id=? WHERE id=?").bind(mid, body.request_id).run();
      let mail = { sent: 0 };
      if (!cal && body.send_email !== false) {
        const meetUrl = isHttpUrl(body.meet_url) ? body.meet_url : '';
        const when = fmtDate(date) + (start ? ' at ' + fmtTime(start) + (end ? '–' + fmtTime(end) : '') : '');
        mail = await notify(env, attendees.map(email => ({ email })), 'Meeting: ' + title, [`You're invited to “${title}”.`, 'When: ' + when, ...(location ? ['Where: ' + location] : []), ...(meetUrl ? ['Join: ' + meetUrl] : []), ...(description ? [description] : [])]);
      }
      return json({ ok: true, id: mid, meet_url: cal?.meetUrl || null, google_invites: !!cal && body.send_email !== false, emailed: mail.sent || 0 }, 201);
    }
    if (method === 'DELETE' && id) {
      const m = await one(env, 'SELECT calendar_event_id FROM meetings WHERE id=?', id);
      if (m?.calendar_event_id) await deleteCalendarEvent(env, m.calendar_event_id);
      await env.DB.prepare('DELETE FROM meetings WHERE id=?').bind(id).run();
      return json({ ok: true });
    }
  }

  // ---- demos: who's going, when to arrive, where, and who showed up ----
  if (root === 'demos') {
    if (method === 'GET' && !id) {
      const [demos, kids] = await env.DB.batch([
        env.DB.prepare('SELECT * FROM demos ORDER BY demo_date DESC'),
        env.DB.prepare('SELECT ds.demo_id,ds.student_id,ds.status,s.first_name,s.last_name,s.center_id,s.parent_email FROM demo_students ds JOIN students s ON s.id=ds.student_id ORDER BY s.first_name')
      ]);
      const routines = await all(env, 'SELECT * FROM demo_routines ORDER BY sort_order,created_at');
      return json(demos.results.map(d => ({ ...d, students: kids.results.filter(k => k.demo_id === d.id), routines: routines.filter(r => r.demo_id === d.id).map(r => ({ ...r, student_ids: parseList(r.student_ids) })) })));
    }
    if (method === 'POST' && id && action === 'routines') {
      const title = str(body?.title, 200);
      if (!title) return json({ error: 'Give the routine a name.' }, 400);
      if (body.video_url && !isHttpUrl(body.video_url)) return json({ error: 'Links must start with http:// or https://' }, 400);
      if (!(await one(env, 'SELECT 1 x FROM demos WHERE id=?', id))) return json({ error: 'Demo not found.' }, 404);
      const rid = crypto.randomUUID(), n = (await one(env, 'SELECT COUNT(*) n FROM demo_routines WHERE demo_id=?', id)).n;
      await env.DB.prepare('INSERT INTO demo_routines(id,demo_id,title,apparatus,content,video_url,student_ids,sort_order) VALUES(?,?,?,?,?,?,?,?)').bind(rid, id, title, ['pole', 'rope', 'yoga', 'group'].includes(body.apparatus) ? body.apparatus : 'group', str(body.content, 8000), body.video_url || null, JSON.stringify((body.student_ids || []).filter(x => typeof x === 'string')), n).run();
      return json({ ok: true, id: rid }, 201);
    }
    if ((method === 'POST' && !id) || (method === 'PUT' && id)) {
      const title = str(body?.title, 200);
      if (!title || !validDate(body?.demo_date)) return json({ error: 'A title and a date are required.' }, 400);
      if (![body.start_time, body.end_time, body.arrive_time].every(validTime)) return json({ error: 'Times must look like 18:30.' }, 400);
      const did = id || crypto.randomUUID();
      const vals = [title, body.demo_date, body.start_time || null, body.end_time || null, body.arrive_time || null, str(body.location, 300) || null, body.center_id || null, str(body.details, 4000)];
      if (id) await env.DB.prepare('UPDATE demos SET title=?,demo_date=?,start_time=?,end_time=?,arrive_time=?,location=?,center_id=?,details=? WHERE id=?').bind(...vals, id).run();
      else await env.DB.prepare('INSERT INTO demos(title,demo_date,start_time,end_time,arrive_time,location,center_id,details,id) VALUES(?,?,?,?,?,?,?,?,?)').bind(...vals, did).run();
      // Kids are added and removed one by one, so two people editing the same demo don't undo each other.
      const add = [...new Set((body.add_student_ids || body.student_ids || []).filter(x => typeof x === 'string'))], remove = (body.remove_student_ids || []).filter(x => typeof x === 'string');
      const st = [...add.map(sid => env.DB.prepare('INSERT OR IGNORE INTO demo_students(demo_id,student_id) SELECT ?,id FROM students WHERE id=?').bind(did, sid)), ...remove.map(sid => env.DB.prepare('DELETE FROM demo_students WHERE demo_id=? AND student_id=?').bind(did, sid))];
      if (st.length) await env.DB.batch(st);
      return json({ ok: true, id: did }, id ? 200 : 201);
    }
    if (method === 'POST' && id && action === 'attendance') {
      const recs = (body?.records || []).filter(r => r && typeof r.student_id === 'string');
      if (recs.some(r => r.status && !STAT.has(r.status))) return json({ error: 'Unknown attendance status.' }, 400);
      if (recs.length) await env.DB.batch(recs.map(r => env.DB.prepare('UPDATE demo_students SET status=? WHERE demo_id=? AND student_id=?').bind(r.status || null, id, r.student_id)));
      return json({ ok: true, saved: recs.length });
    }
    if (method === 'POST' && id && action === 'email') {
      const d = await one(env, 'SELECT * FROM demos WHERE id=?', id);
      if (!d) return json({ error: 'Not found' }, 404);
      const sids = (await all(env, 'SELECT student_id FROM demo_students WHERE demo_id=?', id)).map(r => r.student_id);
      if (!sids.length) return json({ error: 'Add students to this demo first.' }, 400);
      if (!mailConfigured(env)) return json({ error: 'Gmail is not set up yet.' }, 400);
      const recips = await recipientsFor(env, { type: 'students', student_ids: sids });
      const when = fmtDate(d.demo_date) + (d.start_time ? ' at ' + fmtTime(d.start_time) + (d.end_time ? '–' + fmtTime(d.end_time) : '') : '');
      const r = await notify(env, recips, 'Demo: ' + d.title, [`Your child is part of the “${d.title}” demo.`, 'When: ' + when, ...(d.arrive_time ? ['Please arrive by ' + fmtTime(d.arrive_time) + '.'] : []), ...(d.location ? ['Where: ' + d.location] : []), ...(d.details ? [d.details] : [])]);
      return json({ ok: true, sent: r.sent, failed: r.failed });
    }
    if (method === 'DELETE' && id) { await env.DB.prepare('DELETE FROM demos WHERE id=?').bind(id).run(); return json({ ok: true }); }
  }

  if (root === 'demo-routines' && id) {
    if (method === 'PUT') {
      const title = str(body?.title, 200);
      if (!title) return json({ error: 'Give the routine a name.' }, 400);
      if (body.video_url && !isHttpUrl(body.video_url)) return json({ error: 'Links must start with http:// or https://' }, 400);
      await env.DB.prepare('UPDATE demo_routines SET title=?,apparatus=?,content=?,video_url=?,student_ids=? WHERE id=?').bind(title, ['pole', 'rope', 'yoga', 'group'].includes(body.apparatus) ? body.apparatus : 'group', str(body.content, 8000), body.video_url || null, JSON.stringify((body.student_ids || []).filter(x => typeof x === 'string')), id).run();
      return json({ ok: true });
    }
    if (method === 'DELETE') { await env.DB.prepare('DELETE FROM demo_routines WHERE id=?').bind(id).run(); return json({ ok: true }); }
  }

  // ---- one student's full profile (same view parents get) ----
  if (root === 'student-summary' && method === 'GET') {
    const s = await one(env, 'SELECT id,first_name,last_name,center_id,photo_url,pole_level,rope_level,yoga_level,parent_name,parent_email,parent_phone,notes,active FROM students WHERE id=?', q('student_id') || '');
    if (!s) return json({ error: 'Student not found.' }, 404);
    const child = await studentDetail(env, s);
    await parentExtras(env, { id: '', email: '' }, [child]);
    child.parents = await all(env, 'SELECT p.id,p.name,p.email,(p.password_hash IS NOT NULL) AS has_password,p.last_login FROM parent_students ps JOIN parents p ON p.id=ps.parent_id WHERE ps.student_id=?', s.id);
    return json(child);
  }

  // ---- the tutorial only plays on a coach's first sign-in ----
  if (root === 'tour' && method === 'POST') {
    if (actor.role === 'coach') await env.DB.prepare('UPDATE coaches SET tour_done=1 WHERE id=?').bind(actor.id).run();
    return json({ ok: true });
  }

  // ---- evaluations: participants, assigned evaluator, attendance, per-skill reports, summary, Google Sheet ----
  if (root === 'evaluations' && id) {
    if (method === 'GET' && !action) { const d = await evalData(env, id); return d ? json(d) : json({ error: 'Not found' }, 404); }
    const event = await one(env, 'SELECT id,title,event_date,event_type,sheet_id,finalized_at FROM events WHERE id=?', id);
    if (!event) return json({ error: 'Evaluation not found.' }, 404);
    if (method === 'POST' && action === 'participants') {
      // Only adds/updates the students sent and removes the ones listed, so two laptops adding kids never wipe each other out.
      const list = (body?.participants || []).filter(p => p && typeof p.student_id === 'string');
      const remove = (body?.remove || []).filter(x => typeof x === 'string');
      const st = list.map(p => env.DB.prepare('INSERT INTO eval_participants(event_id,student_id,coach_id,coach2_id) SELECT ?,id,?,? FROM students WHERE id=? ON CONFLICT(event_id,student_id) DO UPDATE SET coach_id=excluded.coach_id,coach2_id=excluded.coach2_id').bind(id, p.coach_id || null, p.coach2_id && p.coach2_id !== p.coach_id ? p.coach2_id : null, p.student_id));
      for (const sid of remove) st.push(env.DB.prepare('DELETE FROM eval_participants WHERE event_id=? AND student_id=?').bind(id, sid));
      if (st.length) await env.DB.batch(st);
      return json({ ok: true, added: list.length, removed: remove.length });
    }
    if (method === 'POST' && action === 'attendance') {
      const recs = (body?.records || []).filter(r => r && typeof r.student_id === 'string');
      if (recs.some(r => r.status && !STAT.has(r.status))) return json({ error: 'Unknown attendance status.' }, 400);
      if (recs.length) await env.DB.batch(recs.map(r => env.DB.prepare('UPDATE eval_participants SET status=? WHERE event_id=? AND student_id=?').bind(r.status || null, id, r.student_id)));
      return json({ ok: true, saved: recs.length });
    }
    if (method === 'POST' && action === 'report') {
      const app = body?.apparatus, target = Number(body?.target_level), outcome = body?.outcome === 'passed' ? 'passed' : 'not_passed';
      if (!APPS.includes(app) || !Number.isInteger(target) || target < 1 || target > 5) return json({ error: 'Choose an apparatus and a level from 1 to 5.' }, 400);
      if (event.finalized_at) return json({ error: 'This evaluation is finalized. Reopen it first to change results.' }, 400);
      if (!body.coach_id) return json({ error: 'Choose an evaluator for this student before saving.' }, 400);
      const coach2 = body.coach2_id && body.coach2_id !== body.coach_id ? body.coach2_id : null;
      const student = await one(env, 'SELECT id,first_name,last_name,pole_level,rope_level,yoga_level FROM students WHERE id=?', body.student_id);
      if (!student) return json({ error: 'Student not found.' }, 404);
      const results = (body.results || []).filter(r => r && typeof r.skill_id === 'string' && ['pass', 'partial', 'fail'].includes(r.result));
      const existing = await one(env, 'SELECT * FROM eval_reports WHERE event_id=? AND student_id=? AND apparatus=?', id, student.id, app);
      const col = app + '_level', current = student[col];
      const fromLevel = existing ? existing.from_level : current;
      const rid = existing?.id || crypto.randomUUID();
      const st = [
        env.DB.prepare("INSERT INTO eval_reports(id,event_id,student_id,apparatus,from_level,target_level,coach_id,coach2_id,outcome,notes,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,datetime('now'),?) ON CONFLICT(event_id,student_id,apparatus) DO UPDATE SET target_level=excluded.target_level,coach_id=excluded.coach_id,coach2_id=excluded.coach2_id,outcome=excluded.outcome,notes=excluded.notes,updated_at=excluded.updated_at,updated_by=excluded.updated_by")
          .bind(rid, id, student.id, app, fromLevel, target, body.coach_id, coach2, outcome, str(body.notes, 2000), by),
        env.DB.prepare('DELETE FROM eval_results WHERE report_id=?').bind(rid),
        ...results.map(r => env.DB.prepare('INSERT OR IGNORE INTO eval_results(report_id,skill_id,result) SELECT ?,id,? FROM skills WHERE id=?').bind(rid, r.result, r.skill_id)),
        env.DB.prepare('INSERT OR IGNORE INTO eval_participants(event_id,student_id,coach_id,coach2_id) VALUES(?,?,?,?)').bind(id, student.id, body.coach_id, coach2)
      ];
      await env.DB.batch(st);
      // Levels, skills and parent emails all wait for "Finalize evaluation".
      return json({ ok: true, id: rid, from_level: fromLevel, target_level: target, outcome, pending: true });
    }
    if (method === 'POST' && action === 'delete-report') {
      if (event.finalized_at) return json({ error: 'This evaluation is finalized. Reopen it first to change results.' }, 400);
      const r = await one(env, 'SELECT id FROM eval_reports WHERE id=? AND event_id=?', body?.report_id, id);
      if (!r) return json({ error: 'Not found' }, 404);
      await env.DB.prepare('DELETE FROM eval_reports WHERE id=?').bind(r.id).run();
      return json({ ok: true });
    }
    // Finalize: move every student who passed up to their new level, record the skills, and email every parent.
    if (method === 'POST' && action === 'finalize') {
      if (event.finalized_at) return json({ error: 'This evaluation is already finalized.' }, 400);
      const d = await evalData(env, id);
      if (!d.reports.length) return json({ error: 'There are no results to finalize yet.' }, 400);
      const st = [], perStudent = new Map();
      for (const r of d.reports) {
        const before = r[r.apparatus + '_level'], after = r.outcome === 'passed' ? Math.max(before, r.target_level) : before;
        if (after !== before) st.push(env.DB.prepare(`UPDATE students SET ${r.apparatus}_level=? WHERE id=?`).bind(after, r.student_id));
        for (const x of r.results.filter(x => x.result === 'pass')) st.push(env.DB.prepare("INSERT INTO student_skill_progress(id,student_id,skill_id,status,started_date,mastered_date) SELECT ?,?,id,'mastered',?,? FROM skills WHERE id=? ON CONFLICT(student_id,skill_id) DO UPDATE SET status='mastered',started_date=COALESCE(student_skill_progress.started_date,excluded.started_date),mastered_date=COALESCE(student_skill_progress.mastered_date,excluded.mastered_date) WHERE student_skill_progress.status<>'mastered'").bind(crypto.randomUUID(), r.student_id, event.event_date, event.event_date, x.skill_id));
        for (const x of r.results.filter(x => x.result === 'partial')) st.push(env.DB.prepare("INSERT INTO student_skill_progress(id,student_id,skill_id,status,started_date) SELECT ?,?,id,'learning',? FROM skills WHERE id=? ON CONFLICT(student_id,skill_id) DO UPDATE SET status='learning',started_date=COALESCE(student_skill_progress.started_date,excluded.started_date) WHERE student_skill_progress.status='not_started'").bind(crypto.randomUUID(), r.student_id, event.event_date, x.skill_id));
        if (!perStudent.has(r.student_id)) perStudent.set(r.student_id, { first: r.first_name, last: r.last_name, levels: { pole: r.pole_level, rope: r.rope_level, yoga: r.yoga_level }, rows: [] });
        const ps = perStudent.get(r.student_id); ps.levels[r.apparatus] = after; ps.rows.push({ ...r, before, after });
      }
      st.push(env.DB.prepare("UPDATE events SET finalized_at=datetime('now'),finalized_by=? WHERE id=?").bind(by, id));
      for (let i = 0; i < st.length; i += 90) await env.DB.batch(st.slice(i, i + 90));
      // One email per child to their parents, with every apparatus they were evaluated on and their levels now.
      let sent = 0, skipped = 0, moved = 0;
      const mark = { pass: '✓ Did it', partial: '◐ Partly', fail: '✗ Not yet' };
      for (const [sid, ps] of perStudent) {
        moved += ps.rows.some(r => r.after > r.before) ? 1 : 0;
        if (!mailConfigured(env)) { skipped++; continue; }
        const recips = await recipientsFor(env, { type: 'students', student_ids: [sid] });
        if (!recips.length) { skipped++; continue; }
        const up = ps.rows.filter(r => r.after > r.before);
        const lines = [`${ps.first}'s results from “${event.title}” (${fmtDate(event.event_date)}) are final.`,
          up.length ? `🎉 ${ps.first} moved up: ${up.map(r => `${r.apparatus} Level ${r.before} → Level ${r.after}`).join(', ')}.` : `${ps.first} keeps working toward the next level — the skills below show what to practice.`,
          ...ps.rows.map(r => `${r.apparatus.toUpperCase()} — tried Level ${r.target_level}: ${r.outcome === 'passed' ? 'Passed' : 'Not passed yet'}${r.results.length ? '\n' + r.results.map(x => `${mark[x.result]} — ${x.name}`).join('\n') : ''}${r.notes ? '\nCoach notes: ' + r.notes : ''}`),
          `${ps.first}'s levels now: Pole Level ${ps.levels.pole} · Rope Level ${ps.levels.rope} · Yoga Level ${ps.levels.yoga}.`];
        const r = await notify(env, recips, `${ps.first}'s evaluation results and new levels`, lines);
        sent += r.sent || 0;
      }
      return json({ ok: true, students: perStudent.size, moved_up: moved, emailed: sent, no_email: skipped, mail: mailConfigured(env) });
    }
    if (method === 'POST' && action === 'reopen') {
      await env.DB.prepare('UPDATE events SET finalized_at=NULL,finalized_by=NULL WHERE id=?').bind(id).run();
      return json({ ok: true });
    }
    if (method === 'POST' && action === 'sheet') {
      const d = await evalData(env, id);
      const att = new Map(d.participants.map(p => [p.student_id, p]));
      const summary = [['Student', 'Apparatus', 'Evaluated by', 'Second evaluator', 'Level before', 'Level tried', 'Result', 'Level now', 'Change', 'Skills passed', 'Skills partly done', 'Skills failed', 'Attendance', 'Notes']];
      for (const r of d.reports) summary.push([r.first_name + ' ' + r.last_name, r.apparatus, r.coach_name || '', r.coach2_name || '', r.from_level ?? '', r.target_level, r.outcome === 'passed' ? 'Passed' : 'Not passed', r.current_level, changeLabel(r), r.results.filter(x => x.result === 'pass').length, r.results.filter(x => x.result === 'partial').length, r.results.filter(x => x.result === 'fail').length, att.get(r.student_id)?.status || '', r.notes || '']);
      for (const p of d.participants) if (!d.reports.some(r => r.student_id === p.student_id)) summary.push([p.first_name + ' ' + p.last_name, '', p.coach_name || '', p.coach2_name || '', '', '', 'No report yet', '', '', '', '', '', p.status || '', '']);
      const skills = [['Student', 'Apparatus', 'Level', 'Skill', 'Result']];
      for (const r of d.reports) for (const x of r.results) skills.push([r.first_name + ' ' + r.last_name, r.apparatus, x.level, x.name, ({ pass: 'Did it', partial: 'Partly', fail: 'Failed' })[x.result]]);
      try {
        const sheet = await writeSpreadsheet(env, { sheetId: event.sheet_id, title: `MFU evaluation · ${event.title} · ${event.event_date}`, tabs: [{ name: 'Summary', rows: summary }, { name: 'Skills', rows: skills }] });
        await env.DB.prepare('UPDATE events SET sheet_id=?,sheet_url=? WHERE id=?').bind(sheet.id, sheet.url, id).run();
        return json({ ok: true, url: sheet.url });
      } catch (e) { return json({ error: e.message }, 502); }
    }
  }

  // ---- competitions: type scores, get a leaderboard per apparatus ----
  if (root === 'competitions' && id) {
    if (method === 'GET') {
      const event = await one(env, 'SELECT * FROM events WHERE id=?', id);
      if (!event) return json({ error: 'Not found' }, 404);
      return json({ event, scores: await all(env, 'SELECT cs.student_id,cs.apparatus,cs.score,s.first_name,s.last_name,s.center_id FROM comp_scores cs JOIN students s ON s.id=cs.student_id WHERE cs.event_id=? ORDER BY cs.apparatus,cs.score DESC', id) });
    }
    if (method === 'POST' && action === 'scores') {
      const st = [];
      for (const x of body?.scores || []) {
        if (!x || typeof x.student_id !== 'string' || !['pole', 'rope'].includes(x.apparatus)) continue;
        if (x.score === null || x.score === '' || x.score === undefined) { st.push(env.DB.prepare('DELETE FROM comp_scores WHERE event_id=? AND student_id=? AND apparatus=?').bind(id, x.student_id, x.apparatus)); continue; }
        const n = Number(x.score);
        if (!Number.isFinite(n) || n < 0 || n > 1000) return json({ error: 'Scores must be numbers.' }, 400);
        st.push(env.DB.prepare('INSERT INTO comp_scores(event_id,student_id,apparatus,score) SELECT ?,id,?,? FROM students WHERE id=? ON CONFLICT(event_id,student_id,apparatus) DO UPDATE SET score=excluded.score').bind(id, x.apparatus, n, x.student_id));
      }
      for (let i = 0; i < st.length; i += 90) await env.DB.batch(st.slice(i, i + 90));
      return json({ ok: true, saved: st.length });
    }
  }

  // ---- progress photos (links) ----
  if (root === 'student-photos') {
    if (method === 'GET') return json(await all(env, 'SELECT * FROM student_photos WHERE student_id=? ORDER BY COALESCE(taken_date,created_at) DESC', q('student_id') || ''));
    if (method === 'POST') {
      if (!body?.student_id || !isHttpUrl(body.url)) return json({ error: 'Add a photo link that starts with https://' }, 400);
      if (body.taken_date && !validDate(body.taken_date)) return json({ error: 'Dates must look like 2026-10-29.' }, 400);
      const pid = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO student_photos(id,student_id,url,caption,taken_date,added_by) SELECT ?,id,?,?,?,? FROM students WHERE id=?').bind(pid, body.url, str(body.caption, 300), body.taken_date || null, by, body.student_id).run();
      return json({ ok: true, id: pid }, 201);
    }
    if (method === 'DELETE' && id) { await env.DB.prepare('DELETE FROM student_photos WHERE id=?').bind(id).run(); return json({ ok: true }); }
  }

  // ---- coach notes: what they did this batch and what's next ----
  if (root === 'student-notes') {
    if (method === 'GET') return json(await all(env, 'SELECT n.*,b.name AS batch FROM student_notes n LEFT JOIN batches b ON b.id=n.batch_id WHERE n.student_id=? ORDER BY n.created_at DESC', q('student_id') || ''));
    if (method === 'POST') {
      const worked = str(body?.worked_on, 3000), next = str(body?.next_steps, 3000);
      if (!body?.student_id || (!worked && !next)) return json({ error: 'Write what they worked on or what is next.' }, 400);
      const nid = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO student_notes(id,student_id,batch_id,worked_on,next_steps,author_name,coach_id) SELECT ?,id,?,?,?,?,? FROM students WHERE id=?').bind(nid, body.batch_id || null, worked, next, by, actor.id || null, body.student_id).run();
      return json({ ok: true, id: nid }, 201);
    }
    if (method === 'DELETE' && id) {
      const n = await one(env, 'SELECT coach_id FROM student_notes WHERE id=?', id);
      if (actor.role === 'coach' && n && n.coach_id !== actor.id) return json({ error: 'Only the coach who wrote this note (or the admin) can delete it.' }, 403);
      await env.DB.prepare('DELETE FROM student_notes WHERE id=?').bind(id).run();
      return json({ ok: true });
    }
  }

  // ---- fitness: dasrang per minute, push-ups, sit-ups, squats, holds ... ----
  const fitnessStmts = (sid, date, batchId, values) => Object.entries(values || {}).filter(([k]) => METRIC.test(k)).map(([k, v]) => {
    if (v === '' || v === null || v === undefined) return env.DB.prepare('DELETE FROM fitness_records WHERE student_id=? AND record_date=? AND metric=?').bind(sid, date, k);
    const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 100000) throw new Error('Fitness values must be numbers.');
    return env.DB.prepare('INSERT INTO fitness_records(id,student_id,batch_id,record_date,metric,value,added_by) SELECT ?,id,?,?,?,?,? FROM students WHERE id=? ON CONFLICT(student_id,record_date,metric) DO UPDATE SET value=excluded.value,batch_id=excluded.batch_id,added_by=excluded.added_by').bind(crypto.randomUUID(), batchId || null, date, k, n, by, sid);
  });
  if (root === 'fitness') {
    if (method === 'GET') return json(await all(env, 'SELECT f.*,b.name AS batch FROM fitness_records f LEFT JOIN batches b ON b.id=f.batch_id WHERE f.student_id=? ORDER BY f.record_date DESC,f.metric', q('student_id') || ''));
    if (method === 'POST') {
      if (!body?.student_id || !validDate(body.record_date)) return json({ error: 'A student and a date are required.' }, 400);
      try { const st = fitnessStmts(body.student_id, body.record_date, body.batch_id, body.values); if (st.length) await env.DB.batch(st); return json({ ok: true, saved: st.length }); }
      catch (e) { return json({ error: e.message }, 400); }
    }
    if (method === 'DELETE' && id) { await env.DB.prepare('DELETE FROM fitness_records WHERE id=?').bind(id).run(); return json({ ok: true }); }
  }
  if (root === 'rep-sessions') {
    if (method === 'GET') return json((await all(env, 'SELECT * FROM rep_sessions WHERE student_id=? ORDER BY record_date DESC,created_at DESC LIMIT 100', q('student_id') || '')).map(r => ({ ...r, taps: parseList(r.taps) })));
    if (method === 'POST') {
      if (!body?.student_id || !REP_EXERCISES.has(body.exercise) || !validDate(body.record_date)) return json({ error: 'A student, an exercise and a date are required.' }, 400);
      const duration = 60, taps = (Array.isArray(body.taps) ? body.taps : []).map(Number).filter(n => Number.isFinite(n) && n >= 0 && n <= duration * 1000).sort((a, b) => a - b).slice(0, 1000).map(Math.round);
      const total = body.total === undefined || body.total === '' ? taps.length : Number(body.total);
      if (!Number.isInteger(total) || total < 0 || total > 1000) return json({ error: 'The count must be a whole number.' }, 400);
      const rid = crypto.randomUUID();
      const res = await env.DB.batch([
        env.DB.prepare('INSERT INTO rep_sessions(id,student_id,exercise,record_date,total,duration,taps,added_by) SELECT ?,id,?,?,?,?,?,? FROM students WHERE id=?').bind(rid, body.exercise, body.record_date, total, duration, JSON.stringify(taps), by, body.student_id),
        // The latest count also lands in fitness so it shows with the other results.
        ...fitnessStmts(body.student_id, body.record_date, null, { [body.exercise]: total })
      ]);
      if (!res[0].meta.changes) return json({ error: 'Student not found.' }, 404);
      return json({ ok: true, id: rid }, 201);
    }
    if (method === 'DELETE' && id) { await env.DB.prepare('DELETE FROM rep_sessions WHERE id=?').bind(id).run(); return json({ ok: true }); }
  }
  if (root === 'fitness-batch') {
    if (method === 'GET') {
      const bid = q('batch_id'), date = q('date');
      if (!bid || !validDate(date)) return json({ error: 'batch_id and date are required' }, 400);
      const [kids, rows, last] = await env.DB.batch([
        env.DB.prepare('SELECT s.id,s.first_name,s.last_name FROM batch_students bs JOIN students s ON s.id=bs.student_id WHERE bs.batch_id=? AND COALESCE(s.active,1)=1 ORDER BY s.first_name,s.last_name').bind(bid),
        env.DB.prepare('SELECT f.student_id,f.metric,f.value FROM fitness_records f JOIN batch_students bs ON bs.student_id=f.student_id AND bs.batch_id=? WHERE f.record_date=?').bind(bid, date),
        env.DB.prepare('SELECT f.student_id,f.metric,f.value,f.record_date FROM fitness_records f JOIN batch_students bs ON bs.student_id=f.student_id AND bs.batch_id=? WHERE f.record_date<? AND f.record_date=(SELECT MAX(x.record_date) FROM fitness_records x WHERE x.student_id=f.student_id AND x.metric=f.metric AND x.record_date<?)').bind(bid, date, date)
      ]);
      return json(kids.results.map(k => ({ ...k, values: Object.fromEntries(rows.results.filter(r => r.student_id === k.id).map(r => [r.metric, r.value])), previous: Object.fromEntries(last.results.filter(r => r.student_id === k.id).map(r => [r.metric, r.value])) })));
    }
    if (method === 'POST') {
      if (!body?.batch_id || !validDate(body.record_date) || !Array.isArray(body.rows)) return json({ error: 'batch_id, a date and rows are required' }, 400);
      try {
        const st = body.rows.flatMap(r => r && typeof r.student_id === 'string' ? fitnessStmts(r.student_id, body.record_date, body.batch_id, r.values) : []);
        for (let i = 0; i < st.length; i += 90) await env.DB.batch(st.slice(i, i + 90));
        return json({ ok: true, saved: st.length });
      } catch (e) { return json({ error: e.message }, 400); }
    }
  }

  // ---- announcements (parents and/or coaches) ----
  if (root === 'announcements') {
    if (method === 'GET') return json(await all(env, 'SELECT * FROM announcements ORDER BY pinned DESC,created_at DESC'));
    if (method === 'POST' || (method === 'PUT' && id)) {
      const title = str(body?.title, 200), text = str(body?.body, 6000), audience = ['all', 'parents', 'coaches'].includes(body?.audience) ? body.audience : 'all';
      if (!title) return json({ error: 'Add a title.' }, 400);
      const aid = id || crypto.randomUUID(), center = body.center_id || null;
      if (id) await env.DB.prepare('UPDATE announcements SET title=?,body=?,audience=?,center_id=?,pinned=?,form_id=? WHERE id=?').bind(title, text, audience, center, body.pinned ? 1 : 0, body.form_id || null, id).run();
      else await env.DB.prepare('INSERT INTO announcements(id,title,body,audience,center_id,pinned,created_by,form_id) VALUES(?,?,?,?,?,?,?,?)').bind(aid, title, text, audience, center, body.pinned ? 1 : 0, by, body.form_id || null).run();
      let sent = 0;
      if (body.send_email) {
        const people = [];
        if (audience !== 'coaches') people.push(...await recipientsFor(env, center ? { type: 'center', center_id: center } : {}));
        if (audience !== 'parents') people.push(...await all(env, `SELECT name,email FROM coaches WHERE COALESCE(active,1)=1${center ? ' AND (center_id=? OR id IN (SELECT coach_id FROM coach_centers WHERE center_id=?))' : ''}`, ...(center ? [center, center] : [])));
        sent = (await notify(env, people, 'Announcement: ' + title, [text || title], `<p style="margin:18px 0 0;font-size:14px">See all announcements in <a href="${esc(siteUrl(env, request))}">MFU Tracker</a>.</p>`)).sent || 0;
      }
      return json({ ok: true, id: aid, emailed: sent }, id ? 200 : 201);
    }
    if (method === 'DELETE' && id) { await env.DB.prepare('DELETE FROM announcements WHERE id=?').bind(id).run(); return json({ ok: true }); }
  }

  // ---- parent requests: meetings and questions ----
  if (root === 'requests') {
    if (method === 'GET') {
      const rows = await all(env, 'SELECT r.*,p.name AS parent_name,p.email AS parent_email,s.first_name,s.last_name FROM parent_requests r JOIN parents p ON p.id=r.parent_id LEFT JOIN students s ON s.id=r.student_id ORDER BY (r.status=\'open\') DESC,r.created_at DESC LIMIT 300');
      const mine = actor.role === 'coach' ? new Set(await coachStudentIds(env, actor.id)) : null;
      const files = await filesFor(env, rows.map(r => r.id));
      return json(rows.map(r => ({ ...r, mine: mine ? mine.has(r.student_id) : true, files: files.filter(f => f.request_id === r.id) })));
    }
    if (id && method === 'POST' && action === 'reply') {
      const r = await one(env, 'SELECT r.*,p.name AS parent_name,p.email AS parent_email FROM parent_requests r JOIN parents p ON p.id=r.parent_id WHERE r.id=?', id);
      if (!r) return json({ error: 'Not found' }, 404);
      const reply = str(body?.reply, 4000);
      if (!reply) return json({ error: 'Write a reply first.' }, 400);
      const status = ['answered', 'closed', 'scheduled', 'open'].includes(body.status) ? body.status : 'answered';
      await env.DB.prepare("UPDATE parent_requests SET reply=?,replied_by=?,replied_at=datetime('now'),status=? WHERE id=?").bind(reply, by, status, id).run();
      const m = await notify(env, [{ email: r.parent_email, name: r.parent_name }], 'Re: ' + r.subject, [reply, `— ${by}`], `<p style="margin:18px 0 0;font-size:14px">You can see this reply in the <a href="${esc(siteUrl(env, request))}">parent portal</a> under Contact coach.</p>`);
      return json({ ok: true, emailed: m.sent > 0 });
    }
    if (id && method === 'PUT') {
      if (!['open', 'answered', 'scheduled', 'closed'].includes(body?.status)) return json({ error: 'Unknown status.' }, 400);
      await env.DB.prepare('UPDATE parent_requests SET status=? WHERE id=?').bind(body.status, id).run();
      return json({ ok: true });
    }
  }

  // ---- the coach's own dashboard ----
  if (root === 'coach-dashboard' && method === 'GET') {
    if (actor.role !== 'coach') return json({ error: 'This page is for coach accounts.' }, 400);
    const now = today();
    const [batches, students, evals, ann, meetings] = await env.DB.batch([
      env.DB.prepare("SELECT b.id,b.name,b.days,b.start_time,b.end_time,b.center_id,(SELECT COUNT(*) FROM batch_students x WHERE x.batch_id=b.id) AS students,(SELECT MAX(attendance_date) FROM student_attendance a WHERE a.batch_id=b.id) AS last_taken,(SELECT COUNT(*) FROM student_attendance a WHERE a.batch_id=b.id AND a.attendance_date=?) AS today_marked FROM batch_coaches bc JOIN batches b ON b.id=bc.batch_id WHERE bc.coach_id=? AND COALESCE(b.active,1)=1 ORDER BY b.name").bind(now, actor.id),
      env.DB.prepare("SELECT DISTINCT s.id,s.first_name,s.last_name,s.center_id,s.pole_level,s.rope_level,s.yoga_level,(SELECT ROUND(100.0*SUM(a.status IN ('present','late'))/COUNT(*)) FROM student_attendance a WHERE a.student_id=s.id AND a.attendance_date>=date('now','-30 days')) AS att_rate FROM batch_coaches bc JOIN batch_students bs ON bs.batch_id=bc.batch_id JOIN students s ON s.id=bs.student_id WHERE bc.coach_id=? AND COALESCE(s.active,1)=1 ORDER BY s.first_name,s.last_name").bind(actor.id),
      env.DB.prepare("SELECT e.id,e.title,e.event_date,COUNT(ep.student_id) AS students FROM eval_participants ep JOIN events e ON e.id=ep.event_id WHERE ep.coach_id=? AND e.event_date>=date('now','-1 day') GROUP BY e.id ORDER BY e.event_date").bind(actor.id),
      env.DB.prepare("SELECT id,title,body,created_at,created_by,pinned FROM announcements WHERE audience IN ('all','coaches') ORDER BY pinned DESC,created_at DESC LIMIT 10"),
      env.DB.prepare("SELECT id,title,meeting_date,start_time,meet_url,attendees FROM meetings WHERE meeting_date>=? ORDER BY meeting_date,start_time LIMIT 50").bind(now)
    ]);
    const mine = new Set(students.results.map(s => s.id));
    const requests = (await all(env, "SELECT r.id,r.kind,r.subject,r.status,r.created_at,r.student_id,p.name AS parent_name,s.first_name,s.last_name FROM parent_requests r JOIN parents p ON p.id=r.parent_id LEFT JOIN students s ON s.id=r.student_id WHERE r.status='open' ORDER BY r.created_at DESC")).filter(r => mine.has(r.student_id));
    const email = cleanEmail(actor.email);
    return json({ coach: { id: actor.id, name: actor.name }, batches: batches.results, students: students.results, evaluations: evals.results, announcements: ann.results, requests, meetings: meetings.results.filter(m => parseList(m.attendees).map(cleanEmail).includes(email)).map(({ attendees, ...m }) => m) });
  }

  // ---- centers: add, rename, remove ----
  if (root === 'centers-summary' && method === 'GET') {
    return json(await all(env, "SELECT c.id,c.name,(SELECT COUNT(*) FROM students s WHERE s.center_id=c.id AND COALESCE(s.active,1)=1) AS students,(SELECT COUNT(*) FROM batches b WHERE b.center_id=c.id) AS batches,(SELECT COUNT(DISTINCT x.id) FROM coaches x LEFT JOIN coach_centers cc ON cc.coach_id=x.id WHERE cc.center_id=c.id OR x.center_id=c.id) AS coaches FROM centers c ORDER BY c.name"));
  }
  if (root === 'centers' && method !== 'GET') {
    const name = str(body?.name, 80);
    if (method === 'POST' && !id) {
      if (!name) return json({ error: 'Give the center a name.' }, 400);
      if (await one(env, 'SELECT 1 x FROM centers WHERE lower(name)=lower(?)', name)) return json({ error: 'A center with that name already exists.' }, 400);
      let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'center', n = 1, cid = slug;
      while (await one(env, 'SELECT 1 x FROM centers WHERE id=?', cid)) cid = slug + '-' + (++n);
      await env.DB.prepare('INSERT INTO centers(id,name) VALUES(?,?)').bind(cid, name).run();
      return json({ ok: true, id: cid }, 201);
    }
    if (method === 'PUT' && id) {
      if (!name) return json({ error: 'Give the center a name.' }, 400);
      if (await one(env, 'SELECT 1 x FROM centers WHERE lower(name)=lower(?) AND id<>?', name, id)) return json({ error: 'A center with that name already exists.' }, 400);
      await env.DB.prepare('UPDATE centers SET name=? WHERE id=?').bind(name, id).run();
      return json({ ok: true });
    }
    if (method === 'DELETE' && id) {
      const used = await one(env, 'SELECT (SELECT COUNT(*) FROM students WHERE center_id=?)+(SELECT COUNT(*) FROM batches WHERE center_id=?) AS n', id, id);
      if (used.n) return json({ error: 'Move or delete the students and batches at this center first.' }, 400);
      await env.DB.batch([
        env.DB.prepare('UPDATE coaches SET center_id=NULL WHERE center_id=?').bind(id),
        env.DB.prepare('DELETE FROM coach_centers WHERE center_id=?').bind(id),
        env.DB.prepare('UPDATE events SET center_id=NULL WHERE center_id=?').bind(id),
        env.DB.prepare('UPDATE demos SET center_id=NULL WHERE center_id=?').bind(id),
        env.DB.prepare('UPDATE announcements SET center_id=NULL WHERE center_id=?').bind(id),
        env.DB.prepare('DELETE FROM centers WHERE id=?').bind(id)
      ]);
      return json({ ok: true });
    }
  }

  // ---- every coach's centers in one call (coaches can work at several) ----
  if (root === 'coach-centers-all' && method === 'GET') {
    return json(await all(env, 'SELECT coach_id,center_id FROM coach_centers UNION SELECT id,center_id FROM coaches WHERE center_id IS NOT NULL AND id NOT IN (SELECT coach_id FROM coach_centers)'));
  }

  // ---- small counters for the admin overview ----
  if (root === 'overview-extra' && method === 'GET') {
    const [req, demos, meetings] = await env.DB.batch([
      env.DB.prepare("SELECT COUNT(*) n FROM parent_requests WHERE status='open'"),
      env.DB.prepare("SELECT id,title,demo_date AS date,start_time FROM demos WHERE demo_date>=date('now') ORDER BY demo_date LIMIT 5"),
      env.DB.prepare("SELECT id,title,meeting_date AS date,start_time,meet_url FROM meetings WHERE meeting_date>=date('now') ORDER BY meeting_date,start_time LIMIT 5")
    ]);
    return json({ open_requests: req.results[0].n, demos: demos.results, meetings: meetings.results });
  }

  return null;
}
