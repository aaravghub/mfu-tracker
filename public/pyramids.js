/* MFU pyramids: a library of duets, trios and full pyramids, an editor with a pole/rope/ground diagram where each
   kid's spot is a numbered dot, and each demo's ordered list of pyramids (copied from the library, editable).
   Loaded after features.js (uses api, esc, toast, hero, empty, openModal, show, nameOf, mfuPhotoBlock, state, titles, NAV, PAGES, $, $$). */
(() => {
  const KIND = { duet: 'Duet', trio: 'Trio', full: 'Full pyramid' };
  const PLACE = { pole: 'Pole', rope: 'Rope', ground: 'Ground' };
  // Diagram geometry (SVG units): pole and rope columns, ground line, and the climbable height between top and ground.
  const G = { w: 320, h: 380, pole: 120, rope: 230, top: 30, ground: 320 };
  const spotXY = s => s.place === 'ground' ? [20 + s.x * (G.w - 40), G.ground + 22]
    : [(s.place === 'rope' ? G.rope : G.pole) + (s.x - 0.5) * 60, G.ground - s.y * (G.ground - G.top)];

  // The diagram: pole always, rope when used; numbered dots for every spot. `active` is the spot being placed.
  const diagram = (spots, active = -1) => {
    const rope = spots.some(s => s.place === 'rope');
    return `<svg class="pyr-svg" viewBox="0 0 ${G.w} ${G.h}" role="img" aria-label="Pyramid diagram: ${spots.map((s, i) => `${i + 1} ${esc(s.student || 'open')} ${PLACE[s.place]}`).join(', ')}">
      <rect x="${G.pole - 9}" y="${G.top}" width="18" height="${G.ground - G.top}" rx="9" class="pyr-pole"/>
      <ellipse cx="${G.pole}" cy="${G.top}" rx="11" ry="6" class="pyr-pole"/>
      ${rope ? `<line x1="${G.rope}" y1="${G.top - 10}" x2="${G.rope}" y2="${G.ground - 8}" class="pyr-rope"/><rect x="${G.rope - 30}" y="${G.top - 18}" width="60" height="8" rx="4" class="pyr-pole"/>` : ''}
      <line x1="10" y1="${G.ground}" x2="${G.w - 10}" y2="${G.ground}" class="pyr-ground"/>
      <text x="${G.w - 12}" y="${G.ground - 6}" text-anchor="end" class="pyr-label">Ground</text>
      ${spots.map((s, i) => { const [x, y] = spotXY(s); return `<g class="pyr-dot ${i === active ? 'on' : ''}" data-dot="${i}"><circle cx="${x}" cy="${y}" r="13"/><text x="${x}" y="${y + 4.5}" text-anchor="middle">${i + 1}</text></g>`; }).join('')}
    </svg>`;
  };
  window.mfuPyramidDiagram = diagram;

  // ---- editor ----
  async function editor(id, { demo = null } = {}) {
    const [p, skills, students] = await Promise.all([id ? api('pyramids/' + id) : { name: '', kind: 'trio', people: 3, notes: '', spots: [] }, api('skills?include=general'), api('students')]);
    const kids = students.filter(s => s.active !== 0).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    const demoKids = new Set((demo?.students || []).map(s => s.student_id));
    const spots = p.spots.map(s => ({ skill_id: s.skill_id || '', skill_name: s.skill_id ? '' : s.skill || '', place: s.place, x: s.x, y: s.y, student_id: s.student_id || '', student: s.student?.trim() || '' }));
    let active = -1;
    const skillOpts = cur => ['pole', 'rope', 'yoga'].map(a => `<optgroup label="${a[0].toUpperCase() + a.slice(1)}">${skills.filter(k => k.apparatus === a).map(k => `<option value="${esc(k.id)}" ${k.id === cur ? 'selected' : ''}>${esc(k.name)}${k.general ? '' : ' (L' + k.level + ')'}</option>`).join('')}</optgroup>`).join('');
    const kidOpts = cur => `<option value="">Open spot</option>${demoKids.size ? `<optgroup label="In this demo">${kids.filter(k => demoKids.has(k.id)).map(k => `<option value="${esc(k.id)}" ${k.id === cur ? 'selected' : ''}>${esc(nameOf(k))}</option>`).join('')}</optgroup><optgroup label="Everyone else">` : ''}${kids.filter(k => !demoKids.has(k.id)).map(k => `<option value="${esc(k.id)}" ${k.id === cur ? 'selected' : ''}>${esc(nameOf(k))}</option>`).join('')}${demoKids.size ? '</optgroup>' : ''}`;
    const m = openModal(id ? 'Edit pyramid' : 'New pyramid', `<form id="pyf">
      <div class="form-grid"><label class="wide">Name<input name="name" required maxlength="120" value="${esc(p.name)}" placeholder="e.g. Three-level flag"></label>
      <label>Type<select name="kind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}" ${k === p.kind ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>People<input type="number" name="people" min="2" max="40" value="${p.people}"></label>
      <label class="wide">Notes<textarea name="notes" rows="2" placeholder="Cues, counts, how to come down">${esc(p.notes || '')}</textarea></label></div>
      <div class="pyr-edit"><div><div id="pyrsvg"></div><p class="muted pyr-hint" id="pyrhint">Pick a spot on the right, then tap the pole, rope or ground to place it.</p></div>
      <div><h4>Spots</h4><div id="pyrspots" class="pyr-spots"></div><button type="button" class="btn secondary small" id="pyradd">+ Add a spot</button></div></div>
      ${id ? '<h4>Reference photo</h4><div id="pyrphoto"></div>' : '<p class="muted">Save first, then add a reference photo.</p>'}
      <div class="modal-actions">${id ? '<button type="button" class="btn secondary" id="pyrdel">Delete</button>' : ''}<button class="btn">Save pyramid</button></div></form>`, { wide: true });
    const paint = () => {
      m.$('#pyrsvg').innerHTML = diagram(spots.map(s => ({ ...s, student: kids.find(k => k.id === s.student_id) ? nameOf(kids.find(k => k.id === s.student_id)) : '' })), active);
      m.$('#pyrhint').textContent = active >= 0 ? `Tap where spot ${active + 1} goes.` : 'Pick a spot on the right, then tap the pole, rope or ground to place it.';
      m.$('#pyrspots').innerHTML = spots.length ? spots.map((s, i) => `<div class="pyr-spot ${i === active ? 'on' : ''}" data-i="${i}">
        <button type="button" class="pyr-num" data-pick="${i}" aria-label="Place spot ${i + 1}">${i + 1}</button>
        <select data-f="place">${Object.entries(PLACE).map(([k, v]) => `<option value="${k}" ${k === s.place ? 'selected' : ''}>${v}</option>`).join('')}</select>
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
        else { const col = Math.abs(x - G.rope) < Math.abs(x - G.pole) ? 'rope' : 'pole';
          Object.assign(s, { place: col, x: Math.min(1, Math.max(0, (x - (col === 'rope' ? G.rope : G.pole)) / 60 + 0.5)), y: Math.min(1, Math.max(0, (G.ground - y) / (G.ground - G.top))) }); }
        active = -1; paint();
      };
    };
    m.$('#pyradd').onclick = () => { spots.push({ skill_id: '', skill_name: '', place: 'pole', x: 0.5, y: Math.min(1, spots.filter(s => s.place === 'pole').length * 0.25 + 0.1), student_id: '' }); active = spots.length - 1; paint(); };
    if (id) m.$('#pyrphoto').append(mfuPhotoBlock(p.image_url, { alt: p.name, route: 'photo?kind=pyramid&id=' + encodeURIComponent(id) }));
    m.$('#pyrdel') && (m.$('#pyrdel').onclick = async () => { if (!confirm('Delete this pyramid?')) return; await api('pyramids/' + id, { method: 'DELETE' }); m.close(); toast('Pyramid deleted'); show(state.page); });
    m.$('#pyf').onsubmit = async e => {
      e.preventDefault(); const f = e.target.elements;
      const body = { name: f.name.value, kind: f.kind.value, people: Number(f.people.value), notes: f.notes.value, spots, ...(demo && !id ? { demo_id: demo.id } : {}) };
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
      (list.length ? `<div class="pyr-grid">${list.map(p => `<button type="button" class="card pyr-card" data-open="${esc(p.id)}"><b>${esc(p.name)}</b><span class="chips"><span class="chip">${KIND[p.kind]}</span><span class="chip">${p.people} people</span>${p.demo_title ? `<span class="chip type-demo">${esc(p.demo_title)}</span>` : ''}</span><small class="muted">${p.spots} spot${p.spots === 1 ? '' : 's'} planned</small></button>`).join('')}</div>` : `<div class="card">${empty('', 'No pyramids yet', 'Add one, or plan one inside a demo.')}</div>`);
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

  titles.pyramids = 'Pyramids';
  for (const role of ['admin', 'coach']) for (const [, items] of NAV[role]) { const i = items.findIndex(([p]) => p === 'demos'); if (i >= 0 && !items.some(([p]) => p === 'pyramids')) items.splice(i + 1, 0, ['pyramids', 'Pyramids']); }
})();
