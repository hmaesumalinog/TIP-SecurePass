import { assertPost, clientIp, handleError, HttpError, json, normalizeEmail, otpDigest, randomOtp, readJson, sha256 } from '../_shared/http.mjs';
import { rpc } from '../_shared/supabase.mjs';
import { adminVerificationEmail, sendEmail } from '../_shared/resend.mjs';

const INVALID = 'The administrator email or password is incorrect.';

export default async function adminLoginStart(request, context) {
  try {
    assertPost(request);
    const { email: rawEmail, password } = await readJson(request);
    const email = normalizeEmail(rawEmail);
    if (typeof password !== 'string' || password.length < 1 || password.length > 128) throw new HttpError(401, INVALID);
    const emailHash = sha256(email);
    const attemptId = await rpc('reserve_access_attempt', {
      p_kind: 'admin', p_identifier: emailHash, p_ip: sha256(clientIp(request, context))
    });
    if (!attemptId) throw new HttpError(429, 'Too many administrator sign-in attempts. Wait 15 minutes and try again.');

    // Password check (constant time for unknown emails), attempt update,
    // verification challenge and audit event happen in one round trip.
    const code = randomOtp();
    const result = await rpc('admin_sign_in_finish', {
      p_attempt: attemptId, p_email: email, p_password: password, p_email_hash: emailHash, p_otp_hash: otpDigest(`admin:${code}`)
    });
    if (result?.status === 'challenge_limited') throw new HttpError(429, 'Too many administrator verification codes were requested. Wait 15 minutes and try again.');
    if (result?.status !== 'ok') throw new HttpError(401, INVALID);
    await sendEmail({
      to: result.admin.email,
      ...adminVerificationEmail({ displayName: result.admin.display_name, code }),
      idempotencyKey: `admin-login-${result.challenge_id}`
    });
    return json({ challengeId: result.challenge_id, message: 'A verification code was sent to the administrator email.' });
  } catch (error) {
    return handleError(error);
  }
}
