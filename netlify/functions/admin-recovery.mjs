import { assertPost, handleError, HttpError, json, readJson } from './_shared/http.mjs';
import { requireAdmin, requireCsrf } from './_shared/admin-session.mjs';
import { insert, query, supabase, update } from './_shared/supabase.mjs';

export default async function handler(request) {
  try {
    const {admin,session}=await requireAdmin(request,['super_admin']);
    if (request.method==='GET') return json({requests:await supabase(`recovery_help_requests?${query({select:'id,student_number,contact,message,status,review_note,created_at',order:'created_at.desc',limit:100})}`)});
    assertPost(request); requireCsrf(request,session);
    const {id,status,note}=await readJson(request);
    if (!/^[0-9a-f-]{36}$/i.test(String(id)) || !['reviewing','resolved','declined'].includes(status) || typeof note!=='string' || note.trim().length<10 || note.length>1000) throw new HttpError(400,'Choose a status and provide a review note of 10–1000 characters.');
    const rows=await update('recovery_help_requests',{id:`eq.${id}`},{status,review_note:note.trim(),reviewed_by:admin.id,updated_at:new Date().toISOString()});
    if (!rows?.length) throw new HttpError(404,'Request not found.');
    await insert('admin_audit_events',{admin_id:admin.id,event_type:'recovery_request_reviewed',details:{request_id:id,status}},'id');
    return json({message:'Review saved. No password, factor, or contact information was changed.'});
  } catch(error) { return handleError(error); }
}
