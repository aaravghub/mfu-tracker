import { json, cleanEmail, isEmail, makePassword, passwordProblem, isBlocked, recordFail, clientKey } from './util.js';
import { mailConfigured, sendMessages, siteUrl, wrap } from './mail.js';
import { esc } from './util.js';

// Parent and coach sign-ups: anyone can apply from the sign-in page; the admin approves or declines.
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const all = async (env, sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results;
const one = (env, sql, ...b) => env.DB.prepare(sql).bind(...b).first();
const GENDERS = ['Male', 'Female'];
// Age in whole years from a YYYY-MM-DD birthday; NaN when the date is missing, invalid or in the future.
const ageFromDob = d => {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return NaN;
  const b = new Date(d + 'T00:00:00Z'), n = new Date(); if (isNaN(b) || b > n) return NaN;
  let a = n.getUTCFullYear() - b.getUTCFullYear(); if (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())) a--; return a;
};
const adminEmail = env => cleanEmail(env.ADMIN_EMAIL || 'automallakhamb@gmail.com');

async function mail(env, to, name, subject, lines, button) {
  if (!mailConfigured(env) || !isEmail(to)) return 0;
  const hi = name ? `Hi ${name.split(/\s+/)[0]},` : 'Hello,';
  const html = wrap(`<p style="margin:0 0 14px">${esc(hi)}</p>${lines.map(l => `<p style="margin:0 0 14px;line-height:1.55">${esc(l).replace(/\n/g, '<br>')}</p>`).join('')}${button ? `<p style="margin:18px 0 0"><a href="${esc(button[1])}" style="display:inline-block;background:#f26b21;color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:8px">${esc(button[0])}</a></p>` : ''}`);
  return (await sendMessages(env, [{ to, subject, html, text: `${hi}\n\n${lines.join('\n\n')}${button ? '\n\n' + button[1] : ''}\n\n— Mallakhamb Federation USA` }], { cc: false })).sent;
}

// Public: POST signup/parent, signup/coach
export async function handleSignup(path, method, request, env) {
  const kind = path.split('/')[1];
  if (method !== 'POST' || !['parent', 'coach'].includes(kind)) return json({ error: 'Unknown API route.' }, 404);
  const key = 'signup:' + clientKey(request);
  if (await isBlocked(env, key, 6, 3600)) return json({ error: 'Too many sign-ups from here. Please try again in an hour.' }, 429);
  const b = await request.json().catch(() => ({}));
  const name = str(b.name, 120), email = cleanEmail(b.email), phone = str(b.phone, 40);
  if (!name) return json({ error: 'Enter your name.' }, 400);
  if (!isEmail(email)) return json({ error: 'Enter a valid email address.' }, 400);
  if (!/\d{7,}/.test(phone.replace(/\D/g, ''))) return json({ error: 'Enter a phone number.' }, 400);
  const bad = passwordProblem(b.password, email); if (bad) return json({ error: bad }, 400);
  const row = { kind, name, email, phone, address: null, emergency_name: null, emergency_phone: null, age: null, dob: null, gender: null, children: '[]' };
  if (kind === 'parent') {
    row.address = str(b.address, 300); row.emergency_name = str(b.emergency_name, 120); row.emergency_phone = str(b.emergency_phone, 40);
    if (!row.address) return json({ error: 'Enter your address.' }, 400);
    if (!row.emergency_name || !/\d{7,}/.test(row.emergency_phone.replace(/\D/g, ''))) return json({ error: 'Enter an emergency contact name and phone number.' }, 400);
    const kids = (Array.isArray(b.children) ? b.children : []).map(k => ({ first_name: str(k?.first_name, 80), last_name: str(k?.last_name, 80), dob: str(k?.dob, 10), gender: GENDERS.includes(k?.gender) ? k.gender : '', age: ageFromDob(str(k?.dob, 10)) })).filter(k => k.first_name);
    if (!kids.length) return json({ error: 'Add at least one child.' }, 400);
    if (kids.length > 6) return json({ error: 'Add up to 6 children.' }, 400);
    if (kids.some(k => !k.last_name)) return json({ error: 'Enter each child\'s last name.' }, 400);
    if (kids.some(k => Number.isNaN(k.age) || k.age < 1 || k.age > 25)) return json({ error: 'Enter each child\'s date of birth.' }, 400);
    if (kids.some(k => !k.gender)) return json({ error: 'Choose male or female for each child.' }, 400);
    row.children = JSON.stringify(kids);
    if (await one(env, 'SELECT 1 x FROM parents WHERE email=? AND password_hash IS NOT NULL', email)) return json({ error: 'There is already a parent account with this email. Sign in, or use “Forgot password”.' }, 400);
  } else {
    row.dob = str(b.dob, 10); row.age = ageFromDob(row.dob); row.gender = GENDERS.includes(b.gender) ? b.gender : null;
    if (Number.isNaN(row.age)) return json({ error: 'Enter your date of birth.' }, 400);
    if (row.age < 14) return json({ error: 'Coaches must be 14 or older.' }, 400);
    if (!row.gender) return json({ error: 'Choose male or female.' }, 400);
    if (await one(env, 'SELECT 1 x FROM coaches WHERE lower(email)=? AND password_hash IS NOT NULL', email)) return json({ error: 'There is already a coach account with this email. Sign in, or use “Forgot password”.' }, 400);
  }
  if (await one(env, "SELECT 1 x FROM signups WHERE email=? AND kind=? AND status='pending'", email, kind)) return json({ error: 'You already signed up with this email. It is waiting for review.' }, 400);
  await recordFail(env, key, 3600);
  const { salt, hash } = await makePassword(b.password);
  const id = crypto.randomUUID();
  await env.DB.prepare('INSERT INTO signups(id,kind,name,email,phone,address,emergency_name,emergency_phone,age,dob,gender,children,password_hash,password_salt) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, kind, name, email, phone, row.address, row.emergency_name, row.emergency_phone, row.age, row.dob, row.gender, row.children, hash, salt).run();
  await mail(env, email, name, 'Your MFU account is under review', [`Thanks for signing up as ${kind === 'parent' ? 'a parent' : 'a coach'} with Mallakhamb Federation USA. Your account has been created and is now under review.`, 'We\'ll email you as soon as it is approved — then you can sign in with this email and the password you chose.']);
  await mail(env, adminEmail(env), 'Admin', `New ${kind} sign-up: ${name}`, [`${name} (${email}, ${phone}) signed up as ${kind === 'parent' ? 'a parent' : 'a coach'}.`, ...(kind === 'parent' ? ['Children: ' + JSON.parse(row.children).map(k => `${k.first_name} ${k.last_name} (${k.gender}, born ${k.dob}, age ${k.age})`).join(', ')] : [`${row.gender}, born ${row.dob} (age ${row.age})`]), 'Approve or decline it under Sign-ups in MFU Tracker.'], ['Review sign-ups', siteUrl(env, request)]);
  return json({ ok: true, message: 'Your account has been created and is under review. We\'ll email you when it\'s approved.' }, 201);
}

// Admin: GET signups, POST signups/:id/approve, POST signups/:id/decline
export async function handleSignupReview(path, method, request, env, actor) {
  const [, id, action] = path.split('/');
  if (method === 'GET' && !id) {
    const rows = await all(env, "SELECT id,kind,name,email,phone,address,emergency_name,emergency_phone,age,dob,gender,children,status,reviewed_by,reviewed_at,note,created_at FROM signups ORDER BY (status='pending') DESC,created_at DESC LIMIT 300");
    return json(rows.map(r => ({ ...r, children: JSON.parse(r.children || '[]') })));
  }
  const s = id ? await one(env, 'SELECT * FROM signups WHERE id=?', id) : null;
  if (!s) return json({ error: 'Sign-up not found.' }, 404);
  if (s.status !== 'pending') return json({ error: 'This sign-up was already ' + s.status + '.' }, 400);
  const body = await request.json().catch(() => ({}));
  const by = actor.name || 'Admin', url = siteUrl(env, request);

  if (method === 'POST' && action === 'decline') {
    await env.DB.prepare("UPDATE signups SET status='declined',reviewed_by=?,reviewed_at=datetime('now'),note=? WHERE id=?").bind(by, str(body.reason, 500), id).run();
    const emailed = await mail(env, s.email, s.name, 'About your MFU sign-up', ['We weren\'t able to approve your MFU Tracker account.', ...(body.reason ? ['Note from MFU: ' + str(body.reason, 500)] : []), 'If you think this is a mistake, please reply to this email or contact your coach.']);
    return json({ ok: true, emailed: emailed > 0 });
  }

  if (method === 'POST' && action === 'approve') {
    const st = [];
    if (s.kind === 'coach') {
      // Use the coach record that already has this email, or create one.
      const existing = await one(env, 'SELECT id FROM coaches WHERE lower(email)=? ORDER BY rowid LIMIT 1', s.email);
      const cid = existing?.id || crypto.randomUUID();
      if (existing) st.push(env.DB.prepare('UPDATE coaches SET name=COALESCE(NULLIF(name,\'\'),?),phone=COALESCE(phone,?),age=?,dob=COALESCE(dob,?),gender=COALESCE(gender,?),password_hash=?,password_salt=?,active=1 WHERE id=?').bind(s.name, s.phone, s.age, s.dob, s.gender, s.password_hash, s.password_salt, cid));
      else st.push(env.DB.prepare('INSERT INTO coaches(id,name,email,phone,center_id,age,dob,gender,password_hash,password_salt,active) VALUES(?,?,?,?,?,?,?,?,?,?,1)').bind(cid, s.name, s.email, s.phone, body.center_id || null, s.age, s.dob, s.gender, s.password_hash, s.password_salt));
      if (body.center_id) st.push(env.DB.prepare('INSERT OR IGNORE INTO coach_centers(coach_id,center_id) VALUES(?,?)').bind(cid, body.center_id));
    } else {
      // Each child is either linked to a student who is already in the system, or created as a new student.
      const kids = JSON.parse(s.children || '[]'), picks = Array.isArray(body.children) ? body.children : [];
      const existing = await one(env, 'SELECT id FROM parents WHERE email=?', s.email);
      const pid = existing?.id || crypto.randomUUID();
      if (existing) st.push(env.DB.prepare('UPDATE parents SET name=?,phone=?,address=?,emergency_name=?,emergency_phone=?,password_hash=?,password_salt=?,active=1 WHERE id=?').bind(s.name, s.phone, s.address, s.emergency_name, s.emergency_phone, s.password_hash, s.password_salt, pid));
      else st.push(env.DB.prepare('INSERT INTO parents(id,email,name,phone,address,emergency_name,emergency_phone,password_hash,password_salt) VALUES(?,?,?,?,?,?,?,?,?)').bind(pid, s.email, s.name, s.phone, s.address, s.emergency_name, s.emergency_phone, s.password_hash, s.password_salt));
      const centers = new Set((await all(env, 'SELECT id FROM centers')).map(c => c.id));
      for (let i = 0; i < kids.length; i++) {
        const k = kids[i], pick = picks.find(p => p.index === i) || {};
        if (pick.skip) continue;
        let sid = pick.student_id;
        if (sid) {
          if (!(await one(env, 'SELECT 1 x FROM students WHERE id=?', sid))) return json({ error: `The student picked for ${k.first_name} no longer exists.` }, 400);
          // Fill in the parent's details on the student only where they are missing.
          st.push(env.DB.prepare('UPDATE students SET parent_name=COALESCE(NULLIF(parent_name,\'\'),?),parent_email=COALESCE(NULLIF(parent_email,\'\'),?),parent_phone=COALESCE(NULLIF(parent_phone,\'\'),?),age=COALESCE(age,?),dob=COALESCE(dob,?),gender=COALESCE(gender,?) WHERE id=?').bind(s.name, s.email, s.phone, k.age, k.dob || null, k.gender || null, sid));
        } else {
          if (!centers.has(pick.center_id)) return json({ error: `Choose a center for ${k.first_name} ${k.last_name}, or link them to a student who is already here.` }, 400);
          sid = crypto.randomUUID();
          st.push(env.DB.prepare('INSERT INTO students(id,first_name,last_name,center_id,parent_name,parent_email,parent_phone,age,dob,gender) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(sid, k.first_name, k.last_name, pick.center_id, s.name, s.email, s.phone, k.age, k.dob || null, k.gender || null));
        }
        st.push(env.DB.prepare('INSERT OR IGNORE INTO parent_students(parent_id,student_id) VALUES(?,?)').bind(pid, sid));
      }
    }
    st.push(env.DB.prepare("UPDATE signups SET status='approved',reviewed_by=?,reviewed_at=datetime('now') WHERE id=?").bind(by, id));
    await env.DB.batch(st);
    const emailed = await mail(env, s.email, s.name, 'Your MFU account is approved', [`Good news — your MFU Tracker ${s.kind} account has been approved.`, `Sign in on the ${s.kind === 'parent' ? 'Parent' : 'Coach'} tab with ${s.email} and the password you chose when you signed up.`], ['Sign in', url]);
    return json({ ok: true, emailed: emailed > 0 });
  }
  return json({ error: 'Method not allowed.' }, 405);
}
