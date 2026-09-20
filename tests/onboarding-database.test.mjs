import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { validBirthday, ageFromBirthday } from '../netlify/functions/_shared/onboarding.mjs';

test('birthday validation rejects impossible dates and computes age rather than storing guessed birthdays',()=>{
  const now=new Date('2026-09-20T00:00:00Z');
  assert.equal(validBirthday('2004-02-29',now),true);
  assert.equal(validBirthday('2005-02-29',now),false);
  assert.equal(validBirthday('2020-01-01',now),false);
  assert.equal(validBirthday('1900-01-01',now),false);
  assert.equal(validBirthday('2004-13-01',now),false);
  assert.equal(ageFromBirthday('2004-09-21',now),21);
  assert.equal(ageFromBirthday('2004-09-20',now),22);
});

test('new onboarding migration enforces consent, student-owned phone proof, privacy reporting, and review concurrency',async()=>{
  const db=new PGlite({extensions:{pgcrypto,citext}});
  try {
    await db.exec('create role anon; create role authenticated; create role service_role; create schema extensions; create publication supabase_realtime;');
    for(const file of ['setup/01-core-schema.sql','setup/02-administrator-schema.sql','migrations/20260902051232_security_hardening.sql','migrations/20260902123000_fix_reset_otp_reservation.sql','migrations/20260905071805_resumable_otp_delivery.sql','migrations/20260917090000_alternate_recovery.sql','migrations/20260920090000_student_owned_onboarding.sql']) await db.exec(await readFile(new URL(`../supabase/${file}`,import.meta.url),'utf8'));
    const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
    const s=await one("select * from admin_create_student_v2('1234567','test@example.invalid','Test','Student','2004-09-21','BSIT','1st Year','Temporary!Password123')");
    let version=s.password_changed_at.toISOString();
    const row=()=>one('select * from demo_students where id=$1',[s.id]);
    assert.equal((await row()).phone,'');
    assert.equal((await row()).birth_date.toISOString().slice(0,10),'2004-09-21');
    const finish=async(terms,privacy,v=version)=>(await db.query("select * from complete_student_onboarding($1,$2,'Personal!Password123',$3,$4,'2026-09-20')",[s.id,v,terms,privacy])).rows;
    assert.equal((await finish(false,true)).length,0);
    assert.equal((await finish(true,false)).length,0);
    assert.equal((await row()).must_change_password,true);
    const completed=(await finish(true,true))[0];
    assert.ok(completed.id);assert.equal((await row()).must_change_password,false);
    assert.equal((await row()).terms_version,'2026-09-20');assert.ok((await row()).policies_accepted_at);
    assert.equal((await finish(true,true)).length,0,'Stale setup session cannot complete twice');
    version=completed.password_changed_at.toISOString();
    assert.equal((await db.query("select * from reissue_student_invitation($1,'Another!Password123')",[s.id])).rows.length,0,'Established account cannot receive an invitation reset');
    const settings=async(action,data)=>(await one('select recovery_settings($1,$2,$3,$4::jsonb) as result',[s.id,version,action,JSON.stringify({password:'Personal!Password123',...data})])).result;
    await settings('begin',{newSecret:'encrypted-test-secret'});
    await settings('confirm',{secret:'encrypted-test-secret',step:100,codes:['backup-a','backup-b']});
    const phone=async(action,data={})=>(await one('select student_phone_settings($1,$2,$3,$4::jsonb) as result',[s.id,version,action,JSON.stringify({password:'Personal!Password123',...data})])).result;
    const proof={phone:'+639000000000',hash:'sms-a',secret:'encrypted-test-secret',step:101};
    assert.equal((await phone('phone_start',{...proof,step:-1})).status,'invalid','Password alone cannot add a phone');
    assert.equal((await phone('phone_start',proof)).status,'ok');
    assert.equal((await row()).phone,'','Unverified pending number is not active');
    assert.equal((await phone('phone_start',proof)).status,'limited','Duplicate sends are rejected');
    assert.equal((await phone('phone_confirm',{hash:'wrong'})).status,'invalid');
    assert.equal((await phone('phone_confirm',{hash:'sms-a'})).status,'ok');
    assert.equal((await row()).phone,'+639000000000');
    assert.equal((await phone('phone_confirm',{hash:'sms-a'})).status,'invalid','Phone code is single use');
    const directory=(await one("select admin_student_directory('test','ready',1) as result")).result;
    assert.equal(directory.total,1);
    const visible=directory.students[0];
    assert.equal(visible.phone_verified,true);assert.equal(visible.backup_codes_remaining,2);
    for(const key of ['phone','secret','codes','password_hash','pending_phone','birth_date']) assert.equal(visible[key],undefined,key+' must not be exposed in list');
    const summary=(await one('select admin_security_summary() as result')).result;assert.equal(summary.ready,1);assert.equal(summary.phones,1);
    const events=(await one("select admin_security_events('test','student',1) as result")).result;
    assert.ok(events.events.length);assert.ok(events.events.every(e=>e.student_name==='Test Student'));
    assert.ok(events.events.every(e=>e.details===undefined));
    const admin=await one("insert into admin_accounts(email,display_name,password_hash) values('admin@example.invalid','Test Admin','unused') returning id");
    const help=await one("insert into recovery_help_requests(student_number,contact,message) values('1234567','test@example.invalid','Synthetic assistance request.') returning *");
    let expected=help.updated_at.toISOString();
    const review=async(status)=>(await one('select review_recovery_request($1,$2,$3,$4,$5) as result',[help.id,admin.id,status,'Synthetic reviewed support note.',expected])).result;
    assert.equal((await review('resolved')).status,'invalid','Must review before resolving');
    assert.equal((await review('reviewing')).status,'ok');
    assert.equal((await review('resolved')).status,'conflict','Concurrent stale updates rejected');
    expected=(await one('select updated_at::text as version from recovery_help_requests where id=$1',[help.id])).version;
    assert.equal((await review('resolved')).status,'ok');
    assert.equal((await one('select count(*)::int as n from recovery_request_reviews where request_id=$1',[help.id])).n,2);
    assert.equal((await row()).phone,'+639000000000','Review does not change student credentials or phone');
    await db.query("update student_recovery set pending_phone_sent_at=now()-interval '61 seconds',failures=0 where student_id=$1",[s.id]);
    assert.equal((await phone('phone_start',{...proof,phone:'+639000000001',step:102})).status,'ok');
    assert.equal((await row()).phone,'+639000000000','Old phone stays active during replacement');
    await db.query("update demo_students set active=false where id=$1",[s.id]);
    assert.equal((await phone('phone_confirm',{hash:'sms-a'})).status,'unauthorized');
    assert.equal((await one('select pending_phone from student_recovery where student_id=$1',[s.id])).pending_phone,null);
    for(const role of ['anon','authenticated']){
      assert.equal((await one("select has_table_privilege($1,'admin_student_security','select') as allowed",[role])).allowed,false);
      assert.equal((await one("select has_table_privilege($1,'recovery_request_reviews','select') as allowed",[role])).allowed,false);
      for(const signature of ['student_phone_settings(uuid,text,text,jsonb)','admin_student_directory(text,text,integer)','complete_student_onboarding(uuid,text,text,boolean,boolean,text)','review_recovery_request(uuid,uuid,text,text,text)'])assert.equal((await one('select has_function_privilege($1,$2,\'execute\') as allowed',[role,signature])).allowed,false);
    }
  } finally {await db.close();}
});
