import { handleError, HttpError, json } from '../_shared/http.mjs';
import { adminRead } from '../_shared/admin-session.mjs';

export default async function adminDashboard(request) {
  try {
    if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
    const { data, ...meta } = await adminRead(request, 'dashboard');
    return json({ ...meta, metrics: data.metrics, recent: data.recent });
  } catch (error) {
    return handleError(error);
  }
}
