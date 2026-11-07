/* MFU photos: shrink in the browser (about 300 KB at most), upload to R2 through /api/photo, and show a photo only
   when someone opens the thing it belongs to. Loaded after extra.js (uses api, esc, toast, openModal, safeUrl). */
(() => {
  const TARGET = 300 * 1024;

  // Longest side 1280px, then lower quality and size until it fits. WebP where the browser can make it, else JPEG.
  async function shrink(file) {
    const img = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
    if (!img) throw Error('That file is not a photo this browser can read.');
    const webp = document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp');
    const type = webp ? 'image/webp' : 'image/jpeg';
    for (let side = 1280; side >= 480; side = Math.round(side * 0.8)) {
      const k = Math.min(1, side / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      for (const q of [0.82, 0.7, 0.58]) {
        const blob = await new Promise(r => c.toBlob(r, type, q));
        if (blob && blob.size <= TARGET) return blob;
      }
    }
    throw Error('Could not make that photo small enough. Try another one.');
  }

  // Asks for a photo (the camera on phones), shrinks it and uploads it. Resolves to the new photo URL, or null if cancelled.
  window.mfuPickPhoto = (route) => new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return resolve(null);
      try {
        toast('Uploading photo…');
        const blob = await shrink(file);
        const r = await fetch('/api/' + route, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': blob.type }, body: blob });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw Error(d.error || 'Upload failed');
        toast('Photo saved'); resolve(d.url);
      } catch (e) { toast(e.message); reject(e); }
    };
    input.click();
  });

  // One photo, loaded only now (lazy), with an optional upload button. Used inside pop-ups people open on purpose.
  window.mfuPhotoBlock = (url, { route = '', alt = '', onSaved } = {}) => {
    const box = document.createElement('div'); box.className = 'photo-block';
    const paint = u => {
      box.innerHTML = (u ? `<img src="${esc(safeUrl(u))}" alt="${esc(alt)}" loading="lazy" decoding="async">` : '<p class="muted">No photo yet.</p>') +
        (route ? `<button type="button" class="btn secondary small">${u ? 'Change photo' : 'Add photo'}</button>` : '');
      box.querySelector('button')?.addEventListener('click', async () => { const nu = await window.mfuPickPhoto(route).catch(() => null); if (nu) { paint(nu); onSaved?.(nu); } });
    };
    paint(url);
    return box;
  };

  /* ---- a student's photo, fetched only when their name is tapped (attendance and other lists) ---- */
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-photo-student]'); if (!b) return;
    e.preventDefault();
    const s = await api('students/' + encodeURIComponent(b.dataset.photoStudent)).catch(() => null); if (!s) return;
    const m = openModal(s.first_name + ' ' + (s.last_name || ''), '<div id="stphoto"></div>');
    m.$('#stphoto').append(window.mfuPhotoBlock(s.photo_url, { alt: s.first_name, route: 'photo?kind=student&id=' + encodeURIComponent(s.id) }));
  });

  /* ---- parent portal: tap the child's photo in the corner to add or change it ---- */
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-kid-photo]'); if (!a) return;
    const kid = state.home?.children?.find(k => k.id === a.dataset.kidPhoto); if (!kid) return;
    const m = openModal(kid.first_name + '’s photo', '<p class="muted">Take or choose a clear photo of your child. It is shrunk before upload and only MFU coaches and your family see it.</p><div id="kphoto"></div>');
    m.$('#kphoto').append(window.mfuPhotoBlock(kid.photo_url, { alt: kid.first_name, route: 'parent/photo?student_id=' + encodeURIComponent(kid.id), onSaved: u => { kid.photo_url = u; a.querySelector('img')?.remove(); a.insertAdjacentHTML('afterbegin', `<img src="${esc(u)}" alt="">`); } }));
  });
  document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-kid-photo],[data-photo-student]')) { e.preventDefault(); e.target.click(); } });

  /* ---- skills: the name opens the skill; its photo loads only then ---- */
  window.mfuSkillLink = sk => `<button type="button" class="link-btn" data-skill-view="${esc(sk.skill_id || sk.id)}" data-name="${esc(sk.name)}" data-img="${esc(sk.image_url || '')}" data-video="${esc(sk.video_url || '')}" data-desc="${esc(sk.description || '')}">${esc(sk.name)}</button>`;
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-skill-view]'); if (!b) return;
    e.preventDefault();
    const d = b.dataset, staff = state.role === 'admin' || state.role === 'coach';
    const m = openModal(d.name, `${d.desc ? `<p>${esc(d.desc)}</p>` : ''}<div id="skphoto"></div>${d.video ? `<p class="section-gap-sm"><a class="btn secondary small" href="${esc(safeUrl(d.video))}" target="_blank" rel="noopener noreferrer">Watch the video</a></p>` : ''}`);
    m.$('#skphoto').append(window.mfuPhotoBlock(d.img, { alt: d.name, route: staff ? 'photo?kind=skill&id=' + encodeURIComponent(d.skillView) : '', onSaved: u => { d.img = u; } }));
  });
})();
