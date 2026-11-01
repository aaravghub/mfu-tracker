/* MFU Tracker — "Bulk add parent emails" on the Parents page: paste "Child name  email" lines, check the matches, apply.
   A child with no parent email gets it as their parent email; a child who already has one gets it as another parent. */
'use strict';
(() => {
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
  const lev = (a, b) => { const d = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i++) { let p = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; } } return d[b.length]; };
  const close = (a, b) => a && b && (a === b || (Math.min(a.length, b.length) >= 4 && lev(a, b) <= 2));
  // Common email typos, so a bad address isn't saved by accident.
  const TYPO = { 'gmail.cim': 'gmail.com', 'gmail.con': 'gmail.com', 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.co': 'gmail.com', 'yahoo.con': 'yahoo.com', 'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'hotmail.con': 'hotmail.com', 'outlook.con': 'outlook.com', 'icloud.con': 'icloud.com' };
  const fixEmail = e => { const [u, d] = e.split('@'); return d && TYPO[d] ? u + '@' + TYPO[d] : null; };
  const validEmail = e => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/.test(e);

  // "Avvyukth Terali uthrasrini@gmail.com" → { name, email }; header and blank lines are skipped.
  const parse = text => String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => { const m = /^(.*?)[\s,;\t]+([^\s,;\t]+@[^\s,;\t]+)\s*$/.exec(l); return m ? { name: m[1].replace(/[",]/g, '').trim(), email: m[2].toLowerCase() } : null; }).filter(r => r && r.name);

  // Best student for a name: exact full name, then first + last close (spelling), then first name + matching last initial ("Shloke C").
  function match(name, students) {
    const parts = name.split(/\s+/), f = norm(parts[0]), l = norm(parts.slice(1).join('')), full = norm(name);
    const exact = students.filter(s => norm(s.first_name + s.last_name) === full);
    if (exact.length === 1) return { s: exact[0], how: 'exact' };
    const fuzzy = students.filter(s => close(norm(s.first_name), f) && (close(norm(s.last_name), l) || (l.length <= 2 && norm(s.last_name).startsWith(l))));
    if (fuzzy.length === 1) return { s: fuzzy[0], how: 'close' };
    const firstOnly = students.filter(s => norm(s.first_name) === f);
    if (!l && firstOnly.length === 1) return { s: firstOnly[0], how: 'close' };
    return { s: null, how: 'none', options: [...new Set([...fuzzy, ...firstOnly])] };
  }

  function bulkModal(students, parents) {
    const linked = new Map(); parents.forEach(p => p.students.forEach(k => { if (!linked.has(k.id)) linked.set(k.id, []); linked.get(k.id).push(p.email.toLowerCase()); }));
    const m = openModal('Bulk add parent emails', `<p class="muted">Paste one child per line: their name, then the parent's email (a header line like “Client Name Email” is fine). Children with no parent email get it as their parent email; children who already have a different one get it added as <b>another parent</b>, so both receive emails.</p><textarea id="bk-in" rows="8" placeholder="Avvyukth Terali uthrasrini@gmail.com&#10;Aamaira Gupta ramrajg@me.com"></textarea><div class="modal-actions"><button class="btn" id="bk-check">Check list</button></div><div id="bk-out"></div>`, { wide: true });
    let rows = [];
    const outcome = r => {
      const s = students.find(x => x.id === r.student_id); if (!s) return ['skip', 'Skipped — no student picked'];
      if (!validEmail(r.email)) return ['bad', 'Email doesn\'t look right'];
      if (fixEmail(r.email)) return ['bad', 'Looks like a typo — use the fix or edit it'];
      const cur = (s.parent_email || '').toLowerCase();
      if (cur === r.email || (linked.get(s.id) || []).includes(r.email)) return ['same', 'Already has this email'];
      if (!cur) return ['set', 'Becomes the parent email'];
      return ['add', `Added as another parent (already has ${cur})`];
    };
    const draw = () => {
      const counts = rows.reduce((c, r) => { const k = outcome(r)[0]; c[k] = (c[k] || 0) + 1; return c; }, {});
      m.$('#bk-out').innerHTML = `<div class="chips section-gap-sm"><span class="chip ok">${counts.set || 0} new parent email${counts.set === 1 ? '' : 's'}</span><span class="chip ok">${counts.add || 0} added as another parent</span><span class="chip">${counts.same || 0} already there</span>${counts.skip ? `<span class="chip warn">${counts.skip} not matched</span>` : ''}${counts.bad ? `<span class="chip warn">${counts.bad} email problem${counts.bad > 1 ? 's' : ''}</span>` : ''}</div>
        <div class="table-wrap"><table><thead><tr><th>From your list</th><th>Student</th><th>Email</th><th>What happens</th></tr></thead><tbody>${rows.map((r, i) => { const [k, txt] = outcome(r), fix = fixEmail(r.email); return `<tr><td>${esc(r.name)}${r.how === 'close' ? ' <span class="chip warn" title="Spelled differently — check it">check</span>' : ''}</td><td><select data-bs="${i}"><option value="">— Skip (not in the list) —</option>${(r.options?.length ? r.options : []).concat(students.filter(s => !(r.options || []).includes(s))).map(s => `<option value="${esc(s.id)}" ${s.id === r.student_id ? 'selected' : ''}>${esc(nameOf(s))}</option>`).join('')}</select></td><td><input data-be="${i}" value="${esc(r.email)}">${fix ? `<button type="button" class="btn secondary small" data-bfix="${i}">Use ${esc(fix)}?</button>` : ''}</td><td><span class="chip ${k === 'set' || k === 'add' ? 'ok' : k === 'same' ? '' : 'warn'}">${esc(txt)}</span></td></tr>`; }).join('')}</tbody></table></div>
        <div class="modal-actions"><button class="btn" id="bk-apply" ${counts.set || counts.add ? '' : 'disabled'}>Add ${(counts.set || 0) + (counts.add || 0)} email${(counts.set || 0) + (counts.add || 0) === 1 ? '' : 's'}</button></div>`;
      m.$$('[data-bs]').forEach(sel => sel.onchange = () => { rows[+sel.dataset.bs].student_id = sel.value || null; rows[+sel.dataset.bs].how = 'picked'; draw(); });
      m.$$('[data-be]').forEach(inp => inp.onchange = () => { rows[+inp.dataset.be].email = inp.value.trim().toLowerCase(); draw(); });
      m.$$('[data-bfix]').forEach(b => b.onclick = () => { const r = rows[+b.dataset.bfix]; r.email = fixEmail(r.email); draw(); });
      m.$('#bk-apply').onclick = async () => {
        const send = rows.filter(r => ['set', 'add'].includes(outcome(r)[0])).map(r => ({ student_id: r.student_id, email: r.email }));
        if (!confirm(`Add ${send.length} parent email${send.length === 1 ? '' : 's'}?`)) return;
        try { const res = await api('parents/bulk-emails', { method: 'POST', body: JSON.stringify({ rows: send }) }); toast(`Done · ${res.set} new parent emails · ${res.added} added as another parent${res.already ? ' · ' + res.already + ' already there' : ''}`); m.close(); show('parents'); }
        catch (e) { toast(e.message); }
      };
    };
    m.$('#bk-check').onclick = () => {
      rows = parse(m.$('#bk-in').value).filter(r => !/^client name/i.test(r.name)).map(r => { const x = match(r.name, students); return { ...r, student_id: x.s?.id || null, how: x.how, options: x.options }; });
      if (!rows.length) return toast('No “name email” lines found');
      draw();
    };
  }

  const _parents = PAGES.parents;
  PAGES.parents = async () => {
    await _parents();
    if (state.role !== 'admin') return;
    $('#content .welcome-actions')?.insertAdjacentHTML('afterbegin', '<button class="btn secondary" id="bulk-emails">Bulk add parent emails</button>');
    $('#bulk-emails').onclick = async () => { const [students, parents] = await Promise.all([api('students'), api('parents')]); bulkModal(students.filter(s => s.active !== 0), parents); };
  };
  window.mfuBulkParse = (text, students) => parse(text).filter(r => !/^client name/i.test(r.name)).map(r => ({ ...r, ...match(r.name, students) }));
})();
