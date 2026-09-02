import { assertPost, handleError, HttpError, json, readJson, sha256, validatePassword } from './_shared/http.mjs';
import { insert, supabase } from './_shared/supabase.mjs';
import { resetConfirmationEmail, sendEmail } from './_shared/resend.mjs';

export default async function handler(request) {
  try {
    assertPost(request);
    const { grantToken, password } = await readJson(request);
    if (typeof grantToken !== 'string' || grantToken.length < 32 || grantToken.length > 200) throw new HttpError(400, 'Your verified reset session is invalid.');
    if (!validatePassword(password)) throw new HttpError(400, 'Use 12–128 characters with uppercase, lowercase, number, and symbol. Do not include a student number.');

    let result;
    try {
      result = await supabase('rpc/complete_password_reset', {
        method: 'POST',
        body: JSON.stringify({
          p_grant_hash: sha256(grantToken),
          p_password: password
        })
      });
    } catch (error) {
      if (/student number|password.*policy/i.test(error.message)) throw new HttpError(400, 'Use 12–128 characters with uppercase, lowercase, number, and symbol. Do not include your student number.');
      throw error;
    }
    const student = Array.isArray(result) ? result[0] : result;
    if (!student?.email) throw new HttpError(410, 'This verified reset session has expired or already been used.');

    const mail = resetConfirmationEmail({ firstName: student.first_name });
    try {
      await sendEmail({
        to: student.email,
        ...mail,
        idempotencyKey: `changed-${student.event_id}`
      });
    } catch (emailError) {
      console.error('Password changed; confirmation email failed:', emailError instanceof Error ? emailError.message : 'Unknown error');
      await insert(
        'audit_events',
        {
          student_id: student.student_id,
          event_type: 'confirmation_email_failed',
          details: {}
        },
        'id'
      );
    }
    return json({ message: 'Password updated successfully.' });
  } catch (error) {
    return handleError(error);
  }
}
