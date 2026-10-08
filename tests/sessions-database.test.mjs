import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from './helpers/database.mjs';

// Database behaviour added by the October sessions-and-round-trips migration.
test('sign-in is constant-work, sessions are revocable, and admin reads are single round trips',async()=>{
  const db=await createDatabase();
  try {
    const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
    const rpc=async(sql,args=[])=>(await one('select '+sql+' as result',args)).result;
    const s=await one("insert into demo_students(student_number,email,first_name,last_name,phone,password_hash,password_changed_at,terms_version,privacy_version) values('7654321','test@example.invalid','Test','Student','',crypt('Correct!Password1',gen_salt('bf',4)),now(),'2026-09-20','2026-09-20') returning id,password_changed_at,session_version");
    const version=s.password_changed_at.toISOString();
    const hash='a'.repeat(64),ip='b'.repeat(64);
    const reserve=async(id=hash)=>rpc("reserve_access_attempt('student',$1,$2)",[id,ip]);

    // Unknown accounts still run one bcrypt comparison (constant work).
    const unknown=await rpc('student_sign_in_finish($1,$2,$3,$4)',[await reserve('c'.repeat(64)),'7000000','Wrong!Password1','c'.repeat(64)]);
    assert.equal(unknown.status,'invalid');
    const wrong=await rpc('student_sign_in_finish($1,$2,$3,$4)',[await reserve(),'7654321','Wrong!Password1',hash]);
    assert.equal(wrong.status,'invalid');
    assert.equal((await one("select count(*)::int as n from audit_events where event_type='login_failed'")).n,2);
    const ok=await rpc('student_sign_in_finish($1,$2,$3,$4)',[await reserve(),'7654321','Correct!Password1',hash]);
    assert.equal(ok.status,'ok');assert.equal(ok.student.session_version,0);assert.equal(ok.student.password_hash,undefined);
    await assert.rejects(rpc('student_sign_in_finish($1,$2,$3,$4)',[999999,'7654321','Correct!Password1',hash]),/reservation/,
      'A forged or unknown reservation cannot skip the rate limit');
    const timing=[];
    for(const number of ['7654321','7000000']){const t0=performance.now();await rpc('student_sign_in_finish($1,$2,$3,$4)',[await reserve('d'.repeat(64)),number,'Wrong!Password1','d'.repeat(64)]);timing.push(performance.now()-t0);}
    assert.ok(timing[1]>timing[0]*0.4,'Unknown accounts take comparable time: '+timing.map(Math.round).join('ms vs ')+'ms');

    // One call returns the session check, profile and recovery summary.
    const context=await rpc('student_context($1,$2,$3)',[s.id,version,0]);
    assert.equal(context.status,'ok');assert.equal(context.student.policies_accepted,true);
    assert.equal(context.recovery.enabled,false);assert.equal(context.recovery.setupCompleted,false);
    assert.equal(context.student.password_hash,undefined);
    assert.equal((await rpc('student_context($1,$2,$3)',[s.id,version,1])).status,'unauthorized','Wrong session version');
    assert.equal((await rpc('student_context($1,$2,$3)',[s.id,'2000-01-01',0])).status,'unauthorized','Old password version');
    const limited=[];for(let i=0;i<3;i++)limited.push((await rpc('student_context($1,$2,$3,$4)',[s.id,version,0,JSON.stringify([{key:'rate-test',limit:2}])])).status);
    assert.deepEqual(limited,['ok','ok','limited']);

    // Signing out revokes every copy of the session, without a profile edit.
    const record=(await one('select record_version from demo_students where id=$1',[s.id])).record_version;
    assert.equal(await rpc('student_sign_out($1,$2,$3)',[s.id,version,0]),true);
    assert.equal(await rpc('student_sign_out($1,$2,$3)',[s.id,version,0]),false,'An already revoked session cannot sign out again');
    assert.equal((await rpc('student_context($1,$2,$3)',[s.id,version,0])).status,'unauthorized');
    assert.equal((await one('select record_version from demo_students where id=$1',[s.id])).record_version,record);
    await db.query("update demo_students set program='Changed' where id=$1",[s.id]);
    assert.equal((await one('select record_version from demo_students where id=$1',[s.id])).record_version,record+1,'Real edits still bump the version');

    // Administrators: constant-work sign-in, one-call verification, revocable sessions.
    const admin=await one("insert into admin_accounts(email,display_name,password_hash,role) values('admin@example.invalid','Admin',crypt('Admin!Password1',gen_salt('bf',4)),'viewer') returning id,password_changed_at");
    const aversion=admin.password_changed_at.toISOString();
    const reserveAdmin=async()=>rpc("reserve_access_attempt('admin',$1,$2)",['e'.repeat(64),ip]);
    assert.equal((await rpc('admin_sign_in_finish($1,$2,$3,$4,$5)',[await reserveAdmin(),'nobody@example.invalid','x','e'.repeat(64),'f'.repeat(64)])).status,'invalid');
    const started=await rpc('admin_sign_in_finish($1,$2,$3,$4,$5)',[await reserveAdmin(),'ADMIN@example.invalid','Admin!Password1','e'.repeat(64),'f'.repeat(64)]);
    assert.equal(started.status,'ok');
    assert.equal((await rpc('admin_sign_in_verify($1,$2)',[started.challenge_id,'0'.repeat(64)])).status,'incorrect');
    const verified=await rpc('admin_sign_in_verify($1,$2)',[started.challenge_id,'f'.repeat(64)]);
    assert.equal(verified.status,'verified');assert.equal(verified.admin.session_version,0);
    assert.equal((await rpc('admin_sign_in_verify($1,$2)',[started.challenge_id,'f'.repeat(64)])).status,'invalid','Codes are single use');
    const read=await rpc('admin_read($1,$2,$3,$4,$5)',[admin.id,aversion,0,'dashboard','{}']);
    assert.equal(read.status,'ok');assert.equal(read.admin.role,'viewer');assert.ok(read.data.metrics);assert.match(read.token,/^\d+:\d+:\d+:\d+$/);
    assert.equal((await rpc('admin_read($1,$2,$3,$4,$5)',[admin.id,aversion,0,'recovery_queue','{}'])).status,'forbidden','Viewers cannot read recovery requests');
    assert.equal((await rpc('admin_read($1,$2,$3,$4,$5)',[admin.id,aversion,0,'student',JSON.stringify({id:s.id})])).data.student.student_number,'7654321');
    assert.equal((await rpc('admin_read($1,$2,$3,$4,$5)',[admin.id,aversion,0,'student',JSON.stringify({id:'00000000-0000-4000-8000-000000000000'})])).status,'missing');
    const token=(await rpc('admin_read($1,$2,$3,$4,$5)',[admin.id,aversion,0,'pulse','{}'])).token;
    await db.query("insert into recovery_help_requests(student_number,contact,message) values('7654321','contact@example.invalid','Please help me recover')");
    assert.notEqual((await rpc('admin_read($1,$2,$3,$4,$5)',[admin.id,aversion,0,'pulse','{}'])).token,token,'New support requests change the token');
    assert.equal(await rpc('admin_sign_out($1,$2,$3)',[admin.id,aversion,0]),true);
    assert.equal((await rpc('admin_read($1,$2,$3,$4,$5)',[admin.id,aversion,0,'pulse','{}'])).status,'unauthorized');

    // Forgot password: eligibility is decided after the generic response.
    assert.equal((await rpc('prepare_password_reset($1,$2)',['missing@example.invalid','1'.repeat(64)])).kind,'none');
    const options=await rpc('prepare_password_reset($1,$2)',['TEST@example.invalid','2'.repeat(64)]);
    assert.equal(options.kind,'options');assert.equal(options.invited,false);
    assert.equal((await one('select count(*)::int as n from reset_tokens')).n,0,'No reset link without a verified phone');
    await db.query("update demo_students set phone='+639000000000' where id=$1",[s.id]);
    await db.query("insert into student_recovery(student_id,phone_verified) values($1,'+639000000000')",[s.id]);
    const reset=await rpc('prepare_password_reset($1,$2)',['test@example.invalid','3'.repeat(64)]);
    assert.equal(reset.kind,'reset');assert.ok(reset.token_id);
    await assert.rejects(rpc('prepare_password_reset($1,$2)',['test@example.invalid','not-a-digest']),/digest/);

    // Phone-code verification issues the grant in the same transaction.
    await db.query("update reset_tokens set otp_issued_count=1,otp_last_issued_at=now() where id=$1",[reset.token_id]);
    const challenge=await one("insert into otp_challenges(reset_token_id,student_id,otp_hash,expires_at) values($1,$2,$3,now()+interval '5 minutes') returning id",[reset.token_id,s.id,'4'.repeat(64)]);
    assert.equal((await rpc('verify_reset_otp($1,$2,$3)',[challenge.id,'5'.repeat(64),'6'.repeat(64)])).status,'incorrect');
    assert.equal((await one('select count(*)::int as n from reset_grants')).n,0);
    assert.equal((await rpc('verify_reset_otp($1,$2,$3)',[challenge.id,'4'.repeat(64),'6'.repeat(64)])).status,'verified');
    assert.equal((await one('select count(*)::int as n from reset_grants where grant_hash=$1',['6'.repeat(64)])).n,1);
    assert.equal((await rpc('verify_reset_otp($1,$2,$3)',[challenge.id,'4'.repeat(64),'7'.repeat(64)])).status,'invalid','Codes are single use');

    // Browser roles cannot call any of the new functions.
    for(const role of ['anon','authenticated']) for(const fn of ['student_sign_in_finish(bigint,text,text,text)','student_context(uuid,text,integer,jsonb)',
      'complete_first_login_v2(uuid,text,integer,text,boolean,boolean,text)','student_sign_out(uuid,text,integer)','admin_context(uuid,text,integer)',
      'admin_sign_in_finish(bigint,text,text,text,text)','admin_sign_in_verify(uuid,text)','admin_sign_out(uuid,text,integer)','admin_change_token()',
      'admin_read(uuid,text,integer,text,jsonb)','verify_reset_otp(uuid,text,text)','record_reset_otp_delivery(uuid,text,text,text,text,boolean)',
      'prepare_password_reset(text,text)','recovery_rate_many(jsonb)','alternate_lookup(text,jsonb)',
      'record_admin_student_event(uuid,uuid,text,jsonb,text,jsonb)','authenticate_demo_student(text,text)','authenticate_admin(text,text)'])
      assert.equal((await one('select has_function_privilege($1,$2,\'execute\') as allowed',[role,fn])).allowed,false,role+' '+fn);
  } finally { await db.close(); }
});
