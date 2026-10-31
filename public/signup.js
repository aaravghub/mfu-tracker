/* MFU Tracker — parent and coach sign-up from the sign-in page, and the admin's Sign-ups review page
   (approve or decline; link each child to a student who is already here, or create them). Loaded after extra.js/features.js. */
'use strict';
(() => {
  const cap = s => s ? s[0].toUpperCase() + s.slice(1) : '';
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  const lev = (a, b) => { const d = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i++) { let p = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; } } return d[b.length]; };
  const close = (a, b) => a && b && (a === b || (Math.min(a.length, b.length) >= 4 && lev(a, b) <= 2) || a.startsWith(b) || b.startsWith(a));
  Object.assign(titles, { signups: 'Sign-ups' });
  // Sign-ups are reviewed by the admin only.
  NAV.admin = NAV.admin.map(([label, items]) => label === 'Families' ? [label, [['signups', 'Sign-ups'], ...items]] : [label, items]);

  /* ---------- sign-up forms ---------- */
  const PW_HINT = 'At least 8 characters with a letter and a number.';
  window.signupView = function (mode = 'parent') {
    const kidRow = i => `<div class="kid-row" data-k="${i}"><label>First name<input name="kf" required autocomplete="off"></label><label>Last name<input name="kl" required autocomplete="off"></label><label>Age<input name="ka" type="number" min="2" max="25" required></label>${i ? '<button type="button" class="icon-btn" data-rmkid aria-label="Remove this child">✕</button>' : '<span></span>'}</div>`;
    authCard(`<h2>${mode === 'parent' ? 'Create a parent account' : 'Create a coach account'}</h2><p>${mode === 'parent' ? 'Tell us about you and your children. MFU reviews every new account — we\'ll email you once it\'s approved.' : 'MFU reviews every new coach account — we\'ll email you once it\'s approved.'}</p>
      <form id="suf" class="signup-form"><label>Your full name<input name="name" required autocomplete="name"></label><label>Email<input name="email" type="email" required autocomplete="email"></label><label>Phone number<input name="phone" type="tel" required autocomplete="tel"></label>
      ${mode === 'parent' ? `<label>Home address<textarea name="address" rows="2" required autocomplete="street-address"></textarea></label>
        <fieldset><legend>Emergency contact</legend><div class="two"><label>Name<input name="emergency_name" required></label><label>Phone<input name="emergency_phone" type="tel" required></label></div></fieldset>
        <fieldset><legend>Your children</legend><div id="kids">${kidRow(0)}</div><button type="button" class="btn secondary small" id="addkid">+ Add another child</button></fieldset>`
      : `<label>Age<input name="age" type="number" min="14" max="99" required></label>`}
      <label>Choose a password<input name="password" type="password" required minlength="8" autocomplete="new-password"><small class="muted">${PW_HINT}</small></label><label>Confirm password<input name="password2" type="password" required minlength="8" autocomplete="new-password"></label>
      <button class="primary">Create account</button><p id="login-error" class="error" role="alert"></p><p class="center"><a href="#" id="back">Back to sign in</a></p></form>`);
    $('#back').onclick = e => { e.preventDefault(); loginView(mode); };
    let n = 1;
    const wireKids = () => $$('[data-rmkid]').forEach(b => b.onclick = () => b.closest('.kid-row').remove());
    $('#addkid') && ($('#addkid').onclick = () => { if ($$('.kid-row').length >= 6) return; $('#kids').insertAdjacentHTML('beforeend', kidRow(n++)); wireKids(); });
    $('#suf').onsubmit = async e => {
      e.preventDefault(); const f = e.target, err = $('#login-error'); err.textContent = '';
      const v = k => f.elements.namedItem(k)?.value || '';
      if (v('password') !== v('password2')) { err.textContent = 'The passwords don\'t match.'; return; }
      if (!/[A-Za-z]/.test(v('password')) || !/\d/.test(v('password'))) { err.textContent = PW_HINT; return; }
      const body = { name: v('name'), email: v('email'), phone: v('phone'), password: v('password') };
      if (mode === 'parent') Object.assign(body, { address: v('address'), emergency_name: v('emergency_name'), emergency_phone: v('emergency_phone'), children: $$('.kid-row').map(r => ({ first_name: r.querySelector('[name=kf]').value, last_name: r.querySelector('[name=kl]').value, age: r.querySelector('[name=ka]').value })) });
      else body.age = v('age');
      const btn = f.querySelector('button.primary'); btn.disabled = true; btn.textContent = 'Creating…';
      try {
        const r = await api('signup/' + mode, { method: 'POST', body: JSON.stringify(body) });
        authCard(`<h2>Thanks — you're signed up!</h2><p>${esc(r.message)}</p><p class="muted">We sent a confirmation to ${esc(body.email)}.</p><p class="center"><a href="#" id="back">Back to sign in</a></p>`);
        $('#back').onclick = ev => { ev.preventDefault(); loginView(mode); };
      } catch (x) { err.textContent = x.message; btn.disabled = false; btn.textContent = 'Create account'; }
    };
  };

  /* ---------- sign-in page: add the sign-up link under the Parent and Coach forms ---------- */
  const _login = loginView;
  loginView = function (mode = 'parent') {
    _login(mode);
    if (mode === 'admin') return;
    $('#login')?.insertAdjacentHTML('beforeend', `<p class="center signup-link">New to MFU? <a href="#" id="signup">Create a ${mode} account</a></p>`);
    $('#signup').onclick = e => { e.preventDefault(); signupView(mode); };
  };

  /* ---------- admin: review sign-ups ---------- */
  PAGES.signups = async () => {
    const [list, students, centers, parents] = await Promise.all([api('signups'), api('students'), api('centers'), api('parents')]);
    const F = state.suFilter ||= 'pending';
    const shown = list.filter(s => F === 'all' || s.status === 'pending');
    const linked = new Map(); parents.forEach(p => p.students.forEach(k => linked.set(k.id, (linked.get(k.id) || 0) + 1)));
    const sName = s => s.first_name + ' ' + s.last_name;
    // Students who might be this child, best first (handles small spelling differences).
    const matches = k => students.map(s => { const f = close(norm(k.first_name), norm(s.first_name)), l = close(norm(k.last_name), norm(s.last_name)); return { s, score: (norm(sName(s)) === norm(k.first_name + k.last_name) ? 10 : 0) + (f ? 4 : 0) + (l ? 3 : 0) }; }).filter(x => x.score >= 4).sort((a, b) => b.score - a.score).slice(0, 4).map(x => x.s);
    const centerOpts = sel => centers.map(c => `<option value="${esc(c.id)}" ${sel === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
    const kidBlock = (su, k, i) => {
      const m = matches(k);
      return `<div class="su-kid" data-su="${esc(su.id)}" data-i="${i}"><div class="su-kid-head"><b>${esc(k.first_name + ' ' + k.last_name)}</b> <span class="chip">Age ${esc(k.age)}</span></div>
        ${m.map((s, j) => `<label class="pick"><input type="radio" name="k-${esc(su.id)}-${i}" value="link:${esc(s.id)}" ${j === 0 ? 'checked' : ''}><span><b>Link to ${esc(sName(s))}</b><small>${esc(centerName(centers, s.center_id))} · Pole L${s.pole_level} · Rope L${s.rope_level} · Yoga L${s.yoga_level}${s.parent_email ? ' · parent email ' + esc(s.parent_email) : ''}${linked.get(s.id) ? ' · ' + linked.get(s.id) + ' parent account' + (linked.get(s.id) > 1 ? 's' : '') : ''}</small></span></label>`).join('')}
        <label class="pick"><input type="radio" name="k-${esc(su.id)}-${i}" value="search"><span><b>Link to a different student</b><input class="su-search" list="su-students" placeholder="Type a name…" data-search></span></label>
        <label class="pick"><input type="radio" name="k-${esc(su.id)}-${i}" value="new" ${m.length ? '' : 'checked'}><span><b>Add as a new student</b><select data-center>${centerOpts(su.children.length && m[0] ? m[0].center_id : centers[0]?.id)}</select></span></label>
        <label class="pick"><input type="radio" name="k-${esc(su.id)}-${i}" value="skip"><span><b>Don't add this child</b></span></label></div>`;
    };
    $('#content').innerHTML = hero('Sign-ups', 'New parent and coach accounts waiting for review. Approving a parent links each child to a student who is already here — check for spelling differences — or adds them as a new student.') +
      `<datalist id="su-students">${students.map(s => `<option value="${esc(sName(s))} · ${esc(centerName(centers, s.center_id))}"></option>`).join('')}</datalist>` +
      `<div class="seg att-modes" id="suf">${[['pending', `Waiting (${list.filter(s => s.status === 'pending').length})`], ['all', 'All']].map(([k, l]) => `<button type="button" data-f="${k}" class="${F === k ? 'active' : ''}">${l}</button>`).join('')}</div>` +
      (shown.length ? shown.map(su => `<article class="card su-card"><div class="chips"><span class="chip ${su.kind === 'coach' ? 'type-evaluation' : 'type-competition'}">${cap(su.kind)}</span><span class="chip ${su.status === 'pending' ? 'warn' : su.status === 'approved' ? 'ok' : ''}">${cap(su.status)}</span><small class="muted">${esc(fmtStamp(su.created_at))}${su.reviewed_by ? ' · ' + esc(su.status) + ' by ' + esc(su.reviewed_by) : ''}</small></div>
        <h3>${esc(su.name)}</h3><p class="muted"><a href="mailto:${esc(su.email)}">${esc(su.email)}</a> · ${esc(su.phone || '')}${su.age ? ' · age ' + esc(su.age) : ''}${su.address ? '<br>' + esc(su.address) : ''}${su.emergency_name ? `<br>Emergency contact: ${esc(su.emergency_name)} · ${esc(su.emergency_phone || '')}` : ''}</p>
        ${su.status === 'pending' ? (su.kind === 'parent' ? `<h4>Children</h4>${su.children.map((k, i) => kidBlock(su, k, i)).join('')}` : `<label class="su-center">Center (optional)<select data-coach-center="${esc(su.id)}"><option value="">Choose later</option>${centerOpts('')}</select></label>`) + `<div class="card-actions"><button class="btn" data-approve="${esc(su.id)}">Approve</button><button class="btn secondary" data-decline="${esc(su.id)}">Decline</button></div>`
          : su.kind === 'parent' ? `<p class="muted">Children: ${su.children.map(k => esc(k.first_name + ' ' + k.last_name)).join(', ')}</p>` : ''}${su.note ? `<p class="muted">Note: ${esc(su.note)}</p>` : ''}</article>`).join('')
        : `<div class="card">${empty('📝', F === 'pending' ? 'No sign-ups waiting' : 'No sign-ups yet', 'New parent and coach sign-ups from the sign-in page show up here.')}</div>`);
    $$('#suf button').forEach(b => b.onclick = () => { state.suFilter = b.dataset.f; show('signups'); });
    // Typing in "link to a different student" selects that option.
    $$('[data-search]').forEach(i => i.oninput = () => { i.closest('.pick').querySelector('input[type=radio]').checked = true; });
    $$('[data-center]').forEach(s => s.onchange = () => { s.closest('.pick').querySelector('input[type=radio]').checked = true; });
    $$('[data-approve]').forEach(b => b.onclick = async () => {
      const su = list.find(x => x.id === b.dataset.approve), body = {};
      if (su.kind === 'parent') {
        body.children = [];
        for (let i = 0; i < su.children.length; i++) {
          const box = $(`.su-kid[data-su="${CSS.escape(su.id)}"][data-i="${i}"]`), choice = box.querySelector('input[type=radio]:checked')?.value || '';
          if (choice.startsWith('link:')) body.children.push({ index: i, student_id: choice.slice(5) });
          else if (choice === 'search') {
            const typed = box.querySelector('[data-search]').value.split(' · ')[0].trim().toLowerCase(), s = students.find(x => sName(x).toLowerCase() === typed);
            if (!s) return toast(`Pick a student from the list for ${su.children[i].first_name}`);
            body.children.push({ index: i, student_id: s.id });
          } else if (choice === 'new') body.children.push({ index: i, center_id: box.querySelector('[data-center]').value });
          else body.children.push({ index: i, skip: true });
        }
      } else body.center_id = $(`[data-coach-center="${CSS.escape(su.id)}"]`)?.value || null;
      if (!confirm(`Approve ${su.name}'s ${su.kind} account?`)) return;
      b.disabled = true;
      try { const r = await api('signups/' + su.id + '/approve', { method: 'POST', body: JSON.stringify(body) }); toast(`Approved${r.emailed ? ' · ' + su.name + ' was emailed' : ''}`); show('signups'); } catch (e) { toast(e.message); b.disabled = false; }
    });
    $$('[data-decline]').forEach(b => b.onclick = async () => {
      const su = list.find(x => x.id === b.dataset.decline), reason = prompt(`Decline ${su.name}'s sign-up? You can add a short note for them (optional):`, '');
      if (reason === null) return;
      try { const r = await api('signups/' + su.id + '/decline', { method: 'POST', body: JSON.stringify({ reason }) }); toast('Declined' + (r.emailed ? ' · they were emailed' : '')); show('signups'); } catch (e) { toast(e.message); }
    });
  };

  /* ---------- admin overview: pending sign-ups ---------- */
  const _ov = PAGES.overview;
  PAGES.overview = async () => {
    await _ov();
    if (state.role !== 'admin') return;
    const n = (await api('signups').catch(() => [])).filter(s => s.status === 'pending').length;
    if (n) { $('#content .stats')?.insertAdjacentHTML('beforebegin', `<div class="notice"><div><b>${n} new sign-up${n > 1 ? 's' : ''} waiting for review</b><br><small>Approve or decline new parent and coach accounts.</small></div><button class="btn" id="go-su">Review sign-ups</button></div>`); $('#go-su').onclick = () => show('signups'); }
  };
})();
