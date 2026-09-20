import { handleError, HttpError, json } from './_shared/http.mjs';
import { requireAdmin } from './_shared/admin-session.mjs';
import { rpc } from './_shared/recovery.mjs';

export default async function handler(request) {
  try {
    if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
    await requireAdmin(request);
    const [metrics, activity] = await Promise.all([rpc('admin_security_summary',{}),rpc('admin_security_events',{p_search:'',p_category:'',p_page:1})]);
    return json({
      metrics,
      recent: activity.events.slice(0,8),
      refreshedAt: new Date().toISOString()
    });
  } catch (error) {
    return handleError(error);
  }
}
