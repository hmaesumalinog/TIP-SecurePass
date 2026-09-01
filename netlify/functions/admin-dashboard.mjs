import { handleError, HttpError, json } from './_shared/http.mjs';
import { requireAdmin } from './_shared/admin-session.mjs';
import { query, supabase } from './_shared/supabase.mjs';

export default async function handler(request) {
  try {
    if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
    await requireAdmin(request);
    const [students, events, adminEvents] = await Promise.all([
      supabase(`demo_students?${query({ select: 'id,active' })}`),
      supabase(`audit_events?${query({ select: 'id,event_type,created_at,student_id', order: 'created_at.desc', limit: 80 })}`),
      supabase(`admin_audit_events?${query({ select: 'id,event_type,created_at,target_student_id', order: 'created_at.desc', limit: 20 })}`)
    ]);
    const recent = [...events.map((item) => ({ ...item, source: 'student' })), ...adminEvents.map((item) => ({ ...item, source: 'admin' }))].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 12);
    return json({
      metrics: {
        students: students.length,
        active: students.filter((student) => student.active).length,
        resets: events.filter((event) => event.event_type === 'password_reset_completed').length,
        failures: events.filter((event) => event.event_type === 'login_failed').length
      },
      recent,
      refreshedAt: new Date().toISOString()
    });
  } catch (error) { return handleError(error); }
}
