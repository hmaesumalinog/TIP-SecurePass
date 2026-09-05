import { assertPost, handleError, HttpError, json, maskPhone, otpDigest, randomOtp, readJson, sha256 } from './_shared/http.mjs';
import { insert, supabase, update } from './_shared/supabase.mjs';
import { canUseInfobipForPhone, sendInfobipOtp } from './_shared/infobip.mjs';
import { canUseUniSmsForPhone, sendUniSmsOtp } from './_shared/unisms.mjs';

export default async function handler(request) {
  try {
    assertPost(request);
    const { token, resend = false, previousChallengeId = null } = await readJson(request);
    if (typeof token !== 'string' || token.length < 32 || token.length > 200) throw new HttpError(400, 'This reset link is invalid.');
    if (typeof resend !== 'boolean' || (previousChallengeId !== null && !/^[0-9a-f-]{36}$/i.test(previousChallengeId))) throw new HttpError(400, 'Invalid code request.');
    const otp = randomOtp();
    const reset = await supabase('rpc/prepare_reset_otp', { method: 'POST', body: JSON.stringify({
      p_token_hash: sha256(token), p_otp_hash: otpDigest(otp), p_resend: resend, p_previous_id: previousChallengeId
    }) });
    if (reset.status === 'invalid') return json({ status: 'invalid', message: 'This reset link has expired or already been used.' }, 410);
    const result = {
      status: reset.status, challengeId: reset.challenge_id,
      maskedPhone: maskPhone(reset.phone),
      expiresIn: Math.max(0, Math.floor((Date.parse(reset.expires_at) - Date.now()) / 1000)) || 0,
      retryAfter: reset.retry_after || 0, remainingSends: reset.remaining_sends || 0
    };
    if (reset.status !== 'reserved') return json(result);
    let channel;
    try {
      const provider = String(process.env.SMS_PROVIDER || '').toLowerCase();
      if (provider === 'unisms' && canUseUniSmsForPhone(reset.phone)) {
        await sendUniSmsOtp(reset.phone, otp); channel = 'unisms_sms';
      } else if (provider === 'infobip' && canUseInfobipForPhone(reset.phone)) {
        await sendInfobipOtp(reset.phone, otp); channel = 'infobip_sms';
      } else if (process.env.DEMO_MODE === 'true' && !provider) {
        channel = 'simulated_sms';
      } else {
        throw new Error('SMS provider is not available for this recipient.');
      }
    } catch {
      await update('otp_challenges', { id: `eq.${reset.challenge_id}` }, { delivery_status: 'failed' });
      return json({ ...result, status: 'failed' });
    }
    await update('otp_challenges', { id: `eq.${reset.challenge_id}` }, { delivery_status: 'sent', delivery_channel: channel });
    // Audit failure must not turn an accepted SMS into a second send request.
    await insert('audit_events', { student_id: reset.student_id, event_type: 'otp_issued', details: { channel } }, 'id')
      .catch(() => console.error('OTP audit event could not be recorded.'));
    return json({ ...result, status: 'active', sent: true,
      expiresIn: Math.max(0, Math.floor((Date.parse(reset.expires_at) - Date.now()) / 1000)),
      ...(channel === 'simulated_sms' ? { demoOtp: otp } : {}) });
  } catch (error) { return handleError(error); }
}
