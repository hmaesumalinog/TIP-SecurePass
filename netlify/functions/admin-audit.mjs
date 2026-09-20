import { handleError, HttpError, json } from './_shared/http.mjs';
import { requireAdmin } from './_shared/admin-session.mjs';
import { rpc } from './_shared/recovery.mjs';

export default async function handler(request) {
  try {
    if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
    await requireAdmin(request);
    const params=new URL(request.url).searchParams;
    const result=await rpc('admin_security_events',{p_search:(params.get('search') || '').trim().slice(0,100),
      p_category:params.get('category') || '',p_page:Math.max(1,Math.min(Number.parseInt(params.get('page'),10)||1,100000))});
    return json({...result,refreshedAt:new Date().toISOString()});
  } catch (error) { return handleError(error); }
}
