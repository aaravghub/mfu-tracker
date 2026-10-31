/* MFU Tracker — going back (Ctrl+Z, Back button, phone back gesture), the first-login tutorial for each role,
   and phone helpers (bottom tab bar, tables that turn into cards). Loaded last; wraps show() and setRole(). */
'use strict';
(() => {
  /* ---------- history: every page change can be undone ---------- */
  const stack = [];
  let restoring = false, firstShow = true;
  const snap = () => ({ page: state.page, studentId: state.studentId, studentTab: state.studentTab });
  const key = s => s.page + '|' + (s.page === 'student' ? s.studentId : '');
  const _show = show;
  show = function (page, ...rest) {
    // After editing a student from their profile, come back to the profile instead of the list.
    if (page === 'students' && state.afterSave) { page = state.afterSave; state.afterSave = null; }
    const from = snap();
    if (!restoring && !firstShow && state.role && from.page && key(from) !== key({ page, studentId: state.studentId })) {
      stack.push(from); if (stack.length > 60) stack.shift();
      try { history.pushState({ mfu: true }, ''); } catch { /* ignore */ }
    }
    firstShow = false;
    const r = _show(page, ...rest);
    Promise.resolve(r).finally(() => { updateChrome(); labelTables(); });
    return r;
  };

  const openOverlay = () => [...document.querySelectorAll('.modal-bg, body > div[style*="position:fixed"]')].filter(el => !el.closest('.tour')).pop();
  function back() {
    const modal = openOverlay();
    if (modal) { modal.click(); return true; } // a click on the dimmed backdrop closes every popup in the app
    if (stack.length) { history.back(); return true; }
    toast('This is the first page — nothing to go back to');
    return false;
  }
  window.goBack = back;
  addEventListener('popstate', () => {
    if (!state.role || !stack.length) return;
    const prev = stack.pop();
    Object.assign(state, { studentId: prev.studentId, studentTab: prev.studentTab });
    restoring = true; show(prev.page); restoring = false;
  });
  // Ctrl+Z / ⌘Z goes back everywhere. Inside a text box that has text, it undoes typing as usual.
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z' || !state.role || tour.active) return;
    const field = e.target.closest?.('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]),textarea,[contenteditable]');
    if (field && (field.value || field.textContent)) return;
    e.preventDefault(); back();
  });

  /* ---------- header buttons and phone tab bar ---------- */
  const headTitle = $('.head-title'), headActions = $('.header-actions');
  headTitle.insertAdjacentHTML('afterbegin', '<button id="back-btn" class="btn secondary small" type="button" hidden title="Go back (Ctrl+Z)">← Back</button>');
  headActions.insertAdjacentHTML('afterbegin', '<button id="tour-btn" class="btn secondary small" type="button" hidden title="Replay the tutorial">? Tour</button>');
  $('#back-btn').onclick = back;
  $('#tour-btn').onclick = () => tour.start(state.role);
  document.body.insertAdjacentHTML('beforeend', '<nav id="tabbar" aria-label="Quick links"></nav>');
  const TABS = {
    admin: [['overview', '🏠', 'Home'], ['students', '🧒', 'Students'], ['attendance', '✅', 'Attendance'], ['calendar', '📅', 'Calendar']],
    coach: [['coach_home', '🏠', 'Home'], ['students', '🧒', 'Students'], ['attendance', '✅', 'Attendance'], ['evaluations', '📝', 'Evaluate']],
    parent: [['home', '🏠', 'Home'], ['p_events', '📅', 'Events'], ['p_contact', '💬', 'Coach'], ['p_announcements', '📣', 'News']]
  };
  function updateChrome() {
    const on = !!state.role;
    $('#back-btn').hidden = !on || !stack.length;
    $('#tour-btn').hidden = !on;
    const tabs = on ? TABS[state.role] || [] : [];
    $('#tabbar').innerHTML = tabs.map(([p, i, l]) => `<button type="button" data-tab="${p}" class="${state.page === p || (p === 'students' && state.page === 'student') ? 'active' : ''}"><span class="ti" aria-hidden="true">${i}</span>${l}</button>`).join('') + (on ? '<button type="button" data-tab="__menu"><span class="ti" aria-hidden="true">☰</span>More</button>' : '');
  }
  $('#tabbar').onclick = e => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    if (b.dataset.tab === '__menu') { const o = document.body.classList.toggle('nav-open'); $('#menu-toggle').setAttribute('aria-expanded', String(o)); scrollTo({ top: 0, behavior: 'smooth' }); return; }
    document.body.classList.remove('nav-open'); show(b.dataset.tab);
  };

  /* ---------- tables become cards on phones: each cell gets its column name ---------- */
  function labelTables(root = document) {
    root.querySelectorAll('.table-wrap table').forEach(t => {
      const heads = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim());
      if (!heads.length) return;
      t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (!td.dataset.label) td.dataset.label = heads[i] || ''; }));
    });
  }
  let pending = 0;
  new MutationObserver(() => { cancelAnimationFrame(pending); pending = requestAnimationFrame(() => labelTables()); }).observe(document.body, { childList: true, subtree: true });

  /* ---------- the tutorial ---------- */
  const T = (page, sel, title, text, extra = {}) => ({ page, sel, title, text, ...extra });
  const STEPS = {
    admin: [
      T(null, null, 'Welcome to MFU Tracker 👋', 'A quick tour of the main things you can do. Use Next and Back (or the arrow keys). You can replay it any time with the “? Tour” button at the top.'),
      T('overview', '.stats', 'Your overview', 'Numbers across every center, plus open parent requests, upcoming demos and meetings, and a to-do list.'),
      T('students', '.stu-link', 'Open a student', 'Every name is a link. Click the highlighted name to open that student\'s profile — try it now.', { click: true }),
      T('student', '#stabs', 'Everything about one child', 'Overview is exactly what the parents see. Skills, Attendance, Notes, Fitness and Photos each have a tab. Levels a child has already passed count as mastered, so you only work on the next level.', { need: 'studentId' }),
      T(null, '#back-btn', 'Go back with Ctrl+Z', 'Press Ctrl+Z (⌘Z on a Mac) or this Back button to return to the page you were on. It also closes any popup that is open.'),
      T('attendance', '#amodes', 'Attendance', 'Take attendance for a whole center or one batch, add drop-ins, and see the monthly report.'),
      T('evaluations', '#evtabs', 'Evaluations', 'Pick the students and their evaluator, take attendance, tap ✓ or ✗ for each skill, then save the summary to Google Sheets.'),
      T('calendar', '#new-meeting', 'Calendar & meetings', 'See everything by month. New meetings can get a Google Meet link and email the invite to parents and coaches.'),
      T('demos', '#add-demo', 'Demos & routines', 'Plan a demo, pick the kids, write each routine (group, pole, rope or yoga) and mark who came.'),
      T('timers', '#rx', 'One-minute sets', 'Choose Dasrang, rope or pole climbs, or Sadhi Adhi. Tap for every rep — at the end a graph shows when they started to tire, and parents see it too.'),
      T('assistant', '#cin', 'Skill assistant', 'Type what kids are working on in plain words, like “Riya is working on pole level 3 dive”, and it updates their skills.'),
      T('coach_accounts', '#content .table-wrap, #content .card', 'Coach accounts', 'Invite each coach so they get their own login and dashboard.'),
      T(null, '#tour-btn', 'You\'re all set!', 'Replay this tour any time from here.')
    ],
    coach: [
      T(null, null, 'Welcome, coach 👋', 'A quick tour of your tools. Use Next and Back (or the arrow keys). Replay it any time with the “? Tour” button.'),
      T('coach_home', '.stats', 'Your dashboard', 'Your batches, your students, open parent requests and the evaluations you are running.'),
      T('coach_home', '[data-take]', 'Take attendance', 'Start attendance for your batch in one tap.'),
      T('coach_home', '.stu-link', 'Open a student', 'Click the highlighted name to see that student\'s skills, attendance, notes and fitness — try it now.', { click: true }),
      T('student', '#stabs', 'Everything about one child', 'Add notes for the next coach, update skills, record fitness and add photos. Passed levels count as mastered, so you only see the next level.', { need: 'studentId' }),
      T(null, '#back-btn', 'Go back with Ctrl+Z', 'Press Ctrl+Z (⌘Z on a Mac) or this Back button to return to the last page.'),
      T('evaluations', '#evtabs', 'Evaluations', 'Your assigned students are listed first. Tap ✓ or ✗ for each skill and save.'),
      T('timers', '#rx', 'One-minute sets', 'Pick the exercise, tap for every rep, and save the set with its pace graph.'),
      T('assistant', '#cin', 'Skill assistant', 'Type what kids worked on in plain words and it fills in their skills.'),
      T('requests', '#rqf, #content .card', 'Parent requests', 'Questions and meeting requests from your students\' parents land here. Reply or schedule a meeting.'),
      T(null, '#tour-btn', 'You\'re all set!', 'Replay this tour any time from here.')
    ],
    parent: [
      T(null, null, 'Welcome to the MFU parent portal 👋', 'A quick look at what you can see and do here. Use Next and Back. You can replay this tour any time with the “? Tour” button.'),
      T('home', '.child .levels', 'Your child\'s levels', 'Their pole, rope and yoga levels. Everything they need for the next level is listed below.'),
      T('home', '.child .skills-acc', 'Skills', 'Levels they have passed are marked ✓. Open the next level to see which skills they are learning and have mastered.'),
      T('home', '.child .note', 'Notes from coaches', 'What they worked on in class and what comes next, so you can practice at home.', { optional: true }),
      T('home', '.child .pace', 'One-minute sets', 'Each bar is 5 seconds. Shorter bars at the end show where your child got tired — watch this improve over time.', { optional: true }),
      T('p_events', '#content .event-card, #content .card', 'Events', 'Evaluations, competitions, demos (with arrive times) and any meetings you are invited to.'),
      T('p_contact', '#pcf', 'Talk to the coach', 'Ask a question or request a meeting. It goes to MFU and your child\'s coaches, and their reply shows up here.'),
      T('p_announcements', '#content .card', 'Announcements', 'News from MFU and your coaches.'),
      T(null, '#tour-btn', 'You\'re all set!', 'Replay this tour any time from here.')
    ]
  };
  const tour = {
    active: false, i: 0, steps: [], el: null, target: null,
    async start(role) {
      if (!STEPS[role]) return;
      this.end(false);
      this.steps = STEPS[role]; this.active = true; this.role = role;
      this.el = document.createElement('div'); this.el.className = 'tour'; this.el.setAttribute('role', 'dialog'); this.el.setAttribute('aria-live', 'polite');
      this.el.innerHTML = '<div class="tour-spot"></div><div class="tour-pop card"><small class="tour-count"></small><h3></h3><p></p><div class="tour-dots"></div><div class="tour-actions"><button type="button" class="btn secondary small" data-t="skip">Skip tour</button><span></span><button type="button" class="btn secondary small" data-t="prev">Back</button><button type="button" class="btn small" data-t="next">Next</button></div></div>';
      document.body.append(this.el);
      this.el.onclick = e => { const a = e.target.closest('[data-t]')?.dataset.t; if (a === 'skip') this.end(true); if (a === 'prev') this.go(this.i - 1, -1); if (a === 'next') this.i === this.steps.length - 1 ? this.end(true) : this.go(this.i + 1, 1); };
      this.go(0, 1);
    },
    async go(i, dir) {
      if (i < 0) return;
      if (i >= this.steps.length) return this.end(true);
      const s = this.steps[i]; this.i = i;
      if (s.need === 'studentId' && !state.studentId) return this.go(i + dir, dir);
      if (s.page && state.page !== s.page) { this.el.classList.add('moving'); await show(s.page); }
      let target = null;
      if (s.sel) {
        for (let t = 0; t < 25 && !target; t++) { target = [...document.querySelectorAll(s.sel)].find(x => x.offsetParent || x.getClientRects().length); if (!target) await new Promise(r => setTimeout(r, 80)); }
        if (!target) return this.go(i + dir, dir); // nothing to point at here (e.g. no students yet) — skip this step
      }
      if (!this.active) return;
      this.el.classList.remove('moving');
      this.target = target;
      const pop = this.el.querySelector('.tour-pop');
      pop.querySelector('.tour-count').textContent = `${i + 1} of ${this.steps.length}`;
      pop.querySelector('h3').textContent = s.title;
      pop.querySelector('p').textContent = s.text;
      pop.querySelector('.tour-dots').innerHTML = this.steps.map((_, k) => `<i class="${k === i ? 'on' : ''}"></i>`).join('');
      pop.querySelector('[data-t=prev]').hidden = i === 0;
      pop.querySelector('[data-t=next]').textContent = i === this.steps.length - 1 ? 'Done' : s.click ? 'Skip this step' : 'Next';
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        if (s.click) target.addEventListener('click', () => { if (this.active && this.i === i) setTimeout(() => this.go(i + 1, 1), 250); }, { once: true });
      }
      setTimeout(() => this.place(), target ? 350 : 0);
      pop.querySelector('[data-t=next]').focus({ preventScroll: true });
    },
    place() {
      if (!this.active) return;
      const spot = this.el.querySelector('.tour-spot'), pop = this.el.querySelector('.tour-pop');
      const t = this.target && document.contains(this.target) ? this.target : null;
      this.el.classList.toggle('centered', !t);
      if (!t) { spot.style.cssText = 'left:50%;top:50%;width:0;height:0'; pop.style.cssText = ''; return; }
      const r = t.getBoundingClientRect(), pad = 6;
      spot.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
      if (innerWidth <= 600) { pop.style.cssText = ''; return; } // phones: the card sits at the bottom of the screen
      const pw = Math.min(360, innerWidth - 24), ph = pop.offsetHeight || 200;
      let top = r.bottom + 14; if (top + ph > innerHeight - 12) top = Math.max(12, r.top - ph - 14);
      const left = Math.min(Math.max(12, r.left), innerWidth - pw - 12);
      pop.style.cssText = `left:${left}px;top:${top}px;width:${pw}px`;
    },
    end(done) {
      if (!this.el) return;
      this.el.remove(); this.el = null; this.active = false;
      if (done) markDone(this.role);
    }
  };
  window.mfuTour = tour;
  addEventListener('resize', () => tour.place());
  addEventListener('scroll', () => tour.active && requestAnimationFrame(() => tour.place()), true);
  document.addEventListener('keydown', e => {
    if (!tour.active) return;
    if (e.key === 'Escape') { e.stopPropagation(); tour.end(true); }
    if (e.key === 'ArrowRight') tour.i === tour.steps.length - 1 ? tour.end(true) : tour.go(tour.i + 1, 1);
    if (e.key === 'ArrowLeft') tour.go(tour.i - 1, -1);
  }, true);
  function markDone(role) {
    if (role === 'admin') { try { localStorage.setItem('mfu-tour-admin', '1'); } catch { /* ignore */ } return; }
    if (state.me) state.me.tour_done = true;
    api(role === 'parent' ? 'parent/tour' : 'tour', { method: 'POST', body: '{}' }).catch(() => {});
  }

  /* ---------- hook into sign-in: reset history, show buttons, play the tour on first sign-in ---------- */
  const _setRole = setRole;
  setRole = function (role, me = {}) {
    _setRole(role, me);
    stack.length = 0; firstShow = true;
    updateChrome();
    let seen = !!me.tour_done;
    if (role === 'admin') { try { seen = !!localStorage.getItem('mfu-tour-admin'); } catch { seen = true; } }
    if (!seen && !tour.active) setTimeout(() => { if (state.role === role) tour.start(role); }, 1600);
  };
  const _clear = clearRole;
  clearRole = function () { _clear(); tour.end(false); stack.length = 0; updateChrome(); };
})();
