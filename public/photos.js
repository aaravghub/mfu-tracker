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

  // Phones and tablets get a "Take photo" button that opens the camera straight away.
  const touch = matchMedia('(pointer: coarse)').matches;

  // Asks for a photo (the camera when `camera`), shrinks it and uploads it. Resolves to the new photo URL, or null if cancelled.
  window.mfuPickPhoto = (route, { camera = false } = {}) => new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/*';
    if (camera) input.capture = 'environment';
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
        (!route ? '' : touch ? '<div class="card-actions"><button type="button" class="btn small" data-cam="1">Take photo</button><button type="button" class="btn secondary small" data-cam="">Choose photo</button></div>'
          : `<button type="button" class="btn secondary small" data-cam="">${u ? 'Change photo' : 'Add photo'}</button>`);
      box.querySelectorAll('[data-cam]').forEach(b => b.addEventListener('click', async () => { const nu = await window.mfuPickPhoto(route, { camera: !!b.dataset.cam }).catch(() => null); if (nu) { paint(nu); onSaved?.(nu); } }));
    };
    paint(url);
    return box;
  };

  /* ---- videos: recorded small in the app (or picked), uploaded straight to the MFU Google Drive, never to R2 ---- */
  const VIDEO_TYPES = ['video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const sendToDrive = async (file, name) => {
    const { upload_url } = await api('video/start', { method: 'POST', body: JSON.stringify({ name, type: file.type.split(';')[0], size: file.size }) });
    toast('Uploading video…');
    const r = await fetch(upload_url, { method: 'PUT', headers: { 'content-type': file.type.split(';')[0] }, body: file });
    if (!r.ok) throw Error('Google Drive did not accept the video (HTTP ' + r.status + ').');
    const { url } = await api('video/finish', { method: 'POST', body: JSON.stringify({ file_id: (await r.json()).id }) });
    toast('Video saved'); return url;
  };
  // Resolves to the video's Drive link, or null if closed without saving.
  window.mfuRecordVideo = name => new Promise(resolve => {
    const rec = window.MediaRecorder && navigator.mediaDevices?.getUserMedia;
    const m = openModal('Record a video', `${rec ? '<video id="vlive" class="vid" muted playsinline autoplay></video><p class="muted" id="vinfo">Up to 3 minutes. Recorded small (about 7 MB a minute) so Drive stays free.</p><div class="card-actions"><button type="button" class="btn" id="vrec">Start recording</button></div>' : '<p class="muted">This browser cannot record here. Choose a video you already took.</p>'}
      <div class="card-actions section-gap-sm"><button type="button" class="btn secondary small" id="vpick">Choose a video instead</button></div>`, { wide: true });
    let stream = null, done = false;
    const finish = url => { if (done) return; done = true; stream?.getTracks().forEach(t => t.stop()); m.close(); resolve(url); };
    m.root.addEventListener('click', e => { if (e.target === m.root || e.target.closest('[data-close]')) { done = true; stream?.getTracks().forEach(t => t.stop()); resolve(null); } });
    const upload = async file => { try { finish(await sendToDrive(file, name)); } catch (e) { toast(e.message); } };
    m.$('#vpick').onclick = () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'video/*'; i.onchange = () => i.files[0] && upload(i.files[0]); i.click(); };
    if (!rec) return;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 854 }, height: { ideal: 480 }, frameRate: { ideal: 24 } }, audio: true })
      .then(s => { stream = s; m.$('#vlive').srcObject = s; })
      .catch(() => { m.$('#vinfo').textContent = 'Allow the camera and microphone for this site, or choose a video instead.'; m.$('#vrec').hidden = true; });
    let mr = null, chunks = [], t0 = 0, tick = 0;
    m.$('#vrec').onclick = () => {
      if (mr) return mr.stop();
      const mimeType = VIDEO_TYPES.find(t => MediaRecorder.isTypeSupported(t)) || '';
      mr = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 850000, audioBitsPerSecond: 64000 });
      chunks = []; mr.ondataavailable = e => e.data.size && chunks.push(e.data);
      mr.onstop = () => {
        clearInterval(tick);
        const blob = new Blob(chunks, { type: mr.mimeType || 'video/webm' });
        const file = new File([blob], name + (blob.type.includes('mp4') ? '.mp4' : '.webm'), { type: blob.type });
        stream.getTracks().forEach(t => t.stop());
        const v = m.$('#vlive'); v.srcObject = null; v.src = URL.createObjectURL(blob); v.muted = false; v.controls = true;
        m.$('#vinfo').textContent = `${Math.round(blob.size / 1e5) / 10} MB. Save it, or close to throw it away.`;
        m.$('#vrec').textContent = 'Save video'; m.$('#vrec').onclick = () => { m.$('#vrec').disabled = true; upload(file); };
      };
      mr.start(1000); t0 = Date.now(); m.$('#vrec').textContent = 'Stop';
      tick = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000); m.$('#vinfo').textContent = `Recording ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; if (s >= 180) mr.stop(); }, 500);
    };
  });

  /* ---- play a video inside the app. Drive videos are shared "anyone with the link", so no Google sign-in is needed. ---- */
  const embed = u => { const d = /drive\.google\.com\/file\/d\/([A-Za-z0-9_-]+)/.exec(u), y = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{6,})/.exec(u);
    return d ? `https://drive.google.com/file/d/${d[1]}/preview` : y ? `https://www.youtube-nocookie.com/embed/${y[1]}` : null; };
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-play]'); if (!b) return;
    e.preventDefault();
    const src = embed(b.dataset.play);
    if (!src) return window.open(b.dataset.play, '_blank', 'noopener');
    openModal('Video', `<div class="vid-frame"><iframe src="${esc(src)}" allow="autoplay; fullscreen" allowfullscreen title="Video"></iframe></div><p class="muted">Just uploaded? Google can take a few minutes to get a video ready.</p>`, { wide: true });
  });

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
    const vid = () => d.video ? `<button type="button" class="btn secondary small" data-play="${esc(safeUrl(d.video))}">Watch the video</button>` : '';
    const m = openModal(d.name, `${d.desc ? `<p>${esc(d.desc)}</p>` : ''}<div id="skphoto"></div><div class="card-actions section-gap-sm" id="skvid">${vid()}${staff ? `<button type="button" class="btn secondary small" id="skrec">${d.video ? 'Replace video' : 'Record a video'}</button>` : ''}</div>`);
    if (staff) m.$('#skrec').onclick = async () => {
      const url = await window.mfuRecordVideo(d.name); if (!url) return;
      try { await api('skills/' + encodeURIComponent(d.skillView), { method: 'PUT', body: JSON.stringify({ video_url: url }) }); d.video = url; const a = m.$('#skvid [data-play]'); if (a) a.dataset.play = url; else m.$('#skvid').insertAdjacentHTML('afterbegin', vid()); } catch (e) { toast(e.message); }
    };
    m.$('#skphoto').append(window.mfuPhotoBlock(d.img, { alt: d.name, route: staff ? 'photo?kind=skill&id=' + encodeURIComponent(d.skillView) : '', onSaved: u => { d.img = u; } }));
  });
})();
