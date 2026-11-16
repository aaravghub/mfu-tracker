import { json } from './util.js';

// Coach assistant: free AI models only. Turns what a coach said or typed into checked actions (skills, counts, notes).
// Nothing is saved here; the browser shows the list and saves only what the coach confirms.

const OR_MODELS_URL = 'https://openrouter.ai/api/v1/models';
// shortcut: Groq model names are fixed; update them here if Groq renames its free models.
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/openai';
const STATUSES = new Set(['learning', 'mastered']);
let orCache = { at: 0, list: [] }, gemCache = { at: 0, list: [] }, lastGood = '';

// The Flash models this Gemini key can use right now, newest first (full Flash before Lite: better at matching names).
// Asked from Google and refreshed hourly, so a renamed or retired model never breaks the assistant.
async function geminiModels(key) {
  if (Date.now() - gemCache.at < 36e5 && gemCache.list.length) return gemCache.list;
  const r = await fetch(GEMINI + '/models', { headers: { authorization: 'Bearer ' + key } }).then(x => x.json()).catch(() => null);
  const ver = id => Number(/gemini-(\d+(?:\.\d+)?)/.exec(id)?.[1] || 0);
  const list = (r?.data || []).map(m => String(m.id).replace(/^models\//, ''))
    .filter(id => /^gemini-[\d.]+-flash/.test(id) && !/image|tts|audio|live|embed|thinking|exp/.test(id))
    // Lite first: it answers in seconds; the full Flash models think first and can take over 10 s on a long roster.
    .sort((a, b) => b.includes('lite') - a.includes('lite') || ver(b) - ver(a) || a.includes('preview') - b.includes('preview') || a.length - b.length)
    .slice(0, 4);
  gemCache = { at: Date.now(), list: list.length ? list : ['gemini-2.5-flash', 'gemini-2.5-flash-lite'] };
  return gemCache.list;
}

// Every model OpenRouter currently prices at $0, biggest context first. Refreshed hourly, so new free models join on their own.
async function openRouterFree() {
  if (Date.now() - orCache.at < 36e5 && orCache.list.length) return orCache.list;
  const r = await fetch(OR_MODELS_URL).then(x => x.json()).catch(() => null);
  const size = id => Number(/(\d+(?:\.\d+)?)b\b/i.exec(id)?.[1] || 100); // parameter count from the name; unknown counts as large
  const list = (r?.data || []).filter(m => (m.id.endsWith(':free') || (Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0 && Number(m.pricing?.request || 0) === 0))
      && (m.architecture?.output_modalities || ['text']).join() === 'text' && size(m.id) >= 8) // chat models only, none too small to follow the format
    .sort((a, b) => (b.id === 'openrouter/free') - (a.id === 'openrouter/free') || (b.context_length || 0) - (a.context_length || 0)).slice(0, 20).map(m => m.id);
  if (list.length) orCache = { at: Date.now(), list };
  return orCache.list;
}

async function candidates(env) {
  const out = [];
  // Fast providers first (answers in a few seconds); OpenRouter's free models are often queued, so they are the backup.
  if (env.GROQ_API_KEY) for (const m of GROQ_MODELS) out.push({ url: 'https://api.groq.com/openai/v1/chat/completions', key: env.GROQ_API_KEY, model: m, name: 'groq/' + m });
  if (env.GEMINI_API_KEY) for (const m of await geminiModels(env.GEMINI_API_KEY)) out.push({ url: GEMINI + '/chat/completions', key: env.GEMINI_API_KEY, model: m, name: 'gemini/' + m, extra: { reasoning_effort: 'low' }, race: true });
  if (env.OPENROUTER_API_KEY) for (const m of await openRouterFree()) out.push({ url: 'https://openrouter.ai/api/v1/chat/completions', key: env.OPENROUTER_API_KEY, model: m, name: 'openrouter/' + m });
  // Start with whichever model answered last time, so a model that ran out is not retried first.
  const i = out.findIndex(c => c.name === lastGood);
  return i > 0 ? [...out.slice(i), ...out.slice(0, i)] : out;
}

// One model call. Resolves to { data, model } or throws an Error saying why it failed.
async function callOne(c, messages, ms, stop) {
  let r;
  try { r = await fetch(c.url, { method: 'POST', signal: AbortSignal.any([AbortSignal.timeout(ms), stop]), headers: { 'content-type': 'application/json', authorization: 'Bearer ' + c.key }, body: JSON.stringify({ model: c.model, messages, temperature: 0, ...c.extra }) }); }
  catch (e) { throw Error(e.name === 'TimeoutError' ? 'too slow' : stop.aborted ? 'cancelled' : 'network error'); }
  if (!r.ok) throw Error(`${r.status} ${String((await r.json().catch(() => ({})))?.error?.message || '').slice(0, 120)}`);
  const data = extractJson((await r.json().catch(() => null))?.choices?.[0]?.message?.content || '');
  if (!data) throw Error('answer was not JSON');
  return { data, model: c.name };
}

// Asks the fast models (Gemini) all at once and takes the first good answer, cancelling the rest; then tries the
// others (OpenRouter's free models) one by one. Never past `deadline`; `tried` says why each model failed.
export async function askFree(env, messages, { skip = '', deadline = Date.now() + 20000 } = {}) {
  const list = (await candidates(env)).filter(c => c.name !== skip), tried = [];
  const racers = list.filter(c => c.race).slice(0, 3), rest = list.filter(c => !racers.includes(c));
  const note = c => e => { tried.push(`${c.name}: ${e.message}`); throw e; };
  if (racers.length) {
    const stop = new AbortController();
    try { const win = await Promise.any(racers.map(c => callOne(c, messages, deadline - Date.now(), stop.signal).catch(note(c)))); stop.abort(); lastGood = win.model; return win; }
    catch { /* every racer failed: fall through to the others */ }
  }
  for (const c of rest) {
    const left = deadline - Date.now();
    if (left < 1500) break;
    try { const win = await callOne(c, messages, Math.min(left, 12000), new AbortController().signal); lastGood = win.model; return win; }
    catch (e) { tried.push(`${c.name}: ${e.message}`); }
  }
  return { data: null, tried };
}

// Models often wrap JSON in prose or code fences; take the outermost object.
export function extractJson(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}

// Short codes (s1, k1, b1) stand in for long ids in the prompt: smaller prompts and answers, so free models reply in seconds.
export function shortCodes(prefix, rows) {
  const to = new Map(), from = new Map();
  rows.forEach((r, i) => { to.set(r.id, prefix + (i + 1)); from.set(prefix + (i + 1), r.id); });
  return { to, from };
}

// Turns the model's codes back into ids and spreads "students": [...] or "batch" + "except" into one action per student.
export function expandActions(raw, { student, skill, batch, rosters }) {
  const actions = [];
  for (const a of Array.isArray(raw?.actions) ? raw.actions.slice(0, 200) : []) {
    const except = new Set((Array.isArray(a.except) ? a.except : []).map(c => student.from.get(c)));
    const who = a.batch ? [...(rosters.get(batch.from.get(a.batch)) || [])].filter(id => !except.has(id))
      : (Array.isArray(a.students) ? a.students : [a.student]).map(c => student.from.get(c) || c);
    const { students, batch: _b, except: _e, ...rest } = a;
    for (const id of who) actions.push({ ...rest, student: id, skill: skill.from.get(a.skill) || a.skill });
  }
  return { ...raw, actions };
}

// Keeps only actions that point at real students, skills and metrics with sane values. Everything else becomes a note to the coach.
export function validate(raw, { students, skills, metrics }) {
  const S = new Map(students.map(s => [s.id, s])), K = new Map(skills.map(s => [s.id, s])), M = new Set(metrics);
  const actions = [], unclear = (Array.isArray(raw?.unclear) ? raw.unclear : []).map(String).slice(0, 20);
  for (const a of Array.isArray(raw?.actions) ? raw.actions.slice(0, 200) : []) {
    const heard = String(a?.heard || '').slice(0, 300), who = S.get(a?.student);
    if (!who) { unclear.push(`No student matched${heard ? ` in “${heard}”` : ''}.`); continue; }
    if (a.type === 'skill' && K.has(a.skill) && STATUSES.has(a.status)) actions.push({ type: 'skill', student: who.id, skill: a.skill, status: a.status, heard });
    else if (a.type === 'count' && M.has(a.metric) && Number.isFinite(+a.value) && +a.value >= 0 && +a.value <= 1000) actions.push({ type: 'count', student: who.id, metric: a.metric, value: Math.round(+a.value * 10) / 10, heard });
    else if (a.type === 'note' && (a.worked_on || a.next_steps)) actions.push({ type: 'note', student: who.id, worked_on: String(a.worked_on || '').slice(0, 2000), next_steps: String(a.next_steps || '').slice(0, 2000), heard });
    else unclear.push(`Couldn't use “${heard || a?.type || 'an item'}”: the skill, test or value didn't match.`);
  }
  return { actions, unclear };
}

// Attendance: a status for everyone not mentioned ("rest") plus each person named. Only real students and coaches survive.
const ATT = new Set(['present', 'late', 'absent', 'excused']);
export function validateAttendance(raw, { students, coaches }) {
  const ids = { student: new Set(students.map(s => s.id)), coach: new Set(coaches.map(c => c.id)) };
  const unclear = (Array.isArray(raw?.unclear) ? raw.unclear : []).map(String).slice(0, 20), marks = [], seen = new Set();
  for (const m of Array.isArray(raw?.marks) ? raw.marks.slice(0, 300) : []) {
    const heard = String(m?.heard || '').slice(0, 300), kind = m?.kind === 'coach' ? 'coach' : 'student';
    if (!ids[kind].has(m?.id) || !ATT.has(m?.status)) { unclear.push(`Couldn't use “${heard || 'an item'}”: no ${kind} or status matched.`); continue; }
    if (seen.has(kind + m.id)) continue;
    seen.add(kind + m.id); marks.push({ kind, id: m.id, status: m.status, heard });
  }
  return { rest: ATT.has(raw?.rest) ? raw.rest : null, marks, unclear };
}

const ATT_PROMPT = `You take Mallakhamb class attendance from a coach's spoken or typed words. Names are often misheard by speech recognition; match them to the closest person in the lists by sound and spelling. Never invent people.
Return only JSON: {"rest":"present"|"absent"|null,"marks":[{"kind":"student"|"coach","id":"<id>","status":"present"|"late"|"absent"|"excused","heard":"<the words>"}],"unclear":["..."]}
"rest" is the status for everyone on the roster who is not named ("everyone's here except..." = present; "only X and Y came" = absent; null if the coach didn't say). Put every named person in "marks", including people not on the roster who came (drop-ins). Sick, injured or excused = excused. If a name matches several people or you are unsure, write it in "unclear" instead of guessing.`;

const PROMPT = `You turn a Mallakhamb coach's spoken or typed class notes into actions. The text may come from speech recognition, so names and Mallakhamb terms are often misheard (for example "lower bagli tedhi" for "Ulti Bagli Tedhi", "das rang" for "Dasrang", "sadi adi" for "Sadhi Adhi"). Match every name and term to the closest entry in the lists below by sound and spelling. Never invent students, skills or tests.
Return only JSON: {"actions":[...],"unclear":[...]}.
Actions (use the short codes from the lists):
- {"type":"skill","student":"s1","skill":"k1","status":"learning"|"mastered","heard":"<the words this came from>"}  (working on, started, practising = learning; got it, learned, mastered, completed, can do = mastered)
- {"type":"count","student":"s1","metric":"<test key>","value":<number>,"heard":"..."}  (e.g. "Riya did 32 dasrang" = dasrang_1min 32; seconds for holds)
- {"type":"note","student":"s1","worked_on":"...","next_steps":"...","heard":"..."}  (only for general comments that are not a skill or a count)
For several students, use "students":["s1","s2"] instead of "student". For a whole batch use "batch":"b1" and list anyone left out in "except":["s5"]; do not list the batch's students yourself. "Both", "all of them" and pronouns refer to the students just named. If a student name matches several students, or you are unsure, put a short sentence in "unclear" instead of guessing.`;

const CHECK = `You double-check an assistant. Given a coach's words and the actions it proposed, list the actions the words do not clearly support (wrong student, wrong skill, wrong number, wrong status) and anything the coach clearly asked for that is missing. Return only JSON: {"wrong":[{"index":<number>,"why":"..."}],"missing":["..."]}.`;

// ---- Ask anything: the whole tracker as compact text, and a free model answers from it ----
const ASK_PROMPT = `You are the assistant inside MFU Tracker, used by Mallakhamb coaches. Answer the coach's question using only the data below. Be short and specific: names, numbers, dates. Plain sentences or a short list, no markdown symbols. If the data does not have the answer, say so; never guess or invent people, dates or numbers. Names may be misheard by speech recognition; match them to the closest name in the data.
Return only JSON: {"answer":"...","actions":[...]}. "actions" is empty unless the coach asks you to DO one of these two things:
- {"type":"announcement","title":"...","body":"..."}  (post an announcement to parents)
- {"type":"practice","demo":"<demo code like d1>","date":"YYYY-MM-DD","start_time":"HH:MM","end_time":"HH:MM","location":"...","notes":"..."}  (schedule a practice for a demo; work out the date from today's date)
The coach confirms every action before it happens, so say in "answer" what you prepared. You cannot do anything else; for other changes, say which page to use.`;

// One query at a time so a missing table or column loses only its own section, never the whole answer.
const rowsOf = async (env, sql) => { try { return (await env.DB.prepare(sql).all()).results; } catch { return []; } };

export async function snapshot(env) {
  const [centers, coaches, batches, bs, bc, students, links, att, absent, prog, learning, fit, notes, events, demos, ds, practices, meetings, reqs, anns, scores, spots] = await Promise.all([
    'SELECT id,name FROM centers',
    'SELECT id,name,center_id FROM coaches WHERE COALESCE(active,1)=1',
    'SELECT id,name,days,start_time,center_id FROM batches WHERE COALESCE(active,1)=1',
    'SELECT batch_id,student_id FROM batch_students',
    'SELECT batch_id,coach_id FROM batch_coaches',
    'SELECT id,first_name,last_name,center_id,pole_level,rope_level,yoga_level,parent_name,gender FROM students WHERE COALESCE(active,1)=1 ORDER BY first_name,last_name',
    "SELECT ps.student_id,p.name FROM parent_students ps JOIN parents p ON p.id=ps.parent_id WHERE COALESCE(p.name,'')<>''",
    "SELECT student_id,status,COUNT(*) AS n FROM student_attendance WHERE attendance_date>=date('now','-60 days') GROUP BY student_id,status",
    "SELECT student_id,MAX(attendance_date) AS d FROM student_attendance WHERE status='absent' GROUP BY student_id",
    "SELECT student_id,COUNT(*) AS n FROM student_skill_progress WHERE status='mastered' GROUP BY student_id",
    "SELECT p.student_id,k.name FROM student_skill_progress p JOIN skills k ON k.id=p.skill_id WHERE p.status='learning'",
    'SELECT f.student_id,f.metric,f.value,f.record_date FROM fitness_records f JOIN (SELECT student_id,metric,MAX(record_date) AS d FROM fitness_records GROUP BY student_id,metric) m ON m.student_id=f.student_id AND m.metric=f.metric AND m.d=f.record_date',
    "SELECT n.created_at,n.worked_on,n.next_steps,n.author_name,s.first_name||' '||COALESCE(s.last_name,'') AS student FROM student_notes n JOIN students s ON s.id=n.student_id ORDER BY n.created_at DESC LIMIT 40",
    "SELECT title,event_type,event_date,event_time,location FROM events WHERE event_date>=date('now','-30 days') ORDER BY event_date LIMIT 60",
    "SELECT id,title,demo_date,start_time,arrive_time,location FROM demos WHERE demo_date>=date('now','-30 days') ORDER BY demo_date LIMIT 30",
    'SELECT demo_id,student_id FROM demo_students',
    "SELECT title,practice_date,start_time,end_time,location FROM practices WHERE practice_date>=date('now','-1 day') ORDER BY practice_date LIMIT 40",
    "SELECT title,meeting_date,start_time,location FROM meetings WHERE meeting_date>=date('now','-1 day') ORDER BY meeting_date LIMIT 40",
    "SELECT r.kind,r.subject,r.status,r.created_at,p.name AS parent,s.first_name||' '||COALESCE(s.last_name,'') AS student FROM parent_requests r LEFT JOIN parents p ON p.id=r.parent_id LEFT JOIN students s ON s.id=r.student_id WHERE COALESCE(r.status,'open')<>'closed' ORDER BY r.created_at DESC LIMIT 40",
    'SELECT title,body,created_at FROM announcements ORDER BY created_at DESC LIMIT 12',
    "SELECT e.title,e.event_date,c.apparatus,c.score,s.first_name||' '||COALESCE(s.last_name,'') AS student FROM comp_scores c JOIN events e ON e.id=c.event_id JOIN students s ON s.id=c.student_id ORDER BY e.event_date DESC LIMIT 300",
    "SELECT py.demo_id,py.name AS pyramid,COALESCE(k.name,sp.skill_name) AS skill,s.first_name||' '||COALESCE(s.last_name,'') AS student FROM pyramid_spots sp JOIN pyramids py ON py.id=sp.pyramid_id LEFT JOIN skills k ON k.id=sp.skill_id LEFT JOIN students s ON s.id=sp.student_id WHERE py.demo_id IS NOT NULL ORDER BY py.sort_order,sp.position"
  ].map(q => rowsOf(env, q)));
  const by = (rows, key) => { const m = new Map(); for (const r of rows) (m.get(r[key]) || m.set(r[key], []).get(r[key])).push(r); return m; };
  const cn = new Map(centers.map(c => [c.id, c.name])), sn = new Map(students.map(s => [s.id, s.first_name + ' ' + (s.last_name || '')])), bn = new Map(batches.map(b => [b.id, b.name])), kn = new Map(coaches.map(c => [c.id, c.name]));
  const sb = by(bs, 'student_id'), bsB = by(bs, 'batch_id'), bcB = by(bc, 'batch_id'), pl = by(links, 'student_id'), at = by(att, 'student_id'), lr = by(learning, 'student_id'), ft = by(fit, 'student_id'), dsD = by(ds, 'demo_id'), spD = by(spots, 'demo_id');
  const ab = new Map(absent.map(r => [r.student_id, r.d])), ms = new Map(prog.map(r => [r.student_id, r.n]));
  const demoCodes = shortCodes('d', demos), cut = (v, n) => String(v || '').replace(/\s+/g, ' ').slice(0, n);
  const text = [
    'Today: ' + new Date().toISOString().slice(0, 10) + ' (' + new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }) + ')',
    'Centers: ' + centers.map(c => c.name).join(', '),
    'Coaches (name|center|batches):\n' + coaches.map(c => `${c.name}|${cn.get(c.center_id) || ''}|${bc.filter(x => x.coach_id === c.id).map(x => bn.get(x.batch_id)).filter(Boolean).join(', ')}`).join('\n'),
    'Batches (name|center|days|start|coaches|number of students):\n' + batches.map(b => `${b.name}|${cn.get(b.center_id) || ''}|${b.days || ''}|${b.start_time || ''}|${(bcB.get(b.id) || []).map(x => kn.get(x.coach_id)).filter(Boolean).join(', ')}|${(bsB.get(b.id) || []).length}`).join('\n'),
    'Students (name|center|levels pole/rope/yoga|batches|parents|attendance last 60 days present/late/absent/excused|last absent|skills mastered|skills being learned|latest fitness):\n' + students.map(s => {
      const a = Object.fromEntries((at.get(s.id) || []).map(r => [r.status, r.n]));
      return [sn.get(s.id), cn.get(s.center_id) || '', `${s.pole_level}/${s.rope_level}/${s.yoga_level}`, (sb.get(s.id) || []).map(x => bn.get(x.batch_id)).filter(Boolean).join(', '),
        [...new Set([s.parent_name, ...(pl.get(s.id) || []).map(x => x.name)].filter(Boolean))].join(', '), `${a.present || 0}/${a.late || 0}/${a.absent || 0}/${a.excused || 0}`, ab.get(s.id) || '', ms.get(s.id) || 0,
        (lr.get(s.id) || []).slice(0, 6).map(x => x.name).join(', '), (ft.get(s.id) || []).map(f => `${f.metric}=${f.value}`).join(' ')].join('|');
    }).join('\n'),
    'Events (date|type|title|time|place):\n' + events.map(e => `${e.event_date}|${e.event_type}|${e.title}|${e.event_time || ''}|${e.location || ''}`).join('\n'),
    'Demos (code|date|title|start|arrive by|place|kids in it):\n' + demos.map(d => `${demoCodes.to.get(d.id)}|${d.demo_date}|${d.title}|${d.start_time || ''}|${d.arrive_time || ''}|${d.location || ''}|${(dsD.get(d.id) || []).map(x => sn.get(x.student_id)).filter(Boolean).join(', ')}`).join('\n'),
    'Demo pyramids (demo code|pyramid|spots as kid: skill):\n' + demos.filter(d => spD.has(d.id)).flatMap(d => [...by(spD.get(d.id), 'pyramid')].map(([name, sp]) => `${demoCodes.to.get(d.id)}|${name}|${sp.map(x => (x.student?.trim() || 'open') + ': ' + (x.skill || '?')).join('; ')}`)).join('\n'),
    'Practices (date|title|time|place):\n' + practices.map(p => `${p.practice_date}|${p.title}|${p.start_time || ''}${p.end_time ? '-' + p.end_time : ''}|${p.location || ''}`).join('\n'),
    'Meetings (date|title|time|place):\n' + meetings.map(m => `${m.meeting_date}|${m.title}|${m.start_time || ''}|${m.location || ''}`).join('\n'),
    'Open parent requests (date|kind|parent|student|subject):\n' + reqs.map(r => `${cut(r.created_at, 10)}|${r.kind || ''}|${r.parent || ''}|${r.student || ''}|${cut(r.subject, 100)}`).join('\n'),
    'Recent coach notes (date|student|worked on|next steps|by):\n' + notes.map(n => `${cut(n.created_at, 10)}|${n.student}|${cut(n.worked_on, 140)}|${cut(n.next_steps, 140)}|${n.author_name || ''}`).join('\n'),
    'Recent announcements (date|title|text):\n' + anns.map(a => `${cut(a.created_at, 10)}|${a.title}|${cut(a.body, 160)}`).join('\n'),
    'Competition scores (date|event|student|apparatus|score):\n' + scores.map(c => `${c.event_date}|${c.title}|${c.student}|${c.apparatus}|${c.score}`).join('\n')
  ].join('\n\n');
  return { text, demoCodes };
}

// Keeps only actions the app can really do, with clean values.
export function validateAsk(raw, demoCodes) {
  const str = (v, n) => String(v ?? '').trim().slice(0, n), time = v => /^\d{2}:\d{2}$/.test(v || '') ? v : '';
  const actions = [];
  for (const a of (Array.isArray(raw?.actions) ? raw.actions : []).slice(0, 5)) {
    if (a?.type === 'announcement' && str(a.title, 200)) actions.push({ type: 'announcement', title: str(a.title, 200), body: str(a.body, 6000) });
    else if (a?.type === 'practice' && demoCodes.from.has(a.demo) && /^\d{4}-\d{2}-\d{2}$/.test(a.date || '')) actions.push({ type: 'practice', demo_id: demoCodes.from.get(a.demo), date: a.date, start_time: time(a.start_time), end_time: time(a.end_time), location: str(a.location, 200), notes: str(a.notes, 2000) });
  }
  return { answer: str(raw?.answer, 6000), actions };
}

async function askEverything(env, text) {
  const { text: data, demoCodes } = await snapshot(env);
  const r = await askFree(env, [{ role: 'system', content: ASK_PROMPT + '\n\nDATA\n' + data }, { role: 'user', content: text }]);
  if (!r.data) return json({ error: 'No free AI model answered in time. ' + r.tried.join(' · '), tried: r.tried }, 503);
  const out = validateAsk(r.data, demoCodes);
  if (!out.answer && !out.actions.length) return json({ error: 'The assistant gave an empty answer. Try asking again in other words.' }, 502);
  return json({ ...out, model: r.model });
}

export async function handleAssistant(path, method, request, env) {
  if (path !== 'assistant' || method !== 'POST') return null;
  if (!env.OPENROUTER_API_KEY && !env.GROQ_API_KEY && !env.GEMINI_API_KEY) return json({ error: 'The AI assistant needs a free OPENROUTER_API_KEY (or GROQ_API_KEY / GEMINI_API_KEY) secret in Cloudflare.', setup: true }, 503);
  const body = await request.json().catch(() => null);
  const text = String(body?.text || '').trim().slice(0, 20000);
  if (!text) return json({ error: 'Say or type something first.' }, 400);
  if (body.mode === 'attendance') return attendanceFromWords(env, text, body);
  if (body.mode === 'ask') return askEverything(env, text);
  const metrics = (Array.isArray(body.metrics) ? body.metrics : []).filter(m => Array.isArray(m) && /^[a-z0-9_]{1,40}$/.test(m[0])).slice(0, 60);
  const deadline = Date.now() + 20000;
  const [students, skills, batches, members] = (await env.DB.batch([
    env.DB.prepare('SELECT id,first_name,last_name FROM students WHERE COALESCE(active,1)=1'),
    env.DB.prepare('SELECT id,apparatus,level,name,COALESCE(general,0) AS general FROM skills WHERE COALESCE(active,1)=1'),
    env.DB.prepare('SELECT id,name,days FROM batches WHERE COALESCE(active,1)=1'),
    env.DB.prepare('SELECT batch_id,student_id FROM batch_students')
  ])).map(r => r.results);
  const st = shortCodes('s', students), kc = shortCodes('k', skills), bc = shortCodes('b', batches);
  const rosters = new Map(batches.map(b => [b.id, new Set()]));
  for (const m of members) if (st.to.has(m.student_id)) rosters.get(m.batch_id)?.add(m.student_id);
  const lists = `Students (code|name):\n${students.map(s => st.to.get(s.id) + '|' + s.first_name + ' ' + (s.last_name || '')).join('\n')}\n\nBatches (code|name|days):\n${batches.map(b => bc.to.get(b.id) + '|' + b.name + '|' + (b.days || '')).join('\n')}\n\nSkills (code|apparatus level|name):\n${skills.map(s => kc.to.get(s.id) + '|' + s.apparatus + ' ' + (s.general ? 'general' : 'L' + s.level) + '|' + s.name).join('\n')}\n\nTests (key|name):\n${metrics.map(m => m[0] + '|' + String(m[1]).slice(0, 60)).join('\n')}`;

  const first = await askFree(env, [{ role: 'system', content: PROMPT + '\n\n' + lists }, { role: 'user', content: text }], { deadline });
  if (!first.data) return json({ error: 'No free AI model answered in time. ' + first.tried.join(' · '), tried: first.tried }, 503);
  const result = validate(expandActions(first.data, { student: st, skill: kc, batch: bc, rosters }), { students, skills, metrics: metrics.map(m => m[0]) });

  // Second look, preferably by a different free model: flag actions the words do not support.
  const names = new Map(students.map(s => [s.id, s.first_name + ' ' + (s.last_name || '')])), sk = new Map(skills.map(s => [s.id, s.name]));
  const listed = result.actions.map((a, i) => `${i}: ${names.get(a.student)} ${a.type === 'skill' ? a.status + ' ' + sk.get(a.skill) : a.type === 'count' ? a.metric + ' = ' + a.value : 'note: ' + a.worked_on + ' ' + a.next_steps}`).join('\n');
  // Only when there is time left; the coach still reviews every item either way.
  const check = result.actions.length && deadline - Date.now() > 5000 ? await askFree(env, [{ role: 'system', content: CHECK }, { role: 'user', content: `Coach said:\n${text}\n\nProposed actions:\n${listed}` }], { skip: first.model, deadline }) : { data: null };
  const flags = new Map((Array.isArray(check.data?.wrong) ? check.data.wrong : []).filter(w => Number.isInteger(w?.index)).map(w => [w.index, String(w.why || '').slice(0, 200)]));
  result.actions.forEach((a, i) => { if (flags.has(i)) a.doubt = flags.get(i) || 'The double-check was not sure about this one.'; });
  for (const m of (Array.isArray(check.data?.missing) ? check.data.missing : []).slice(0, 10)) result.unclear.push('Possibly missed: ' + String(m).slice(0, 200));
  return json({ ...result, model: first.model, checked_by: check.model || null });
}

async function attendanceFromWords(env, text, body) {
  if (!body.batch_id) return json({ error: 'Choose a batch first.' }, 400);
  const [roster, crew, students, coaches] = (await env.DB.batch([
    env.DB.prepare('SELECT student_id AS id FROM batch_students WHERE batch_id=?').bind(body.batch_id),
    env.DB.prepare('SELECT coach_id AS id FROM batch_coaches WHERE batch_id=?').bind(body.batch_id),
    env.DB.prepare('SELECT id,first_name,last_name FROM students WHERE COALESCE(active,1)=1'),
    env.DB.prepare('SELECT id,name FROM coaches WHERE COALESCE(active,1)=1')
  ])).map(r => r.results);
  const deadline = Date.now() + 20000;
  const onRoster = new Set(roster.map(r => r.id)), onCrew = new Set(crew.map(r => r.id));
  const name = s => s.first_name + ' ' + (s.last_name || '');
  const st = shortCodes('s', students), cc = shortCodes('c', coaches);
  const lists = `Roster students (id|name):\n${students.filter(s => onRoster.has(s.id)).map(s => st.to.get(s.id) + '|' + name(s)).join('\n')}\n\nBatch coaches (id|name):\n${coaches.filter(c => onCrew.has(c.id)).map(c => cc.to.get(c.id) + '|' + c.name).join('\n')}\n\nOther students who may drop in (id|name):\n${students.filter(s => !onRoster.has(s.id)).map(s => st.to.get(s.id) + '|' + name(s)).join('\n')}\n\nOther coaches (id|name):\n${coaches.filter(c => !onCrew.has(c.id)).map(c => cc.to.get(c.id) + '|' + c.name).join('\n')}`;
  const first = await askFree(env, [{ role: 'system', content: ATT_PROMPT + '\n\n' + lists }, { role: 'user', content: text }], { deadline });
  if (!first.data) return json({ error: 'No free AI model answered in time. ' + first.tried.join(' · '), tried: first.tried }, 503);
  for (const m of Array.isArray(first.data.marks) ? first.data.marks : []) m.id = (m.kind === 'coach' ? cc : st).from.get(m.id) || m.id;
  const result = validateAttendance(first.data, { students, coaches });
  const who = new Map([...students.map(s => ['student' + s.id, name(s)]), ...coaches.map(c => ['coach' + c.id, c.name])]);
  const listed = [result.rest ? `everyone else on the roster: ${result.rest}` : null, ...result.marks.map((m, i) => `${i}: ${who.get(m.kind + m.id)} ${m.status}`)].filter(Boolean).join('\n');
  const check = result.marks.length && deadline - Date.now() > 5000 ? await askFree(env, [{ role: 'system', content: CHECK }, { role: 'user', content: `Coach said:\n${text}\n\nProposed attendance:\n${listed}` }], { skip: first.model, deadline }) : { data: null };
  for (const w of Array.isArray(check.data?.wrong) ? check.data.wrong : []) if (result.marks[w?.index]) result.marks[w.index].doubt = String(w.why || 'The double-check was not sure about this one.').slice(0, 200);
  for (const m of (Array.isArray(check.data?.missing) ? check.data.missing : []).slice(0, 10)) result.unclear.push('Possibly missed: ' + String(m).slice(0, 200));
  return json({ ...result, model: first.model, checked_by: check.model || null });
}
