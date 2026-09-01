import { HttpError, handleError, json } from './_shared/http.mjs';
import { query, supabase } from './_shared/supabase.mjs';
import { readSession } from './_shared/session.mjs';

export default async function handler(request) {
  try {
    if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
    const session = readSession(request);
    if (!session) throw new HttpError(401, 'Your session has expired. Please sign in again.');
    if (session.mode === 'setup') throw new HttpError(401, 'Complete your password setup before opening the portal.');

    const result = await supabase(`demo_students?${query({
      select: 'id,student_number,email,first_name,last_name,age,phone,program,year_level,password_changed_at',
      id: `eq.${session.sid}`,
      active: 'eq.true',
      limit: 1
    })}`);
    const student = result?.[0];
    const passwordVersion = student?.password_changed_at || '';
    if (!student || passwordVersion !== session.pv) throw new HttpError(401, 'Your session has expired. Please sign in again.');

    return json({
      student: {
        studentNumber: student.student_number,
        firstName: student.first_name,
        lastName: student.last_name,
        fullName: [student.first_name, student.last_name].filter(Boolean).join(' '),
        email: student.email,
        age: student.age,
        phone: student.phone,
        program: student.program,
        yearLevel: student.year_level
      }
    });
  } catch (error) { return handleError(error); }
}
