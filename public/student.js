/* MFU student accounts: a Student tab on sign-in, student sign-up (MFU links it to the right student record),
   the student's own portal (the parent pages, about themselves), admin review of student sign-ups, and the
   demo plan (running order and pyramids) that parents and students can open from a demo.
   Loaded after signin.js (wraps loginView; uses api, esc, toast, openModal, show, hero, empty, nameOf, state, NAV, PAGES, titles, $, $$). */
(() => {
  NAV.student = [['', [['home', 'My page'], ['chats', 'Chats'], ['p_skills', 'Skills'], ['p_practice', 'Home practice'], ['p_announcements', 'Announcements'], ['p_events', 'Events'], ['p_links', 'Forms & links'], ['account', 'Account']]]];

  // ---- sign-in: a Student tab, and a sign-up link for students ----
  const _login = loginView;
  // eslint-disable-next-line no-global-assign
  loginView = function (mode = 'parent') {
    _login(mode);
    const seg = $('.seg'); if (!seg) return;
    if (!seg.querySelector('[data-mode="student"]')) {
      seg.querySelector('[data-mode="coach"]').insertAdjacentHTML('beforebegin', `<button type="button" data-mode="student" class="${mode === 'student' ? 'active' : ''}">Student</button>`);
      seg.querySelector('[data-mode="student"]').onclick = () => loginView('student');
    }
    if (mode !== 'student') return;
    const intro = seg.nextElementSibling; if (intro?.tagName === 'P') intro.textContent = 'Sign in to see your skills, notes from your coaches, your classes and demos.';
    $('#forgot')?.closest('p')?.remove(); // students sign in with a code; a forgotten password is not a dead end
    $$('.signup-link').forEach(p => p.remove());
    $('#login').insertAdjacentHTML('beforeend', '<p class="center signup-link">New here? <a href="#" id="ssignup">Create a student account</a></p>');
    const link = $('#login .signup-link'); if ($('#usepw')) $('#usepw').parentElement.after(link);
    $('#ssignup').onclick = e => { e.preventDefault(); signupForm(); };
  };

  function signupForm() {
    authCard(`<h2>Create a student account</h2><p>MFU checks it belongs to you, then you can sign in. Use your own email, not your parent's.</p>
      <form id="ssf" class="form-grid">
        <label>First name<input name="first_name" required autocomplete="given-name"></label><label>Last name<input name="last_name" required autocomplete="family-name"></label>
        <label>Date of birth<input type="date" name="dob" required></label><label>Parent's email<input type="email" name="parent_email" autocomplete="off"></label>
        <label class="wide">Your email<input type="email" name="email" required autocomplete="username"></label>
        <label class="wide">Password<input type="password" name="password" required minlength="8" autocomplete="new-password" aria-describedby="sspw"></label><p class="muted wide" id="sspw">At least 8 characters with a letter and a number.</p>
        <button class="primary wide">Create account</button><p class="error wide" id="sserr" role="alert"></p>
        <p class="center wide"><a href="#" id="ssback">Back to sign in</a></p></form>`);
    $('#ssback').onclick = e => { e.preventDefault(); loginView('student'); };
    $('#ssf').onsubmit = async e => {
      e.preventDefault(); const b = e.target.querySelector('button.primary'); b.disabled = true; $('#sserr').textContent = '';
      try { await api('student/signup', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) }); authCard('<h2>Account requested</h2><p>MFU will check it and link it to your student record. Then sign in with this email.</p><p class="center"><a href="#" id="ssback">Back to sign in</a></p>'); $('#ssback').onclick = ev => { ev.preventDefault(); loginView('student'); }; }
      catch (err) { $('#sserr').textContent = err.message; b.disabled = false; }
    };
  }

  // The home page is about the student, not "my children".
  const _home = PAGES.home;
  PAGES.home = async () => { await _home(); if (state.role === 'student') $('#title').textContent = 'My page'; };

  // ---- the student's account page ----
  const _account = PAGES.account;
  PAGES.account = async () => {
    if (state.role !== 'student') return _account();
    $('#content').innerHTML = hero('Account', 'Signed in as ' + esc(state.me?.email || '')) + `<div class="card narrow"><h3>Your sign-in</h3><p class="muted">Sign in with your email: a code, Google, or your password. Forgot your password? Choose "Email me a sign-in code" on the sign-in page.</p></div>`;
  };

  // ---- admin: student sign-ups waiting to be linked ----
  const _signups = PAGES.signups;
  PAGES.signups = async () => {
    await _signups();
    const [reqs, students] = await Promise.all([api('student-requests').catch(() => []), reqsStudents()]);
    if (!reqs.length) return;
    const norm = s => (s || '').trim().toLowerCase();
    const guess = r => students.find(s => norm(s.first_name) === norm(r.first_name) && norm(s.last_name) === norm(r.last_name))?.id || '';
    const opts = cur => `<option value="">Choose the student…</option>${students.map(s => `<option value="${esc(s.id)}" ${s.id === cur ? 'selected' : ''}>${esc(nameOf(s))}${s.dob ? ' · ' + esc(s.dob) : ''}</option>`).join('')}`;
    $('#content').insertAdjacentHTML('beforeend', `<div class="card" id="sreq"><h3>Student accounts waiting</h3><p class="muted">Link each one to the student it belongs to. The student can then sign in and see their own page.</p>
      ${reqs.map(r => `<div class="note" data-sreq="${esc(r.id)}"><div class="note-head"><b>${esc(r.first_name + ' ' + (r.last_name || ''))}</b><small class="muted">${esc(r.email)}${r.dob ? ' · born ' + esc(r.dob) : ''}${r.parent_email ? ' · parent ' + esc(r.parent_email) : ''}</small></div>
        <div class="card-actions"><select aria-label="Student record for ${esc(r.first_name)}">${opts(guess(r))}</select><button class="btn small" data-act="link">Link account</button><button class="btn secondary small" data-act="reject">Decline</button></div></div>`).join('')}</div>`);
    $$('#sreq [data-act]').forEach(b => b.onclick = async () => {
      const row = b.closest('[data-sreq]'), body = b.dataset.act === 'reject' ? { action: 'reject' } : { student_id: row.querySelector('select').value };
      if (body.student_id === '') return toast('Choose the student first.');
      try { await api('student-requests/' + row.dataset.sreq, { method: 'POST', body: JSON.stringify(body) }); toast(body.action ? 'Declined' : 'Linked. They can sign in now.'); row.remove(); } catch (e) { toast(e.message); }
    });
  };
  const reqsStudents = () => api('students').then(l => l.filter(s => s.active !== 0).sort((a, b) => nameOf(a).localeCompare(nameOf(b)))).catch(() => []);

  // ---- the demo plan: running order and pyramids, with this child's spots marked ----
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-plan]'); if (!b) return;
    const plan = state.home?.plans?.[b.dataset.plan], kid = b.dataset.kid; if (!plan) return;
    const mmss = s => s ? Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') : '';
    const order = plan.lineup.length ? `<h4>Running order</h4><ol class="plan-order">${plan.lineup.map(l => `<li class="${l.kind === 'solo' && l.ref_id === kid ? 'mine' : ''}"><b>${esc((l.label || '').trim() || 'Item')}</b><small class="muted">${l.kind === 'solo' ? 'Solo' : l.kind === 'pyramid' ? 'Pyramid' : 'Routine'}${l.duration ? ' · ' + mmss(l.duration) : ''}${l.song_title ? ' · ' + esc(l.song_title) : ''}</small></li>`).join('')}</ol>` : '';
    const pyrs = plan.pyramids.map(p => {
      const mine = p.spots.map((s, i) => s.student_id === kid ? i : -1).filter(i => i >= 0);
      return `<div class="plan-pyr"><h4>${esc(p.name)}</h4>${window.mfuPyramidDiagram ? window.mfuPyramidDiagram(p.spots, mine[0] ?? -1, p.apparatus === 'rope' ? 'rope' : 'pole') : ''}
        <ol class="plan-spots">${p.spots.map(s => `<li class="${s.student_id === kid ? 'mine' : ''}">${esc((s.student || '').trim() || 'Open spot')}${s.skill ? ' · ' + esc(s.skill) : ''}</li>`).join('')}</ol></div>`;
    }).join('');
    openModal(b.dataset.title || 'Demo plan', (order + (pyrs ? `<h4>Pyramids</h4><div class="plan-pyrs">${pyrs}</div>` : '')) || '<p class="muted">The coaches have not made the plan yet.</p>');
  });
})();
