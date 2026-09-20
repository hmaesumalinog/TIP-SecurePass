import { handleError, HttpError, json, normalizeEmail, readJson } from './_shared/http.mjs';
import { requireAdmin, requireCsrf } from './_shared/admin-session.mjs';
import { insert, query, supabase, update } from './_shared/supabase.mjs';
import { studentWelcomeEmail, sendEmail } from './_shared/resend.mjs';
import { generateTemporaryPassword } from './_shared/temporary-password.mjs';
import { ageFromBirthday, validBirthday } from './_shared/onboarding.mjs';

const fields = 'id,student_number,email,first_name,last_name,birth_date,program,year_level,active,record_version,must_change_password,temporary_password_expires_at,created_at';

function cleanProfile(body) {
  const firstName = String(body.firstName || '').trim();
  const lastName = String(body.lastName || '').trim();
  const program = String(body.program || '').trim();
  const yearLevel = String(body.yearLevel || '').trim();
  const birthday = body.birthday || null;
  if ('phone' in body || 'age' in body) throw new HttpError(400, 'Students manage their own phone. Use birthday, not age, for student records.');
  if (!firstName || firstName.length > 80 || !lastName || lastName.length > 80) throw new HttpError(400, 'Enter the student’s first and last name.');
  if ((!body.id || birthday) && !validBirthday(birthday)) throw new HttpError(400, 'Enter a valid birthday for a student aged 15–100. Existing records may keep an unknown birthday blank.');
  if (!program || program.length > 160 || !yearLevel || yearLevel.length > 40) throw new HttpError(400, 'Enter the program and year level.');
  return {
    email: normalizeEmail(body.email),
    firstName,
    lastName,
    birthday,
    program,
    yearLevel
  };
}

export default async function handler(request) {
  try {
    if (request.method === 'GET') {
      await requireAdmin(request);
      const params = new URL(request.url).searchParams;
      if (params.has('id')) {
        if (!/^[0-9a-f-]{36}$/i.test(params.get('id'))) throw new HttpError(400,'Student record is invalid.');
        const rows=await supabase(`admin_student_security?${query({select:'*',id:`eq.${params.get('id')}`,limit:1})}`);
        if (!rows.length) throw new HttpError(404,'Student record not found.');
        return json({student:rows[0]});
      }
      const result=await supabase('rpc/admin_student_directory',{method:'POST',body:JSON.stringify({
        p_search:(params.get('search') || '').trim().slice(0,100),p_filter:params.get('filter') || '',
        p_page:Math.max(1,Math.min(Number.parseInt(params.get('page'),10)||1,100000))})});
      return json({ ...result, refreshedAt: new Date().toISOString() });
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
        result = await supabase('rpc/admin_create_student_v2', {
          method: 'POST',
          body: JSON.stringify({
            p_student_number: studentNumber,
            p_email: profile.email,
            p_first_name: profile.firstName,
            p_last_name: profile.lastName,
            p_birth_date: profile.birthday,
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
      if (!Number.isSafeInteger(body.recordVersion) || body.recordVersion<1) throw new HttpError(400,'Reload this student before saving.');
      if (typeof body.active !== 'boolean') throw new HttpError(400, 'Student status must be active or inactive.');
      const active = body.active;
      let rows;
      try {
        rows = await update(
          'demo_students',
          { id: `eq.${body.id}`, record_version: `eq.${body.recordVersion}` },
          {
            email: profile.email,
            first_name: profile.firstName,
            last_name: profile.lastName,
            birth_date: profile.birthday,
            ...(profile.birthday ? {age:ageFromBirthday(profile.birthday)} : {}),
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
      if (!rows.length) throw new HttpError(409, 'This record changed while you were editing. Close and reopen it to review the latest details.');
      await insert(
        'admin_audit_events',
        {
          admin_id: admin.id,
          event_type: active ? 'student_profile_updated' : 'student_deactivated',
          target_student_id: body.id,
          details: {
            fields: ['email', 'name', 'birth_date', 'program', 'year_level', 'active']
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
