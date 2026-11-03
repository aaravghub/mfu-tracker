import { json } from './util.js';

const STATUSES = new Set(['present', 'absent', 'late', 'excused']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const validDate = d => typeof d === 'string' && DATE_RE.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z'));
const nextMonth = m => { let [y, mo] = m.split('-').map(Number); mo++; if (mo > 12) { mo = 1; y++; } return y + '-' + String(mo).padStart(2, '0'); };

// A student who is not on a batch's roster but is marked for it is a "drop-in". The server decides this, never the browser.
const UPSERT = "INSERT INTO student_attendance(id,batch_id,student_id,attendance_date,status,drop_in) VALUES(?,?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM batch_students WHERE batch_id=? AND student_id=?) THEN 0 ELSE 1 END) ON CONFLICT(batch_id,student_id,attendance_date) DO UPDATE SET status=excluded.status";
const REMOVE = 'DELETE FROM student_attendance WHERE batch_id=? AND student_id=? AND attendance_date=? AND drop_in=1';

// Coaches: the same marks in coach_attendance. A coach not assigned to the batch is a drop-in, worked out on read.
const COACH_UPSERT = 'INSERT INTO coach_attendance(id,batch_id,coach_id,attendance_date,status) SELECT ?,?,id,?,? FROM coaches WHERE id=? ON CONFLICT(batch_id,coach_id,attendance_date) DO UPDATE SET status=excluded.status';
const COACH_REMOVE = 'DELETE FROM coach_attendance WHERE batch_id=?1 AND coach_id=?2 AND attendance_date=?3 AND NOT EXISTS(SELECT 1 FROM batch_coaches WHERE batch_id=?1 AND coach_id=?2)';
const COACH_SQL = "SELECT bc.batch_id,c.id AS coach_id,c.name,ca.status,(ca.status IS NOT NULL) AS saved,0 AS drop_in FROM batch_coaches bc JOIN coaches c ON c.id=bc.coach_id JOIN batches b ON b.id=bc.batch_id LEFT JOIN coach_attendance ca ON ca.coach_id=c.id AND ca.batch_id=bc.batch_id AND ca.attendance_date=? WHERE COALESCE(c.active,1)=1 AND ";
const COACH_DROPIN_SQL = "SELECT ca.batch_id,c.id AS coach_id,c.name,ca.status,1 AS saved,1 AS drop_in FROM coach_attendance ca JOIN coaches c ON c.id=ca.coach_id JOIN batches b ON b.id=ca.batch_id WHERE ca.attendance_date=? AND NOT EXISTS(SELECT 1 FROM batch_coaches x WHERE x.batch_id=ca.batch_id AND x.coach_id=ca.coach_id) AND ";
const coachShape = r => ({ coach_id: r.coach_id, name: r.name, status: r.saved ? r.status : '', saved: !!r.saved, drop_in: !!r.drop_in });

function stmtsFor(env, batchId, date, records, remove, coaches, removeCoaches) {
  const out = [];
  for (const r of records || []) {
    if (!r || typeof r.student_id !== 'string' || !STATUSES.has(r.status)) throw new Error('Each attendance record needs a student and a valid status.');
    out.push(env.DB.prepare(UPSERT).bind(crypto.randomUUID(), batchId, r.student_id, date, r.status, batchId, r.student_id));
  }
  for (const sid of remove || []) if (typeof sid === 'string') out.push(env.DB.prepare(REMOVE).bind(batchId, sid, date));
  for (const r of coaches || []) {
    if (!r || typeof r.coach_id !== 'string' || !STATUSES.has(r.status)) throw new Error('Each coach record needs a coach and a valid status.');
    out.push(env.DB.prepare(COACH_UPSERT).bind(crypto.randomUUID(), batchId, date, r.status, r.coach_id));
  }
  for (const cid of removeCoaches || []) if (typeof cid === 'string') out.push(env.DB.prepare(COACH_REMOVE).bind(batchId, cid, date));
  return out;
}

// Roster rows (status defaults to present until saved) + drop-ins already saved for that date.
const ROSTER_SQL = "SELECT bs.batch_id,s.id AS student_id,s.first_name,s.last_name,sa.status,(sa.status IS NOT NULL) AS saved,0 AS drop_in FROM batch_students bs JOIN students s ON s.id=bs.student_id JOIN batches b ON b.id=bs.batch_id LEFT JOIN student_attendance sa ON sa.student_id=s.id AND sa.batch_id=bs.batch_id AND sa.attendance_date=? WHERE COALESCE(s.active,1)=1 AND ";
const DROPIN_SQL = "SELECT sa.batch_id,s.id AS student_id,s.first_name,s.last_name,sa.status,1 AS saved,1 AS drop_in FROM student_attendance sa JOIN students s ON s.id=sa.student_id JOIN batches b ON b.id=sa.batch_id WHERE sa.attendance_date=? AND NOT EXISTS(SELECT 1 FROM batch_students x WHERE x.batch_id=sa.batch_id AND x.student_id=sa.student_id) AND ";
const shape = r => ({ student_id: r.student_id, first_name: r.first_name, last_name: r.last_name, status: r.saved ? r.status : '', saved: !!r.saved, drop_in: !!r.drop_in });
const byName = (a, b) => (a.last_name + a.first_name).localeCompare(b.last_name + b.first_name);

export async function handleAttendance(path, method, request, env, url, body) {
  const [root] = path.split('/');
  if (!['attendance', 'attendance-center', 'attendance-student', 'attendance-report'].includes(root)) return null;
  const q = k => url.searchParams.get(k);

  // ---- one batch, one date ----
  if (root === 'attendance' && method === 'GET') {
    const batchId = q('batch_id'), date = q('date');
    if (!batchId || !validDate(date)) return json({ error: 'batch_id and a valid date are required' }, 400);
    const [a, b, c, d] = await env.DB.batch([
      env.DB.prepare(ROSTER_SQL + 'bs.batch_id=?').bind(date, batchId),
      env.DB.prepare(DROPIN_SQL + 'sa.batch_id=?').bind(date, batchId),
      env.DB.prepare(COACH_SQL + 'bc.batch_id=?').bind(date, batchId),
      env.DB.prepare(COACH_DROPIN_SQL + 'ca.batch_id=?').bind(date, batchId)
    ]);
    return json({ students: [...a.results, ...b.results].map(shape).sort(byName), coaches: [...c.results, ...d.results].map(coachShape).sort((x, y) => x.name.localeCompare(y.name)) });
  }
  if (root === 'attendance' && method === 'POST') {
    if (!body || !body.batch_id || !validDate(body.date) || !Array.isArray(body.records)) return json({ error: 'batch_id, a valid date and records are required' }, 400);
    if (body.records.length > 500) return json({ error: 'Too many records at once.' }, 400);
    try {
      const st = stmtsFor(env, body.batch_id, body.date, body.records, body.remove, body.coaches, body.remove_coaches);
      if (st.length) await env.DB.batch(st);
      return json({ ok: true, saved: body.records.length, coaches: (body.coaches || []).length });
    } catch (e) { return json({ error: String(e.message || 'Could not save attendance.') }, 400); }
  }

  // ---- a whole center, one date: every batch at the center with its roster and drop-ins ----
  if (root === 'attendance-center' && method === 'GET') {
    const centerId = q('center_id'), date = q('date');
    if (!centerId || !validDate(date)) return json({ error: 'center_id and a valid date are required' }, 400);
    const [bs, a, b, c, d] = await env.DB.batch([
      env.DB.prepare("SELECT id,name,days,start_time,end_time FROM batches WHERE center_id=? AND COALESCE(active,1)=1 ORDER BY name").bind(centerId),
      env.DB.prepare(ROSTER_SQL + 'b.center_id=? AND COALESCE(b.active,1)=1').bind(date, centerId),
      env.DB.prepare(DROPIN_SQL + 'b.center_id=?').bind(date, centerId),
      env.DB.prepare(COACH_SQL + 'b.center_id=? AND COALESCE(b.active,1)=1').bind(date, centerId),
      env.DB.prepare(COACH_DROPIN_SQL + 'b.center_id=?').bind(date, centerId)
    ]);
    const rows = [...a.results, ...b.results], crows = [...c.results, ...d.results];
    return json({ batches: bs.results.map(x => ({ ...x, students: rows.filter(r => r.batch_id === x.id).map(shape).sort(byName), coaches: crows.filter(r => r.batch_id === x.id).map(coachShape).sort((p, q) => p.name.localeCompare(q.name)) })) });
  }
  if (root === 'attendance-center' && method === 'POST') {
    if (!body || !validDate(body.date) || !Array.isArray(body.batches)) return json({ error: 'A valid date and batches are required' }, 400);
    let total = 0;
    try {
      const st = [];
      for (const b of body.batches) {
        if (!b || typeof b.batch_id !== 'string') continue;
        total += (b.records || []).length;
        st.push(...stmtsFor(env, b.batch_id, body.date, b.records, b.remove, b.coaches, b.remove_coaches));
      }
      if (total > 800) return json({ error: 'Too many records at once.' }, 400);
      for (let i = 0; i < st.length; i += 90) await env.DB.batch(st.slice(i, i + 90));
      return json({ ok: true, saved: total });
    } catch (e) { return json({ error: String(e.message || 'Could not save attendance.') }, 400); }
  }

  // ---- one student, one month, plus 12-month history ----
  if (root === 'attendance-student' && method === 'GET') {
    const sid = q('student_id'), month = q('month');
    if (!sid || !MONTH_RE.test(month || '')) return json({ error: 'student_id and month (YYYY-MM) are required' }, 400);
    const from = month + '-01', to = nextMonth(month) + '-01';
    const [st, rows, hist, reg] = await env.DB.batch([
      env.DB.prepare('SELECT id,first_name,last_name,center_id FROM students WHERE id=?').bind(sid),
      env.DB.prepare('SELECT sa.attendance_date AS date,sa.status,sa.drop_in,sa.batch_id,b.name AS batch FROM student_attendance sa LEFT JOIN batches b ON b.id=sa.batch_id WHERE sa.student_id=? AND sa.attendance_date>=? AND sa.attendance_date<? ORDER BY sa.attendance_date,b.name').bind(sid, from, to),
      env.DB.prepare("SELECT substr(attendance_date,1,7) AS month,SUM(status IN ('present','late')) AS attended,COUNT(*) AS total FROM student_attendance WHERE student_id=? GROUP BY month ORDER BY month DESC LIMIT 12").bind(sid),
      env.DB.prepare('SELECT b.id,b.name,b.days,b.start_time,b.end_time FROM batch_students bs JOIN batches b ON b.id=bs.batch_id WHERE bs.student_id=? ORDER BY b.name').bind(sid)
    ]);
    if (!st.results[0]) return json({ error: 'Student not found.' }, 404);
    return json({ student: st.results[0], month, rows: rows.results, history: hist.results, batches: reg.results });
  }

  // ---- everyone, one month: how many times each student showed up, per batch ----
  if (root === 'attendance-report' && method === 'GET') {
    const month = q('month'), centerId = q('center_id');
    if (!MONTH_RE.test(month || '')) return json({ error: 'month (YYYY-MM) is required' }, 400);
    const from = month + '-01', to = nextMonth(month) + '-01', cw = centerId ? ' AND s.center_id=?' : '';
    const binds = centerId ? [from, to, centerId] : [from, to];
    const [students, rows] = await env.DB.batch([
      env.DB.prepare('SELECT s.id,s.first_name,s.last_name,s.center_id FROM students s WHERE COALESCE(s.active,1)=1' + cw + ' ORDER BY s.last_name,s.first_name').bind(...(centerId ? [centerId] : [])),
      env.DB.prepare('SELECT s.id AS student_id,sa.batch_id,b.name AS batch_name,sa.status,sa.drop_in,COUNT(*) AS n FROM student_attendance sa JOIN students s ON s.id=sa.student_id LEFT JOIN batches b ON b.id=sa.batch_id WHERE sa.attendance_date>=? AND sa.attendance_date<?' + cw + ' GROUP BY s.id,sa.batch_id,sa.status,sa.drop_in').bind(...binds)
    ]);
    return json({ month, students: students.results, rows: rows.results });
  }

  return json({ error: 'Method not allowed.' }, 405);
}
