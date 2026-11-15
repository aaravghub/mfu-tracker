import { json } from './util.js';
import { deletePhoto } from './photos.js';

// Pyramids: a library of formations (duet, trio, full). Each has spots: a skill, a place (pole, rope or ground),
// a position on the diagram (0 = bottom/left, 1 = top/right) and the kid doing it. A demo uses its own copies,
// ordered; copies stay in the library, so a pyramid planned for a demo is never lost.

const KINDS = new Set(['duet', 'trio', 'full']), PLACES = new Set(['pole', 'rope', 'ground']);
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const pos = v => Math.min(1, Math.max(0, Number(v) || 0));
const app = v => v === 'rope' ? 'rope' : 'pole'; // a pyramid is on the pole or on the rope, never both

async function load(env, id) {
  const [p, spots] = (await env.DB.batch([
    env.DB.prepare('SELECT p.*,d.title AS demo_title FROM pyramids p LEFT JOIN demos d ON d.id=p.demo_id WHERE p.id=?').bind(id),
    env.DB.prepare("SELECT sp.*,COALESCE(sk.name,sp.skill_name) AS skill,s.first_name||' '||COALESCE(s.last_name,'') AS student FROM pyramid_spots sp LEFT JOIN skills sk ON sk.id=sp.skill_id LEFT JOIN students s ON s.id=sp.student_id WHERE sp.pyramid_id=? ORDER BY sp.position").bind(id)
  ])).map(r => r.results);
  return p[0] ? { ...p[0], spots } : null;
}

// Replaces a pyramid's spots. A typed-in new skill becomes a general skill in the library so it can be reused.
async function spotStatements(env, id, spots) {
  const st = [env.DB.prepare('DELETE FROM pyramid_spots WHERE pyramid_id=?').bind(id)], made = new Map();
  for (const [i, s] of (Array.isArray(spots) ? spots.slice(0, 40) : []).entries()) {
    const place = PLACES.has(s?.place) ? s.place : 'ground';
    let skill = typeof s?.skill_id === 'string' && s.skill_id ? s.skill_id : null;
    const name = str(s?.skill_name, 120);
    if (!skill && name && made.has(name.toLowerCase())) skill = made.get(name.toLowerCase());
    else if (!skill && name) {
      const found = await env.DB.prepare('SELECT id FROM skills WHERE lower(name)=lower(?) LIMIT 1').bind(name).first();
      skill = found?.id || crypto.randomUUID();
      made.set(name.toLowerCase(), skill); // the same new name twice in one pyramid is one skill
      if (!found) st.push(env.DB.prepare("INSERT INTO skills(id,apparatus,name,level,description,general) VALUES(?,?,?,1,'Pyramid skill',1)").bind(skill, place === 'rope' ? 'rope' : place === 'pole' ? 'pole' : 'yoga', name));
    }
    st.push(env.DB.prepare('INSERT INTO pyramid_spots(id,pyramid_id,position,skill_id,skill_name,place,x,y,student_id) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), id, i + 1, skill, skill ? null : name || null, place, pos(s.x), pos(s.y), typeof s?.student_id === 'string' && s.student_id ? s.student_id : null));
  }
  return st;
}

export async function handlePyramids(path, method, request, env, url, actor) {
  const [root, id, action] = path.split('/');
  if (root !== 'pyramids') return null;
  const body = method === 'POST' || method === 'PUT' ? await request.json().catch(() => ({})) : {};

  if (method === 'GET' && !id) {
    const demo = url.searchParams.get('demo_id');
    const rows = (await env.DB.prepare(`SELECT p.id,p.name,p.kind,p.apparatus,p.people,p.image_url,p.demo_id,p.sort_order,d.title AS demo_title,(SELECT COUNT(*) FROM pyramid_spots s WHERE s.pyramid_id=p.id) AS spots FROM pyramids p LEFT JOIN demos d ON d.id=p.demo_id ${demo ? 'WHERE p.demo_id=? ORDER BY p.sort_order,p.created_at' : 'ORDER BY p.kind,p.name'}`).bind(...(demo ? [demo] : [])).all()).results;
    return json(rows);
  }
  if (method === 'GET' && id) { const p = await load(env, id); return p ? json(p) : json({ error: 'Not found' }, 404); }

  if (method === 'POST' && !id) {
    const name = str(body.name, 120); if (!name) return json({ error: 'Give the pyramid a name.' }, 400);
    const pid = crypto.randomUUID();
    const order = body.demo_id ? (await env.DB.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM pyramids WHERE demo_id=?').bind(body.demo_id).first()).n : 0;
    await env.DB.batch([env.DB.prepare('INSERT INTO pyramids(id,name,kind,apparatus,people,notes,demo_id,sort_order,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .bind(pid, name, KINDS.has(body.kind) ? body.kind : 'full', app(body.apparatus), Math.max(2, Math.min(40, Number(body.people) || 2)), str(body.notes, 2000), body.demo_id || null, order, actor.name, Date.now()), ...await spotStatements(env, pid, body.spots)]);
    return json({ ok: true, id: pid }, 201);
  }
  // Copy a library pyramid into a demo (kids cleared, so the demo can place its own).
  if (method === 'POST' && id && action === 'copy') {
    const src = await load(env, id); if (!src) return json({ error: 'Not found' }, 404);
    if (!body.demo_id) return json({ error: 'Choose a demo.' }, 400);
    const pid = crypto.randomUUID(), order = (await env.DB.prepare('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM pyramids WHERE demo_id=?').bind(body.demo_id).first()).n;
    await env.DB.batch([env.DB.prepare('INSERT INTO pyramids(id,name,kind,apparatus,people,notes,image_url,demo_id,sort_order,base_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(pid, src.name, src.kind, app(src.apparatus), src.people, src.notes, src.image_url, body.demo_id, order, src.id, actor.name, Date.now()),
      ...await spotStatements(env, pid, src.spots.map(s => ({ ...s, student_id: null })))]);
    return json({ ok: true, id: pid }, 201);
  }
  if (method === 'PUT' && id) {
    const sets = [], vals = [];
    if (body.name !== undefined) { sets.push('name=?'); vals.push(str(body.name, 120) || 'Pyramid'); }
    if (body.kind !== undefined && KINDS.has(body.kind)) { sets.push('kind=?'); vals.push(body.kind); }
    if (body.apparatus !== undefined) { sets.push('apparatus=?'); vals.push(app(body.apparatus)); }
    if (body.people !== undefined) { sets.push('people=?'); vals.push(Math.max(2, Math.min(40, Number(body.people) || 2))); }
    if (body.notes !== undefined) { sets.push('notes=?'); vals.push(str(body.notes, 2000)); }
    if (body.sort_order !== undefined) { sets.push('sort_order=?'); vals.push(Number(body.sort_order) || 0); }
    const st = sets.length ? [env.DB.prepare(`UPDATE pyramids SET ${sets.join(',')} WHERE id=?`).bind(...vals, id)] : [];
    if (Array.isArray(body.spots)) st.push(...await spotStatements(env, id, body.spots));
    if (st.length) await env.DB.batch(st);
    return json({ ok: true });
  }
  if (method === 'DELETE' && id) { await deletePhoto(env, (await env.DB.prepare('SELECT image_url FROM pyramids WHERE id=?').bind(id).first())?.image_url); await env.DB.batch([env.DB.prepare('DELETE FROM pyramid_spots WHERE pyramid_id=?').bind(id), env.DB.prepare('DELETE FROM pyramids WHERE id=?').bind(id)]); return json({ ok: true }); }
  return json({ error: 'Unknown pyramid route.' }, 404);
}

// ---- a demo's running order: pyramids, solos and group routines, each with a time and a song ----
// A kid's solo uses their own demo routine (student_demo_routines), kept on the kid so the next demo starts from it.
const LINEUP_KINDS = new Set(['pyramid', 'solo', 'routine']);
export async function handleLineup(path, method, request, env, url, actor) {
  if (path !== 'demo-lineup' && path !== 'student-demo-routine') return null;
  if (path === 'student-demo-routine') {
    if (method === 'GET') return json(await env.DB.prepare('SELECT student_id,apparatus,content,video_url,updated_at,updated_by FROM student_demo_routines WHERE student_id=?').bind(url.searchParams.get('student_id') || '').first() || {});
    if (method === 'PUT') {
      const b = await request.json().catch(() => ({}));
      if (!b.student_id) return json({ error: 'Choose a student.' }, 400);
      await env.DB.prepare("INSERT INTO student_demo_routines(student_id,apparatus,content,video_url,updated_at,updated_by) SELECT id,?,?,?,?,? FROM students WHERE id=? ON CONFLICT(student_id) DO UPDATE SET apparatus=excluded.apparatus,content=excluded.content,video_url=excluded.video_url,updated_at=excluded.updated_at,updated_by=excluded.updated_by")
        .bind(b.apparatus === 'rope' ? 'rope' : 'pole', str(b.content, 8000), /^https?:\/\//.test(b.video_url || '') ? b.video_url : null, Date.now(), actor.name, b.student_id).run();
      return json({ ok: true });
    }
  }
  const demo = url.searchParams.get('demo_id') || '';
  if (method === 'GET') {
    const rows = (await env.DB.prepare(`SELECT l.*,
        CASE l.kind WHEN 'pyramid' THEN p.name WHEN 'solo' THEN s.first_name||' '||COALESCE(s.last_name,'') ELSE r.title END AS label,
        sdr.content AS routine, sdr.apparatus AS routine_apparatus
      FROM demo_lineup l LEFT JOIN pyramids p ON l.kind='pyramid' AND p.id=l.ref_id LEFT JOIN students s ON l.kind='solo' AND s.id=l.ref_id
      LEFT JOIN demo_routines r ON l.kind='routine' AND r.id=l.ref_id LEFT JOIN student_demo_routines sdr ON l.kind='solo' AND sdr.student_id=l.ref_id
      WHERE l.demo_id=? ORDER BY l.sort_order`).bind(demo).all()).results;
    return json(rows);
  }
  if (method === 'PUT') {
    const b = await request.json().catch(() => ({}));
    if (!b.demo_id || !Array.isArray(b.items)) return json({ error: 'demo_id and items are required.' }, 400);
    const items = b.items.filter(i => LINEUP_KINDS.has(i?.kind) && typeof i.ref_id === 'string').slice(0, 100);
    await env.DB.batch([env.DB.prepare('DELETE FROM demo_lineup WHERE demo_id=?').bind(b.demo_id), ...items.map((i, k) => env.DB.prepare('INSERT INTO demo_lineup(id,demo_id,kind,ref_id,sort_order,duration,song_title,song_url) VALUES(?,?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), b.demo_id, i.kind, i.ref_id, k + 1, Math.max(0, Math.min(3600, Math.round(Number(i.duration) || 0))), str(i.song_title, 200), /^https?:\/\//.test(i.song_url || '') ? str(i.song_url, 500) : null))]);
    return json({ ok: true, items: items.length });
  }
  return json({ error: 'Method not allowed.' }, 405);
}
