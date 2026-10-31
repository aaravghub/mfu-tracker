/* MFU Tracker — coach accounts, calendar & meetings, demos, evaluations, competition scores, notes, fitness,
   progress photos, parent requests, announcements and the skill assistant.
   Loaded after extra.js and attendance.js (uses their globals: $, $$, api, esc, toast, state, show, titles, hero, empty,
   openModal, nameOf, centerName, todayStr, fmtShort, fmtLong, fmtTime, fmtStamp, dateObj, link, safeUrl, NAV, PAGES). */
'use strict';
(() => {
  const APPS = ['pole', 'rope', 'yoga'];
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : '';
  const STAT = ['present', 'late', 'absent', 'excused'];
  const METRICS = [['dasrang_1min', 'Dasrang in 1 min'], ['rope_climb_1min', 'Rope climbs in 1 min'], ['pole_climb_1min', 'Pole climbs in 1 min'], ['sadhi_adhi_1min', 'Sadhi Adhi in 1 min'], ['pushups', 'Push-ups'], ['situps', 'Sit-ups'], ['squats', 'Squats'], ['three_inch_hold', '3-inch hold (sec)'], ['plank', 'Plank (sec)'], ['pullups', 'Pull-ups']];
  const customMetrics = () => { try { return JSON.parse(localStorage.getItem('mfu-metrics') || '[]'); } catch { return []; } };
  const allMetrics = () => [...METRICS, ...customMetrics().filter(([k]) => !METRICS.some(m => m[0] === k))];
  const metricLabel = k => allMetrics().find(m => m[0] === k)?.[1] || k.replace(/_/g, ' ');
  const isCoach = () => state.role === 'coach';
  const timeRange = (a, b) => [fmtTime(a), fmtTime(b)].filter(Boolean).join('–');
  const go = (page, patch = {}) => { Object.assign(state, patch); show(page); };
  const levelOf = (s, app) => Number(s[app + '_level']) || 1;
  const statusSelect = (attr, cur) => `<select ${attr}><option value="">—</option>${STAT.map(k => `<option value="${k}" ${cur === k ? 'selected' : ''}>${cap(k)}</option>`).join('')}</select>`;
  const csvDownload = (name, rows) => {
    const csv = rows.map(r => r.map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  };
  // Searchable checkbox list of students, optionally filtered by batch.
  async function studentPicker(host, selected, { batches } = {}) {
    const [students, bs] = await Promise.all([api('students'), batches ? Promise.resolve(batches) : api('meeting-contacts').then(x => x.batches)]);
    const sel = new Set(selected);
    host.innerHTML = `<div class="toolbar"><input data-ps placeholder="Search students..."><select data-pb style="max-width:220px"><option value="">Add a whole batch…</option>${bs.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select></div><div class="roster-list" data-pl>${students.filter(s => s.active !== 0).map(s => `<label class="roster-person" data-n="${esc(nameOf(s).toLowerCase())}"><input type="checkbox" value="${esc(s.id)}" ${sel.has(s.id) ? 'checked' : ''}><span><b>${esc(nameOf(s))}</b><small>${esc(s.center_id || '')} · P${s.pole_level} R${s.rope_level} Y${s.yoga_level}</small></span></label>`).join('')}</div>`;
    host.querySelector('[data-ps]').oninput = e => host.querySelectorAll('[data-pl] label').forEach(l => l.style.display = l.dataset.n.includes(e.target.value.toLowerCase()) ? '' : 'none');
    host.querySelector('[data-pb]').onchange = e => { const b = bs.find(x => x.id === e.target.value); if (b) b.student_ids.forEach(id => { const i = host.querySelector(`[data-pl] input[value="${CSS.escape(id)}"]`); if (i) i.checked = true; }); e.target.value = ''; };
    return { students, ids: () => [...host.querySelectorAll('[data-pl] input:checked')].map(i => i.value) };
  }

  /* ---------- navigation ---------- */
  const EVENTS_NAV = ['Events', [['calendar', 'Calendar & meetings'], ['evaluations', 'Evaluations'], ['competitions', 'Competition scores'], ['demos', 'Demos'], ['events', 'Event list']]];
  const MANAGE = [['overview', 'Overview'], ['students', 'Students'], ['batches', 'Batches'], ['coaches', 'Coaches'], ['centers', 'Centers'], ['attendance', 'Attendance'], ['fitness', 'Fitness'], ['skills', 'Skill library'], ['routines', 'Routines']];
  NAV.admin = [['Manage', MANAGE], EVENTS_NAV,
    ['Families', [['parents', 'Parents'], ['requests', 'Parent requests'], ['announcements', 'Announcements'], ['links', 'Links & forms'], ['shop', 'Shop'], ['email', 'Email parents']]],
    ['Tools', [['assistant', 'Skill assistant'], ['coach_accounts', 'Coach accounts'], ['timers', 'Timers']]]];
  NAV.coach = [['Me', [['coach_home', 'My dashboard'], ['requests', 'Parent requests'], ['announcements', 'Announcements']]], ['Manage', MANAGE.filter(([p]) => p !== 'overview')], EVENTS_NAV,
    ['Families', [['links', 'Links & forms'], ['shop', 'Shop'], ['email', 'Email parents']]],
    ['Tools', [['assistant', 'Skill assistant'], ['timers', 'Timers'], ['c_account', 'Account']]]];
  NAV.parent = [['', [['home', 'My children'], ['p_announcements', 'Announcements'], ['p_events', 'Events'], ['p_contact', 'Contact coach'], ['p_links', 'Forms & links'], ['p_shop', 'Shop'], ['account', 'Account']]]];
  Object.assign(titles, { student: 'Student', centers: 'Centers', coach_home: 'My dashboard', calendar: 'Calendar & meetings', evaluations: 'Evaluations', competitions: 'Competition scores', demos: 'Demos', requests: 'Parent requests', announcements: 'Announcements', assistant: 'Skill assistant', coach_accounts: 'Coach accounts', fitness: 'Fitness', c_account: 'Account', p_announcements: 'Announcements', p_contact: 'Contact coach', events: 'Event list' });

  /* ---------- admin overview: add requests, demos and meetings ---------- */
  const _overview = PAGES.overview;
  PAGES.overview = async () => {
    await _overview();
    const x = await api('overview-extra').catch(() => null); if (!x) return;
    const items = [...x.demos.map(d => ({ ...d, kind: 'Demo', page: 'demos' })), ...x.meetings.map(m => ({ ...m, kind: 'Meeting', page: 'calendar' }))].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
    if (x.open_requests) $('#content .stats')?.insertAdjacentHTML('beforebegin', `<div class="notice"><div><b>${x.open_requests} open parent request${x.open_requests > 1 ? 's' : ''}</b><br><small>Meeting requests and questions from parents are waiting for a reply.</small></div><button class="btn" data-go="requests">Open requests</button></div>`);
    if (items.length) $('#content').insertAdjacentHTML('beforeend', `<div class="card section-gap"><h3>Demos & meetings</h3>${items.map(i => `<div class="mini-event"><div class="date-chip"><b>${dateObj(i.date).getDate()}</b><span>${dateObj(i.date).toLocaleDateString('en-US', { month: 'short' })}</span></div><div><b>${esc(i.title)}</b><small>${i.kind}${i.start_time ? ' · ' + esc(fmtTime(i.start_time)) : ''}</small></div>${i.meet_url ? link(i.meet_url, 'Join Meet', 'btn small') : `<button class="btn secondary small" data-go="${i.page}">Open</button>`}</div>`).join('')}</div>`);
    $$('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go));
  };

  /* ---------- coach dashboard ---------- */
  PAGES.coach_home = async () => {
    const d = await api('coach-dashboard');
    $('#content').innerHTML = hero('Hi ' + esc((d.coach.name || '').split(/\s+/)[0] || 'coach'), 'Your batches, students and anything parents have asked you.', '<button class="btn" data-go="attendance">Take attendance</button><button class="btn secondary" data-go="assistant">Skill assistant</button>') +
      `<div class="stats">${[['My batches', d.batches.length], ['My students', d.students.length], ['Open requests', d.requests.length], ['Evaluations to run', d.evaluations.length]].map(x => `<div class="stat"><span>${x[0]}</span><strong>${x[1]}</strong></div>`).join('')}</div>` +
      (d.requests.length ? `<div class="card"><h3>Parents are waiting on you</h3>${d.requests.map(r => `<button class="todo" data-go="requests"><b>${esc(r.subject)}</b><small>${r.kind === 'meeting' ? 'Meeting request' : 'Question'} from ${esc(r.parent_name || 'a parent')} about ${esc((r.first_name || '') + ' ' + (r.last_name || ''))} · ${fmtStamp(r.created_at)}</small><span>→</span></button>`).join('')}</div>` : '') +
      `<div class="two-col section-gap"><div class="card"><h3>My batches</h3>${d.batches.length ? d.batches.map(b => `<div class="mini-event"><div><b>${esc(b.name)}</b><small>${esc([b.days, timeRange(b.start_time, b.end_time)].filter(Boolean).join(' · '))} · ${b.students} students · ${b.today_marked ? 'attendance taken today' : b.last_taken ? 'last taken ' + esc(fmtShort(b.last_taken)) : 'no attendance yet'}</small></div><button class="btn small ${b.today_marked ? 'secondary' : ''}" data-take="${esc(b.id)}">${b.today_marked ? 'Edit today' : 'Take attendance'}</button></div>`).join('') : empty('🗓️', 'No batches yet', 'Ask the admin to add you to a batch.')}</div>
      <div class="card"><h3>Coming up</h3>${[...d.evaluations.map(e => `<div class="mini-event"><div class="date-chip"><b>${dateObj(e.event_date).getDate()}</b><span>${dateObj(e.event_date).toLocaleDateString('en-US', { month: 'short' })}</span></div><div><b>${esc(e.title)}</b><small>You're evaluating ${e.students} student${e.students === 1 ? '' : 's'}</small></div><button class="btn small" data-eval="${esc(e.id)}">Open</button></div>`), ...d.meetings.map(m => `<div class="mini-event"><div class="date-chip"><b>${dateObj(m.meeting_date).getDate()}</b><span>${dateObj(m.meeting_date).toLocaleDateString('en-US', { month: 'short' })}</span></div><div><b>${esc(m.title)}</b><small>Meeting${m.start_time ? ' · ' + esc(fmtTime(m.start_time)) : ''}</small></div>${m.meet_url ? link(m.meet_url, 'Join', 'btn small') : ''}</div>`)].join('') || empty('📅', 'Nothing scheduled', 'Evaluations you are assigned to and your meetings show here.')}</div></div>` +
      `<div class="card section-gap"><h3>My students</h3>${d.students.length ? `<div class="table-wrap"><table><thead><tr><th>Student</th><th>Pole</th><th>Rope</th><th>Yoga</th><th>Attendance (30 days)</th><th></th></tr></thead><tbody>${d.students.map(s => `<tr><td><button type="button" class="stu-link" data-open="${esc(s.id)}"><span class="mini-avatar">${esc((s.first_name[0] || '') + (s.last_name[0] || ''))}</span>${esc(nameOf(s))}</button></td><td><span class="chip lvl-chip">Level ${s.pole_level}</span></td><td><span class="chip lvl-chip">Level ${s.rope_level}</span></td><td><span class="chip lvl-chip">Level ${s.yoga_level}</span></td><td>${s.att_rate == null ? '—' : `<span class="chip ${s.att_rate < 70 ? 'warn' : 'ok'}">${s.att_rate}%</span>`}</td><td class="actions"><button class="btn secondary small" data-open="${esc(s.id)}">Open profile</button></td></tr>`).join('')}</tbody></table></div>` : empty('🧒', 'No students yet', 'Students on your batches show here.')}</div>` +
      (d.announcements.length ? `<div class="card section-gap"><h3>Announcements</h3>${d.announcements.map(annCard).join('')}</div>` : '');
    $$('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go));
    $$('[data-take]').forEach(b => b.onclick = () => { state.att = Object.assign(state.att || { center: '', month: todayStr().slice(0, 7), rcenter: '', sort: 'name', q: '' }, { mode: 'batch', batch: b.dataset.take, date: todayStr() }); show('attendance'); });
    $$('[data-eval]').forEach(b => b.onclick = () => go('evaluations', { evalId: b.dataset.eval }));
    $$('[data-open]').forEach(b => b.onclick = () => openStudent(b.dataset.open));
  };
  PAGES.c_account = async () => {
    $('#content').innerHTML = hero('Account', 'Signed in as ' + esc(state.me?.email || 'coach')) + `<form class="card narrow" id="pwf"><h3>Change password</h3><div class="form-grid"><label class="wide">Current password<input type="password" name="cur" autocomplete="current-password" required></label><label class="wide">New password<input type="password" name="new" autocomplete="new-password" minlength="8" required></label></div><div class="modal-actions"><button class="btn">Update password</button></div></form>`;
    $('#pwf').onsubmit = async e => { e.preventDefault(); try { await api('coach/password', { method: 'POST', body: JSON.stringify({ current: e.target.elements.namedItem('cur').value, password: e.target.elements.namedItem('new').value }) }); toast('Password updated'); e.target.reset(); } catch (err) { toast(err.message); } };
  };

  /* ---------- coach accounts (admin) ---------- */
  PAGES.coach_accounts = async () => {
    const d = await api('coach-accounts');
    $('#content').innerHTML = hero('Coach accounts', 'Give each coach their own sign-in. Coaches can do everything except manage coach and parent accounts.', '<button class="btn secondary" data-go="coaches">Add or edit coaches</button>') +
      (d.coaches.length ? `<div class="table-wrap"><table><thead><tr><th>Coach</th><th>Status</th><th>Last sign-in</th><th>Actions</th></tr></thead><tbody>${d.coaches.map(c => `<tr><td><b>${esc(c.name)}</b><br><small class="muted">${esc(c.email || 'No email')}</small></td><td>${c.active === 0 ? '<span class="chip">Inactive</span>' : !c.email ? '<span class="chip warn">Needs an email</span>' : c.has_password ? '<span class="chip ok">Can sign in</span>' : c.invited_at ? '<span class="chip warn">Invite sent</span>' : '<span class="chip">No account yet</span>'}</td><td>${fmtStamp(c.last_login)}</td><td class="actions">${c.email && c.active !== 0 ? `<button class="btn small ${c.has_password ? 'secondary' : ''}" data-inv="${esc(c.id)}">${c.has_password ? 'Send reset link' : 'Create account & invite'}</button>` : ''}${c.has_password ? `<button class="btn secondary small" data-rev="${esc(c.id)}">Remove access</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : `<div class="card">${empty('🧑‍🏫', 'No coaches yet', 'Add coaches with their email on the Coaches page first.')}</div>`);
    $$('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go));
    $$('[data-inv]').forEach(b => b.onclick = async () => { b.disabled = true; try { const r = await api('coach-accounts/' + b.dataset.inv + '/invite', { method: 'POST', body: '{}' }); const c = d.coaches.find(x => x.id === b.dataset.inv); if (r.emailed) toast('Invite emailed to ' + c.email); else linkModal('Share this link with ' + c.name, [{ name: c.name, email: c.email, link: r.link }]); show('coach_accounts'); } catch (e) { toast(e.message); b.disabled = false; } });
    $$('[data-rev]').forEach(b => b.onclick = async () => { if (!confirm('Remove this coach\'s sign-in? Their coach record stays.')) return; try { await api('coach-accounts/' + b.dataset.rev + '/revoke', { method: 'POST', body: '{}' }); toast('Access removed'); show('coach_accounts'); } catch (e) { toast(e.message); } });
  };

  /* ---------- calendar & meetings ---------- */
  const pad = n => String(n).padStart(2, '0');
  PAGES.calendar = async () => {
    const month = state.calMonth ||= todayStr().slice(0, 7);
    const [y, m] = month.split('-').map(Number);
    const first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate(), lead = first.getDay();
    const from = month + '-01', to = month + '-' + pad(days);
    const [cal, meetings] = await Promise.all([api('calendar?from=' + from + '&to=' + to), api('meetings')]);
    const items = [...cal.events.map(e => ({ ...e, kind: e.event_type })), ...cal.demos.map(d => ({ ...d, kind: 'demo' })), ...cal.meetings.map(x => ({ ...x, kind: 'meeting' }))];
    const byDay = d => items.filter(i => i.date === month + '-' + pad(d)).sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
    const cells = Array(lead).fill('<div class="cal-cell blank"></div>').concat(Array.from({ length: days }, (_, i) => { const d = i + 1, ds = month + '-' + pad(d), list = byDay(d); return `<div class="cal-cell ${ds === todayStr() ? 'today' : ''}" data-day="${ds}"><span class="cal-n">${d}</span>${list.slice(0, 3).map(x => `<span class="cal-item k-${esc(x.kind)}" title="${esc(x.title)}">${x.start_time ? esc(fmtTime(x.start_time)) + ' ' : ''}${esc(x.title)}</span>`).join('')}${list.length > 3 ? `<small class="muted">+${list.length - 3} more</small>` : ''}</div>`; }));
    const up = meetings.filter(x => x.meeting_date >= todayStr()).sort((a, b) => (a.meeting_date + (a.start_time || '')).localeCompare(b.meeting_date + (b.start_time || '')));
    const past = meetings.filter(x => x.meeting_date < todayStr());
    const mCard = x => `<div class="mini-event"><div class="date-chip"><b>${dateObj(x.meeting_date).getDate()}</b><span>${dateObj(x.meeting_date).toLocaleDateString('en-US', { month: 'short' })}</span></div><div><b>${esc(x.title)}</b><small>${esc(timeRange(x.start_time, x.end_time) || 'Any time')} · ${x.attendees.length} invited${x.location ? ' · ' + esc(x.location) : ''}${x.created_by ? ' · by ' + esc(x.created_by) : ''}</small></div><div class="card-actions" style="margin:0">${x.meet_url ? link(x.meet_url, 'Join Meet', 'btn small') : ''}<button class="btn secondary small" data-mview="${esc(x.id)}">Who</button><button class="btn secondary small" data-mdel="${esc(x.id)}">Cancel</button></div></div>`;
    $('#content').innerHTML = hero('Calendar & meetings', 'Evaluations, competitions, demos and meetings in one place. New meetings can get a Google Meet link and email everyone the invite.', '<button class="btn" id="new-meeting">+ New meeting</button><button class="btn secondary" data-go="demos">+ Demo</button><button class="btn secondary" data-go="events">+ Evaluation / competition</button>') +
      `<div class="card"><div class="month-nav"><button class="btn secondary small" data-mv="-1" aria-label="Previous month">‹</button><b>${first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</b><button class="btn secondary small" data-mv="1" aria-label="Next month">›</button><button class="btn secondary small" data-mv="0">Today</button></div>
      <div class="cal-legend"><span class="cal-item k-evaluation">Evaluation</span><span class="cal-item k-competition">Competition</span><span class="cal-item k-demo">Demo</span><span class="cal-item k-meeting">Meeting</span></div>
      <div class="cal-grid">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="cal-h">${d}</div>`).join('')}${cells.join('')}</div><div id="cal-day" class="section-gap"></div></div>` +
      `<div class="card section-gap"><h3>Upcoming meetings</h3>${up.length ? up.map(mCard).join('') : empty('🤝', 'No meetings scheduled', 'Create one with the + New meeting button.')}</div>` +
      (past.length ? `<details class="section-gap"><summary class="muted">Past meetings (${past.length})</summary><div class="card section-gap">${past.map(mCard).join('')}</div></details>` : '');
    $$('[data-mv]').forEach(b => b.onclick = () => { const n = +b.dataset.mv; if (!n) state.calMonth = todayStr().slice(0, 7); else { const d = new Date(y, m - 1 + n, 1); state.calMonth = d.getFullYear() + '-' + pad(d.getMonth() + 1); } show('calendar'); });
    $$('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go));
    $$('[data-day]').forEach(c => c.onclick = () => {
      const list = items.filter(i => i.date === c.dataset.day);
      $('#cal-day').innerHTML = `<h3>${esc(fmtLong(c.dataset.day))}</h3>${list.length ? list.map(i => `<div class="mini-event"><span class="cal-item k-${esc(i.kind)}">${esc(typeLabel(i.kind))}</span><div><b>${esc(i.title)}</b><small>${esc(timeRange(i.start_time, i.end_time) || 'Time not set')}${i.location ? ' · ' + esc(i.location) : ''}</small></div>${i.meet_url ? link(i.meet_url, 'Join', 'btn small') : i.kind === 'evaluation' ? `<button class="btn small" data-ev="${esc(i.id)}">Open evaluation</button>` : i.kind === 'competition' ? `<button class="btn small" data-cp="${esc(i.id)}">Scores</button>` : ''}</div>`).join('') : '<p class="muted">Nothing on this day.</p>'}<div class="card-actions"><button class="btn small" data-newon="${c.dataset.day}">+ Meeting on this day</button></div>`;
      $$('[data-ev]').forEach(b => b.onclick = () => go('evaluations', { evalId: b.dataset.ev }));
      $$('[data-cp]').forEach(b => b.onclick = () => go('competitions', { compId: b.dataset.cp }));
      $('[data-newon]').onclick = () => meetingModal({ meeting_date: c.dataset.day });
    });
    $('#new-meeting').onclick = () => meetingModal({});
    $$('[data-mview]').forEach(b => b.onclick = () => { const x = meetings.find(z => z.id === b.dataset.mview); openModal(x.title, `<p class="muted">${esc(fmtLong(x.meeting_date))}${x.start_time ? ' · ' + esc(timeRange(x.start_time, x.end_time)) : ''}</p>${x.description ? `<p>${esc(x.description)}</p>` : ''}<div class="chips">${x.attendees.map(a => `<span class="chip">${esc(a)}</span>`).join('')}</div>${x.calendar_url ? `<div class="card-actions">${link(x.calendar_url, 'Open in Google Calendar ↗', 'btn secondary small')}</div>` : ''}`); });
    $$('[data-mdel]').forEach(b => b.onclick = async () => { if (!confirm('Cancel this meeting? If it has a Google invite, Google tells everyone it was cancelled.')) return; try { await api('meetings/' + b.dataset.mdel, { method: 'DELETE' }); toast('Meeting cancelled'); show('calendar'); } catch (e) { toast(e.message); } });
  };

  async function meetingModal(preset) {
    const c = await api('meeting-contacts');
    const pre = new Set((preset.attendees || []).map(e => e.toLowerCase()));
    const m = openModal('New meeting', `<form id="mtg"><div class="form-grid"><label class="wide">Title<input name="title" required maxlength="200" value="${esc(preset.title || '')}" placeholder="e.g. Progress check-in with the Patel family"></label>
      <label>Date<input type="date" name="meeting_date" required value="${esc(preset.meeting_date || todayStr())}"></label><label>Location (optional)<input name="location" placeholder="Edison center, or leave blank for online"></label>
      <label>Start<input type="time" name="start_time" value="${esc(preset.start_time || '18:00')}"></label><label>End<input type="time" name="end_time" value="${esc(preset.end_time || '18:30')}"></label>
      <label class="wide">Agenda / notes<textarea name="description" rows="3">${esc(preset.description || '')}</textarea></label></div>
      <h4>Who's invited <span class="muted" id="mcount"></span></h4>
      <div class="toolbar"><select id="mbatch" style="max-width:260px"><option value="">Add a whole batch (parents + coaches)…</option>${c.batches.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select><input id="msearch" placeholder="Search people..."></div>
      <div class="attach-grid"><fieldset><legend>Coaches</legend><div class="pick-list">${c.coaches.map(x => `<label class="pick" data-n="${esc((x.name + ' ' + x.email).toLowerCase())}"><input type="checkbox" name="who" value="${esc(x.email)}" data-coach="${esc(x.id)}" ${pre.has(x.email) ? 'checked' : ''}><span><b>${esc(x.name)}</b><small>${esc(x.email)}</small></span></label>`).join('') || '<p class="muted">No coaches with an email.</p>'}</div></fieldset>
      <fieldset><legend>Parents</legend><div class="pick-list">${c.families.map(f => `<label class="pick" data-n="${esc((f.name + ' ' + f.email + ' ' + f.kids.join(' ')).toLowerCase())}"><input type="checkbox" name="who" value="${esc(f.email)}" data-kids="${esc(f.student_ids.join(','))}" ${pre.has(f.email) ? 'checked' : ''}><span><b>${esc(f.name || f.email)}</b><small>${esc(f.kids.join(', '))}</small></span></label>`).join('') || '<p class="muted">No parent emails yet.</p>'}</div></fieldset></div>
      <label class="wide">Other emails (comma separated)<input name="extra" placeholder="someone@example.com" value="${esc([...pre].filter(e => !c.coaches.some(x => x.email === e) && !c.families.some(x => x.email === e)).join(', '))}"></label>
      <label class="check"><input type="checkbox" name="google_meet" checked> Create a Google Meet link and Google Calendar invite</label>
      <label class="wide" id="murl-wrap" style="display:none">Meeting link (optional, e.g. Zoom)<input name="meet_url" type="url" placeholder="https://"></label>
      <label class="check"><input type="checkbox" name="send_email" checked> Email the invite to everyone</label>
      <div class="modal-actions"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn" id="msave">Create meeting</button></div></form>`, { wide: true });
    const f = m.$('#mtg'), count = () => { m.$('#mcount').textContent = '· ' + m.$$('[name=who]:checked').length + ' selected'; };
    m.$$('[name=who]').forEach(i => i.onchange = count); count();
    m.$('#msearch').oninput = e => m.$$('.pick[data-n]').forEach(l => l.style.display = l.dataset.n.includes(e.target.value.toLowerCase()) ? '' : 'none');
    m.$('#mbatch').onchange = e => { const b = c.batches.find(x => x.id === e.target.value); if (!b) return; m.$$('[data-kids]').forEach(i => { if (i.dataset.kids.split(',').some(k => b.student_ids.includes(k))) i.checked = true; }); m.$$('[data-coach]').forEach(i => { if (b.coach_ids.includes(i.dataset.coach)) i.checked = true; }); e.target.value = ''; count(); };
    const gm = f.elements.namedItem('google_meet'); gm.onchange = () => { m.$('#murl-wrap').style.display = gm.checked ? 'none' : ''; };
    f.onsubmit = async e => {
      e.preventDefault(); const F = n => f.elements.namedItem(n);
      const attendees = [...m.$$('[name=who]:checked').map(i => i.value), ...F('extra').value.split(/[,;\s]+/).filter(Boolean)];
      const btn = m.$('#msave'); btn.disabled = true; btn.textContent = 'Creating…';
      try {
        const r = await api('meetings', { method: 'POST', body: JSON.stringify({ title: F('title').value, meeting_date: F('meeting_date').value, start_time: F('start_time').value, end_time: F('end_time').value, location: F('location').value, description: F('description').value, attendees, google_meet: gm.checked, meet_url: F('meet_url').value, send_email: F('send_email').checked, request_id: preset.request_id || undefined }) });
        m.close(); toast(r.meet_url ? 'Meeting created with a Google Meet link' + (r.google_invites ? ' · invites sent' : '') : 'Meeting saved' + (r.emailed ? ' · ' + r.emailed + ' emails sent' : ''));
        show(state.page === 'requests' ? 'requests' : 'calendar');
      } catch (err) { toast(err.message); btn.disabled = false; btn.textContent = 'Create meeting'; }
    };
  }
  window.meetingModal = meetingModal;

  /* ---------- demos ---------- */
  // Demo routines: each demo can have several (group, pole, rope or yoga), with who performs it.
  const RAPP = { group: 'Group', pole: 'Pole', rope: 'Rope', yoga: 'Yoga' };
  const routineBlock = d => `<div class="demo-routines"><h4>Routines${d.routines?.length ? ` <span class="muted">(${d.routines.length})</span>` : ''}</h4>${d.routines?.length ? d.routines.map(r => { const who = r.student_ids.map(id => d.students.find(s => s.student_id === id)).filter(Boolean); return `<details class="routine-card"><summary><span class="chip type-demo">${RAPP[r.apparatus] || 'Group'}</span> <b>${esc(r.title)}</b> <small class="muted">${who.length ? who.map(s => esc(s.first_name)).join(', ') : 'Everyone in the demo'}</small></summary>${r.content ? `<pre class="routine">${esc(r.content)}</pre>` : '<p class="muted">No steps written yet.</p>'}<div class="card-actions">${r.video_url ? link(r.video_url, 'Watch video ↗', 'btn secondary small') : ''}<button class="btn secondary small" data-redit="${esc(d.id)}|${esc(r.id)}">Edit</button><button class="btn secondary small" data-rdel="${esc(r.id)}">Delete</button></div></details>`; }).join('') : '<p class="muted">No routines yet. Add the group routine or each kid&#39;s pole, rope or yoga routine.</p>'}</div>`;
  function routineModal(d, r) {
    const sel = new Set(r?.student_ids || []);
    const m = openModal((r ? 'Edit routine · ' : 'New routine · ') + d.title, `<form id="rtf"><div class="form-grid"><label>Routine name<input name="title" required maxlength="200" value="${esc(r?.title || '')}" placeholder="e.g. Opening group sequence"></label><label>Type<select name="apparatus">${Object.entries(RAPP).map(([k, l]) => `<option value="${k}" ${(r?.apparatus || 'group') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label class="wide">Steps / skills, one per line<textarea name="content" rows="10" placeholder="1. Mount&#10;2. Dive&#10;3. ...">${esc(r?.content || '')}</textarea></label><label class="wide">Music or video link (optional)<input type="url" name="video_url" value="${esc(r?.video_url || '')}" placeholder="https://"></label></div>
      <h4>Who performs it <span class="muted">— leave all unticked for everyone in the demo</span></h4>${d.students.length ? `<div class="roster-list">${d.students.map(s => `<label class="roster-person"><input type="checkbox" name="who" value="${esc(s.student_id)}" ${sel.has(s.student_id) ? 'checked' : ''}><span><b>${esc(s.first_name + ' ' + s.last_name)}</b></span></label>`).join('')}</div>` : '<p class="muted">Add kids to the demo first to pick performers.</p>'}
      <div class="modal-actions"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn">Save routine</button></div></form>`, { wide: true });
    m.$('#rtf').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); const body = { title: f.get('title'), apparatus: f.get('apparatus'), content: f.get('content'), video_url: f.get('video_url'), student_ids: f.getAll('who') };
      try { await api(r ? 'demo-routines/' + r.id : 'demos/' + d.id + '/routines', { method: r ? 'PUT' : 'POST', body: JSON.stringify(body) }); toast('Routine saved'); m.close(); show('demos'); } catch (err) { toast(err.message); } };
  }
  PAGES.demos = async () => {
    const [demos, centers] = await Promise.all([api('demos'), api('centers')]);
    const up = demos.filter(d => d.demo_date >= todayStr()).sort((a, b) => a.demo_date.localeCompare(b.demo_date)), past = demos.filter(d => d.demo_date < todayStr());
    const card = (d, isPast) => { const came = d.students.filter(s => s.status === 'present' || s.status === 'late').length; return `<article class="event-card ${isPast ? 'past' : ''}"><div class="date-chip big"><b>${dateObj(d.demo_date).getDate()}</b><span>${dateObj(d.demo_date).toLocaleDateString('en-US', { month: 'short' })}</span></div><div class="event-main"><div class="chips"><span class="chip type-demo">Demo</span><span class="chip">${esc(centerName(centers, d.center_id))}</span><span class="chip">${d.students.length} kid${d.students.length === 1 ? '' : 's'}</span>${d.students.some(s => s.status) ? `<span class="chip ok">${came} came</span>` : ''}</div><h3>${esc(d.title)}</h3><p class="muted">${esc(fmtLong(d.demo_date))}${d.start_time ? ' · ' + esc(timeRange(d.start_time, d.end_time)) : ''}${d.arrive_time ? ' · arrive by ' + esc(fmtTime(d.arrive_time)) : ''}${d.location ? '<br>📍 ' + esc(d.location) : ''}</p>${d.details ? `<p class="event-details">${esc(d.details)}</p>` : ''}${d.students.length ? `<div class="chips">${d.students.map(s => `<span class="chip ${s.status ? 's-' + s.status : ''}">${esc(s.first_name + ' ' + s.last_name)}${s.status ? ' · ' + s.status : ''}</span>`).join('')}</div>` : ''}${routineBlock(d)}<div class="card-actions"><button class="btn small" data-datt="${esc(d.id)}">Attendance</button><button class="btn blue small" data-radd="${esc(d.id)}">+ Routine</button>${isPast ? '' : `<button class="btn small" data-dmail="${esc(d.id)}">✉ Email parents</button>`}<button class="btn secondary small" data-dedit="${esc(d.id)}">Edit / kids</button><button class="btn secondary small" data-ddel="${esc(d.id)}">Delete</button></div></div></article>`; };
    $('#content').innerHTML = hero('Demos', 'Plan demos: which kids are going, where, and what time to arrive. Then mark who showed up.', '<button class="btn" id="add-demo">+ Add demo</button>') +
      (up.length ? up.map(d => card(d)).join('') : `<div class="card">${empty('🎪', 'No upcoming demos', 'Add the next demo and pick the kids who are going.')}</div>`) +
      (past.length ? `<details class="section-gap"><summary class="muted">Past demos (${past.length})</summary><div class="section-gap">${past.map(d => card(d, true)).join('')}</div></details>` : '');
    $('#add-demo').onclick = () => demoModal(null, centers);
    $$('[data-dedit]').forEach(b => b.onclick = () => demoModal(demos.find(d => d.id === b.dataset.dedit), centers));
    $$('[data-ddel]').forEach(b => b.onclick = async () => { if (confirm('Delete this demo?')) { await api('demos/' + b.dataset.ddel, { method: 'DELETE' }); toast('Deleted'); show('demos'); } });
    $$('[data-dmail]').forEach(b => b.onclick = async () => { if (!confirm('Email the demo details to the parents of every kid going?')) return; try { const r = await api('demos/' + b.dataset.dmail + '/email', { method: 'POST', body: '{}' }); toast('Sent to ' + r.sent + ' parent' + (r.sent === 1 ? '' : 's')); } catch (e) { toast(e.message); } });
    $$('[data-radd]').forEach(b => b.onclick = () => routineModal(demos.find(d => d.id === b.dataset.radd)));
    $$('[data-redit]').forEach(b => b.onclick = () => { const [did, rid] = b.dataset.redit.split('|'), d = demos.find(x => x.id === did); routineModal(d, d.routines.find(r => r.id === rid)); });
    $$('[data-rdel]').forEach(b => b.onclick = async () => { if (confirm('Delete this routine?')) { await api('demo-routines/' + b.dataset.rdel, { method: 'DELETE' }); toast('Routine deleted'); show('demos'); } });
    $$('[data-datt]').forEach(b => b.onclick = () => {
      const d = demos.find(x => x.id === b.dataset.datt);
      if (!d.students.length) return toast('Add kids to this demo first');
      const m = openModal('Demo attendance · ' + d.title, `<div class="table-wrap"><table><tbody>${d.students.map(s => `<tr><td><b>${esc(s.first_name + ' ' + s.last_name)}</b></td><td>${statusSelect(`data-ds="${esc(s.student_id)}"`, s.status)}</td></tr>`).join('')}</tbody></table></div><div class="modal-actions"><button class="btn secondary" id="dall">All present</button><button class="btn" id="dsave">Save attendance</button></div>`);
      m.$('#dall').onclick = () => m.$$('[data-ds]').forEach(s => s.value = 'present');
      m.$('#dsave').onclick = async () => { try { await api('demos/' + d.id + '/attendance', { method: 'POST', body: JSON.stringify({ records: m.$$('[data-ds]').map(s => ({ student_id: s.dataset.ds, status: s.value })) }) }); toast('Demo attendance saved'); m.close(); show('demos'); } catch (e) { toast(e.message); } };
    });
  };
  async function demoModal(d, centers) {
    const m = openModal(d ? 'Edit demo' : 'Add demo', `<form id="df"><div class="form-grid"><label class="wide">Demo name<input name="title" required value="${esc(d?.title || '')}" placeholder="e.g. Diwali festival demo"></label><label>Date<input type="date" name="demo_date" required value="${esc(d?.demo_date || '')}"></label><label>Center<select name="center_id"><option value="">Any / all</option>${centers.map(c => `<option value="${esc(c.id)}" ${d?.center_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label><label>Kids arrive by<input type="time" name="arrive_time" value="${esc(d?.arrive_time || '')}"></label><label>Location / address<input name="location" value="${esc(d?.location || '')}"></label><label>Demo starts<input type="time" name="start_time" value="${esc(d?.start_time || '')}"></label><label>Demo ends<input type="time" name="end_time" value="${esc(d?.end_time || '')}"></label><label class="wide">Details for parents (what to wear, what to bring)<textarea name="details" rows="3">${esc(d?.details || '')}</textarea></label></div><h4>Kids going</h4><div id="dkids"></div><div class="modal-actions"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn">Save demo</button></div></form>`, { wide: true });
    const picker = await studentPicker(m.$('#dkids'), (d?.students || []).map(s => s.student_id));
    m.$('#df').onsubmit = async e => { e.preventDefault(); const body = Object.fromEntries(new FormData(e.target)); body.student_ids = picker.ids(); try { await api('demos' + (d ? '/' + d.id : ''), { method: d ? 'PUT' : 'POST', body: JSON.stringify(body) }); toast('Demo saved'); m.close(); show('demos'); } catch (err) { toast(err.message); } };
  }

  /* ---------- evaluations ---------- */
  PAGES.evaluations = async () => {
    const [events, skills, coaches] = await Promise.all([api('events'), api('skills'), api('coaches')]);
    const evals = events.filter(e => e.event_type === 'evaluation').sort((a, b) => b.event_date.localeCompare(a.event_date));
    if (!evals.length) { $('#content').innerHTML = hero('Evaluations', 'Run level evaluations skill by skill.', '<button class="btn" data-go="events">+ Add an evaluation</button>') + `<div class="card">${empty('📝', 'No evaluations yet', 'Add an event with the type “evaluation” first.')}</div>`; $$('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go)); return; }
    if (!evals.some(e => e.id === state.evalId)) state.evalId = (evals.filter(e => e.event_date >= todayStr()).pop() || evals[0]).id;
    const tab = state.evalTab ||= 'evaluate';
    const d = await api('evaluations/' + state.evalId);
    const coachOpts = sel => `<option value="">Not assigned</option>${coaches.filter(c => c.active !== 0).map(c => `<option value="${esc(c.id)}" ${sel === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}`;
    $('#content').innerHTML = hero('Evaluations', 'Pick who is being evaluated and by which coach, take attendance, then tick each skill they did or failed.') +
      `<div class="toolbar"><select id="evsel" style="max-width:420px">${evals.map(e => `<option value="${esc(e.id)}" ${e.id === state.evalId ? 'selected' : ''}>${esc(e.title)} · ${esc(fmtShort(e.event_date))}</option>`).join('')}</select>${d.event.sheet_url ? link(d.event.sheet_url, 'Open Google Sheet ↗', 'btn secondary small') : ''}</div>
      <div class="seg att-modes" id="evtabs">${[['students', 'Students & evaluators'], ['attendance', 'Attendance'], ['evaluate', 'Evaluate'], ['summary', 'Summary']].map(([k, l]) => `<button type="button" data-t="${k}" class="${tab === k ? 'active' : ''}">${l}</button>`).join('')}</div><div id="evview"></div>`;
    $('#evsel').onchange = e => go('evaluations', { evalId: e.target.value });
    $$('#evtabs button').forEach(b => b.onclick = () => go('evaluations', { evalTab: b.dataset.t }));
    const V = $('#evview');

    if (tab === 'students') {
      V.innerHTML = `<div class="card"><h3>Who is being evaluated</h3><p class="muted">Tick the students, then choose which coach evaluates each one. Coaches see their assignments on their dashboard.</p><div id="evpick"></div><div class="modal-actions"><button class="btn" id="evnext">Next: assign evaluators</button></div></div><div class="card section-gap" id="evassign"></div>`;
      const picker = await studentPicker($('#evpick'), d.participants.map(p => p.student_id));
      const cur = new Map(d.participants.map(p => [p.student_id, p.coach_id]));
      const drawAssign = () => {
        $$('[data-evc]').forEach(s => cur.set(s.dataset.evc, s.value));
        const ids = picker.ids();
        $('#evassign').innerHTML = `<h3>Evaluators</h3>${ids.length ? `<div class="toolbar"><select id="evbulk" style="max-width:260px">${coachOpts('')}</select><button class="btn secondary small" id="evbulkgo">Set for everyone</button></div><div class="table-wrap"><table><tbody>${ids.map(id => { const s = picker.students.find(x => x.id === id); return `<tr><td><b>${esc(nameOf(s))}</b><br><small class="muted">Pole ${s.pole_level} · Rope ${s.rope_level} · Yoga ${s.yoga_level}</small></td><td><select data-evc="${esc(id)}">${coachOpts(cur.get(id) || (isCoach() ? state.me.coach_id : ''))}</select></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted">No students picked yet.</p>'}<div class="modal-actions"><button class="btn" id="evsavep">Save students & evaluators</button></div>`;
        $('#evbulkgo') && ($('#evbulkgo').onclick = () => $$('[data-evc]').forEach(s => s.value = $('#evbulk').value));
        $('#evsavep').onclick = async () => { try { const participants = picker.ids().map(id => ({ student_id: id, coach_id: $(`[data-evc="${CSS.escape(id)}"]`)?.value || null })); await api('evaluations/' + state.evalId + '/participants', { method: 'POST', body: JSON.stringify({ participants }) }); toast('Saved ' + participants.length + ' students'); show('evaluations'); } catch (e) { toast(e.message); } };
      };
      $('#evnext').onclick = drawAssign; $('#evpick').addEventListener('change', e => { if (e.target.type === 'checkbox') drawAssign(); }); drawAssign();
    }

    if (tab === 'attendance') {
      V.innerHTML = d.participants.length ? `<div class="card"><h3>Evaluation attendance</h3><div class="table-wrap"><table><thead><tr><th>Student</th><th>Evaluator</th><th>Status</th></tr></thead><tbody>${d.participants.map(p => `<tr><td><b>${esc(p.first_name + ' ' + p.last_name)}</b></td><td>${esc(p.coach_name || '—')}</td><td>${statusSelect(`data-es="${esc(p.student_id)}"`, p.status)}</td></tr>`).join('')}</tbody></table></div><div class="modal-actions"><button class="btn secondary" id="eall">All present</button><button class="btn" id="esave">Save attendance</button></div></div>` : `<div class="card">${empty('📝', 'Nobody added yet', 'Add students on the “Students & evaluators” tab first.')}</div>`;
      $('#eall') && ($('#eall').onclick = () => $$('[data-es]').forEach(s => s.value = 'present'));
      $('#esave') && ($('#esave').onclick = async () => { try { await api('evaluations/' + state.evalId + '/attendance', { method: 'POST', body: JSON.stringify({ records: $$('[data-es]').map(s => ({ student_id: s.dataset.es, status: s.value })) }) }); toast('Attendance saved'); } catch (e) { toast(e.message); } });
    }

    if (tab === 'evaluate') {
      const students = await api('students');
      const pool = d.participants.length ? d.participants.map(p => ({ ...students.find(s => s.id === p.student_id), coach_id: p.coach_id })).filter(s => s.id) : students.filter(s => s.active !== 0);
      const S = state.evalForm ||= {};
      if (!pool.some(s => s.id === S.student)) S.student = (isCoach() && pool.find(s => s.coach_id === state.me.coach_id) || pool[0])?.id;
      const stu = pool.find(s => s.id === S.student);
      if (!stu) { V.innerHTML = `<div class="card">${empty('🧒', 'No students', 'Add students first.')}</div>`; return; }
      S.app ||= 'pole';
      const existing = d.reports.find(r => r.student_id === stu.id && r.apparatus === S.app);
      const from = existing?.from_level ?? levelOf(stu, S.app);
      if (!S.level || S.levelFor !== stu.id + S.app) { S.level = existing?.target_level || Math.min(5, levelOf(stu, S.app) + (levelOf(stu, S.app) < 5 ? 1 : 0)); S.levelFor = stu.id + S.app; }
      const list = skills.filter(s => s.apparatus === S.app && Number(s.level) === Number(S.level) && s.active !== 0).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name));
      const marks = new Map((existing?.target_level === S.level ? existing.results : []).map(r => [r.skill_id, r.result]));
      let outcome = existing && existing.target_level === S.level ? existing.outcome : null, outcomeTouched = !!outcome;
      const myPool = isCoach() ? pool.filter(s => s.coach_id === state.me.coach_id) : [];
      V.innerHTML = `<div class="card"><div class="form-grid"><label>Student<select id="evstu">${(myPool.length ? [['Assigned to me', myPool], ['Everyone else', pool.filter(s => !myPool.includes(s))]] : [['', pool]]).map(([g, ps]) => ps.length ? (g ? `<optgroup label="${g}">` : '') + ps.map(s => { const done = d.reports.filter(r => r.student_id === s.id).length; return `<option value="${esc(s.id)}" ${s.id === stu.id ? 'selected' : ''}>${esc(nameOf(s))}${done ? ' ✓' : ''}</option>`; }).join('') + (g ? '</optgroup>' : '') : '').join('')}</select></label>
        <label>Evaluator<select id="evcoach">${coachOpts(existing?.coach_id || stu.coach_id || (isCoach() ? state.me.coach_id : ''))}</select></label>
        <label>Apparatus<select id="evapp">${APPS.map(a => `<option value="${a}" ${a === S.app ? 'selected' : ''}>${cap(a)} (now level ${levelOf(stu, a)})</option>`).join('')}</select></label>
        <label>Level they're going for<select id="evlvl">${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${n === Number(S.level) ? 'selected' : ''}>Level ${n}</option>`).join('')}</select></label></div>
        <p class="muted section-gap-sm">${esc(nameOf(stu))} is level ${from} on ${S.app}${existing ? ' when this evaluation started' : ''}. Tap ✓ if they did the skill or ✗ if they didn't.</p>
        <div class="toolbar"><button class="btn secondary small" id="allpass">Mark all ✓</button><button class="btn secondary small" id="allclear">Clear</button><span class="muted" id="evcount"></span></div>
        <div class="eval-list">${list.length ? list.map(s => `<div class="eval-row" data-sk="${esc(s.id)}"><span>${esc(s.name)}${s.description ? `<small class="muted"> · ${esc(s.description)}</small>` : ''}</span><span class="eval-btns"><button type="button" class="eval-btn pass" data-r="pass" aria-label="Did it">✓ Did it</button><button type="button" class="eval-btn fail" data-r="fail" aria-label="Failed">✗ Failed</button></span></div>`).join('') : empty('📚', 'No skills at this level', 'Add or import ' + S.app + ' level ' + S.level + ' skills in the Skill library.')}</div>
        <div class="form-grid section-gap"><label>Result<select id="evout"><option value="passed">Passed level ${S.level}</option><option value="not_passed">Not passed yet</option></select></label><label>Notes (optional)<input id="evnotes" value="${esc(existing?.notes || '')}" placeholder="e.g. strong mount, work on balance"></label></div>
        <div class="modal-actions">${existing ? '<button class="btn secondary" id="evdel">Delete this report</button>' : ''}<button class="btn secondary" id="evsave">Save</button><button class="btn" id="evnextstu">Save & next student</button></div></div>`;
      const paint = () => {
        $$('.eval-row').forEach(r => { const v = marks.get(r.dataset.sk); r.classList.toggle('is-pass', v === 'pass'); r.classList.toggle('is-fail', v === 'fail'); });
        const p = [...marks.values()].filter(v => v === 'pass').length, f = [...marks.values()].filter(v => v === 'fail').length;
        $('#evcount').textContent = `${p} did it · ${f} failed · ${list.length - p - f} not marked`;
        if (!outcomeTouched) outcome = list.length && p === list.length ? 'passed' : 'not_passed';
        $('#evout').value = outcome;
      };
      $$('.eval-row').forEach(r => r.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { marks.get(r.dataset.sk) === b.dataset.r ? marks.delete(r.dataset.sk) : marks.set(r.dataset.sk, b.dataset.r); paint(); }));
      $('#allpass').onclick = () => { list.forEach(s => marks.set(s.id, 'pass')); paint(); };
      $('#allclear').onclick = () => { marks.clear(); outcomeTouched = false; paint(); };
      $('#evout').onchange = e => { outcome = e.target.value; outcomeTouched = true; };
      $('#evstu').onchange = e => { S.student = e.target.value; S.levelFor = null; show('evaluations'); };
      $('#evapp').onchange = e => { S.app = e.target.value; S.levelFor = null; show('evaluations'); };
      $('#evlvl').onchange = e => { S.level = Number(e.target.value); show('evaluations'); };
      paint();
      const save = async next => {
        try {
          const r = await api('evaluations/' + state.evalId + '/report', { method: 'POST', body: JSON.stringify({ student_id: stu.id, apparatus: S.app, target_level: Number(S.level), coach_id: $('#evcoach').value || null, outcome: $('#evout').value, notes: $('#evnotes').value, results: [...marks].map(([skill_id, result]) => ({ skill_id, result })) }) });
          toast(`${nameOf(stu)} · ${cap(S.app)}: ${r.change === 'Increased' ? 'level ' + r.from_level + ' → ' + r.level : 'stayed at level ' + r.level}`);
          if (next) { const i = pool.findIndex(s => s.id === stu.id); S.student = pool[(i + 1) % pool.length].id; S.levelFor = null; }
          show('evaluations');
        } catch (e) { toast(e.message); }
      };
      $('#evsave').onclick = () => save(false); $('#evnextstu').onclick = () => save(true);
      $('#evdel') && ($('#evdel').onclick = async () => { if (!confirm('Delete this report? If they passed, their level goes back to ' + from + '.')) return; await api('evaluations/' + state.evalId + '/delete-report', { method: 'POST', body: JSON.stringify({ report_id: existing.id }) }); toast('Report deleted'); show('evaluations'); });
    }

    if (tab === 'summary') {
      const byStu = new Map();
      for (const r of d.reports) { if (!byStu.has(r.student_id)) byStu.set(r.student_id, { name: r.first_name + ' ' + r.last_name, rows: [] }); byStu.get(r.student_id).rows.push(r); }
      for (const p of d.participants) if (!byStu.has(p.student_id)) byStu.set(p.student_id, { name: p.first_name + ' ' + p.last_name, rows: [], status: p.status });
      const up = [...byStu.values()].filter(s => s.rows.some(r => r.outcome === 'passed' && r.target_level > (r.from_level ?? 0))).length;
      V.innerHTML = `<div class="stats">${[['Evaluated', [...byStu.values()].filter(s => s.rows.length).length], ['Moved up a level', up], ['Stayed the same', [...byStu.values()].filter(s => s.rows.length && !s.rows.some(r => r.outcome === 'passed' && r.target_level > (r.from_level ?? 0))).length], ['Not evaluated yet', [...byStu.values()].filter(s => !s.rows.length).length]].map(x => `<div class="stat"><span>${x[0]}</span><strong>${x[1]}</strong></div>`).join('')}</div>
        <div class="card"><div class="toolbar"><button class="btn" id="tosheet">${d.event.sheet_url ? 'Update Google Sheet' : 'Save to Google Sheet'}</button><button class="btn secondary" id="tocsv">Download CSV</button><span class="muted" id="sheetmsg">${d.event.sheet_url ? 'Saved to ' + link(d.event.sheet_url, 'this sheet ↗', '') : ''}</span></div>
        ${byStu.size ? [...byStu.entries()].map(([sid, s]) => `<div class="sum-row"><b>${esc(s.name)}</b>${s.rows.length ? s.rows.map(r => { const inc = r.outcome === 'passed' && r.target_level > (r.from_level ?? 0); const p = r.results.filter(x => x.result === 'pass').length; return `<div class="sum-line"><span class="chip">${cap(r.apparatus)}</span><span>Level ${r.from_level ?? '?'} → ${inc ? r.target_level : r.from_level ?? r.current_level}</span><span class="chip ${inc ? 'ok' : ''}">${inc ? '▲ Increased' : '= Stayed the same'}</span><small class="muted">${p}/${r.results.length} skills · tried level ${r.target_level}${r.coach_name ? ' · by ' + esc(r.coach_name) : ''}${r.notes ? ' · ' + esc(r.notes) : ''}</small></div>`; }).join('') : `<div class="sum-line"><span class="chip warn">Not evaluated yet</span>${s.status ? `<small class="muted">attendance: ${esc(s.status)}</small>` : ''}</div>`}</div>`).join('') : empty('📝', 'Nothing to summarize yet', 'Evaluate students on the Evaluate tab.')}</div>`;
      $('#tosheet').onclick = async () => { const b = $('#tosheet'); b.disabled = true; b.textContent = 'Saving…'; try { const r = await api('evaluations/' + state.evalId + '/sheet', { method: 'POST', body: '{}' }); $('#sheetmsg').innerHTML = 'Saved to ' + link(r.url, 'this sheet ↗', ''); toast('Saved to Google Sheets'); window.open(r.url, '_blank', 'noopener'); } catch (e) { toast(e.message); $('#sheetmsg').textContent = e.message; } b.disabled = false; b.textContent = 'Update Google Sheet'; };
      $('#tocsv').onclick = () => csvDownload('evaluation-' + d.event.event_date + '.csv', [['Student', 'Apparatus', 'Evaluated by', 'Level before', 'Level tried', 'Result', 'Change', 'Skills passed', 'Skills failed', 'Notes'], ...d.reports.map(r => [r.first_name + ' ' + r.last_name, r.apparatus, r.coach_name || '', r.from_level ?? '', r.target_level, r.outcome === 'passed' ? 'Passed' : 'Not passed', r.outcome === 'passed' && r.target_level > (r.from_level ?? 0) ? 'Increased' : 'Stayed the same', r.results.filter(x => x.result === 'pass').length, r.results.filter(x => x.result === 'fail').length, r.notes || ''])]);
    }
  };

  /* ---------- competition scores & leaderboard ---------- */
  PAGES.competitions = async () => {
    const [events, centers] = await Promise.all([api('events'), api('centers')]);
    const comps = events.filter(e => e.event_type === 'competition').sort((a, b) => b.event_date.localeCompare(a.event_date));
    if (!comps.length) { $('#content').innerHTML = hero('Competition scores', 'Type scores and get a pole and rope leaderboard.', '<button class="btn" data-go="events">+ Add a competition</button>') + `<div class="card">${empty('🏆', 'No competitions yet', 'Add an event with the type “competition” first.')}</div>`; $$('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go)); return; }
    if (!comps.some(c => c.id === state.compId)) state.compId = comps[0].id;
    const d = await api('competitions/' + state.compId);
    const rows = new Map();
    for (const s of d.scores) { if (!rows.has(s.student_id)) rows.set(s.student_id, { id: s.student_id, name: s.first_name + ' ' + s.last_name, center_id: s.center_id }); rows.get(s.student_id)[s.apparatus] = s.score; }
    const board = app => { const list = d.scores.filter(s => s.apparatus === app).sort((a, b) => b.score - a.score); let rank = 0, prev = null; return list.length ? `<ol class="lb">${list.map((s, i) => { if (s.score !== prev) { rank = i + 1; prev = s.score; } return `<li class="${rank <= 3 ? 'top' + rank : ''}"><span class="lb-rank">${rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank}</span><span class="lb-name">${esc(s.first_name + ' ' + s.last_name)}<small class="muted"> · ${esc(centerName(centers, s.center_id))}</small></span><b>${s.score}</b></li>`; }).join('')}</ol>` : '<p class="muted">No scores yet.</p>'; };
    const draw = () => `<div class="table-wrap"><table><thead><tr><th>Student</th><th>Pole score</th><th>Rope score</th><th></th></tr></thead><tbody>${[...rows.values()].map(r => `<tr><td><b>${esc(r.name)}</b></td><td><input type="number" step="0.01" min="0" data-sc="${esc(r.id)}" data-app="pole" value="${r.pole ?? ''}" style="max-width:120px"></td><td><input type="number" step="0.01" min="0" data-sc="${esc(r.id)}" data-app="rope" value="${r.rope ?? ''}" style="max-width:120px"></td><td><button class="icon-btn" data-rmrow="${esc(r.id)}" aria-label="Remove">✕</button></td></tr>`).join('')}</tbody></table></div>`;
    const ev = d.event;
    $('#content').innerHTML = hero('Competition scores', 'Type each kid\'s score and the leaderboards sort themselves.') +
      `<div class="toolbar"><select id="cpsel" style="max-width:420px">${comps.map(e => `<option value="${esc(e.id)}" ${e.id === state.compId ? 'selected' : ''}>${esc(e.title)} · ${esc(fmtShort(e.event_date))}</option>`).join('')}</select></div>
      <div class="two-col"><div class="card"><h3>🏆 Pole leaderboard</h3>${board('pole')}</div><div class="card"><h3>🏆 Rope leaderboard</h3>${board('rope')}</div></div>
      <div class="card section-gap"><h3>Enter scores · ${esc(ev.title)}</h3><p class="muted">Leave a box empty if they didn't compete on that apparatus.</p><div id="cprows">${rows.size ? draw() : '<p class="muted">Add the kids who competed.</p>'}</div><div class="modal-actions"><button class="btn secondary" id="cpadd">+ Add kids</button><button class="btn" id="cpsave">Save scores</button></div></div>`;
    $('#cpsel').onchange = e => go('competitions', { compId: e.target.value });
    const removed = new Set();
    const wire = () => $$('[data-rmrow]').forEach(b => b.onclick = () => { removed.add(b.dataset.rmrow); rows.delete(b.dataset.rmrow); $('#cprows').innerHTML = draw(); wire(); });
    wire();
    $('#cpadd').onclick = async () => {
      const m = openModal('Add kids who competed', '<div id="cppick"></div><div class="modal-actions"><button class="btn" id="cpok">Add</button></div>', { wide: true });
      const picker = await studentPicker(m.$('#cppick'), [...rows.keys()]);
      m.$('#cpok').onclick = () => {
        // keep typed values before redrawing
        $$('[data-sc]').forEach(i => { const r = rows.get(i.dataset.sc); if (r) r[i.dataset.app] = i.value === '' ? undefined : Number(i.value); });
        for (const id of picker.ids()) if (!rows.has(id)) { const s = picker.students.find(x => x.id === id); rows.set(id, { id, name: nameOf(s), center_id: s.center_id }); removed.delete(id); }
        $('#cprows').innerHTML = draw(); wire(); m.close();
      };
    };
    $('#cpsave').onclick = async () => {
      const scores = $$('[data-sc]').map(i => ({ student_id: i.dataset.sc, apparatus: i.dataset.app, score: i.value }));
      for (const id of removed) scores.push({ student_id: id, apparatus: 'pole', score: null }, { student_id: id, apparatus: 'rope', score: null });
      try { await api('competitions/' + state.compId + '/scores', { method: 'POST', body: JSON.stringify({ scores }) }); toast('Scores saved'); show('competitions'); } catch (e) { toast(e.message); }
    };
  };

  /* ---------- events page: shortcuts into evaluations and scores ---------- */
  const _events = PAGES.events;
  PAGES.events = async () => {
    await _events();
    $$('.event-card').forEach(card => {
      const id = card.querySelector('[data-edit]')?.dataset.edit, actions = card.querySelector('.card-actions'); if (!id || !actions) return;
      if (card.querySelector('.type-evaluation')) actions.insertAdjacentHTML('afterbegin', `<button class="btn small" data-evgo="${esc(id)}">Run evaluation</button>`);
      if (card.querySelector('.type-competition')) actions.insertAdjacentHTML('afterbegin', `<button class="btn small" data-cpgo="${esc(id)}">Scores & leaderboard</button>`);
    });
    $$('[data-evgo]').forEach(b => b.onclick = () => go('evaluations', { evalId: b.dataset.evgo }));
    $$('[data-cpgo]').forEach(b => b.onclick = () => go('competitions', { compId: b.dataset.cpgo }));
  };

  /* ---------- fitness: whole batch at once ---------- */
  PAGES.fitness = async () => {
    const batches = await api('batches');
    const F = state.fit ||= { batch: batches[0]?.id || '', date: todayStr() };
    $('#content').innerHTML = hero('Fitness', 'Record dasrang per minute, push-ups, sit-ups, squats, holds and more for a whole batch. Parents see each kid\'s progress.', '<button class="btn secondary" id="addmetric">+ Add a test</button>') +
      `<div class="card"><div class="form-grid"><label>Batch<select id="fbatch">${batches.map(b => `<option value="${esc(b.id)}" ${b.id === F.batch ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label><label>Date<input type="date" id="fdate" value="${esc(F.date)}"></label></div><div id="fgrid" class="section-gap"></div><div class="modal-actions"><button class="btn" id="fsave">Save fitness</button></div></div>`;
    const load = async () => {
      if (!F.batch) { $('#fgrid').innerHTML = empty('🏋️', 'No batches', 'Add a batch first.'); return; }
      const rows = await api('fitness-batch?batch_id=' + encodeURIComponent(F.batch) + '&date=' + F.date);
      const ms = allMetrics();
      $('#fgrid').innerHTML = rows.length ? `<div class="table-wrap"><table class="fit-table"><thead><tr><th>Student</th>${ms.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr><td><b>${esc(r.first_name + ' ' + r.last_name)}</b></td>${ms.map(([k]) => `<td><input type="number" min="0" step="any" data-fs="${esc(r.id)}" data-fm="${esc(k)}" value="${r.values[k] ?? ''}" placeholder="${r.previous[k] != null ? 'last ' + r.previous[k] : ''}"></td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="muted section-gap-sm">Grey numbers are their last result. Leave a box empty to skip it.</p>` : empty('🧒', 'Nobody on this batch', 'Add students to the batch roster first.');
    };
    $('#fbatch').onchange = e => { F.batch = e.target.value; load(); };
    $('#fdate').onchange = e => { F.date = e.target.value; load(); };
    $('#addmetric').onclick = () => { const name = prompt('Name of the test (e.g. "Pole climb (sec)")'); if (!name) return; const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40); if (!key) return; try { const c = customMetrics(); c.push([key, name]); localStorage.setItem('mfu-metrics', JSON.stringify(c)); } catch { /* ignore */ } load(); };
    $('#fsave').onclick = async () => {
      const by = new Map(); $$('[data-fs]').forEach(i => { if (!by.has(i.dataset.fs)) by.set(i.dataset.fs, {}); by.get(i.dataset.fs)[i.dataset.fm] = i.value; });
      try { const r = await api('fitness-batch', { method: 'POST', body: JSON.stringify({ batch_id: F.batch, record_date: F.date, rows: [...by].map(([student_id, values]) => ({ student_id, values })) }) }); toast('Fitness saved'); load(); } catch (e) { toast(e.message); }
    };
    load();
  };

  /* ---------- one student: notes, fitness, photos ---------- */
  const fitnessSummary = rows => {
    const by = new Map(); for (const r of rows) { if (!by.has(r.metric)) by.set(r.metric, []); by.get(r.metric).push(r); }
    return [...by].map(([k, list]) => { list.sort((a, b) => a.record_date.localeCompare(b.record_date)); const last = list[list.length - 1], firstV = list[0].value, diff = last.value - firstV; return { metric: k, last, count: list.length, diff, history: list }; });
  };
  const fitnessTiles = rows => { const s = fitnessSummary(rows); return s.length ? `<div class="fit-tiles">${s.map(x => `<div class="fit-tile"><small>${esc(metricLabel(x.metric))}</small><b>${x.last.value}</b><span class="muted">${esc(fmtShort(x.last.record_date))}${x.count > 1 ? ` · <span class="${x.diff >= 0 ? 'up' : 'down'}">${x.diff >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(x.diff * 100) / 100)}</span> since ${esc(fmtShort(x.history[0].record_date))}` : ''}</span></div>`).join('')}</div>` : ''; };
  const photoGrid = (photos, del) => photos.length ? `<div class="photo-grid">${photos.map(p => `<figure><a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener noreferrer"><img src="${esc(safeUrl(p.url))}" alt="${esc(p.caption || 'Progress photo')}" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'photo-link',textContent:'Open photo ↗'}))"></a><figcaption>${esc(p.caption || '')}${p.taken_date ? `<small class="muted"> · ${esc(fmtShort(p.taken_date))}</small>` : ''}${del ? ` <button class="icon-btn" data-phdel="${esc(p.id)}" aria-label="Delete photo">✕</button>` : ''}</figcaption></figure>`).join('')}</div>` : '';
  const noteList = (notes, del) => notes.map(n => `<div class="note"><div class="note-head"><b>${esc(n.author_name || 'Coach')}</b><small class="muted">${esc(fmtStamp(n.created_at))}${n.batch ? ' · ' + esc(n.batch) : ''}</small>${del && (!isCoach() || n.coach_id === state.me?.coach_id) ? `<button class="icon-btn" data-ndel="${esc(n.id)}" aria-label="Delete note">✕</button>` : ''}</div>${n.worked_on ? `<p><span class="chip">This batch</span> ${esc(n.worked_on)}</p>` : ''}${n.next_steps ? `<p><span class="chip ok">Next time</span> ${esc(n.next_steps)}</p>` : ''}</div>`).join('');

  // In a popup with its own tabs, or (with host) one view drawn straight into the student profile page.
  window.studentProfileModal = async (student, host, tab = 'notes') => {
    if (!student) return;
    const m = host ? hostView(host, '<div id="spview"><p class="muted">Loading…</p></div>') : openModal(nameOf(student), '<div class="seg" id="sptabs"><button type="button" data-t="notes" class="active">Notes</button><button type="button" data-t="fitness">Fitness</button><button type="button" data-t="photos">Photos</button></div><div id="spview"></div>', { wide: true });
    const batches = await api('batches');
    const views = {
      notes: async () => {
        const notes = await api('student-notes?student_id=' + encodeURIComponent(student.id));
        m.$('#spview').innerHTML = `<p class="muted">Every coach and the parent can read these, so the next coach knows exactly where to pick up.</p><form id="nf" class="card soft-card"><div class="form-grid"><label class="wide">Batch<select name="batch_id"><option value="">—</option>${batches.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select></label><label class="wide">What they worked on this batch<textarea name="worked_on" rows="2" placeholder="e.g. Pole: worked on dive, got the entry clean"></textarea></label><label class="wide">What to do next batch<textarea name="next_steps" rows="2" placeholder="e.g. Start dive with turn; hold the 3-inch for 20 sec"></textarea></label></div><div class="modal-actions"><button class="btn">Add note</button></div></form><div class="section-gap">${noteList(notes, true) || '<p class="muted">No notes yet.</p>'}</div>`;
        m.$('#nf').onsubmit = async e => { e.preventDefault(); try { await api('student-notes', { method: 'POST', body: JSON.stringify({ student_id: student.id, ...Object.fromEntries(new FormData(e.target)) }) }); toast('Note added'); views.notes(); } catch (err) { toast(err.message); } };
        m.$$('[data-ndel]').forEach(b => b.onclick = async () => { if (confirm('Delete this note?')) { try { await api('student-notes/' + b.dataset.ndel, { method: 'DELETE' }); views.notes(); } catch (e) { toast(e.message); } } });
      },
      fitness: async () => {
        const [rows, sets] = await Promise.all([api('fitness?student_id=' + encodeURIComponent(student.id)), api('rep-sessions?student_id=' + encodeURIComponent(student.id))]);
        const dates = [...new Set(rows.map(r => r.record_date))];
        m.$('#spview').innerHTML = fitnessTiles(rows) + (sets.length ? `<h4>Timed sets</h4>${sessionsBlock(sets, true)}` : '') + `<form id="ff" class="card soft-card section-gap"><h4>Add a result</h4><div class="form-grid"><label>Date<input type="date" name="record_date" value="${todayStr()}" required></label><label>Batch<select name="batch_id"><option value="">—</option>${batches.map(b => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select></label>${allMetrics().map(([k, l]) => `<label>${esc(l)}<input type="number" min="0" step="any" name="m_${esc(k)}"></label>`).join('')}</div><div class="modal-actions"><button class="btn">Save</button></div></form>` +
          (dates.length ? `<div class="table-wrap section-gap"><table><thead><tr><th>Date</th>${[...new Set(rows.map(r => r.metric))].map(k => `<th>${esc(metricLabel(k))}</th>`).join('')}</tr></thead><tbody>${dates.map(dt => `<tr><td>${esc(fmtShort(dt))}</td>${[...new Set(rows.map(r => r.metric))].map(k => `<td>${rows.find(r => r.record_date === dt && r.metric === k)?.value ?? '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="muted section-gap">No fitness results yet.</p>');
        m.$$('[data-rsdel]').forEach(b => b.onclick = async () => { if (confirm('Delete this timed set?')) { await api('rep-sessions/' + b.dataset.rsdel, { method: 'DELETE' }); views.fitness(); } });
        m.$('#ff').onsubmit = async e => { e.preventDefault(); const fd = Object.fromEntries(new FormData(e.target)); const values = {}; for (const [k, v] of Object.entries(fd)) if (k.startsWith('m_') && v !== '') values[k.slice(2)] = v; if (!Object.keys(values).length) return toast('Enter at least one number'); try { await api('fitness', { method: 'POST', body: JSON.stringify({ student_id: student.id, record_date: fd.record_date, batch_id: fd.batch_id, values }) }); toast('Saved'); views.fitness(); } catch (err) { toast(err.message); } };
      },
      photos: async () => {
        const photos = await api('student-photos?student_id=' + encodeURIComponent(student.id));
        m.$('#spview').innerHTML = `<p class="muted">Paste a link to a photo or video (Google Photos, Google Drive, YouTube…). Make sure the link is shared so parents can open it.</p><form id="phf" class="card soft-card"><div class="form-grid"><label class="wide">Photo or video link<input type="url" name="url" required placeholder="https://"></label><label>Caption<input name="caption" placeholder="e.g. First full dive!"></label><label>Date<input type="date" name="taken_date" value="${todayStr()}"></label></div><div class="modal-actions"><button class="btn">Add photo</button></div></form><div class="section-gap">${photoGrid(photos, true) || '<p class="muted">No photos yet.</p>'}</div>`;
        m.$('#phf').onsubmit = async e => { e.preventDefault(); try { await api('student-photos', { method: 'POST', body: JSON.stringify({ student_id: student.id, ...Object.fromEntries(new FormData(e.target)) }) }); toast('Photo added'); views.photos(); } catch (err) { toast(err.message); } };
        m.$$('[data-phdel]').forEach(b => b.onclick = async () => { if (confirm('Remove this photo?')) { await api('student-photos/' + b.dataset.phdel, { method: 'DELETE' }); views.photos(); } });
      }
    };
    m.$$('#sptabs button').forEach(b => b.onclick = () => { m.$$('#sptabs button').forEach(x => x.classList.toggle('active', x === b)); views[b.dataset.t](); });
    views[tab]();
  };

  /* ---------- the student profile page (click a name on the Students page) ---------- */
  const STABS = [['overview', 'Overview'], ['skills', 'Skills'], ['attendance', 'Attendance'], ['notes', 'Notes'], ['fitness', 'Fitness'], ['photos', 'Photos']];
  PAGES.student = async () => {
    if (!state.studentId) return show('students');
    const c = await api('student-summary?student_id=' + encodeURIComponent(state.studentId));
    const tab = STABS.some(t => t[0] === state.studentTab) ? state.studentTab : 'overview';
    $('#title').textContent = nameOf(c);
    $('#content').innerHTML = `<div class="profile-head card"><div class="avatar">${c.photo_url ? `<img src="${esc(safeUrl(c.photo_url))}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<span>${esc((c.first_name[0] || '') + (c.last_name[0] || ''))}</span></div><div class="profile-main"><h2>${esc(nameOf(c))}</h2><p class="muted">${esc(c.center_id ? cap(c.center_id) : '')}${c.parent_name || c.parent_email ? ' · Parent: ' + esc(c.parent_name || '') + (c.parent_email ? ` <a href="mailto:${esc(c.parent_email)}">${esc(c.parent_email)}</a>` : '') : ''}${c.parent_phone ? ' · ' + esc(c.parent_phone) : ''}</p><div class="chips">${APPS.map(a => `<span class="chip lvl-chip">${cap(a)} · Level ${c[a + '_level']}</span>`).join('')}${c.parents?.length ? c.parents.map(p => `<span class="chip ${p.has_password ? 'ok' : 'warn'}">Portal: ${esc(p.name || p.email)}${p.has_password ? '' : ' (invite pending)'}</span>`).join('') : '<span class="chip warn">No parent account</span>'}</div></div><div class="profile-actions"><button class="btn secondary small" id="sp-back">← Students</button><button class="btn small" id="sp-edit">Edit details</button></div></div>
      <div class="seg profile-tabs" id="stabs" role="tablist">${STABS.map(([k, l]) => `<button type="button" role="tab" data-st="${k}" class="${k === tab ? 'active' : ''}" aria-selected="${k === tab}">${l}</button>`).join('')}</div><div id="sview" class="card"></div>`;
    $('#sp-back').onclick = () => show('students');
    $('#sp-edit').onclick = async () => {
      state.afterSave = 'student'; // saving returns to this profile instead of the student list
      await formModal(configs.students, await api('students/' + c.id), 'students');
      const root = document.body.lastElementChild;
      new MutationObserver((_, o) => { if (!document.contains(root)) { o.disconnect(); setTimeout(() => { state.afterSave = null; }, 0); } }).observe(document.body, { childList: true });
    };
    const host = $('#sview');
    const draw = async t => {
      state.studentTab = t;
      $$('#stabs button').forEach(b => { b.classList.toggle('active', b.dataset.st === t); b.setAttribute('aria-selected', String(b.dataset.st === t)); });
      if (t === 'overview') host.innerHTML = `<p class="muted">This is what ${esc(c.first_name)}'s parents see in their portal.</p>` + childCard(c).replace(/^<section class="card child">/, '<section class="child child-embed">');
      if (t === 'skills') await progressModal(c, host);
      if (t === 'attendance') await studentAttendanceModal(c, host);
      if (['notes', 'fitness', 'photos'].includes(t)) await studentProfileModal(c, host, t);
    };
    $$('#stabs button').forEach(b => b.onclick = () => draw(b.dataset.st));
    await draw(tab);
  };
  window.openStudent = id => { state.studentId = id; state.studentTab = 'overview'; show('student'); };

  /* ---------- parent requests (admin & coach) ---------- */
  PAGES.requests = async () => {
    const reqs = await api('requests');
    const F = state.reqFilter ||= isCoach() ? 'mine' : 'open';
    const list = reqs.filter(r => F === 'all' || (F === 'open' && r.status === 'open') || (F === 'mine' && r.mine && r.status === 'open'));
    $('#content').innerHTML = hero('Parent requests', 'Meeting requests and questions from parents. They go to the admin and every coach of that child\'s batches.') +
      `<div class="seg att-modes" id="rqf">${(isCoach() ? [['mine', 'My students'], ['open', 'All open'], ['all', 'Everything']] : [['open', 'Open'], ['all', 'Everything']]).map(([k, l]) => `<button type="button" data-f="${k}" class="${F === k ? 'active' : ''}">${l}</button>`).join('')}</div>` +
      (list.length ? list.map(r => `<article class="card req ${r.status}"><div class="chips"><span class="chip ${r.kind === 'meeting' ? 'type-competition' : 'type-evaluation'}">${r.kind === 'meeting' ? 'Meeting request' : 'Question'}</span><span class="chip ${r.status === 'open' ? 'warn' : 'ok'}">${esc(cap(r.status))}</span><span class="chip">${esc((r.first_name || '') + ' ' + (r.last_name || ''))}</span><small class="muted">${esc(fmtStamp(r.created_at))}</small></div><h3>${esc(r.subject)}</h3><p class="muted">From ${esc(r.parent_name || '')} · ${esc(r.parent_email)}</p>${r.message ? `<p class="event-details">${esc(r.message)}</p>` : ''}${r.preferred_times ? `<p><b>Times that work:</b> ${esc(r.preferred_times)}</p>` : ''}${r.reply ? `<div class="note"><div class="note-head"><b>Reply from ${esc(r.replied_by || '')}</b><small class="muted">${esc(fmtStamp(r.replied_at))}</small></div><p>${esc(r.reply)}</p></div>` : ''}<div class="card-actions"><button class="btn small" data-reply="${esc(r.id)}">Reply</button>${r.kind === 'meeting' && r.status !== 'scheduled' ? `<button class="btn blue small" data-sched="${esc(r.id)}">Schedule meeting</button>` : ''}${r.status !== 'closed' ? `<button class="btn secondary small" data-close-r="${esc(r.id)}">Mark done</button>` : `<button class="btn secondary small" data-open-r="${esc(r.id)}">Reopen</button>`}</div></article>`).join('') : `<div class="card">${empty('📬', 'Nothing here', F === 'all' ? 'Parents haven\'t sent anything yet.' : 'No open requests right now.')}</div>`);
    $$('#rqf button').forEach(b => b.onclick = () => go('requests', { reqFilter: b.dataset.f }));
    $$('[data-reply]').forEach(b => b.onclick = () => {
      const r = reqs.find(x => x.id === b.dataset.reply);
      const m = openModal('Reply to ' + (r.parent_name || r.parent_email), `<p class="muted">${esc(r.subject)}</p><form id="rf"><label class="wide">Your reply<textarea name="reply" rows="6" required>${esc(r.reply || '')}</textarea></label><div class="form-grid section-gap-sm"><label>Then mark it<select name="status"><option value="answered">Answered</option><option value="closed">Done</option><option value="open">Still open</option></select></label></div><div class="modal-actions"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn">Send reply</button></div></form>`, { wide: true });
      m.$('#rf').onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); try { const x = await api('requests/' + r.id + '/reply', { method: 'POST', body: JSON.stringify(f) }); toast(x.emailed ? 'Reply emailed to the parent' : 'Reply saved (the parent sees it in their portal)'); m.close(); show('requests'); } catch (err) { toast(err.message); } };
    });
    $$('[data-sched]').forEach(b => b.onclick = async () => {
      const r = reqs.find(x => x.id === b.dataset.sched), c = await api('meeting-contacts');
      const coachIds = new Set(c.batches.filter(x => x.student_ids.includes(r.student_id)).flatMap(x => x.coach_ids));
      meetingModal({ request_id: r.id, title: 'Meeting: ' + (r.first_name || '') + ' ' + (r.last_name || '') + ' · ' + r.subject, description: r.message + (r.preferred_times ? '\n\nParent suggested: ' + r.preferred_times : ''), attendees: [r.parent_email, ...c.coaches.filter(x => coachIds.has(x.id)).map(x => x.email), ...(isCoach() ? [state.me.email] : [])].filter(Boolean) });
    });
    $$('[data-close-r],[data-open-r]').forEach(b => b.onclick = async () => { try { await api('requests/' + (b.dataset.closeR || b.dataset.openR), { method: 'PUT', body: JSON.stringify({ status: b.dataset.closeR ? 'closed' : 'open' }) }); show('requests'); } catch (e) { toast(e.message); } });
  };

  /* ---------- announcements ---------- */
  const annCard = a => `<div class="note ${a.pinned ? 'pinned' : ''}"><div class="note-head"><b>${a.pinned ? '📌 ' : ''}${esc(a.title)}</b><small class="muted">${esc(fmtStamp(a.created_at))}${a.created_by ? ' · ' + esc(a.created_by) : ''}</small></div>${a.body ? `<p style="white-space:pre-line">${esc(a.body)}</p>` : ''}</div>`;
  PAGES.announcements = async () => {
    const [items, centers] = await Promise.all([api('announcements'), api('centers')]);
    const aud = { all: 'Parents & coaches', parents: 'Parents only', coaches: 'Coaches only' };
    $('#content').innerHTML = hero('Announcements', 'Post news for parents, coaches or both. You can also email it.', '<button class="btn" id="add-ann">+ New announcement</button>') +
      (items.length ? items.map(a => `<article class="card ann"><div class="chips"><span class="chip">${aud[a.audience]}</span><span class="chip">${esc(centerName(centers, a.center_id))}</span>${a.pinned ? '<span class="chip warn">📌 Pinned</span>' : ''}<small class="muted">${esc(fmtStamp(a.created_at))}${a.created_by ? ' · ' + esc(a.created_by) : ''}</small></div><h3>${esc(a.title)}</h3>${a.body ? `<p style="white-space:pre-line">${esc(a.body)}</p>` : ''}<div class="card-actions"><button class="btn secondary small" data-aedit="${esc(a.id)}">Edit</button><button class="btn secondary small" data-adel="${esc(a.id)}">Delete</button></div></article>`).join('') : `<div class="card">${empty('📣', 'No announcements yet', 'Post the first one for parents and coaches.')}</div>`);
    const form = a => {
      const m = openModal(a ? 'Edit announcement' : 'New announcement', `<form id="af"><div class="form-grid"><label class="wide">Title<input name="title" required maxlength="200" value="${esc(a?.title || '')}"></label><label class="wide">Message<textarea name="body" rows="6">${esc(a?.body || '')}</textarea></label><label>Who sees it<select name="audience">${Object.entries(aud).map(([k, l]) => `<option value="${k}" ${a?.audience === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label><label>Center<select name="center_id"><option value="">All centers</option>${centers.map(c => `<option value="${esc(c.id)}" ${a?.center_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label><label class="check"><input type="checkbox" name="pinned" ${a?.pinned ? 'checked' : ''}> Pin to the top</label><label class="check"><input type="checkbox" name="send_email"> Also email it to them</label></div><div class="modal-actions"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn">${a ? 'Save' : 'Post'}</button></div></form>`, { wide: true });
      m.$('#af').onsubmit = async e => { e.preventDefault(); const f = new FormData(e.target); const body = { title: f.get('title'), body: f.get('body'), audience: f.get('audience'), center_id: f.get('center_id'), pinned: !!f.get('pinned'), send_email: !!f.get('send_email') }; try { const r = await api('announcements' + (a ? '/' + a.id : ''), { method: a ? 'PUT' : 'POST', body: JSON.stringify(body) }); toast(body.send_email ? 'Posted · ' + r.emailed + ' emails sent' : 'Posted'); m.close(); show('announcements'); } catch (err) { toast(err.message); } };
    };
    $('#add-ann').onclick = () => form(null);
    $$('[data-aedit]').forEach(b => b.onclick = () => form(items.find(x => x.id === b.dataset.aedit)));
    $$('[data-adel]').forEach(b => b.onclick = async () => { if (confirm('Delete this announcement?')) { await api('announcements/' + b.dataset.adel, { method: 'DELETE' }); show('announcements'); } });
  };

  /* ---------- skill assistant: plain language → skill progress ---------- */
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const lev = (a, b) => { if (Math.abs(a.length - b.length) > 2) return 9; const d = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i++) { let p = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; } } return d[b.length]; };
  const wordHit = (w, words) => words.some(x => x === w || (w.length >= 5 && lev(w, x) <= 1) || (w.length >= 8 && lev(w, x) <= 2));
  const STOP = new Set(['the', 'and', 'with', 'on', 'of', 'to', 'a', 'in', 'is', 'for', 'from', 'at', 'up', 'down']);
  const STATUS_WORDS = [
    ['mastered', /\b(mastered|master(s|ed)? it|got it|nailed|passed|can (now )?do|completed|finished|has it|perfect(ed)?|clean(ed)?|landed|done)\b/],
    ['not_started', /\b(not started|hasn ?t started|reset|remove|stop(ped)?|not working on)\b/],
    ['learning', /\b(working on|learning|practi[cs]ing|started|starting|trying|attempt(ing|ed)?|drilling|began|begun|introduced|is on)\b/]
  ];
  function parsePlain(text, students, skills) {
    const out = [], notes = [];
    const clauses = String(text).split(/[\n.;!?]+|\bthen\b|\balso\b/i).map(s => s.trim()).filter(Boolean);
    let lastStudents = [], lastStatus = 'learning';
    const stuIndex = students.filter(s => s.active !== 0).map(s => ({ s, first: norm(s.first_name), last: norm(s.last_name), full: norm(nameOf(s)) }));
    for (const clause of clauses) {
      const n = ' ' + norm(clause) + ' ', words = n.trim().split(' ');
      // students: full names first, then unique first names
      let found = stuIndex.filter(x => x.full && n.includes(' ' + x.full + ' '));
      const used = new Set(found.flatMap(x => x.full.split(' ')));
      for (const w of words) {
        if (used.has(w) || w.length < 2) continue;
        const byFirst = stuIndex.filter(x => x.first === w && !found.includes(x));
        if (byFirst.length === 1) { found.push(byFirst[0]); used.add(w); }
        else if (byFirst.length > 1) notes.push(`More than one student is called “${cap(w)}” (${byFirst.map(x => nameOf(x.s)).join(', ')}). Add the last name.`);
      }
      const who = found.length ? found.map(x => x.s) : lastStudents;
      if (found.length) lastStudents = who;
      const status = (STATUS_WORDS.find(([, re]) => re.test(n)) || [found.length ? 'learning' : lastStatus])[0];
      lastStatus = status;
      const apps = APPS.filter(a => new RegExp('\\b' + a + '\\b').test(n));
      const lvl = /\b(?:level|lvl|l)\s*([1-5])\b/.exec(n)?.[1];
      let pool = skills.filter(s => s.active !== 0 && (!apps.length || apps.includes(s.apparatus)) && (!lvl || Number(s.level) === Number(lvl)));
      let hits = [];
      if (/\b(all|every|whole)\b/.test(n) && lvl && apps.length) hits = pool;
      else {
        const nameWords = new Set(stuIndex.filter(x => who.includes(x.s)).flatMap(x => x.full.split(' ')));
        const cw = words.filter(w => !STOP.has(w) && !nameWords.has(w));
        for (const sk of pool) {
          const sn = norm(sk.name), sw = sn.split(' ').filter(w => !STOP.has(w) && w.length > 1);
          if (!sw.length) continue;
          if (n.includes(' ' + sn + ' ')) { hits.push({ sk, score: 100 + sn.length }); continue; }
          const got = sw.filter(w => wordHit(w, cw)).length;
          if (got === sw.length || (sw.length >= 3 && got / sw.length >= 0.75)) hits.push({ sk, score: got * 10 + sn.length });
        }
        hits.sort((a, b) => b.score - a.score);
        // drop a match whose name is inside a longer match ("dive" inside "dive with turn")
        hits = hits.filter((h, i) => !hits.some((o, j) => j < i && norm(o.sk.name).includes(norm(h.sk.name)) && o.sk.apparatus === h.sk.apparatus)).map(h => h.sk);
      }
      if (!who.length && hits.length) notes.push(`I found skills in “${clause}” but no student name.`);
      if (who.length && !hits.length && !/^(and|but|ok|thanks?)$/i.test(clause)) {
        const sugg = pool.map(sk => ({ sk, d: Math.min(...norm(sk.name).split(' ').map(w => Math.min(...words.map(x => lev(w, x))))) })).sort((a, b) => a.d - b.d).slice(0, 3).map(x => x.sk.name);
        if (words.length > 1) notes.push(`I couldn't match a skill in “${clause}”.${sugg.length ? ' Did you mean ' + sugg.map(s => '“' + s + '”').join(', ') + '?' : ''}`);
      }
      for (const s of who) for (const sk of hits) if (!out.some(o => o.student.id === s.id && o.skill.id === sk.id)) out.push({ student: s, skill: sk, status });
    }
    return { changes: out, notes: [...new Set(notes)] };
  }
  PAGES.assistant = async () => {
    const [students, skills] = await Promise.all([api('students'), api('skills')]);
    const log = state.chat ||= [{ me: false, html: `Hi! Tell me what your students are working on in plain language and I'll add it to their skill progress. For example:<br><i>“Riya is working on pole level 3 dive and rope mount. Aarav mastered the pole headstand.”</i><br><i>“Maya and Kabir passed all of rope level 2.”</i>` }];
    $('#content').innerHTML = hero('Skill assistant', 'Type what kids are doing — the assistant finds the students and skills and updates their progress after you check it.') +
      `<div class="card chat"><div class="chat-log" id="clog"></div><form id="cform" class="chat-form"><textarea id="cin" rows="2" placeholder="e.g. Riya and Dev are working on pole level 2 grip hold and mount" required></textarea><button class="btn">Send</button></form><p class="muted section-gap-sm">I understand: <b>working on / learning / started</b> → Learning · <b>mastered / got it / passed / can do</b> → Mastered · <b>not started / reset</b> → Not started. Say “pole”, “rope” or “yoga” and “level 3” to narrow it down.</p></div>`;
    const draw = () => { $('#clog').innerHTML = log.map((m, i) => `<div class="bubble ${m.me ? 'me' : ''}" data-i="${i}">${m.html}</div>`).join(''); $('#clog').scrollTop = 1e6; wire(); };
    const wire = () => $$('[data-apply]').forEach(b => b.onclick = async () => {
      const card = b.closest('.bubble'), pend = state.chatPending?.[b.dataset.apply]; if (!pend) return;
      const chosen = [...card.querySelectorAll('[data-ci]:checked')].map(i => pend[+i.dataset.ci]);
      if (!chosen.length) return toast('Nothing selected');
      b.disabled = true;
      try {
        const by = new Map(); chosen.forEach(c => { if (!by.has(c.student.id)) by.set(c.student.id, []); by.get(c.student.id).push(c); });
        for (const [sid, list] of by) {
          const prog = new Map((await api('student-progress?student_id=' + encodeURIComponent(sid))).map(p => [p.skill_id, p]));
          await api('student-progress', { method: 'POST', body: JSON.stringify({ student_id: sid, changes: list.map(c => ({ skill_id: c.skill.id, status: c.status, started_date: prog.get(c.skill.id)?.started_date || null, mastered_date: c.status === 'mastered' ? (prog.get(c.skill.id)?.mastered_date || null) : null })) }) });
        }
        delete state.chatPending[b.dataset.apply];
        card.querySelector('.chat-actions').innerHTML = `<span class="chip ok">✓ Saved ${chosen.length} update${chosen.length === 1 ? '' : 's'}</span>`;
        log[+card.dataset.i].html = card.innerHTML;
        toast('Skill progress updated');
      } catch (e) { toast(e.message); b.disabled = false; }
    });
    $('#cform').onsubmit = e => {
      e.preventDefault(); const text = $('#cin').value.trim(); if (!text) return;
      log.push({ me: true, html: esc(text) });
      const { changes, notes } = parsePlain(text, students, skills);
      const key = String(Date.now()); (state.chatPending ||= {})[key] = changes;
      const SL = { learning: 'Learning', mastered: 'Mastered', not_started: 'Not started' };
      log.push({ me: false, html: (changes.length ? `Here's what I'll update — untick anything that's wrong:<div class="chat-changes">${changes.map((c, i) => `<label class="pick"><input type="checkbox" data-ci="${i}" checked><span><b>${esc(nameOf(c.student))}</b><small>${cap(c.skill.apparatus)} L${c.skill.level} · ${esc(c.skill.name)} → <span class="chip s-${c.status}">${SL[c.status]}</span></small></span></label>`).join('')}</div><div class="chat-actions"><button class="btn small" data-apply="${key}">Save these</button></div>` : 'I couldn\'t find any student + skill pairs in that.') + (notes.length ? `<ul class="chat-notes">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : '') });
      $('#cin').value = ''; draw();
    };
    $('#cin').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#cform').requestSubmit(); } };
    draw();
  };
  window.MFU_parsePlain = parsePlain;

  /* ---------- coaches: each coach can work at several centers ---------- */
  PAGES.coaches = async () => {
    const [coaches, centers, links] = await Promise.all([api('coaches'), api('centers'), api('coach-centers-all')]);
    const canEdit = !isCoach();
    const mine = id => links.filter(l => l.coach_id === id).map(l => l.center_id);
    $('#content').innerHTML = hero('Coaches', 'Coaches can work at more than one center. Tick every center they coach at.', canEdit ? '<button class="btn secondary" data-go="centers">Manage centers</button><button class="btn" id="add-coach">+ Add coach</button>' : '') +
      `<div class="toolbar"><input id="cofilter" placeholder="Search coaches..."><select id="cocenter" style="max-width:220px"><option value="">All centers</option>${centers.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></div><div id="corows"></div>`;
    const draw = () => {
      const q = $('#cofilter').value.toLowerCase(), cf = $('#cocenter').value;
      const rows = coaches.filter(c => (!cf || mine(c.id).includes(cf)) && [c.name, c.email, c.phone].join(' ').toLowerCase().includes(q));
      $('#corows').innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Coach</th><th>Centers</th><th>Email</th><th>Phone</th>${canEdit ? '<th>Actions</th>' : ''}</tr></thead><tbody>${rows.map(c => `<tr><td><b>${esc(c.name)}</b>${c.active === 0 ? ' <span class="chip">Inactive</span>' : ''}</td><td><div class="chips">${mine(c.id).map(id => `<span class="chip">${esc(centerName(centers, id))}</span>`).join('') || '<span class="chip warn">No center</span>'}</div></td><td>${esc(c.email || '—')}</td><td>${esc(c.phone || '—')}</td>${canEdit ? `<td class="actions"><button class="btn secondary small" data-coedit="${esc(c.id)}">Edit</button><button class="btn secondary small" data-codel="${esc(c.id)}">Delete</button></td>` : ''}</tr>`).join('')}</tbody></table></div>` : empty('🧑‍🏫', 'No coaches found', 'Add a coach or change your search.');
      $$('[data-coedit]').forEach(b => b.onclick = () => coachForm(coaches.find(c => c.id === b.dataset.coedit)));
      $$('[data-codel]').forEach(b => b.onclick = async () => { if (confirm('Delete this coach?')) { try { await api('coaches/' + b.dataset.codel, { method: 'DELETE' }); toast('Deleted'); show('coaches'); } catch (e) { toast(e.message); } } });
    };
    const coachForm = c => {
      const sel = new Set(c ? mine(c.id) : []);
      const m = openModal(c ? 'Edit coach' : 'Add coach', `<form id="cof"><div class="form-grid"><label>Name<input name="name" required value="${esc(c?.name || '')}"></label><label>Email (used for their login)<input type="email" name="email" value="${esc(c?.email || '')}"></label><label>Phone<input type="tel" name="phone" value="${esc(c?.phone || '')}"></label>${c ? `<label class="check"><input type="checkbox" name="active" ${c.active === 0 ? '' : 'checked'}> Active</label>` : ''}</div><h4>Centers they coach at</h4><div class="roster-list">${centers.map(x => `<label class="roster-person"><input type="checkbox" name="center" value="${esc(x.id)}" ${sel.has(x.id) ? 'checked' : ''}><span><b>${esc(x.name)}</b></span></label>`).join('')}</div><p class="muted section-gap-sm">Missing a center? <a href="#" id="co-newcenter">Add a new center</a></p><div class="modal-actions"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn">Save coach</button></div></form>`, { wide: true });
      m.$('#co-newcenter').onclick = async e => { e.preventDefault(); const name = prompt('New center name'); if (!name) return; try { const r = await api('centers', { method: 'POST', body: JSON.stringify({ name }) }); centers.push({ id: r.id, name }); m.$('.roster-list').insertAdjacentHTML('beforeend', `<label class="roster-person"><input type="checkbox" name="center" value="${esc(r.id)}" checked><span><b>${esc(name)}</b></span></label>`); toast('Center added'); } catch (err) { toast(err.message); } };
      m.$('#cof').onsubmit = async e => {
        e.preventDefault(); const f = new FormData(e.target), center_ids = f.getAll('center');
        const body = { name: f.get('name'), email: f.get('email'), phone: f.get('phone'), center_id: center_ids[0] || '' };
        if (c) body.active = f.get('active') ? 1 : 0;
        try {
          const r = await api('coaches' + (c ? '/' + c.id : ''), { method: c ? 'PUT' : 'POST', body: JSON.stringify(body) });
          await api('coach-centers', { method: 'POST', body: JSON.stringify({ coach_id: c ? c.id : r.id, center_ids }) });
          toast('Coach saved'); m.close(); show('coaches');
        } catch (err) { toast(err.message); }
      };
    };
    $('#cofilter').oninput = draw; $('#cocenter').onchange = draw; draw();
    $('#add-coach') && ($('#add-coach').onclick = () => coachForm(null));
    $$('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go));
  };

  /* ---------- centers ---------- */
  PAGES.centers = async () => {
    const list = await api('centers-summary');
    $('#content').innerHTML = hero('Centers', 'Add a new center in one step. Students, batches, coaches and events can then use it.') +
      `<form class="card" id="cenf"><div class="toolbar" style="margin:0"><input name="name" required maxlength="80" placeholder="New center name, e.g. New Jersey North" style="max-width:360px"><button class="btn">+ Add center</button></div></form>` +
      `<div class="table-wrap section-gap"><table><thead><tr><th>Center</th><th>Students</th><th>Batches</th><th>Coaches</th><th>Actions</th></tr></thead><tbody>${list.map(c => `<tr><td><b>${esc(c.name)}</b></td><td>${c.students}</td><td>${c.batches}</td><td>${c.coaches}</td><td class="actions"><button class="btn secondary small" data-cren="${esc(c.id)}">Rename</button><button class="btn secondary small" data-cdel="${esc(c.id)}">Delete</button></td></tr>`).join('')}</tbody></table></div>`;
    $('#cenf').onsubmit = async e => { e.preventDefault(); try { await api('centers', { method: 'POST', body: JSON.stringify({ name: e.target.elements.namedItem('name').value }) }); toast('Center added'); show('centers'); } catch (err) { toast(err.message); } };
    $$('[data-cren]').forEach(b => b.onclick = async () => { const c = list.find(x => x.id === b.dataset.cren), name = prompt('Rename center', c.name); if (!name || name === c.name) return; try { await api('centers/' + c.id, { method: 'PUT', body: JSON.stringify({ name }) }); toast('Renamed'); show('centers'); } catch (e) { toast(e.message); } });
    $$('[data-cdel]').forEach(b => b.onclick = async () => { if (!confirm('Delete this center?')) return; try { await api('centers/' + b.dataset.cdel, { method: 'DELETE' }); toast('Center deleted'); show('centers'); } catch (e) { toast(e.message); } });
  };

  /* ---------- one-minute timed sets with a pace graph ---------- */
  const EXERCISES = [['dasrang_1min', 'Dasrang'], ['rope_climb_1min', 'Rope climb up & down'], ['pole_climb_1min', 'Pole climb up & down'], ['sadhi_adhi_1min', 'Sadhi Adhi']];
  const exName = k => EXERCISES.find(e => e[0] === k)?.[1] || metricLabel(k);
  const SLICE = 5; // seconds per bar
  // Reps in each 5-second slice, plus a plain-language read of where they slowed down.
  function paceStats(taps, duration = 60) {
    const n = Math.ceil(duration / SLICE), buckets = Array(n).fill(0);
    taps.forEach(ms => { buckets[Math.min(n - 1, Math.floor(ms / 1000 / SLICE))]++; });
    const q = Math.round(n / 4), first = buckets.slice(0, q).reduce((a, b) => a + b, 0), last = buckets.slice(-q).reduce((a, b) => a + b, 0);
    const max = Math.max(...buckets), min = Math.min(...buckets);
    const fast = buckets.indexOf(max), slow = buckets.lastIndexOf(min);
    // first slice where the pace falls to under 75% of their best slice
    const drop = buckets.findIndex((b, i) => i > fast && b < max * 0.75);
    return { buckets, first, last, change: first ? Math.round((last - first) / first * 100) : 0, fast, slow, drop, max, q };
  }
  const sliceLabel = i => `${i * SLICE}–${(i + 1) * SLICE} s`;
  function paceSummary(taps) {
    if (taps.length < 4) return '';
    const s = paceStats(taps), secs = s.q * SLICE;
    const reps = n => n + (n === 1 ? ' rep' : ' reps');
    const parts = [`Fastest: <b>${sliceLabel(s.fast)}</b> (${reps(s.max)})`, `slowest: <b>${sliceLabel(s.slow)}</b> (${reps(s.buckets[s.slow])})`];
    let stamina = s.change <= -10 ? `They slowed down <b>${-s.change}%</b> from the first ${secs} s (${s.first} reps) to the last ${secs} s (${s.last} reps)${s.drop > 0 ? `, starting around <b>${s.drop * SLICE} s</b>` : ''}.` : s.change >= 10 ? `They got <b>faster</b> at the end: ${s.first} reps in the first ${secs} s, ${s.last} in the last ${secs} s.` : `Steady pace: ${s.first} reps in the first ${secs} s and ${s.last} in the last ${secs} s.`;
    return `<p class="pace-sum">${parts.join(' · ')}. ${stamina}</p>`;
  }
  // Single-series bar chart: one bar per 5-second slice, height = reps in that slice.
  function paceChart(taps, { duration = 60, title = '' } = {}) {
    if (!taps.length) return '<p class="muted">No tap times were recorded for this set, so there is no graph.</p>';
    const s = paceStats(taps, duration), W = 560, H = 200, L = 30, R = 8, T = 12, B = 28, pw = W - L - R, ph = H - T - B;
    const top = Math.max(2, s.max + (s.max % 2)), step = top <= 6 ? 1 : top <= 12 ? 2 : 5, bw = pw / s.buckets.length, gap = 2;
    const y = v => T + ph - (v / top) * ph;
    let grid = '';
    for (let v = 0; v <= top; v += step) grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="pace-grid"/><text x="${L - 6}" y="${y(v) + 4}" class="pace-axis" text-anchor="end">${v}</text>`;
    const bars = s.buckets.map((v, i) => { const x = L + i * bw + gap / 2, w = bw - gap, h = Math.max(0, y(0) - y(v)), r = Math.min(4, w / 2, h);
      const d = h ? `M${x},${y(0)} V${y(v) + r} Q${x},${y(v)} ${x + r},${y(v)} H${x + w - r} Q${x + w},${y(v)} ${x + w},${y(v) + r} V${y(0)} Z` : '';
      return `<g class="pace-bar ${i === s.drop ? 'is-drop' : ''}" data-tip="${sliceLabel(i)}: ${v} rep${v === 1 ? '' : 's'}"><rect x="${L + i * bw}" y="${T}" width="${bw}" height="${ph}" fill="transparent"/>${d ? `<path d="${d}"/>` : ''}</g>`; }).join('');
    const ticks = s.buckets.map((_, i) => i % 2 === 0 ? `<text x="${L + i * bw}" y="${H - 8}" class="pace-axis" text-anchor="${i ? 'middle' : 'start'}">${i * SLICE}s</text>` : '').join('') + `<text x="${W - R}" y="${H - 8}" class="pace-axis" text-anchor="end">${duration}s</text>`;
    const drop = s.drop > 0 ? `<line x1="${L + s.drop * bw}" x2="${L + s.drop * bw}" y1="${T}" y2="${y(0)}" class="pace-drop"/><text x="${L + s.drop * bw + 4}" y="${T + 10}" class="pace-axis">slowing</text>` : '';
    return `<figure class="pace"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc((title ? title + ': ' : '') + 'reps per ' + SLICE + ' seconds — ' + s.buckets.join(', '))}">${grid}${bars}${drop}${ticks}</svg><figcaption class="muted">Reps in each ${SLICE}-second slice${title ? ' · ' + esc(title) : ''}</figcaption><details class="pace-table"><summary class="muted">See the numbers</summary><div class="chips">${s.buckets.map((v, i) => `<span class="chip">${sliceLabel(i)}: ${v}</span>`).join('')}</div></details></figure>`;
  }
  // One tooltip for every pace chart on the page.
  const tip = document.createElement('div'); tip.className = 'pace-tip'; tip.hidden = true; document.body.append(tip);
  document.addEventListener('pointerover', e => { const g = e.target.closest?.('.pace-bar'); if (!g) { tip.hidden = true; return; } tip.textContent = g.dataset.tip; tip.hidden = false; });
  document.addEventListener('pointermove', e => { if (!tip.hidden) { tip.style.left = Math.min(e.clientX + 12, innerWidth - 170) + 'px'; tip.style.top = e.clientY - 34 + 'px'; } });
  const sessionCard = (r, del) => `<div class="pace-card"><div class="note-head"><b>${esc(exName(r.exercise))} · ${r.total} reps</b><small class="muted">${esc(fmtShort(r.record_date))}</small>${del ? `<button class="icon-btn" data-rsdel="${esc(r.id)}" aria-label="Delete set">✕</button>` : ''}</div>${paceSummary(r.taps)}${paceChart(r.taps, { title: exName(r.exercise) })}</div>`;
  // Newest set per exercise in full, older ones folded away.
  const sessionsBlock = (list, del) => {
    if (!list?.length) return '';
    const latest = EXERCISES.map(([k]) => list.find(r => r.exercise === k)).filter(Boolean), older = list.filter(r => !latest.includes(r));
    return latest.map(r => sessionCard(r, del)).join('') + (older.length ? `<details><summary class="muted">Earlier timed sets (${older.length})</summary>${older.map(r => sessionCard(r, del)).join('')}</details>` : '');
  };

  PAGES.timers = async () => {
    timers();
    const students = (await api('students')).filter(s => s.active !== 0).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    // Replace the old rep counter with one that records the time of every tap.
    const old = $('#counter'), card = document.createElement('div');
    card.className = 'timer-card counter'; card.id = 'counter';
    card.innerHTML = `<div class="timer-label">One-minute timed set</div><select id="rx" aria-label="Exercise" class="rx-select">${EXERCISES.map(([k, l]) => `<option value="${k}" ${state.rx === k ? 'selected' : ''}>${l}</option>`).join('')}</select><div class="timer-display" id="t1">01:00</div><div class="count-value"><span id="count">0</span> reps</div><p class="timer-help">Tap this card (or press the space bar) every time they finish one.</p><div class="timer-actions"><button class="btn" id="start1">Start 1:00</button><button class="btn secondary" id="reset1">Reset</button></div>`;
    old.replaceWith(card);
    $('#content').insertAdjacentHTML('beforeend', `<div class="card section-gap" id="rx-result" hidden><h3 id="rx-title"></h3><div id="rx-chart"></div><form id="dsave" class="section-gap"><h4>Save this set</h4><div class="form-grid"><label>Student<input id="ds-search" list="ds-list" placeholder="Type a name..." autocomplete="off" required><datalist id="ds-list">${students.map(s => `<option value="${esc(nameOf(s))}"></option>`).join('')}</datalist></label><label>Count<input type="number" id="ds-count" min="0" required></label><label>Date<input type="date" id="ds-date" value="${todayStr()}" required></label></div><div class="modal-actions"><button type="button" class="btn secondary" id="ds-skip">Don't save</button><button class="btn">Save set</button></div><p class="muted" id="ds-msg"></p></form></div>`);
    let taps = [], elapsed = 0, startedAt = 0, running = false, done = false, tick = null;
    const ex = () => $('#rx').value, now = () => elapsed + (running ? performance.now() - startedAt : 0);
    const paint = () => { const left = Math.min(60, Math.max(0, Math.ceil((60000 - now()) / 1000))); $('#t1').textContent = left === 60 ? '01:00' : '00:' + String(left).padStart(2, '0'); $('#count').textContent = taps.length; };
    const finish = () => {
      running = false; done = true; clearInterval(tick); elapsed = 60000; paint();
      $('#start1').textContent = 'Finished'; $('#rx').disabled = false;
      $('#rx-title').textContent = `${exName(ex())}: ${taps.length} reps`;
      $('#rx-chart').innerHTML = paceSummary(taps) + paceChart(taps, { title: exName(ex()) });
      $('#ds-count').value = taps.length; $('#ds-msg').textContent = '';
      $('#rx-result').hidden = false; $('#rx-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
      toast('Set complete: ' + taps.length + ' reps');
    };
    const reset = () => { clearInterval(tick); taps = []; elapsed = 0; running = false; done = false; $('#start1').textContent = 'Start 1:00'; $('#rx').disabled = false; $('#rx-result').hidden = true; paint(); };
    const toggle = () => {
      if (done) return;
      if (running) { elapsed = now(); running = false; clearInterval(tick); $('#start1').textContent = 'Resume'; return; }
      running = true; startedAt = performance.now(); $('#start1').textContent = 'Pause'; $('#rx').disabled = true;
      tick = setInterval(() => { if (now() >= 60000) finish(); else paint(); }, 100);
    };
    const tap = () => { if (!running) return; const t = now(); if (t < 60000) { taps.push(Math.round(t)); paint(); } };
    card.onclick = e => { if (!e.target.closest('button,select')) tap(); };
    const onKey = e => { if (state.page !== 'timers') return document.removeEventListener('keydown', onKey); if (e.code === 'Space' && running && !e.target.closest('input,textarea,select,button')) { e.preventDefault(); tap(); } };
    document.addEventListener('keydown', onKey);
    $('#start1').onclick = toggle; $('#reset1').onclick = reset;
    $('#rx').onchange = e => { state.rx = e.target.value; };
    $('#ds-skip').onclick = () => { $('#rx-result').hidden = true; };
    $('#dsave').onsubmit = async e => {
      e.preventDefault();
      const s = students.find(x => nameOf(x).toLowerCase() === $('#ds-search').value.trim().toLowerCase());
      if (!s) return toast('Pick a student from the list');
      const count = Number($('#ds-count').value);
      try {
        // Keep the tap times only if the count wasn't changed by hand.
        await api('rep-sessions', { method: 'POST', body: JSON.stringify({ student_id: s.id, exercise: ex(), record_date: $('#ds-date').value, total: count, taps: count === taps.length ? taps : [] }) });
        $('#ds-msg').textContent = `Saved ${count} ${exName(ex())} reps for ${nameOf(s)} with the pace graph. Parents can see it in their portal.`; toast('Set saved'); $('#ds-search').value = '';
      } catch (err) { toast(err.message); }
    };
  };

  /* ---------- parent portal additions ---------- */
  const _childCard = childCard;
  childCard = c => {
    const base = _childCard(c);
    const SL = { passed: 'Passed', not_passed: 'Not passed yet' };
    const extra =
      (c.coaches?.length ? `<p class="muted">Coaches: ${c.coaches.map(x => esc(x.name)).join(', ')}</p>` : '') +
      (c.notes?.length ? `<h4>Coach notes <span class="muted">what they did and what's next</span></h4>${noteList(c.notes.slice(0, 3), false)}${c.notes.length > 3 ? `<details><summary class="muted">Older notes (${c.notes.length - 3})</summary>${noteList(c.notes.slice(3), false)}</details>` : ''}` : '') +
      (c.fitness?.length ? `<h4>Fitness</h4>${fitnessTiles(c.fitness)}` : '') +
      (c.rep_sessions?.length ? `<h4>One-minute sets <span class="muted">see when they slowed down</span></h4>${sessionsBlock(c.rep_sessions, false)}` : '') +
      (c.evaluations?.length ? `<h4>Evaluations</h4><ul class="att-list">${c.evaluations.map(e => `<li><span>${esc(e.title)} · ${esc(fmtShort(e.event_date))} · ${cap(e.apparatus)} level ${e.target_level}<small class="muted"> · ${e.passed}/${e.tried} skills</small></span><span class="chip ${e.change === 'Increased' ? 'ok' : ''}">${e.change === 'Increased' ? '▲ Level ' + e.from_level + ' → ' + e.target_level : SL[e.outcome]}</span></li>`).join('')}</ul>` : '') +
      (c.comp_scores?.length ? `<h4>Competition scores</h4><ul class="att-list">${c.comp_scores.map(s => `<li><span>${esc(s.title)} · ${esc(fmtShort(s.event_date))} · ${cap(s.apparatus)}</span><span><b>${s.score}</b> <span class="chip ${s.rank <= 3 ? 'ok' : ''}">${s.rank <= 3 ? ['🥇', '🥈', '🥉'][s.rank - 1] + ' ' : ''}#${s.rank} of ${s.total}</span></span></li>`).join('')}</ul>` : '') +
      (c.demos?.length ? `<h4>Demos</h4>${c.demos.map(d => `<div class="note"><div class="note-head"><b>${esc(d.title)}</b><small class="muted">${esc(fmtShort(d.demo_date))}${d.arrive_time ? ' · arrive by ' + esc(fmtTime(d.arrive_time)) : ''}${d.location ? ' · ' + esc(d.location) : ''}</small>${d.status ? `<span class="chip s-${esc(d.status)}">${esc(d.status)}</span>` : d.demo_date >= todayStr() ? '<span class="chip">Going</span>' : ''}</div>${(d.routines || []).map(r => `<details class="routine-card"><summary><span class="chip type-demo">${RAPP[r.apparatus] || 'Group'}</span> <b>${esc(r.title)}</b></summary>${r.content ? `<pre class="routine">${esc(r.content)}</pre>` : ''}${r.video_url ? link(r.video_url, 'Watch video ↗', 'btn secondary small') : ''}</details>`).join('')}</div>`).join('')}` : '') +
      (c.photos?.length ? `<h4>Photos</h4>${photoGrid(c.photos, false)}` : '');
    return base.replace(/<\/section>\s*$/, extra + '</section>');
  };
  const _ecp = eventCardParent;
  eventCardParent = e => _ecp(e.arrive_time ? { ...e, details: 'Please arrive by ' + fmtTime(e.arrive_time) + '.' + (e.details ? '\n' + e.details : '') } : e);
  const _pev = PAGES.p_events;
  PAGES.p_events = async () => {
    await _pev();
    const d = state.home; if (!d?.meetings?.length) return;
    $('#content').querySelector('.welcome')?.insertAdjacentHTML('afterend', `<div class="card"><h3>Your meetings</h3>${d.meetings.map(x => `<div class="mini-event"><div class="date-chip"><b>${dateObj(x.meeting_date).getDate()}</b><span>${dateObj(x.meeting_date).toLocaleDateString('en-US', { month: 'short' })}</span></div><div><b>${esc(x.title)}</b><small>${esc(timeRange(x.start_time, x.end_time) || '')}${x.location ? ' · ' + esc(x.location) : ''}</small></div>${x.meet_url ? link(x.meet_url, 'Join Meet', 'btn small') : ''}</div>`).join('')}</div>`);
  };
  const _home = PAGES.home;
  PAGES.home = async () => {
    await _home();
    const d = state.home, pinned = (d?.announcements || []).filter(a => a.pinned);
    if (pinned.length) $('#content').querySelector('.welcome')?.insertAdjacentHTML('afterend', `<div class="card">${pinned.map(annCard).join('')}<button class="btn secondary small" data-go="p_announcements">All announcements</button></div>`);
    $$('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go));
  };
  PAGES.p_announcements = async () => {
    const d = state.home || await loadHome();
    $('#content').innerHTML = hero('Announcements', 'News from MFU and your coaches.') + (d.announcements?.length ? `<div class="card">${d.announcements.map(annCard).join('')}</div>` : `<div class="card">${empty('📣', 'No announcements', 'News from MFU will show up here.')}</div>`);
  };
  PAGES.p_contact = async () => {
    const d = await loadHome();
    const kids = d.children;
    $('#content').innerHTML = hero('Contact coach', 'Ask a question or request a meeting. It goes to the MFU admin and your child\'s coaches.') +
      (kids.length ? `<form class="card" id="pcf"><div class="seg" id="pck"><button type="button" data-k="question" class="active">Ask a question</button><button type="button" data-k="meeting">Request a meeting</button></div><div class="form-grid"><label>About<select name="student_id">${kids.map(c => `<option value="${esc(c.id)}">${esc(nameOf(c))}${c.coaches?.length ? ' · ' + esc(c.coaches.map(x => x.name).join(', ')) : ''}</option>`).join('')}</select></label><label>Subject<input name="subject" required maxlength="200" placeholder="e.g. Question about level 3 evaluation"></label><label class="wide">Message<textarea name="message" rows="5"></textarea></label><label class="wide" id="pctimes" style="display:none">Days and times that work for you<input name="preferred_times" placeholder="e.g. Weekdays after 6pm, or Saturday morning"></label></div><div class="modal-actions"><button class="btn" id="pcsend">Send</button></div></form>` : `<div class="card">${empty('👋', 'No children linked yet', 'Ask MFU to link your child to this account.')}</div>`) +
      `<div class="card section-gap"><h3>Your messages</h3>${d.requests?.length ? d.requests.map(r => `<div class="note"><div class="note-head"><b>${esc(r.subject)}</b><small class="muted">${r.kind === 'meeting' ? 'Meeting request' : 'Question'} · ${esc((r.first_name || '') + ' ' + (r.last_name || ''))} · ${esc(fmtStamp(r.created_at))}</small><span class="chip ${r.status === 'open' ? 'warn' : 'ok'}">${r.status === 'open' ? 'Waiting for reply' : r.status === 'scheduled' ? 'Meeting scheduled' : 'Answered'}</span></div>${r.message ? `<p class="muted">${esc(r.message)}</p>` : ''}${r.reply ? `<p><span class="chip ok">${esc(r.replied_by || 'Coach')}</span> ${esc(r.reply)}</p>` : ''}</div>`).join('') : '<p class="muted">Nothing sent yet.</p>'}</div>`;
    let kind = 'question';
    $$('#pck button').forEach(b => b.onclick = () => { kind = b.dataset.k; $$('#pck button').forEach(x => x.classList.toggle('active', x === b)); $('#pctimes').style.display = kind === 'meeting' ? '' : 'none'; });
    $('#pcf') && ($('#pcf').onsubmit = async e => { e.preventDefault(); const btn = $('#pcsend'); btn.disabled = true; try { await api('parent/requests', { method: 'POST', body: JSON.stringify({ kind, ...Object.fromEntries(new FormData(e.target)) }) }); toast(kind === 'meeting' ? 'Meeting request sent' : 'Question sent'); state.home = null; show('p_contact'); } catch (err) { toast(err.message); btn.disabled = false; } });
  };
})();
