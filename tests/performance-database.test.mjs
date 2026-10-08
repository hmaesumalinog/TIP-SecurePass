import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { citext } from '@electric-sql/pglite/contrib/citext';

test('performance migration preserves security, bounds reports, reserves attempts and reuses SMS challenges',async()=>{
  const db=new PGlite({extensions:{pgcrypto,citext}});
  try {
    await db.exec('create role anon;create role authenticated;create role service_role;create schema extensions;create publication supabase_realtime;');
    for(const path of ['setup/01-core-schema.sql','setup/02-administrator-schema.sql',
      'migrations/20260905071805_resumable_otp_delivery.sql','migrations/20260917090000_alternate_recovery.sql',
      'migrations/20260920090000_student_owned_onboarding.sql','migrations/20260928090000_performance_and_delivery.sql','migrations/20261009090000_sessions_and_round_trips.sql'])
      await db.exec(await readFile(new URL('../supabase/'+path,import.meta.url),'utf8'));
    const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
    const rpc=async(sql,args=[])=>(await one('select '+sql+' as result',args)).result;
    const s=await one("insert into demo_students(student_number,email,first_name,phone,password_hash,password_changed_at) values('7654321','test@example.invalid','Test','+639000000000','unused',now()) returning id,password_changed_at");
    const version=s.password_changed_at.toISOString();
    assert.equal((await rpc('recovery_status($1,$2)',[s.id,version])).enabled,false);
    assert.equal((await one('select count(*)::int as n from student_recovery')).n,0,'Status is a pure read');
    assert.equal((await rpc('recovery_status($1,$2)',[s.id,'2000-01-01'])).status,'unauthorized');
    for(const kind of ['student','admin','reset']){
      const limit=kind==='reset'?3:5;
      const ids=[];
      for(let i=0;i<limit+4;i++) ids.push(await rpc('reserve_access_attempt($1,$2,$3)',[kind,'a'.repeat(64),'b'.repeat(64)]));
      assert.equal(ids.filter(Boolean).length,limit,'In-flight reservations count before authentication: '+kind);
    }
    await db.query('update student_login_attempts set succeeded=true where id=(select id from student_login_attempts limit 1)');
    assert.ok(await rpc('reserve_access_attempt($1,$2,$3)',['student','a'.repeat(64),'b'.repeat(64)]),'Success releases the failure slot');
    const crossAccount=[];
    for(let i=0;i<15;i++) crossAccount.push(await rpc('reserve_access_attempt($1,$2,$3)',['student',i.toString(16).padStart(64,'0'),'c'.repeat(64)]));
    assert.equal(crossAccount.filter(Boolean).length,12,'IP limit works across accounts');
    const admin=await one("insert into admin_accounts(email,display_name,password_hash) values('admin@example.invalid','Admin','unused') returning id");
    const codes=[];
    for(let i=0;i<5;i++) codes.push(await rpc('reserve_admin_login_challenge($1,$2)',[admin.id,'a'.repeat(64)]));
    assert.equal(codes.filter(Boolean).length,3);
    await db.query("insert into reset_tokens(student_id,token_hash,expires_at) values($1,'token',now()+interval '15 minutes')",[s.id]);
    const prepare=(resend=false,id=null)=>rpc('prepare_reset_otp_v2($1,$2,$3,$4)',['token','a'.repeat(64),resend,id]);
    const initial=await prepare();assert.equal(initial.status,'reserved');
    await db.query("update otp_challenges set provider_reference='ref',delivery_channel='unisms_sms' where id=$1",[initial.challenge_id]);
    const first=await prepare();assert.equal(first.status,'pending');assert.equal(first.check_delivery,true);
    const duplicate=await prepare();assert.equal(duplicate.check_delivery,false);assert.equal(duplicate.challenge_id,first.challenge_id);
    await db.query('update otp_challenges set delivery_check_count=8 where id=$1',[initial.challenge_id]);
    assert.equal((await prepare()).status,'unknown');assert.equal((await prepare()).check_delivery,false);
    await db.query("update otp_challenges set delivery_status='failed',delivery_issue='content_rejected' where id=$1",[initial.challenge_id]);
    await db.query("update reset_tokens set otp_last_issued_at=now()-interval '2 minutes'");
    const rejected=await prepare(true,initial.challenge_id);assert.equal(rejected.remaining_sends,0);assert.equal(rejected.challenge_id,initial.challenge_id);
    assert.equal((await one('select count(*)::int as n from otp_challenges')).n,1);
    await db.query("insert into audit_events(student_id,event_type,created_at) select $1,'login_succeeded',now()-i*interval '1 second' from generate_series(1,1000) i",[s.id]);
    await db.query("insert into recovery_help_requests(student_number,contact,message) select '7654321','test@example.invalid','Please help recover my account' from generate_series(1,25)");
    const recent=await rpc('admin_recent_security_events()');assert.equal(recent.length,8);
    const events=await rpc("admin_security_events_v2('','',1)");assert.equal(events.events.length,25);assert.equal(events.hasMore,true);assert.equal(events.total,undefined);assert.equal(events.pendingRequests,25);
    const filtered=await rpc("admin_security_events_v2('no such event','',1)");assert.deepEqual(filtered.events,[]);assert.equal(filtered.hasMore,false);
    const queue=await rpc("admin_recovery_queue('open','',1)");assert.equal(queue.requests.length,20);assert.equal(queue.hasMore,true);assert.equal(queue.pendingRequests,25);
    assert.equal((await rpc("admin_recovery_queue('open','',2)")).requests.length,5);
    const directory=await rpc("admin_student_directory_v2('','',1)");assert.equal(directory.students.length,1);assert.equal(directory.hasMore,false);assert.equal(directory.total,undefined);
    await db.exec("insert into recovery_limits values('old',1,now()-interval '3 days'),('active',1,now()); update student_login_attempts set created_at=now()-interval '3 days';");
    const cleaned=await rpc('cleanup_expired_security_state()');assert.equal(cleaned.recovery_limits,1);assert.ok(cleaned.student_login_attempts>0);
    assert.equal((await one('select count(*)::int as n from demo_students')).n,1);
    assert.equal((await one('select count(*)::int as n from audit_events')).n,1000);
    assert.equal((await one('select count(*)::int as n from recovery_help_requests')).n,25);
    assert.equal((await one('select count(*)::int as n from otp_challenges')).n,1,'Active challenge survives maintenance');
    for(const role of ['anon','authenticated']) for(const fn of ['prepare_reset_otp_v2(text,text,boolean,uuid)','admin_student_directory_v2(text,text,integer)','admin_security_events_v2(text,text,integer)','recovery_status(uuid,text)','reserve_access_attempt(text,text,text)','reserve_admin_login_challenge(uuid,text)','admin_recent_security_events()','admin_recovery_queue(text,text,integer)','cleanup_expired_security_state()'])
      assert.equal((await one('select has_function_privilege($1,$2,\'execute\') as allowed',[role,fn])).allowed,false);
  } finally { await db.close(); }
});
