import { assertPost, handleError, HttpError, json, readJson } from '../_shared/http.mjs';
import { adminRead, requireAdmin, requireCsrf } from '../_shared/admin-session.mjs';
import { rpc } from '../_shared/supabase.mjs';

export default async function adminRecovery(request) {
  try {
    if (request.method==='GET') {
      const params=new URL(request.url).searchParams;
      const id=params.get('id');
      if (id) {
        if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400,'Invalid request.');
        const { data, ...meta } = await adminRead(request,'recovery_request',{id},'Request not found.');
        return json({...meta,...data});
      }
      const status=params.get('status') || 'open';
      const page=Math.max(1,Math.min(Number.parseInt(params.get('page'),10)||1,100000));
      const number=(params.get('number') || '').trim();
      if (number && !/^\d{7}$/.test(number)) throw new HttpError(400,'Search by a complete seven-digit student number.');
      if (!['all','open','pending','reviewing','resolved','declined'].includes(status)) throw new HttpError(400,'Choose a supported request status.');
      const { data, ...meta } = await adminRead(request,'recovery_queue',{status,number,page});
      return json({...meta,...data});
    }
    const {admin,session}=await requireAdmin(request,['super_admin']);
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
