import { assertPost, handleError, HttpError, json, otpDigest, readJson } from '../_shared/http.mjs';
import { rpc } from '../_shared/supabase.mjs';
import { adminCookie, createAdminSession } from '../_shared/admin-session.mjs';

export default async function adminLoginVerify(request) {
  try {
    assertPost(request);
    const { challengeId, code } = await readJson(request);
    if (typeof challengeId !== 'string' || !/^[0-9a-f-]{36}$/i.test(challengeId) || !/^\d{6}$/.test(String(code || ''))) throw new HttpError(400, 'Enter the six-digit verification code.');
    const result = await rpc('admin_sign_in_verify', { p_challenge: challengeId, p_otp_hash: otpDigest(`admin:${code}`) });
    if (!result || result.status === 'invalid') throw new HttpError(410, 'This administrator verification code has expired.');
    if (result.status === 'forbidden') throw new HttpError(403, 'Administrator access is not permitted.');
    if (result.status !== 'verified') throw new HttpError(401, result.remaining > 0 ? `That verification code is incorrect. ${result.remaining} attempts remain.` : 'Too many incorrect codes. Start the sign-in again.');
    const session = createAdminSession(result.admin);
    return json({ message: 'Administrator signed in.', csrfToken: session.csrf }, 200, { 'Set-Cookie': adminCookie(session.token) });
  } catch (error) {
    return handleError(error);
  }
}
