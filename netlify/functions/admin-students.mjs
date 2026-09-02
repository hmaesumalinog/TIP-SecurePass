import { handleError, HttpError, json, normalizeEmail, readJson } from './_shared/http.mjs';
import { requireAdmin, requireCsrf } from './_shared/admin-session.mjs';
import { insert, query, supabase, update } from './_shared/supabase.mjs';
import { studentWelcomeEmail, sendEmail } from './_shared/resend.mjs';
import { generateTemporaryPassword } from './_shared/temporary-password.mjs';

const fields = 'id,student_number,email,first_name,last_name,age,phone,program,year_level,active,password_changed_at,must_change_password,temporary_password_expires_at,created_at';

function cleanProfile(body) {
  const firstName = String(body.firstName || '').trim();
  const lastName = String(body.lastName || '').trim();
  const phone = String(body.phone || '').trim();
  const program = String(body.program || '').trim();
  const yearLevel = String(body.yearLevel || '').trim();
  const age = Number(body.age);
  if (!firstName || firstName.length > 80 || !lastName || lastName.length > 80) throw new HttpError(400, 'Enter the student’s first and last name.');
  if (!Number.isInteger(age) || age < 15 || age > 100) throw new HttpError(400, 'Enter a valid student age.');
  if (phone.replace(/\D/g, '').length < 10 || phone.length > 30) throw new HttpError(400, 'Enter a valid phone number.');
  if (!program || program.length > 160 || !yearLevel || yearLevel.length > 40) throw new HttpError(400, 'Enter the program and year level.');
  return {
    email: normalizeEmail(body.email),
    firstName,
    lastName,
    age,
    phone,
    program,
    yearLevel
  };
}

export default async function handler(request) {
  try {
    if (request.method === 'GET') {
      await requireAdmin(request);
      const rows = await supabase(`demo_students?${query({ select: fields, order: 'created_at.desc' })}`);
      const search = new URL(request.url).searchParams.get('search')?.trim().toLowerCase() || '';
      const students = !search ? rows : rows.filter((student) => [student.student_number, student.email, student.first_name, student.last_name].some((value) => String(value).toLowerCase().includes(search)));
      return json({ students, refreshedAt: new Date().toISOString() });
    }

    if (request.method === 'POST') {
      const { admin, session } = await requireAdmin(request, ['super_admin']);
      requireCsrf(request, session);
      const body = await readJson(request);
      const studentNumber = String(body.studentNumber || '').trim();
      if (!/^\d{7}$/.test(studentNumber)) throw new HttpError(400, 'Student number must contain exactly 7 digits.');
      const profile = cleanProfile(body);
      const temporaryPassword = generateTemporaryPassword();
      let result;
      try {
        result = await supabase('rpc/admin_create_demo_student', {
          method: 'POST',
          body: JSON.stringify({
            p_student_number: studentNumber,
            p_email: profile.email,
            p_first_name: profile.firstName,
            p_last_name: profile.lastName,
            p_age: profile.age,
            p_phone: profile.phone,
            p_program: profile.program,
            p_year_level: profile.yearLevel,
            p_temporary_password: temporaryPassword
          })
        });
      } catch (error) {
        if (/duplicate|unique/i.test(error.message)) throw new HttpError(409, 'That student number or email already exists.');
        throw error;
      }
      const student = Array.isArray(result) ? result[0] : result;
      const origin = (process.env.SITE_URL || new URL(request.url).origin).replace(/\/$/, '');
      const mail = studentWelcomeEmail({
        firstName: profile.firstName,
        studentNumber,
        temporaryPassword,
        signInLink: `${origin}/`
      });
      let emailSent = false;
      try {
        await sendEmail({
          to: profile.email,
          ...mail,
          idempotencyKey: `student-welcome-${student.id}`
        });
        emailSent = true;
      } catch (emailError) {
        await insert(
          'admin_audit_events',
          {
            admin_id: admin.id,
            event_type: 'student_welcome_email_failed',
            target_student_id: student.id,
            details: { reason: 'delivery_error' }
          },
          'id'
        );
      }
      await insert(
        'admin_audit_events',
        {
          admin_id: admin.id,
          event_type: 'student_created',
          target_student_id: student.id,
          details: {
            student_number: studentNumber,
            welcome_email: emailSent ? 'sent' : 'failed'
          }
        },
        'id'
      );
      await insert(
        'audit_events',
        {
          student_id: student.id,
          event_type: 'student_account_created',
          details: {
            welcome_email: emailSent ? 'sent' : 'failed',
            temporary_password_expires_hours: 24
          }
        },
        'id'
      );
      return json(
        {
          message: emailSent ? 'Student created and temporary sign-in password emailed.' : 'Student created, but the welcome email could not be delivered. Use “Reissue temporary password” to try again.',
          emailSent,
          student
        },
        201
      );
    }

    if (request.method === 'PATCH') {
      const { admin, session } = await requireAdmin(request, ['super_admin']);
      requireCsrf(request, session);
      const body = await readJson(request);
      if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id)) throw new HttpError(400, 'Student record is invalid.');
      const profile = cleanProfile(body);
      if (typeof body.active !== 'boolean') throw new HttpError(400, 'Student status must be active or inactive.');
      const active = body.active;
      let rows;
      try {
        rows = await update(
          'demo_students',
          { id: `eq.${body.id}` },
          {
            email: profile.email,
            first_name: profile.firstName,
            last_name: profile.lastName,
            age: profile.age,
            phone: profile.phone,
            program: profile.program,
            year_level: profile.yearLevel,
            active
          },
          fields
        );
      } catch (error) {
        if (/duplicate|unique/i.test(error.message)) throw new HttpError(409, 'That email is already assigned to another student.');
        throw error;
      }
      if (!rows.length) throw new HttpError(404, 'Student record was not found.');
      await insert(
        'admin_audit_events',
        {
          admin_id: admin.id,
          event_type: active ? 'student_profile_updated' : 'student_deactivated',
          target_student_id: body.id,
          details: {
            fields: ['email', 'name', 'age', 'phone', 'program', 'year_level', 'active']
          }
        },
        'id'
      );
      return json({ message: 'Student profile updated.', student: rows[0] });
    }

    throw new HttpError(405, 'Method not allowed.');
  } catch (error) {
    return handleError(error);
  }
}
