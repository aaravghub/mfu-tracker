import { json, cleanEmail, isEmail, esc } from './util.js';
import { mailConfigured, sendMessages, siteUrl, wrap } from './mail.js';
import { recipientsFor } from './admin-extra.js';

// Forms and sign-ups. Staff build forms (or get one made automatically for an evaluation, competition or demo),
// share the link, email it, or attach it to an announcement. Parents fill it in once per child.
const str = (v, max = 2000) => String(v ?? '').trim().slice(0, max);
const all = async (env, sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results;
const one = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).first();
const parse = (v, d) => { try { return JSON.parse(v); } catch { return d; } };
const TYPES = new Set(['text', 'textarea', 'choice', 'multi', 'checkbox', 'number', 'date']);
const fmtDate = d => { const t = new Date(String(d) + 'T00:00:00Z'); return isNaN(t) ? String(d) : t.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }); };
export const formLink = (env, request, id) => siteUrl(env, request) + '/#form=' + id;

function cleanFields(fields) {
  const out = [];
  for (const f of (Array.isArray(fields) ? fields : []).slice(0, 40)) {
    const label = str(f?.label, 200); if (!label || !TYPES.has(f.type)) continue;
    const options = ['choice', 'multi'].includes(f.type) ? [...new Set((Array.isArray(f.options) ? f.options : String(f.options || '').split(',')).map(o => str(o, 100)).filter(Boolean))].slice(0, 30) : [];
    if (['choice', 'multi'].includes(f.type) && !options.length) throw new Error(`Add some choices to “${label}”.`);
    out.push({ id: str(f.id, 40) || crypto.randomUUID().slice(0, 8), type: f.type, label, required: !!f.required, options, help: str(f.help, 300) });
  }
  if (!out.length) throw new Error('Add at least one question.');
  return out;
}
// Checks answers against the form's questions; returns cleaned answers or throws a readable error.
function cleanAnswers(fields, answers = {}) {
  const out = {};
  for (const f of fields) {
    let v = answers[f.id];
    if (f.type === 'multi') v = (Array.isArray(v) ? v : []).filter(x => f.options.includes(x));
    else if (f.type === 'choice') v = f.options.includes(v) ? v : '';
    else if (f.type === 'checkbox') v = !!v;
    else if (f.type === 'number') v = v === '' || v == null ? '' : (Number.isFinite(Number(v)) ? Number(v) : '');
    else v = str(v, f.type === 'textarea' ? 4000 : 300);
    const empty = v === '' || v === false || (Array.isArray(v) && !v.length);
    if (f.required && empty) throw new Error(`Please answer “${f.label}”.`);
    out[f.id] = v;
  }
  return out;
}
const isOpen = f => f.status === 'open' && (!f.closes_on || f.closes_on >= new Date().toISOString().slice(0, 10));
const shape = f => ({ ...f, fields: parse(f.fields, []), open: isOpen(f) });

// The ready-made sign-up form for an evaluation, competition or demo.
async function autoForm(env, kind, refId) {
  if (kind === 'demo') {
    const d = await one(env, 'SELECT * FROM demos WHERE id=?', refId); if (!d) throw new Error('Demo not found.');
    return { title: `Sign up: ${d.title}`, description: `${fmtDate(d.demo_date)}${d.location ? ' · ' + d.location : ''}. Let us know if your child can be part of this demo.`, kind, demo_id: d.id, closes_on: d.demo_date,
      fields: [{ id: 'attend', type: 'choice', label: 'Can your child take part?', required: true, options: ['Yes', 'No'] }, { id: 'notes', type: 'textarea', label: 'Anything we should know? (optional)' }] };
  }
  const e = await one(env, 'SELECT * FROM events WHERE id=?', refId); if (!e) throw new Error('Event not found.');
  if (e.event_type === 'evaluation') return { title: `Sign up: ${e.title}`, description: `${fmtDate(e.event_date)}${e.location ? ' · ' + e.location : ''}. Sign your child up for this evaluation.`, kind: 'evaluation', event_id: e.id, closes_on: e.event_date,
    fields: [{ id: 'apparatus', type: 'multi', label: 'Which apparatus will your child be evaluated on?', required: true, options: ['Pole', 'Rope', 'Yoga'] }, { id: 'notes', type: 'textarea', label: 'Anything the coaches should know? (optional)' }] };
  return { title: `Sign up: ${e.title}`, description: `${fmtDate(e.event_date)}${e.location ? ' · ' + e.location : ''}. Sign your child up for this competition.`, kind: 'competition', event_id: e.id, closes_on: e.event_date,
    fields: [{ id: 'apparatus', type: 'multi', label: 'Which events will your child compete in?', required: true, options: ['Pole', 'Rope'] }, { id: 'notes', type: 'textarea', label: 'Anything we should know? (optional)' }] };
}

// What a sign-up does beyond saving the answers: evaluation sign-ups join the evaluation, demo "Yes" joins the demo.
function sideEffects(env, form, studentId, answers) {
  if (!studentId) return [];
  if (form.kind === 'evaluation' && form.event_id) return [env.DB.prepare('INSERT OR IGNORE INTO eval_participants(event_id,student_id) VALUES(?,?)').bind(form.event_id, studentId)];
  if (form.kind === 'demo' && form.demo_id) return answers.attend === 'Yes'
    ? [env.DB.prepare('INSERT OR IGNORE INTO demo_students(demo_id,student_id) VALUES(?,?)').bind(form.demo_id, studentId)]
    : [env.DB.prepare('DELETE FROM demo_students WHERE demo_id=? AND student_id=? AND status IS NULL').bind(form.demo_id, studentId)];
  return [];
}
async function saveResponse(env, form, { parentId = null, studentId = null, name = '', email = '' }, answers) {
  const prev = studentId ? await one(env, 'SELECT id FROM form_responses WHERE form_id=? AND student_id=?', form.id, studentId)
    : parentId ? await one(env, 'SELECT id FROM form_responses WHERE form_id=? AND parent_id=? AND student_id IS NULL', form.id, parentId) : null;
  const st = prev
    ? [env.DB.prepare("UPDATE form_responses SET answers=?,parent_id=COALESCE(?,parent_id),updated_at=datetime('now') WHERE id=?").bind(JSON.stringify(answers), parentId, prev.id)]
    : [env.DB.prepare('INSERT INTO form_responses(id,form_id,parent_id,student_id,name,email,answers) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(), form.id, parentId, studentId, name, email, JSON.stringify(answers))];
  await env.DB.batch([...st, ...sideEffects(env, form, studentId, answers)]);
  return { updated: !!prev };
}

/* ---------- staff ---------- */
export async function handleForms(path, method, request, env, url, actor) {
  const [root, id, action] = path.split('/');
  if (root !== 'forms') return null;
  const body = (method === 'POST' || method === 'PUT') ? await request.clone().json().catch(() => ({})) : {};
  const by = actor.name || 'Admin';

  if (method === 'GET' && !id) {
    const rows = await all(env, "SELECT f.*,(SELECT COUNT(*) FROM form_responses r WHERE r.form_id=f.id) AS responses,e.title AS event_title,e.event_date,d.title AS demo_title,d.demo_date FROM forms f LEFT JOIN events e ON e.id=f.event_id LEFT JOIN demos d ON d.id=f.demo_id ORDER BY f.created_at DESC");
    return json(rows.map(r => ({ ...shape(r), link: formLink(env, request, r.id) })));
  }
  // Make (or reuse) the sign-up form for an evaluation, competition or demo.
  if (method === 'POST' && id === 'auto') {
    const kind = body.kind === 'demo' ? 'demo' : 'event', refId = body.ref_id;
    const existing = await one(env, `SELECT * FROM forms WHERE ${kind === 'demo' ? 'demo_id' : 'event_id'}=? ORDER BY created_at LIMIT 1`, refId);
    if (existing) return json({ ok: true, id: existing.id, existed: true, link: formLink(env, request, existing.id) });
    let f; try { f = await autoForm(env, kind, refId); } catch (e) { return json({ error: e.message }, 404); }
    const fid = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO forms(id,title,description,kind,event_id,demo_id,fields,per_child,audience,closes_on,created_by) VALUES(?,?,?,?,?,?,?,1,?,?,?)').bind(fid, f.title, f.description, f.kind, f.event_id || null, f.demo_id || null, JSON.stringify(f.fields), 'parents', f.closes_on || null, by).run();
    return json({ ok: true, id: fid, link: formLink(env, request, fid) }, 201);
  }
  if ((method === 'POST' && !id) || (method === 'PUT' && id && !action)) {
    const title = str(body.title, 200);
    if (!title) return json({ error: 'Give the form a title.' }, 400);
    let fields; try { fields = cleanFields(body.fields); } catch (e) { return json({ error: e.message }, 400); }
    if (body.closes_on && !/^\d{4}-\d{2}-\d{2}$/.test(body.closes_on)) return json({ error: 'Dates must look like 2026-11-30.' }, 400);
    const audience = body.audience === 'anyone' ? 'anyone' : 'parents', perChild = audience === 'parents' && body.per_child !== false ? 1 : 0;
    const vals = [title, str(body.description, 3000), JSON.stringify(fields), perChild, audience, body.closes_on || null, body.status === 'closed' ? 'closed' : 'open'];
    if (id) { await env.DB.prepare('UPDATE forms SET title=?,description=?,fields=?,per_child=?,audience=?,closes_on=?,status=? WHERE id=?').bind(...vals, id).run(); return json({ ok: true, id }); }
    const fid = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO forms(title,description,fields,per_child,audience,closes_on,status,id,created_by) VALUES(?,?,?,?,?,?,?,?,?)').bind(...vals, fid, by).run();
    return json({ ok: true, id: fid, link: formLink(env, request, fid) }, 201);
  }
  if (method === 'DELETE' && id) { await env.DB.batch([env.DB.prepare('UPDATE announcements SET form_id=NULL WHERE form_id=?').bind(id), env.DB.prepare('DELETE FROM forms WHERE id=?').bind(id)]); return json({ ok: true }); }
  const form = id ? await one(env, 'SELECT * FROM forms WHERE id=?', id) : null;
  if (!form) return json({ error: 'Form not found.' }, 404);

  if (method === 'GET' && action === 'responses') {
    const rows = await all(env, 'SELECT r.*,s.first_name,s.last_name,s.center_id,p.name AS parent_name,p.email AS parent_email FROM form_responses r LEFT JOIN students s ON s.id=r.student_id LEFT JOIN parents p ON p.id=r.parent_id WHERE r.form_id=? ORDER BY r.updated_at DESC', id);
    return json({ form: shape(form), responses: rows.map(r => ({ ...r, answers: parse(r.answers, {}) })) });
  }
  // Email the form link to everyone, one center, or specific students' parents.
  if (method === 'POST' && action === 'email') {
    if (!mailConfigured(env)) return json({ error: 'Gmail is not set up yet, so the form can\'t be emailed. Copy the link instead.' }, 400);
    const recips = await recipientsFor(env, body.audience || {});
    if (!recips.length) return json({ error: 'No parent emails match that audience.' }, 400);
    const link = formLink(env, request, id), msg = str(body.message, 2000);
    const r = await sendMessages(env, recips.map(p => ({
      to: p.email, subject: form.title,
      html: wrap(`<p style="margin:0 0 14px">${esc(p.name ? 'Hi ' + p.name.split(/\s+/)[0] + ',' : 'Hello,')}</p>${msg ? `<p style="margin:0 0 14px;line-height:1.55">${esc(msg).replace(/\n/g, '<br>')}</p>` : ''}<p style="margin:0 0 6px;font-weight:700;font-size:17px">${esc(form.title)}</p>${form.description ? `<p style="margin:0 0 16px;color:#536075;line-height:1.5">${esc(form.description)}</p>` : ''}<p style="margin:0 0 14px"><a href="${esc(link)}" style="display:inline-block;background:#f26b21;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:8px">${form.kind === 'general' ? 'Open the form' : 'Sign up'}</a></p>${form.closes_on ? `<p style="color:#536075;font-size:13px;margin:0">Please respond by ${esc(fmtDate(form.closes_on))}.</p>` : ''}`),
      text: `${msg ? msg + '\n\n' : ''}${form.title}\n${form.description || ''}\n\n${link}`
    })));
    await env.DB.prepare('INSERT INTO email_log(id,subject,audience,total,sent,failed,is_test) VALUES(?,?,?,?,?,?,0)').bind(crypto.randomUUID(), form.title, 'form', recips.length, r.sent, r.failed).run();
    return json({ ok: true, sent: r.sent, failed: r.failed, total: recips.length });
  }
  // Post (or update) an announcement that carries the form.
  if (method === 'POST' && action === 'announce') {
    const aid = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO announcements(id,title,body,audience,center_id,pinned,created_by,form_id) VALUES(?,?,?,'parents',?,?,?,?)").bind(aid, str(body.title, 200) || form.title, str(body.body, 4000) || form.description || '', body.center_id || null, body.pinned ? 1 : 0, by, id).run();
    return json({ ok: true, id: aid }, 201);
  }
  return json({ error: 'Method not allowed.' }, 405);
}

/* ---------- parents ---------- */
export async function parentForms(env, parent, children) {
  const forms = (await all(env, "SELECT f.*,e.event_date,d.demo_date FROM forms f LEFT JOIN events e ON e.id=f.event_id LEFT JOIN demos d ON d.id=f.demo_id WHERE f.status='open' AND f.audience='parents' ORDER BY COALESCE(f.closes_on,'9999') ")).map(shape).filter(f => f.open);
  const mine = forms.length ? await all(env, `SELECT form_id,student_id,answers,updated_at FROM form_responses WHERE parent_id=? OR student_id IN (${children.map(() => '?').join(',') || "''"})`, parent.id, ...children.map(c => c.id)) : [];
  return forms.map(f => ({ ...f, responses: mine.filter(r => r.form_id === f.id).map(r => ({ student_id: r.student_id, answers: parse(r.answers, {}), updated_at: r.updated_at })) }));
}
export async function handleParentForms(sub, method, body, env, parent) {
  const m = /^forms\/([\w-]+)$/.exec(sub); if (!m) return null;
  const form = await one(env, 'SELECT * FROM forms WHERE id=?', m[1]);
  if (!form) return json({ error: 'This form no longer exists.' }, 404);
  const f = shape(form);
  if (method === 'GET') return json(f);
  if (method !== 'POST') return null;
  if (!f.open) return json({ error: 'This form is closed.' }, 400);
  let answers; try { answers = cleanAnswers(f.fields, body.answers); } catch (e) { return json({ error: e.message }, 400); }
  let studentId = null;
  if (form.per_child) {
    const kid = await one(env, 'SELECT s.id FROM parent_students ps JOIN students s ON s.id=ps.student_id WHERE ps.parent_id=? AND s.id=?', parent.id, body.student_id);
    if (!kid) return json({ error: 'Choose which child this is for.' }, 400);
    studentId = kid.id;
  }
  const r = await saveResponse(env, form, { parentId: parent.id, studentId, name: parent.name, email: parent.email }, answers);
  return json({ ok: true, ...r });
}

/* ---------- anyone with the link (forms set to "anyone") ---------- */
export async function handlePublicForm(path, method, request, env) {
  const id = path.split('/')[1];
  const form = id ? await one(env, 'SELECT * FROM forms WHERE id=?', id) : null;
  if (!form) return json({ error: 'This form no longer exists.' }, 404);
  const f = shape(form);
  // Parent-only forms only reveal their title so the page can ask the person to sign in.
  if (method === 'GET') return json(form.audience === 'anyone' ? f : { id: f.id, title: f.title, audience: 'parents', needs_login: true });
  if (method !== 'POST' || form.audience !== 'anyone') return json({ error: 'Please sign in as a parent to fill this in.' }, 401);
  if (!f.open) return json({ error: 'This form is closed.' }, 400);
  const body = await request.json().catch(() => ({}));
  const name = str(body.name, 120), email = cleanEmail(body.email);
  if (!name || !isEmail(email)) return json({ error: 'Enter your name and a valid email.' }, 400);
  let answers; try { answers = cleanAnswers(f.fields, body.answers); } catch (e) { return json({ error: e.message }, 400); }
  await saveResponse(env, form, { name, email }, answers);
  return json({ ok: true });
}
