/* MFU batch progress: star students for the latest class (2 pole, 1 rope) and stacked month-by-month charts for the batch.
   Loaded after features.js (uses its window.mfuLine chart, and hero, empty, esc, api, $, PAGES, state, titles). */
(() => {
  const SETS = [['dasrang_1min', 'Dasrang'], ['sadhi_adhi_1min', 'Sadhi Adhi'], ['pole_climb_1min', 'Pole climb up & down'], ['rope_climb_1min', 'Rope climb up & down']];
  const setName = k => SETS.find(s => s[0] === k)?.[1] || k;
  const day = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  const mon = m => new Date(m + '-01T12:00:00').toLocaleDateString('en-US', { month: 'short' });
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const why = r => r.kind === 'set' ? `${setName(r.exercise)} ${r.from} to ${r.to} reps (+${r.gain})`
    : r.kind === 'started' ? `Started ${plural(r.n, 'skill')}` : `Completed ${plural(r.n, 'skill')}`;

  const star = (s, app) => `<li class="star"><b>${esc(s.name)}</b><span class="star-pts">${s[app]} pts</span><ul>${s.reasons[app].map(r => `<li>${esc(why(r))}</li>`).join('')}</ul></li>`;
  const starGroup = (label, list, want, app) => `<div class="star-group"><h4>${label}</h4>${list.length ? `<ol class="stars">${list.map(s => star(s, app)).join('')}</ol>` : ''}${list.length < want ? `<p class="muted">${list.length ? 'Nobody else' : 'Nobody'} improved on ${app} this class.</p>` : ''}</div>`;

  PAGES.batch_progress = async () => {
    const batches = (await api('batches')).filter(b => b.active !== 0);
    const B = state.bp ||= { batch: (() => { try { return localStorage.getItem('mfu-bp-batch') || ''; } catch { return ''; } })() };
    if (!batches.some(b => b.id === B.batch)) B.batch = batches[0]?.id || '';
    $('#content').innerHTML = hero('Batch progress', 'Star students from the latest class and how the whole batch is trending.') +
      `<div class="card att-bar"><label>Batch<select id="bp-batch">${batches.map(b => `<option value="${esc(b.id)}" ${b.id === B.batch ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label></div><div id="bp-body"></div>`;
    const load = async () => {
      const body = $('#bp-body');
      if (!B.batch) { body.innerHTML = empty('', 'No batches yet', 'Add a batch first.'); return; }
      body.innerHTML = '<p class="muted">Loading…</p>';
      try {
        const d = await api('batch-insights?batch_id=' + encodeURIComponent(B.batch));
        const labels = d.months.map(mon), line = window.mfuLine;
        const sets = SETS.map(([k, l]) => ({ name: l, values: d.trends.sets[k] }));
        const charts = [
          line([{ name: 'Attendance', values: d.trends.attendance }], { labels, unit: '%', title: 'Attendance (% of marked students present)', compact: true }),
          line([{ name: 'Started', values: d.trends.started }, { name: 'Completed', values: d.trends.mastered }], { labels, unit: 'skills', title: 'Skills started and completed', compact: true }),
          line(sets, { labels, unit: 'reps in 1 min', title: 'One-minute sets (average of each student\'s best)', compact: true })
        ];
        body.innerHTML = `<section class="card">
            <div class="bp-head"><h3>Star students</h3><p class="muted">${d.last_class ? `Class of ${esc(day(d.last_class))}${d.prev_class ? `, compared with ${esc(day(d.prev_class))}` : ''}.` : 'No classes recorded yet.'} Points: 1 per rep gained in a one-minute set, 3 per skill started, 5 per skill completed.</p></div>
            ${d.last_class ? `<div class="star-cols">${starGroup('Pole', d.stars.pole, 2, 'pole')}${starGroup('Rope', d.stars.rope, 1, 'rope')}</div>` : ''}
            ${d.scores.length > d.stars.pole.length + d.stars.rope.length ? `<details class="section-gap-sm"><summary class="muted">Everyone who improved (${d.scores.length})</summary><div class="table-wrap"><table><thead><tr><th>Student</th><th>Pole</th><th>Rope</th></tr></thead><tbody>${d.scores.map(s => `<tr><td>${esc(s.name)}</td><td>${s.pole}</td><td>${s.rope}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
          </section>
          <section class="card section-gap"><div class="bp-overall-head"><div><h3>Batch overall</h3><p class="muted">${plural(d.students, 'student')}, last 6 months.</p></div>${d.roster.length ? `<div class="stack" aria-label="${plural(d.students, 'student')}">${d.roster.slice(0, 6).map(r => `<span class="mini-avatar">${esc(r)}</span>`).join('')}${d.roster.length > 6 ? `<span class="mini-avatar more">+${d.roster.length - 6}</span>` : ''}</div>` : ''}</div>
            ${d.classes.length ? `<h4>${d.classes.length === 1 ? 'Last class' : 'Last ' + d.classes.length + ' classes'}</h4><div class="tracker">${d.classes.map(c => { const p = c.n ? c.here / c.n : 0; return `<span class="${p >= .85 ? 'ok' : p >= .6 ? 'mid' : 'low'}" title="${esc(day(c.d))}: ${c.here} of ${c.n} here"></span>`; }).join('')}</div><div class="tracker-key muted"><span>${esc(day(d.classes[0].d))}</span><span>${esc(day(d.classes[d.classes.length - 1].d))}</span></div>` : ''}<div class="bp-stack">${charts.map(c => `<div class="bp-row">${c}</div>`).join('')}</div></section>`;
      } catch (e) { body.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
    };
    $('#bp-batch').onchange = e => { B.batch = e.target.value; try { localStorage.setItem('mfu-bp-batch', B.batch); } catch { /* private mode */ } load(); };
    load();
  };
  titles.batch_progress = 'Batch progress';
})();
