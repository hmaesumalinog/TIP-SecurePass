import { assertPost, handleError, json } from './_shared/http.mjs';
import { clearAdminCookie, readAdminSession } from './_shared/admin-session.mjs';
import { insert } from './_shared/supabase.mjs';

export default async function handler(request) {
  try {
    assertPost(request);
    const session = readAdminSession(request);
    if (session?.aid) await insert('admin_audit_events', { admin_id: session.aid, event_type: 'admin_logout', details: {} }, 'id');
    return json({ message: 'Administrator signed out.' }, 200, { 'Set-Cookie': clearAdminCookie() });
  } catch (error) { return handleError(error); }
}
