import { esc, isHttpUrl } from './util.js';

// Email is sent through Resend's HTTP API (no SDK). Needs secrets RESEND_API_KEY and MAIL_FROM.
export const mailConfigured = env => !!(env.RESEND_API_KEY && env.MAIL_FROM);

export async function sendMessages(env, messages) {
  let sent = 0, failed = 0, error = '';
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    if (i > 0) await new Promise(r => setTimeout(r, 600)); // stay under provider rate limits
    try {
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
        body: JSON.stringify(chunk.map(m => ({
          from: env.MAIL_FROM, to: [m.to], subject: m.subject, html: m.html, text: m.text,
          ...(env.MAIL_REPLY_TO ? { reply_to: env.MAIL_REPLY_TO } : {})
        })))
      });
      if (res.ok) sent += chunk.length;
      else { failed += chunk.length; if (!error) error = ((await res.json().catch(() => ({}))).message) || ('Email provider returned ' + res.status); }
    } catch (e) { failed += chunk.length; if (!error) error = 'Could not reach the email provider.'; }
  }
  return { sent, failed, error };
}

export const siteUrl = (env, request) => (env.SITE_URL || new URL(request.url).origin).replace(/\/+$/, '');

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
const card = inner => `<div style="border:1px solid #e5eaf1;border-radius:12px;padding:14px 16px;margin:0 0 10px">${inner}</div>`;

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
    html += `<p style="margin:24px 0 0;font-size:14px">You can see your child's progress any time in the <a href="${esc(portalUrl)}" style="color:#164e8a">parent portal</a>.</p>`;
    text += `Parent portal: ${portalUrl}\n\n`;
  }
  return { html: wrap(html), text: text + '— Mallakhamb Federation USA' };
}

export const wrap = inner =>
  `<!doctype html><html><body style="margin:0;background:#f6f8fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#172337">` +
  `<div style="max-width:600px;margin:0 auto;padding:24px 16px"><div style="background:#f26b21;border-radius:14px 14px 0 0;padding:18px 24px;color:#fff;font-weight:800;font-size:18px">Mallakhamb Federation USA</div>` +
  `<div style="background:#ffffff;border:1px solid #e5eaf1;border-top:0;border-radius:0 0 14px 14px;padding:24px;font-size:15px">${inner}</div>` +
  `<p style="text-align:center;color:#8794a8;font-size:12px;margin-top:14px">You are receiving this because your child is enrolled with MFU.</p></div></body></html>`;
