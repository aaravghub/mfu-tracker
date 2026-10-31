/* MFU Tracker — forms and sign-ups. Staff build forms (or get one made for an evaluation, competition or demo),
   share the link, email it or attach it to an announcement; parents fill it in once per child.
   Loaded after features.js/practice.js/signup.js (uses their globals). */
'use strict';
(() => {
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : '';
  const TYPES = [['text', 'Short answer'], ['textarea', 'Long answer'], ['choice', 'One choice'], ['multi', 'Several choices'], ['checkbox', 'Yes / tick box'], ['number', 'Number'], ['date', 'Date']];
  const KIND = { general: 'Form', evaluation: 'Evaluation sign-up', competition: 'Competition sign-up', demo: 'Demo sign-up' };
  const formUrl = id => location.origin + '/#form=' + id;
  Object.assign(titles, { forms: 'Forms & sign-ups', p_forms: 'Sign-ups & forms', p_form: 'Form' });
  const addNav = (role, after, item) => { NAV[role] = NAV[role].map(([label, items]) => { const i = items.findIndex(x => x[0] === after); return i < 0 ? [label, items] : [label, [...items.slice(0, i + 1), item, ...items.slice(i + 1)]]; }); };
  addNav('admin', 'announcements', ['forms', 'Forms & sign-ups']);
  addNav('coach', 'announcements', ['forms', 'Forms & sign-ups']);
  addNav('parent', 'p_announcements', ['p_forms', 'Sign-ups & forms']);

  /* ---------- drawing and reading questions (parents and the public form) ---------- */
  const fieldHtml = (f, v) => {
    const req = f.required ? ' <span class="req">*</span>' : '', name = 'q_' + f.id, help = f.help ? `<small class="muted">${esc(f.help)}</small>` : '';
    if (f.type === 'textarea') return `<label class="wide"><span>${esc(f.label)}${req}</span><textarea name="${name}" rows="3">${esc(v || '')}</textarea>${help}</label>`;
    if (f.type === 'choice') return `<fieldset class="wide q-set"><legend>${esc(f.label)}${req}</legend>${f.options.map(o => `<label class="pick"><input type="radio" name="${name}" value="${esc(o)}" ${v === o ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('')}${help}</fieldset>`;
    if (f.type === 'multi') return `<fieldset class="wide q-set"><legend>${esc(f.label)}${req}</legend>${f.options.map(o => `<label class="pick"><input type="checkbox" name="${name}" value="${esc(o)}" ${(v || []).includes(o) ? 'checked' : ''}><span>${esc(o)}</span></label>`).join('')}${help}</fieldset>`;
    if (f.type === 'checkbox') return `<label class="check wide"><input type="checkbox" name="${name}" ${v ? 'checked' : ''}> ${esc(f.label)}${req}</label>`;
    return `<label class="wide"><span>${esc(f.label)}${req}</span><input name="${name}" type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}" value="${esc(v ?? '')}">${help}</label>`;
  };
  const readAnswers = (root, fields) => Object.fromEntries(fields.map(f => {
    const els = [...root.querySelectorAll(`[name="q_${f.id}"]`)];
    if (f.type === 'multi') return [f.id, els.filter(e => e.checked).map(e => e.value)];
    if (f.type === 'choice') return [f.id, els.find(e => e.checked)?.value || ''];
    if (f.type === 'checkbox') return [f.id, !!els[0]?.checked];
    return [f.id, els[0]?.value || ''];
  }));
  const answerText = (f, v) => Array.isArray(v) ? v.join(', ') : v === true ? 'Yes' : v === false ? '' : String(v ?? '');

  /* ---------- staff: the Forms page ---------- */
  PAGES.forms = async () => {
    const forms = await api('forms');
    $('#content').innerHTML = hero('Forms & sign-ups', 'Make a form, or get a sign-up form made for an evaluation, competition or demo. Share the link, email it, or add it to an announcement — parents fill it in once per child.', '<button class="btn" id="fnew">+ New form</button>') +
      (forms.length ? `<div class="link-grid">${forms.map(f => `<div class="link-card form-card"><div class="chips"><span class="chip ${f.kind === 'general' ? '' : 'type-' + esc(f.kind)}">${KIND[f.kind] || 'Form'}</span><span class="chip ${f.open ? 'ok' : ''}">${f.open ? 'Open' : 'Closed'}</span>${f.audience === 'anyone' ? '<span class="chip">Anyone with link</span>' : ''}</div><b>${esc(f.title)}</b>${f.description ? `<p class="muted">${esc(f.description)}</p>` : ''}<p class="muted"><b>${f.responses}</b> response${f.responses === 1 ? '' : 's'}${f.closes_on ? ' · closes ' + esc(fmtShort(f.closes_on)) : ''}</p><div class="card-actions"><button class="btn small" data-fresp="${esc(f.id)}">Responses</button><button class="btn blue small" data-fshare="${esc(f.id)}">Share / email</button><button class="btn secondary small" data-fedit="${esc(f.id)}">Edit</button><button class="btn secondary small" data-fdel="${esc(f.id)}">Delete</button></div></div>`).join('')}</div>`
        : `<div class="card">${empty('📝', 'No forms yet', 'Make one with “+ New form”, or use the “Sign-up form” button on an evaluation, competition or demo.')}</div>`);
    $('#fnew').onclick = () => formBuilder(null);
    $$('[data-fedit]').forEach(b => b.onclick = () => formBuilder(forms.find(f => f.id === b.dataset.fedit)));
    $$('[data-fshare]').forEach(b => b.onclick = () => shareModal(forms.find(f => f.id === b.dataset.fshare)));
    $$('[data-fresp]').forEach(b => b.onclick = () => responsesModal(b.dataset.fresp));
    $$('[data-fdel]').forEach(b => b.onclick = async () => { if (confirm('Delete this form and all its responses?')) { await api('forms/' + b.dataset.fdel, { method: 'DELETE' }); toast('Deleted'); show('forms'); } });
  };

  function formBuilder(f) {
    let qs = (f?.fields || [{ id: '', type: 'text', label: '', required: true, options: [] }]).map(q => ({ ...q, options: q.options || [] }));
    const who = f ? (f.audience === 'anyone' ? 'anyone' : f.per_child ? 'child' : 'family') : 'child';
    const m = openModal(f ? 'Edit form' : 'New form', `<form id="fb"><div class="form-grid"><label class="wide">Title<input name="title" required maxlength="200" value="${esc(f?.title || '')}" placeholder="e.g. Spring picnic RSVP"></label><label class="wide">Description (optional)<textarea name="description" rows="2">${esc(f?.description || '')}</textarea></label>
      <label>Who fills it in<select name="who"><option value="child" ${who === 'child' ? 'selected' : ''}>Parents — once for each child</option><option value="family" ${who === 'family' ? 'selected' : ''}>Parents — once per family</option><option value="anyone" ${who === 'anyone' ? 'selected' : ''}>Anyone with the link (asks name & email)</option></select></label>
      <label>Closes on (optional)<input type="date" name="closes_on" value="${esc(f?.closes_on || '')}"></label>${f ? `<label class="check"><input type="checkbox" name="closed" ${f.status === 'closed' ? 'checked' : ''}> Closed (no new responses)</label>` : ''}</div>
      ${f && f.kind !== 'general' ? '<p class="muted">This is a sign-up form: when a parent submits it, the child is added to the ' + esc(f.kind) + ' automatically.</p>' : ''}
      <h4>Questions</h4><div id="fbq"></div><button type="button" class="btn secondary small" id="fbadd">+ Add a question</button>
      <div class="modal-actions"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn">${f ? 'Save form' : 'Create form'}</button></div></form>`, { wide: true });
    const draw = () => {
      m.$('#fbq').innerHTML = qs.map((q, i) => `<div class="q-edit" data-i="${i}"><span class="muted">${i + 1}.</span><input data-k="label" value="${esc(q.label)}" placeholder="Question"><select data-k="type">${TYPES.map(([k, l]) => `<option value="${k}" ${q.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select><label class="check"><input type="checkbox" data-k="required" ${q.required ? 'checked' : ''}> Required</label><button type="button" class="icon-btn" data-up aria-label="Move up">↑</button><button type="button" class="icon-btn" data-rm aria-label="Remove question">✕</button>${['choice', 'multi'].includes(q.type) ? `<input class="q-opts" data-k="options" value="${esc(q.options.join(', '))}" placeholder="Choices, separated by commas — e.g. Small, Medium, Large">` : ''}</div>`).join('') || '<p class="muted">No questions yet.</p>';
      m.$$('.q-edit').forEach(row => {
        const q = qs[+row.dataset.i];
        row.querySelectorAll('[data-k]').forEach(el => el.oninput = el.onchange = () => { const k = el.dataset.k; q[k] = k === 'required' ? el.checked : k === 'options' ? el.value.split(',').map(s => s.trim()).filter(Boolean) : el.value; if (k === 'type') draw(); });
        row.querySelector('[data-rm]').onclick = () => { qs.splice(+row.dataset.i, 1); draw(); };
        row.querySelector('[data-up]').onclick = () => { const i = +row.dataset.i; if (i) { [qs[i - 1], qs[i]] = [qs[i], qs[i - 1]]; draw(); } };
      });
    };
    m.$('#fbadd').onclick = () => { qs.push({ id: '', type: 'text', label: '', required: false, options: [] }); draw(); m.$$('.q-edit [data-k=label]').pop()?.focus(); };
    draw();
    m.$('#fb').onsubmit = async e => {
      e.preventDefault(); const fd = new FormData(e.target), whoV = fd.get('who');
      const body = { title: fd.get('title'), description: fd.get('description'), closes_on: fd.get('closes_on'), audience: whoV === 'anyone' ? 'anyone' : 'parents', per_child: whoV === 'child', status: fd.get('closed') ? 'closed' : 'open', fields: qs.filter(q => q.label.trim()) };
      try { const r = await api('forms' + (f ? '/' + f.id : ''), { method: f ? 'PUT' : 'POST', body: JSON.stringify(body) }); toast(f ? 'Form saved' : 'Form created'); m.close(); await show('forms'); if (!f) shareModal((await api('forms')).find(x => x.id === r.id)); } catch (err) { toast(err.message); }
    };
  }

  async function shareModal(f) {
    if (!f) return;
    const [centers, students] = await Promise.all([api('centers'), api('students')]);
    const url = formUrl(f.id);
    const m = openModal('Share · ' + f.title, `<h4>Link</h4><div class="toolbar"><input id="flink" readonly value="${esc(url)}"><button class="btn small" id="fcopy">Copy link</button><a class="btn secondary small" href="${esc(url)}" target="_blank" rel="noopener">Preview</a></div><p class="muted">${f.audience === 'anyone' ? 'Anyone with this link can fill it in.' : 'Parents open the link and sign in to choose their child.'}</p>
      <h4>Email it</h4><form id="femail"><div class="form-grid"><label>Send to<select name="atype"><option value="all">All parents</option><option value="center">One center</option><option value="students">Specific students</option></select></label><label data-c hidden>Center<select name="center">${centers.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label><div class="wide" data-s hidden><div class="roster-list">${students.filter(s => s.active !== 0).map(s => `<label class="roster-person"><input type="checkbox" name="stu" value="${esc(s.id)}"><span><b>${esc(nameOf(s))}</b><small>${esc(s.parent_email || 'no email')}</small></span></label>`).join('')}</div></div><label class="wide">Short message (optional)<textarea name="message" rows="2" placeholder="e.g. Please sign up by Friday!"></textarea></label></div><div class="modal-actions"><button class="btn">✉ Email the form</button></div></form>
      <h4>Add to announcements</h4><form id="fann"><div class="form-grid"><label class="wide">Announcement title<input name="title" value="${esc(f.title)}"></label><label class="wide">Message<textarea name="body" rows="2">${esc(f.description || '')}</textarea></label><label>Center<select name="center_id"><option value="">All centers</option>${centers.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label><label class="check"><input type="checkbox" name="pinned" checked> Pin to the top</label></div><div class="modal-actions"><button class="btn blue">📣 Post announcement with the form</button></div></form>`, { wide: true });
    m.$('#fcopy').onclick = () => copyText(url);
    const ef = m.$('#femail'), at = ef.elements.namedItem('atype');
    at.onchange = () => { m.$('[data-c]').hidden = at.value !== 'center'; m.$('[data-s]').hidden = at.value !== 'students'; };
    ef.onsubmit = async e => { e.preventDefault(); const fd = new FormData(ef); const audience = { type: fd.get('atype'), center_id: fd.get('center'), student_ids: fd.getAll('stu') };
      if (!confirm('Email this form to parents now?')) return;
      try { const r = await api('forms/' + f.id + '/email', { method: 'POST', body: JSON.stringify({ audience, message: fd.get('message') }) }); toast(`Emailed to ${r.sent} parent${r.sent === 1 ? '' : 's'}${r.failed ? ` · ${r.failed} failed` : ''}`); } catch (err) { toast(err.message); } };
    m.$('#fann').onsubmit = async e => { e.preventDefault(); const fd = new FormData(e.target);
      try { await api('forms/' + f.id + '/announce', { method: 'POST', body: JSON.stringify({ title: fd.get('title'), body: fd.get('body'), center_id: fd.get('center_id'), pinned: !!fd.get('pinned') }) }); toast('Posted — parents see it under Announcements'); } catch (err) { toast(err.message); } };
  }

  async function responsesModal(id) {
    const d = await api('forms/' + id + '/responses'), f = d.form;
    const rows = d.responses, who = r => r.first_name ? r.first_name + ' ' + r.last_name : r.name || '—';
    const m = openModal('Responses · ' + f.title, `<div class="toolbar"><b>${rows.length} response${rows.length === 1 ? '' : 's'}</b><button class="btn secondary small" id="fcsv" ${rows.length ? '' : 'disabled'}>Download CSV</button></div>${f.kind === 'evaluation' ? '<p class="muted">Children signed up here were added to the evaluation\'s students automatically — assign their evaluators on the Evaluations page.</p>' : f.kind === 'demo' ? '<p class="muted">Children who answered “Yes” were added to the demo automatically.</p>' : ''}
      ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>${f.per_child ? 'Child' : 'Name'}</th><th>Parent</th>${f.fields.map(q => `<th>${esc(q.label)}</th>`).join('')}<th>Updated</th></tr></thead><tbody>${rows.map(r => `<tr><td><b>${esc(who(r))}</b></td><td>${esc(r.parent_name || r.name || '')}<br><small class="muted">${esc(r.parent_email || r.email || '')}</small></td>${f.fields.map(q => `<td>${esc(answerText(q, r.answers[q.id]))}</td>`).join('')}<td>${esc(fmtStamp(r.updated_at))}</td></tr>`).join('')}</tbody></table></div>` : empty('📭', 'No responses yet', 'Share the link or email the form to parents.')}`, { wide: true });
    m.$('#fcsv').onclick = () => { const cell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"'; const csv = [[f.per_child ? 'Child' : 'Name', 'Parent', 'Email', ...f.fields.map(q => q.label), 'Updated'], ...rows.map(r => [who(r), r.parent_name || r.name, r.parent_email || r.email, ...f.fields.map(q => answerText(q, r.answers[q.id])), r.updated_at])].map(r => r.map(cell).join(',')).join('\r\n'); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })); a.download = f.title.replace(/[^\w]+/g, '-') + '.csv'; a.click(); };
  }

  /* ---------- "Sign-up form" buttons on evaluations, competitions and demos ---------- */
  async function openAuto(kind, refId) {
    try { const r = await api('forms/auto', { method: 'POST', body: JSON.stringify({ kind, ref_id: refId }) }); toast(r.existed ? 'This event already has a sign-up form' : 'Sign-up form created'); await show('forms'); shareModal((await api('forms')).find(f => f.id === r.id)); } catch (e) { toast(e.message); }
  }
  const _events = PAGES.events;
  PAGES.events = async () => {
    await _events();
    $$('.event-card').forEach(card => { const id = card.querySelector('[data-edit]')?.dataset.edit, act = card.querySelector('.card-actions'); if (id && act && !card.querySelector('.type-other')) act.insertAdjacentHTML('beforeend', `<button class="btn secondary small" data-autof="${esc(id)}">📝 Sign-up form</button>`); });
    $$('[data-autof]').forEach(b => b.onclick = () => openAuto('event', b.dataset.autof));
  };
  const _demos = PAGES.demos;
  PAGES.demos = async () => {
    await _demos();
    $$('[data-dedit]').forEach(b => b.closest('.card-actions')?.insertAdjacentHTML('beforeend', `<button class="btn secondary small" data-autod="${esc(b.dataset.dedit)}">📝 Sign-up form</button>`));
    $$('[data-autod]').forEach(b => b.onclick = () => openAuto('demo', b.dataset.autod));
  };

  /* ---------- parents: forms in announcements, a Sign-ups page, and the form itself ---------- */
  document.addEventListener('click', e => { const b = e.target.closest('[data-open-form]'); if (!b) return; e.preventDefault(); state.formId = b.dataset.openForm; show(state.role === 'parent' ? 'p_form' : 'forms'); });
  const formStatus = (f, kids) => f.per_child ? kids.map(k => { const r = f.responses.find(x => x.student_id === k.id); return `<span class="chip ${r ? 'ok' : 'warn'}">${esc(k.first_name)}: ${r ? (f.kind === 'demo' && r.answers.attend === 'No' ? 'not going' : 'signed up ✓') : 'not yet'}</span>`; }).join(' ') : `<span class="chip ${f.responses.length ? 'ok' : 'warn'}">${f.responses.length ? 'Sent ✓' : 'Not sent yet'}</span>`;
  const formCard = (f, kids) => `<article class="card form-card"><div class="chips"><span class="chip ${f.kind === 'general' ? '' : 'type-' + esc(f.kind)}">${KIND[f.kind] || 'Form'}</span>${f.closes_on ? `<small class="muted">Respond by ${esc(fmtShort(f.closes_on))}</small>` : ''}</div><h3>${esc(f.title)}</h3>${f.description ? `<p class="muted">${esc(f.description)}</p>` : ''}<div class="chips">${formStatus(f, kids)}</div><div class="card-actions"><button class="btn small" data-open-form="${esc(f.id)}">${f.responses.length ? 'View or change' : f.kind === 'general' ? 'Fill out' : 'Sign up'}</button></div></article>`;
  PAGES.p_forms = async () => {
    const d = await loadHome(), forms = d.forms || [];
    $('#content').innerHTML = hero('Sign-ups & forms', 'Sign your children up for evaluations, competitions and demos, and fill in forms from MFU.') + (forms.length ? forms.map(f => formCard(f, d.children)).join('') : `<div class="card">${empty('📝', 'Nothing to fill in right now', 'New sign-ups and forms from MFU will show up here and in Announcements.')}</div>`);
  };
  PAGES.p_form = async () => {
    const d = state.home || await loadHome();
    let f = (d.forms || []).find(x => x.id === state.formId);
    if (!f) { try { f = { ...(await api('parent/forms/' + state.formId)), responses: [] }; } catch (e) { $('#content').innerHTML = `<div class="card">${empty('📝', 'Form not found', e.message)}</div>`; return; } }
    const kids = d.children;
    let kid = f.per_child ? (kids.find(k => k.id === state.formKid) || kids.find(k => !f.responses.some(r => r.student_id === k.id)) || kids[0]) : null;
    const resp = () => f.per_child ? f.responses.find(r => r.student_id === kid?.id) : f.responses[0];
    const draw = () => {
      const r = resp();
      $('#content').innerHTML = `<div class="card form-fill"><div class="chips"><span class="chip ${f.kind === 'general' ? '' : 'type-' + esc(f.kind)}">${KIND[f.kind] || 'Form'}</span>${f.closes_on ? `<small class="muted">Respond by ${esc(fmtShort(f.closes_on))}</small>` : ''}</div><h2>${esc(f.title)}</h2>${f.description ? `<p class="muted">${esc(f.description)}</p>` : ''}
        ${!f.open ? '<p class="notice warn-n">This form is closed.</p>' : ''}
        ${f.per_child ? (kids.length ? `<div class="seg kid-seg">${kids.map(k => `<button type="button" data-fk="${esc(k.id)}" class="${k.id === kid?.id ? 'active' : ''}">${esc(k.first_name)}${f.responses.some(x => x.student_id === k.id) ? ' ✓' : ''}</button>`).join('')}</div>` : '<p class="muted">No children are linked to your account yet.</p>') : ''}
        ${r ? `<p class="chip ok">You already sent this${f.per_child ? ' for ' + esc(kid.first_name) : ''} on ${esc(fmtStamp(r.updated_at))} — change anything and send again to update it.</p>` : ''}
        <form id="ff"><div class="form-grid">${f.fields.map(q => fieldHtml(q, r?.answers[q.id])).join('')}</div><p class="error" id="fferr"></p><div class="modal-actions"><button type="button" class="btn secondary" id="ffback">Back</button><button class="btn" ${!f.open || (f.per_child && !kid) ? 'disabled' : ''}>${r ? 'Update' : f.kind === 'general' ? 'Send' : 'Sign up' + (kid ? ' ' + esc(kid.first_name) : '')}</button></div></form></div>`;
      $$('[data-fk]').forEach(b => b.onclick = () => { kid = kids.find(k => k.id === b.dataset.fk); state.formKid = kid.id; draw(); });
      $('#ffback').onclick = () => show('p_forms');
      $('#ff').onsubmit = async e => {
        e.preventDefault(); $('#fferr').textContent = '';
        try {
          const answers = readAnswers(e.target, f.fields);
          await api('parent/forms/' + f.id, { method: 'POST', body: JSON.stringify({ student_id: kid?.id, answers }) });
          const i = f.responses.findIndex(x => f.per_child ? x.student_id === kid?.id : true); const nr = { student_id: kid?.id || null, answers, updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19) };
          if (i >= 0) f.responses[i] = nr; else f.responses.push(nr);
          state.home = null;
          toast(f.kind === 'general' ? 'Sent — thank you!' : `${kid ? kid.first_name : 'Your child'} is signed up`);
          const next = f.per_child && kids.find(k => !f.responses.some(x => x.student_id === k.id));
          if (next) { kid = next; draw(); toast(`Signed up! Now ${next.first_name}?`); } else show('p_forms');
        } catch (err) { $('#fferr').textContent = err.message; }
      };
    };
    draw();
  };
  // Parent home: point out sign-ups that still need an answer.
  const _home = PAGES.home;
  PAGES.home = async () => {
    await _home();
    const d = state.home, kids = d?.children || [];
    const todo = (d?.forms || []).filter(f => f.per_child ? kids.some(k => !f.responses.some(r => r.student_id === k.id)) : !f.responses.length);
    if (todo.length) $('#content .welcome')?.insertAdjacentHTML('afterend', `<div class="card"><h3>📝 Waiting for you</h3>${todo.slice(0, 4).map(f => `<div class="mini-event"><div><b>${esc(f.title)}</b><small>${KIND[f.kind] || 'Form'}${f.closes_on ? ' · respond by ' + esc(fmtShort(f.closes_on)) : ''}</small></div><button class="btn small" data-open-form="${esc(f.id)}">${f.kind === 'general' ? 'Fill out' : 'Sign up'}</button></div>`).join('')}${todo.length > 4 ? '<button class="btn secondary small" data-go="p_forms">See all</button>' : ''}</div>`);
    $$('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go));
  };
  // Parent announcements: open sign-ups first, then each announcement shows its form button.
  const _pann = PAGES.p_announcements;
  PAGES.p_announcements = async () => {
    state.home = null; await loadHome(); await _pann();
    const forms = state.home?.forms || [];
    if (forms.length) $('#content .welcome')?.insertAdjacentHTML('afterend', `<h3 class="group-title">Open sign-ups & forms</h3>${forms.map(f => formCard(f, state.home.children)).join('')}<h3 class="group-title">Announcements</h3>`);
  };

  /* ---------- share links: /#form=ID ---------- */
  const m = /^#form=([\w-]+)$/.exec(location.hash);
  if (m) { try { sessionStorage.setItem('mfu-form', m[1]); } catch { /* ignore */ } history.replaceState(null, '', location.pathname); }
  const pending = () => { try { return sessionStorage.getItem('mfu-form'); } catch { return null; } };
  const clearPending = () => { try { sessionStorage.removeItem('mfu-form'); } catch { /* ignore */ } };
  // After signing in, go straight to the form from the link.
  const _setRole = setRole;
  setRole = function (role, me) {
    _setRole(role, me);
    const id = pending(); if (!id) return;
    clearPending(); state.formId = id;
    setTimeout(() => show(role === 'parent' ? 'p_form' : 'forms'), 400);
  };
  // Signed out: "anyone" forms open right away; parent forms ask the parent to sign in first.
  document.addEventListener('DOMContentLoaded', () => setTimeout(async () => {
    const id = pending(); if (!id || state.role) return;
    let f; try { f = await api('public-form/' + id); } catch (e) { clearPending(); toast(e.message); return; }
    if (f.needs_login) { loginView('parent'); $('#login')?.insertAdjacentHTML('afterbegin', `<p class="notice form-login-note"><span>Sign in to fill out <b>${esc(f.title)}</b>. New to MFU? Create an account below.</span></p>`); return; }
    clearPending();
    authCard(`<h2>${esc(f.title)}</h2>${f.description ? `<p>${esc(f.description)}</p>` : ''}${f.open ? `<form id="pubf" class="signup-form"><label>Your name<input name="pname" required></label><label>Your email<input name="pemail" type="email" required></label>${f.fields.map(q => fieldHtml(q)).join('')}<button class="primary">Send</button><p id="login-error" class="error" role="alert"></p></form>` : '<p class="error">This form is closed.</p>'}<p class="center"><a href="#" id="back">Go to sign in</a></p>`);
    $('#back').onclick = ev => { ev.preventDefault(); loginView('parent'); };
    $('#pubf') && ($('#pubf').onsubmit = async ev => { ev.preventDefault(); const fd = new FormData(ev.target);
      try { await api('public-form/' + id, { method: 'POST', body: JSON.stringify({ name: fd.get('pname'), email: fd.get('pemail'), answers: readAnswers(ev.target, f.fields) }) }); authCard(`<h2>Thank you!</h2><p>Your response to “${esc(f.title)}” was sent.</p><p class="center"><a href="#" id="back">Go to sign in</a></p>`); $('#back').onclick = e2 => { e2.preventDefault(); loginView('parent'); }; }
      catch (err) { $('#login-error').textContent = err.message; } });
  }, 900));
})();
