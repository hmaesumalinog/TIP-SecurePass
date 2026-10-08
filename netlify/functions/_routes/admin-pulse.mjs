import { handleError, HttpError, json } from '../_shared/http.mjs';
import { adminRead } from '../_shared/admin-session.mjs';

// Tiny response that changes whenever an administrator view would change.
// Pages reload their full data only when this value differs.
export default async function adminPulse(request) {
  try {
    if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
    const { changeToken } = await adminRead(request, 'pulse');
    return json({ changeToken });
  } catch (error) { return handleError(error); }
}
