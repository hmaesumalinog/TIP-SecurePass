import { assertPost, expiresIn, handleError, HttpError, json, maskPhone, otpDigest, randomOtp, readJson, sha256 } from './_shared/http.mjs';
import { insert, query, supabase, update } from './_shared/supabase.mjs';
import { canUseInfobipForPhone, normalizeInfobipPhone, sendInfobipOtp } from './_shared/infobip.mjs';
import { canUseUniSmsForPhone, sendUniSmsOtp } from './_shared/unisms.mjs';

export default async function handler(request) {
  try {
    assertPost(request);
    const { token } = await readJson(request);
    if (typeof token !== 'string' || token.length < 32 || token.length > 200) throw new HttpError(400, 'This reset link is invalid.');

    const tokens = await supabase(`reset_tokens?${query({ select: 'id,student_id,expires_at,used_at,demo_students(phone)', token_hash: `eq.${sha256(token)}`, limit: 1 })}`);
    const reset = tokens[0];
    if (!reset || reset.used_at || new Date(reset.expires_at) <= new Date()) throw new HttpError(410, 'This reset link has expired or already been used.');

    await update('otp_challenges', { reset_token_id: `eq.${reset.id}`, locked_at: 'is.null' }, { locked_at: new Date().toISOString() });
    const phone = reset.demo_students?.phone;
    let otp = '';
    let storedVerification;
    let channel = 'simulated_sms';
    let deliveryError = '';
    const smsProvider = String(process.env.SMS_PROVIDER || '').toLowerCase();
    const attemptedRealSms = smsProvider === 'unisms'
      ? canUseUniSmsForPhone(phone)
      : smsProvider === 'infobip'
        ? canUseInfobipForPhone(phone)
        : false;
    if (attemptedRealSms) {
      try {
        otp = randomOtp();
        if (smsProvider === 'unisms') {
          await sendUniSmsOtp(phone, otp);
          channel = 'unisms_sms';
        } else {
          await sendInfobipOtp(phone, otp);
          channel = 'infobip_sms';
        }
        storedVerification = otpDigest(otp);
      } catch (error) {
        otp = '';
        deliveryError = error instanceof Error ? error.message : 'SMS delivery failed.';
      }
    } else if (smsProvider === 'infobip') {
      deliveryError = process.env.INFOBIP_TRIAL_MODE === 'true'
        ? 'The Infobip trial can send only to its verified test number.'
        : 'Infobip SMS is not fully configured.';
    } else if (smsProvider === 'unisms') {
      deliveryError = process.env.UNISMS_TRIAL_MODE === 'true'
        ? 'The UniSMS trial is limited to its configured verified test number.'
        : 'UniSMS is not fully configured.';
    }
    if (!storedVerification) {
      // A verified/eligible provider number must never silently fall back to a
      // browser-visible demonstration OTP. That makes a provider outage look
      // like a successful real delivery and weakens the reset demonstration.
      if (attemptedRealSms) throw new HttpError(503, deliveryError || 'The SMS could not be delivered. Please try again later.');
      if (process.env.DEMO_MODE !== 'true') throw new HttpError(503, deliveryError || 'The phone verification service is unavailable.');
      otp = randomOtp();
      storedVerification = otpDigest(otp);
    }
    const challenges = await insert('otp_challenges', {
      reset_token_id: reset.id,
      student_id: reset.student_id,
      otp_hash: storedVerification,
      expires_at: expiresIn(5 * 60)
    }, 'id');
    await insert('audit_events', {
      student_id: reset.student_id,
      event_type: 'otp_issued',
      details: { channel, ...(deliveryError ? { fallback_reason: deliveryError } : {}) }
    }, 'id');

    return json({
      challengeId: challenges[0].id,
      maskedPhone: maskPhone(normalizeInfobipPhone(phone)),
      expiresIn: 300,
      delivery: channel,
      ...(channel === 'simulated_sms' && process.env.DEMO_MODE === 'true' ? { demoOtp: otp } : {})
    });
  } catch (error) { return handleError(error); }
}
