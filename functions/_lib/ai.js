import { json } from './util.js';

// Coach assistant: free AI models only. Turns what a coach said or typed into checked actions (skills, counts, notes).
// Nothing is saved here; the browser shows the list and saves only what the coach confirms.

const OR_MODELS_URL = 'https://openrouter.ai/api/v1/models';
// shortcut: Groq and Gemini model names are fixed; update them here if those providers rename their free models.
const GROQ_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];
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
  if (env.OPENROUTER_API_KEY) for (const m of await openRouterFree()) out.push({ url: 'https://openrouter.ai/api/v1/chat/completions', key: env.OPENROUTER_API_KEY, model: m, name: 'openrouter/' + m });
  if (env.GROQ_API_KEY) for (const m of GROQ_MODELS) out.push({ url: 'https://api.groq.com/openai/v1/chat/completions', key: env.GROQ_API_KEY, model: m, name: 'groq/' + m });
  if (env.GEMINI_API_KEY) for (const m of GEMINI_MODELS) out.push({ url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', key: env.GEMINI_API_KEY, model: m, name: 'gemini/' + m });
  // Start with whichever model answered last time, so a model that ran out is not retried first.
  const i = out.findIndex(c => c.name === lastGood);
  return i > 0 ? [...out.slice(i), ...out.slice(0, i)] : out;
}

// Tries free models in turn until one answers with JSON. Rate limits, outages and bad JSON all move on to the next.
export async function askFree(env, messages, skip = '') {
  const tried = [];
  for (const c of await candidates(env)) {
    if (c.name === skip) continue;
    if (tried.length >= 8) break;
    tried.push(c.name);
    try {
      const r = await fetch(c.url, { method: 'POST', signal: AbortSignal.timeout(25000), headers: { 'content-type': 'application/json', authorization: 'Bearer ' + c.key }, body: JSON.stringify({ model: c.model, messages, temperature: 0 }) });
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

const PROMPT = `You turn a Mallakhamb coach's spoken or typed class notes into actions. The text may come from speech recognition, so names and Mallakhamb terms are often misheard (for example "lower bagli tedhi" for "Ulti Bagli Tedhi", "das rang" for "Dasrang", "sadi adi" for "Sadhi Adhi"). Match every name and term to the closest entry in the lists below by sound and spelling. Never invent students, skills or tests.
Return only JSON: {"actions":[...],"unclear":[...]}.
Actions:
- {"type":"skill","student":"<student id>","skill":"<skill id>","status":"learning"|"mastered","heard":"<the words this came from>"}  (working on, started, practising = learning; got it, mastered, completed, can do = mastered)
- {"type":"count","student":"<student id>","metric":"<test key>","value":<number>,"heard":"..."}  (e.g. "Riya did 32 dasrang" = dasrang_1min 32; seconds for holds)
- {"type":"note","student":"<student id>","worked_on":"...","next_steps":"...","heard":"..."}  (only for general comments that are not a skill or a count)
One action per student per item; "both", "all of them" and pronouns refer to the students just named. If a student name matches several students, or you are unsure, put a short sentence in "unclear" instead of guessing.`;

const CHECK = `You double-check an assistant. Given a coach's words and the actions it proposed, list the actions the words do not clearly support (wrong student, wrong skill, wrong number, wrong status) and anything the coach clearly asked for that is missing. Return only JSON: {"wrong":[{"index":<number>,"why":"..."}],"missing":["..."]}.`;

export async function handleAssistant(path, method, request, env) {
  if (path !== 'assistant' || method !== 'POST') return null;
  if (!env.OPENROUTER_API_KEY && !env.GROQ_API_KEY && !env.GEMINI_API_KEY) return json({ error: 'The AI assistant needs a free OPENROUTER_API_KEY (or GROQ_API_KEY / GEMINI_API_KEY) secret in Cloudflare.', setup: true }, 503);
  const body = await request.json().catch(() => null);
  const text = String(body?.text || '').trim().slice(0, 20000);
  if (!text) return json({ error: 'Say or type something first.' }, 400);
  const metrics = (Array.isArray(body.metrics) ? body.metrics : []).filter(m => Array.isArray(m) && /^[a-z0-9_]{1,40}$/.test(m[0])).slice(0, 60);
  const [students, skills] = (await env.DB.batch([
    env.DB.prepare('SELECT id,first_name,last_name FROM students WHERE COALESCE(active,1)=1'),
    env.DB.prepare('SELECT id,apparatus,level,name,COALESCE(general,0) AS general FROM skills WHERE COALESCE(active,1)=1')
  ])).map(r => r.results);
  const lists = `Students (id|name):\n${students.map(s => s.id + '|' + s.first_name + ' ' + (s.last_name || '')).join('\n')}\n\nSkills (id|apparatus level|name):\n${skills.map(s => s.id + '|' + s.apparatus + ' ' + (s.general ? 'general' : 'L' + s.level) + '|' + s.name).join('\n')}\n\nTests (key|name):\n${metrics.map(m => m[0] + '|' + String(m[1]).slice(0, 60)).join('\n')}`;

  const first = await askFree(env, [{ role: 'system', content: PROMPT + '\n\n' + lists }, { role: 'user', content: text }]);
  if (!first.data) return json({ error: 'Every free AI model is busy or out of free use right now. Try again in a minute.', tried: first.tried }, 503);
  const result = validate(first.data, { students, skills, metrics: metrics.map(m => m[0]) });

  // Second look, preferably by a different free model: flag actions the words do not support.
  const names = new Map(students.map(s => [s.id, s.first_name + ' ' + (s.last_name || '')])), sk = new Map(skills.map(s => [s.id, s.name]));
  const listed = result.actions.map((a, i) => `${i}: ${names.get(a.student)} ${a.type === 'skill' ? a.status + ' ' + sk.get(a.skill) : a.type === 'count' ? a.metric + ' = ' + a.value : 'note: ' + a.worked_on + ' ' + a.next_steps}`).join('\n');
  const check = result.actions.length ? await askFree(env, [{ role: 'system', content: CHECK }, { role: 'user', content: `Coach said:\n${text}\n\nProposed actions:\n${listed}` }], first.model) : { data: null };
  const flags = new Map((Array.isArray(check.data?.wrong) ? check.data.wrong : []).filter(w => Number.isInteger(w?.index)).map(w => [w.index, String(w.why || '').slice(0, 200)]));
  result.actions.forEach((a, i) => { if (flags.has(i)) a.doubt = flags.get(i) || 'The double-check was not sure about this one.'; });
  for (const m of (Array.isArray(check.data?.missing) ? check.data.missing : []).slice(0, 10)) result.unclear.push('Possibly missed: ' + String(m).slice(0, 200));
  return json({ ...result, model: first.model, checked_by: check.model || null });
}
