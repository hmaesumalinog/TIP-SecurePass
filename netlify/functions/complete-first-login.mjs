import { assertPost, handleError, HttpError, json, readJson, validatePassword } from './_shared/http.mjs';
import { clearSessionCookie, createSession, readSession, sessionCookie } from './_shared/session.mjs';
import { query, supabase } from './_shared/supabase.mjs';
import { firstLoginConfirmationEmail, sendEmail } from './_shared/resend.mjs';

export default async function handler(request) {
  try {
    assertPost(request);
    const session = readSession(request);
    if (!session || session.mode !== 'setup') throw new HttpError(401, 'Your password-setup session has expired. Sign in with a newly issued temporary password.');
    const { password } = await readJson(request);
    if (!validatePassword(password)) throw new HttpError(400, 'Use 12–128 characters with uppercase, lowercase, number, and symbol. Do not include a student number.');

    const students = await supabase(`demo_students?${query({
      select: 'id,email,first_name,active,password_changed_at,must_change_password,temporary_password_expires_at',
      id: `eq.${session.sid}`,
      active: 'eq.true',
      limit: 1
    })}`);
    const student = students[0];
    if (!student || student.password_changed_at !== session.pv || !student.must_change_password) throw new HttpError(401, 'This temporary-password session is no longer valid.');
    if (!student.temporary_password_expires_at || new Date(student.temporary_password_expires_at).getTime() <= Date.now()) throw new HttpError(401, 'Your temporary password has expired. Ask the administrator to issue a new one.');

    const result = await supabase('rpc/complete_first_login_password', {
      method: 'POST',
      body: JSON.stringify({ p_student_id: student.id, p_password: password })
    });
    const completed = Array.isArray(result) ? result[0] : result;
    if (!completed?.id) throw new HttpError(401, 'This temporary-password session is no longer valid.');

    const token = createSession({ id: completed.id, password_changed_at: completed.password_changed_at });
    const mail = firstLoginConfirmationEmail({ firstName: completed.first_name });
    try {
      await sendEmail({ to: completed.email, ...mail, idempotencyKey: `first-login-complete-${completed.id}-${Date.parse(completed.password_changed_at)}` });
    } catch { /* Password completion must not be rolled back because an alert email failed. */ }

    return json({ message: 'Your permanent password is ready. Opening the portal…' }, 200, {
      'Set-Cookie': sessionCookie(token)
    });
  } catch (error) {
    const response = handleError(error);
    if (error instanceof HttpError && error.status === 401) response.headers.set('Set-Cookie', clearSessionCookie());
    return response;
  }
}
