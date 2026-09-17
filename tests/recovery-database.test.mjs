import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { citext } from '@electric-sql/pglite/contrib/citext';

test('recovery migration and enrollment/reset invariants on real embedded PostgreSQL',async()=>{
  const db=new PGlite({extensions:{pgcrypto,citext}});
  try {
    await db.exec('create role anon; create role authenticated; create role service_role; create schema extensions; create publication supabase_realtime;');
    for(const file of ['setup/01-core-schema.sql','setup/02-administrator-schema.sql','migrations/20260902051232_security_hardening.sql','migrations/20260902123000_fix_reset_otp_reservation.sql','migrations/20260905071805_resumable_otp_delivery.sql','migrations/20260917090000_alternate_recovery.sql']) await db.exec(await readFile(new URL(`../supabase/${file}`,import.meta.url),'utf8'));
    const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
    const student=await one("insert into demo_students(student_number,email,first_name,phone,password_hash,password_changed_at) values('7654321','test@example.invalid','Test','+639000000000',crypt('Original!Password123',gen_salt('bf',4)),now()) returning id,password_changed_at");
    const version=student.password_changed_at.toISOString();
    const settings=async(action,data={})=>(await one('select recovery_settings($1,$2,$3,$4::jsonb) as result',[student.id,version,action,JSON.stringify({password:'Original!Password123',...data})])).result;
    assert.equal((await settings('status')).enabled,false);
    assert.equal((await settings('begin',{password:'wrong',newSecret:'encrypted'})).status,'invalid');
    assert.equal((await settings('begin',{newSecret:'encrypted'})).status,'ok');
    assert.equal((await settings('confirm',{secret:'other',step:100,codes:['backup-a','backup-b']})).status,'invalid');
    assert.equal((await settings('confirm',{secret:'encrypted',step:100,codes:['backup-a','backup-b']})).status,'ok');
    assert.equal((await settings('status')).remaining,2);
    assert.equal((await settings('codes',{secret:'encrypted',step:100,codes:['replacement']})).status,'invalid');
    assert.equal((await settings('disable',{secret:'encrypted',step:-1})).status,'invalid');
    const start=async(token,method='authenticator',code='backup-a')=>(await one('select alternate_start($1,$2,$3,$4,$5) as result',['7654321',code,method,token,'otp-hash'])).result;
    assert.equal((await start('invalid-phone','sms')).status,'invalid');
    assert.equal((await start('invalid-backup','authenticator','wrong')).status,'invalid');
    assert.equal((await start('token-a')).status,'ok');
    assert.equal((await start('duplicate')).status,'invalid');
    const verify=async(token,step=101,otp='wrong')=>(await one('select alternate_verify($1,$2,$3,$4) as result',[token,otp,step,'encrypted'])).result;
    assert.equal((await verify('token-a',100)).status,'invalid');
    assert.equal((await verify('token-a')).status,'ok');
    assert.equal((await verify('token-a')).status,'invalid');
    assert.equal((await settings('status')).remaining,1);
    const finish=async(token,password)=>(await one('select alternate_finish($1,$2) as result',[token,password])).result;
    assert.equal((await finish('token-a','weak')).status,'policy');
    assert.equal((await finish('token-a','Strong!7654321Password')).status,'policy');
    assert.equal((await finish('token-a','NewStrong!Password123')).status,'ok');
    assert.equal((await finish('token-a','NewStrong!Password234')).status,'invalid');
    assert.equal((await settings('status')).status,'unauthorized');
    const state=await one('select secret,codes from student_recovery where student_id=$1',[student.id]);
    assert.equal(state.secret,'encrypted');assert.deepEqual(state.codes,['backup-b']);
    const changed=await one('select password_changed_at from demo_students where id=$1',[student.id]);
    assert.notEqual(changed.password_changed_at.toISOString(),version);
    // A second student exercises SMS enrollment, attempts, phone change invalidation.
    const phoneStudent=await one("insert into demo_students(student_number,email,first_name,phone,password_hash,password_changed_at) values('7654322','phone@example.invalid','Phone','+639000000001',crypt('Original!Password123',gen_salt('bf',4)),now()) returning id,password_changed_at");
    const phoneSettings=async(action,data={})=>(await one('select recovery_settings($1,$2,$3,$4::jsonb) as result',[phoneStudent.id,phoneStudent.password_changed_at.toISOString(),action,JSON.stringify({password:'Original!Password123',...data})])).result;
    assert.equal((await phoneSettings('phone_start',{hash:'phone-otp'})).status,'ok');
    assert.equal((await phoneSettings('phone_confirm',{hash:'wrong'})).status,'invalid');
    assert.equal((await phoneSettings('phone_confirm',{hash:'phone-otp'})).status,'ok');
    assert.equal((await phoneSettings('codes',{hash:'phone-otp',codes:['sms-backup']})).status,'invalid');
    await db.query("update student_recovery set phone_sent_at=now()-interval '61 seconds' where student_id=$1",[phoneStudent.id]);
    assert.equal((await phoneSettings('phone_start',{hash:'fresh-otp'})).status,'ok');
    assert.equal((await phoneSettings('codes',{hash:'fresh-otp',codes:['sms-backup']})).status,'ok');
    assert.equal((await one("select alternate_start('7654322','sms-backup','sms','phone-token','otp') as result")).result.status,'ok');
    assert.equal((await one("select alternate_verify('phone-token','wrong',-1,null) as result")).result.status,'invalid');
    assert.equal((await one("select alternate_verify('phone-token','otp',-1,null) as result")).result.status,'ok');
    await db.query("update demo_students set phone='+639000000009' where id=$1",[phoneStudent.id]);
    assert.equal((await phoneSettings('status')).phoneVerified,null);
    assert.equal((await finish('phone-token','AnotherStrong!Password123')).status,'invalid');
    // Legacy email/SMS reset continues working and invalidates every prior grant.
    const legacy=await one("insert into reset_tokens(student_id,token_hash,expires_at) values($1,'legacy',now()+interval '15 minutes') returning id",[phoneStudent.id]);
    const challenge=await one("insert into otp_challenges(student_id,reset_token_id,otp_hash,expires_at,verified_at) values($1,$2,'hash',now()+interval '5 minutes',now()) returning id",[phoneStudent.id,legacy.id]);
    await db.query("insert into reset_grants(student_id,challenge_id,grant_hash,expires_at) values($1,$2,'legacy-grant',now()+interval '10 minutes')",[phoneStudent.id,challenge.id]);
    assert.equal((await db.query("select * from complete_password_reset('legacy-grant','LegacyStrong!Password123')")).rows.length,1);
    assert.equal((await db.query("select * from complete_password_reset('legacy-grant','LegacyStrong!Password234')")).rows.length,0);
    assert.equal((await one('select count(*)::int as n from reset_grants where student_id=$1 and used_at is null',[phoneStudent.id])).n,0);
    assert.equal((await one('select count(*)::int as n from reset_tokens where student_id=$1 and used_at is null',[phoneStudent.id])).n,0);
    // Initial setup returns the exact password-version timestamp used in cookies.
    await db.query("update demo_students set must_change_password=true,temporary_password_expires_at=now()+interval '1 day' where id=$1",[phoneStudent.id]);
    const first=await one("select * from complete_first_login_password($1,'FirstSetup!Password123')",[phoneStudent.id]);
    const stored=await one('select password_changed_at from demo_students where id=$1',[phoneStudent.id]);
    assert.equal(first.password_changed_at.toISOString(),stored.password_changed_at.toISOString());
    // Expiry and attempt limits are enforced by PostgreSQL, not just the UI.
    await db.query("update student_recovery set codes='[\"limit-backup\",\"expired-backup\"]',phone_verified='+639000000009' where student_id=$1",[phoneStudent.id]);
    await db.query("update alternate_recovery set created_at=now()-interval '2 hours' where student_id=$1",[phoneStudent.id]);
    assert.equal((await one("select alternate_start('7654322','limit-backup','sms','limit-token','correct') as result")).result.status,'ok');
    for(let attempt=0;attempt<5;attempt++) assert.equal((await one("select alternate_verify('limit-token','wrong',-1,null) as result")).result.status,'invalid');
    assert.equal((await one("select alternate_verify('limit-token','correct',-1,null) as result")).result.status,'invalid');
    await db.query("update alternate_recovery set created_at=now()-interval '61 seconds' where token_hash='limit-token'");
    assert.equal((await one("select alternate_start('7654322','expired-backup','sms','expired-token','correct') as result")).result.status,'ok');
    await db.query("update alternate_recovery set expires_at=now()-interval '1 second' where token_hash='expired-token'");
    assert.equal((await one("select alternate_verify('expired-token','correct',-1,null) as result")).result.status,'invalid');
    assert.deepEqual((await one('select codes from student_recovery where student_id=$1',[phoneStudent.id])).codes,['limit-backup','expired-backup']);
    // All new objects are inaccessible to browser roles.
    for(const role of ['anon','authenticated']) {
      assert.equal((await one("select has_table_privilege($1,'student_recovery','select') as allowed",[role])).allowed,false);
      assert.equal((await one("select has_function_privilege($1,'alternate_finish(text,text)','execute') as allowed",[role])).allowed,false);
    }
    assert.equal((await one("select recovery_rate('test',1) as allowed")).allowed,true);
    assert.equal((await one("select recovery_rate('test',1) as allowed")).allowed,false);
  } finally {await db.close();}
});
