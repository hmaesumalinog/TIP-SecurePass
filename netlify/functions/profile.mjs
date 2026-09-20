import { HttpError, handleError, json } from './_shared/http.mjs';
import { query, supabase } from './_shared/supabase.mjs';
import { readSession } from './_shared/session.mjs';
import { rpc } from './_shared/recovery.mjs';
import { ageFromBirthday, policiesAccepted } from './_shared/onboarding.mjs';

export default async function handler(request) {
  try {
    if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
    const session = readSession(request);
    if (!session) throw new HttpError(401, 'Your session has expired. Please sign in again.');
    if (session.mode === 'setup') throw new HttpError(401, 'Complete your password setup before opening the portal.');

    const result = await supabase(`demo_students?${query({
      select: 'id,student_number,email,first_name,last_name,birth_date,age,phone,program,year_level,password_changed_at,terms_version,privacy_version',
      id: `eq.${session.sid}`,
      active: 'eq.true',
      limit: 1
    })}`);
    const student = result?.[0];
    const passwordVersion = student?.password_changed_at || '';
    if (!student || passwordVersion !== session.pv) throw new HttpError(401, 'Your session has expired. Please sign in again.');
    if (!policiesAccepted(student)) return json({code:'POLICIES_REQUIRED',message:'Please review the terms and privacy notice before continuing.'},403);

    // Check confirmed database enrollment, not a browser flag or a pending QR key.
    const recovery = await rpc('recovery_settings', {
      p_sid: student.id, p_version: session.pv, p_action: 'status', p_data: {}
    });
    if (recovery.status !== 'ok') throw new HttpError(503, 'We could not check your recovery settings. Please try again.');
    if (recovery.enabled !== true) return json({
      code: 'AUTHENTICATOR_SETUP_REQUIRED',
      message: 'Set up your authenticator before opening the student portal.'
    }, 403);

    return json({
      student: {
        studentNumber: student.student_number,
        firstName: student.first_name,
        lastName: student.last_name,
        fullName: [student.first_name, student.last_name].filter(Boolean).join(' '),
        email: student.email,
        age: student.birth_date ? ageFromBirthday(student.birth_date) : student.age,
        birthday: student.birth_date,
        phone: student.phone || 'Not added — manage in Security & recovery',
        program: student.program,
        yearLevel: student.year_level
      }
    });
  } catch (error) { return handleError(error); }
}
