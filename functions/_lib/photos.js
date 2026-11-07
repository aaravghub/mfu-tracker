import { json } from './util.js';

// Photos for students, skills and fitness tests, stored in R2 (binding PHOTOS).
// The browser shrinks every photo before upload; each upload gets a new key, so a photo URL never changes and is
// cached for a year in the browser and at Cloudflare's edge. Counters keep usage inside R2's free tier.

const MAX_BYTES = 400 * 1024; // the browser aims for 300 KB; this is the hard ceiling
// R2 free tier: 10 GB stored, 1M writes and 10M reads a month. Stop a little short of each.
const LIMIT = { bytes: 9.5e9, writes: 900000, reads: 9000000 };
const KEY_RE = /^(student|skill|metric|routine|progress)\/[A-Za-z0-9_-]{1,80}\/[0-9a-f-]{36}\.(webp|jpg)$/;
const one = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).first();
// Where each kind of photo is recorded. `old` is the photo it replaces (null: none; undefined: the target does not exist).
const TARGET = {
  student: async (env, id) => { const r = await one(env, 'SELECT photo_url AS url FROM students WHERE id=?', id); return { old: r ? r.url : undefined, set: url => env.DB.prepare('UPDATE students SET photo_url=? WHERE id=?').bind(url, id) }; },
  skill: async (env, id) => { const r = await one(env, 'SELECT image_url AS url FROM skills WHERE id=?', id); return { old: r ? r.url : undefined, set: url => env.DB.prepare('UPDATE skills SET image_url=? WHERE id=?').bind(url, id) }; },
  metric: async (env, id) => ({ old: (await one(env, 'SELECT image_url AS url FROM metric_photos WHERE metric=?', id))?.url ?? null, set: url => env.DB.prepare('INSERT INTO metric_photos(image_url,metric) VALUES(?,?) ON CONFLICT(metric) DO UPDATE SET image_url=excluded.image_url').bind(url, id) }),
  // id is "<student id>--pole" or "--rope"
  routine: async (env, id) => {
    const [sid, app] = [id.slice(0, id.lastIndexOf('--')), id.slice(id.lastIndexOf('--') + 2)];
    if (!['pole', 'rope'].includes(app) || !await one(env, 'SELECT 1 FROM students WHERE id=?', sid)) return { old: undefined };
    return { old: (await one(env, 'SELECT photo_url AS url FROM routines WHERE student_id=? AND apparatus=?', sid, app))?.url ?? null, set: url => env.DB.prepare('INSERT INTO routines(id,student_id,apparatus,photo_url) VALUES(?,?,?,?) ON CONFLICT(student_id,apparatus) DO UPDATE SET photo_url=excluded.photo_url').bind(crypto.randomUUID(), sid, app, url) };
  },
  // A progress photo is added, never replaced; caption and date come with the upload.
  progress: async (env, id, q, by) => {
    if (!await one(env, 'SELECT 1 FROM students WHERE id=?', id)) return { old: undefined };
    const date = /^\d{4}-\d{2}-\d{2}$/.test(q.get('taken_date') || '') ? q.get('taken_date') : null;
    return { old: null, set: url => env.DB.prepare('INSERT INTO student_photos(id,student_id,url,caption,taken_date,added_by) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(), id, url, String(q.get('caption') || '').slice(0, 300), date, by || null) };
  }
};

// Removes a stored photo (when its record is deleted) and gives back its storage.
export async function deletePhoto(env, url) {
  const key = String(url || '').startsWith('/api/photo/') ? url.slice('/api/photo/'.length) : null;
  if (!env.PHOTOS || !key || !KEY_RE.test(key)) return;
  const head = await env.PHOTOS.head(key);
  await env.PHOTOS.delete(key);
  if (head) await bump(env, 'r2_bytes', -head.size).run();
}
const month = () => new Date().toISOString().slice(0, 7);
const meter = async (env, k) => Number((await env.DB.prepare('SELECT v FROM schema_meta WHERE k=?').bind(k).first())?.v || 0);
const bump = (env, k, n) => env.DB.prepare('INSERT INTO schema_meta(k,v) VALUES(?1,?2) ON CONFLICT(k) DO UPDATE SET v=CAST(v AS INTEGER)+?2').bind(k, n);

export async function servePhoto(path, request, env) {
  const key = path.slice('photo/'.length);
  if (!KEY_RE.test(key)) return json({ error: 'Not found' }, 404);
  const cache = caches.default, cacheKey = new Request(new URL('/__photo/' + key, request.url).toString());
  let res = await cache.match(cacheKey);
  if (!res) {
    if (!env.PHOTOS) return json({ error: 'Photo storage is not set up.' }, 503);
    if (await meter(env, 'r2_reads_' + month()) >= LIMIT.reads) return json({ error: 'Photo reads paused for this month to stay free.' }, 503);
    const obj = await env.PHOTOS.get(key);
    await bump(env, 'r2_reads_' + month(), 1).run();
    if (!obj) return json({ error: 'Not found' }, 404);
    res = new Response(obj.body, { headers: { 'content-type': obj.httpMetadata?.contentType || 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' } });
    await cache.put(cacheKey, res.clone());
  }
  // Signed-in viewers only, so the browser keeps it privately; the edge copy above is keyed by an unguessable URL.
  const out = new Response(res.body, res);
  out.headers.set('cache-control', 'private, max-age=31536000, immutable');
  return out;
}

export async function savePhoto(env, kind, id, request, by = '') {
  if (!env.PHOTOS) return json({ error: 'Photo storage is not set up.' }, 503);
  if (!TARGET[kind] || !/^[A-Za-z0-9_-]{1,80}$/.test(id || '')) return json({ error: 'Unknown photo target.' }, 400);
  const type = (request.headers.get('content-type') || '').split(';')[0];
  if (type !== 'image/webp' && type !== 'image/jpeg') return json({ error: 'Send a JPEG or WebP photo.' }, 415);
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) return json({ error: 'That photo is too large. Try again; it is shrunk before upload.' }, 413);
  if (await meter(env, 'r2_bytes') + bytes.byteLength > LIMIT.bytes) return json({ error: 'Photo storage is full for the free plan. Delete old photos first.' }, 507);
  if (await meter(env, 'r2_writes_' + month()) >= LIMIT.writes) return json({ error: 'Photo uploads are paused for this month to stay free.' }, 503);
  const { old, set } = await TARGET[kind](env, id, new URL(request.url).searchParams, by);
  if (old === undefined) return json({ error: 'Not found.' }, 404);
  const key = `${kind}/${id}/${crypto.randomUUID()}.${type === 'image/webp' ? 'webp' : 'jpg'}`, url = '/api/photo/' + key;
  await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: type } });
  await env.DB.batch([set(url), bump(env, 'r2_bytes', bytes.byteLength), bump(env, 'r2_writes_' + month(), 1)]);
  // Replace: remove the previous photo so storage only holds what is shown. Deletes are free in R2.
  await deletePhoto(env, old);
  return json({ ok: true, url });
}
