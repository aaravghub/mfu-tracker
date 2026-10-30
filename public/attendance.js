/* MFU attendance: take it by center or by batch, add drop-ins, see a monthly report, and open any student's attendance.
   Loaded after extra.js (uses its helpers: hero, openModal, empty, nameOf, centerName, esc, api, toast). */
(() => {
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const todayStr = () => ymd(new Date());
  const addDays = (ds, n) => { const d = new Date(ds + 'T12:00:00'); d.setDate(d.getDate() + n); return ymd(d); };
  const shiftMonth = (m, n) => { const [y, mo] = m.split('-').map(Number); const d = new Date(y, mo - 1 + n, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
  const monthLabel = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); };
  const shortMonth = m => { const [y, mo] = m.split('-').map(Number); return new Date(y, mo - 1, 1).toLocaleDateString('en-US', { month: 'short' }); };
  const dayLabel = ds => new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const time = t => (typeof fmtTime === 'function' ? fmtTime(t) : t) || '';
  const cap = s => s[0].toUpperCase() + s.slice(1);
  const STAT = ['present', 'late', 'absent', 'excused'];
  const here = s => s === 'present' || s === 'late';
  const batchWhen = b => [b.days, b.start_time ? time(b.start_time) + (b.end_time ? '–' + time(b.end_time) : '') : ''].filter(Boolean).join(' · ');
  const csvCell = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const download = (name, rows) => {
    const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  };
  const monthNav = (m, id = 'mn') => `<div class="month-nav" id="${id}"><button type="button" class="btn secondary small" data-mv="-1" aria-label="Previous month">‹</button><b>${monthLabel(m)}</b><button type="button" class="btn secondary small" data-mv="1" aria-label="Next month">›</button></div>`;

  /* ---------- roster editor: one card per batch, shared by "By center" and "By batch" ---------- */
  function rosterEditor(host, batches, people, centers) {
    const sumEl = document.createElement('div'); sumEl.className = 'att-sum';
    const list = document.createElement('div');
    host.replaceChildren(sumEl, list);
    const summary = () => {
      const c = { present: 0, late: 0, absent: 0, excused: 0, drop: 0 };
      batches.forEach(b => b.students.forEach(s => { c[s.status]++; if (s.drop_in) c.drop++; }));
      sumEl.innerHTML = STAT.map(k => `<span class="chip s-${k}">${c[k]} ${k}</span>`).join('') + (c.drop ? `<span class="chip drop">${c.drop} drop-in${c.drop > 1 ? 's' : ''}</span>` : '');
    };
    const draw = () => {
      list.innerHTML = batches.length ? batches.map((b, bi) => {
        const total = b.students.length, pres = b.students.filter(s => here(s.status)).length;
        const taken = new Set(b.students.map(s => s.student_id));
        const opts = people.filter(p => !taken.has(p.id)).map(p => `<option value="${esc(p.id)}">${esc(nameOf(p))} · ${esc(centerName(centers, p.center_id))}</option>`).join('');
        return `<section class="card att-batch"><div class="att-head"><div><h3>${esc(b.name)}</h3><small class="muted">${esc(batchWhen(b)) || '&nbsp;'}</small></div><span class="att-count"><b>${pres}</b>/${total}</span><div class="att-tools"><button type="button" class="btn secondary small" data-all="present" data-bi="${bi}">All present</button><button type="button" class="btn secondary small" data-all="absent" data-bi="${bi}">All absent</button></div></div>
          ${total ? `<div class="table-wrap"><table><tbody>${b.students.map((s, si) => `<tr class="${s.drop_in ? 'drop-row' : ''}"><td><b>${esc(s.first_name + ' ' + s.last_name)}</b>${s.drop_in ? ' <span class="chip drop">Drop-in</span>' : ''}${s.saved ? '' : ' <i class="unsaved" title="Not saved yet"></i>'}</td><td><select data-st data-bi="${bi}" data-si="${si}">${STAT.map(k => `<option value="${k}" ${k === s.status ? 'selected' : ''}>${cap(k)}</option>`).join('')}</select></td><td class="att-x">${s.drop_in ? `<button type="button" class="icon-btn" data-rm data-bi="${bi}" data-si="${si}" aria-label="Remove drop-in">✕</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nobody is on this batch yet. Add them in Batches, or add a drop-in below.</p>'}
          <div class="att-add"><select data-add data-bi="${bi}"><option value="">+ Add a drop-in student…</option>${opts}</select></div></section>`;
      }).join('') : empty('🗓️', 'Nothing to show', 'There are no batches here yet.');
      summary();
      list.querySelectorAll('[data-st]').forEach(sel => sel.onchange = () => { batches[+sel.dataset.bi].students[+sel.dataset.si].status = sel.value; list.querySelectorAll('.att-count')[+sel.dataset.bi].firstChild.textContent = batches[+sel.dataset.bi].students.filter(s => here(s.status)).length; summary(); });
      list.querySelectorAll('[data-all]').forEach(b => b.onclick = () => { batches[+b.dataset.bi].students.forEach(s => { s.status = b.dataset.all; }); draw(); });
      list.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { const bt = batches[+b.dataset.bi], s = bt.students[+b.dataset.si]; if (s.saved) (bt.removed ||= []).push(s.student_id); bt.students.splice(+b.dataset.si, 1); draw(); });
      list.querySelectorAll('[data-add]').forEach(sel => sel.onchange = () => {
        const p = people.find(x => x.id === sel.value); if (!p) return;
        const bt = batches[+sel.dataset.bi];
        bt.removed = (bt.removed || []).filter(id => id !== p.id);
        bt.students.push({ student_id: p.id, first_name: p.first_name, last_name: p.last_name, status: 'present', saved: false, drop_in: true });
        bt.students.sort((a, b) => (a.last_name + a.first_name).localeCompare(b.last_name + b.first_name));
        draw();
      });
    };
    draw();
    return {
      payload: () => batches.map(b => ({ batch_id: b.id, records: b.students.map(s => ({ student_id: s.student_id, status: s.status })), remove: b.removed || [] }))
    };
  }

  /* ---------- the Attendance page ---------- */
  PAGES.attendance = async () => {
    const [batches, centers, students] = await Promise.all([api('batches'), api('centers'), api('students')]);
    const people = students.filter(s => s.active !== 0);
    const S = state.att ||= { mode: 'center', center: (() => { try { const c = localStorage.getItem('mfu-att-center'); if (c && centers.some(x => x.id === c)) return c; } catch { /* ignore */ } return batches.find(b => b.center_id)?.center_id || centers[0]?.id || ''; })(), batch: '', date: todayStr(), month: todayStr().slice(0, 7), rcenter: '', sort: 'name', q: '' };
    $('#content').innerHTML = hero('Attendance', 'Take attendance for a whole center or one batch, add drop-ins, and see who has been showing up.') +
      '<div class="seg att-modes" id="amodes"><button type="button" data-m="center">By center</button><button type="button" data-m="batch">By batch</button><button type="button" data-m="report">Monthly report</button></div><div id="aview"></div>';
    const setMode = m => { S.mode = m; $$('#amodes button').forEach(b => b.classList.toggle('active', b.dataset.m === m)); ({ center: centerView, batch: batchView, report: reportView })[m](); };
    $$('#amodes button').forEach(b => b.onclick = () => setMode(b.dataset.m));

    // shared: date bar + roster + save
    function takeView(kind) {
      const isC = kind === 'center';
      const opts = isC ? centers.map(c => `<option value="${esc(c.id)}" ${c.id === S.center ? 'selected' : ''}>${esc(c.name)}</option>`).join('')
        : '<option value="">Choose a batch</option>' + batches.map(b => `<option value="${esc(b.id)}" ${b.id === S.batch ? 'selected' : ''}>${esc(b.name)} · ${esc(centerName(centers, b.center_id))}</option>`).join('');
      $('#aview').innerHTML = `<div class="card att-bar"><label>${isC ? 'Center' : 'Batch'}<select id="asel">${opts}</select></label><div class="date-step"><button type="button" class="btn secondary small" id="dprev" aria-label="Previous day">‹</button><label>Date<input type="date" id="adate" value="${S.date}"></label><button type="button" class="btn secondary small" id="dnext" aria-label="Next day">›</button><button type="button" class="btn secondary small" id="dtoday">Today</button></div></div><p class="muted att-hint">Everyone starts as present. Change anyone who was absent, late or excused, add drop-ins from other batches, then save. A dot next to a name means it isn’t saved yet.</p><div id="aroster"></div><div class="att-save" id="asavebar" hidden><span class="muted" id="amsg"></span><button type="button" class="btn" id="asave">Save attendance</button></div>`;
      let ed = null;
      const load = async () => {
        const key = isC ? S.center : S.batch; $('#asavebar').hidden = true;
        if (!key || !S.date) { $('#aroster').innerHTML = empty('🗓️', isC ? 'Choose a center' : 'Choose a batch', 'Then pick the date.'); return; }
        $('#aroster').innerHTML = '<p class="muted">Loading…</p>';
        try {
          let bs;
          if (isC) bs = (await api('attendance-center?center_id=' + encodeURIComponent(key) + '&date=' + S.date)).batches;
          else { const b = batches.find(x => x.id === key); bs = [{ ...b, students: await api('attendance?batch_id=' + encodeURIComponent(key) + '&date=' + S.date) }]; }
          ed = rosterEditor($('#aroster'), bs.map(b => ({ ...b, removed: [] })), people, centers);
          $('#asavebar').hidden = !bs.length; $('#amsg').textContent = '';
        } catch (e) { $('#aroster').innerHTML = `<p class="error">${esc(e.message)}</p>`; }
      };
      $('#asel').onchange = e => { S[isC ? 'center' : 'batch'] = e.target.value; if (isC) { try { localStorage.setItem('mfu-att-center', e.target.value); } catch { /* ignore */ } } load(); };
      $('#adate').onchange = e => { S.date = e.target.value; load(); };
      $('#dprev').onclick = () => { S.date = addDays(S.date, -1); $('#adate').value = S.date; load(); };
      $('#dnext').onclick = () => { S.date = addDays(S.date, 1); $('#adate').value = S.date; load(); };
      $('#dtoday').onclick = () => { S.date = todayStr(); $('#adate').value = S.date; load(); };
      $('#asave').onclick = async () => {
        const btn = $('#asave'); btn.disabled = true;
        try { const r = await api('attendance-center', { method: 'POST', body: JSON.stringify({ date: S.date, batches: ed.payload() }) }); toast('Attendance saved for ' + r.saved + ' students'); await load(); $('#amsg').textContent = 'Saved ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
        catch (e) { $('#amsg').textContent = e.message; toast(e.message); } finally { btn.disabled = false; }
      };
      load();
    }
    const centerView = () => takeView('center');
    const batchView = () => takeView('batch');

    function reportView() {
      $('#aview').innerHTML = `<div class="card att-bar">${monthNav(S.month)}<label>Center<select id="rcenter"><option value="">All centers</option>${centers.map(c => `<option value="${esc(c.id)}" ${c.id === S.rcenter ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label><label>Sort<select id="rsort"><option value="name">Name</option><option value="most">Most attended</option><option value="least">Least attended</option></select></label><label>Search<input id="rq" placeholder="Student name…" value="${esc(S.q)}"></label></div><div id="rbody"><p class="muted">Loading…</p></div>`;
      $('#rsort').value = S.sort;
      let per = [];
      const draw = () => {
        const q = S.q.toLowerCase();
        let rows = per.filter(p => !q || nameOf(p).toLowerCase().includes(q));
        rows.sort(S.sort === 'most' ? (a, b) => b.attended - a.attended || nameOf(a).localeCompare(nameOf(b)) : S.sort === 'least' ? (a, b) => a.attended - b.attended || nameOf(a).localeCompare(nameOf(b)) : (a, b) => (a.last_name + a.first_name).localeCompare(b.last_name + b.first_name));
        const marked = per.reduce((n, p) => n + p.total, 0), att = per.reduce((n, p) => n + p.attended, 0), none = per.filter(p => !p.total).length;
        $('#rbody').innerHTML = `<div class="stat-row"><div class="stat card"><small>Classes attended</small><b>${att}</b></div><div class="stat card"><small>Overall attendance</small><b>${marked ? Math.round(att / marked * 100) + '%' : '—'}</b></div><div class="stat card"><small>No classes marked</small><b>${none}</b></div></div>` +
          (rows.length ? `<div class="table-wrap"><table class="att-table"><thead><tr><th>Student</th><th>Center</th><th>Attended</th><th>Absent</th><th>Rate</th><th>Batches this month</th><th></th></tr></thead><tbody>${rows.map(p => `<tr><td><b>${esc(nameOf(p))}</b></td><td>${esc(centerName(centers, p.center_id))}</td><td><b>${p.attended}</b>${p.late ? `<small class="muted"> (${p.late} late)</small>` : ''}</td><td>${p.absent}${p.excused ? `<small class="muted"> +${p.excused} excused</small>` : ''}</td><td>${p.total ? Math.round(p.attended / p.total * 100) + '%' : '—'}</td><td class="bchips">${[...p.batches.values()].map(b => `<span class="chip ${b.drop ? 'drop' : ''}" title="${b.drop ? 'Drop-in: not on this batch’s roster' : ''}">${esc(b.name)} ×${b.attended}${b.drop ? ' · drop-in' : ''}</span>`).join('') || '<span class="muted">—</span>'}</td><td><button type="button" class="btn secondary small" data-sid="${esc(p.id)}">Details</button></td></tr>`).join('')}</tbody></table></div>` : empty('📋', 'No students found', 'Try a different center or search.')) +
          `<div class="modal-actions"><button type="button" class="btn secondary" id="rcsv">Download this month as CSV</button></div>`;
        $$('[data-sid]').forEach(b => b.onclick = () => studentAttendanceModal(people.find(x => x.id === b.dataset.sid) || per.find(x => x.id === b.dataset.sid)));
        $('#rcsv').onclick = () => download('attendance-' + S.month + '.csv', [['Student', 'Center', 'Attended', 'Late', 'Absent', 'Excused', 'Rate %', 'Batches'], ...rows.map(p => [nameOf(p), centerName(centers, p.center_id), p.attended, p.late, p.absent, p.excused, p.total ? Math.round(p.attended / p.total * 100) : '', [...p.batches.values()].map(b => b.name + ' x' + b.attended + (b.drop ? ' (drop-in)' : '')).join('; ')])]);
      };
      const load = async () => {
        $('#rbody').innerHTML = '<p class="muted">Loading…</p>';
        try {
          const d = await api('attendance-report?month=' + S.month + (S.rcenter ? '&center_id=' + encodeURIComponent(S.rcenter) : ''));
          const map = new Map(d.students.map(s => [s.id, { ...s, present: 0, late: 0, absent: 0, excused: 0, attended: 0, total: 0, batches: new Map() }]));
          d.rows.forEach(r => {
            const p = map.get(r.student_id); if (!p) return;
            p[r.status] += r.n; p.total += r.n; if (here(r.status)) p.attended += r.n;
            const b = p.batches.get(r.batch_id) || { name: r.batch_name || 'Deleted batch', attended: 0, drop: false };
            if (here(r.status)) b.attended += r.n; if (r.drop_in) b.drop = true; p.batches.set(r.batch_id, b);
          });
          per = [...map.values()]; draw();
        } catch (e) { $('#rbody').innerHTML = `<p class="error">${esc(e.message)}</p>`; }
      };
      $$('#mn [data-mv]').forEach(b => b.onclick = () => { S.month = shiftMonth(S.month, +b.dataset.mv); reportView(); });
      $('#rcenter').onchange = e => { S.rcenter = e.target.value; load(); };
      $('#rsort').onchange = e => { S.sort = e.target.value; draw(); };
      $('#rq').oninput = e => { S.q = e.target.value; draw(); };
      load();
    }
    setMode(S.mode);
  };

  /* ---------- one student's attendance (opened from Students and from the report) ---------- */
  window.studentAttendanceModal = async function (student) {
    if (!student) return;
    let month = todayStr().slice(0, 7);
    const m = openModal('Attendance · ' + nameOf(student), '<div id="sa"><p class="muted">Loading…</p></div>', { wide: true });
    const [batches, centers] = await Promise.all([api('batches').catch(() => []), api('centers').catch(() => [])]);
    const load = async () => {
      try { render(await api('attendance-student?student_id=' + encodeURIComponent(student.id) + '&month=' + month)); }
      catch (e) { m.$('#sa').innerHTML = `<p class="error">${esc(e.message)}</p>`; }
    };
    const render = d => {
      const attended = d.rows.filter(r => here(r.status)).length, absent = d.rows.filter(r => r.status === 'absent').length;
      const per = new Map();
      d.rows.forEach(r => { const k = r.batch_id || '?'; const b = per.get(k) || { name: r.batch || 'Deleted batch', attended: 0, total: 0, drop: false }; b.total++; if (here(r.status)) b.attended++; if (r.drop_in) b.drop = true; per.set(k, b); });
      const regular = new Set(d.batches.map(b => b.id));
      d.batches.forEach(b => { if (!per.has(b.id)) per.set(b.id, { name: b.name, attended: 0, total: 0, drop: false }); });
      const max = Math.max(1, ...d.history.map(h => h.attended));
      const defaultDate = month === todayStr().slice(0, 7) ? todayStr() : month + '-01';
      m.$('#sa').innerHTML = `${monthNav(month, 'smn')}
        <div class="stat-row"><div class="stat card"><small>Classes attended</small><b>${attended}</b></div><div class="stat card"><small>Absent</small><b>${absent}</b></div><div class="stat card"><small>Attendance rate</small><b>${d.rows.length ? Math.round(attended / d.rows.length * 100) + '%' : '—'}</b></div><div class="stat card"><small>Batches this month</small><b>${[...per.values()].filter(b => b.total).length}</b></div></div>
        <h4>Batches</h4><div class="chips">${[...per.entries()].map(([id, b]) => `<span class="chip ${b.drop ? 'drop' : ''}">${esc(b.name)} · ${b.attended}/${b.total} attended${regular.has(id) ? '' : ' · drop-in'}</span>`).join('') || '<span class="muted">No batches yet.</span>'}</div>
        <h4>Class by class</h4>${d.rows.length ? `<ul class="att-list">${d.rows.map(r => `<li><span>${esc(dayLabel(r.date))} · ${esc(r.batch || 'Deleted batch')}${r.drop_in ? ' <span class="chip drop">Drop-in</span>' : ''}</span><span class="att-li-end"><span class="chip s-${r.status}">${r.status}</span>${r.drop_in ? `<button type="button" class="icon-btn" data-rmv data-b="${esc(r.batch_id)}" data-d="${r.date}" aria-label="Remove this visit">✕</button>` : ''}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing marked this month.</p>'}
        <h4>Log a class visit <span class="muted">for a batch that isn’t their usual one</span></h4>
        <div class="att-log"><select id="lbatch"><option value="">Choose a batch</option>${batches.map(b => `<option value="${esc(b.id)}">${esc(b.name)} · ${esc(centerName(centers, b.center_id))}</option>`).join('')}</select><input type="date" id="ldate" value="${defaultDate}"><select id="lstat">${STAT.map(k => `<option value="${k}">${cap(k)}</option>`).join('')}</select><button type="button" class="btn" id="ladd">Add visit</button></div>
        <h4>Last 12 months</h4><div class="hist">${d.history.slice().reverse().map(h => `<div class="hist-col" title="${h.attended} of ${h.total} attended"><i style="height:${Math.round(h.attended / max * 100)}%"></i><b>${h.attended}</b><small>${shortMonth(h.month)}</small></div>`).join('') || '<span class="muted">No history yet.</span>'}</div>`;
      m.$$('#smn [data-mv]').forEach(b => b.onclick = () => { month = shiftMonth(month, +b.dataset.mv); load(); });
      m.$('#ladd').onclick = async () => {
        const batch_id = m.$('#lbatch').value, date = m.$('#ldate').value;
        if (!batch_id || !date) return toast('Choose a batch and a date');
        try { await api('attendance', { method: 'POST', body: JSON.stringify({ batch_id, date, records: [{ student_id: student.id, status: m.$('#lstat').value }] }) }); toast('Visit added'); month = date.slice(0, 7); await load(); } catch (e) { toast(e.message); }
      };
      m.$$('[data-rmv]').forEach(b => b.onclick = async () => {
        if (!confirm('Remove this drop-in visit?')) return;
        try { await api('attendance', { method: 'POST', body: JSON.stringify({ batch_id: b.dataset.b, date: b.dataset.d, records: [], remove: [student.id] }) }); toast('Removed'); await load(); } catch (e) { toast(e.message); }
      });
    };
    load();
  };
})();
