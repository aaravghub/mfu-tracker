/* MFU motion: the page answers what people do. Each page's blocks rise in on arrival, totals count up, every student gets
   their own avatar colour, and taps pulse. Transform and opacity only; nothing loops. Loaded last (wraps show()). */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const content = document.querySelector('#content');

  // Same initials, same colour, every visit: a hue from the name, kept pale so it reads as identity, not data.
  const HUES = [0, 18, 32, 46, 88, 128, 158, 178, 196, 212, 336, 350]; // no violet or indigo
  const hue = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return HUES[(h >>> 0) % HUES.length]; };
  const tint = root => root.querySelectorAll('.avatar:not([style]),.mini-avatar:not([style])').forEach(a => a.style.setProperty('--h', hue(a.textContent.trim() || '?')));

  // Count a figure up from zero; keeps any suffix such as "%".
  const countUp = root => {
    if (reduce) return;
    root.querySelectorAll('.stat strong,.stat b,.att-count b,.fit-tile b').forEach(el => {
      const m = /^(\d{1,6})(\D{0,3})$/.exec(el.textContent.trim()); if (!m || el.dataset.counted) return;
      el.dataset.counted = '1';
      const end = +m[1], suffix = m[2], t0 = performance.now(), dur = Math.min(900, 300 + end * 12);
      if (end < 2) return;
      const step = now => { const p = Math.min(1, (now - t0) / dur), v = Math.round(end * (1 - (1 - p) ** 3)); el.textContent = v + suffix; if (p < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  };

  window.mfuPulse = el => { if (reduce || !el) return; el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); };

  const arrive = () => {
    tint(content); countUp(content);
    if (reduce) return;
    content.classList.remove('page-in'); void content.offsetWidth; content.classList.add('page-in');
  };

  const _show = show;
  // eslint-disable-next-line no-global-assign
  show = async function (page) { const r = await _show(page); arrive(); return r; };

  // Content that loads after the page (a roster, a report, a chart) gets the same treatment, once per block.
  let queued = 0;
  new MutationObserver(muts => {
    if (queued) return;
    queued = requestAnimationFrame(() => {
      queued = 0; tint(content); countUp(content);
      if (reduce) return;
      for (const m of muts) m.addedNodes.forEach(n => { if (n.nodeType === 1 && n.parentElement !== content && n.matches('.card,.table-wrap,.att-batch,.lc,.star,.event-card,.note,.pace-card')) n.classList.add('rise'); });
    });
  }).observe(content, { childList: true, subtree: true });

  // Attendance marks and evaluation buttons pop when chosen.
  document.addEventListener('click', e => { const b = e.target.closest('.att-mark,.eval-btn,.seg button,.week-dots button'); if (b) window.mfuPulse(b); });
})();
