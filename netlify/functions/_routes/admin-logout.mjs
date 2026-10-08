import { assertPost, handleError, json } from '../_shared/http.mjs';
import { clearAdminCookie, readAdminSession } from '../_shared/admin-session.mjs';
import { rpc } from '../_shared/supabase.mjs';

export default async function adminLogout(request) {
  try {
    assertPost(request);
    const session = readAdminSession(request);
    // Ends this administrator session everywhere and records the sign-out.
    if (session) {
      await rpc('admin_sign_out', { p_admin: session.aid, p_version: session.pv, p_session: session.sv })
        .catch(() => console.error('Administrator sign-out could not be recorded.'));
    }
    return json({ message: 'Administrator signed out.' }, 200, { 'Set-Cookie': clearAdminCookie() });
  } catch (error) { return handleError(error); }
}
