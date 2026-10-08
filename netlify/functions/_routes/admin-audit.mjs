import { handleError, HttpError, json } from '../_shared/http.mjs';
import { adminRead } from '../_shared/admin-session.mjs';

export default async function adminAudit(request) {
  try {
    if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
    const params = new URL(request.url).searchParams;
    const { data, ...meta } = await adminRead(request, 'audit', {
      search: (params.get('search') || '').trim().slice(0, 100),
      category: params.get('category') || '',
      page: Math.max(1, Math.min(Number.parseInt(params.get('page'), 10) || 1, 100000))
    });
    return json({ ...meta, ...data });
  } catch (error) { return handleError(error); }
}
