/* MFU glass behavior (no dependencies). Loaded after app.js + extra.js.
   1) liquid nav indicator  2) liquid page transitions (View Transitions + SVG displacement warp)  3) cursor-following glass highlights */
(() => {
  const $ = s => document.querySelector(s);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = () => matchMedia('(max-width:850px)').matches;

  /* ---- 1) liquid nav indicator: top and bottom edges move at different speeds, so it stretches like a droplet ---- */
  const nav = $('#nav');
  let blob = null, lastTop = null;
  function place() {
    if (!nav) return;
    const active = nav.querySelector('button.active');
    if (!blob || !blob.isConnected) { blob = document.createElement('i'); blob.className = 'nav-blob hidden'; nav.prepend(blob); }
    if (!active || !nav.offsetParent) { blob.classList.add('hidden'); lastTop = null; return; }
    const top = active.offsetTop, bottom = nav.clientHeight - (top + active.offsetHeight);
    blob.classList.remove('up', 'down');
    if (lastTop !== null && top !== lastTop) blob.classList.add(top > lastTop ? 'down' : 'up');
    blob.style.top = top + 'px'; blob.style.bottom = bottom + 'px';
    blob.classList.remove('hidden');
    lastTop = top;
  }
  if (nav) {
    new MutationObserver(m => { if (blob && m.every(x => x.target === blob)) return; requestAnimationFrame(place); }).observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    addEventListener('resize', () => requestAnimationFrame(place));
    $('#menu-toggle')?.addEventListener('click', () => setTimeout(place, 30));
    place();
  }

  /* ---- 2) liquid page transitions ---- */
  const disp = $('#mfu-disp'), content = $('#content');
  function warp() {
    if (reduce || small() || !disp || !content) return;
    content.classList.add('warping');
    const t0 = performance.now(), dur = 650;
    (function tick(now) {
      const p = Math.min(1, (now - t0) / dur);
      disp.setAttribute('scale', String(Math.sin(p * Math.PI) * 55));
      if (p < 1) requestAnimationFrame(tick); else { disp.setAttribute('scale', '0'); content.classList.remove('warping'); }
    })(t0);
  }
  if (typeof show === 'function') {
    const _show = show;
    // Never blocks rendering: fade the old page out, let the real show() run untouched, then animate the new page in.
    // eslint-disable-next-line no-global-assign
    show = async function (page) {
      if (reduce || !content) return _show(page);
      content.classList.remove('entering'); content.classList.add('leaving'); warp();
      const guard = setTimeout(() => content.classList.remove('leaving'), 1500);
      try { await Promise.all([_show(page), new Promise(r => setTimeout(r, 200))]); }
      finally {
        clearTimeout(guard);
        content.classList.remove('leaving'); void content.offsetWidth; content.classList.add('entering');
        setTimeout(() => content.classList.remove('entering'), 900);
      }
    };
  }

  /* ---- 3) glass highlight follows the cursor ---- */
  const LIT = '.sidebar,header,.card,.stat,.timer-card,.table-wrap,.event-card,.login';
  let raf = 0, ev = null;
  document.addEventListener('pointermove', e => {
    ev = e; if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const el = ev.target.closest?.(LIT);
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', (ev.clientX - r.left) + 'px');
      el.style.setProperty('--my', (ev.clientY - r.top) + 'px');
    });
  }, { passive: true });
})();
