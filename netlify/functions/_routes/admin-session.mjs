import { handleError, HttpError, json } from '../_shared/http.mjs';
import { adminRead } from '../_shared/admin-session.mjs';

export default async function adminSession(request) {
  try {
    if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
    const { admin, csrfToken } = await adminRead(request, 'session');
    return json({ admin, csrfToken });
  } catch (error) { return handleError(error); }
}
