import { assertPost, handleError, HttpError, json, passwordShapeValid, readJson } from '../_shared/http.mjs';
import { clearSessionCookie, createSession, readSession, sessionCookie } from '../_shared/session.mjs';
import { rpc } from '../_shared/supabase.mjs';
import { firstLoginConfirmationEmail, sendEmail } from '../_shared/resend.mjs';
import { POLICY_VERSION } from '../_shared/onboarding.mjs';

const POLICY = 'Use 12–128 characters with uppercase, lowercase, number, and symbol. Do not include your student number.';

export default async function completeFirstLogin(request) {
  try {
    assertPost(request);
    const session = readSession(request);
    if (!session || session.mode !== 'setup') throw new HttpError(401, 'Your password-setup session has expired. Sign in with a newly issued temporary password.');
    const { password, termsAccepted, privacyAccepted, policyVersion } = await readJson(request);
    if (termsAccepted !== true || privacyAccepted !== true || policyVersion !== POLICY_VERSION) throw new HttpError(400, 'Read and accept the current terms and acknowledge the privacy notice before continuing.');
    if (!passwordShapeValid(password)) throw new HttpError(400, POLICY);

    // Session, temporary-password expiry, the student-number rule, the new
    // password and the policy acknowledgment are all settled in one call.
    const result = await rpc('complete_first_login_v2', {
      p_sid: session.sid, p_version: session.pv, p_session: session.sv, p_password: password,
      p_terms: termsAccepted, p_privacy: privacyAccepted, p_policy: policyVersion
    });
    if (result?.status === 'policy') throw new HttpError(400, POLICY);
    if (result?.status === 'expired') throw new HttpError(401, 'Your temporary password has expired. Ask the administrator to issue a new one.');
    if (result?.status !== 'ok') throw new HttpError(401, 'This temporary-password session is no longer valid.');

    const completed = result.student;
    const token = createSession(completed);
    try {
      await sendEmail({
        to: completed.email,
        ...firstLoginConfirmationEmail({ firstName: completed.first_name }),
        idempotencyKey: `first-login-complete-${completed.id}-${Date.parse(completed.password_changed_at)}`
      });
    } catch {
      /* Password completion must not be rolled back because an alert email failed. */
    }

    return json({ message: 'Your permanent password is ready. Opening the portal…' }, 200, {
      'Set-Cookie': sessionCookie(token)
    });
  } catch (error) {
    const response = handleError(error);
    if (error instanceof HttpError && error.status === 401) response.headers.set('Set-Cookie', clearSessionCookie());
    return response;
  }
}
