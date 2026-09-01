import { assertPost, handleError, json } from './_shared/http.mjs';
import { clearSessionCookie } from './_shared/session.mjs';

export default async function handler(request) {
  try {
    assertPost(request);
    return json({ message: 'Signed out successfully.' }, 200, { 'Set-Cookie': clearSessionCookie() });
  } catch (error) { return handleError(error); }
}
