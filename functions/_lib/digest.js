import { json, esc } from './util.js';
import { mailConfigured, sendMessages, wrap } from './mail.js';

// The weekly email: each parent gets their own children's week (attendance, new skills, coach notes) and what is
// coming up. Off until the admin turns it on. Pages has no scheduler, so it goes out with the first visits to the
// site on or after Sunday morning (US time), a few parents per visit, each parent once per week.

const CHUNK = 15;
const marks = a => a.map(() => '?').join(',');
const all = async (env, sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results;
const meta = async (env, k) => (await env.DB.prepare('SELECT v FROM schema_meta WHERE k=?').bind(k).first())?.v;

// The Sunday this week's email belongs to. A new week starts Sunday 15:00 UTC (morning in the US).
export function weekKey(now = Date.now()) {
  const d = new Date(now - 15 * 3600e3);
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d.toISOString().slice(0, 10);
}

const day = d => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const time = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? `${((+m[1] + 11) % 12) + 1}:${m[2]} ${+m[1] >= 12 ? 'PM' : 'AM'}` : ''; };

// One parent's email from their children's rows. Null when there is nothing worth sending.
export function buildDigest(parent, kids, site) {
  const first = (parent.name || '').trim().split(/\s+/)[0];
  const html = [], text = [];
  let news = 0;
  for (const k of kids) {
    const a = k.attendance, came = (a.present || 0) + (a.late || 0), total = came + (a.absent || 0) + (a.excused || 0);
    const lines = [];
    if (total) lines.push(`Came to ${came} of ${total} class${total === 1 ? '' : 'es'} this week` + (a.absent ? ` (${a.absent} missed)` : '') + '.');
    if (k.mastered.length) lines.push('New skills mastered: ' + k.mastered.join(', ') + '.');
    for (const n of k.notes) lines.push(`Coach${n.author_name ? ' ' + n.author_name : ''}: ${[n.worked_on && 'worked on ' + n.worked_on, n.next_steps && 'next: ' + n.next_steps].filter(Boolean).join('; ')}`);
    if (!lines.length) continue;
    news += lines.length;
    html.push(`<h3 style="margin:22px 0 8px;font-size:16px">${esc(k.first_name)}</h3>` + lines.map(l => `<p style="margin:0 0 8px;line-height:1.5">${esc(l)}</p>`).join(''));
    text.push(k.first_name + '\n' + lines.join('\n'));
  }
  const up = parent.upcoming || [];
  if (up.length) {
    html.push('<h3 style="margin:22px 0 8px;font-size:16px">Coming up</h3>' + up.map(e => `<p style="margin:0 0 8px;line-height:1.5"><b>${esc(day(e.date))}</b>${e.time ? ' · ' + esc(time(e.time)) : ''} · ${esc(e.title)}${e.location ? ' · ' + esc(e.location) : ''}</p>`).join(''));
    text.push('Coming up\n' + up.map(e => `${day(e.date)}${e.time ? ' ' + time(e.time) : ''} - ${e.title}${e.location ? ' - ' + e.location : ''}`).join('\n'));
  }
  if (!news && !up.length) return null;
  const hi = first ? `Hi ${first},` : 'Hello,';
  return {
    to: parent.email, subject: kids.length === 1 ? `${kids[0].first_name}'s week at MFU` : 'Your week at MFU',
    html: wrap(`<p style="margin:0 0 6px">${esc(hi)}</p><p style="margin:0 0 6px;line-height:1.5">Here is this week at Mallakhamb.</p>${html.join('')}
      <p style="margin:22px 0 14px"><a href="${esc(site)}" style="display:inline-block;background:#f26b21;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:8px">Open MFU Tracker</a></p>
      <p style="color:#536075;font-size:13px;margin:0">The button signs you in. You get this once a week; turn it off under Account in MFU Tracker.</p>`),
    text: `${hi}\n\nHere is this week at Mallakhamb.\n\n${text.join('\n\n')}\n\nOpen MFU Tracker: ${site}\n\nYou get this once a week; turn it off under Account in MFU Tracker.`
  };
}

// Builds the emails for these parents ({id,email,name}).
async function digestsFor(env, parents, site) {
  if (!parents.length) return [];
  const links = await all(env, `SELECT ps.parent_id,s.id,s.first_name FROM parent_students ps JOIN students s ON s.id=ps.student_id WHERE COALESCE(s.active,1)=1 AND ps.parent_id IN (${marks(parents)}) ORDER BY s.first_name`, ...parents.map(p => p.id));
  const ids = [...new Set(links.map(l => l.id))];
  if (!ids.length) return [];
  const q = marks(ids);
  const [att, mastered, notes, demoKids, events, demos, practices] = (await env.DB.batch([
    env.DB.prepare(`SELECT student_id,status,COUNT(*) AS n FROM student_attendance WHERE attendance_date>=date('now','-7 days') AND student_id IN (${q}) GROUP BY student_id,status`).bind(...ids),
    env.DB.prepare(`SELECT p.student_id,k.name FROM student_skill_progress p JOIN skills k ON k.id=p.skill_id WHERE p.status='mastered' AND p.mastered_date>=date('now','-7 days') AND p.student_id IN (${q})`).bind(...ids),
    env.DB.prepare(`SELECT student_id,worked_on,next_steps,author_name FROM student_notes WHERE created_at>=datetime('now','-7 days') AND student_id IN (${q}) ORDER BY created_at DESC`).bind(...ids),
    env.DB.prepare(`SELECT demo_id,student_id FROM demo_students WHERE student_id IN (${q})`).bind(...ids),
    env.DB.prepare("SELECT title,event_date AS date,event_time AS time,location FROM events WHERE event_date BETWEEN date('now') AND date('now','+14 days')"),
    env.DB.prepare("SELECT id,title,demo_date AS date,start_time AS time,location FROM demos WHERE demo_date BETWEEN date('now') AND date('now','+14 days')"),
    env.DB.prepare("SELECT demo_id,title,practice_date AS date,start_time AS time,location FROM practices WHERE practice_date BETWEEN date('now') AND date('now','+14 days')")
  ])).map(r => r.results);
  return parents.map(p => {
    const kids = links.filter(l => l.parent_id === p.id).map(k => ({
      first_name: k.first_name,
      attendance: Object.fromEntries(att.filter(a => a.student_id === k.id).map(a => [a.status, a.n])),
      mastered: mastered.filter(m => m.student_id === k.id).map(m => m.name),
      notes: notes.filter(n => n.student_id === k.id && (n.worked_on || n.next_steps)).slice(0, 2), id: k.id
    }));
    if (!kids.length) return null;
    const mine = new Set(demoKids.filter(d => kids.some(k => k.id === d.student_id)).map(d => d.demo_id));
    const upcoming = [...events, ...demos.filter(d => mine.has(d.id)), ...practices.filter(x => mine.has(x.demo_id))].sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || ''))).slice(0, 8);
    return buildDigest({ ...p, upcoming }, kids, site);
  }).filter(Boolean);
}

// Claims up to CHUNK parents for this week (one statement, so two visits never email the same parent) and emails them.
async function sendChunk(env, site, key) {
  const parents = await all(env, `UPDATE parents SET digest_week=?1 WHERE id IN (SELECT p.id FROM parents p WHERE COALESCE(p.active,1)=1 AND COALESCE(p.digest_off,0)=0 AND COALESCE(p.digest_week,'')<>?1 AND EXISTS(SELECT 1 FROM parent_students ps WHERE ps.parent_id=p.id) LIMIT ${CHUNK}) RETURNING id,email,name`, key);
  if (!parents.length) return { claimed: 0, sent: 0 };
  const msgs = await digestsFor(env, parents, site);
  const r = msgs.length ? await sendMessages(env, msgs, { cc: false }) : { sent: 0 };
  return { claimed: parents.length, sent: r.sent || 0, error: r.error };
}

const left = async (env, key) => (await env.DB.prepare("SELECT COUNT(*) AS n FROM parents p WHERE COALESCE(p.active,1)=1 AND COALESCE(p.digest_off,0)=0 AND COALESCE(p.digest_week,'')<>? AND EXISTS(SELECT 1 FROM parent_students ps WHERE ps.parent_id=p.id)").bind(key).first()).n;

// Called on visits (in the background). Looks at most once every 10 minutes per server instance.
let looked = 0;
export async function maybeSendDigest(env, site) {
  if (Date.now() - looked < 600e3) return;
  looked = Date.now();
  if (!mailConfigured(env) || await meta(env, 'digest') !== 'on') return;
  await sendChunk(env, site, weekKey());
}

// Admin: digest (status), digest/setting {on}, digest/preview, digest/send.
export async function handleDigest(path, method, request, env, site, adminEmail) {
  const [root, action] = path.split('/');
  if (root !== 'digest') return null;
  const key = weekKey();
  if (method === 'GET') return json({ on: await meta(env, 'digest') === 'on', mail: mailConfigured(env), waiting: await left(env, key) });
  if (method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (action === 'setting') {
    const on = !!(await request.json().catch(() => ({}))).on;
    // Turning it on never sends at once: everyone counts as done for this week, so the first email is next Sunday.
    await env.DB.batch([env.DB.prepare('INSERT INTO schema_meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind('digest', on ? 'on' : 'off'), ...(on ? [env.DB.prepare('UPDATE parents SET digest_week=?').bind(key)] : [])]);
    return json({ ok: true, on });
  }
  if (!mailConfigured(env)) return json({ error: 'Email is not connected yet.' }, 400);
  if (action === 'preview') {
    // The first few parents' real emails, sent to the admin only.
    const some = await all(env, 'SELECT id,email,name FROM parents p WHERE COALESCE(active,1)=1 AND EXISTS(SELECT 1 FROM parent_students ps WHERE ps.parent_id=p.id) LIMIT 40');
    const msgs = (await digestsFor(env, some, site)).slice(0, 2).map(m => ({ ...m, subject: '[Preview for ' + m.to + '] ' + m.subject, to: adminEmail }));
    if (!msgs.length) return json({ error: 'Nothing to send yet: no attendance, skills, notes or upcoming events this week.' }, 400);
    const r = await sendMessages(env, msgs, { cc: false, links: false });
    return r.sent ? json({ ok: true, sent: r.sent, to: adminEmail }) : json({ error: r.error || 'Could not send.' }, 502);
  }
  if (action === 'send') {
    // Send this week's email now. `restart` (the first tap) makes everyone due again; later taps continue.
    if ((await request.json().catch(() => ({}))).restart) await env.DB.prepare('UPDATE parents SET digest_week=NULL').run();
    const until = Date.now() + 20000; let sent = 0, error;
    while (Date.now() < until) { const r = await sendChunk(env, site, key); sent += r.sent; error = r.error; if (!r.claimed || r.error) break; }
    return json({ ok: !error, sent, waiting: await left(env, key), error });
  }
  return json({ error: 'Unknown route.' }, 404);
}

