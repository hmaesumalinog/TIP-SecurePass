begin;
do $$
declare sid uuid:=gen_random_uuid(); tid uuid; first jsonb; again jsonb; newer jsonb; codehash text:=repeat('a',64); sn text;
begin
loop
sn:=(1000000+floor(random()*9000000))::integer::text;
exit when not exists(select 1 from public.demo_students where student_number=sn);
end loop;
insert into public.demo_students(id,student_number,email,first_name,phone,password_hash)
values(sid,sn,sid::text||'@example.invalid','Recovery test','+639000000000','unusable-test-hash');
insert into public.reset_tokens(student_id,token_hash,expires_at) values(sid,sid::text,now()+interval '15 minutes') returning id into tid;
first:=public.prepare_reset_otp(sid::text,codehash);
assert first->>'status'='reserved','first issuance';
again:=public.prepare_reset_otp(sid::text,codehash);
assert again->>'status'='pending' and again->>'challenge_id'=first->>'challenge_id','parallel request resumes pending';
update public.otp_challenges set delivery_status='sent' where id=(first->>'challenge_id')::uuid;
again:=public.prepare_reset_otp(sid::text,codehash);
assert again->>'status'='active' and again->>'expires_at'=first->>'expires_at','refresh preserves code and deadline';
again:=public.prepare_reset_otp(sid::text,codehash,true,(first->>'challenge_id')::uuid);
assert again->>'status'='active','cooldown blocks resend';
update public.reset_tokens set otp_last_issued_at=now()-interval '61 seconds' where id=tid;
update public.otp_challenges set created_at=now()-interval '61 seconds' where id=(first->>'challenge_id')::uuid;
newer:=public.prepare_reset_otp(sid::text,codehash,true,(first->>'challenge_id')::uuid);
assert newer->>'status'='reserved' and newer->>'challenge_id'<>first->>'challenge_id','explicit resend creates new challenge';
again:=public.prepare_reset_otp(sid::text,codehash,true,(first->>'challenge_id')::uuid);
assert again->>'challenge_id'=newer->>'challenge_id','duplicate resend resumes newest';
assert (select locked_at is not null from public.otp_challenges where id=(first->>'challenge_id')::uuid),'old code locked';
assert (select otp_issued_count=2 from public.reset_tokens where id=tid),'only two sends reserved';
again:=(select to_jsonb(r) from public.consume_student_otp_attempt((newer->>'challenge_id')::uuid,true) r);
assert again->>'status'='verified','valid OTP consumption';
again:=public.prepare_reset_otp(sid::text,codehash);
assert again->>'status'='verified','verified code not replaced on refresh';
assert not has_function_privilege('anon','public.prepare_reset_otp(text,text,boolean,uuid)','execute'),'anonymous role blocked';
assert has_function_privilege('service_role','public.prepare_reset_otp(text,text,boolean,uuid)','execute'),'server role allowed';
end $$;
rollback;
