import { assertPost, handleError, json } from '../_shared/http.mjs';
import { rpc } from '../_shared/supabase.mjs';
import { clearSessionCookie, readSession } from '../_shared/session.mjs';

export default async function logout(request) {
  try {
    assertPost(request);
    const session = readSession(request);
    // Raising the session version ends this cookie and any copy of it.
    if (session) {
      await rpc('student_sign_out', { p_sid: session.sid, p_version: session.pv, p_session: session.sv })
        .catch(() => console.error('Student sign-out could not be recorded.'));
    }
    return json({ message: 'Signed out successfully.' }, 200, { 'Set-Cookie': clearSessionCookie() });
  } catch (error) { return handleError(error); }
}
