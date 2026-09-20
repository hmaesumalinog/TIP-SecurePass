import { assertPost, handleError, HttpError, json, readJson } from './_shared/http.mjs';
import { requireAdmin, requireCsrf } from './_shared/admin-session.mjs';
import { query, supabase } from './_shared/supabase.mjs';
import { rpc } from './_shared/recovery.mjs';

export default async function handler(request) {
  try {
    const {admin,session}=await requireAdmin(request,['super_admin']);
    if (request.method==='GET') {
      const params=new URL(request.url).searchParams;
      const id=params.get('id');
      if (id) {
        if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400,'Invalid request.');
        const rows=await supabase(`recovery_help_requests?${query({select:'id,student_number,contact,message,status,review_note,created_at,updated_at',id:`eq.${id}`,limit:1})}`);
        if (!rows.length) throw new HttpError(404,'Request not found.');
        const history=await supabase(`recovery_request_reviews?${query({select:'previous_status,status,note,created_at',request_id:`eq.${id}`,order:'created_at.asc',limit:100})}`);
        return json({request:rows[0],history});
      }
      const filter=params.get('status') || 'open';
      const page=Math.max(1,Math.min(Number.parseInt(params.get('page'),10)||1,100000));
      const number=(params.get('number') || '').trim();
      if (number && !/^\d{7}$/.test(number)) throw new HttpError(400,'Search by a complete seven-digit student number.');
      const filters={select:'id,student_number,status,created_at,updated_at',order:'created_at.desc,id',limit:21,offset:(page-1)*20};
      if (filter==='open') filters.status='in.(pending,reviewing)';
      else if (['pending','reviewing','resolved','declined'].includes(filter)) filters.status=`eq.${filter}`;
      if (number) filters.student_number=`eq.${number}`;
      const rows=await supabase(`recovery_help_requests?${query(filters)}`);
      return json({requests:rows.slice(0,20),hasMore:rows.length>20,page,refreshedAt:new Date().toISOString()});
    }
    assertPost(request); requireCsrf(request,session);
    const {id,status,note,expectedUpdatedAt,confirmed}=await readJson(request);
    if (!/^[0-9a-f-]{36}$/i.test(String(id)) || !['reviewing','resolved','declined'].includes(status) || typeof note!=='string' || note.trim().length<10 || note.length>1000) throw new HttpError(400,'Choose a status and provide a review note of 10–1000 characters.');
    if (!expectedUpdatedAt || !Number.isFinite(Date.parse(expectedUpdatedAt))) throw new HttpError(400,'Reload the request before saving.');
    if (status==='resolved' && confirmed!==true) throw new HttpError(400,'Confirm that the approved support process was completed separately.');
    const result=await rpc('review_recovery_request',{p_id:id,p_admin:admin.id,p_status:status,p_note:note.trim(),p_expected:expectedUpdatedAt});
    if (result.status==='missing') throw new HttpError(404,'Request not found.');
    if (result.status==='conflict') throw new HttpError(409,'Another administrator updated this request. Reopen it before saving.');
    if (result.status!=='ok') throw new HttpError(400,'Start a review before resolving. Closed requests cannot be edited.');
    return json({message:'Review saved. No password, factor, or contact information was changed.'});
  } catch(error) { return handleError(error); }
}
