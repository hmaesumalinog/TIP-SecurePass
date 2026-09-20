import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { citext } from '@electric-sql/pglite/contrib/citext';
import settings from '../netlify/functions/security-settings.mjs';
import recovery from '../netlify/functions/alternate-recovery.mjs';
import adminRecovery from '../netlify/functions/admin-recovery.mjs';
import profile from '../netlify/functions/profile.mjs';
import { createSession, sessionCookie } from '../netlify/functions/_shared/session.mjs';
import { createAdminSession, adminCookie } from '../netlify/functions/_shared/admin-session.mjs';
import { totp } from '../netlify/functions/_shared/recovery.mjs';

test('HTTP recovery workflow integrates with PostgreSQL, mocked SMS/email only',async(t)=>{
  Object.assign(process.env,{APP_PEPPER:'test-only-pepper-for-integration-1234567890',SUPABASE_URL:'https://database.example.invalid',SUPABASE_SECRET_KEY:'sb_secret_test',SITE_URL:'https://portal.example.invalid',RESEND_API_KEY:'test',SMS_PROVIDER:'unisms',UNISMS_API_KEY:'test',UNISMS_SENDER_ID:'test',UNISMS_TRIAL_MODE:'false'});
  const db=new PGlite({extensions:{pgcrypto,citext}});let smsCode='',smsCount=0,emailCount=0;
  try {
    await db.exec('create role anon; create role authenticated; create role service_role; create schema extensions; create publication supabase_realtime;');
    for(const file of ['setup/01-core-schema.sql','setup/02-administrator-schema.sql','migrations/20260905071805_resumable_otp_delivery.sql','migrations/20260917090000_alternate_recovery.sql']) await db.exec(await readFile(new URL(`../supabase/${file}`,import.meta.url),'utf8'));
    t.mock.method(globalThis,'fetch',async(url,options={})=>{
      const parsed=new URL(url),body=options.body?JSON.parse(options.body):{};
      if(parsed.hostname==='api.resend.com'){emailCount++;return Response.json({id:'test-email'});}
      if(parsed.hostname==='unismsapi.com'){smsCount++;smsCode=body.content.match(/\b\d{6}\b/)[0];return Response.json({message:{reference_id:'test-sms',status:'queued'}});}
      assert.equal(parsed.hostname,'database.example.invalid');
      const path=parsed.pathname.replace('/rest/v1/','');
      try {
        if(path.startsWith('rpc/')){
          const name=path.slice(4);assert.match(name,/^[a-z_]+$/);
          const entries=Object.entries(body);entries.forEach(([key])=>assert.match(key,/^[a-z_]+$/));
          const sql=`select ${name}(${entries.map(([key],i)=>`${key} => $${i+1}`).join(',')}) as result`;
          const {rows}=await db.query(sql,entries.map(([,value])=>typeof value==='object' && value!==null?JSON.stringify(value):value));
          return Response.json(rows[0].result);
        }
        assert.ok(['demo_students','student_recovery','alternate_recovery','recovery_help_requests','admin_accounts','admin_audit_events'].includes(path));
        const params=parsed.searchParams;const select=params.get('select')||'*';assert.match(select,/^[a-z_,*]+$/);
        const values=[];const clauses=[];
        for(const [key,value] of params){if(['select','limit','order'].includes(key))continue;assert.match(key,/^[a-z_]+$/);assert.ok(value.startsWith('eq.'));values.push(value.slice(3));clauses.push(`${key}=$${values.length}`);}
        let sql;
        if(options.method==='POST'){
          const entries=Object.entries(body);entries.forEach(([key])=>assert.match(key,/^[a-z_]+$/));
          values.push(...entries.map(([,value])=>typeof value==='object'?JSON.stringify(value):value));
          sql=`insert into ${path}(${entries.map(([key])=>key).join(',')}) values(${entries.map((_,i)=>`$${i+1}`).join(',')}) returning ${select}`;
        }else if(options.method==='PATCH'){
          const assignments=Object.entries(body).map(([key,value])=>{assert.match(key,/^[a-z_]+$/);values.push(value);return `${key}=$${values.length}`;});
          sql=`update ${path} set ${assignments.join(',')} where ${clauses.join(' and ')} returning ${select}`;
        }else sql=`select ${select} from ${path}${clauses.length?' where '+clauses.join(' and '):''} limit ${Math.min(Number(params.get('limit')||100),100)}`;
        return Response.json((await db.query(sql,values)).rows);
      }catch(error){return Response.json({message:error.message},{status:400});}
    });
    const s=(await db.query("insert into demo_students(student_number,email,first_name,phone,password_hash,password_changed_at) values('7654333','synthetic@example.invalid','Synthetic','+639000000000',crypt('Original!Password123',gen_salt('bf',4)),now()) returning id,password_changed_at")).rows[0];
    s.password_changed_at=s.password_changed_at.toISOString();
    const cookie=sessionCookie(createSession(s)).split(';')[0];
    const call=async(handler,data,auth=cookie,extra={})=>{
      const response=await handler(new Request('https://portal.example.invalid/function',{method:data?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:auth,Origin:'https://portal.example.invalid',...extra},...(data?{body:JSON.stringify(data)}:{})}));
      return {status:response.status,...await response.json()};
    };
    assert.equal((await call(settings,null,'')).status,401);
    assert.equal((await call(profile,null,'')).status,401);
    const setupCookie=sessionCookie(createSession(s,{setupOnly:true})).split(';')[0];
    assert.equal((await call(profile,null,setupCookie)).status,401);
    const blocked=await call(profile,null);
    assert.equal(blocked.status,403);
    assert.equal(blocked.code,'AUTHENTICATOR_SETUP_REQUIRED');
    assert.equal(blocked.student,undefined,'Unenrolled student profile must not be disclosed');
    const maskedStatus=await call(settings,null);
    assert.equal(maskedStatus.maskedPhone,'+63 ••• ••• 0000');
    assert.equal(maskedStatus.phone,undefined,'Status never returns the full phone');
    assert.equal((await call(settings,{action:'begin',password:'Original!Password123'},cookie,{Origin:'https://attacker.invalid'})).status,403);
    const begin=await call(settings,{action:'begin',password:'Original!Password123'});
    assert.match(begin.qr,/^data:image\/png;base64,/);assert.match(begin.secret,/^[A-Z2-7]{32}$/);
    assert.equal((await call(profile,null)).status,403,'Pending enrollment is not confirmed enrollment');
    const step=Math.floor(Date.now()/30000);
    const enrolled=await call(settings,{action:'confirm',password:'Original!Password123',code:totp(begin.secret,step)});
    assert.equal(enrolled.codes.length,10);assert.equal(emailCount,1);
    const allowed=await call(profile,null);
    assert.equal(allowed.status,200);
    assert.equal(allowed.student.studentNumber,'7654333');
    assert.equal(allowed.secret,undefined);
    // A removed authenticator or SMS-only enrollment must require setup again.
    const confirmedSecret=(await db.query('select secret from student_recovery where student_id=$1',[s.id])).rows[0].secret;
    await db.query('update student_recovery set secret=null,phone_verified=$2 where student_id=$1',[s.id,'+639000000000']);
    assert.equal((await call(profile,null)).status,403,'Verified phone alone does not unlock the portal');
    await db.query('update student_recovery set secret=$2 where student_id=$1',[s.id,confirmedSecret]);
    assert.equal((await call(profile,null)).status,200);
    const start=await call(recovery,{action:'start',studentNumber:'7654333',backupCode:enrolled.codes[0],method:'authenticator'},'');
    assert.equal(start.token.length,43);
    // The enrollment step is already consumed; next adjacent valid time step is accepted once.
    assert.equal((await call(recovery,{action:'verify',token:start.token,code:totp(begin.secret,step)},'')).status,400);
    assert.equal((await call(recovery,{action:'verify',token:start.token,code:totp(begin.secret,step+1)},'')).status,200);
    assert.equal((await call(recovery,{action:'complete',token:start.token,password:'NewStrong!Password123'},'')).status,200);
    assert.equal((await call(recovery,{action:'complete',token:start.token,password:'NewStrong!Password123'},'')).status,400);
    assert.equal((await call(settings,null)).status,401);
    assert.equal((await call(profile,null)).status,401,'Password change revokes old profile sessions');
    assert.equal(smsCount,0);assert.equal(emailCount,2);
    const unknown=await call(recovery,{action:'start',studentNumber:'1111111',backupCode:'wrong',method:'authenticator'},'');
    assert.equal(unknown.message,start.message);assert.equal(unknown.token.length,start.token.length);
    // Phone enrollment and the SMS fallback use only the account's existing number.
    const changed=(await db.query('select id,password_changed_at from demo_students where id=$1',[s.id])).rows[0];
    changed.password_changed_at=changed.password_changed_at.toISOString();
    const newCookie=sessionCookie(createSession(changed)).split(';')[0];
    assert.equal((await call(settings,{action:'phone_start',password:'NewStrong!Password123'},newCookie)).status,'ok');
    assert.equal(smsCount,1);
    assert.equal((await call(settings,{action:'phone_confirm',password:'NewStrong!Password123',code:smsCode},newCookie)).status,'ok');
    await db.query("update alternate_recovery set created_at=now()-interval '61 seconds' where student_id=$1",[s.id]);
    const sms=await call(recovery,{action:'start',studentNumber:'7654333',backupCode:enrolled.codes[1],method:'sms'},'');
    assert.equal(smsCount,2);
    assert.equal((await call(recovery,{action:'verify',token:sms.token,code:smsCode},'')).status,200);
    // The revised management forms still require independent password and app proof.
    await db.query('update student_recovery set last_step=-1 where student_id=$1',[s.id]);
    const freshStep=Math.floor(Date.now()/30000);
    assert.equal((await call(settings,{action:'codes',password:'wrong',code:totp(begin.secret,freshStep)},newCookie)).status,400);
    const replacementCodes=await call(settings,{action:'codes',password:'NewStrong!Password123',code:totp(begin.secret,freshStep)},newCookie);
    assert.equal(replacementCodes.codes.length,10);
    assert.notDeepEqual(replacementCodes.codes,enrolled.codes);
    assert.equal((await call(settings,{action:'disable',password:'NewStrong!Password123',code:totp(begin.secret,freshStep)},newCookie)).status,400,'Same authenticator code cannot approve two security changes');
    assert.equal((await call(settings,{action:'disable',password:'NewStrong!Password123',code:totp(begin.secret,freshStep+1)},newCookie)).status,'ok');
    const removedStatus=await call(settings,null,newCookie);
    assert.equal(removedStatus.enabled,false);
    assert.equal(removedStatus.remaining,0);
    assert.equal((await call(profile,null,newCookie)).status,403,'Removal restores required enrollment');
    assert.equal((await call(recovery,{action:'help',studentNumber:'7654333',contact:'synthetic@example.invalid',message:'Synthetic test request only.'},'')).status,200);
    assert.equal((await call(adminRecovery,null,'')).status,401);
    const admin=(await db.query("insert into admin_accounts(email,display_name,password_hash) values('admin@example.invalid','Test administrator','unused') returning id,password_changed_at,role")).rows[0];admin.password_changed_at=admin.password_changed_at.toISOString();
    const adminSession=createAdminSession(admin),adminSessionCookie=adminCookie(adminSession.token).split(';')[0];
    const list=await call(adminRecovery,null,adminSessionCookie);assert.equal(list.requests.length,1);
    const review={id:list.requests[0].id,status:'reviewing',note:'Synthetic review; no access granted.'};
    assert.equal((await call(adminRecovery,review,adminSessionCookie)).status,403);
    assert.equal((await call(adminRecovery,review,adminSessionCookie,{'X-Admin-CSRF':adminSession.csrf})).status,200);
  }finally {await db.close();}
});
