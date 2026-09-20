// A self-contained layout for every transactional email. Inline styles and
// presentation tables also work in clients that strip external stylesheets.
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
}
function safeLink(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Email links must use HTTPS without embedded credentials.');
  return escapeHtml(value);
}
export function transactionalEmail({ kind, subject, category, title, preview, firstName = 'Student', paragraphs = [], steps = [], credentials = [], callout, action, secondary, safety }) {
  const name = String(process.env.EMAIL_APP_NAME || 'Reset Workflow').trim() || 'Reset Workflow';
  let host = 'resetworkflow.site';
  try { host = new URL(process.env.SITE_URL || 'https://resetworkflow.site').host; } catch { /* Safe display fallback. */ }
  const identity = `${name} · Academic demonstration at ${host}. This is not the official TIP student portal.`;
  const e = escapeHtml;
  const button = action ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0;width:100%"><tr><td style="background:#f5c400;border-radius:10px;text-align:center"><a href="${safeLink(action.url)}" style="display:block;padding:16px 20px;color:#202930;font-size:16px;font-weight:bold;text-decoration:none;border:1px solid #d7aa00;border-radius:10px">${e(action.label)}</a></td></tr></table><p style="font-size:12px;color:#62717b;line-height:1.6;overflow-wrap:anywhere">Button not opening? Copy the complete link into your browser:<br><a href="${safeLink(action.url)}" style="color:#6d5708;word-break:break-all">${e(action.url)}</a></p>` : '';
  const text = [identity, `Hello ${firstName || 'Student'},`, title, ...paragraphs,
    ...credentials.map(item => `${item.label}: ${item.value}`),
    callout ? `${callout.title}\n${callout.text}` : '', action ? `${action.label}: ${action.url}` : '',
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    secondary ? `${secondary.label}: ${secondary.url}` : '', safety,
    `Only enter passwords and verification codes on ${host}. The project team will not ask you to send them by email.`
  ].filter(Boolean).join('\n\n');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${e(title)}</title></head>
<body style="margin:0;padding:0;background:#f3f5f6;color:#202930;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;color:#f3f5f6">${e(preview)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f3f5f6"><tr><td align="center" style="padding:24px 12px">
<table data-email-template="${e(kind)}" role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:580px;background:#ffffff;border:1px solid #dce3e7;border-top:5px solid #f5c400;border-radius:16px">
<tr><td style="padding:28px 24px 18px;border-bottom:1px solid #e8edef"><p style="margin:0;font-size:18px;font-weight:bold;letter-spacing:-.4px">${e(name)}</p><p style="margin:6px 0 0;color:#62717b;font-size:12px">${e(host)} · Student account services</p></td></tr>
<tr><td style="padding:28px 24px;font-size:15px;line-height:1.65;word-break:normal;overflow-wrap:anywhere">
<p style="margin:0 0 12px;color:#786000;font-size:11px;font-weight:bold;letter-spacing:1.1px;text-transform:uppercase">${e(category)}</p>
<h1 style="margin:0 0 22px;font-size:27px;line-height:1.2;letter-spacing:-.7px">${e(title)}</h1><p>Hello ${e(firstName || 'Student')},</p>
${paragraphs.map(p => `<p style="margin:14px 0">${e(p)}</p>`).join('')}
${credentials.length ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#fff9df;border:1px solid #eddf9d;border-radius:10px;margin:22px 0">${credentials.map(item => `<tr><td style="padding:14px 18px"><span style="font-size:12px;color:#655623">${e(item.label)}</span><br><code style="font-family:Consolas,monospace;font-size:21px;font-weight:bold;word-break:break-all">${e(item.value)}</code></td></tr>`).join('')}</table>` : ''}
${callout ? `<div style="padding:16px 18px;background:#f4f7f6;border:1px solid #dce7e2;border-radius:10px;margin:22px 0"><strong style="display:block;margin-bottom:5px;font-size:14px">${e(callout.title)}</strong><span style="font-size:14px;color:#4c5e58">${e(callout.text)}</span></div>` : ''}
${button}
${steps.length ? `<h2 style="font-size:15px;margin:24px 0 12px">What happens next</h2><ol style="padding-left:22px;margin:0">${steps.map(step => `<li style="padding:0 0 10px 4px">${e(step)}</li>`).join('')}</ol>` : ''}
${secondary ? `<p style="margin-top:24px"><a href="${safeLink(secondary.url)}" style="color:#6d5708;font-weight:bold">${e(secondary.label)}</a></p>` : ''}
</td></tr><tr><td style="padding:22px 24px;background:#fafbfb;border-top:1px solid #e8edef;font-size:12px;line-height:1.65;color:#596971"><strong style="color:#34434d">Keep your account private</strong><p style="margin:8px 0">${e(safety)}</p><p style="margin:8px 0 0">Only enter passwords and verification codes on ${e(host)}. The project team will not ask you to send them by email.</p></td></tr>
</table><p style="max-width:520px;margin:18px 8px 0;font-size:11px;line-height:1.6;color:#738089">${e(identity)}</p>
</td></tr></table></body></html>`;
  return { subject: `${name}: ${subject}`, text, html };
}
