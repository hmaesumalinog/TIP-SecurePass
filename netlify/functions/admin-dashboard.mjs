import { handleError, HttpError, json } from './_shared/http.mjs';
import { requireAdmin } from './_shared/admin-session.mjs';
import { query, supabase } from './_shared/supabase.mjs';

export default async function handler(request) {
  try {
    if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
    await requireAdmin(request);
    const [metricResult, events, adminEvents] = await Promise.all([
      supabase('rpc/security_dashboard_metrics', {
        method: 'POST',
        body: '{}'
      }),
      supabase(`audit_events?${query({ select: 'id,event_type,created_at,student_id', order: 'created_at.desc', limit: 80 })}`),
      supabase(`admin_audit_events?${query({ select: 'id,event_type,created_at,target_student_id', order: 'created_at.desc', limit: 20 })}`)
    ]);
    const metrics = Array.isArray(metricResult) ? metricResult[0] : metricResult;
    const recent = [...events.map((item) => ({ ...item, source: 'student' })), ...adminEvents.map((item) => ({ ...item, source: 'admin' }))].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 12);
    return json({
      metrics: {
        students: Number(metrics?.students || 0),
        active: Number(metrics?.active || 0),
        resets: Number(metrics?.resets || 0),
        failures: Number(metrics?.failures || 0)
      },
      recent,
      refreshedAt: new Date().toISOString()
    });
  } catch (error) {
    return handleError(error);
  }
}
