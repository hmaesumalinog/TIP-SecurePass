import { assertPost, expiresIn, handleError, HttpError, json, normalizeEmail, otpDigest, randomOtp, readJson, sha256 } from './_shared/http.mjs';
import { insert, query, supabase } from './_shared/supabase.mjs';
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
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const recent = await supabase(`admin_login_attempts?${query({ select: 'email_hash,ip_hash,succeeded', created_at: `gte.${since}`, or: `(email_hash.eq.${emailHash},ip_hash.eq.${ipHash})` })}`);
    if (recent.filter((item) => !item.succeeded && item.email_hash === emailHash).length >= 5 || recent.filter((item) => !item.succeeded && item.ip_hash === ipHash).length >= 12) {
      throw new HttpError(429, 'Too many administrator sign-in attempts. Wait 15 minutes and try again.');
    }

    const result = await supabase('rpc/authenticate_admin', {
      method: 'POST',
      body: JSON.stringify({ p_email: email, p_password: password })
    });
    const admin = Array.isArray(result) ? result[0] : result;
    await insert('admin_login_attempts', { email_hash: emailHash, ip_hash: ipHash, succeeded: Boolean(admin?.id) }, 'id');
    if (!admin?.id) throw new HttpError(401, INVALID);

    const recentCodes = await supabase(`admin_login_challenges?${query({ select: 'id', admin_id: `eq.${admin.id}`, created_at: `gte.${since}` })}`);
    if (recentCodes.length >= 3) throw new HttpError(429, 'Too many administrator verification codes were requested. Wait 15 minutes and try again.');

    const code = randomOtp();
    const challenges = await insert(
      'admin_login_challenges',
      {
        admin_id: admin.id,
        otp_hash: otpDigest(`admin:${code}`),
        expires_at: expiresIn(5 * 60)
      },
      'id'
    );
    const mail = adminVerificationEmail({
      displayName: admin.display_name,
      code
    });
    await sendEmail({
      to: admin.email,
      ...mail,
      idempotencyKey: `admin-login-${challenges[0].id}`
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
      challengeId: challenges[0].id,
      message: 'A verification code was sent to the administrator email.'
    });
  } catch (error) {
    return handleError(error);
  }
}
