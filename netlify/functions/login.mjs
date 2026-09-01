import { assertPost, handleError, HttpError, json, readJson, sha256 } from './_shared/http.mjs';
import { insert, supabase } from './_shared/supabase.mjs';
import { createSession, sessionCookie } from './_shared/session.mjs';

const INVALID = 'The student number or password is incorrect.';

export default async function handler(request) {
  try {
    assertPost(request);
    const { studentNumber, password } = await readJson(request);
    const normalizedNumber = String(studentNumber || '').trim();
    if (!/^\d{7}$/.test(normalizedNumber)) throw new HttpError(400, 'Enter your 7-digit student number.');
    if (typeof password !== 'string' || password.length < 1 || password.length > 128) throw new HttpError(401, INVALID);

    const result = await supabase('rpc/authenticate_demo_student', {
      method: 'POST',
      body: JSON.stringify({ p_student_number: normalizedNumber, p_password: password })
    });
    const student = Array.isArray(result) ? result[0] : result;
    if (!student?.id) {
      await insert('audit_events', {
        student_id: null,
        event_type: 'login_failed',
        details: { student_number_hash: sha256(normalizedNumber) }
      }, 'id');
      throw new HttpError(401, INVALID);
    }

    if (student.must_change_password && (!student.temporary_password_expires_at || new Date(student.temporary_password_expires_at).getTime() <= Date.now())) {
      await insert('audit_events', { student_id: student.id, event_type: 'temporary_password_expired', details: {} }, 'id');
      throw new HttpError(403, 'Your temporary password has expired. Ask the administrator to issue a new one.');
    }

    const requiresPasswordChange = Boolean(student.must_change_password);
    await insert('audit_events', { student_id: student.id, event_type: requiresPasswordChange ? 'temporary_password_login_succeeded' : 'login_succeeded', details: {} }, 'id');
    const token = createSession(student, { setupOnly: requiresPasswordChange });
    return json({
      message: requiresPasswordChange ? 'Temporary password accepted. Create your permanent password.' : 'Signed in successfully.',
      requiresPasswordChange,
      student: { firstName: student.first_name, studentNumber: student.student_number }
    }, 200, { 'Set-Cookie': sessionCookie(token, requiresPasswordChange ? 10 * 60 : undefined) });
  } catch (error) { return handleError(error); }
}
