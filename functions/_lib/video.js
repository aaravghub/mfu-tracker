import { json } from './util.js';
import { mailConfigured, googleAccessToken } from './mail.js';

// Videos go to the MFU Google account's Drive (free 15 GB, shared with Gmail), never to R2.
// The server opens an upload session; the browser sends the file straight to Google, so big files never pass through here.
// Uses the drive.file permission the app already has: it can only see files it created.

const MAX_BYTES = 200 * 1024 * 1024;
const KEEP_FREE = 500 * 1024 * 1024; // stop before Drive is full, so Gmail keeps working
const DRIVE = 'https://www.googleapis.com';

async function google(env, url, init = {}) {
  const res = await fetch(DRIVE + url, { ...init, headers: { authorization: 'Bearer ' + await googleAccessToken(env), 'content-type': 'application/json', ...(init.headers || {}) } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error?.message || 'Google Drive returned HTTP ' + res.status);
  return res;
}

export async function handleVideo(path, method, request, env, actor) {
  if (path !== 'video/start' && path !== 'video/finish') return null;
  if (method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!mailConfigured(env)) return json({ error: 'Videos need the Google connection (the same one used for email).' }, 503);
  const body = await request.json().catch(() => ({}));
  try {
    if (path === 'video/start') {
      const size = Number(body.size), type = String(body.type || '');
      if (!/^video\//.test(type) || !(size > 0)) return json({ error: 'That is not a video.' }, 400);
      if (size > MAX_BYTES) return json({ error: 'That video is over 200 MB. Record it in the app instead; those are small.' }, 413);
      const q = (await (await google(env, '/drive/v3/about?fields=storageQuota')).json()).storageQuota || {};
      if (q.limit && Number(q.limit) - Number(q.usage || 0) - size < KEEP_FREE) return json({ error: 'The MFU Google Drive is almost full. Delete old videos in Drive first.' }, 507);
      // Origin lets the browser upload to this session directly.
      const res = await google(env, '/upload/drive/v3/files?uploadType=resumable&fields=id', {
        method: 'POST',
        headers: { 'x-upload-content-type': type, 'x-upload-content-length': String(size), origin: new URL(request.url).origin },
        body: JSON.stringify({ name: String(body.name || 'MFU video').slice(0, 120), mimeType: type, description: 'Uploaded from MFU Tracker by ' + actor.name })
      });
      return json({ upload_url: res.headers.get('location') });
    }
    // finish: anyone with the link can watch (like a shared YouTube link); the link is only shown inside MFU Tracker.
    const id = String(body.file_id || '');
    if (!/^[A-Za-z0-9_-]{10,100}$/.test(id)) return json({ error: 'Unknown video.' }, 400);
    await google(env, `/drive/v3/files/${id}/permissions`, { method: 'POST', body: JSON.stringify({ type: 'anyone', role: 'reader' }) });
    return json({ url: `https://drive.google.com/file/d/${id}/preview` });
  } catch (e) { return json({ error: e.message }, 502); }
}
