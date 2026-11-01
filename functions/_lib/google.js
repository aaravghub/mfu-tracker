import { mailConfigured, googleAccessToken } from './mail.js';

// Google Calendar (with Meet links) and Google Sheets, using the same OAuth refresh token as Gmail.
// The token must be authorized with the calendar.events and drive.file scopes (see README → Google setup).
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/drive.file'
].join(' ');

const RECONNECT = 'Google needs permission for Calendar and Sheets. Sign in as admin and open /api/auth/google/start, then replace GMAIL_REFRESH_TOKEN with the new token.';

async function call(env, url, init = {}) {
  if (!mailConfigured(env)) throw new Error('Google is not connected yet. Add the Google secrets in Cloudflare Pages first (see the README).');
  const token = await googleAccessToken(env);
  const res = await fetch(url, { ...init, headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json', ...(init.headers || {}) } });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || 'Google returned HTTP ' + res.status;
    if (res.status === 403 && /insufficient|scope|permission/i.test(msg)) throw new Error(RECONNECT);
    throw new Error(msg);
  }
  return data;
}

const tz = env => env.TIME_ZONE || 'America/New_York';
const addHour = t => { const [h, m] = t.split(':').map(Number); return String(Math.min(h + 1, 23)).padStart(2, '0') + ':' + String(m).padStart(2, '0'); };

// Creates a calendar event with a Google Meet link. sendUpdates 'all' makes Google email the invite to every attendee.
export async function createMeetEvent(env, { title, description, date, start, end, attendees, meet = true, location, sendUpdates = 'all' }) {
  const startT = start || '18:00', endT = end || addHour(startT);
  const body = {
    summary: title,
    description: description || '',
    location: location || undefined,
    start: { dateTime: `${date}T${startT}:00`, timeZone: tz(env) },
    end: { dateTime: `${date}T${endT}:00`, timeZone: tz(env) },
    attendees: attendees.map(email => ({ email }))
  };
  if (meet) body.conferenceData = { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  const data = await call(env, `https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=${sendUpdates}`, { method: 'POST', body: JSON.stringify(body) });
  const meetUrl = data.hangoutLink || data.conferenceData?.entryPoints?.find(e => e.entryPointType === 'video')?.uri || null;
  return { id: data.id, url: data.htmlLink || null, meetUrl };
}

export async function deleteCalendarEvent(env, eventId) {
  try { await call(env, `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`, { method: 'DELETE' }); return true; }
  catch { return false; }
}

// Gives one person access to a file the app created. Google accounts get access quietly (they open it from MFU Tracker);
// an email that isn't a Google account needs Google's invitation email, so that is retried with the notification on.
export async function shareFile(env, fileId, email, role = 'reader') {
  const send = notify => call(env, `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?sendNotificationEmail=${notify}&supportsAllDrives=true`, { method: 'POST', body: JSON.stringify({ type: 'user', role, emailAddress: email }) });
  try { await send(false); return { ok: true }; }
  catch (e) {
    if (/Google needs permission/.test(e.message)) throw e;
    try { await send(true); return { ok: true, invited: true }; } catch (e2) { return { ok: false, error: e2.message }; }
  }
}

// Writes tabs of rows into a spreadsheet, creating it the first time. Returns { id, url }.
export async function writeSpreadsheet(env, { sheetId, title, tabs }) {
  const create = async () => {
    const d = await call(env, 'https://sheets.googleapis.com/v4/spreadsheets', { method: 'POST', body: JSON.stringify({ properties: { title }, sheets: tabs.map(t => ({ properties: { title: t.name, gridProperties: { frozenRowCount: 1 } } })) }) });
    return { id: d.spreadsheetId, url: d.spreadsheetUrl };
  };
  let sheet;
  if (sheetId) {
    try {
      // Add any tab the sheet doesn't have yet (e.g. a new "Evaluators" tab), so the same sheet and link keep working.
      const have = new Set(((await call(env, `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`)).sheets || []).map(x => x.properties.title));
      const missing = tabs.filter(t => !have.has(t.name));
      if (missing.length) await call(env, `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: missing.map(t => ({ addSheet: { properties: { title: t.name, gridProperties: { frozenRowCount: 1 } } } })) }) });
      await call(env, `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values:batchClear`, { method: 'POST', body: JSON.stringify({ ranges: tabs.map(t => `'${t.name}'`) }) });
      sheet = { id: sheetId, url: `https://docs.google.com/spreadsheets/d/${sheetId}/edit` };
    } catch (e) { if (/Google needs permission/.test(e.message)) throw e; sheet = await create(); }
  } else sheet = await create();
  await call(env, `https://sheets.googleapis.com/v4/spreadsheets/${sheet.id}/values:batchUpdate`, { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: tabs.map(t => ({ range: `'${t.name}'!A1`, values: t.rows })) }) });
  return sheet;
}
