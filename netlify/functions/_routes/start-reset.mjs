import { assertPost, handleError, HttpError, isLocalRequest, json, maskPhone, otpDigest, randomOtp, readJson, sha256 } from '../_shared/http.mjs';
import { rpc, update } from '../_shared/supabase.mjs';
import { canUseUniSmsForPhone, getUniSmsStatus, sendUniSmsOtp } from '../_shared/unisms.mjs';

// Records the provider outcome and the "code issued" audit event together. A
// recording failure must not turn a sent SMS into an error for the student.
async function recordDelivery(challengeId, status, channel, reference, issue, issued) {
  await rpc('record_reset_otp_delivery', {
    p_challenge: challengeId, p_status: status, p_channel: channel ?? null,
    p_reference: reference ?? null, p_issue: issue ?? null, p_issued: issued
  }).catch(() => console.error('SMS delivery state could not be recorded.'));
}

export default async function startReset(request) {
  try {
    assertPost(request);
    const { token, resend = false, previousChallengeId = null } = await readJson(request);
    if (typeof token !== 'string' || token.length < 32 || token.length > 200) throw new HttpError(400, 'This reset link is invalid.');
    if (typeof resend !== 'boolean' || (previousChallengeId !== null && !/^[0-9a-f-]{36}$/i.test(previousChallengeId))) throw new HttpError(400, 'Invalid code request.');
    const otp = randomOtp();
    const reset = await rpc('prepare_reset_otp_v2', {
      p_token_hash: sha256(token), p_otp_hash: otpDigest(otp), p_resend: resend, p_previous_id: previousChallengeId
    });
    if (reset.status === 'invalid') return json({ status: 'invalid', message: 'This reset link has expired or already been used.' }, 410);
    const result = {
      status: reset.status, challengeId: reset.challenge_id,
      maskedPhone: maskPhone(reset.phone),
      expiresIn: Math.max(0, Math.floor((Date.parse(reset.expires_at) - Date.now()) / 1000)) || 0,
      retryAfter: reset.retry_after || 0, remainingSends: reset.remaining_sends || 0
    };
    if (reset.delivery_issue === 'content_rejected') result.deliveryIssue = 'content_rejected';
    if (reset.status !== 'reserved') {
      // Read-only provider lookup reserved by the database. Never sends again.
      if (reset.check_delivery && reset.delivery_channel === 'unisms_sms' && reset.provider_reference) {
        let delivery;
        try { delivery = await getUniSmsStatus(reset.provider_reference); }
        catch { delivery = { status: 'unknown' }; }
        await update('otp_challenges', { id: `eq.${reset.challenge_id}`, delivery_status: 'in.(pending,unknown)' }, {
          delivery_status: delivery.status,
          delivery_issue: delivery.failureCode === 'content_rejected' ? 'content_rejected' : null
        }).catch(() => console.error('SMS delivery status could not be recorded.'));
        result.status = delivery.status === 'sent' ? 'active' : delivery.status;
        if (delivery.failureCode === 'content_rejected') {
          result.deliveryIssue = 'content_rejected'; result.remainingSends = 0;
        }
      }
      return json(result);
    }
    let channel, deliveryStatus = 'sent', reference = null;
    try {
      const provider = String(process.env.SMS_PROVIDER || '').toLowerCase();
      if (canUseUniSmsForPhone(reset.phone)) {
        const delivery = await sendUniSmsOtp(reset.phone, otp);
        channel = 'unisms_sms'; deliveryStatus = delivery.status; reference = delivery.referenceId;
      } else if (!provider && process.env.DEMO_MODE === 'true' && isLocalRequest(request)) {
        // Developer machines only: a deployed site never shows a code on screen.
        channel = 'simulated_sms';
      } else {
        throw new Error('SMS provider is not available for this recipient.');
      }
    } catch (error) {
      const issue = error.failureCode === 'content_rejected' ? 'content_rejected' : null;
      // A network timeout is uncertain: the provider might still deliver the code.
      const status = error.code === 'SMS_REJECTED' ? 'failed' : 'unknown';
      await recordDelivery(reset.challenge_id, status, null, null, issue, false);
      return json({ ...result, status, ...(issue ? { deliveryIssue: issue, remainingSends: 0 } : {}) });
    }
    await recordDelivery(reset.challenge_id, deliveryStatus, channel, reference, null, true);
    return json({ ...result, status: deliveryStatus === 'sent' ? 'active' : deliveryStatus, sent: deliveryStatus === 'sent',
      expiresIn: Math.max(0, Math.floor((Date.parse(reset.expires_at) - Date.now()) / 1000)),
      ...(channel === 'simulated_sms' ? { demoOtp: otp } : {}) });
  } catch (error) { return handleError(error); }
}
