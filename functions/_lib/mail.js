import { esc, isHttpUrl } from './util.js';

// Gmail API sender. Secrets required: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN.
// The authenticated Gmail account is automallakhamb@gmail.com.
export const mailConfigured = env => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN);

async function gmailAccessToken(env) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token'
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Could not refresh Gmail access.');
  return data.access_token;
}

const base64url = bytes => {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};
const enc = s => base64url(new TextEncoder().encode(s));
const headerSafe = s => String(s || '').replace(/[\r\n]/g, ' ').replace(/[^\x20-\x7E]/g, '?');

export async function sendMessages(env, messages) {
  let sent = 0, failed = 0, error = '';
  if (!mailConfigured(env)) return { sent: 0, failed: messages.length, error: 'Gmail is not configured. Add the Google OAuth secrets in Cloudflare Pages.' };
  let token;
  try { token = await gmailAccessToken(env); }
  catch (e) { return { sent: 0, failed: messages.length, error: String(e.message || 'Gmail authorization failed.') }; }
  for (const m of messages) {
    try {
      const boundary = 'mfu_' + crypto.randomUUID().replace(/-/g, '');
      const mime = [
        'From: MFU <automallakhamb@gmail.com>',
        'To: ' + m.to,
        'Subject: ' + headerSafe(m.subject),
        'MIME-Version: 1.0',
        'Content-Type: multipart/alternative; boundary="' + boundary + '"',
        '',
        '--' + boundary,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        enc(m.text || ''),
        '--' + boundary,
        'Content-Type: text/html; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        enc(m.html || ''),
        '--' + boundary + '--',
        ''
      ].join('\r\n');
      const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({ raw: enc(mime) })
      });
      if (res.ok) sent++;
      else {
        const data = await res.json().catch(() => ({}));
        failed++;
        if (!error) error = data.error?.message || 'Gmail API returned HTTP ' + res.status;
      }
    } catch (e) { failed++; if (!error) error = String(e.message || 'Could not send through Gmail.'); }
  }
  return { sent, failed, error };
}

export const siteUrl = (env, request) => {
  const fallback = new URL(request.url).origin;
  let raw = String(env.SITE_URL || fallback).trim();
  const markdown = /^\[[^\]]+\]\((https?:\/\/[^)]+)\)$/.exec(raw);
  if (markdown) raw = markdown[1];
  raw = raw.replace(/^<|>$/g, '');
  try { const parsed = new URL(raw); if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.origin; } catch {}
  return fallback;
};

const fmtDate = d => {
  const t = new Date(String(d) + 'T00:00:00Z');
  return isNaN(t) ? String(d) : t.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
};
const fmtTime = t => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || '');
  if (!m) return '';
  const h = +m[1];
  return `${((h + 11) % 12) + 1}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
};
const para = s => esc(s).split(/\n{2,}/).map(p => `<p style="margin:0 0 14px;line-height:1.55">${p.replace(/\n/g, '<br>')}</p>`).join('');
const button = (href, label, color = '#f26b21') =>
  isHttpUrl(href) ? `<a href="${esc(href)}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:8px;font-size:14px">${esc(label)}</a>` : '';
const section = t => `<h3 style="margin:26px 0 10px;font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#164e8a">${esc(t)}</h3>`;
const card = inner => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e5eaf1;border-radius:12px;margin:0 0 10px"><tr><td style="padding:14px 16px">${inner}</td></tr></table>`;

// Builds one email (html + plain text). `parts` = { message, events, links, shop, portalUrl }
export function renderEmail({ greetingName, message, events = [], links = [], shop = [], portalUrl }) {
  let html = '', text = '';
  const hello = greetingName ? `Hi ${greetingName},` : 'Hello,';
  html += `<p style="margin:0 0 14px">${esc(hello)}</p>`;
  text += hello + '\n\n';
  if (message) { html += para(message); text += message + '\n\n'; }

  if (events.length) {
    html += section('Dates to remember'); text += 'DATES TO REMEMBER\n';
    for (const e of events) {
      const when = [fmtDate(e.event_date), fmtTime(e.event_time)].filter(Boolean).join(' · ');
      html += card(
        `<div style="font-size:11px;font-weight:700;color:#f26b21;text-transform:uppercase;letter-spacing:.8px">${esc(e.event_type)}</div>` +
        `<div style="font-size:17px;font-weight:700;margin:3px 0">${esc(e.title)}</div>` +
        `<div style="color:#536075;font-size:14px">${esc(when)}${e.location ? '<br>' + esc(e.location) : ''}</div>` +
        (e.details ? `<div style="margin-top:8px;font-size:14px;line-height:1.5">${esc(e.details).replace(/\n/g, '<br>')}</div>` : '') +
        (isHttpUrl(e.signup_url) ? `<div style="margin-top:12px">${button(e.signup_url, 'Sign up')}</div>` : '')
      );
      text += `- ${e.title} (${e.event_type}) — ${when}${e.location ? ', ' + e.location : ''}\n` + (e.details ? `  ${e.details}\n` : '') + (isHttpUrl(e.signup_url) ? `  Sign up: ${e.signup_url}\n` : '');
    }
    text += '\n';
  }
  if (links.length) {
    html += section('Links & forms'); text += 'LINKS & FORMS\n';
    for (const l of links) {
      html += card(`<div style="font-weight:700;margin-bottom:${l.description ? 4 : 10}px">${esc(l.title)}</div>` + (l.description ? `<div style="color:#536075;font-size:14px;margin-bottom:10px">${esc(l.description)}</div>` : '') + button(l.url, 'Open', '#164e8a'));
      text += `- ${l.title}: ${l.url}\n`;
    }
    text += '\n';
  }
  if (shop.length) {
    html += section('Things to buy'); text += 'THINGS TO BUY\n';
    for (const s of shop) {
      html += card(`<div style="font-weight:700">${esc(s.title)}${s.price ? ` <span style="color:#536075;font-weight:600">· ${esc(s.price)}</span>` : ''}</div>` + (s.description ? `<div style="color:#536075;font-size:14px;margin:4px 0 0">${esc(s.description)}</div>` : '') + `<div style="margin-top:10px">${button(s.url, 'View item', '#164e8a')}</div>`);
      text += `- ${s.title}${s.price ? ' (' + s.price + ')' : ''}: ${s.url}\n`;
    }
    text += '\n';
  }
  if (portalUrl) {
    html += `<p style="margin:24px 0 0;font-size:14px">You can see your child's progress any time in the <a href="${esc(portalUrl)}">parent portal</a>.</p>`;
    text += `Parent portal: ${portalUrl}\n\n`;
  }
  return { html: wrap(html), text: text + '— Mallakhamb Federation USA' };
}

export const wrap = inner =>
  `<!doctype html><html><body style="margin:0;background:#f6f8fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#172337">` +
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto"><tr><td style="padding:24px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#f26b21;border-radius:14px 14px 0 0;padding:18px 24px;color:#fff;font-weight:800;font-size:18px"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle" style="padding-right:14px"><img src="https://mfu-tracker.pages.dev/mfu-logo.png" alt="Mallakhamb Federation USA logo" width="54" height="54" style="display:block;width:54px;height:54px;background:#fff;border-radius:8px;padding:3px"></td><td valign="middle" style="color:#fff;font-weight:800;font-size:18px">Mallakhamb Federation USA</td></tr></table></td></tr></table>` +
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#ffffff;border:1px solid #e5eaf1;border-top:0;border-radius:0 0 14px 14px;padding:24px;font-size:15px">${inner}</td></tr></table>` +
  `<p style="text-align:center;color:#8794a8;font-size:12px;margin-top:14px">You are receiving this because your child is enrolled with MFU.</p></td></tr></table></body></html>`;
