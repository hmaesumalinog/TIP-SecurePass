import { handleError, HttpError, json } from './_shared/http.mjs';
import { requireAdmin } from './_shared/admin-session.mjs';

export default async function handler(request) {
  try {
    if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
    const { admin, session } = await requireAdmin(request);
    return json({ admin: { displayName: admin.display_name, email: admin.email, role: admin.role }, csrfToken: session.csrf });
  } catch (error) { return handleError(error); }
}
