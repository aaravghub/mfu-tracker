/* MFU sign-in: email code by default, "Sign in with Google", and a password as a fallback. After a code or Google
   sign-in with no password on the account, people are asked to set one so the same email works either way.
   Loaded after signup.js (wraps loginView; uses api, esc, toast, openModal, enter, signupView, $). */
(() => {
  let gsi = null; // Google's sign-in script, loaded once, only on the sign-in page
  const loadGoogle = () => gsi ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = res; s.onerror = rej; document.head.append(s); });
  let clientId;

  // After signing in: offer to set a password if the account has none, then open the app.
  const done = async r => {
    if (r.needs_password) await new Promise(next => {
      const m = openModal('Set a password', `<p class="muted">So you can also sign in with your email and a password, not only with a code or Google.</p><form id="spf" class="form-grid">
        <label class="wide">New password<input type="password" name="pw" required minlength="8" autocomplete="new-password"></label><p class="muted wide">At least 8 characters with a letter and a number.</p>
        <div class="modal-actions wide"><button type="button" class="btn secondary" id="spskip">Later</button><button class="btn">Save password</button></div></form>`);
      m.$('#spskip').onclick = () => { m.close(); next(); };
      m.$('[data-close]').addEventListener('click', next);
      m.$('#spf').onsubmit = async e => { e.preventDefault(); try { await api('signin/password', { method: 'POST', body: JSON.stringify({ password: e.target.elements.pw.value }) }); toast('Password saved'); m.close(); next(); } catch (err) { toast(err.message); } };
    });
    await enter();
  };

  const _login = loginView;
  // eslint-disable-next-line no-global-assign
  loginView = function (mode = 'parent') {
    _login(mode);
    const pw = $('#login'); if (!pw) return;
    // Google first, then the email code; the password form stays one tap away.
    pw.insertAdjacentHTML('beforebegin', `<div id="gbtn" class="g-btn"></div>
      ${mode === 'admin' ? '' : `<form id="codef" class="code-form"><label>Email<input type="email" id="cemail" autocomplete="username" required></label>
        <button class="btn primary" id="csend">Email me a sign-in code</button>
        <div id="cstep" hidden><label>6-digit code<input id="ccode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}"></label><button type="button" class="btn primary" id="cgo">Sign in</button></div>
        <p class="error" id="cerr" role="alert"></p></form>
        <p class="center"><button type="button" class="link-btn" id="usepw">Use a password instead</button></p>`}`);
    if (mode !== 'admin') { pw.hidden = true; const su = pw.querySelector('.signup-link'); if (su) $('#usepw').parentElement.after(su); } // sign-up link stays visible
    $('#usepw')?.addEventListener('click', () => { pw.hidden = !pw.hidden; $('#codef').hidden = !pw.hidden; $('#usepw').textContent = pw.hidden ? 'Use a password instead' : 'Email me a code instead'; });
    $('#codef')?.addEventListener('submit', async e => {
      e.preventDefault(); $('#cerr').textContent = ''; const b = $('#csend'); b.disabled = true;
      try { await api('signin/code', { method: 'POST', body: JSON.stringify({ email: $('#cemail').value, role: mode }) }); $('#cstep').hidden = false; b.textContent = 'Send a new code'; $('#ccode').focus(); toast('If that email has an account, a code is on its way.'); }
      catch (err) { $('#cerr').textContent = err.message; } finally { b.disabled = false; }
    });
    const verify = async () => {
      if ($('#ccode').value.length !== 6) return;
      try { await done(await api('signin/code/verify', { method: 'POST', body: JSON.stringify({ email: $('#cemail').value, code: $('#ccode').value, role: mode }) })); }
      catch (err) { $('#cerr').textContent = err.message; }
    };
    $('#cgo')?.addEventListener('click', verify);
    $('#ccode')?.addEventListener('input', () => { if ($('#ccode').value.length === 6) verify(); });

    // Google's button. No account yet: open Sign up with the email and name filled in (it asks for a password there).
    (async () => {
      clientId ??= (await api('signin/config').catch(() => ({}))).google_client_id;
      if (!clientId) return;
      await loadGoogle().catch(() => null);
      if (!window.google?.accounts?.id || !$('#gbtn')) return;
      google.accounts.id.initialize({ client_id: clientId, callback: async resp => {
        const r = await fetch('/api/signin/google', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: resp.credential, role: mode }) });
        const d = await r.json().catch(() => ({}));
        if (r.ok) return done(d);
        if (d.signup && mode !== 'admin' && window.signupView) { signupView(mode); const f = document.querySelector('#suf'); if (f) { f.elements.email.value = d.signup.email; f.elements.name.value = d.signup.name; } toast('No account yet. Finish signing up and choose a password.'); }
        else toast(d.error || 'Google sign-in did not work.');
      } });
      // Google draws its button in a frame we cannot style, so ours is shown and Google's sits invisibly on top to take the tap.
      const box = $('#gbtn');
      box.innerHTML = `<span class="g-face" aria-hidden="true"><svg viewBox="0 0 48 48" width="20" height="20"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.8 6C12.3 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.2 5.6c4.2-3.9 7.1-9.6 7.1-17.1z"/><path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2 1.4-4.7 2.3-8.7 2.3-6.3 0-11.7-4.1-13.6-9.8l-7.8 6C6.6 42.6 14.6 48 24 48z"/></svg>Continue with Google</span><div class="g-real"></div>`;
      google.accounts.id.renderButton(box.querySelector('.g-real'), { type: 'standard', size: 'large', text: 'continue_with', width: Math.min(400, box.clientWidth || 320) });
    })();
  };
})();
