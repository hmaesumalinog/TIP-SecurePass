import { assertPost, handleError, HttpError, json, normalizeEmail, otpDigest, randomOtp, readJson, sha256 } from './_shared/http.mjs';
import { insert, supabase, update } from './_shared/supabase.mjs';
import { adminVerificationEmail, sendEmail } from './_shared/resend.mjs';

const INVALID = 'The administrator email or password is incorrect.';

export default async function handler(request, context) {
  try {
    assertPost(request);
    const { email: rawEmail, password } = await readJson(request);
    const email = normalizeEmail(rawEmail);
    if (typeof password !== 'string' || password.length < 1 || password.length > 128) throw new HttpError(401, INVALID);
    const ip = context?.ip || request.headers.get('x-nf-client-connection-ip') || 'unknown';
    const emailHash = sha256(email);
    const ipHash = sha256(ip);
    const attemptId = await supabase('rpc/reserve_access_attempt', { method: 'POST', body: JSON.stringify({
      p_kind: 'admin', p_identifier: emailHash, p_ip: ipHash
    }) });
    if (!attemptId) {
      throw new HttpError(429, 'Too many administrator sign-in attempts. Wait 15 minutes and try again.');
    }

    const result = await supabase('rpc/authenticate_admin', {
      method: 'POST',
      body: JSON.stringify({ p_email: email, p_password: password })
    });
    const admin = Array.isArray(result) ? result[0] : result;
    if (!admin?.id) throw new HttpError(401, INVALID);
    await update('admin_login_attempts', { id: `eq.${attemptId}` }, { succeeded: true });
    const code = randomOtp();
    const challengeId = await supabase('rpc/reserve_admin_login_challenge', { method: 'POST', body: JSON.stringify({
      p_admin: admin.id, p_hash: otpDigest(`admin:${code}`)
    }) });
    if (!challengeId) throw new HttpError(429, 'Too many administrator verification codes were requested. Wait 15 minutes and try again.');
    const mail = adminVerificationEmail({
      displayName: admin.display_name,
      code
    });
    await sendEmail({
      to: admin.email,
      ...mail,
      idempotencyKey: `admin-login-${challengeId}`
    });
    await insert(
      'admin_audit_events',
      {
        admin_id: admin.id,
        event_type: 'admin_password_verified',
        details: {}
      },
      'id'
    );
    return json({
      challengeId,
      message: 'A verification code was sent to the administrator email.'
    });
  } catch (error) {
    return handleError(error);
  }
}
