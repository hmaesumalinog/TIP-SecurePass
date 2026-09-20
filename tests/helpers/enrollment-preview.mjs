// Local-only visual QA fixtures. No credentials, database, email, or SMS calls.
// Run: node tests/helpers/enrollment-preview.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import QRCode from 'qrcode';

const root=resolve('public');
let enabled=false,broken=false,logoutFails=false,phoneVerified=false,smsFailure=false,remaining=0,policiesAccepted=false;
const now=()=>new Date().toISOString();
const directory=Array.from({length:5},(_,i)=>({id:`00000000-0000-4000-8000-00000000000${i}`,student_number:`765432${i}`,email:`demo${i}@example.invalid`,first_name:['Alex','Casey','Jordan','Morgan','Riley'][i],last_name:'Test Student',birth_date:i?'2004-03-15':null,program:'Bachelor of Science in Information Technology',year_level:'3rd Year',active:i!==4,record_version:1,must_change_password:i===0,temporary_password_expires_at:now(),created_at:now(),authenticator_enabled:i===2||i===3,phone_verified:i===2,backup_codes_remaining:i===2?10:0,policies_accepted:i>1,policies_accepted_at:now(),invitation_expired:i===0,security_status:['invited','setup','ready','attention','inactive'][i]}));
const activity=['recovery_confirm','login_failed','policies_accepted','student_created','recovery_phone_confirm'].map((type,i)=>({id:`s-${i}`,event_type:type,created_at:now(),student_id:directory[i].id,student_number:directory[i].student_number,student_name:directory[i].first_name+' Test Student',actor:'Student / system',source:'student'}));
let requests=[{id:'00000000-0000-4000-8000-000000000099',student_number:'7654321',contact:'synthetic@example.invalid',message:'I changed phones and cannot access my authenticator. This is a synthetic local preview.',status:'pending',created_at:now(),updated_at:now(),history:[]}];
const previewCodes=()=>Array.from({length:10},(_,i)=>`PREVIEW-ONLY-NOT-VALID-CODE-${i+1}`);
const previewQr=await QRCode.toDataURL('LOCAL VISUAL TEST ONLY - NOT AN AUTHENTICATOR KEY');
const student={studentNumber:'7654321',firstName:'Demo',lastName:'Student',fullName:'Demo Student',email:'demo@example.invalid',phone:'+639000000000',age:21,program:'BS Information Technology',yearLevel:3};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:4175');
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  if(url.pathname==='/__migration') {
    const sql=await readFile(resolve('supabase/migrations/20260920090000_student_owned_onboarding.sql'),'utf8');
    res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});
    res.end('<h1>Reviewed local migration</h1><p>Source: 20260920090000_student_owned_onboarding.sql · no student records or credentials</p><textarea aria-label="Migration SQL" rows="30" cols="100">'+sql.replaceAll('&','&amp;').replaceAll('<','&lt;')+'</textarea>');return;
  }
  if(url.pathname==='/api/admin/session')return json({admin:{display_name:'Local Test Administrator',role:'super_admin'},csrfToken:'local-only-non-secret'});
  if(url.pathname==='/api/login')return json({requiresPasswordChange:true});
  if(url.pathname==='/api/complete-first-login'){
    let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);
    if(!input.termsAccepted||!input.privacyAccepted)return json({message:'Acknowledge both notices.'},400);
    policiesAccepted=true;enabled=false;remaining=0;return json({message:'Local-only setup completed.'});
  }
  if(url.pathname==='/api/admin/logout')return json({message:'Local preview signed out'});
  if(url.pathname==='/api/admin/dashboard')return json({metrics:{students:5,active:4,ready:1,setup:1,invited:1,pendingRequests:1,authenticators:2,phones:1,expired:1,attention:1,failures24h:1,resets7d:2},recent:activity,refreshedAt:now()});
  if(url.pathname==='/api/admin/audit'){
    const search=url.searchParams.get('search')?.toLowerCase()||'',category=url.searchParams.get('category');
    const events=activity.filter(e=>(!category||category===e.source)&&(!search||JSON.stringify(e).toLowerCase().includes(search)));
    return json({events,total:events.length,page:1,pageSize:25,refreshedAt:now()});
  }
  if(url.pathname==='/api/admin/students'){
    if(req.method==='GET'){
      if(url.searchParams.has('id'))return json({student:directory.find(s=>s.id===url.searchParams.get('id'))});
      const search=url.searchParams.get('search')?.toLowerCase()||'',filter=url.searchParams.get('filter');
      const students=directory.filter(s=>(!filter||filter===s.security_status)&&(!search||JSON.stringify(s).toLowerCase().includes(search)));
      return json({students,total:students.length,page:1,pageSize:20,refreshedAt:now()});
    }
    let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);
    if(req.method==='PATCH'){const s=directory.find(s=>s.id===input.id);Object.assign(s,{first_name:input.firstName,last_name:input.lastName,birth_date:input.birthday,record_version:s.record_version+1});}
    else directory.push({...directory[0],id:'00000000-0000-4000-8000-000000000088',student_number:input.studentNumber,first_name:input.firstName,last_name:input.lastName,email:input.email,birth_date:input.birthday});
    return json({message:'Saved in local preview only. No email was sent.',emailSent:true},req.method==='POST'?201:200);
  }
  if(url.pathname==='/.netlify/functions/admin-recovery'){
    if(req.method==='GET'){
      if(url.searchParams.has('id')){const r=requests.find(r=>r.id===url.searchParams.get('id'));return json({request:r,history:r.history});}
      const status=url.searchParams.get('status')||'open',number=url.searchParams.get('number');
      return json({requests:requests.filter(r=>(!number||number===r.student_number)&&(status==='all'||status==='open'&&['pending','reviewing'].includes(r.status)||status===r.status)),hasMore:false,page:1,refreshedAt:now()});
    }
    let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body),r=requests.find(r=>r.id===input.id);
    r.history.push({status:input.status,note:input.note,created_at:now()});r.status=input.status;r.updated_at=now();return json({message:'Local review saved. No account access changed.'});
  }
  if(url.pathname==='/__fixtures'){
    res.writeHead(200,{'Content-Type':'text/html'});
    res.end('<h1>Local-only enrollment QA</h1><p>No real accounts or providers are connected. Use any password except wrong; code 123456.</p><a href="/__fixture/new">New student setup</a><br><a href="/__fixture/existing">Existing unenrolled student</a><br><a href="/__fixture/enrolled">Enrolled student</a><br><a href="/__fixture/error">Database error</a><br><a href="/__fixture/logout-error">Sign-out error</a><br><a href="/__fixture/sms-error">SMS provider error</a><br><a href="/__fixture/empty-codes">No backup codes left</a>');return;
  }
  if(url.pathname.startsWith('/__fixture/')){
    const mode=url.pathname.split('/').pop();enabled=['enrolled','sms-error','empty-codes'].includes(mode);policiesAccepted=mode!=='existing';broken=mode==='error';logoutFails=mode==='logout-error';smsFailure=mode==='sms-error';phoneVerified=false;remaining=enabled&&mode!=='empty-codes'?10:0;
    res.writeHead(302,{Location:mode==='existing'?'/portal.html':'/security.html?onboarding=1'});res.end();return;
  }
  if(url.pathname==='/api/profile'){
    if(broken)return json({message:'Security settings could not be loaded. Refresh to retry.'},503);
    if(!policiesAccepted)return json({code:'POLICIES_REQUIRED',message:'Review policies'},403);
    return enabled?json({student}):json({code:'AUTHENTICATOR_SETUP_REQUIRED',message:'Set up authenticator'},403);
  }
  if(url.pathname==='/api/logout') return json({message:logoutFails?'Try again':'Signed out'},logoutFails?500:200);
  if(url.pathname==='/.netlify/functions/security-settings'){
    if(req.method==='GET')return broken?json({message:'Local test: settings unavailable. Use another fixture to restore.'},503):json({status:'ok',enabled,remaining,phoneVerified,maskedPhone:phoneVerified?'+63 ••• ••• 0000':null,policiesAccepted,policyVersion:'2026-09-20'});
    let body='';for await(const chunk of req)body+=chunk;
    const input=JSON.parse(body);
    if(input.action==='accept_policies'){policiesAccepted=true;return json({status:'ok'});}
    if(!input.password||input.password==='wrong')return json({message:'Could not verify this change. Check your current password and verification code.'},400);
    if(input.action==='begin')return json({message:'Local visual test only: enter 123456 to confirm.',secret:'LOCAL-PREVIEW-NOT-A-REAL-SETUP-KEY',qr:previewQr});
    if(input.action==='confirm'){
      if(input.code!=='123456')return json({message:'Could not verify this change. Check your verification code.'},400);
      enabled=true;remaining=10;return json({message:'Authenticator confirmed in local preview.',codes:previewCodes()});
    }
    if(input.action==='phone_start')return smsFailure?json({message:'SMS delivery could not be confirmed. If a code arrives, you can still enter it. Wait at least 60 seconds before trying again.'},502):json({message:'SMS sent in preview only.'});
    if(input.code!=='123456')return json({message:'Could not verify this change. Check the code and try again.'},400);
    if(input.action==='phone_confirm'){phoneVerified=true;return json({message:'Phone verified in preview.'});}
    if(input.action==='codes'){remaining=10;return json({message:'Replacement codes in preview.',codes:previewCodes()});}
    if(input.action==='disable'){enabled=false;remaining=0;return json({message:'Removed in preview.'});}
    return json({message:'Not implemented in this visual fixture.'},400);
  }
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/.netlify/'))return json({message:'Local fixture does not call production.'},404);
  const path=resolve(root,`.${url.pathname==='/'?'/index.html':url.pathname}`);
  if(!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}
  try{
    const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
    const content=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});res.end(content);
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(4175,'127.0.0.1',()=>console.log('Local-only QA: http://127.0.0.1:4175/__fixtures'));
