import { assertPost, clientIp, handleError, HttpError, json, readJson, sha256 } from '../_shared/http.mjs';
import { rpc } from '../_shared/supabase.mjs';
import { createSession, sessionCookie } from '../_shared/session.mjs';

const INVALID = 'The student number or password is incorrect.';

export default async function login(request, context) {
  try {
    assertPost(request);
    const { studentNumber, password } = await readJson(request);
    const normalizedNumber = String(studentNumber || '').trim();
    if (!/^\d{7}$/.test(normalizedNumber)) throw new HttpError(400, 'Enter your 7-digit student number.');
    if (typeof password !== 'string' || password.length < 1 || password.length > 128) throw new HttpError(401, INVALID);

    // The attempt is reserved in its own short transaction, so simultaneous
    // guesses are counted before any password is hashed.
    const numberHash = sha256(normalizedNumber);
    const attemptId = await rpc('reserve_access_attempt', {
      p_kind: 'student', p_identifier: numberHash, p_ip: sha256(clientIp(request, context))
    });
    if (!attemptId) throw new HttpError(429, 'Too many sign-in attempts. Wait 15 minutes and try again.');

    // Verifies the password (in constant time for unknown accounts), marks the
    // attempt and records the audit event in one round trip.
    const result = await rpc('student_sign_in_finish', {
      p_attempt: attemptId, p_student_number: normalizedNumber, p_password: password, p_number_hash: numberHash
    });
    if (result?.status === 'expired') throw new HttpError(403, 'Your temporary password has expired. Ask the administrator to issue a new one.');
    if (result?.status !== 'ok') throw new HttpError(401, INVALID);

    const student = result.student;
    const requiresPasswordChange = Boolean(student.must_change_password);
    const token = createSession(student, { setupOnly: requiresPasswordChange });
    return json(
      {
        message: requiresPasswordChange ? 'Temporary password accepted. Create your permanent password.' : 'Signed in successfully.',
        requiresPasswordChange,
        student: { firstName: student.first_name, studentNumber: student.student_number }
      },
      200,
      { 'Set-Cookie': sessionCookie(token, requiresPasswordChange ? 10 * 60 : undefined) }
    );
  } catch (error) {
    return handleError(error);
  }
}
