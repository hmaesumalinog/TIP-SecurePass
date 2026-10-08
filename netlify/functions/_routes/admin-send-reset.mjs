import { assertPost, expiresIn, handleError, HttpError, json, randomToken, readJson, sha256, siteOrigin } from '../_shared/http.mjs';
import { requireAdmin, requireCsrf } from '../_shared/admin-session.mjs';
import { insert, query, rpc, supabase } from '../_shared/supabase.mjs';
import { resetEmail, sendEmail } from '../_shared/resend.mjs';

export default async function adminSendReset(request) {
  try {
    assertPost(request);
    const { admin, session } = await requireAdmin(request, ['super_admin']);
    requireCsrf(request, session);
    const { studentId } = await readJson(request);
    if (typeof studentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(studentId)) throw new HttpError(400, 'Student record is invalid.');
    const students = await supabase(`admin_student_security?${query({ select: 'id,email,first_name,active,phone_verified,must_change_password', id: `eq.${studentId}`, limit: 1 })}`);
    const student = students[0];
    if (!student) throw new HttpError(404, 'Student record was not found.');
    if (!student.active) throw new HttpError(409, 'Activate the student before sending a reset link.');
    if (student.must_change_password) throw new HttpError(409, 'Reissue the invitation for a student who has not completed first login.');
    if (!student.phone_verified) throw new HttpError(409, 'Email + SMS recovery requires a verified phone. Use backup-code recovery or reviewed assistance instead.');
    const token = randomToken();
    const tokenRows = await insert(
      'reset_tokens',
      {
        student_id: student.id,
        token_hash: sha256(token),
        expires_at: expiresIn(15 * 60)
      },
      'id'
    );
    const resetLink = `${siteOrigin(request)}/reset.html?token=${encodeURIComponent(token)}`;
    const mail = resetEmail({ firstName: student.first_name, resetLink });
    await sendEmail({
      to: student.email,
      ...mail,
      idempotencyKey: `admin-reset-${tokenRows[0].id}`
    });
    await rpc('record_admin_student_event', {
      p_admin: admin.id, p_student: student.id, p_admin_event: 'student_reset_email_sent', p_admin_details: {},
      p_student_event: 'reset_requested', p_student_details: { delivery: 'sent', requested_by: 'admin' }
    }).catch(() => console.error('Administrator audit event could not be recorded.'));
    return json({ message: 'Secure password-reset link sent through Resend.' });
  } catch (error) {
    return handleError(error);
  }
}
