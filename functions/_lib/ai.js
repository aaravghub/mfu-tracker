import { json } from './util.js';

// Coach assistant: free AI models only. Turns what a coach said or typed into checked actions (skills, counts, notes).
// Nothing is saved here; the browser shows the list and saves only what the coach confirms.

const OR_MODELS_URL = 'https://openrouter.ai/api/v1/models';
// shortcut: Groq and Gemini model names are fixed; update them here if those providers rename their free models.
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
const GEMINI_MODELS = ['gemini-2.5-flash-lite', 'gemini-2.5-flash']; // fastest first
const STATUSES = new Set(['learning', 'mastered']);
let orCache = { at: 0, list: [] }, lastGood = '';

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
  if (env.GEMINI_API_KEY) for (const m of GEMINI_MODELS) out.push({ url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: env.GEMINI_API_KEY, model: m, name: 'gemini/' + m });
  if (env.OPENROUTER_API_KEY) for (const m of await openRouterFree()) out.push({ url: 'https://openrouter.ai/api/v1/chat/completions', key: env.OPENROUTER_API_KEY, model: m, name: 'openrouter/' + m });
  // Start with whichever model answered last time, so a model that ran out is not retried first.
  const i = out.findIndex(c => c.name === lastGood);
  return i > 0 ? [...out.slice(i), ...out.slice(0, i)] : out;
}

// Tries free models in turn until one answers with JSON, but never past `deadline` (a coach waits about 10 seconds at most).
// Rate limits, outages, slow models and bad JSON all move on to the next.
export async function askFree(env, messages, { skip = '', deadline = Date.now() + 9500 } = {}) {
  const tried = [];
  for (const c of await candidates(env)) {
    if (c.name === skip) continue;
    const left = deadline - Date.now();
    if (left < 1500) break;
    tried.push(c.name);
    try {
      const r = await fetch(c.url, { method: 'POST', signal: AbortSignal.timeout(Math.min(left, 5000)), headers: { 'content-type': 'application/json', authorization: 'Bearer ' + c.key }, body: JSON.stringify({ model: c.model, messages, temperature: 0 }) });
      if (!r.ok) continue;
      const data = extractJson((await r.json())?.choices?.[0]?.message?.content || '');
      if (!data) continue;
      lastGood = c.name;
      return { data, model: c.name };
    } catch { /* timeout or network: next model */ }
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

export async function handleAssistant(path, method, request, env) {
  if (path !== 'assistant' || method !== 'POST') return null;
  if (!env.OPENROUTER_API_KEY && !env.GROQ_API_KEY && !env.GEMINI_API_KEY) return json({ error: 'The AI assistant needs a free OPENROUTER_API_KEY (or GROQ_API_KEY / GEMINI_API_KEY) secret in Cloudflare.', setup: true }, 503);
  const body = await request.json().catch(() => null);
  const text = String(body?.text || '').trim().slice(0, 20000);
  if (!text) return json({ error: 'Say or type something first.' }, 400);
  if (body.mode === 'attendance') return attendanceFromWords(env, text, body);
  const metrics = (Array.isArray(body.metrics) ? body.metrics : []).filter(m => Array.isArray(m) && /^[a-z0-9_]{1,40}$/.test(m[0])).slice(0, 60);
  const deadline = Date.now() + 9500;
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
  if (!first.data) return json({ error: 'The free AI models are busy right now. Try again in a minute, or keep it shorter.', tried: first.tried }, 503);
  const result = validate(expandActions(first.data, { student: st, skill: kc, batch: bc, rosters }), { students, skills, metrics: metrics.map(m => m[0]) });

  // Second look, preferably by a different free model: flag actions the words do not support.
  const names = new Map(students.map(s => [s.id, s.first_name + ' ' + (s.last_name || '')])), sk = new Map(skills.map(s => [s.id, s.name]));
  const listed = result.actions.map((a, i) => `${i}: ${names.get(a.student)} ${a.type === 'skill' ? a.status + ' ' + sk.get(a.skill) : a.type === 'count' ? a.metric + ' = ' + a.value : 'note: ' + a.worked_on + ' ' + a.next_steps}`).join('\n');
  // Only when there is time left; the coach still reviews every item either way.
  const check = result.actions.length && deadline - Date.now() > 3000 ? await askFree(env, [{ role: 'system', content: CHECK }, { role: 'user', content: `Coach said:\n${text}\n\nProposed actions:\n${listed}` }], { skip: first.model, deadline }) : { data: null };
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
  const deadline = Date.now() + 9500;
  const onRoster = new Set(roster.map(r => r.id)), onCrew = new Set(crew.map(r => r.id));
  const name = s => s.first_name + ' ' + (s.last_name || '');
  const st = shortCodes('s', students), cc = shortCodes('c', coaches);
  const lists = `Roster students (id|name):\n${students.filter(s => onRoster.has(s.id)).map(s => st.to.get(s.id) + '|' + name(s)).join('\n')}\n\nBatch coaches (id|name):\n${coaches.filter(c => onCrew.has(c.id)).map(c => cc.to.get(c.id) + '|' + c.name).join('\n')}\n\nOther students who may drop in (id|name):\n${students.filter(s => !onRoster.has(s.id)).map(s => st.to.get(s.id) + '|' + name(s)).join('\n')}\n\nOther coaches (id|name):\n${coaches.filter(c => !onCrew.has(c.id)).map(c => cc.to.get(c.id) + '|' + c.name).join('\n')}`;
  const first = await askFree(env, [{ role: 'system', content: ATT_PROMPT + '\n\n' + lists }, { role: 'user', content: text }], { deadline });
  if (!first.data) return json({ error: 'The free AI models are busy right now. Try again in a minute.', tried: first.tried }, 503);
  for (const m of Array.isArray(first.data.marks) ? first.data.marks : []) m.id = (m.kind === 'coach' ? cc : st).from.get(m.id) || m.id;
  const result = validateAttendance(first.data, { students, coaches });
  const who = new Map([...students.map(s => ['student' + s.id, name(s)]), ...coaches.map(c => ['coach' + c.id, c.name])]);
  const listed = [result.rest ? `everyone else on the roster: ${result.rest}` : null, ...result.marks.map((m, i) => `${i}: ${who.get(m.kind + m.id)} ${m.status}`)].filter(Boolean).join('\n');
  const check = result.marks.length && deadline - Date.now() > 3000 ? await askFree(env, [{ role: 'system', content: CHECK }, { role: 'user', content: `Coach said:\n${text}\n\nProposed attendance:\n${listed}` }], { skip: first.model, deadline }) : { data: null };
  for (const w of Array.isArray(check.data?.wrong) ? check.data.wrong : []) if (result.marks[w?.index]) result.marks[w.index].doubt = String(w.why || 'The double-check was not sure about this one.').slice(0, 200);
  for (const m of (Array.isArray(check.data?.missing) ? check.data.missing : []).slice(0, 10)) result.unclear.push('Possibly missed: ' + String(m).slice(0, 200));
  return json({ ...result, model: first.model, checked_by: check.model || null });
}
