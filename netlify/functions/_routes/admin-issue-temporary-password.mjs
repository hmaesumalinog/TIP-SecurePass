import { assertPost, handleError, HttpError, json, readJson, sha256, siteOrigin } from '../_shared/http.mjs';
import { requireAdmin, requireCsrf } from '../_shared/admin-session.mjs';
import { query, rpc, supabase } from '../_shared/supabase.mjs';
import { sendEmail, studentWelcomeEmail } from '../_shared/resend.mjs';
import { generateTemporaryPassword } from '../_shared/temporary-password.mjs';

function recordEvents(admin, studentId, adminEvent, adminDetails, studentEvent = null, studentDetails = null) {
  return rpc('record_admin_student_event', {
    p_admin: admin.id, p_student: studentId, p_admin_event: adminEvent, p_admin_details: adminDetails,
    p_student_event: studentEvent, p_student_details: studentDetails
  }).catch(() => console.error('Administrator audit event could not be recorded.'));
}

export default async function adminIssueTemporaryPassword(request) {
  try {
    assertPost(request);
    const { admin, session } = await requireAdmin(request, ['super_admin']);
    requireCsrf(request, session);
    const { studentId } = await readJson(request);
    if (typeof studentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(studentId)) throw new HttpError(400, 'Student record is invalid.');

    const students = await supabase(`demo_students?${query({ select: 'id,student_number,email,first_name,active,must_change_password', id: `eq.${studentId}`, limit: 1 })}`);
    const student = students[0];
    if (!student) throw new HttpError(404, 'Student record was not found.');
    if (!student.active) throw new HttpError(409, 'Activate the student before issuing a temporary password.');
    if (!student.must_change_password) throw new HttpError(409, 'This student already completed first login. Use their enrolled recovery methods or the approved assistance process.');

    const temporaryPassword = generateTemporaryPassword();
    const mail = studentWelcomeEmail({
      firstName: student.first_name,
      studentNumber: student.student_number,
      temporaryPassword,
      signInLink: `${siteOrigin(request)}/`
    });
    try {
      await sendEmail({
        to: student.email,
        ...mail,
        idempotencyKey: `student-temporary-${student.id}-${sha256(temporaryPassword).slice(0, 16)}`
      });
    } catch {
      await recordEvents(admin, student.id, 'student_temporary_password_email_failed', { reason: 'delivery_error' });
      throw new HttpError(502, 'The temporary-password email could not be delivered. The student’s current password was not changed.');
    }

    const result = await rpc('reissue_student_invitation', {
      p_student_id: student.id,
      p_temporary_password: temporaryPassword
    });
    const issued = Array.isArray(result) ? result[0] : result;
    if (!issued?.id) throw new HttpError(409, 'The email was accepted, but the temporary password could not be activated. Retry the operation and notify the student to use the newest message only.');

    await recordEvents(admin, student.id, 'student_temporary_password_issued', { expires_hours: 24 },
      'temporary_password_issued', { requested_by: 'admin', expires_hours: 24 });
    return json({
      message: 'A new temporary password was emailed. Any previous password is now invalid.'
    });
  } catch (error) {
    return handleError(error);
  }
}
