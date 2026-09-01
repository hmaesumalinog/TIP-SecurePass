function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

export async function sendEmail({ to, subject, html, text, idempotencyKey }) {
  const apiKey = process.env.RESEND_API_KEY;
  // Keep the visible identity aligned with the domain that actually sends the
  // message. The site is an academic demonstration, not an official school
  // mail system, so the sender must not imply otherwise.
  const from = process.env.RESEND_FROM || 'TIP SecurePass <portal@auth.resetworkflow.site>';
  if (!apiKey) {
    if (process.env.DEMO_MODE === 'true') return { skipped: true };
    throw new Error('RESEND_API_KEY is not configured.');
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify({ from, to: [to], subject, html, text })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Resend email delivery failed.');
  return data;
}

export function resetEmail({ firstName, resetLink, expiresMinutes = 15 }) {
  const name = escapeHtml(firstName || 'Student');
  const link = escapeHtml(resetLink);
  return {
    subject: 'Reset Workflow: requested password reset',
    text: `Hello ${firstName || 'Student'},\n\nYou requested a password reset for the Reset Workflow academic demonstration at resetworkflow.site. This is not the official TIP student portal.\n\nOpen this single-use link to continue: ${resetLink}\n\nThe link expires in ${expiresMinutes} minutes. You will also need the code sent to your registered phone. If you did not request this, ignore this email.`,
    html: `<!doctype html><html><body style="margin:0;background:#f2f4f5;font-family:Arial,sans-serif;color:#1e252c"><div style="max-width:560px;margin:32px auto;background:#fff;border-top:6px solid #f5c400;padding:36px;border-radius:8px"><p style="font-size:12px;font-weight:bold;letter-spacing:.1em;text-transform:uppercase;color:#786000">Reset Workflow · Academic demonstration</p><h1 style="font-size:26px;margin:18px 0">Continue your password reset</h1><p>Hello ${name},</p><p>You requested a password reset for the demonstration at <strong>resetworkflow.site</strong>. This is not the official TIP student portal.</p><p>The link is single-use, expires in ${expiresMinutes} minutes, and does not change your password by itself.</p><p style="margin:28px 0"><a href="${link}" style="display:inline-block;background:#f5c400;color:#1e252c;text-decoration:none;font-weight:bold;padding:14px 20px;border-radius:7px">Continue at resetworkflow.site</a></p><p>You will still need the verification code sent to your registered phone.</p><hr style="border:0;border-top:1px solid #dce1e4;margin:28px 0"><p style="font-size:13px;color:#59656d">If you did not request this, no action is needed. Do not forward this email or share the link.</p></div></body></html>`
  };
}

export function resetConfirmationEmail({ firstName }) {
  const name = escapeHtml(firstName || 'Student');
  return {
    subject: 'Reset Workflow: password changed',
    text: `Hello ${firstName || 'Student'},\n\nYour password for the Reset Workflow academic demonstration at resetworkflow.site was changed. This is not the official TIP student portal. If this was not you, contact the demonstration administrator immediately.`,
    html: `<!doctype html><html><body style="margin:0;background:#f2f4f5;font-family:Arial,sans-serif;color:#1e252c"><div style="max-width:560px;margin:32px auto;background:#fff;border-top:6px solid #178450;padding:36px;border-radius:8px"><p style="font-size:12px;font-weight:bold;letter-spacing:.1em;text-transform:uppercase;color:#356147">Reset Workflow · Security notice</p><h1 style="font-size:26px;margin:18px 0">Password changed</h1><p>Hello ${name},</p><p>Your password for the academic demonstration at <strong>resetworkflow.site</strong> was changed after email-link and phone-code verification. This is not the official TIP student portal.</p><div style="background:#f0faf4;border:1px solid #b9dfca;padding:14px;border-radius:7px;margin:24px 0"><strong>The reset link and phone code are now invalid.</strong></div><p>If you did not make this change, contact the demonstration administrator immediately.</p></div></body></html>`
  };
}

export function studentWelcomeEmail({ firstName, studentNumber, temporaryPassword, signInLink, expiresHours = 24 }) {
  const name = escapeHtml(firstName || 'Student');
  const safeNumber = escapeHtml(studentNumber);
  const safePassword = escapeHtml(temporaryPassword);
  const safeLink = escapeHtml(signInLink);
  return {
    subject: 'Your Reset Workflow demo account is ready',
    text: `Hello ${firstName || 'Student'},\n\nAn administrator created an account for you in the Reset Workflow academic demonstration at resetworkflow.site. This is not the official TIP student portal.\n\nStudent number: ${studentNumber}\nTemporary password: ${temporaryPassword}\n\nSign in at ${signInLink}\n\nThe temporary password expires in ${expiresHours} hours and works only for first-time setup. After signing in, you must create a permanent password before opening the demonstration portal. Do not share this email or password.`,
    html: `<!doctype html><html><body style="margin:0;background:#f2f4f5;font-family:Arial,sans-serif;color:#1e252c"><div style="max-width:560px;margin:32px auto;background:#fff;border-top:6px solid #f5c400;padding:36px;border-radius:8px"><p style="font-size:12px;font-weight:bold;letter-spacing:.1em;text-transform:uppercase;color:#786000">Reset Workflow · Academic demonstration</p><h1 style="font-size:26px;margin:18px 0">Your demo account is ready</h1><p>Hello ${name},</p><p>An administrator created an account for you in the demonstration at <strong>resetworkflow.site</strong>. This is not the official TIP student portal.</p><p>Use these one-time credentials to sign in:</p><div style="margin:24px 0;padding:18px;background:#fff8d8;border:1px solid #ead474;border-radius:8px"><p style="margin:0 0 10px"><strong>Student number</strong><br><span style="font-size:20px">${safeNumber}</span></p><p style="margin:0"><strong>Temporary password</strong><br><code style="display:inline-block;margin-top:5px;font-size:20px;font-weight:bold;letter-spacing:.04em;color:#1e252c">${safePassword}</code></p></div><p style="margin:28px 0"><a href="${safeLink}" style="display:inline-block;background:#f5c400;color:#1e252c;text-decoration:none;font-weight:bold;padding:14px 20px;border-radius:7px">Sign in at resetworkflow.site</a></p><p>The temporary password expires in ${expiresHours} hours. You will be required to create a permanent password before the demonstration portal opens.</p><hr style="border:0;border-top:1px solid #dce1e4;margin:28px 0"><p style="font-size:13px;color:#59656d">Do not forward this email or share the temporary password. If you were not expecting this account, contact the demonstration administrator.</p></div></body></html>`
  };
}

export function firstLoginConfirmationEmail({ firstName }) {
  const name = escapeHtml(firstName || 'Student');
  return {
    subject: 'Reset Workflow: password setup complete',
    text: `Hello ${firstName || 'Student'},\n\nYour permanent password for the Reset Workflow academic demonstration at resetworkflow.site has been created, and the temporary password is no longer valid. This is not the official TIP student portal. If this was not you, contact the demonstration administrator immediately.`,
    html: `<!doctype html><html><body style="margin:0;background:#f2f4f5;font-family:Arial,sans-serif;color:#1e252c"><div style="max-width:560px;margin:32px auto;background:#fff;border-top:6px solid #178450;padding:36px;border-radius:8px"><p style="font-size:12px;font-weight:bold;letter-spacing:.1em;text-transform:uppercase;color:#356147">Reset Workflow · Security notice</p><h1 style="font-size:26px;margin:18px 0">Password setup complete</h1><p>Hello ${name},</p><p>Your permanent password for the academic demonstration at <strong>resetworkflow.site</strong> has been created successfully. This is not the official TIP student portal.</p><div style="background:#f0faf4;border:1px solid #b9dfca;padding:14px;border-radius:7px;margin:24px 0"><strong>The temporary password is now invalid and cannot be reused.</strong></div><p>If you did not complete this setup, contact the demonstration administrator immediately.</p></div></body></html>`
  };
}

export function adminVerificationEmail({ displayName, code, expiresMinutes = 5 }) {
  const name = escapeHtml(displayName || 'Administrator');
  const safeCode = escapeHtml(code);
  return {
    subject: 'Reset Workflow administrator sign-in code',
    text: `Hello ${displayName || 'Administrator'},\n\nYour administrator verification code for the Reset Workflow academic demonstration at resetworkflow.site is ${code}. It expires in ${expiresMinutes} minutes and can be used once. If you did not attempt to sign in, do not share this code.`,
    html: `<!doctype html><html><body style="margin:0;background:#f2f4f5;font-family:Arial,sans-serif;color:#1e252c"><div style="max-width:540px;margin:32px auto;background:#fff;border-top:6px solid #f5c400;padding:36px;border-radius:8px"><p style="font-size:12px;font-weight:bold;letter-spacing:.1em;text-transform:uppercase;color:#786000">Reset Workflow · Administrator verification</p><h1 style="font-size:25px;margin:18px 0">Confirm your sign-in</h1><p>Hello ${name},</p><p>Enter this one-time code in the administrator sign-in screen for <strong>resetworkflow.site</strong>:</p><div style="margin:26px 0;padding:18px;background:#fff7ce;border:1px solid #ead474;border-radius:8px;text-align:center;font-size:30px;font-weight:bold;letter-spacing:.24em">${safeCode}</div><p>The code expires in ${expiresMinutes} minutes and works once. If you did not attempt to sign in, do not share it.</p></div></body></html>`
  };
}
