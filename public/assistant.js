/* MFU coach assistant: talk (with pause and resume), type or paste class notes; a free AI model turns them into
   skill updates, counts (dasrang, climbs, push-ups...) and notes; the coach checks the list and saves only what is right.
   Loaded after features.js (uses window.mfuMetrics and window.MFU_parsePlain, plus api, esc, toast, hero, nameOf, todayStr, PAGES, state, $). */
(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const TIMED = new Set(['dasrang_1min', 'rope_climb_1min', 'pole_climb_1min', 'sadhi_adhi_1min']); // saved as timed sets, which also update fitness
  const SL = { learning: 'Learning', mastered: 'Completed' };

  PAGES.assistant = async () => {
    const [students, skills] = await Promise.all([api('students'), api('skills?include=general')]);
    const S = new Map(students.map(s => [s.id, s])), K = new Map(skills.map(s => [s.id, s]));
    const metrics = window.mfuMetrics(), metricName = k => metrics.find(m => m[0] === k)?.[1] || k;
    const A = state.asst ||= { text: '', lang: 'en-IN', mode: 'notes', batch: '', date: todayStr() };
    const att = A.mode === 'attendance';
    const batches = att ? (await api('batches')).filter(b => b.active !== 0) : [];
    if (att && !batches.some(b => b.id === A.batch)) A.batch = batches[0]?.id || '';
    $('#content').innerHTML = hero('Coach assistant', 'Talk, type or paste what happened in class. Pause whenever you like. You check everything before it saves.') +
      `<div class="seg" id="amode"><button type="button" data-mode="notes" class="${att ? '' : 'active'}">Class notes</button><button type="button" data-mode="attendance" class="${att ? 'active' : ''}">Attendance</button></div>
      <section class="card">
        ${att ? `<div class="att-bar asst-att"><label>Batch<select id="abatch">${batches.map(b => `<option value="${esc(b.id)}" ${b.id === A.batch ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label><label>Date<input type="date" id="adate" value="${esc(A.date)}"></label></div>` : ''}
        <div class="asst-bar">
          ${SR ? `<button type="button" class="btn" id="mic">Start talking</button><span class="asst-live" id="live" hidden><i></i>Listening</span>
          <label class="asst-lang">Accent<select id="lang"><option value="en-IN">English (India)</option><option value="en-US">English (US)</option></select></label>` : '<p class="muted">Voice input needs Chrome, Edge or Safari. You can still type or paste.</p>'}
        </div>
        <textarea id="atext" rows="9" placeholder="${att ? 'e.g. Everyone is here except Riya and Dev. Anika came late. Kabir is sick. Coach Meena was here.' : 'e.g. Riya did 32 dasrang and is working on ulti bagli tedhi. Dev completed pole level 2 dive. Anika needs to work on her grip.'}">${esc(A.text)}</textarea>
        <p class="muted asst-interim" id="interim"></p>
        <div class="modal-actions"><button type="button" class="btn secondary" id="aclear">Clear</button><button type="button" class="btn" id="areview">Review changes</button></div>
      </section><div id="aresult"></div>`;
    const box = $('#atext');
    box.oninput = () => { A.text = box.value; };
    $('#aclear').onclick = () => { box.value = A.text = ''; $('#aresult').innerHTML = ''; };
    $$('#amode button').forEach(b => b.onclick = () => { if (b.dataset.mode !== A.mode) { A.mode = b.dataset.mode; A.text = ''; show('assistant'); } });
    if (att) { $('#abatch').onchange = e => { A.batch = e.target.value; }; $('#adate').onchange = e => { A.date = e.target.value; }; }

    /* ---- voice: Start / Pause / Resume. Browsers stop listening after a silence, so it restarts until paused. ---- */
    if (SR) {
      const rec = new SR(); let on = false, lastFinal = '';
      rec.continuous = true; rec.interimResults = true;
      $('#lang').value = A.lang; $('#lang').onchange = e => { A.lang = e.target.value; };
      const set = v => { on = v; $('#mic').textContent = v ? 'Pause' : box.value.trim() ? 'Resume talking' : 'Start talking'; $('#live').hidden = !v; if (!v) $('#interim').textContent = ''; };
      rec.onresult = e => {
        if (state.page !== 'assistant') return rec.abort();
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript.trim();
          if (!e.results[i].isFinal) { interim += t + ' '; continue; }
          if (!t || t === lastFinal) continue; // Android sometimes repeats a final phrase
          lastFinal = t;
          box.value = (box.value.trim() ? box.value.trimEnd() + ' ' : '') + t + (/[.!?]$/.test(t) ? '' : '.');
          A.text = box.value;
        }
        $('#interim').textContent = interim;
      };
      rec.onend = () => { if (on && state.page === 'assistant') try { rec.start(); } catch { set(false); } };
      rec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { set(false); toast('Allow the microphone for this site to talk.'); } };
      $('#mic').onclick = () => { if (on) { set(false); rec.stop(); } else { rec.lang = A.lang; set(true); try { rec.start(); } catch { /* already running */ } } };
    }

    /* ---- review: the AI proposes, the coach confirms ---- */
    $('#areview').onclick = async () => {
      const text = box.value.trim(); if (!text) return toast('Say or type something first');
      $('#mic') && $('#mic').textContent === 'Pause' && $('#mic').click();
      const btn = $('#areview'); btn.disabled = true; $('#aresult').innerHTML = '<section class="card section-gap"><p class="muted" id="await">Reading it…</p></section>';
      // The server gives the AI about 10 seconds; the page gives up at 15 so it never spins forever.
      const t0 = Date.now(), tick = setInterval(() => { const el = $('#await'); if (el) el.textContent = `Reading it… ${Math.round((Date.now() - t0) / 1000)}s`; }, 1000);
      const ask = body => api('assistant', { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(15000) })
        .catch(e => { throw e.name === 'TimeoutError' || e.name === 'AbortError' ? Error('The AI took too long. Try again, or say a bit less at once.') : e; })
        .finally(() => clearInterval(tick));
      if (att) {
        try { await reviewAttendance(await ask({ mode: 'attendance', text, batch_id: A.batch })); }
        catch (e) { $('#aresult').innerHTML = `<section class="card section-gap"><p class="error">${esc(e.message)}</p><p class="muted">You can still take attendance on the Attendance page.</p></section>`; }
        finally { btn.disabled = false; }
        return;
      }
      let r;
      try { r = await ask({ text, metrics }); }
      catch (e) {
        // No AI key yet or every free model busy: fall back to the keyword matcher (skills only).
        const { changes, notes } = window.MFU_parsePlain(text, students, skills);
        r = { actions: changes.map(c => ({ type: 'skill', student: c.student.id, skill: c.skill.id, status: c.status === 'mastered' ? 'mastered' : 'learning', heard: '' })), unclear: [e.message + ' Used keyword matching instead (skills only).', ...notes] };
      } finally { btn.disabled = false; }
      draw(r);
    };

    const line = (a, i) => {
      const who = esc(nameOf(S.get(a.student)));
      const what = a.type === 'skill' ? `<select data-k="status" data-i="${i}">${Object.entries(SL).map(([k, v]) => `<option value="${k}" ${k === a.status ? 'selected' : ''}>${v}</option>`).join('')}</select> <b>${esc(K.get(a.skill)?.name || '')}</b> <span class="muted">${esc(K.get(a.skill)?.apparatus || '')}</span>`
        : a.type === 'count' ? `<b>${esc(metricName(a.metric))}</b> <input type="number" min="0" max="1000" step="any" value="${a.value}" data-k="value" data-i="${i}" class="asst-num" aria-label="Count">`
        : `Note: <input value="${esc(a.worked_on)}" data-k="worked_on" data-i="${i}" aria-label="Worked on">${a.next_steps ? ` Next: <input value="${esc(a.next_steps)}" data-k="next_steps" data-i="${i}" aria-label="Next steps">` : ''}`;
      return `<label class="pick asst-item ${a.doubt ? 'doubt' : ''}"><input type="checkbox" data-pick="${i}" ${a.doubt ? '' : 'checked'}><span><span class="asst-what"><b>${who}</b> · ${what}</span>${a.heard ? `<small>“${esc(a.heard)}”</small>` : ''}${a.doubt ? `<small class="asst-doubt">Double-check: ${esc(a.doubt)}</small>` : ''}</span></label>`;
    };
    const draw = r => {
      const acts = r.actions;
      $('#aresult').innerHTML = `<section class="card section-gap"><div class="att-head"><div><h3>Check before saving</h3><small class="muted">${acts.length ? 'Untick anything that is wrong, or fix it here. Items the double-check doubted start unticked.' : 'Nothing to save yet.'}${r.model ? ' · ' + esc(r.model.split('/').slice(1).join('/')) : ''}</small></div></div>
        ${acts.length ? `<div class="asst-list">${acts.map(line).join('')}</div>` : ''}
        ${r.unclear?.length ? `<div class="notice warn-n section-gap-sm"><b>Not sure about</b><ul>${r.unclear.map(u => `<li>${esc(u)}</li>`).join('')}</ul></div>` : ''}
        ${acts.length ? '<div class="modal-actions"><button type="button" class="btn" id="asave">Save checked changes</button></div>' : ''}</section>`;
      $$('#aresult [data-k]').forEach(el => el.onchange = () => { const a = acts[+el.dataset.i]; a[el.dataset.k] = el.dataset.k === 'value' ? Number(el.value) : el.value; });
      $('#asave') && ($('#asave').onclick = () => save(acts.filter((_, i) => $(`[data-pick="${i}"]`).checked)));
    };

    /* ---- attendance review: the whole roster with the AI's marks filled in; drop-ins added ---- */
    const reviewAttendance = async r => {
      const [now, staff] = await Promise.all([api('attendance?batch_id=' + encodeURIComponent(A.batch) + '&date=' + A.date), api('coaches')]);
      const mark = (kind, id) => r.marks.find(m => m.kind === kind && m.id === id);
      // A doubted mark is not applied: the row keeps what was saved before and shows the AI's guess.
      const row = (kind, id, nm, saved, drop) => { const m = mark(kind, id), guess = m && !m.doubt ? m.status : r.rest && !drop && !m ? r.rest : saved || ''; return { kind, id, name: nm, status: guess, drop, heard: m?.heard || '', doubt: m?.doubt ? `${m.doubt} (AI said ${m.status})` : '', changed: guess !== (saved || '') }; };
      const rows = [
        ...now.students.map(s => row('student', s.student_id, s.first_name + ' ' + s.last_name, s.status, s.drop_in)),
        ...r.marks.filter(m => m.kind === 'student' && !now.students.some(s => s.student_id === m.id)).map(m => row('student', m.id, nameOf(S.get(m.id) || {}), '', true)),
        ...now.coaches.map(c => row('coach', c.coach_id, c.name, c.status, c.drop_in)),
        ...r.marks.filter(m => m.kind === 'coach' && !now.coaches.some(c => c.coach_id === m.id)).map(m => row('coach', m.id, staff.find(c => c.id === m.id)?.name || 'Coach', '', true))
      ];
      const STAT = ['present', 'late', 'absent', 'excused'];
      const one = (x, i) => `<div class="asst-row ${x.doubt ? 'doubt' : x.changed ? 'changed' : ''}"><div><b>${esc(x.name)}</b>${x.kind === 'coach' ? ' <span class="chip">Coach</span>' : ''}${x.drop ? ' <span class="chip drop">Drop-in</span>' : ''}${x.heard ? `<small>“${esc(x.heard)}”</small>` : ''}${x.doubt ? `<small class="asst-doubt">Double-check: ${esc(x.doubt)}</small>` : ''}</div><div class="att-marks">${STAT.map(k => `<button type="button" class="att-mark m-${k}" aria-checked="${k === x.status}" data-r="${i}" data-s="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div></div>`;
      const paint = () => {
        $('#aresult').innerHTML = `<section class="card section-gap"><h3>Check attendance</h3><small class="muted">${esc(fmtShort(A.date))}${r.rest ? ' · everyone not named: ' + r.rest : ''} · tap to fix anything, then save.${r.model ? ' · ' + esc(r.model.split('/').slice(1).join('/')) : ''}</small>
          <div class="asst-list section-gap-sm">${rows.map(one).join('')}</div>
          ${r.unclear?.length ? `<div class="notice warn-n section-gap-sm"><b>Not sure about</b><ul>${r.unclear.map(u => `<li>${esc(u)}</li>`).join('')}</ul></div>` : ''}
          <div class="modal-actions"><span class="muted">${rows.filter(x => x.status).length} of ${rows.length} marked</span><button type="button" class="btn" id="asave">Save attendance</button></div></section>`;
        $$('#aresult [data-r]').forEach(b => b.onclick = () => { rows[+b.dataset.r].status = b.dataset.s; paint(); });
        $('#asave').onclick = async () => {
          const pick = k => rows.filter(x => x.kind === k && x.status);
          try {
            const res = await api('attendance', { method: 'POST', body: JSON.stringify({ batch_id: A.batch, date: A.date, records: pick('student').map(x => ({ student_id: x.id, status: x.status })), coaches: pick('coach').map(x => ({ coach_id: x.id, status: x.status })) }) });
            toast(`Saved ${res.saved} student${res.saved === 1 ? '' : 's'} and ${res.coaches} coach${res.coaches === 1 ? '' : 'es'}`);
            A.text = ''; box.value = ''; $('#aresult').innerHTML = '<section class="card section-gap"><p class="chip ok">Attendance saved</p></section>';
          } catch (e) { toast(e.message); }
        };
      };
      paint();
    };

    const save = async chosen => {
      if (!chosen.length) return toast('Nothing ticked');
      const btn = $('#asave'); btn.disabled = true;
      const date = todayStr(); let done = 0;
      try {
        // Skills: one call per student, keeping any start date already recorded.
        for (const sid of new Set(chosen.filter(a => a.type === 'skill').map(a => a.student))) {
          const prog = new Map((await api('student-progress?student_id=' + encodeURIComponent(sid))).map(p => [p.skill_id, p]));
          const list = chosen.filter(a => a.type === 'skill' && a.student === sid);
          await api('student-progress', { method: 'POST', body: JSON.stringify({ student_id: sid, changes: list.map(a => ({ skill_id: a.skill, status: a.status, started_date: prog.get(a.skill)?.started_date || date, mastered_date: a.status === 'mastered' ? prog.get(a.skill)?.mastered_date || date : null })) }) });
          done += list.length;
        }
        for (const a of chosen.filter(a => a.type === 'count')) {
          if (TIMED.has(a.metric)) await api('rep-sessions', { method: 'POST', body: JSON.stringify({ student_id: a.student, exercise: a.metric, record_date: date, total: Math.round(a.value), taps: [] }) });
          else await api('fitness', { method: 'POST', body: JSON.stringify({ student_id: a.student, record_date: date, values: { [a.metric]: a.value } }) });
          done++;
        }
        for (const a of chosen.filter(a => a.type === 'note')) { await api('student-notes', { method: 'POST', body: JSON.stringify({ student_id: a.student, worked_on: a.worked_on, next_steps: a.next_steps }) }); done++; }
        toast(`Saved ${done} change${done === 1 ? '' : 's'}`);
        A.text = ''; box.value = '';
        $('#aresult').innerHTML = `<section class="card section-gap"><p class="chip ok">Saved ${done} change${done === 1 ? '' : 's'}</p></section>`;
      } catch (e) { toast(`Saved ${done}, then stopped: ${e.message}`); btn.disabled = false; }
    };
  };
  titles.assistant = 'Coach assistant';
})();
