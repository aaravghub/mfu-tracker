/* MFU chats: one chat per batch and per demo, with pinned posts and polls, plus polls for everyone.
   Loaded after features.js (uses api, esc, toast, hero, empty, openModal, show, state, titles, NAV, PAGES, $, $$). */
(() => {
  const POLL_MS = 5000; // how often an open chat asks for new messages
  const ago = t => { const s = Math.round(Date.now() / 1000 - t); return s < 60 ? 'now' : s < 3600 ? Math.round(s / 60) + 'm' : s < 86400 ? Math.round(s / 3600) + 'h' : new Date(t * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  const staff = () => state.role === 'admin' || state.role === 'coach';
  const roleChip = r => r === 'coach' ? ' <span class="chip">Coach</span>' : r === 'admin' ? ' <span class="chip">MFU</span>' : '';
  let timer = 0;

  // ---- polls ----
  const pollCard = p => {
    const total = Math.max(1, p.counts.reduce((a, b) => a + b, 0));
    return `<div class="poll" data-poll="${esc(p.id)}"><b>${esc(p.question)}</b><small class="muted">${p.multi ? 'Pick any' : 'Pick one'} · ${p.voters} voted${p.closed ? ' · closed' : ''}</small>
      <div class="poll-opts">${p.options.map((o, i) => `<button type="button" class="poll-opt ${p.mine.includes(i) ? 'on' : ''}" data-vote="${i}" ${p.closed ? 'disabled' : ''}><span class="poll-bar" style="--w:${Math.round(p.counts[i] / total * 100)}%"></span><span>${esc(o)}</span><b>${p.counts[i]}</b></button>`).join('')}</div>
      ${p.names ? `<details><summary class="muted">Who voted</summary>${p.options.map((o, i) => `<p class="muted"><b>${esc(o)}:</b> ${p.names[i].map(esc).join(', ') || 'nobody yet'}</p>`).join('')}</details>` : ''}
      ${staff() && !p.closed ? '<button type="button" class="btn secondary small" data-close-poll>Close poll</button>' : ''}</div>`;
  };
  const wirePolls = (root, polls, redraw) => root.querySelectorAll('[data-poll]').forEach(el => {
    const p = polls.get(el.dataset.poll); if (!p) return;
    el.querySelectorAll('[data-vote]').forEach(b => b.onclick = async () => {
      const i = Number(b.dataset.vote), mine = new Set(p.mine);
      if (p.multi) mine.has(i) ? mine.delete(i) : mine.add(i); else { mine.clear(); mine.add(i); }
      try { polls.set(p.id, await api(`polls/${p.id}/vote`, { method: 'POST', body: JSON.stringify({ choices: [...mine] }) })); redraw(); } catch (e) { toast(e.message); }
    });
    el.querySelector('[data-close-poll]')?.addEventListener('click', async () => { await api(`polls/${p.id}/close`, { method: 'POST' }); p.closed = true; redraw(); });
  });
  const newPoll = chat => new Promise(done => {
    const m = openModal(chat ? 'New poll' : 'New poll for everyone', `<form id="pf" class="form-grid">${chat ? '' : '<p class="muted wide">Every family and coach can see and vote, not only one batch.</p>'}
      <label class="wide">Question<input name="q" required maxlength="300"></label>
      <label class="wide">Choices, one per line<textarea name="o" rows="4" required placeholder="Saturday 10am&#10;Sunday 4pm"></textarea></label>
      <label class="wide check"><input type="checkbox" name="multi"> People can pick more than one</label>
      <div class="modal-actions wide"><button class="btn">Post poll</button></div></form>`);
    m.$('#pf').onsubmit = async e => {
      e.preventDefault(); const f = e.target.elements;
      try { await api('polls', { method: 'POST', body: JSON.stringify({ chat, question: f.q.value, options: f.o.value.split('\n'), multi: f.multi.checked }) }); m.close(); done(true); } catch (err) { toast(err.message); }
    };
  });

  // ---- the chat list ----
  PAGES.chats = async () => {
    clearInterval(timer);
    if (state.chatOpen) return openChat(state.chatOpen);
    const d = await api('chats'), polls = new Map(d.polls.map(p => [p.id, p]));
    const seen = (() => { try { return JSON.parse(localStorage.getItem('mfu-chat-seen') || '{}'); } catch { return {}; } })();
    const draw = () => {
      $('#content').innerHTML = hero('Chats', 'A chat for every batch and demo. Coaches can pin posts and start polls.', staff() ? '<button class="btn secondary" id="pnew">New poll for everyone</button>' : '') +
        (d.polls.length ? `<section class="card"><h3>Polls for everyone</h3><div class="poll-list">${[...polls.values()].map(pollCard).join('')}</div></section>` : '') +
        `<section class="card section-gap">${d.chats.length ? `<div class="chat-list">${d.chats.map(c => `<button type="button" class="chat-row" data-chat="${esc(c.chat)}"><span><b>${esc(c.title)}</b><small class="muted">${c.kind === 'demo' ? 'Demo' + (c.date ? ' · ' + esc(fmtShort(c.date)) : '') : 'Batch'}</small></span>${c.last_id > (seen[c.chat] || 0) ? '<span class="chip ok">New</span>' : ''}</button>`).join('')}</div>` : empty('', 'No chats yet', 'Chats appear for your batches and demos.')}</section>`;
      $$('[data-chat]').forEach(b => b.onclick = () => openChat(b.dataset.chat));
      $('#pnew') && ($('#pnew').onclick = async () => { if (await newPoll(null)) show('chats'); });
      wirePolls($('#content'), polls, draw);
    };
    draw();
  };

  // ---- one chat ----
  async function openChat(chat) {
    clearInterval(timer);
    state.chatOpen = chat;
    const list = await api('chats'), meta = list.chats.find(c => c.chat === chat), me = list.me.key;
    if (!meta) { state.chatOpen = null; return PAGES.chats(); }
    $('#content').innerHTML = `<div class="chat-top"><button type="button" class="btn secondary small" id="cback">All chats</button><h2>${esc(meta.title)}</h2><span class="muted">${meta.kind === 'demo' ? 'Demo chat' : 'Batch chat'}</span></div>
      <div id="cpins"></div><section class="card chat-box"><div class="chat-log" id="clog" aria-live="polite"></div>
      <form id="cform" class="chat-form"><textarea id="cin" rows="2" maxlength="2000" placeholder="Write a message" required></textarea>
      <div class="chat-tools">${staff() ? '<label class="check"><input type="checkbox" id="cpin"> Pin</label>' : ''}<button type="button" class="btn secondary small" id="cpoll">Poll</button><button class="btn">Send</button></div></form></section>`;
    const log = $('#clog'), polls = new Map(); let last = 0, msgs = [];
    const paint = () => {
      log.innerHTML = msgs.length ? msgs.map(m => `<div class="msg ${m.author_key === me ? 'mine' : ''} ${m.pinned ? 'pinned' : ''}" data-mid="${m.id}"><div class="msg-head"><b>${esc(m.author_name || '')}</b>${roleChip(m.author_role)}<small class="muted">${ago(m.created_at)}</small>${m.pinned ? '<span class="chip warn">Pinned</span>' : ''}</div>
        ${m.poll_id && polls.has(m.poll_id) ? pollCard(polls.get(m.poll_id)) : `<p>${esc(m.body).replace(/\n/g, '<br>')}</p>`}
        <div class="msg-acts">${staff() ? `<button type="button" class="link-btn" data-act="${m.pinned ? 'unpin' : 'pin'}">${m.pinned ? 'Unpin' : 'Pin'}</button>` : ''}${staff() || m.author_key === me ? '<button type="button" class="link-btn" data-act="delete">Delete</button>' : ''}</div></div>`).join('') : '<p class="muted center">No messages yet. Say hello.</p>';
      log.querySelectorAll('[data-act]').forEach(b => b.onclick = async () => { const id = b.closest('[data-mid]').dataset.mid; if (b.dataset.act === 'delete' && !confirm('Delete this message?')) return; await api(`chat-message/${id}/${b.dataset.act}`, { method: 'POST' }); openChat(chat); });
      wirePolls(log, polls, paint);
    };
    const pull = async () => {
      if (state.page !== 'chats' || state.chatOpen !== chat) return clearInterval(timer);
      if (document.visibilityState !== 'visible') return;
      const d = await api(`chat/${encodeURIComponent(chat)}?after=${last}`).catch(() => null); if (!d) return;
      d.polls.forEach(p => polls.set(p.id, p));
      if (d.pinned) $('#cpins').innerHTML = d.pinned.length ? `<section class="card pins"><b>Pinned</b>${d.pinned.map(p => `<p>${esc(p.body).replace(/\n/g, '<br>')}<small class="muted"> — ${esc(p.author_name)}</small></p>`).join('')}</section>` : '';
      if (!d.messages.length && last) return;
      const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
      msgs = msgs.concat(d.messages); last = msgs.length ? msgs[msgs.length - 1].id : last;
      try { const seen = JSON.parse(localStorage.getItem('mfu-chat-seen') || '{}'); seen[chat] = last; localStorage.setItem('mfu-chat-seen', JSON.stringify(seen)); } catch { /* private mode */ }
      paint(); if (atEnd || d.messages.some(m => m.author_key === me)) log.scrollTop = log.scrollHeight;
    };
    await pull(); log.scrollTop = log.scrollHeight;
    timer = setInterval(pull, POLL_MS);
    $('#cback').onclick = () => { state.chatOpen = null; show('chats'); };
    $('#cform').onsubmit = async e => {
      e.preventDefault(); const t = $('#cin').value.trim(); if (!t) return;
      try { await api(`chat/${encodeURIComponent(chat)}`, { method: 'POST', body: JSON.stringify({ body: t, pinned: $('#cpin')?.checked }) }); $('#cin').value = ''; if ($('#cpin')?.checked) return openChat(chat); pull(); } catch (err) { toast(err.message); }
    };
    $('#cin').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); $('#cform').requestSubmit(); } };
    $('#cpoll').onclick = async () => { if (await newPoll(chat)) pull(); };
  }
  window.mfuOpenChat = chat => { state.chatOpen = chat; state.chatJump = true; show('chats'); };
  document.addEventListener('click', e => { const b = e.target.closest('[data-open-chat]'); if (b) window.mfuOpenChat(b.dataset.openChat); });

  // ---- menu: Chats near the top for everyone ----
  titles.chats = 'Chats';
  const addAfter = (groups, key) => { for (const [, items] of groups) { const i = items.findIndex(([p]) => p === key); if (i >= 0 && !items.some(([p]) => p === 'chats')) { items.splice(i + 1, 0, ['chats', 'Chats']); return; } } };
  addAfter(NAV.admin, 'overview'); addAfter(NAV.coach, 'coach_home'); addAfter(NAV.parent, 'home');
  // Leaving the Chats page stops the polling; opening it from the menu shows the list.
  const _show = show;
  // eslint-disable-next-line no-global-assign
  show = async function (page) { clearInterval(timer); if (!state.chatJump) state.chatOpen = null; state.chatJump = false; return _show(page); };
})();
