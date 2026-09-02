import { assertPost, expiresIn, handleError, HttpError, json, randomToken, readJson, sha256 } from './_shared/http.mjs';
import { requireAdmin, requireCsrf } from './_shared/admin-session.mjs';
import { insert, query, supabase } from './_shared/supabase.mjs';
import { resetEmail, sendEmail } from './_shared/resend.mjs';

export default async function handler(request) {
  try {
    assertPost(request);
    const { admin, session } = await requireAdmin(request, ['super_admin']);
    requireCsrf(request, session);
    const { studentId } = await readJson(request);
    if (typeof studentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(studentId)) throw new HttpError(400, 'Student record is invalid.');
    const students = await supabase(`demo_students?${query({ select: 'id,email,first_name,active', id: `eq.${studentId}`, limit: 1 })}`);
    const student = students[0];
    if (!student) throw new HttpError(404, 'Student record was not found.');
    if (!student.active) throw new HttpError(409, 'Activate the student before sending a reset link.');
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
    const origin = (process.env.SITE_URL || new URL(request.url).origin).replace(/\/$/, '');
    const resetLink = `${origin}/reset.html?token=${encodeURIComponent(token)}`;
    const mail = resetEmail({ firstName: student.first_name, resetLink });
    await sendEmail({
      to: student.email,
      ...mail,
      idempotencyKey: `admin-reset-${tokenRows[0].id}`
    });
    await insert(
      'audit_events',
      {
        student_id: student.id,
        event_type: 'reset_requested',
        details: { delivery: 'sent', requested_by: 'admin' }
      },
      'id'
    );
    await insert(
      'admin_audit_events',
      {
        admin_id: admin.id,
        event_type: 'student_reset_email_sent',
        target_student_id: student.id,
        details: {}
      },
      'id'
    );
    return json({ message: 'Secure password-reset link sent through Resend.' });
  } catch (error) {
    return handleError(error);
  }
}
