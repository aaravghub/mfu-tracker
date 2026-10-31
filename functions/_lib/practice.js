import { json, isHttpUrl } from './util.js';

// Exercise library, exercise sets, home practice assigned to students, and files parents attach to requests.
const str = (v, max = 2000) => String(v ?? '').trim().slice(0, max);
const all = async (env, sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results;
const one = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).first();
const marks = a => a.map(() => '?').join(',');
const validDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
const level = v => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null; };
export const CATEGORIES = ['Core', 'Strength', 'Flexibility', 'Balance', 'Endurance', 'Mallakhamb drills', 'Warm-up', 'Other'];
const category = v => CATEGORIES.includes(v) ? v : 'Other';

export const MAX_FILE_BYTES = 1.5 * 1024 * 1024, MAX_FILES = 3;
const ALLOWED_TYPES = /^(image\/(png|jpe?g|gif|webp|heic|heif)|application\/pdf|video\/(mp4|quicktime)|text\/plain|application\/(msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document))$/;

// Decodes {name,type,data(base64)} uploads; throws a readable error when a file is too big or not allowed.
export function decodeFiles(files) {
  const list = (Array.isArray(files) ? files : []).filter(f => f && typeof f.data === 'string');
  if (list.length > MAX_FILES) throw new Error(`Attach up to ${MAX_FILES} files.`);
  return list.map(f => {
    const name = str(f.name, 120).replace(/[\\/:*?"<>|\r\n]/g, '_') || 'file', type = String(f.type || '').toLowerCase();
    if (!ALLOWED_TYPES.test(type)) throw new Error(`“${name}” isn't a supported file. Use a photo, PDF, short video, or Word/text document.`);
    let bin;
    try { bin = atob(f.data.replace(/^data:[^,]*,/, '')); } catch { throw new Error(`Couldn't read “${name}”.`); }
    if (bin.length > MAX_FILE_BYTES) throw new Error(`“${name}” is too big. Each file can be up to 1.5 MB.`);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { name, type, size: bytes.length, bytes };
  });
}
export const fileStatements = (env, requestId, files) => files.map(f => env.DB.prepare('INSERT INTO request_files(id,request_id,name,type,size,data) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(), requestId, f.name, f.type, f.size, f.bytes));
export async function filesFor(env, requestIds) {
  if (!requestIds.length) return [];
  return all(env, `SELECT id,request_id,name,type,size FROM request_files WHERE request_id IN (${marks(requestIds)}) ORDER BY created_at`, ...requestIds);
}
export async function fileResponse(env, fileId, parentId = null) {
  const f = parentId
    ? await one(env, 'SELECT f.name,f.type,f.data FROM request_files f JOIN parent_requests r ON r.id=f.request_id WHERE f.id=? AND r.parent_id=?', fileId, parentId)
    : await one(env, 'SELECT name,type,data FROM request_files WHERE id=?', fileId);
  if (!f) return json({ error: 'File not found.' }, 404);
  const inline = /^image\/|^application\/pdf$|^video\//.test(f.type || '');
  return new Response(new Uint8Array(f.data), { headers: { 'content-type': f.type || 'application/octet-stream', 'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(f.name)}"`, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox" } });
}

// Home practice for a list of children (parent portal and student profile).
export async function practiceFor(env, studentIds) {
  if (!studentIds.length) return [];
  const asg = await all(env, `SELECT a.*,s.name AS set_name,s.description AS set_description,e.name AS exercise_name,e.description AS exercise_description,e.video_url AS exercise_video FROM home_assignments a LEFT JOIN exercise_sets s ON s.id=a.set_id LEFT JOIN exercises e ON e.id=a.exercise_id WHERE a.active=1 AND a.student_id IN (${marks(studentIds)}) AND (a.until_date IS NULL OR a.until_date>=date('now','-1 day')) ORDER BY a.created_at DESC`, ...studentIds);
  if (!asg.length) return [];
  const setIds = [...new Set(asg.map(a => a.set_id).filter(Boolean))], aIds = asg.map(a => a.id);
  const items = setIds.length ? await all(env, `SELECT i.set_id,i.reps,e.id,e.name,e.description,e.video_url FROM set_items i JOIN exercises e ON e.id=i.exercise_id WHERE i.set_id IN (${marks(setIds)}) ORDER BY i.sort_order`, ...setIds) : [];
  const checks = await all(env, `SELECT assignment_id,done_date FROM home_checkins WHERE assignment_id IN (${marks(aIds)}) AND done_date>=date('now','-30 days')`, ...aIds);
  return asg.map(a => ({ ...a, items: a.set_id ? items.filter(i => i.set_id === a.set_id) : [], done_dates: checks.filter(c => c.assignment_id === a.id).map(c => c.done_date) }));
}

export async function handlePractice(path, method, request, env, url, actor) {
  const [root, id, action] = path.split('/');
  if (!['exercises', 'exercise-sets', 'home-assignments', 'request-files'].includes(root)) return null;
  const body = (method === 'POST' || method === 'PUT') ? await request.clone().json().catch(() => null) : null;
  const by = actor.name || 'Admin';

  if (root === 'request-files' && id && method === 'GET') return fileResponse(env, id);

  if (root === 'exercises') {
    if (method === 'GET') return json(await all(env, 'SELECT * FROM exercises ORDER BY category,COALESCE(level,0),name'));
    if (method === 'POST' || (method === 'PUT' && id)) {
      const name = str(body?.name, 120);
      if (!name) return json({ error: 'Give the exercise a name.' }, 400);
      if (body.video_url && !isHttpUrl(body.video_url)) return json({ error: 'Links must start with http:// or https://' }, 400);
      const vals = [name, category(body.category), level(body.level), str(body.description, 2000), body.video_url || null, str(body.default_reps, 60)];
      if (id) { await env.DB.prepare('UPDATE exercises SET name=?,category=?,level=?,description=?,video_url=?,default_reps=? WHERE id=?').bind(...vals, id).run(); return json({ ok: true }); }
      const eid = crypto.randomUUID();
      await env.DB.prepare('INSERT INTO exercises(name,category,level,description,video_url,default_reps,id) VALUES(?,?,?,?,?,?,?)').bind(...vals, eid).run();
      return json({ ok: true, id: eid }, 201);
    }
    if (method === 'DELETE' && id) { await env.DB.prepare('DELETE FROM exercises WHERE id=?').bind(id).run(); return json({ ok: true }); }
  }

  if (root === 'exercise-sets') {
    if (method === 'GET') {
      const [sets, items] = await env.DB.batch([env.DB.prepare('SELECT * FROM exercise_sets ORDER BY category,COALESCE(level,0),name'), env.DB.prepare('SELECT i.set_id,i.exercise_id,i.reps,i.sort_order,e.name FROM set_items i JOIN exercises e ON e.id=i.exercise_id ORDER BY i.sort_order')]);
      return json(sets.results.map(s => ({ ...s, items: items.results.filter(i => i.set_id === s.id) })));
    }
    if (method === 'POST' || (method === 'PUT' && id)) {
      const name = str(body?.name, 120);
      if (!name) return json({ error: 'Give the set a name.' }, 400);
      const items = (body.items || []).filter(i => i && typeof i.exercise_id === 'string').slice(0, 40);
      if (!items.length) return json({ error: 'Add at least one exercise to the set.' }, 400);
      const sid = id || crypto.randomUUID(), vals = [name, category(body.category), level(body.level), str(body.description, 2000)];
      const st = [id ? env.DB.prepare('UPDATE exercise_sets SET name=?,category=?,level=?,description=? WHERE id=?').bind(...vals, id) : env.DB.prepare('INSERT INTO exercise_sets(name,category,level,description,id) VALUES(?,?,?,?,?)').bind(...vals, sid),
        env.DB.prepare('DELETE FROM set_items WHERE set_id=?').bind(sid),
        ...items.map((i, n) => env.DB.prepare('INSERT OR IGNORE INTO set_items(set_id,exercise_id,reps,sort_order) SELECT ?,id,?,? FROM exercises WHERE id=?').bind(sid, str(i.reps, 60), n, i.exercise_id))];
      await env.DB.batch(st);
      return json({ ok: true, id: sid }, id ? 200 : 201);
    }
    if (method === 'DELETE' && id) { await env.DB.prepare('DELETE FROM exercise_sets WHERE id=?').bind(id).run(); return json({ ok: true }); }
  }

  if (root === 'home-assignments') {
    if (method === 'GET') {
      const rows = await all(env, "SELECT a.*,st.first_name,st.last_name,s.name AS set_name,e.name AS exercise_name,(SELECT COUNT(*) FROM home_checkins c WHERE c.assignment_id=a.id AND c.done_date>=date('now','-6 days')) AS done_week,(SELECT MAX(done_date) FROM home_checkins c WHERE c.assignment_id=a.id) AS last_done FROM home_assignments a JOIN students st ON st.id=a.student_id LEFT JOIN exercise_sets s ON s.id=a.set_id LEFT JOIN exercises e ON e.id=a.exercise_id WHERE a.active=1" + (url.searchParams.get('student_id') ? ' AND a.student_id=?' : '') + ' ORDER BY a.created_at DESC LIMIT 500', ...(url.searchParams.get('student_id') ? [url.searchParams.get('student_id')] : []));
      return json(rows);
    }
    if (method === 'POST' && !id) {
      const ids = [...new Set((body?.student_ids || []).filter(x => typeof x === 'string'))];
      if (!ids.length) return json({ error: 'Choose at least one student.' }, 400);
      if (!body.set_id === !body.exercise_id) return json({ error: 'Choose a set or a single exercise.' }, 400);
      if (body.until_date && !validDate(body.until_date)) return json({ error: 'Dates must look like 2026-11-30.' }, 400);
      const freq = ['Daily', '5 times a week', '3 times a week', 'Weekly'].includes(body.frequency) ? body.frequency : 'Daily';
      await env.DB.batch(ids.map(sid => env.DB.prepare('INSERT INTO home_assignments(id,student_id,set_id,exercise_id,reps,note,frequency,until_date,assigned_by) SELECT ?,id,?,?,?,?,?,?,? FROM students WHERE id=?').bind(crypto.randomUUID(), body.set_id || null, body.exercise_id || null, str(body.reps, 60), str(body.note, 1000), freq, body.until_date || null, by, sid)));
      return json({ ok: true, assigned: ids.length }, 201);
    }
    if (method === 'DELETE' && id) { await env.DB.prepare('UPDATE home_assignments SET active=0 WHERE id=?').bind(id).run(); return json({ ok: true }); }
  }
  return json({ error: 'Method not allowed.' }, 405);
}

// Parent: tick a home-practice assignment done (or not) for a day.
export async function parentCheckin(env, parentId, body) {
  const a = await one(env, 'SELECT a.id FROM home_assignments a JOIN parent_students ps ON ps.student_id=a.student_id WHERE a.id=? AND ps.parent_id=?', body?.assignment_id, parentId);
  if (!a) return json({ error: 'Not found' }, 404);
  const date = validDate(body.date) ? body.date : new Date().toISOString().slice(0, 10);
  if (body.done === false) await env.DB.prepare('DELETE FROM home_checkins WHERE assignment_id=? AND done_date=?').bind(a.id, date).run();
  else await env.DB.prepare('INSERT OR IGNORE INTO home_checkins(assignment_id,done_date) VALUES(?,?)').bind(a.id, date).run();
  return json({ ok: true });
}
