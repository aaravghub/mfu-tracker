/* MFU pyramids: a library of duets, trios and full pyramids, an editor with a pole/rope/ground diagram where each
   kid's spot is a numbered dot, and each demo's ordered list of pyramids (copied from the library, editable).
   Loaded after features.js (uses api, esc, toast, hero, empty, openModal, show, nameOf, mfuPhotoBlock, state, titles, NAV, PAGES, $, $$). */
(() => {
  const KIND = { duet: 'Duet', trio: 'Trio', full: 'Full pyramid' };
  const PLACE = { pole: 'Pole', rope: 'Rope', ground: 'Ground' };
  // Diagram geometry (SVG units): the pole or rope in the middle, the ground line, and the height between top and ground.
  // A pyramid is on the pole or on the rope (never both), plus the ground.
  const G = { w: 320, h: 380, mid: 160, top: 30, ground: 320 };
  const spotXY = s => s.place === 'ground' ? [20 + s.x * (G.w - 40), G.ground + 22] : [G.mid + (s.x - 0.5) * 80, G.ground - s.y * (G.ground - G.top)];

  // The diagram: the apparatus and the ground, with a numbered dot for every spot. `active` is the spot being placed.
  const diagram = (spots, active = -1, apparatus = 'pole') => {
    return `<svg class="pyr-svg" viewBox="0 0 ${G.w} ${G.h}" role="img" aria-label="Pyramid diagram on the ${apparatus}: ${spots.map((s, i) => `${i + 1} ${esc(s.student || 'open')} ${s.place === 'ground' ? 'ground' : apparatus}`).join(', ')}">
      ${apparatus === 'rope' ? `<line x1="${G.mid}" y1="${G.top - 10}" x2="${G.mid}" y2="${G.ground - 8}" class="pyr-rope"/><rect x="${G.mid - 30}" y="${G.top - 18}" width="60" height="8" rx="4" class="pyr-pole"/>`
        : `<rect x="${G.mid - 9}" y="${G.top}" width="18" height="${G.ground - G.top}" rx="9" class="pyr-pole"/><ellipse cx="${G.mid}" cy="${G.top}" rx="11" ry="6" class="pyr-pole"/>`}
      <line x1="10" y1="${G.ground}" x2="${G.w - 10}" y2="${G.ground}" class="pyr-ground"/>
      <text x="${G.w - 12}" y="${G.ground - 6}" text-anchor="end" class="pyr-label">Ground</text>
      ${spots.map((s, i) => { const [x, y] = spotXY(s); return `<g class="pyr-dot ${i === active ? 'on' : ''}" data-dot="${i}"><circle cx="${x}" cy="${y}" r="13"/><text x="${x}" y="${y + 4.5}" text-anchor="middle">${i + 1}</text></g>`; }).join('')}
    </svg>`;
  };
  window.mfuPyramidDiagram = diagram;

  // ---- editor ----
  async function editor(id, { demo = null } = {}) {
    const [p, skills, students] = await Promise.all([id ? api('pyramids/' + id) : { name: '', kind: 'trio', apparatus: 'pole', people: 3, notes: '', spots: [] }, api('skills?include=general'), api('students')]);
    let apparatus = p.apparatus === 'rope' ? 'rope' : 'pole';
    const kids = students.filter(s => s.active !== 0).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    const demoKids = new Set((demo?.students || []).map(s => s.student_id));
    const spots = p.spots.map(s => ({ skill_id: s.skill_id || '', skill_name: s.skill_id ? '' : s.skill || '', place: s.place, x: s.x, y: s.y, student_id: s.student_id || '', student: s.student?.trim() || '' }));
    let active = -1;
    const skillOpts = cur => ['pole', 'rope', 'yoga'].map(a => `<optgroup label="${a[0].toUpperCase() + a.slice(1)}">${skills.filter(k => k.apparatus === a).map(k => `<option value="${esc(k.id)}" ${k.id === cur ? 'selected' : ''}>${esc(k.name)}${k.general ? '' : ' (L' + k.level + ')'}</option>`).join('')}</optgroup>`).join('');
    const kidOpts = cur => `<option value="">Open spot</option>${demoKids.size ? `<optgroup label="In this demo">${kids.filter(k => demoKids.has(k.id)).map(k => `<option value="${esc(k.id)}" ${k.id === cur ? 'selected' : ''}>${esc(nameOf(k))}</option>`).join('')}</optgroup><optgroup label="Everyone else">` : ''}${kids.filter(k => !demoKids.has(k.id)).map(k => `<option value="${esc(k.id)}" ${k.id === cur ? 'selected' : ''}>${esc(nameOf(k))}</option>`).join('')}${demoKids.size ? '</optgroup>' : ''}`;
    const m = openModal(id ? 'Edit pyramid' : 'New pyramid', `<form id="pyf">
      <div class="form-grid"><label class="wide">Name<input name="name" required maxlength="120" value="${esc(p.name)}" placeholder="e.g. Three-level flag"></label>
      <label>On the<select name="apparatus" id="pyrapp"><option value="pole" ${apparatus === 'pole' ? 'selected' : ''}>Pole and ground</option><option value="rope" ${apparatus === 'rope' ? 'selected' : ''}>Rope and ground</option></select></label>
      <label>Type<select name="kind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}" ${k === p.kind ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>People<input type="number" name="people" min="2" max="40" value="${p.people}"></label>
      <label class="wide">Notes<textarea name="notes" rows="2" placeholder="Cues, counts, how to come down">${esc(p.notes || '')}</textarea></label></div>
      <div class="pyr-edit"><div><div id="pyrsvg"></div><p class="muted pyr-hint" id="pyrhint">Pick a spot on the right, then tap the pole, rope or ground to place it.</p></div>
      <div><h4>Spots</h4><div id="pyrspots" class="pyr-spots"></div><button type="button" class="btn secondary small" id="pyradd">+ Add a spot</button></div></div>
      ${id ? '<h4>Reference photo</h4><div id="pyrphoto"></div>' : '<p class="muted">Save first, then add a reference photo.</p>'}
      <div class="modal-actions">${id ? '<button type="button" class="btn secondary" id="pyrdel">Delete</button>' : ''}<button class="btn">Save pyramid</button></div></form>`, { wide: true });
    const paint = () => {
      m.$('#pyrsvg').innerHTML = diagram(spots.map(s => ({ ...s, student: kids.find(k => k.id === s.student_id) ? nameOf(kids.find(k => k.id === s.student_id)) : '' })), active, apparatus);
      m.$('#pyrhint').textContent = active >= 0 ? `Tap where spot ${active + 1} goes.` : 'Pick a spot on the right, then tap the pole, rope or ground to place it.';
      m.$('#pyrspots').innerHTML = spots.length ? spots.map((s, i) => `<div class="pyr-spot ${i === active ? 'on' : ''}" data-i="${i}">
        <button type="button" class="pyr-num" data-pick="${i}" aria-label="Place spot ${i + 1}">${i + 1}</button>
        <select data-f="place">${[apparatus, 'ground'].map(k => `<option value="${k}" ${k === s.place ? 'selected' : ''}>${PLACE[k]}</option>`).join('')}</select>
        <select data-f="skill_id"><option value="">New skill…</option>${skillOpts(s.skill_id)}</select>
        <input data-f="skill_name" placeholder="New skill name" value="${esc(s.skill_name)}" ${s.skill_id ? 'hidden' : ''}>
        <select data-f="student_id">${kidOpts(s.student_id)}</select>
        <button type="button" class="icon-btn" data-rm="${i}" aria-label="Remove spot ${i + 1}">✕</button></div>`).join('') : '<p class="muted">No spots yet.</p>';
      m.$$('#pyrspots [data-f]').forEach(el => el.onchange = el.oninput = () => { const s = spots[+el.closest('[data-i]').dataset.i]; s[el.dataset.f] = el.value; if (el.dataset.f === 'skill_id' || el.dataset.f === 'place' || el.dataset.f === 'student_id') paint(); });
      m.$$('[data-pick]').forEach(b => b.onclick = () => { active = active === +b.dataset.pick ? -1 : +b.dataset.pick; paint(); });
      m.$$('[data-rm]').forEach(b => b.onclick = () => { spots.splice(+b.dataset.rm, 1); active = -1; paint(); });
      m.$$('#pyrsvg [data-dot]').forEach(g => g.onclick = e => { e.stopPropagation(); active = +g.dataset.dot; paint(); });
      // Tapping the drawing places the active spot: near the ground line = ground, else the nearer of pole and rope.
      m.$('#pyrsvg svg').onclick = e => {
        if (active < 0) return;
        const svg = e.currentTarget, pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
        const { x, y } = pt.matrixTransform(svg.getScreenCTM().inverse()), s = spots[active];
        if (y > G.ground - 12) Object.assign(s, { place: 'ground', x: Math.min(1, Math.max(0, (x - 20) / (G.w - 40))), y: 0 });
        else Object.assign(s, { place: apparatus, x: Math.min(1, Math.max(0, (x - G.mid) / 80 + 0.5)), y: Math.min(1, Math.max(0, (G.ground - y) / (G.ground - G.top))) });
        active = -1; paint();
      };
    };
    // Switching pole and rope moves every spot that is not on the ground to the new apparatus.
    m.$('#pyrapp').onchange = e => { apparatus = e.target.value; spots.forEach(s => { if (s.place !== 'ground') s.place = apparatus; }); paint(); };
    m.$('#pyradd').onclick = () => { spots.push({ skill_id: '', skill_name: '', place: apparatus, x: 0.5, y: Math.min(1, spots.filter(s => s.place === apparatus).length * 0.25 + 0.1), student_id: '' }); active = spots.length - 1; paint(); };
    if (id) m.$('#pyrphoto').append(mfuPhotoBlock(p.image_url, { alt: p.name, route: 'photo?kind=pyramid&id=' + encodeURIComponent(id) }));
    m.$('#pyrdel') && (m.$('#pyrdel').onclick = async () => { if (!confirm('Delete this pyramid?')) return; await api('pyramids/' + id, { method: 'DELETE' }); m.close(); toast('Pyramid deleted'); show(state.page); });
    m.$('#pyf').onsubmit = async e => {
      e.preventDefault(); const f = e.target.elements;
      const body = { name: f.name.value, kind: f.kind.value, apparatus, people: Number(f.people.value), notes: f.notes.value, spots, ...(demo && !id ? { demo_id: demo.id } : {}) };
      try { const r = await api('pyramids' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) }); toast('Pyramid saved'); m.close(); if (!id) editor(r.id, { demo }); else show(state.page); }
      catch (err) { toast(err.message); }
    };
    paint();
  }
  window.mfuPyramidEditor = editor;

  // ---- library page ----
  PAGES.pyramids = async () => {
    const all = await api('pyramids'), F = state.pyrKind ||= '';
    const list = all.filter(p => !F || p.kind === F);
    $('#content').innerHTML = hero('Pyramids', 'Duets, trios and full pyramids with who goes where. Pyramids planned in demos land here too.', '<button class="btn" id="pynew">+ New pyramid</button>') +
      `<div class="seg" id="pykind">${[['', 'All'], ...Object.entries(KIND)].map(([k, v]) => `<button type="button" data-k="${k}" class="${k === F ? 'active' : ''}">${v}${k ? 's' : ''}</button>`).join('')}</div>` +
      (list.length ? `<div class="pyr-grid">${list.map(p => `<button type="button" class="card pyr-card" data-open="${esc(p.id)}"><b>${esc(p.name)}</b><span class="chips"><span class="chip">${KIND[p.kind]}</span><span class="chip">${p.apparatus === 'rope' ? 'Rope' : 'Pole'}</span><span class="chip">${p.people} people</span>${p.demo_title ? `<span class="chip type-demo">${esc(p.demo_title)}</span>` : ''}</span><small class="muted">${p.spots} spot${p.spots === 1 ? '' : 's'} planned</small></button>`).join('')}</div>` : `<div class="card">${empty('', 'No pyramids yet', 'Add one, or plan one inside a demo.')}</div>`);
    $('#pynew').onclick = () => editor(null);
    $$('#pykind button').forEach(b => b.onclick = () => { state.pyrKind = b.dataset.k; show('pyramids'); });
    $$('[data-open]').forEach(b => b.onclick = () => editor(b.dataset.open));
  };

  // ---- a demo's pyramids, in order ----
  window.mfuDemoPyramids = async demo => {
    const [mine, library] = await Promise.all([api('pyramids?demo_id=' + encodeURIComponent(demo.id)), api('pyramids')]);
    const others = library.filter(p => p.demo_id !== demo.id);
    const m = openModal('Pyramids · ' + demo.title, `<p class="muted">In the order they are performed. Copies from the library can be changed for this demo without touching the original.</p>
      <ol class="pyr-order">${mine.map((p, i) => `<li><span><b>${esc(p.name)}</b> <small class="muted">${KIND[p.kind]} · ${p.people} people · ${p.spots} spots</small></span><span class="card-actions">
        <button type="button" class="icon-btn" data-mv="${i}|-1" aria-label="Move up" ${i ? '' : 'disabled'}>↑</button><button type="button" class="icon-btn" data-mv="${i}|1" aria-label="Move down" ${i < mine.length - 1 ? '' : 'disabled'}>↓</button>
        <button type="button" class="btn secondary small" data-edit="${esc(p.id)}">Open</button></span></li>`).join('') || '<li class="muted">No pyramids planned yet.</li>'}</ol>
      <div class="form-grid section-gap-sm"><label class="wide">Add from the library<select id="pyfrom"><option value="">Choose a pyramid…</option>${others.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${KIND[p.kind]} · ${p.people}</option>`).join('')}</select></label></div>
      <div class="modal-actions"><button type="button" class="btn secondary" id="pyblank">New pyramid for this demo</button></div>`, { wide: true });
    const again = () => { m.close(); window.mfuDemoPyramids(demo); };
    m.$('#pyfrom').onchange = async e => { if (!e.target.value) return; await api(`pyramids/${e.target.value}/copy`, { method: 'POST', body: JSON.stringify({ demo_id: demo.id }) }); toast('Added to the demo'); again(); };
    m.$('#pyblank').onclick = () => { m.close(); editor(null, { demo }); };
    m.$$('[data-edit]').forEach(b => b.onclick = () => { m.close(); editor(b.dataset.edit, { demo }); });
    m.$$('[data-mv]').forEach(b => b.onclick = async () => {
      const [i, d] = b.dataset.mv.split('|').map(Number), order = [...mine]; [order[i], order[i + d]] = [order[i + d], order[i]];
      await Promise.all(order.map((p, k) => api('pyramids/' + p.id, { method: 'PUT', body: JSON.stringify({ sort_order: k + 1 }) }))); again();
    });
  };

  /* ---- a demo's running order: pyramids, each kid's solo, group routines; a time and a song for each ---- */
  const mmss = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  const secs = v => { const [m, s] = String(v).includes(':') ? String(v).split(':').map(Number) : [0, Number(v)]; return Math.max(0, (m || 0) * 60 + (s || 0)); };
  // YouTube and YouTube Music links → video ids, for a one-tap playlist.
  const ytId = u => /(?:[?&]v=|youtu\.be\/|\/shorts\/)([A-Za-z0-9_-]{11})/.exec(u || '')?.[1];

  // A kid's demo routine lives on the kid, so the next demo starts from it; changing it here changes it there too.
  const soloRoutine = async (sid, name) => {
    const r = await api('student-demo-routine?student_id=' + encodeURIComponent(sid));
    const m = openModal('Demo routine · ' + name, `<p class="muted">Kept for ${esc(name)}'s next demo too. Separate from their class routine.</p><form id="sdr" class="form-grid">
      <label>On the<select name="apparatus"><option value="pole" ${r.apparatus !== 'rope' ? 'selected' : ''}>Pole</option><option value="rope" ${r.apparatus === 'rope' ? 'selected' : ''}>Rope</option></select></label>
      <label class="wide">Routine, one skill per line<textarea name="content" rows="8">${esc(r.content || '')}</textarea></label>
      <label class="wide">Video link (optional)<input type="url" name="video_url" value="${esc(r.video_url || '')}"></label>
      <div class="modal-actions wide"><button class="btn">Save routine</button></div></form>`, { wide: true });
    m.$('#sdr').onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); try { await api('student-demo-routine', { method: 'PUT', body: JSON.stringify({ student_id: sid, ...f }) }); toast('Routine saved'); m.close(); } catch (err) { toast(err.message); } };
  };

  window.mfuDemoShow = async demo => {
    const [saved, pyrs] = await Promise.all([api('demo-lineup?demo_id=' + encodeURIComponent(demo.id)), api('pyramids?demo_id=' + encodeURIComponent(demo.id))]);
    const label = i => i.kind === 'pyramid' ? pyrs.find(p => p.id === i.ref_id)?.name : i.kind === 'solo' ? (k => k && k.first_name + ' ' + k.last_name)(demo.students.find(s => s.student_id === i.ref_id)) : demo.routines?.find(r => r.id === i.ref_id)?.title;
    let items = saved.map(i => ({ kind: i.kind, ref_id: i.ref_id, duration: i.duration, song_title: i.song_title || '', song_url: i.song_url || '', label: i.label }));
    const add = (kind, ref_id) => { if (!items.some(i => i.kind === kind && i.ref_id === ref_id)) items.push({ kind, ref_id, duration: 0, song_title: '', song_url: '', label: label({ kind, ref_id }) }); };
    const m = openModal('Running order · ' + demo.title, '<div id="show"></div>', { wide: true });
    const KL = { pyramid: 'Pyramid', solo: 'Solo', routine: 'Group' };
    const paint = () => {
      const total = items.reduce((a, i) => a + (i.duration || 0), 0), ids = items.map(i => ytId(i.song_url)).filter(Boolean);
      m.$('#show').innerHTML = `<p class="muted">Pyramids first, then each kid's routine, in the order they go on. Time a run-through to fill in each length, then pick a song that fits.</p>
        <ol class="show-list">${items.map((i, k) => `<li class="show-item" data-k="${k}"><div class="show-head"><span class="chip ${i.kind === 'pyramid' ? 'type-demo' : i.kind === 'solo' ? 'type-evaluation' : ''}">${KL[i.kind]}</span><b>${esc(i.label || 'Removed')}</b>
          <span class="card-actions">${i.kind === 'solo' ? `<button type="button" class="btn secondary small" data-solo="${k}">Routine</button>` : ''}<button type="button" class="icon-btn" data-mv="${k}|-1" ${k ? '' : 'disabled'} aria-label="Move up">↑</button><button type="button" class="icon-btn" data-mv="${k}|1" ${k < items.length - 1 ? '' : 'disabled'} aria-label="Move down">↓</button><button type="button" class="icon-btn" data-rm="${k}" aria-label="Remove">✕</button></span></div>
          <div class="show-fields"><label>Time<input data-f="duration" value="${mmss(i.duration || 0)}" inputmode="numeric" aria-label="Length, minutes:seconds"></label><label>Song<input data-f="song_title" value="${esc(i.song_title)}" placeholder="Song name"></label><label>YouTube or YT Music link<input data-f="song_url" type="url" value="${esc(i.song_url)}" placeholder="https://music.youtube.com/watch?v=…"></label></div></li>`).join('') || '<li class="muted">Nothing in the order yet.</li>'}</ol>
        <div class="form-grid section-gap-sm"><label class="wide">Add to the order<select id="showadd"><option value="">Choose…</option>
          ${pyrs.length ? `<optgroup label="Pyramids">${pyrs.map(p => `<option value="pyramid|${esc(p.id)}">${esc(p.name)}</option>`).join('')}</optgroup>` : ''}
          ${demo.students.length ? `<optgroup label="Solos">${demo.students.map(s => `<option value="solo|${esc(s.student_id)}">${esc(s.first_name + ' ' + s.last_name)}</option>`).join('')}</optgroup>` : ''}
          ${demo.routines?.length ? `<optgroup label="Group routines">${demo.routines.map(r => `<option value="routine|${esc(r.id)}">${esc(r.title)}</option>`).join('')}</optgroup>` : ''}</select></label></div>
        <div class="card-actions"><button type="button" class="btn secondary small" id="addpyr">Add all pyramids</button><button type="button" class="btn secondary small" id="addsolo">Add every kid's solo</button></div>
        <div class="show-foot"><b>Total ${mmss(total)}</b><span class="card-actions"><button type="button" class="btn secondary" id="runtime" ${items.length ? '' : 'disabled'}>Time a run-through</button>${ids.length ? `<a class="btn secondary" target="_blank" rel="noopener" href="https://www.youtube.com/watch_videos?video_ids=${ids.slice(0, 50).join(',')}">Open song playlist (${ids.length})</a>` : ''}<button type="button" class="btn" id="showsave">Save order</button></span></div>`;
      m.$$('[data-f]').forEach(el => el.onchange = () => { const i = items[+el.closest('[data-k]').dataset.k]; i[el.dataset.f] = el.dataset.f === 'duration' ? secs(el.value) : el.value; paint(); });
      m.$$('[data-mv]').forEach(b => b.onclick = () => { const [k, d] = b.dataset.mv.split('|').map(Number); [items[k], items[k + d]] = [items[k + d], items[k]]; paint(); });
      m.$$('[data-rm]').forEach(b => b.onclick = () => { items.splice(+b.dataset.rm, 1); paint(); });
      m.$$('[data-solo]').forEach(b => b.onclick = () => soloRoutine(items[+b.dataset.solo].ref_id, items[+b.dataset.solo].label));
      m.$('#showadd').onchange = e => { const [kind, id] = e.target.value.split('|'); if (id) { add(kind, id); paint(); } };
      m.$('#addpyr').onclick = () => { pyrs.forEach(p => add('pyramid', p.id)); paint(); };
      m.$('#addsolo').onclick = () => { demo.students.forEach(s => add('solo', s.student_id)); paint(); };
      m.$('#runtime').onclick = () => runThrough(items, paint);
      m.$('#showsave').onclick = async () => { try { await api('demo-lineup', { method: 'PUT', body: JSON.stringify({ demo_id: demo.id, items }) }); toast('Running order saved'); } catch (e) { toast(e.message); } };
    };
    paint();
  };

  // Run-through: a stopwatch that records how long each item takes. Tap Next as each one ends.
  function runThrough(items, done) {
    const m = openModal('Time a run-through', '<div class="run"><p class="muted" id="runwhat">Press Start when the first item begins.</p><div class="timer-display" id="runclock">0:00</div><p class="muted" id="runtotal"></p><div class="timer-actions"><button type="button" class="btn" id="runbtn">Start</button></div></div>');
    let k = -1, t0 = 0, start = 0, tick = 0;
    const show = () => { const now = Date.now(); m.$('#runclock').textContent = mmss((now - t0) / 1000); m.$('#runtotal').textContent = 'Whole demo so far ' + mmss((now - start) / 1000); };
    m.$('#runbtn').onclick = () => {
      const now = Date.now();
      if (k >= 0) items[k].duration = Math.round((now - t0) / 1000);
      k++; t0 = now; if (k === 0) { start = now; tick = setInterval(show, 250); }
      if (k >= items.length) { clearInterval(tick); m.close(); toast('Times filled in. Save the order to keep them.'); return done(); }
      m.$('#runwhat').innerHTML = `Now: <b>${esc(items[k].label || '')}</b> (${k + 1} of ${items.length})`;
      m.$('#runbtn').textContent = k === items.length - 1 ? 'Finish' : 'Next';
    };
    m.root.addEventListener('click', e => { if (e.target === m.root || e.target.closest('[data-close]')) clearInterval(tick); });
  }

  titles.pyramids = 'Pyramids';
  for (const role of ['admin', 'coach']) for (const [, items] of NAV[role]) { const i = items.findIndex(([p]) => p === 'demos'); if (i >= 0 && !items.some(([p]) => p === 'pyramids')) items.splice(i + 1, 0, ['pyramids', 'Pyramids']); }
})();
