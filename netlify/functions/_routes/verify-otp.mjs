import { assertPost, handleError, HttpError, json, otpDigest, randomToken, readJson, sha256 } from '../_shared/http.mjs';
import { rpc } from '../_shared/supabase.mjs';

export default async function verifyOtp(request) {
  try {
    assertPost(request);
    const { challengeId, code } = await readJson(request);
    if (!/^[0-9a-f-]{36}$/i.test(String(challengeId)) || !/^\d{6}$/.test(String(code))) throw new HttpError(400, 'Enter the 6-digit verification code.');

    // Counting the attempt, checking the code, issuing the single-use reset
    // grant and recording the audit event happen in one database transaction.
    const grantToken = randomToken();
    const result = await rpc('verify_reset_otp', {
      p_challenge: challengeId, p_otp_hash: otpDigest(String(code)), p_grant_hash: sha256(grantToken)
    });
    if (!result || result.status === 'invalid') throw new HttpError(410, 'This phone code has expired or is no longer valid.');
    if (result.status !== 'verified') {
      const remaining = Number(result.remaining || 0);
      throw new HttpError(400, remaining ? `That code is not correct. ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} remaining.` : 'Too many incorrect attempts. Request a new reset link.');
    }
    return json({ grantToken, expiresIn: 600 });
  } catch (error) {
    return handleError(error);
  }
}
