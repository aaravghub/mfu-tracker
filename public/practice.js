/* MFU Tracker — exercise library and sets (staff), home practice (assigned by staff, ticked off by parents),
   the parent Skills page, and the child switcher for families with more than one child.
   Loaded after features.js (uses its globals plus mfuStudentPicker). */
'use strict';
(() => {
  const CATS = ['Core', 'Strength', 'Flexibility', 'Balance', 'Endurance', 'Mallakhamb drills', 'Warm-up', 'Other'];
  const FREQ = ['Daily', '5 times a week', '3 times a week', 'Weekly'];
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : '';
  const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
  const lvlText = l => l ? 'Level ' + l : 'Any level';
  Object.assign(titles, { exercises: 'Exercises & sets', p_practice: 'Home practice', p_skills: 'Skills' });

  /* ---------- staff: exercises, sets, home practice ---------- */
  PAGES.exercises = async () => {
    const tab = state.exTab ||= 'exercises';
    const [exs, sets] = await Promise.all([api('exercises'), api('exercise-sets')]);
    $('#content').innerHTML = hero('Exercises & sets', 'Build a library of exercises (core, strength, flexibility…), group them into sets by level, and assign them as home practice. Parents see and tick off home practice in their portal.') +
      `<div class="seg att-modes" id="extabs">${[['exercises', `Exercises (${exs.length})`], ['sets', `Sets (${sets.length})`], ['home', 'Home practice']].map(([k, l]) => `<button type="button" data-t="${k}" class="${tab === k ? 'active' : ''}">${l}</button>`).join('')}</div><div id="exview"></div>`;
    $$('#extabs button').forEach(b => b.onclick = () => { state.exTab = b.dataset.t; show('exercises'); });
    const V = $('#exview');

    if (tab === 'exercises') {
      const F = state.exFilter ||= { cat: '', lvl: '', q: '' };
      const draw = () => {
        const list = exs.filter(e => (!F.cat || e.category === F.cat) && (!F.lvl || String(e.level || '') === F.lvl) && e.name.toLowerCase().includes(F.q.toLowerCase()));
        $('#exlist').innerHTML = list.length ? CATS.filter(c => list.some(e => e.category === c)).map(c => `<h3 class="group-title">${esc(c)}</h3><div class="link-grid">${list.filter(e => e.category === c).map(e => `<div class="link-card"><div><b>${esc(e.name)}</b> <span class="chip">${lvlText(e.level)}</span>${e.default_reps ? ` <span class="chip ok">${esc(e.default_reps)}</span>` : ''}</div>${e.description ? `<p class="muted">${esc(e.description)}</p>` : ''}<div class="card-actions">${e.video_url ? link(e.video_url, 'Video ↗', 'btn secondary small') : ''}<button class="btn small" data-exassign="${esc(e.id)}">Assign for home</button><button class="btn secondary small" data-exedit="${esc(e.id)}">Edit</button><button class="btn secondary small" data-exdel="${esc(e.id)}">Delete</button></div></div>`).join('')}</div>`).join('') : `<div class="card">${empty('🏋️', 'No exercises yet', 'Add your first exercise, like “Hollow hold” or “Pike push-ups”.')}</div>`;
        $$('[data-exedit]').forEach(b => b.onclick = () => exerciseForm(exs.find(x => x.id === b.dataset.exedit)));
        $$('[data-exdel]').forEach(b => b.onclick = async () => { if (confirm('Delete this exercise? It is also removed from any set.')) { await api('exercises/' + b.dataset.exdel, { method: 'DELETE' }); toast('Deleted'); show('exercises'); } });
        $$('[data-exassign]').forEach(b => b.onclick = () => assignForm({ exercise_id: b.dataset.exassign }, exs, sets));
      };
      V.innerHTML = `<div class="toolbar"><input type="search" id="exq" placeholder="Search exercises…" value="${esc(F.q)}"><select id="excat"><option value="">All types</option>${CATS.map(c => `<option ${F.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select><select id="exlvl"><option value="">All levels</option>${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${F.lvl === String(n) ? 'selected' : ''}>Level ${n}</option>`).join('')}</select><button class="btn" id="exadd">+ Add exercise</button></div><div id="exlist"></div>`;
      $('#exq').oninput = e => { F.q = e.target.value; draw(); }; $('#excat').onchange = e => { F.cat = e.target.value; draw(); }; $('#exlvl').onchange = e => { F.lvl = e.target.value; draw(); };
      $('#exadd').onclick = () => exerciseForm(null);
      draw();
    }

    if (tab === 'sets') {
      V.innerHTML = `<div class="toolbar"><button class="btn" id="setadd" ${exs.length ? '' : 'disabled'}>+ New set</button>${exs.length ? '' : '<span class="muted">Add exercises first.</span>'}</div>` +
        (sets.length ? `<div class="link-grid">${sets.map(s => `<div class="link-card"><div><b>${esc(s.name)}</b> <span class="chip">${esc(s.category || '')}</span> <span class="chip">${lvlText(s.level)}</span></div>${s.description ? `<p class="muted">${esc(s.description)}</p>` : ''}<ol class="set-items">${s.items.map(i => `<li>${esc(i.name)}${i.reps ? ` <span class="muted">· ${esc(i.reps)}</span>` : ''}</li>`).join('')}</ol><div class="card-actions"><button class="btn small" data-setassign="${esc(s.id)}">Assign for home</button><button class="btn secondary small" data-setedit="${esc(s.id)}">Edit</button><button class="btn secondary small" data-setdel="${esc(s.id)}">Delete</button></div></div>`).join('')}</div>` : `<div class="card">${empty('📋', 'No sets yet', 'A set is a list of exercises with reps, like “Level 2 core: 3×20s hollow hold, 15 V-ups…”.')}</div>`);
      $('#setadd') && ($('#setadd').onclick = () => setForm(null, exs));
      $$('[data-setedit]').forEach(b => b.onclick = () => setForm(sets.find(x => x.id === b.dataset.setedit), exs));
      $$('[data-setdel]').forEach(b => b.onclick = async () => { if (confirm('Delete this set? Home practice using it is removed too.')) { await api('exercise-sets/' + b.dataset.setdel, { method: 'DELETE' }); toast('Deleted'); show('exercises'); } });
      $$('[data-setassign]').forEach(b => b.onclick = () => assignForm({ set_id: b.dataset.setassign }, exs, sets));
    }

    if (tab === 'home') {
      const rows = await api('home-assignments');
      V.innerHTML = `<div class="toolbar"><button class="btn" id="hadd" ${exs.length || sets.length ? '' : 'disabled'}>+ Assign home practice</button><input type="search" id="hq" placeholder="Search students…"></div>` +
        (rows.length ? `<div class="table-wrap"><table><thead><tr><th>Student</th><th>Practice</th><th>How often</th><th>Done this week</th><th>Last done</th><th></th></tr></thead><tbody id="hrows">${rows.map(r => `<tr data-n="${esc((r.first_name + ' ' + r.last_name).toLowerCase())}"><td><button type="button" class="stu-link" data-open="${esc(r.student_id)}">${esc(r.first_name + ' ' + r.last_name)}</button></td><td>${esc(r.set_name || r.exercise_name || '—')}${r.reps ? ` <span class="muted">· ${esc(r.reps)}</span>` : ''}${r.note ? `<br><small class="muted">${esc(r.note)}</small>` : ''}</td><td>${esc(r.frequency)}${r.until_date ? `<br><small class="muted">until ${esc(fmtShort(r.until_date))}</small>` : ''}</td><td><span class="chip ${r.done_week ? 'ok' : ''}">${r.done_week} time${r.done_week === 1 ? '' : 's'}</span></td><td>${r.last_done ? esc(fmtShort(r.last_done)) : '—'}</td><td><button class="btn secondary small" data-hdel="${esc(r.id)}">Stop</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="card">${empty('🏠', 'Nothing assigned yet', 'Assign a set or an exercise to students to practice at home.')}</div>`);
      $('#hadd').onclick = () => assignForm({}, exs, sets);
      $('#hq').oninput = e => $$('#hrows tr').forEach(tr => tr.style.display = tr.dataset.n.includes(e.target.value.toLowerCase()) ? '' : 'none');
      $$('[data-open]').forEach(b => b.onclick = () => openStudent(b.dataset.open));
      $$('[data-hdel]').forEach(b => b.onclick = async () => { if (confirm('Stop this home practice? Parents will no longer see it.')) { await api('home-assignments/' + b.dataset.hdel, { method: 'DELETE' }); toast('Stopped'); show('exercises'); } });
    }
  };

  function exerciseForm(e) {
    const m = openModal(e ? 'Edit exercise' : 'Add exercise', `<form id="exf"><div class="form-grid"><label class="wide">Name<input name="name" required maxlength="120" value="${esc(e?.name || '')}" placeholder="e.g. Hollow body hold"></label><label>Type<select name="category">${CATS.map(c => `<option ${(e?.category || 'Core') === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label><label>Level<select name="level"><option value="">Any level</option>${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${Number(e?.level) === n ? 'selected' : ''}>Level ${n}</option>`).join('')}</select></label><label>Usual reps / time<input name="default_reps" maxlength="60" value="${esc(e?.default_reps || '')}" placeholder="e.g. 3 × 20 sec"></label><label>Video link (optional)<input type="url" name="video_url" value="${esc(e?.video_url || '')}" placeholder="https://"></label><label class="wide">How to do it<textarea name="description" rows="3">${esc(e?.description || '')}</textarea></label></div><div class="modal-actions"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn">Save exercise</button></div></form>`, { wide: true });
    m.$('#exf').onsubmit = async ev => { ev.preventDefault(); try { await api('exercises' + (e ? '/' + e.id : ''), { method: e ? 'PUT' : 'POST', body: JSON.stringify(Object.fromEntries(new FormData(ev.target))) }); toast('Exercise saved'); m.close(); show('exercises'); } catch (err) { toast(err.message); } };
  }

  function setForm(s, exs) {
    let items = (s?.items || []).map(i => ({ exercise_id: i.exercise_id, reps: i.reps }));
    const m = openModal(s ? 'Edit set' : 'New set', `<form id="stf"><div class="form-grid"><label class="wide">Set name<input name="name" required maxlength="120" value="${esc(s?.name || '')}" placeholder="e.g. Level 2 core"></label><label>Type<select name="category">${CATS.map(c => `<option ${(s?.category || 'Core') === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label><label>Level<select name="level"><option value="">Any level</option>${[1, 2, 3, 4, 5].map(n => `<option value="${n}" ${Number(s?.level) === n ? 'selected' : ''}>Level ${n}</option>`).join('')}</select></label><label class="wide">Notes (optional)<input name="description" value="${esc(s?.description || '')}" placeholder="e.g. Rest 30 sec between exercises"></label></div><h4>Exercises in this set</h4><div id="stitems"></div><div class="toolbar"><select id="stadd"><option value="">+ Add an exercise…</option>${CATS.map(c => exs.some(e => e.category === c) ? `<optgroup label="${c}">${exs.filter(e => e.category === c).map(e => `<option value="${esc(e.id)}">${esc(e.name)} · ${lvlText(e.level)}</option>`).join('')}</optgroup>` : '').join('')}</select></div><div class="modal-actions"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn">Save set</button></div></form>`, { wide: true });
    const draw = () => {
      m.$('#stitems').innerHTML = items.length ? items.map((it, i) => { const e = exs.find(x => x.id === it.exercise_id); return `<div class="set-row"><span class="muted">${i + 1}.</span><b>${esc(e?.name || '?')}</b><input data-reps="${i}" value="${esc(it.reps || '')}" placeholder="${esc(e?.default_reps || 'reps / time')}"><button type="button" class="icon-btn" data-up="${i}" aria-label="Move up">↑</button><button type="button" class="icon-btn" data-rm="${i}" aria-label="Remove">✕</button></div>`; }).join('') : '<p class="muted">No exercises yet — add some below.</p>';
      m.$$('[data-reps]').forEach(inp => inp.oninput = () => { items[+inp.dataset.reps].reps = inp.value; });
      m.$$('[data-rm]').forEach(b => b.onclick = () => { items.splice(+b.dataset.rm, 1); draw(); });
      m.$$('[data-up]').forEach(b => b.onclick = () => { const i = +b.dataset.up; if (i > 0) { [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); } });
    };
    m.$('#stadd').onchange = e => { const id = e.target.value; if (id && !items.some(i => i.exercise_id === id)) items.push({ exercise_id: id, reps: exs.find(x => x.id === id)?.default_reps || '' }); e.target.value = ''; draw(); };
    draw();
    m.$('#stf').onsubmit = async ev => { ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target)); if (!items.length) return toast('Add at least one exercise'); try { await api('exercise-sets' + (s ? '/' + s.id : ''), { method: s ? 'PUT' : 'POST', body: JSON.stringify({ ...f, items }) }); toast('Set saved'); m.close(); show('exercises'); } catch (err) { toast(err.message); } };
  }

  async function assignForm(preset, exs, sets) {
    const m = openModal('Assign home practice', `<form id="asf"><div class="form-grid"><label class="wide">What to practice<select name="what" required><option value="">Choose a set or an exercise…</option>${sets.length ? `<optgroup label="Sets">${sets.map(s => `<option value="set:${esc(s.id)}" ${preset.set_id === s.id ? 'selected' : ''}>${esc(s.name)} · ${lvlText(s.level)}</option>`).join('')}</optgroup>` : ''}${exs.length ? `<optgroup label="Single exercises">${exs.map(e => `<option value="ex:${esc(e.id)}" ${preset.exercise_id === e.id ? 'selected' : ''}>${esc(e.name)} · ${esc(e.category)}</option>`).join('')}</optgroup>` : ''}</select></label><label>How often<select name="frequency">${FREQ.map(f => `<option>${f}</option>`).join('')}</select></label><label>Until (optional)<input type="date" name="until_date"></label><label>Reps / time (single exercise)<input name="reps" maxlength="60" placeholder="e.g. 3 × 15"></label><label>Note for parents (optional)<input name="note" maxlength="300" placeholder="e.g. Before school is best"></label></div><h4>Students</h4><div id="aspick"></div><div class="modal-actions"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn">Assign</button></div></form>`, { wide: true });
    const picker = await mfuStudentPicker(m.$('#aspick'), []);
    m.$('#asf').onsubmit = async ev => {
      ev.preventDefault(); const f = Object.fromEntries(new FormData(ev.target)), [kind, id] = (f.what || ':').split(':');
      const student_ids = picker.ids(); if (!student_ids.length) return toast('Tick at least one student');
      try { const r = await api('home-assignments', { method: 'POST', body: JSON.stringify({ set_id: kind === 'set' ? id : null, exercise_id: kind === 'ex' ? id : null, frequency: f.frequency, until_date: f.until_date, reps: f.reps, note: f.note, student_ids }) }); toast(`Assigned to ${r.assigned} student${r.assigned === 1 ? '' : 's'}`); m.close(); state.exTab = 'home'; show('exercises'); } catch (err) { toast(err.message); }
    };
  }

  /* ---------- parent: pick a child when there are several ---------- */
  const kidPicker = (kids, key) => kids.length > 1 ? `<div class="seg kid-seg" data-kids="${key}">${kids.map(k => `<button type="button" data-kid="${esc(k.id)}" class="${state[key] === k.id ? 'active' : ''}">${esc(k.first_name)}</button>`).join('')}</div>` : '';
  const wireKids = (key, page) => $$(`[data-kids="${key}"] [data-kid]`).forEach(b => b.onclick = () => { state[key] = b.dataset.kid; show(page); });
  const pickKid = (kids, key) => { if (!kids.some(k => k.id === state[key])) state[key] = kids[0]?.id; return kids.find(k => k.id === state[key]); };

  /* ---------- parent: home practice ---------- */
  PAGES.p_practice = async () => {
    const d = await loadHome(), kids = d.children, kid = pickKid(kids, 'practiceKid');
    const today = ymd(new Date());
    const week = Array.from({ length: 7 }, (_, i) => daysAgo(6 - i));
    $('#content').innerHTML = hero('Home practice', 'Exercises and sets your coach wants your child to practice at home. Tick them off when they are done.') + kidPicker(kids, 'practiceKid') +
      (!kid ? `<div class="card">${empty('👋', 'No children linked yet', 'Ask MFU to link your child to this account.')}</div>` : kid.practice?.length ? kid.practice.map(a => {
        const done = new Set(a.done_dates), doneToday = done.has(today);
        return `<article class="card practice-card"><div class="note-head"><b>${esc(a.set_name || a.exercise_name)}</b><span class="chip">${esc(a.frequency)}</span>${a.until_date ? `<small class="muted">until ${esc(fmtShort(a.until_date))}</small>` : '<small class="muted"></small>'}<span class="chip ${doneToday ? 'ok' : ''}">${doneToday ? '✓ Done today' : 'Not done today'}</span></div>
          ${a.note ? `<p class="muted">${esc(a.note)}</p>` : ''}${a.set_description || a.exercise_description ? `<p>${esc(a.set_description || a.exercise_description)}</p>` : ''}
          ${a.items.length ? `<ol class="set-items">${a.items.map(i => `<li><b>${esc(i.name)}</b>${i.reps ? ` · ${esc(i.reps)}` : ''}${i.video_url ? ` · <a href="${esc(safeUrl(i.video_url))}" target="_blank" rel="noopener noreferrer">video</a>` : ''}${i.description ? `<br><small class="muted">${esc(i.description)}</small>` : ''}</li>`).join('')}</ol>` : a.reps ? `<p><b>${esc(a.reps)}</b>${a.exercise_video ? ` · <a href="${esc(safeUrl(a.exercise_video))}" target="_blank" rel="noopener noreferrer">video</a>` : ''}</p>` : ''}
          <div class="week-dots" aria-label="Last 7 days">${week.map(w => `<button type="button" class="${done.has(w) ? 'on' : ''}" data-chk="${esc(a.id)}" data-date="${w}" title="${esc(fmtShort(w))}${done.has(w) ? ' · done' : ''}"><small>${new Date(w + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'narrow' })}</small>${done.has(w) ? '✓' : ''}</button>`).join('')}</div>
          <div class="card-actions"><button class="btn ${doneToday ? 'secondary' : ''}" data-chk="${esc(a.id)}" data-date="${today}">${doneToday ? 'Undo today' : '✓ Mark done today'}</button></div></article>`;
      }).join('') : `<div class="card">${empty('🏠', 'Nothing to practice at home yet', 'When a coach assigns home practice for ' + kid.first_name + ', it shows up here.')}</div>`);
    wireKids('practiceKid', 'p_practice');
    $$('[data-chk]').forEach(b => b.onclick = async () => {
      const a = kid.practice.find(x => x.id === b.dataset.chk), on = a.done_dates.includes(b.dataset.date);
      try { await api('parent/practice/checkin', { method: 'POST', body: JSON.stringify({ assignment_id: a.id, date: b.dataset.date, done: !on }) }); state.home = null; show('p_practice'); } catch (e) { toast(e.message); }
    });
  };

  /* ---------- parent: every skill, level by level ---------- */
  const SL = { not_started: 'Not started', learning: 'Learning', mastered: 'Completed' };
  PAGES.p_skills = async () => {
    const d = state.home || await loadHome(), kids = d.children, kid = pickKid(kids, 'skillsKid');
    const app = state.skillsApp ||= 'pole';
    if (!kid) { $('#content').innerHTML = hero('Skills', 'Every skill in the MFU program.') + `<div class="card">${empty('👋', 'No children linked yet', 'Ask MFU to link your child to this account.')}</div>`; return; }
    const lvl = Number(kid[app + '_level']) || 1, list = kid.skills.filter(s => s.apparatus === app), st = s => s.level <= lvl ? 'mastered' : s.status;
    $('#content').innerHTML = hero('Skills', `Every ${app} skill, level by level. Levels ${kid.first_name} has passed count as completed.`) + kidPicker(kids, 'skillsKid') +
      `<div class="seg att-modes" id="skapp">${['pole', 'rope', 'yoga'].map(a => `<button type="button" data-a="${a}" class="${a === app ? 'active' : ''}">${cap(a)} · Level ${kid[a + '_level']}</button>`).join('')}</div>` +
      ([1, 2, 3, 4, 5].filter(l => list.some(s => s.level === l)).map(l => { const ls = list.filter(s => s.level === l), done = ls.filter(s => st(s) === 'mastered').length;
        return `<details class="card skill-level" ${l === lvl + 1 ? 'open' : ''}><summary><b>Level ${l}</b> <span class="chip ${l <= lvl ? 'ok' : l === lvl + 1 ? 'warn' : ''}">${l <= lvl ? '✓ Passed' : l === lvl + 1 ? 'Working on this' : 'Coming later'}</span> <span class="muted">${done}/${ls.length} completed</span></summary><ul class="skill-list">${ls.map(s => `<li><span><b>${s.video_url ? `<a href="${esc(safeUrl(s.video_url))}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a>` : esc(s.name)}</b>${s.description ? `<br><small class="muted">${esc(s.description)}</small>` : ''}</span><span class="chip s-${st(s)}">${SL[st(s)]}</span></li>`).join('')}</ul></details>`; }).join('') || `<div class="card">${empty('📚', 'No skills listed yet', 'MFU hasn\'t added the ' + app + ' skills yet.')}</div>`);
    wireKids('skillsKid', 'p_skills');
    $$('#skapp button').forEach(b => b.onclick = () => { state.skillsApp = b.dataset.a; show('p_skills'); });
  };

  /* ---------- parent home: jump between children ---------- */
  const _home = PAGES.home;
  PAGES.home = async () => {
    await _home();
    const kids = state.home?.children || [];
    if (kids.length > 1) {
      $('#content .welcome')?.insertAdjacentHTML('afterend', `<div class="kid-jump"><span class="muted">Jump to:</span>${kids.map((k, i) => `<button type="button" class="btn secondary small" data-jump="${i}">${esc(k.first_name)}</button>`).join('')}</div>`);
      const cards = $$('#content section.child');
      $$('[data-jump]').forEach(b => b.onclick = () => cards[+b.dataset.jump]?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };
})();
