/* MFU Tracker — roles, parent portal, links/shop, parent accounts, email, improved overview.
   Loaded after app.js and shares its globals ($, $$, api, esc, toast, state, configs, show, formModal, table, welcome). */
'use strict';
window.PAGES = {};
state.role = null;

/* ---------- small helpers ---------- */
const safeUrl = u => (/^https?:\/\//i.test(String(u || '')) ? u : '#');
const link = (u, label, cls = 'btn blue small') => `<a class="${cls}" href="${esc(safeUrl(u))}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const dateObj = s => new Date(String(s) + 'T00:00:00');
const daysUntil = s => Math.round((dateObj(s) - dateObj(todayStr())) / 864e5);
const fmtShort = s => dateObj(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const fmtLong = s => dateObj(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const fmtTime = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); if (!m) return ''; const h = +m[1]; return ((h + 11) % 12 + 1) + ':' + m[2] + ' ' + (h >= 12 ? 'PM' : 'AM'); };
const fmtStamp = s => { if (!s) return '—'; const d = new Date(String(s).replace(' ', 'T') + 'Z'); return isNaN(d) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
const countdown = s => { const n = daysUntil(s); return n < 0 ? 'Past' : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : 'In ' + n + ' days'; };
const centerName = (centers, id) => centers.find(c => c.id === id)?.name || id || 'All centers';
const typeLabel = t => ({ competition: 'Competition', evaluation: 'Evaluation', demo: 'Demo', meeting: 'Meeting', other: 'Event' }[t] || t);
const nameOf = s => s.first_name + ' ' + s.last_name;
const copyText = async t => { try { await navigator.clipboard.writeText(t); toast('Copied to clipboard'); } catch { prompt('Copy this link:', t); } };

function openModal(title, body, { wide = false } = {}) {
  const root = document.createElement('div');
  root.className = 'modal-bg';
  root.innerHTML = `<div class="card modal${wide ? ' wide-modal' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></div><div class="modal-body">${body}</div></div>`;
  const close = () => { root.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  root.onclick = e => { if (e.target === root || e.target.closest('[data-close]')) close(); };
  document.body.append(root);
  root.querySelector('input,select,textarea')?.focus();
  return { root, close, $: s => root.querySelector(s), $$: s => [...root.querySelectorAll(s)] };
}
const hero = (title, sub, actions = '') => `<div class="welcome"><div><h2>${title}</h2><p>${sub}</p></div><div class="welcome-actions">${actions}</div></div>`;
const empty = (icon, title, sub) => `<div class="empty-state"><div class="empty-icon">${icon}</div><b>${esc(title)}</b><p>${esc(sub)}</p></div>`;

/* ---------- navigation & roles ---------- */
const NAV = {
  admin: [
    ['Manage', [['overview', 'Overview'], ['students', 'Students'], ['batches', 'Batches'], ['coaches', 'Coaches'], ['attendance', 'Attendance'], ['skills', 'Skill library'], ['routines', 'Routines']]],
    ['Families', [['parents', 'Parents'], ['events', 'Competitions & evaluations'], ['links', 'Links & forms'], ['shop', 'Shop'], ['email', 'Email parents']]],
    ['Tools', [['timers', 'Timers']]]
  ],
  parent: [['', [['home', 'My children'], ['p_events', 'Events'], ['p_links', 'Forms & links'], ['p_shop', 'Shop'], ['account', 'Account']]]]
};
Object.assign(titles, { parents: 'Parents', links: 'Links & forms', shop: 'Shop', email: 'Email parents', home: 'My children', p_events: 'Upcoming events', p_links: 'Forms & links', p_shop: 'Shop', account: 'Account' });

function setRole(role, me = {}) {
  state.role = role;
  $('#nav').innerHTML = NAV[role].map(([label, items]) => (label ? `<span class="nav-label">${label}</span>` : '') + items.map(([p, t]) => `<button data-page="${p}">${t}</button>`).join('')).join('');
  $('#logout').classList.remove('hidden');
  $('#role-pill').textContent = role === 'admin' ? '● Admin' : role === 'coach' ? '● Coach · ' + (me.name || me.email || '') : '● ' + (me.name || me.email || 'Parent');
  state.me = me;
  document.body.dataset.role = role;
}
function clearRole() {
  state.role = null; delete document.body.dataset.role;
  $('#nav').innerHTML = ''; $('#logout').classList.add('hidden'); $('#role-pill').textContent = '● Signed out';
  document.body.classList.remove('nav-open');
}
$('#menu-toggle').onclick = () => { const o = document.body.classList.toggle('nav-open'); $('#menu-toggle').setAttribute('aria-expanded', String(o)); };
$('#nav').addEventListener('click', () => { document.body.classList.remove('nav-open'); $('#menu-toggle').setAttribute('aria-expanded', 'false'); });
fetch('/mfu-common-minimum-program.pdf', { method: 'HEAD' }).then(r => { if (!r.ok || (r.headers.get('content-type') || '').includes('text/html')) document.querySelector('.pdf')?.remove(); }).catch(() => document.querySelector('.pdf')?.remove());

// Send people back to sign-in if their session expires mid-use.
const _api = api;
api = async function (p, o) {
  try { return await _api(p, o); }
  catch (e) { if (state.role && /please sign in/i.test(e.message)) { clearRole(); loginView(); toast('Your session expired — please sign in again.'); } throw e; }
};

/* ---------- sign in / set password ---------- */
function authCard(inner) {
  $('#title').textContent = 'Welcome';
  $('#content').innerHTML = window.mfuStage ? mfuStage(inner) : `<div class="login card"><img class="login-logo" src="/mfu-logo.png" alt="Mallakhamb Federation USA logo">${inner}</div>`;
}
function loginView(mode = 'parent') {
  clearRole();
  authCard(`<h2>Welcome to MFU Tracker</h2>
  <div class="seg" role="tablist"><button type="button" data-mode="parent" class="${mode === 'parent' ? 'active' : ''}">Parent</button><button type="button" data-mode="coach" class="${mode === 'coach' ? 'active' : ''}">Coach</button><button type="button" data-mode="admin" class="${mode === 'admin' ? 'active' : ''}">Admin</button></div>
  ${mode !== 'admin'
    ? `<p>${mode === 'coach' ? 'Sign in to take attendance, run evaluations and follow your students.' : 'Sign in to follow your child\'s progress, see upcoming events and find forms.'}</p>
       <form id="login"><label>Email<input type="email" id="email" autocomplete="username" required></label><label>Password<input type="password" id="password" autocomplete="current-password" required></label><button class="primary">Sign in</button><p id="login-error" class="error" role="alert"></p><p class="center"><a href="#" id="forgot">Forgot password or first time here?</a></p></form>`
    : `<p>Sign in to manage centers, students, classes, skills and families.</p>
       <form id="login"><label>Admin password<input type="password" id="password" autocomplete="current-password" required></label><button class="primary">Sign in</button><p id="login-error" class="error" role="alert"></p></form>`}`);
  $$('.seg button').forEach(b => b.onclick = () => loginView(b.dataset.mode));
  $('#forgot') && ($('#forgot').onclick = e => { e.preventDefault(); forgotView(mode); });
  $('#login').onsubmit = async e => {
    e.preventDefault(); $('#login-error').textContent = '';
    const btn = e.target.querySelector('button.primary'); btn.disabled = true;
    try {
      if (mode !== 'admin') await api(mode + '/login', { method: 'POST', body: JSON.stringify({ email: $('#email').value, password: $('#password').value }) });
      else await api('login', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) });
      await enter();
    } catch (err) { $('#login-error').textContent = err.message; btn.disabled = false; }
  };
}
function forgotView(mode = 'parent') {
  authCard(`<h2>Set or reset your password</h2><p>Enter the email address MFU has on file for you and we'll send a link to choose a password.</p>
  <form id="forgot-form"><label>Email<input type="email" id="email" autocomplete="username" required></label><button class="primary">Email me a link</button><p id="login-error" class="error" role="alert"></p><p class="center"><a href="#" id="back">Back to sign in</a></p></form>`);
  $('#back').onclick = e => { e.preventDefault(); loginView(mode); };
  $('#forgot-form').onsubmit = async e => {
    e.preventDefault();
    try { const r = await api((mode === 'coach' ? 'coach' : 'parent') + '/forgot', { method: 'POST', body: JSON.stringify({ email: $('#email').value }) }); $('#login-error').className = 'muted'; $('#login-error').textContent = r.message; }
    catch (err) { $('#login-error').textContent = err.message; }
  };
}
function setupView(token, who = 'parent') {
  authCard(`<h2>Choose your password</h2><p>Pick a password with at least 8 characters. You'll use it with your email address to sign in.</p>
  <form id="setup-form"><label>New password<input type="password" id="pw1" autocomplete="new-password" minlength="8" required></label><label>Confirm password<input type="password" id="pw2" autocomplete="new-password" minlength="8" required></label><button class="primary">Save and continue</button><p id="login-error" class="error" role="alert"></p></form>`);
  $('#setup-form').onsubmit = async e => {
    e.preventDefault();
    if ($('#pw1').value !== $('#pw2').value) { $('#login-error').textContent = 'Passwords do not match.'; return; }
    try { await api(who + '/set-password', { method: 'POST', body: JSON.stringify({ token, password: $('#pw1').value }) }); history.replaceState(null, '', location.pathname); await enter(); }
    catch (err) { $('#login-error').textContent = err.message; }
  };
}
const startPage = role => ({ parent: 'home', coach: 'coach_home' }[role] || 'overview');
async function enter() {
  const me = await api('me');
  if (!me.authenticated) return loginView();
  setRole(me.role, me);
  show(startPage(me.role));
}
async function checkAuth() {
  const m = /^#(coach-)?setup=([a-f0-9]{64})$/.exec(location.hash);
  if (m) return setupView(m[2], m[1] ? 'coach' : 'parent');
  loginView('parent');
  try { const me = await api('me'); if (me.authenticated) { setRole(me.role, me); show(startPage(me.role)); } } catch { /* stay on sign-in */ }
}
$('#logout').onclick = async () => { try { await api('logout', { method: 'POST' }); } catch {} loginView(); };

/* ---------- configs for new/changed records ---------- */
configs.events = { label: 'Competitions & evaluations', singular: 'Event', fields: [
  ['title', 'Event name', 'text', true], ['event_type', 'Type', 'eventtype', true], ['event_date', 'Date', 'date', true], ['event_time', 'Start time', 'time'],
  ['location', 'Location / address', 'text'], ['center_id', 'Center (blank = all centers)', 'center'], ['signup_url', 'Sign-up link (competitions)', 'url'], ['details', 'Details for parents', 'textarea']] };
configs.links = { label: 'Links & forms', singular: 'Link', fields: [
  ['title', 'Title', 'text', true], ['url', 'Link', 'url', true], ['category', 'Category', 'select:Forms,Waivers,Registration,Resources,Other'], ['description', 'Short description', 'textarea']] };
configs.shop_items = { label: 'Shop', singular: 'Item', fields: [
  ['title', 'Item name', 'text', true], ['url', 'Where to buy (link)', 'url', true], ['category', 'Category', 'select:Gear,Clothing,Equipment,Other'], ['price', 'Approx. price (optional)', 'text'], ['description', 'Notes (size, color, required?)', 'textarea']] };

/* ---------- ADMIN: overview ---------- */
PAGES.overview = async () => {
  const [students, batches, coaches, events, parents, mail] = await Promise.all(['students', 'batches', 'coaches', 'events', 'parents', 'email/status'].map(x => api(x)));
  const upcoming = events.filter(e => e.event_date >= todayStr()).sort((a, b) => a.event_date.localeCompare(b.event_date));
  const noEmail = students.filter(s => (s.active ?? 1) && !(s.parent_email || '').trim()).length;
  const pending = parents.filter(p => !p.has_password).length;
  const todo = [];
  if (!mail.configured) todo.push(['Email sending isn\'t set up yet', 'Add two settings in Cloudflare to email parents.', 'email']);
  if (noEmail) todo.push([noEmail + ' student' + (noEmail > 1 ? 's' : '') + ' without a parent email', 'Add emails so parents can get updates.', 'students']);
  if (pending) todo.push([pending + ' parent' + (pending > 1 ? 's' : '') + ' haven\'t set a password', 'Send invites so they can sign in.', 'parents']);
  if (!upcoming.length) todo.push(['No upcoming events', 'Add the next evaluation or competition so parents can see it.', 'events']);
  $('#content').innerHTML = hero('Welcome back', 'Everything across all MFU centers at a glance.',
    '<button class="btn" data-go="email">✉ Email parents</button><button class="btn secondary" data-go="events">+ Add event</button>') +
    `<div class="stats">${[['Students', students.length], ['Parent accounts', parents.length], ['Batches', batches.length], ['Upcoming events', upcoming.length]].map(x => `<div class="stat"><span>${x[0]}</span><strong>${x[1]}</strong></div>`).join('')}</div>
    <div class="two-col"><div class="card"><h3>Next up</h3>${upcoming.length ? upcoming.slice(0, 4).map(e => `<div class="mini-event"><div class="date-chip"><b>${dateObj(e.event_date).getDate()}</b><span>${dateObj(e.event_date).toLocaleDateString('en-US', { month: 'short' })}</span></div><div><b>${esc(e.title)}</b><small>${typeLabel(e.event_type)} · ${esc(fmtTime(e.event_time) || fmtShort(e.event_date))}</small></div><span class="chip ${daysUntil(e.event_date) <= 7 ? 'warn' : ''}">${countdown(e.event_date)}</span></div>`).join('') : empty('📅', 'Nothing scheduled', 'Add an evaluation or competition.')}</div>
    <div class="card"><h3>To do</h3>${todo.length ? todo.map(t => `<button class="todo" data-go="${t[2]}"><b>${esc(t[0])}</b><small>${esc(t[1])}</small><span>→</span></button>`).join('') : empty('✅', 'All caught up', 'Nothing needs your attention.')}</div></div>`;
  $$('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go));
};

/* ---------- ADMIN: students (with skill progress) ---------- */
PAGES.students = async () => {
  const [students, centers, parents] = await Promise.all([api('students'), api('centers'), api('parents')]);
  const withAccount = new Set(parents.filter(p => p.active !== 0).flatMap(p => p.students.map(s => s.id)));
  $('#content').innerHTML = hero('Students', 'Profiles, levels and skill progress.', '<button class="btn secondary" id="import-students">Import CSV</button><button class="btn" id="add">+ Add student</button>') +
    '<div class="toolbar"><input id="filter" placeholder="Search students or parents..."><select id="cfilter" style="max-width:200px"><option value="">All centers</option>' + centers.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('') + '</select></div><div id="rows"></div>';
  const draw = () => {
    const q = $('#filter').value.toLowerCase(), c = $('#cfilter').value;
    const rows = students.filter(s => (!c || s.center_id === c) && [nameOf(s), s.parent_name, s.parent_email].join(' ').toLowerCase().includes(q));
    $('#rows').innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Student</th><th>Center</th><th>Pole</th><th>Rope</th><th>Yoga</th><th>Parent</th><th>Portal</th><th>Actions</th></tr></thead><tbody>${rows.map(s => `<tr><td><b>${esc(nameOf(s))}</b></td><td>${esc(centerName(centers, s.center_id))}</td><td>${s.pole_level}</td><td>${s.rope_level}</td><td>${s.yoga_level}</td><td>${s.parent_email ? esc(s.parent_name || '') + '<br><small class="muted">' + esc(s.parent_email) + '</small>' : '<span class="chip warn">No email</span>'}</td><td>${withAccount.has(s.id) ? '<span class="chip ok">Account</span>' : '<span class="chip">—</span>'}</td><td class="actions"><button class="btn secondary small" data-progress="${esc(s.id)}">Progress</button><button class="btn secondary small" data-profile="${esc(s.id)}">Notes & fitness</button><button class="btn secondary small" data-att="${esc(s.id)}">Attendance</button><button class="btn secondary small" data-edit="${esc(s.id)}">Edit</button><button class="btn secondary small" data-delete="${esc(s.id)}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : empty('🧒', 'No students found', 'Add a student or change your search.');
    $$('[data-edit]').forEach(b => b.onclick = () => formModal(configs.students, students.find(x => x.id === b.dataset.edit), 'students'));
    $$('[data-progress]').forEach(b => b.onclick = () => progressModal(students.find(x => x.id === b.dataset.progress)));
    $$('[data-att]').forEach(b => b.onclick = () => studentAttendanceModal(students.find(x => x.id === b.dataset.att)));
    $$('[data-profile]').forEach(b => b.onclick = () => window.studentProfileModal?.(students.find(x => x.id === b.dataset.profile)));
    $$('[data-delete]').forEach(b => b.onclick = async () => { if (confirm('Delete this student and their records?')) { try { await api('students/' + b.dataset.delete, { method: 'DELETE' }); toast('Deleted'); show('students'); } catch (e) { toast(e.message); } } });
  };
  $('#filter').oninput = draw; $('#cfilter').onchange = draw; draw();
  $('#add').onclick = () => formModal(configs.students, null, 'students');
  $('#import-students').onclick = () => studentCsvImport();
};

async function progressModal(student) {
  const [skills, prog] = await Promise.all([api('skills'), api('student-progress?student_id=' + encodeURIComponent(student.id))]);
  const base = new Map(prog.map(p => [p.skill_id, { status: p.status, started_date: p.started_date || '', mastered_date: p.mastered_date || '' }])), changes = new Map();
  const today = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  let app = 'pole';
  const m = openModal('Skill progress · ' + nameOf(student), '<p class="muted">Set a skill to Learning when they start working on it and Mastered when they get it. The dates fill in as today, and you can change them to when it really happened.</p><div class="seg" id="ptabs"></div><div id="plist"></div><div class="modal-actions"><span class="muted" id="pcount"></span><button class="btn secondary" data-close>Cancel</button><button class="btn" id="psave">Save progress</button></div>', { wide: true });
  const cur = k => changes.get(k) ?? base.get(k) ?? { status: 'not_started', started_date: '', mastered_date: '' };
  const count = () => { m.$('#pcount').textContent = changes.size ? changes.size + ' unsaved change' + (changes.size > 1 ? 's' : '') : ''; };
  const set = (id, patch) => { const next = { ...cur(id), ...patch }; if (next.status === 'not_started') { next.started_date = ''; next.mastered_date = ''; } if (next.status === 'learning') next.mastered_date = ''; changes.set(id, next); };
  const setStatus = (id, status) => { const was = cur(id); const patch = { status }; if (status !== 'not_started' && !was.started_date) patch.started_date = today; if (status === 'mastered' && !was.mastered_date) patch.mastered_date = today; set(id, patch); };
  const datesHtml = (id, c) => `<span class="skill-dates" data-dates="${esc(id)}" ${c.status === 'not_started' ? 'hidden' : ''}><label>Started<input type="date" data-start="${esc(id)}" value="${esc(c.started_date)}" max="${today}"></label><label data-donewrap ${c.status === 'mastered' ? '' : 'hidden'}>Mastered<input type="date" data-done="${esc(id)}" value="${esc(c.mastered_date)}" max="${today}"></label></span>`;
  const draw = () => {
    m.$('#ptabs').innerHTML = ['pole', 'rope', 'yoga'].map(a => `<button type="button" data-a="${a}" class="${a === app ? 'active' : ''}">${a[0].toUpperCase() + a.slice(1)} <small>(level ${student[a + '_level']})</small></button>`).join('');
    const list = skills.filter(s => s.apparatus === app);
    m.$('#plist').innerHTML = list.length ? [1, 2, 3, 4, 5].map(l => { const ls = list.filter(s => s.level === l); if (!ls.length) return ''; const done = ls.filter(s => cur(s.id).status === 'mastered').length;
      return `<div class="lvl"><div class="lvl-head"><b>Level ${l}</b><span class="muted">${done}/${ls.length} mastered</span><button type="button" class="btn secondary small" data-all="${l}">Mark all mastered today</button></div>${ls.map(s => { const c = cur(s.id); return `<div class="skill-row"><span class="skill-name">${esc(s.name)}</span><span class="skill-ctl"><select data-skill="${esc(s.id)}"><option value="not_started" ${c.status === 'not_started' ? 'selected' : ''}>Not started</option><option value="learning" ${c.status === 'learning' ? 'selected' : ''}>Learning</option><option value="mastered" ${c.status === 'mastered' ? 'selected' : ''}>Mastered</option></select>${datesHtml(s.id, c)}</span></div>`; }).join('')}</div>`; }).join('') : empty('📚', 'No skills yet', 'Import the skill list from the Skill library page first.');
    count();
    m.$$('[data-a]').forEach(b => b.onclick = () => { app = b.dataset.a; draw(); });
    m.$$('[data-skill]').forEach(sel => sel.onchange = () => {
      const id = sel.dataset.skill; setStatus(id, sel.value); const c = cur(id), row = sel.closest('.skill-row');
      row.querySelector('[data-dates]').hidden = c.status === 'not_started'; row.querySelector('[data-donewrap]').hidden = c.status !== 'mastered';
      row.querySelector('[data-start]').value = c.started_date; row.querySelector('[data-done]').value = c.mastered_date; count();
    });
    m.$$('[data-start]').forEach(i => i.onchange = () => { set(i.dataset.start, { started_date: i.value }); count(); });
    m.$$('[data-done]').forEach(i => i.onchange = () => { set(i.dataset.done, { mastered_date: i.value }); count(); });
    m.$$('[data-all]').forEach(b => b.onclick = () => { list.filter(s => s.level === +b.dataset.all).forEach(s => { if (cur(s.id).status !== 'mastered') setStatus(s.id, 'mastered'); }); draw(); });
  };
  draw();
  m.$('#psave').onclick = async () => {
    if (!changes.size) return m.close();
    for (const [id, c] of changes) if (c.status === 'mastered' && c.started_date && c.mastered_date && c.mastered_date < c.started_date) return toast('A mastered date can’t be before its started date (' + (skills.find(s => s.id === id)?.name || '') + ').');
    try { await api('student-progress', { method: 'POST', body: JSON.stringify({ student_id: student.id, changes: [...changes].map(([skill_id, c]) => ({ skill_id, status: c.status, started_date: c.started_date || null, mastered_date: c.mastered_date || null })) }) }); toast('Progress saved'); m.close(); } catch (e) { toast(e.message); }
  };
}

/* ---------- ADMIN: events ---------- */
PAGES.events = async () => {
  const [events, centers] = await Promise.all([api('events'), api('centers')]);
  const up = events.filter(e => e.event_date >= todayStr()).sort((a, b) => a.event_date.localeCompare(b.event_date));
  const past = events.filter(e => e.event_date < todayStr()).sort((a, b) => b.event_date.localeCompare(a.event_date));
  const card = (e, isPast) => `<article class="event-card ${isPast ? 'past' : ''}"><div class="date-chip big"><b>${dateObj(e.event_date).getDate()}</b><span>${dateObj(e.event_date).toLocaleDateString('en-US', { month: 'short' })}</span></div>
    <div class="event-main"><div class="chips"><span class="chip type-${esc(e.event_type)}">${typeLabel(e.event_type)}</span><span class="chip">${esc(centerName(centers, e.center_id))}</span>${isPast ? '' : `<span class="chip ${daysUntil(e.event_date) <= 7 ? 'warn' : ''}">${countdown(e.event_date)}</span>`}</div>
    <h3>${esc(e.title)}</h3><p class="muted">${esc(fmtLong(e.event_date))}${e.event_time ? ' · ' + esc(fmtTime(e.event_time)) : ''}${e.location ? '<br>📍 ' + esc(e.location) : ''}</p>${e.details ? `<p class="event-details">${esc(e.details)}</p>` : ''}
    <div class="card-actions">${e.signup_url ? link(e.signup_url, 'Sign-up link ↗') : (e.event_type === 'competition' && !isPast ? '<span class="chip warn">No sign-up link yet</span>' : '')}${isPast ? '' : `<button class="btn small" data-mail="${esc(e.id)}">✉ Email parents</button>`}<button class="btn secondary small" data-edit="${esc(e.id)}">Edit</button><button class="btn secondary small" data-delete="${esc(e.id)}">Delete</button></div></div></article>`;
  $('#content').innerHTML = hero('Competitions & evaluations', 'Parents see these in their portal. Add a sign-up link for competitions.', '<button class="btn" id="add">+ Add event</button>') +
    (up.length ? up.map(e => card(e)).join('') : `<div class="card">${empty('📅', 'No upcoming events', 'Add the next evaluation or competition.')}</div>`) +
    (past.length ? `<details class="section-gap"><summary class="muted">Past events (${past.length})</summary><div class="section-gap">${past.map(e => card(e, true)).join('')}</div></details>` : '');
  $('#add').onclick = () => formModal(configs.events, null, 'events');
  $$('[data-edit]').forEach(b => b.onclick = () => formModal(configs.events, events.find(x => x.id === b.dataset.edit), 'events'));
  $$('[data-delete]').forEach(b => b.onclick = async () => { if (confirm('Delete this event?')) { try { await api('events/' + b.dataset.delete, { method: 'DELETE' }); toast('Deleted'); show('events'); } catch (e) { toast(e.message); } } });
  $$('[data-mail]').forEach(b => b.onclick = () => { state.emailPreset = { event_ids: [b.dataset.mail] }; show('email'); });
};

/* ---------- ADMIN: links & shop ---------- */
function board(page, cfg, items, { shop = false } = {}) {
  const groups = [...new Set(items.map(i => i.category || 'Other'))].sort();
  return hero(titles[page], shop ? 'Gear and items parents need to buy. Add links to where to get them.' : 'Forms, waivers, sign-ups and other links parents need.', `<button class="btn" id="add">+ Add ${cfg.singular.toLowerCase()}</button>`) +
    (items.length ? groups.map(g => `<h3 class="group-title">${esc(g)}</h3><div class="link-grid">${items.filter(i => (i.category || 'Other') === g).map(i => `<div class="link-card"><div><b>${esc(i.title)}</b>${i.price ? `<span class="chip">${esc(i.price)}</span>` : ''}</div>${i.description ? `<p class="muted">${esc(i.description)}</p>` : ''}<small class="url">${esc(i.url)}</small><div class="card-actions">${link(i.url, shop ? 'View item ↗' : 'Open ↗')}<button class="btn small" data-mail="${esc(i.id)}">✉ Email</button><button class="btn secondary small" data-edit="${esc(i.id)}">Edit</button><button class="btn secondary small" data-delete="${esc(i.id)}">Delete</button></div></div>`).join('')}</div>`).join('') : `<div class="card">${empty(shop ? '🛍️' : '🔗', 'Nothing here yet', shop ? 'Add the first item parents should buy.' : 'Add the liability form, registration links and more.')}</div>`);
}
function wireBoard(page, cfg, items, mailKey) {
  $('#add').onclick = () => formModal(cfg, null, page);
  $$('[data-edit]').forEach(b => b.onclick = () => formModal(cfg, items.find(x => x.id === b.dataset.edit), page));
  $$('[data-delete]').forEach(b => b.onclick = async () => { if (confirm('Delete this?')) { try { await api(page + '/' + b.dataset.delete, { method: 'DELETE' }); toast('Deleted'); show(page); } catch (e) { toast(e.message); } } });
  $$('[data-mail]').forEach(b => b.onclick = () => { state.emailPreset = { [mailKey]: [b.dataset.mail] }; show('email'); });
}
PAGES.links = async () => { const items = await api('links'); $('#content').innerHTML = board('links', configs.links, items); wireBoard('links', configs.links, items, 'link_ids'); };
PAGES.shop = async () => { const items = await api('shop_items'); $('#content').innerHTML = board('shop', configs.shop_items, items, { shop: true }); wireBoard('shop_items', configs.shop_items, items, 'shop_ids'); };
// formModal calls show(page) after saving; map the table name back to its page.
PAGES.shop_items = PAGES.shop;

/* ---------- ADMIN: parent accounts ---------- */
function linkModal(title, rows) {
  const m = openModal(title, `<p class="muted">Email isn't set up yet, so copy each link and send it to the parent yourself. Each link works for 7 days.</p><div class="link-list">${rows.map((r, i) => `<div class="link-row"><div><b>${esc(r.name || r.email)}</b><small class="muted">${esc(r.email)}</small></div><button class="btn small" data-copy="${i}">Copy link</button></div>`).join('')}</div><div class="modal-actions"><button class="btn secondary" data-close>Done</button></div>`);
  m.$$('[data-copy]').forEach(b => b.onclick = () => copyText(rows[+b.dataset.copy].link));
}
PAGES.parents = async () => {
  const [parents, students, mail] = await Promise.all([api('parents'), api('students'), api('email/status')]);
  const pendingCount = parents.filter(p => !p.has_password && p.active !== 0).length;
  $('#content').innerHTML = hero('Parents', 'Parent accounts see only their own children.', '<button class="btn secondary" id="sync">Create accounts from student emails</button><button class="btn" id="add">+ Add parent</button>') +
    (pendingCount ? `<div class="notice"><div><b>${pendingCount} parent${pendingCount > 1 ? 's haven\'t' : ' hasn\'t'} set a password yet.</b><br><small>${mail.configured ? 'Send everyone an invitation email in one click.' : 'Email isn\'t configured, so you\'ll get links to share manually.'}</small></div><button class="btn" id="invite-all">Invite ${pendingCount} pending</button></div>` : '') +
    (parents.length ? `<div class="table-wrap"><table><thead><tr><th>Parent</th><th>Children</th><th>Status</th><th>Last sign-in</th><th>Actions</th></tr></thead><tbody>${parents.map(p => `<tr><td><b>${esc(p.name || '—')}</b><br><small class="muted">${esc(p.email)}</small></td><td>${p.students.length ? p.students.map(s => `<span class="chip">${esc(s.name)}</span>`).join(' ') : '<span class="chip warn">No children linked</span>'}</td><td>${p.active === 0 ? '<span class="chip">Disabled</span>' : p.has_password ? '<span class="chip ok">Active</span>' : '<span class="chip warn">Invite pending</span>'}</td><td>${fmtStamp(p.last_login)}</td><td class="actions"><button class="btn secondary small" data-invite="${esc(p.id)}">${p.has_password ? 'Reset link' : 'Send invite'}</button><button class="btn secondary small" data-edit="${esc(p.id)}">Edit</button><button class="btn secondary small" data-delete="${esc(p.id)}">Delete</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="card">${empty('👪', 'No parent accounts yet', 'Click “Create accounts from student emails” to make one for every parent email already on your student records.')}</div>`);

  $('#add').onclick = () => parentForm(null, students);
  $$('[data-edit]').forEach(b => b.onclick = () => parentForm(parents.find(x => x.id === b.dataset.edit), students));
  $$('[data-delete]').forEach(b => b.onclick = async () => { if (confirm('Delete this parent account? Their children are not affected.')) { await api('parents/' + b.dataset.delete, { method: 'DELETE' }); toast('Deleted'); show('parents'); } });
  $$('[data-invite]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { const r = await api('parents/' + b.dataset.invite + '/invite', { method: 'POST', body: '{}' }); const p = parents.find(x => x.id === b.dataset.invite);
      if (r.emailed) toast('Email sent to ' + p.email); else linkModal('Share this link', [{ name: p.name, email: p.email, link: r.link }]); show('parents'); }
    catch (e) { toast(e.message); b.disabled = false; }
  });
  $('#sync').onclick = async () => {
    try { const r = await api('parents/sync', { method: 'POST', body: '{}' }); toast(r.total ? `${r.created} new account${r.created === 1 ? '' : 's'} · ${r.linked} child link${r.linked === 1 ? '' : 's'} added` : 'No parent emails found on student records'); show('parents'); } catch (e) { toast(e.message); }
  };
  $('#invite-all')?.addEventListener('click', async () => {
    try { const r = await api('parents/invite-pending', { method: 'POST', body: '{}' });
      if (r.emailed === false) linkModal('Share these links', r.links); else toast(`Sent ${r.sent} invitation${r.sent === 1 ? '' : 's'}` + (r.failed ? ` · ${r.failed} failed${r.error ? ' (' + r.error + ')' : ''}` : '')); show('parents'); }
    catch (e) { toast(e.message); }
  });
};
function parentForm(p, students) {
  const sel = new Set((p?.students || []).map(s => s.id));
  const m = openModal(p ? 'Edit parent' : 'Add parent', `<form id="pf"><div class="form-grid"><label>Name<input name="name" value="${esc(p?.name || '')}"></label><label>Email<input name="email" type="email" required value="${esc(p?.email || '')}"></label>${p ? `<label class="wide check"><input type="checkbox" name="active" ${p.active === 0 ? '' : 'checked'}> Account enabled</label>` : ''}</div><h4>Children</h4><input id="pf-search" placeholder="Search students..." class="section-gap-sm"><div class="roster-list" id="pf-kids">${students.map(s => `<label class="roster-person" data-n="${esc(nameOf(s).toLowerCase())}"><input type="checkbox" value="${esc(s.id)}" ${sel.has(s.id) ? 'checked' : ''}><span><b>${esc(nameOf(s))}</b><small>${esc(s.center_id || '')}</small></span></label>`).join('')}</div><div class="modal-actions"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn">Save</button></div></form>`, { wide: true });
  m.$('#pf-search').oninput = e => m.$$('#pf-kids label').forEach(l => l.style.display = l.dataset.n.includes(e.target.value.toLowerCase()) ? '' : 'none');
  m.$('#pf').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target);
    const body = { name: f.get('name'), email: f.get('email'), student_ids: m.$$('#pf-kids input:checked').map(x => x.value) };
    try { if (p) { body.active = !!f.get('active'); await api('parents/' + p.id, { method: 'PUT', body: JSON.stringify(body) }); toast('Saved'); }
      else { await api('parents', { method: 'POST', body: JSON.stringify(body) }); toast('Parent added — send them an invite'); }
      m.close(); show('parents'); } catch (err) { toast(err.message); }
  };
}

/* ---------- ADMIN: email parents ---------- */
PAGES.email = async () => {
  const [events, links, shop, students, centers, status] = await Promise.all(['events', 'links', 'shop_items', 'students', 'centers', 'email/status'].map(x => api(x)));
  const preset = state.emailPreset || {}; state.emailPreset = null;
  const up = events.filter(e => e.event_date >= todayStr()).sort((a, b) => a.event_date.localeCompare(b.event_date));
  const chk = (name, id, on) => `<input type="checkbox" name="${name}" value="${esc(id)}" ${on ? 'checked' : ''}>`;
  $('#content').innerHTML = hero('Email parents', 'Send dates, sign-up links and forms straight to parents’ inboxes.') +
    (status.configured ? '' : `<div class="notice warn-n"><div><b>Email sending isn't set up yet.</b><br><small>You can still build and preview a message. To send, add <code>RESEND_API_KEY</code> and <code>MAIL_FROM</code> in Cloudflare Pages → Settings → Variables and Secrets (see the README).</small></div></div>`) +
    `<form id="mf" class="card mail-form"><div class="form-grid"><label>Send to<select name="atype"><option value="all">All parents</option><option value="center">One center</option><option value="students">Specific students</option></select></label><label id="center-wrap" style="display:none">Center<select name="center">${centers.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label>
    <div class="wide" id="stu-wrap" style="display:none"><div class="roster-list">${students.map(s => `<label class="roster-person">${chk('stu', s.id)}<span><b>${esc(nameOf(s))}</b><small>${esc(s.parent_email || 'no email')}</small></span></label>`).join('')}</div></div>
    <label class="wide">Subject<input name="subject" required maxlength="200" placeholder="e.g. Evaluation on Saturday, Nov 8"></label><label class="wide">Message<textarea name="message" rows="5" placeholder="Write a short note (optional if you attach events or links)"></textarea></label></div>
    <div class="attach-grid"><fieldset><legend>Attach events</legend>${up.length ? up.map(e => `<label class="pick">${chk('ev', e.id, (preset.event_ids || []).includes(e.id))}<span><b>${esc(e.title)}</b><small>${esc(fmtShort(e.event_date))} · ${typeLabel(e.event_type)}${e.signup_url ? ' · sign-up link' : ''}</small></span></label>`).join('') : '<p class="muted">No upcoming events.</p>'}</fieldset>
    <fieldset><legend>Attach links & forms</legend>${links.length ? links.map(l => `<label class="pick">${chk('lk', l.id, (preset.link_ids || []).includes(l.id))}<span><b>${esc(l.title)}</b><small>${esc(l.category || '')}</small></span></label>`).join('') : '<p class="muted">No links yet.</p>'}</fieldset>
    <fieldset><legend>Attach shop items</legend>${shop.length ? shop.map(s => `<label class="pick">${chk('sh', s.id, (preset.shop_ids || []).includes(s.id))}<span><b>${esc(s.title)}</b><small>${esc(s.price || s.category || '')}</small></span></label>`).join('') : '<p class="muted">No shop items yet.</p>'}</fieldset></div>
    <label class="check"><input type="checkbox" name="portal" checked> Include a link to the parent portal</label>
    <div class="mail-actions"><button type="button" class="btn secondary" id="preview">Preview</button><div class="test-send"><input type="email" id="test-to" placeholder="Send a test to..."><button type="button" class="btn secondary" id="test">Send test</button></div><button class="btn" id="send">Send to parents</button></div><p class="muted" id="mail-info"></p></form>
    <div class="card section-gap"><h3>Recent emails</h3>${status.log.length ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>Subject</th><th>Audience</th><th>Delivered</th></tr></thead><tbody>${status.log.map(l => `<tr><td>${fmtStamp(l.created_at)}</td><td>${esc(l.subject)}${l.is_test ? ' <span class="chip">test</span>' : ''}</td><td>${esc(l.audience)}</td><td>${l.sent}/${l.total}${l.failed ? ` <span class="chip warn">${l.failed} failed</span>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nothing sent yet.</p>'}</div>`;
  const f = $('#mf'), F = n => f.elements.namedItem(n), vals = n => [...f.querySelectorAll(`[name=${n}]:checked`)].map(x => x.value);
  const sync = () => { $('#center-wrap').style.display = F('atype').value === 'center' ? '' : 'none'; $('#stu-wrap').style.display = F('atype').value === 'students' ? '' : 'none'; };
  F('atype').onchange = sync; sync();
  const payload = extra => ({ subject: F('subject').value, message: F('message').value, audience: { type: F('atype').value, center_id: F('center').value, student_ids: vals('stu') }, event_ids: vals('ev'), link_ids: vals('lk'), shop_ids: vals('sh'), include_portal: F('portal').checked, ...extra });
  const post = extra => api('email/send', { method: 'POST', body: JSON.stringify(payload(extra)) });
  $('#preview').onclick = async () => {
    if (!F('subject').value.trim()) return toast('Add a subject first');
    try { const r = await post({ dry_run: true }); $('#mail-info').textContent = r.recipients + ' parent email' + (r.recipients === 1 ? '' : 's') + ' will receive this.';
      const m = openModal('Preview · ' + F('subject').value, '<iframe class="preview-frame" sandbox title="Email preview"></iframe>', { wide: true }); m.$('iframe').srcdoc = r.html; } catch (e) { toast(e.message); }
  };
  $('#test').onclick = async () => { try { const r = await post({ test_to: $('#test-to').value }); toast(r.sent ? 'Test email sent' : 'Test failed'); show('email'); } catch (e) { toast(e.message); } };
  f.onsubmit = async e => {
    e.preventDefault();
    try { const d = await post({ dry_run: true }); if (!d.recipients) return toast('No parent emails match that audience');
      if (!confirm('Send this email to ' + d.recipients + ' parent' + (d.recipients === 1 ? '' : 's') + '?')) return;
      $('#send').disabled = true; const r = await post({}); toast(`Sent to ${r.sent} parent${r.sent === 1 ? '' : 's'}` + (r.failed ? ` · ${r.failed} failed` : '')); show('email'); }
    catch (err) { toast(err.message); $('#send').disabled = false; }
  };
};

/* ---------- PARENT portal ---------- */
async function loadHome() { return (state.home = await api('parent/home')); }
const pips = n => '<span class="pips">' + [1, 2, 3, 4, 5].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('') + '</span>';
const STATUS_LABEL = { not_started: 'Not started', learning: 'Learning', mastered: 'Mastered' };

function eventCardParent(e) {
  return `<article class="event-card"><div class="date-chip big"><b>${dateObj(e.event_date).getDate()}</b><span>${dateObj(e.event_date).toLocaleDateString('en-US', { month: 'short' })}</span></div><div class="event-main"><div class="chips"><span class="chip type-${esc(e.event_type)}">${typeLabel(e.event_type)}</span><span class="chip ${daysUntil(e.event_date) <= 7 ? 'warn' : ''}">${countdown(e.event_date)}</span></div><h3>${esc(e.title)}</h3><p class="muted">${esc(fmtLong(e.event_date))}${e.event_time ? ' · ' + esc(fmtTime(e.event_time)) : ''}${e.location ? '<br>📍 ' + esc(e.location) : ''}</p>${e.details ? `<p class="event-details">${esc(e.details)}</p>` : ''}${e.signup_url ? `<div class="card-actions">${link(e.signup_url, 'Sign up ↗', 'btn small')}</div>` : ''}</div></article>`;
}
const skillDate = d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
function childCard(c) {
  const a = c.attendance, tot = a.present + a.late + a.absent + a.excused, rate = tot ? Math.round((a.present + a.late) / tot * 100) : null;
  const skillBlock = app => {
    const list = c.skills.filter(s => s.apparatus === app); if (!list.length) return '';
    const lvl = c[app + '_level'], at = list.filter(s => s.level === lvl), done = at.filter(s => s.status === 'mastered').length;
    const levels = [1, 2, 3, 4, 5].filter(l => list.some(s => s.level === l));
    return `<details class="skills-acc"><summary><b>${app[0].toUpperCase() + app.slice(1)}</b> · Level ${lvl}${at.length ? ` <span class="muted">— ${done}/${at.length} skills mastered at this level</span>` : ''}</summary>${at.length ? `<div class="bar"><i style="width:${Math.round(done / at.length * 100)}%"></i></div>` : ''}${levels.map(l => `<details ${l === lvl ? 'open' : ''}><summary class="lv-sum">Level ${l} <span class="muted">${list.filter(s => s.level === l && s.status === 'mastered').length}/${list.filter(s => s.level === l).length}</span></summary><ul class="skill-list">${list.filter(s => s.level === l).map(s => `<li><span>${s.video_url ? `<a href="${esc(safeUrl(s.video_url))}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a>` : esc(s.name)}</span><span class="skill-when">${s.status === 'mastered' && s.mastered_date ? 'Mastered ' + skillDate(s.mastered_date) : s.started_date && s.status !== 'not_started' ? 'Started ' + skillDate(s.started_date) : ''}</span><span class="chip s-${s.status}">${STATUS_LABEL[s.status]}</span></li>`).join('')}</ul></details>`).join('')}</details>`;
  };
  return `<section class="card child"><div class="child-head"><div class="avatar">${c.photo_url ? `<img src="${esc(safeUrl(c.photo_url))}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<span>${esc((c.first_name[0] || '') + (c.last_name[0] || ''))}</span></div><div><h2>${esc(nameOf(c))}</h2><p class="muted">${esc(c.center_id ? c.center_id[0].toUpperCase() + c.center_id.slice(1) : '')}</p></div></div>
  <div class="levels">${['pole', 'rope', 'yoga'].map((k, i) => `<div class="level-box">${window.MFU_SIL ? MFU_SIL.level(k, c[k + '_level'], i) : ''}<small>${k.toUpperCase()}</small><b>Level ${c[k + '_level']}</b>${pips(c[k + '_level'])}</div>`).join('')}</div>
  ${c.batches.length ? `<h4>Classes</h4><div class="chips">${c.batches.map(b => `<span class="chip ${b.drop_in ? 'drop' : ''}">${esc(b.name)}${b.days ? ' · ' + esc(b.days) : ''}${b.start_time ? ' · ' + esc(fmtTime(b.start_time)) : ''}${b.drop_in ? ' · drop-in' : ''}</span>`).join('')}</div>` : ''}
  <h4>Skills</h4>${['pole', 'rope', 'yoga'].map(skillBlock).join('') || '<p class="muted">Skill tracking will appear here once your coach starts it.</p>'}
  ${c.routines.filter(r => r.content).map(r => `<details class="skills-acc"><summary><b>${r.apparatus[0].toUpperCase() + r.apparatus.slice(1)} routine</b></summary><pre class="routine">${esc(r.content)}</pre></details>`).join('')}
  <h4>Attendance <span class="muted">last 90 days</span></h4>${tot ? `<div class="att"><div class="att-rate"><b>${rate}%</b><small>attended</small></div><div class="chips"><span class="chip ok">${a.present} present</span><span class="chip">${a.late} late</span><span class="chip ${a.absent ? 'warn' : ''}">${a.absent} absent</span><span class="chip">${a.excused} excused</span></div></div><ul class="att-list">${c.recent_attendance.map(r => `<li><span>${esc(fmtShort(r.attendance_date))}${r.batch ? ' · ' + esc(r.batch) : ''}${r.drop_in ? ' <span class="chip drop">Drop-in</span>' : ''}</span><span class="chip s-${r.status}">${r.status}</span></li>`).join('')}</ul>` : '<p class="muted">No attendance recorded yet.</p>'}</section>`;
}
PAGES.home = async () => {
  const d = await loadHome();
  const next = d.events.slice(0, 3);
  $('#content').innerHTML = hero('Hello' + (d.parent.name ? ', ' + esc(d.parent.name.split(/\s+/)[0]) : ''), 'Here is how your ' + (d.children.length > 1 ? 'children are' : 'child is') + ' doing.') +
    (next.length ? `<div class="card next-up"><h3>Coming up</h3>${next.map(e => `<div class="mini-event"><div class="date-chip"><b>${dateObj(e.event_date).getDate()}</b><span>${dateObj(e.event_date).toLocaleDateString('en-US', { month: 'short' })}</span></div><div><b>${esc(e.title)}</b><small>${typeLabel(e.event_type)} · ${esc(fmtTime(e.event_time) || fmtShort(e.event_date))}</small></div>${e.signup_url ? link(e.signup_url, 'Sign up', 'btn small') : `<span class="chip">${countdown(e.event_date)}</span>`}</div>`).join('')}<button class="btn secondary small" data-go="p_events">See all events</button></div>` : '') +
    (d.children.length ? d.children.map(childCard).join('') : `<div class="card">${empty('👋', 'No children linked yet', 'Ask your coach to link your child to this account.')}</div>`);
  $$('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go));
};
PAGES.p_events = async () => {
  const d = state.home || await loadHome();
  $('#content').innerHTML = hero('Upcoming events', 'Evaluations and competitions for your centers.') + (d.events.length ? d.events.map(eventCardParent).join('') : `<div class="card">${empty('📅', 'Nothing scheduled right now', 'New evaluations and competitions will show up here.')}</div>`);
};
function parentBoard(items, title, sub, shop) {
  const groups = [...new Set(items.map(i => i.category || 'Other'))].sort();
  return hero(title, sub) + (items.length ? groups.map(g => `<h3 class="group-title">${esc(g)}</h3><div class="link-grid">${items.filter(i => (i.category || 'Other') === g).map(i => `<div class="link-card"><div><b>${esc(i.title)}</b>${i.price ? `<span class="chip">${esc(i.price)}</span>` : ''}</div>${i.description ? `<p class="muted">${esc(i.description)}</p>` : ''}<div class="card-actions">${link(i.url, shop ? 'View item ↗' : 'Open ↗', 'btn small')}</div></div>`).join('')}</div>`).join('') : `<div class="card">${empty(shop ? '🛍️' : '🔗', 'Nothing here yet', 'Check back soon.')}</div>`);
}
PAGES.p_links = async () => { const d = state.home || await loadHome(); $('#content').innerHTML = parentBoard(d.links, 'Forms & links', 'Waivers, registration and other links from MFU.', false); };
PAGES.p_shop = async () => { const d = state.home || await loadHome(); $('#content').innerHTML = parentBoard(d.shop, 'Shop', 'Gear and items your child may need, with where to buy them.', true); };
PAGES.account = async () => {
  const d = state.home || await loadHome();
  $('#content').innerHTML = hero('Account', 'Signed in as ' + esc(d.parent.email)) + `<form class="card narrow" id="pwf"><h3>Change password</h3><div class="form-grid"><label class="wide">Current password<input type="password" name="cur" autocomplete="current-password" required></label><label class="wide">New password<input type="password" name="new" autocomplete="new-password" minlength="8" required></label></div><div class="modal-actions"><button class="btn">Update password</button></div></form>`;
  $('#pwf').onsubmit = async e => { e.preventDefault(); try { await api('parent/password', { method: 'POST', body: JSON.stringify({ current: e.target.elements.namedItem('cur').value, password: e.target.elements.namedItem('new').value }) }); toast('Password updated'); e.target.reset(); } catch (err) { toast(err.message); } };
};
// Always fetch fresh parent data when navigating to the home page.
const _home = PAGES.home; PAGES.home = async () => { state.home = null; await _home(); };

// Wait for every deferred script (attendance.js, features.js) so their pages and menus exist before the first page shows.
document.addEventListener('DOMContentLoaded', checkAuth);
