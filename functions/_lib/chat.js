import { json } from './util.js';
import { getSession } from './auth.js';

// Chats for every batch and every demo, plus polls (in a chat, or open to everyone).
// Text only, kept in D1 (free); a message is at most 2000 characters. Browsers ask for new messages every few
// seconds with "after the last id I have", which reads only new rows thanks to the (chat, id) index.

const MAX_TEXT = 2000;
const now = () => Math.floor(Date.now() / 1000);

// Who is asking: role, a stable voter key and a display name.
async function who(request, env) {
  const s = await getSession(request, env);
  if (!s) return null;
  if (s.role === 'admin') return { role: 'admin', key: 'admin', name: 'MFU Admin' };
  if (s.role === 'coach' && s.coach_id) { const c = await env.DB.prepare('SELECT id,name FROM coaches WHERE id=? AND COALESCE(active,1)=1').bind(s.coach_id).first(); return c && { role: 'coach', id: c.id, key: 'coach:' + c.id, name: c.name }; }
  if (s.role === 'parent' && s.parent_id) { const p = await env.DB.prepare('SELECT id,name,email FROM parents WHERE id=? AND COALESCE(active,1)=1').bind(s.parent_id).first(); return p && { role: 'parent', id: p.id, key: 'parent:' + p.id, name: p.name || p.email }; }
  return null;
}

// The chats this person may open. Admin: all; coach: their batches and every demo; parent: their children's batches and demos.
async function chatsFor(env, me) {
  const recent = "date('now','-60 days')";
  const q = {
    admin: [`SELECT 'batch:'||id AS chat,name AS title,'batch' AS kind FROM batches WHERE COALESCE(active,1)=1`,
      `SELECT 'demo:'||id AS chat,title,'demo' AS kind,demo_date AS date FROM demos WHERE demo_date>=${recent}`],
    coach: [`SELECT 'batch:'||b.id AS chat,b.name AS title,'batch' AS kind FROM batch_coaches bc JOIN batches b ON b.id=bc.batch_id WHERE bc.coach_id=?1 AND COALESCE(b.active,1)=1`,
      `SELECT 'demo:'||id AS chat,title,'demo' AS kind,demo_date AS date FROM demos WHERE demo_date>=${recent}`],
    parent: [`SELECT DISTINCT 'batch:'||b.id AS chat,b.name AS title,'batch' AS kind FROM parent_students ps JOIN batch_students bs ON bs.student_id=ps.student_id JOIN batches b ON b.id=bs.batch_id WHERE ps.parent_id=?1 AND COALESCE(b.active,1)=1`,
      `SELECT DISTINCT 'demo:'||d.id AS chat,d.title,'demo' AS kind,d.demo_date AS date FROM parent_students ps JOIN demo_students ds ON ds.student_id=ps.student_id JOIN demos d ON d.id=ds.demo_id WHERE ps.parent_id=?1 AND d.demo_date>=${recent}`]
  }[me.role];
  const rows = (await env.DB.batch(q.map(sql => me.id ? env.DB.prepare(sql).bind(me.id) : env.DB.prepare(sql)))).flatMap(r => r.results);
  if (!rows.length) return [];
  // Latest message per chat, for the list.
  const last = (await env.DB.prepare(`SELECT chat,MAX(id) AS id FROM chat_messages WHERE chat IN (${rows.map(() => '?').join(',')}) GROUP BY chat`).bind(...rows.map(r => r.chat)).all()).results;
  const lastId = new Map(last.map(r => [r.chat, r.id]));
  return rows.map(r => ({ ...r, last_id: lastId.get(r.chat) || 0 }));
}

const canSee = async (env, me, chat) => (await chatsFor(env, me)).some(c => c.chat === chat);
const staff = me => me.role === 'admin' || me.role === 'coach';

// A poll with its counts, what this person chose, and (for coaches) who chose what.
async function pollView(env, me, poll) {
  const votes = (await env.DB.prepare('SELECT voter,voter_name,choice FROM poll_votes WHERE poll_id=?').bind(poll.id).all()).results;
  const options = JSON.parse(poll.options || '[]');
  return {
    id: poll.id, chat: poll.chat, question: poll.question, options, multi: !!poll.multi, closed: !!poll.closed, created_by: poll.created_by, created_at: poll.created_at,
    counts: options.map((_, i) => votes.filter(v => v.choice === i).length),
    voters: new Set(votes.map(v => v.voter)).size,
    mine: votes.filter(v => v.voter === me.key).map(v => v.choice),
    names: staff(me) ? options.map((_, i) => votes.filter(v => v.choice === i).map(v => v.voter_name)) : undefined
  };
}

export async function handleChat(path, method, request, env) {
  const [root, a, b] = path.split('/');
  if (root !== 'chats' && root !== 'chat' && root !== 'polls') return null;
  const me = await who(request, env);
  if (!me) return json({ error: 'Please sign in.' }, 401);
  const url = new URL(request.url), body = method === 'POST' ? await request.json().catch(() => ({})) : {};

  // GET chats: the chat list, plus polls open to everyone.
  if (root === 'chats' && method === 'GET') {
    const [chats, open] = await Promise.all([chatsFor(env, me), env.DB.prepare("SELECT * FROM polls WHERE chat IS NULL AND created_at>? ORDER BY created_at DESC LIMIT 20").bind(now() - 90 * 86400).all()]);
    return json({ chats, polls: await Promise.all(open.results.map(p => pollView(env, me, p))), me: { role: me.role, key: me.key } });
  }

  // GET chat/<chat>?after=<id>: new messages; POST chat/<chat>: send a message.
  if (root === 'chat' && a) {
    const chat = decodeURIComponent(a);
    if (!/^(batch|demo):[A-Za-z0-9_-]{1,80}$/.test(chat) || !await canSee(env, me, chat)) return json({ error: 'Not your chat.' }, 403);
    if (method === 'GET') {
      const after = Math.max(0, Number(url.searchParams.get('after')) || 0);
      const msgs = (await env.DB.prepare('SELECT id,author_key,author_name,author_role,body,pinned,poll_id,created_at FROM chat_messages WHERE chat=? AND id>? ORDER BY id DESC LIMIT 100').bind(chat, after).all()).results.reverse();
      const pollIds = [...new Set(msgs.map(m => m.poll_id).filter(Boolean))];
      const polls = pollIds.length ? (await env.DB.prepare(`SELECT * FROM polls WHERE id IN (${pollIds.map(() => '?').join(',')})`).bind(...pollIds).all()).results : [];
      const pinned = after ? null : (await env.DB.prepare('SELECT id,author_name,body,created_at FROM chat_messages WHERE chat=? AND pinned=1 ORDER BY id DESC LIMIT 5').bind(chat).all()).results;
      return json({ messages: msgs, polls: await Promise.all(polls.map(p => pollView(env, me, p))), pinned });
    }
    if (method === 'POST') {
      const text = String(body.body || '').trim().slice(0, MAX_TEXT);
      if (!text) return json({ error: 'Write a message first.' }, 400);
      const r = await env.DB.prepare('INSERT INTO chat_messages(chat,author_key,author_name,author_role,body,pinned,created_at) VALUES(?,?,?,?,?,?,?)')
        .bind(chat, me.key, me.name, me.role, text, staff(me) && body.pinned ? 1 : 0, now()).run();
      return json({ ok: true, id: r.meta.last_row_id });
    }
  }

  // Polls: anyone in a chat can post one there; only coaches post polls for everyone. Everyone can vote on those.
  if (root === 'polls' && a && b === 'vote' && method === 'POST') {
    const poll = await env.DB.prepare('SELECT * FROM polls WHERE id=?').bind(a).first();
    if (!poll || poll.closed) return json({ error: 'This poll is closed.' }, 400);
    if (poll.chat && !await canSee(env, me, poll.chat)) return json({ error: 'Not your poll.' }, 403);
    const n = JSON.parse(poll.options).length, picks = [...new Set((Array.isArray(body.choices) ? body.choices : []).map(Number).filter(i => Number.isInteger(i) && i >= 0 && i < n))].slice(0, poll.multi ? n : 1);
    await env.DB.batch([env.DB.prepare('DELETE FROM poll_votes WHERE poll_id=? AND voter=?').bind(a, me.key), ...picks.map(i => env.DB.prepare('INSERT INTO poll_votes(poll_id,voter,voter_name,choice) VALUES(?,?,?,?)').bind(a, me.key, me.name, i))]);
    return json(await pollView(env, me, poll));
  }
  if (root === 'polls' && !a && method === 'POST') {
    if (!staff(me) && body.chat == null) return json({ error: 'Only coaches can post a poll for everyone.' }, 403);
    const chat = body.chat == null ? null : String(body.chat);
    if (chat && !await canSee(env, me, chat)) return json({ error: 'Not your chat.' }, 403);
    const question = String(body.question || '').trim().slice(0, 300), options = (Array.isArray(body.options) ? body.options : []).map(o => String(o).trim().slice(0, 120)).filter(Boolean).slice(0, 10);
    if (!question || options.length < 2) return json({ error: 'A poll needs a question and at least two choices.' }, 400);
    const id = crypto.randomUUID(), st = [env.DB.prepare('INSERT INTO polls(id,chat,question,options,multi,created_by,created_at) VALUES(?,?,?,?,?,?,?)').bind(id, chat, question, JSON.stringify(options), body.multi ? 1 : 0, me.name, now())];
    if (chat) st.push(env.DB.prepare('INSERT INTO chat_messages(chat,author_key,author_name,author_role,body,pinned,poll_id,created_at) VALUES(?,?,?,?,?,0,?,?)').bind(chat, me.key, me.name, me.role, 'Poll: ' + question, id, now()));
    await env.DB.batch(st);
    return json({ ok: true, id });
  }
  if (root === 'polls' && a && b === 'close' && method === 'POST') {
    if (!staff(me)) return json({ error: 'Only coaches can close a poll.' }, 403);
    await env.DB.prepare('UPDATE polls SET closed=1 WHERE id=?').bind(a).run();
    return json({ ok: true });
  }
  return json({ error: 'Unknown chat route.' }, 404);
}

// POST chat-message/<id>/pin|unpin|delete
export async function handleChatMessage(path, method, request, env) {
  const [root, id, action] = path.split('/');
  if (root !== 'chat-message' || method !== 'POST') return null;
  const me = await who(request, env);
  if (!me) return json({ error: 'Please sign in.' }, 401);
  const m = await env.DB.prepare('SELECT id,chat,author_key FROM chat_messages WHERE id=?').bind(Number(id)).first();
  if (!m || !await canSee(env, me, m.chat)) return json({ error: 'Not found.' }, 404);
  if (action === 'delete' && (staff(me) || m.author_key === me.key)) await env.DB.prepare('DELETE FROM chat_messages WHERE id=?').bind(m.id).run();
  else if ((action === 'pin' || action === 'unpin') && staff(me)) await env.DB.prepare('UPDATE chat_messages SET pinned=? WHERE id=?').bind(action === 'pin' ? 1 : 0, m.id).run();
  else return json({ error: 'Not allowed.' }, 403);
  return json({ ok: true });
}
