import { handleError, HttpError, json } from './_shared/http.mjs';
import { requireAdmin } from './_shared/admin-session.mjs';
import { query, supabase } from './_shared/supabase.mjs';

export default async function handler(request) {
  try {
    if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
    await requireAdmin(request);
    const [studentEvents, adminEvents] = await Promise.all([
      supabase(`audit_events?${query({ select: 'id,event_type,created_at,student_id,details', order: 'created_at.desc', limit: 100 })}`),
      supabase(`admin_audit_events?${query({ select: 'id,event_type,created_at,target_student_id,details', order: 'created_at.desc', limit: 100 })}`)
    ]);
    const events = [...studentEvents.map((event) => ({ ...event, category: 'Student security' })), ...adminEvents.map((event) => ({ ...event, student_id: event.target_student_id, category: 'Administration' }))].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 150);
    return json({ events, refreshedAt: new Date().toISOString() });
  } catch (error) { return handleError(error); }
}
