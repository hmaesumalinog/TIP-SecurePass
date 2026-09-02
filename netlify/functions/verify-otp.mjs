import { assertPost, expiresIn, handleError, HttpError, json, otpDigest, randomToken, readJson, safeEqual, sha256 } from './_shared/http.mjs';
import { insert, query, supabase } from './_shared/supabase.mjs';
import { isInfobipReference, verifyInfobipPin } from './_shared/infobip.mjs';

export default async function handler(request) {
  try {
    assertPost(request);
    const { challengeId, code } = await readJson(request);
    if (!/^[0-9a-f-]{36}$/i.test(String(challengeId)) || !/^\d{6}$/.test(String(code))) throw new HttpError(400, 'Enter the 6-digit verification code.');

    const rows = await supabase(`otp_challenges?${query({ select: 'id,student_id,otp_hash,expires_at,attempts,verified_at,locked_at', id: `eq.${challengeId}`, limit: 1 })}`);
    const challenge = rows[0];
    if (!challenge || challenge.verified_at || challenge.locked_at || new Date(challenge.expires_at) <= new Date()) throw new HttpError(410, 'This phone code has expired or is no longer valid.');
    if (challenge.attempts >= 5) throw new HttpError(429, 'Too many incorrect attempts. Request a new reset link.');

    const correct = isInfobipReference(challenge.otp_hash) ? await verifyInfobipPin(challenge.otp_hash, String(code)) : safeEqual(challenge.otp_hash, otpDigest(String(code)));
    const consumedResult = await supabase('rpc/consume_student_otp_attempt', {
      method: 'POST',
      body: JSON.stringify({
        p_challenge_id: challenge.id,
        p_correct: correct
      })
    });
    const consumed = Array.isArray(consumedResult) ? consumedResult[0] : consumedResult;
    if (!consumed || consumed.status === 'invalid') throw new HttpError(410, 'This phone code has expired or is no longer valid.');
    if (consumed.status !== 'verified') {
      const remaining = Number(consumed.remaining || 0);
      throw new HttpError(400, remaining ? `That code is not correct. ${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} remaining.` : 'Too many incorrect attempts. Request a new reset link.');
    }

    const grantToken = randomToken();
    await insert(
      'reset_grants',
      {
        challenge_id: challenge.id,
        student_id: consumed.student_id,
        grant_hash: sha256(grantToken),
        expires_at: expiresIn(10 * 60)
      },
      'id'
    );
    await insert(
      'audit_events',
      {
        student_id: consumed.student_id,
        event_type: 'otp_verified',
        details: {}
      },
      'id'
    );
    return json({ grantToken, expiresIn: 600 });
  } catch (error) {
    return handleError(error);
  }
}
