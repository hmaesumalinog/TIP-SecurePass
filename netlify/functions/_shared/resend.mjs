import { transactionalEmail } from './email-template.mjs';

export async function sendEmail({ to, subject, html, text, idempotencyKey }) {
  const apiKey = process.env.RESEND_API_KEY;
  // The sending domain identifies the academic project, not the school.
  const from = process.env.RESEND_FROM || 'TIP SecurePass <portal@auth.resetworkflow.site>';
  if (!apiKey) {
    if (process.env.DEMO_MODE === 'true') return { skipped: true };
    throw new Error('RESEND_API_KEY is not configured.');
  }
  if (!subject || !html || !text) throw new Error('A complete email template is required.');
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ from, to: [to], subject, html, text })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Resend email delivery failed.');
  return data;
}

export function resetEmail({ firstName, resetLink, expiresMinutes = 15 }) {
  return transactionalEmail({
    kind: 'password-reset', subject: 'requested password reset', firstName,
    category: 'Account recovery', title: 'Let’s get you back in',
    preview: `Your password reset link is ready. It expires in ${expiresMinutes} minutes.`,
    paragraphs: ['We received a request to reset your student account password. Opening this link does not change your password by itself.'],
    callout: { title: `Use this link within ${expiresMinutes} minutes`, text: 'Keep your registered phone nearby. You will need its six-digit text message code next.' },
    action: { label: 'Continue password reset', url: resetLink },
    steps: ['Open the reset link on a device you trust.', 'Enter the six-digit code sent to your registered phone.', 'Choose a new password, then sign in again.'],
    safety: 'Didn’t request this? You can ignore this email. Do not forward it or share the reset link or verification code.'
  });
}

export function recoveryOptionsEmail({ firstName, origin, invited }) {
  const base = origin.replace(/\/$/, '');
  return transactionalEmail({
    kind: invited ? 'invitation-help' : 'recovery-options', subject: 'your account recovery options', firstName,
    category: 'Account recovery', title: invited ? 'Let’s finish your account setup' : 'Another way to recover your account',
    preview: invited ? 'Use your latest invitation to finish first-time setup.' : 'Use your saved backup code and authenticator to continue.',
    paragraphs: [invited
      ? 'Your account is waiting for first-time setup. Find your latest invitation email and use its student number and temporary password.'
      : 'Your account does not have a verified recovery phone. You can recover without email using one unused backup code and the authenticator app you connected earlier.'],
    callout: { title: invited ? 'Invitation expired or missing?' : 'What you’ll need', text: invited
      ? 'Ask the project administrator to issue a new temporary password. This message does not include a new one.'
      : 'Your seven-digit student number, one saved backup code, and the current six-digit code from your authenticator app.' },
    action: { label: invited ? 'Go to student sign in' : 'View recovery options', url: invited ? `${base}/` : `${base}/recover.html` },
    secondary: { label: 'Missing a recovery method? Request administrator help', url: `${base}/recovery-help.html` },
    safety: 'This email does not change your password or grant account access. If you did not request recovery, you can ignore it.'
  });
}

export function resetConfirmationEmail({ firstName }) {
  return transactionalEmail({
    kind: 'password-changed', subject: 'password changed', firstName,
    category: 'Security notice', title: 'Your password has been changed',
    preview: 'Your password reset is complete. Review this notice if it wasn’t you.',
    paragraphs: ['Your account password was changed after ownership verification. You can now sign in with your student number and new password.'],
    callout: { title: 'Previous access has been closed', text: 'Previous sessions and outstanding reset authorizations are now invalid.' },
    safety: 'If you did not make this change, contact the demonstration administrator immediately. No password or recovery code is included in this notice.'
  });
}

export function studentWelcomeEmail({ firstName, studentNumber, temporaryPassword, signInLink, expiresHours = 24 }) {
  return transactionalEmail({
    kind: 'student-invitation', subject: 'your demo account is ready', firstName,
    category: 'Welcome to your student account', title: 'Your account is ready to set up',
    preview: 'Your student sign-in details and first-time setup steps.',
    paragraphs: ['An administrator created an account for you. Use these temporary credentials for first-time setup.'],
    credentials: [{ label: 'Student number', value: studentNumber }, { label: 'Temporary password', value: temporaryPassword }],
    callout: { title: `Temporary password expires in ${expiresHours} hours`, text: 'It works only for first-time setup. You will replace it with your own password.' },
    action: { label: 'Set up my student account', url: signInLink },
    steps: ['Sign in, review the terms and privacy notice, and create your own password.', 'Connect your authenticator app and save your backup codes.', 'You can then add and verify your own optional mobile number.'],
    safety: 'Do not forward this email or share the temporary password. If you were not expecting this account, contact the demonstration administrator.'
  });
}

export function firstLoginConfirmationEmail({ firstName }) {
  return transactionalEmail({
    kind: 'password-setup', subject: 'password setup complete', firstName,
    category: 'Security notice', title: 'Your own password is now set',
    preview: 'Password setup is complete. Your temporary password no longer works.',
    paragraphs: ['Your permanent password has been created successfully. Continue the on-screen setup to connect your authenticator and save your backup codes if you haven’t done so yet.'],
    callout: { title: 'Your temporary password is now invalid', text: 'It cannot be used again. Keep your new password private.' },
    safety: 'If you did not complete this setup, contact the demonstration administrator immediately.'
  });
}

export function adminVerificationEmail({ displayName, code, expiresMinutes = 5 }) {
  return transactionalEmail({
    kind: 'admin-verification', subject: 'administrator sign-in code', firstName: displayName || 'Administrator',
    category: 'Administrator verification', title: 'Confirm your sign-in',
    preview: 'Use your one-time code on the administrator sign-in screen.',
    paragraphs: ['Enter this one-time code on the administrator sign-in screen you already opened.'],
    credentials: [{ label: 'Verification code', value: code }],
    callout: { title: `Expires in ${expiresMinutes} minutes`, text: 'This code works once. It is not a student password-reset code.' },
    safety: 'If you did not attempt to sign in, do not use or share this code. Contact the project administrator if these notices keep arriving.'
  });
}

const securityEvents = {
  confirm: ['Authenticator connected', 'An authenticator app was connected to your account for recovery.'],
  codes: ['New backup codes created', 'A new set of backup recovery codes was created. The previous set is no longer valid. Keep the new codes somewhere private.'],
  disable: ['Authenticator recovery removed', 'Your authenticator recovery method was removed. Review Security & recovery after signing in to check which methods are still available.'],
  phone_confirm: ['Recovery phone verified', 'A mobile number was verified for account recovery. Review Security & recovery after signing in if you need to check your registered phone.'],
  'password reset': ['Your password has been changed', 'Your password was changed using an enrolled recovery method and a backup code. Previous sessions and outstanding reset authorizations are now invalid.']
};
export function securityNoticeEmail({ event }) {
  const [title, description] = securityEvents[event] || ['Your account security settings changed', 'A security setting was changed on your account. Review Security & recovery after signing in.'];
  return transactionalEmail({
    kind: 'account-security', subject: 'account security notice', category: 'Security notice', title,
    preview: 'A security change was completed. Please review this notice.',
    paragraphs: [description],
    callout: { title: 'Was this you?', text: 'If you recognize this change, no action is needed for this notice.' },
    safety: 'If this was not you, contact the demonstration administrator immediately. No passwords, authenticator secrets, phone numbers, or recovery codes are included in this notice.'
  });
}
