import { afterResponse, assertPost, clientIp, handleError, HttpError, json, normalizeEmail, randomToken, readJson, sha256, siteOrigin } from '../_shared/http.mjs';
import { insert, rpc } from '../_shared/supabase.mjs';
import { resetEmail, recoveryOptionsEmail, sendEmail } from '../_shared/resend.mjs';

const GENERIC_MESSAGE = 'If an account matches that email, we will send its available recovery steps.';

export default async function requestReset(request, context) {
  try {
    assertPost(request);
    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    const attemptId = await rpc('reserve_access_attempt', {
      p_kind: 'reset', p_identifier: sha256(email), p_ip: sha256(clientIp(request, context))
    });
    if (!attemptId) throw new HttpError(429, 'Too many reset requests. Wait 15 minutes before trying again.');

    // Every request receives the same answer at the same point. The account
    // lookup and email delivery finish afterwards, so response time cannot
    // reveal whether the email belongs to an account.
    const origin = siteOrigin(request);
    await afterResponse(context, () => deliverRecoverySteps(email, origin), 'Password-reset email could not be prepared.');
    return json({ message: GENERIC_MESSAGE });
  } catch (error) { return handleError(error); }
}

async function deliverRecoverySteps(email, origin) {
  const token = randomToken();
  const plan = await rpc('prepare_password_reset', { p_email: email, p_token_hash: sha256(token) });
  if (!plan || plan.kind === 'none') return;
  const { student } = plan;
  const resetting = plan.kind === 'reset';
  const mail = resetting
    ? resetEmail({ firstName: student.first_name, resetLink: `${origin}/reset.html?token=${encodeURIComponent(token)}` })
    : recoveryOptionsEmail({ firstName: student.first_name, origin, invited: plan.invited });
  let delivery = 'sent';
  try {
    const result = await sendEmail({
      to: student.email,
      ...mail,
      idempotencyKey: resetting ? `reset-${plan.token_id}` : `recovery-options-${student.id}-${Math.floor(Date.now() / 60000)}`
    });
    if (result.skipped) delivery = 'skipped_demo';
  } catch (emailError) {
    delivery = 'failed';
    console.error('Recovery email delivery failed:', emailError instanceof Error ? emailError.message : 'Unknown error');
  }
  await insert('audit_events', {
    student_id: student.id,
    event_type: resetting ? 'reset_requested' : 'recovery_options_requested',
    details: { delivery }
  }, 'id').catch(() => console.error('Recovery email audit event could not be recorded.'));
}
