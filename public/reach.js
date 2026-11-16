/* MFU reach: things that make the site easy to come back to. "Add to home screen" so it opens like an app, the weekly
   parent email (admin switch, preview and send; each parent's own off switch), and nothing else.
   Loaded after student.js (uses api, esc, toast, state, PAGES, show, $, $$). */
(() => {
  /* ---- install as an app: one small bar for parents, students and coaches on a phone, until they answer it ---- */
  const KEY = 'mfu-install';
  const store = { get: () => { try { return localStorage.getItem(KEY); } catch { return 'no'; } }, set: v => { try { localStorage.setItem(KEY, v); } catch { /* private mode */ } } };
  const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let prompt = null; // Android and desktop Chrome hand us the real install prompt
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); prompt = e; offer(); });
  addEventListener('appinstalled', () => { store.set('done'); $('#install-bar')?.remove(); });

  function offer() {
    if (!state.role || state.role === 'admin' || installed() || store.get() || $('#install-bar') || innerWidth > 900) return;
    if (!prompt && !ios) return; // nothing useful to say on this browser
    document.body.insertAdjacentHTML('beforeend', `<div id="install-bar" role="region" aria-label="Install MFU Tracker"><div><b>Keep MFU Tracker on your phone</b><small>${prompt ? 'Opens like an app, already signed in.' : 'Tap the Share button, then “Add to Home Screen”.'}</small></div>
      ${prompt ? '<button type="button" class="btn small" id="install-yes">Add</button>' : ''}<button type="button" class="btn secondary small" id="install-no">${prompt ? 'Not now' : 'Got it'}</button></div>`);
    $('#install-no').onclick = () => { store.set('no'); $('#install-bar').remove(); };
    $('#install-yes') && ($('#install-yes').onclick = async () => { $('#install-bar').remove(); prompt.prompt(); const r = await prompt.userChoice.catch(() => ({})); store.set(r.outcome === 'accepted' ? 'done' : 'no'); prompt = null; });
  }
  const _setRole = setRole;
  // eslint-disable-next-line no-global-assign
  setRole = function (role, me) { _setRole(role, me); setTimeout(offer, 4000); }; // after the page has settled

  /* ---- parents: their own switch for the weekly email ---- */
  const _account = PAGES.account;
  PAGES.account = async () => {
    await _account();
    if (state.role !== 'parent' || !state.home?.parent) return;
    const p = state.home.parent;
    $('#content').insertAdjacentHTML('beforeend', `<div class="card narrow section-gap"><h3>Weekly email</h3><label class="check-row"><input type="checkbox" id="dg-on" ${p.digest_off ? '' : 'checked'}> Email me my child's week every Sunday: attendance, new skills, coach notes and what is coming up.</label></div>`);
    $('#dg-on').onchange = async e => { try { await api('parent/digest', { method: 'POST', body: JSON.stringify({ on: e.target.checked }) }); p.digest_off = e.target.checked ? 0 : 1; toast(e.target.checked ? 'Weekly email on' : 'Weekly email off'); } catch (err) { toast(err.message); e.target.checked = !e.target.checked; } };
  };

  /* ---- admin: the weekly email, on the Email page ---- */
  const _email = PAGES.email;
  PAGES.email = async () => {
    await _email();
    if (state.role !== 'admin') return;
    const d = await api('digest').catch(() => null); if (!d) return;
    $('#content .welcome').insertAdjacentHTML('afterend', `<div class="card" id="dg"><h3>Weekly email to parents</h3>
      <p class="muted">Every Sunday each parent gets their own child's week: classes attended, new skills, coach notes and what is coming up. The button in it opens MFU Tracker already signed in. Parents can turn it off under Account.</p>
      ${d.mail ? '' : '<p class="error">Email is not connected yet, so nothing can be sent.</p>'}
      <label class="check-row"><input type="checkbox" id="dg-auto" ${d.on ? 'checked' : ''}> Send it automatically every Sunday</label>
      <div class="card-actions"><button type="button" class="btn secondary small" id="dg-prev" ${d.mail ? '' : 'disabled'}>Email me a preview</button><button type="button" class="btn secondary small" id="dg-send" ${d.mail ? '' : 'disabled'}>Send this week's now</button></div>
      <p class="muted" id="dg-note">${d.on ? 'On. It starts going out on Sunday morning, as people visit the site.' : 'Off. Send yourself a preview first, then turn it on.'}</p></div>`);
    const note = t => { $('#dg-note').textContent = t; };
    $('#dg-auto').onchange = async e => { try { const r = await api('digest/setting', { method: 'POST', body: JSON.stringify({ on: e.target.checked }) }); note(r.on ? 'On. The first one goes out next Sunday morning.' : 'Off.'); } catch (err) { toast(err.message); e.target.checked = !e.target.checked; } };
    $('#dg-prev').onclick = async e => { e.target.disabled = true; try { const r = await api('digest/preview', { method: 'POST', body: '{}' }); note(`Sent ${r.sent} real example${r.sent === 1 ? '' : 's'} to ${r.to}. Parents got nothing.`); } catch (err) { note(err.message); } e.target.disabled = false; };
    $('#dg-send').onclick = async e => {
      if (!confirm("Email every parent this week's update now?")) return;
      const b = e.target; b.disabled = true; let restart = true, total = 0;
      try {
        // The server sends for about 20 seconds per call; keep going until nobody is left.
        for (;;) { const r = await api('digest/send', { method: 'POST', body: JSON.stringify({ restart }), headers: { 'x-bypass-cooldown': '1' } }); restart = false; total += r.sent; note(`Sent ${total} so far, ${r.waiting} to go…`); if (r.error) { note(`Stopped after ${total}: ${r.error}`); break; } if (!r.waiting) { note(`Done. ${total} parent${total === 1 ? '' : 's'} emailed. Parents with nothing new this week were skipped.`); break; } }
      } catch (err) { note(err.message); }
      b.disabled = false;
    };
  };
})();
