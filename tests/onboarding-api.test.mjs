import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { citext } from '@electric-sql/pglite/contrib/citext';
import students from '../netlify/functions/admin-students.mjs';
import dashboard from '../netlify/functions/admin-dashboard.mjs';
import audit from '../netlify/functions/admin-audit.mjs';
import setup from '../netlify/functions/complete-first-login.mjs';
import settings from '../netlify/functions/security-settings.mjs';
import profile from '../netlify/functions/profile.mjs';
import issue from '../netlify/functions/admin-issue-temporary-password.mjs';
import reset from '../netlify/functions/admin-send-reset.mjs';
import { createAdminSession, adminCookie } from '../netlify/functions/_shared/admin-session.mjs';
import { createSession, sessionCookie } from '../netlify/functions/_shared/session.mjs';
import { totp } from '../netlify/functions/_shared/recovery.mjs';

test('administrator invitation to student-owned onboarding works through actual HTTP handlers and PostgreSQL',async(t)=>{
 Object.assign(process.env,{APP_PEPPER:'test-onboarding-pepper-only-1234567890',SUPABASE_URL:'https://database.example.invalid',SUPABASE_SECRET_KEY:'sb_secret_test',SITE_URL:'https://portal.example.invalid',RESEND_API_KEY:'test',SMS_PROVIDER:'unisms',UNISMS_API_KEY:'test',UNISMS_SENDER_ID:'test',UNISMS_TRIAL_MODE:'false'});
 const db=new PGlite({extensions:{pgcrypto,citext}});const emails=[];let sentCode='',smsCount=0,failEmail=false;
 try {
  await db.exec('create role anon; create role authenticated; create role service_role; create schema extensions; create publication supabase_realtime;');
  for(const file of ['setup/01-core-schema.sql','setup/02-administrator-schema.sql','migrations/20260905071805_resumable_otp_delivery.sql','migrations/20260917090000_alternate_recovery.sql','migrations/20260920090000_student_owned_onboarding.sql'])await db.exec(await readFile(new URL('../supabase/'+file,import.meta.url),'utf8'));
  t.mock.method(globalThis,'fetch',async(url,options={})=>{
   const parsed=new URL(url),body=options.body?JSON.parse(options.body):{};
   if(parsed.hostname==='api.resend.com'){if(failEmail)return Response.json({message:'test delivery failure'},{status:503});emails.push(body);return Response.json({id:'synthetic-email'});}
   if(parsed.hostname==='unismsapi.com'){smsCount++;sentCode=body.content.match(/\b\d{6}\b/)[0];return Response.json({message:{reference_id:'synthetic-sms',status:'queued'}});}
   assert.equal(parsed.hostname,'database.example.invalid');
   try {
    const path=parsed.pathname.replace('/rest/v1/','');
    if(path.startsWith('rpc/')) {
     const name=path.slice(4);assert.match(name,/^[a-z_0-9]+$/);
     const entries=Object.entries(body);entries.forEach(([key])=>assert.match(key,/^[a-z_]+$/));
     const args=entries.map(([,v])=>v!==null&&typeof v==='object'?JSON.stringify(v):v);
     const call=name+'('+entries.map(([key],i)=>key+'=> $'+(i+1)).join(',')+')';
     if(['admin_create_student_v2','complete_student_onboarding','reissue_student_invitation'].includes(name))return Response.json((await db.query('select * from '+call,args)).rows);
     return Response.json((await db.query('select '+call+' as result',args)).rows[0].result);
    }
    assert.ok(['admin_accounts','demo_students','admin_student_security','student_recovery','audit_events','admin_audit_events','reset_tokens'].includes(path));
    const params=parsed.searchParams,select=params.get('select')||'*';assert.match(select,/^[a-z_,*]+$/);
    const values=[],clauses=[];
    for(const [key,value]of params){if(['select','order','limit'].includes(key))continue;assert.match(key,/^[a-z_]+$/);assert.ok(value.startsWith('eq.'));values.push(value.slice(3));clauses.push(key+'=$'+values.length);}
    let sql;
    if(options.method==='POST'){
     const entries=Object.entries(body);entries.forEach(([k])=>assert.match(k,/^[a-z_]+$/));
     values.push(...entries.map(([,v])=>v&&typeof v==='object'?JSON.stringify(v):v));
     sql=`insert into ${path}(${entries.map(([k])=>k)}) values(${entries.map((_,i)=>'$'+(i+1))}) returning ${select}`;
    }else if(options.method==='PATCH'){
     const assignments=Object.entries(body).map(([k,v])=>{assert.match(k,/^[a-z_]+$/);values.push(v);return k+'=$'+values.length;});
     sql=`update ${path} set ${assignments} where ${clauses.join(' and ')} returning ${select}`;
    }else sql=`select ${select} from ${path}${clauses.length?' where '+clauses.join(' and '):''} limit ${Math.min(Number(params.get('limit')||100),100)}`;
    const rows=(await db.query(sql,values)).rows;
    rows.forEach(r=>{if(r.birth_date instanceof Date)r.birth_date=r.birth_date.toISOString().slice(0,10);});
    return Response.json(rows);
   }catch(error){return Response.json({message:error.message},{status:400});}
  });
  const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
  const a=await one("insert into admin_accounts(email,display_name,password_hash) values('admin@example.invalid','Test Admin','unused') returning *");
  a.password_changed_at=a.password_changed_at.toISOString();
  const session=createAdminSession(a),cookie=adminCookie(session.token).split(';')[0];
  const call=async(handler,{method='GET',body,auth=cookie,csrf=session.csrf,path='/function'}={})=>{
   const response=await handler(new Request('https://portal.example.invalid'+path,{method,headers:{Cookie:auth,Origin:'https://portal.example.invalid','Content-Type':'application/json','X-Admin-CSRF':csrf},...(body?{body:JSON.stringify(body)}:{})}));
   return {http:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
  };
  assert.equal((await call(students,{auth:''})).http,401);
  const payload={studentNumber:'7654321',email:'student@example.invalid',firstName:'New',lastName:'Student',birthday:'2004-03-15',program:'BS Information Technology',yearLevel:'1st Year'};
  assert.equal((await call(students,{method:'POST',body:{...payload,phone:'+639000000000'}})).http,400);
  assert.equal((await call(students,{method:'POST',body:payload,csrf:''})).http,403);
  const created=await call(students,{method:'POST',body:payload});assert.equal(created.http,201);assert.equal(created.data.emailSent,true);
  assert.equal(emails.length,1);assert.match(emails[0].text,/Temporary password:/);
  assert.equal(JSON.stringify(created.data).includes('Temporary password:'),false);
  const sid=created.data.student.id;
  const stored=await one('select * from demo_students where id=$1',[sid]);assert.equal(stored.phone,'');
  const student={id:sid,password_changed_at:stored.password_changed_at.toISOString()};
  let studentCookie=sessionCookie(createSession(student,{setupOnly:true})).split(';')[0];
  assert.equal((await call(profile,{auth:studentCookie})).http,401);
  assert.equal((await call(setup,{method:'POST',auth:studentCookie,body:{password:'Personal!Password123'}})).http,400);
  const completed=await call(setup,{method:'POST',auth:studentCookie,body:{password:'Personal!Password123',termsAccepted:true,privacyAccepted:true,policyVersion:'2026-09-20'}});
  assert.equal(completed.http,200);studentCookie=completed.cookie.split(';')[0];
  assert.equal((await call(profile,{auth:studentCookie})).data.code,'AUTHENTICATOR_SETUP_REQUIRED');
  const begun=await call(settings,{method:'POST',auth:studentCookie,body:{action:'begin',password:'Personal!Password123'}});
  assert.equal(begun.http,200);const step=Math.floor(Date.now()/30000);
  const confirmed=await call(settings,{method:'POST',auth:studentCookie,body:{action:'confirm',password:'Personal!Password123',code:totp(begun.data.secret,step)}});
  assert.equal(confirmed.data.codes.length,10);
  assert.equal((await call(profile,{auth:studentCookie})).http,200);
  const listed=await call(students);assert.equal(listed.data.students[0].security_status,'ready');
  assert.equal(listed.data.students[0].phone,undefined);assert.equal(listed.data.students[0].birth_date,undefined);
  assert.equal((await call(dashboard)).data.metrics.ready,1);
  assert.ok((await call(audit)).data.events.some(e=>e.event_type==='policies_accepted'));
  assert.equal((await call(issue,{method:'POST',body:{studentId:sid}})).http,409);
  assert.equal((await call(reset,{method:'POST',body:{studentId:sid}})).http,409,'No unusable email + SMS link for an account without a phone');
  const phoneBody={action:'phone_start',password:'Personal!Password123',phone:'09000000000',code:totp(begun.data.secret,step+1)};
  const sms=await call(settings,{method:'POST',auth:studentCookie,body:phoneBody});assert.equal(sms.http,200);assert.equal(smsCount,1);
  assert.equal((await call(settings,{method:'POST',auth:studentCookie,body:phoneBody})).http,429);assert.equal(smsCount,1,'Double-send request is rejected before provider call');
  assert.equal((await call(settings,{method:'POST',auth:studentCookie,body:{action:'phone_confirm',password:'Personal!Password123',code:sentCode}})).http,200);
  assert.equal((await call(dashboard)).data.metrics.phones,1);
  const detail=(await call(students,{path:'/function?id='+sid})).data.student;
  assert.equal(detail.phone_verified,true);assert.equal(detail.phone,undefined);assert.equal(detail.birth_date,'2004-03-15');
  const edited={...payload,id:sid,recordVersion:detail.record_version,active:true,lastName:'Updated'};
  assert.equal((await call(students,{method:'PATCH',body:edited})).http,200);
  assert.equal((await call(students,{method:'PATCH',body:edited})).http,409,'Stale edits do not overwrite');
  const viewer=await one("insert into admin_accounts(email,display_name,password_hash,role) values('viewer@example.invalid','Viewer','unused','viewer') returning *");
  viewer.password_changed_at=viewer.password_changed_at.toISOString();const viewSession=createAdminSession(viewer),viewCookie=adminCookie(viewSession.token).split(';')[0];
  assert.equal((await call(students,{auth:viewCookie})).http,200);
  assert.equal((await call(students,{method:'POST',auth:viewCookie,csrf:viewSession.csrf,body:{...payload,studentNumber:'7654322',email:'second@example.invalid'}})).http,403);
  failEmail=true;
  const failedInvitation=await call(students,{method:'POST',body:{...payload,studentNumber:'7654322',email:'second@example.invalid'}});
  assert.equal(failedInvitation.http,201);assert.equal(failedInvitation.data.emailSent,false,'Account creation is distinct from email delivery');
  assert.equal((await call(students,{method:'POST',body:payload})).http,409,'Duplicate save never creates a second account');
  // Existing/migrated students acknowledge policies before the portal or changes.
  await db.query('update demo_students set terms_version=null,privacy_version=null where id=$1',[sid]);
  assert.equal((await call(profile,{auth:studentCookie})).data.code,'POLICIES_REQUIRED');
  assert.equal((await call(settings,{method:'POST',auth:studentCookie,body:{action:'codes',password:'Personal!Password123'}})).http,403);
  assert.equal((await call(settings,{method:'POST',auth:studentCookie,body:{action:'accept_policies',termsAccepted:true,privacyAccepted:true,policyVersion:'2026-09-20'}})).http,200);
  assert.equal((await call(profile,{auth:studentCookie})).http,200);
 } finally {await db.close();}
});
