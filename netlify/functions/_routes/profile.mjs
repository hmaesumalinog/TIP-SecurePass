import { HttpError, handleError, json } from '../_shared/http.mjs';
import { currentStudent } from '../_shared/recovery.mjs';
import { ageFromBirthday } from '../_shared/onboarding.mjs';

export default async function profile(request) {
  try {
    if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
    // One database call returns the profile and recovery status together.
    const { student, recovery } = await currentStudent(request, {
      setupMessage: 'Complete your password setup before opening the portal.'
    });
    if (!student.policies_accepted) return json({code:'POLICIES_REQUIRED',message:'Please review the terms and privacy notice before continuing.'},403);
    // Check confirmed database enrollment, not a browser flag or a pending QR key.
    if (recovery.enabled !== true) return json({
      code: 'AUTHENTICATOR_SETUP_REQUIRED',
      message: 'Set up your authenticator before opening the student portal.'
    }, 403);

    return json({
      recovery: { status: 'ok', enabled: recovery.enabled, phoneVerified: recovery.phoneVerified, remaining: recovery.remaining },
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
