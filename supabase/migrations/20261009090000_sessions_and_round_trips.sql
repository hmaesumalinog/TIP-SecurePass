-- Session revocation, constant-time sign-in, and fewer database round trips.
-- Apply after 20260928090000_performance_and_delivery.sql. Additive: earlier
-- functions stay available so a previous application deploy keeps working.
begin;

alter table public.demo_students add column if not exists session_version integer not null default 0;
alter table public.admin_accounts add column if not exists session_version integer not null default 0;

-- Signing out changes only session_version; administrators editing the same
-- record must not see that as a conflicting profile change.
create or replace function public.student_record_revision() returns trigger
language plpgsql set search_path=public as $$
begin
  if (to_jsonb(new)-'session_version'-'record_version') = (to_jsonb(old)-'session_version'-'record_version') then
    new.record_version:=old.record_version;
  else
    new.record_version:=old.record_version+1;
  end if;
  return new;
end $$;

-- Unknown and inactive accounts still perform one bcrypt comparison against a
-- fixed cost-12 hash, so response time does not reveal whether an account exists.
create or replace function public.authenticate_demo_student(p_student_number text, p_password text)
returns table(id uuid, student_number text, email text, first_name text, last_name text,
  age integer, phone text, program text, year_level text, password_changed_at timestamptz,
  must_change_password boolean, temporary_password_expires_at timestamptz)
language plpgsql security definer set search_path=public,extensions as $$
declare s public.demo_students%rowtype;
begin
  select * into s from public.demo_students d where d.student_number=p_student_number and d.active;
  if not found then
    perform crypt(coalesce(p_password,''),'$2a$12$tP0ftoiRLp/I2Rt3DrDSGu5xtdRQDU2DemPBjxk/URiZg7EOOsPEO');
    return;
  end if;
  if s.password_hash is distinct from crypt(coalesce(p_password,''),s.password_hash) then return; end if;
  return query select s.id,s.student_number,s.email::text,s.first_name,s.last_name,s.age,s.phone,s.program,
    s.year_level,s.password_changed_at,s.must_change_password,s.temporary_password_expires_at;
end $$;

create or replace function public.authenticate_admin(p_email text, p_password text)
returns table(id uuid, email text, display_name text, role text, password_changed_at timestamptz)
language plpgsql security definer set search_path=public,extensions as $$
declare a public.admin_accounts%rowtype;
begin
  select * into a from public.admin_accounts x where x.email=p_email::citext and x.active;
  if not found then
    perform crypt(coalesce(p_password,''),'$2a$12$tP0ftoiRLp/I2Rt3DrDSGu5xtdRQDU2DemPBjxk/URiZg7EOOsPEO');
    return;
  end if;
  if a.password_hash is distinct from crypt(coalesce(p_password,''),a.password_hash) then return; end if;
  return query select a.id,a.email::text,a.display_name,a.role,a.password_changed_at;
end $$;

-- Second step of student sign-in. The caller first reserves the attempt with
-- reserve_access_attempt, so rate-limit locks are never held while hashing.
create function public.student_sign_in_finish(p_attempt bigint,p_student_number text,p_password text,p_number_hash text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare s public.demo_students%rowtype; v_found boolean; v_event text;
begin
  perform 1 from public.student_login_attempts
    where id=p_attempt and student_number_hash=p_number_hash and not succeeded and created_at>now()-interval '15 minutes';
  if not found then raise exception 'Invalid sign-in reservation'; end if;
  select * into s from public.demo_students d where d.student_number=p_student_number and d.active;
  v_found:=found;
  if not v_found then
    perform crypt(coalesce(p_password,''),'$2a$12$tP0ftoiRLp/I2Rt3DrDSGu5xtdRQDU2DemPBjxk/URiZg7EOOsPEO');
  end if;
  if not v_found or s.password_hash is null
    or s.password_hash is distinct from crypt(coalesce(p_password,''),s.password_hash) then
    insert into public.audit_events(student_id,event_type,details)
      values(null,'login_failed',jsonb_build_object('student_number_hash',p_number_hash));
    return jsonb_build_object('status','invalid');
  end if;
  update public.student_login_attempts set succeeded=true where id=p_attempt;
  if s.must_change_password and (s.temporary_password_expires_at is null or s.temporary_password_expires_at<=now()) then
    insert into public.audit_events(student_id,event_type,details) values(s.id,'temporary_password_expired','{}');
    return jsonb_build_object('status','expired');
  end if;
  v_event:=case when s.must_change_password then 'temporary_password_login_succeeded' else 'login_succeeded' end;
  insert into public.audit_events(student_id,event_type,details) values(s.id,v_event,'{}');
  return jsonb_build_object('status','ok','student',jsonb_build_object('id',s.id,'student_number',s.student_number,
    'first_name',s.first_name,'password_changed_at',s.password_changed_at,'session_version',s.session_version,
    'must_change_password',s.must_change_password));
end $$;

-- One read validates a student session and returns everything the portal,
-- profile and Security & recovery pages need. Optional rate keys are applied
-- in the same call for state-changing security actions.
create function public.student_context(p_sid uuid,p_version text,p_session integer,p_rate jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare s public.demo_students%rowtype; r public.student_recovery%rowtype; k jsonb;
begin
  select * into s from public.demo_students where id=p_sid;
  if not found or not s.active or s.must_change_password or s.session_version is distinct from p_session
    or s.password_changed_at is distinct from nullif(p_version,'')::timestamptz then
    return jsonb_build_object('status','unauthorized');
  end if;
  if p_rate is not null then
    for k in select value from jsonb_array_elements(p_rate) loop
      if not public.recovery_rate(k->>'key',(k->>'limit')::integer) then return jsonb_build_object('status','limited'); end if;
    end loop;
  end if;
  select * into r from public.student_recovery where student_id=s.id;
  return jsonb_build_object('status','ok',
    'student',jsonb_build_object('id',s.id,'student_number',s.student_number,'email',s.email,'first_name',s.first_name,
      'last_name',s.last_name,'birth_date',s.birth_date,'age',s.age,'phone',s.phone,'program',s.program,
      'year_level',s.year_level,'password_changed_at',s.password_changed_at,
      'policies_accepted',coalesce(s.terms_version='2026-09-20' and s.privacy_version='2026-09-20',false)),
    'recovery',jsonb_build_object('enabled',r.secret is not null,
      'phoneVerified',coalesce(nullif(s.phone,'')=r.phone_verified,false),
      'remaining',jsonb_array_length(coalesce(r.codes,'[]')),
      'setupCompleted',r.secret is not null or coalesce(r.last_step,-1)>=0,
      'secret',r.secret,'pendingSecret',r.pending_secret,
      'pendingPhoneHash',r.pending_phone_hash,'pendingPhoneUntil',r.pending_phone_until));
end $$;

create function public.complete_first_login_v2(p_sid uuid,p_version text,p_session integer,p_password text,
  p_terms boolean,p_privacy boolean,p_policy text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare s public.demo_students%rowtype; done record;
begin
  select * into s from public.demo_students where id=p_sid and active;
  if not found or not s.must_change_password or s.session_version is distinct from p_session
    or s.password_changed_at is distinct from nullif(p_version,'')::timestamptz then
    return jsonb_build_object('status','unauthorized');
  end if;
  if s.temporary_password_expires_at is null or s.temporary_password_expires_at<=now() then
    return jsonb_build_object('status','expired');
  end if;
  if position(s.student_number in coalesce(p_password,''))>0 then return jsonb_build_object('status','policy'); end if;
  select * into done from public.complete_student_onboarding(p_sid,p_version,p_password,p_terms,p_privacy,p_policy);
  if done.id is null then return jsonb_build_object('status','unauthorized'); end if;
  select * into s from public.demo_students where id=p_sid;
  return jsonb_build_object('status','ok','student',jsonb_build_object('id',s.id,'email',s.email,
    'first_name',s.first_name,'password_changed_at',s.password_changed_at,'session_version',s.session_version));
end $$;

-- Signing out revokes every session issued for that account.
create function public.student_sign_out(p_sid uuid,p_version text,p_session integer) returns boolean
language plpgsql security definer set search_path=public,extensions as $$
begin
  update public.demo_students set session_version=session_version+1
  where id=p_sid and session_version=p_session
    and password_changed_at is not distinct from nullif(p_version,'')::timestamptz;
  return found;
end $$;

create function public.admin_context(p_admin uuid,p_version text,p_session integer) returns jsonb
language sql stable security definer set search_path=public,extensions as $$
  select jsonb_build_object('id',a.id,'email',a.email,'display_name',a.display_name,'role',a.role)
  from public.admin_accounts a
  where a.id=p_admin and a.active and a.session_version=p_session
    and a.password_changed_at=nullif(p_version,'')::timestamptz;
$$;

create function public.admin_sign_in_finish(p_attempt bigint,p_email text,p_password text,p_email_hash text,p_otp_hash text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare a public.admin_accounts%rowtype; v_challenge uuid;
begin
  perform 1 from public.admin_login_attempts
    where id=p_attempt and email_hash=p_email_hash and not succeeded and created_at>now()-interval '15 minutes';
  if not found then raise exception 'Invalid sign-in reservation'; end if;
  select * into a from public.admin_accounts x where x.email=p_email::citext and x.active;
  if not found then
    perform crypt(coalesce(p_password,''),'$2a$12$tP0ftoiRLp/I2Rt3DrDSGu5xtdRQDU2DemPBjxk/URiZg7EOOsPEO');
    return jsonb_build_object('status','invalid');
  end if;
  if a.password_hash is distinct from crypt(coalesce(p_password,''),a.password_hash) then
    return jsonb_build_object('status','invalid');
  end if;
  update public.admin_login_attempts set succeeded=true where id=p_attempt;
  v_challenge:=public.reserve_admin_login_challenge(a.id,p_otp_hash);
  if v_challenge is null then return jsonb_build_object('status','challenge_limited'); end if;
  insert into public.admin_audit_events(admin_id,event_type,details) values(a.id,'admin_password_verified','{}');
  return jsonb_build_object('status','ok','challenge_id',v_challenge,
    'admin',jsonb_build_object('id',a.id,'email',a.email,'display_name',a.display_name));
end $$;

create function public.admin_sign_in_verify(p_challenge uuid,p_otp_hash text) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare c public.admin_login_challenges%rowtype; a public.admin_accounts%rowtype; v_attempts integer;
begin
  select * into c from public.admin_login_challenges where id=p_challenge for update;
  if not found or c.verified_at is not null or c.locked_at is not null or c.expires_at<=now() then
    return jsonb_build_object('status','invalid');
  end if;
  if c.attempts>=5 then return jsonb_build_object('status','locked','remaining',0); end if;
  v_attempts:=c.attempts+1;
  if c.otp_hash is distinct from p_otp_hash then
    update public.admin_login_challenges set attempts=v_attempts,
      locked_at=case when v_attempts>=5 then now() else locked_at end where id=c.id;
    return jsonb_build_object('status',case when v_attempts>=5 then 'locked' else 'incorrect' end,
      'remaining',greatest(0,5-v_attempts));
  end if;
  update public.admin_login_challenges set attempts=v_attempts,verified_at=now() where id=c.id;
  select * into a from public.admin_accounts where id=c.admin_id and active;
  if not found then return jsonb_build_object('status','forbidden'); end if;
  update public.admin_accounts set last_login_at=now() where id=a.id;
  insert into public.admin_audit_events(admin_id,event_type,details) values(a.id,'admin_login_succeeded','{}');
  return jsonb_build_object('status','verified','admin',jsonb_build_object('id',a.id,'email',a.email,
    'display_name',a.display_name,'role',a.role,'password_changed_at',a.password_changed_at,
    'session_version',a.session_version));
end $$;

create function public.admin_sign_out(p_admin uuid,p_version text,p_session integer) returns boolean
language plpgsql security definer set search_path=public,extensions as $$
begin
  update public.admin_accounts set session_version=session_version+1
  where id=p_admin and session_version=p_session and password_changed_at=nullif(p_version,'')::timestamptz;
  if not found then return false; end if;
  insert into public.admin_audit_events(admin_id,event_type,details) values(p_admin,'admin_logout','{}');
  return true;
end $$;

-- A small value that changes whenever anything an administrator view shows
-- changes. Every security-relevant write records an audit event; support
-- requests are tracked separately. Each part is an indexed lookup.
create function public.admin_change_token() returns text
language sql stable security definer set search_path=public,extensions as $$
  select concat_ws(':',
    coalesce((select max(id) from public.audit_events),0),
    coalesce((select max(id) from public.admin_audit_events),0),
    (select count(*) from public.recovery_help_requests),
    coalesce((select floor(extract(epoch from max(updated_at))*1000)::bigint from public.recovery_help_requests),0));
$$;

-- Every administrator read is a single round trip: validate the session,
-- enforce the role, and return the requested view with the change token.
create function public.admin_read(p_admin uuid,p_version text,p_session integer,p_view text,p_args jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare a jsonb; v_data jsonb; v_page integer:=greatest(1,least(coalesce((p_args->>'page')::integer,1),100000));
begin
  a:=public.admin_context(p_admin,p_version,p_session);
  if a is null then return jsonb_build_object('status','unauthorized'); end if;
  if p_view in ('recovery_queue','recovery_request') and a->>'role'<>'super_admin' then
    return jsonb_build_object('status','forbidden','admin',a);
  end if;
  if p_view='session' then v_data:='{}';
  elsif p_view='pulse' then v_data:='{}';
  elsif p_view='dashboard' then
    v_data:=jsonb_build_object('metrics',public.admin_security_summary(),'recent',public.admin_recent_security_events());
  elsif p_view='students' then
    v_data:=public.admin_student_directory_v2(coalesce(p_args->>'search',''),coalesce(p_args->>'filter',''),v_page);
  elsif p_view='student' then
    select jsonb_build_object('student',to_jsonb(s)) into v_data from public.admin_student_security s where s.id=(p_args->>'id')::uuid;
    if v_data is null then return jsonb_build_object('status','missing','admin',a); end if;
  elsif p_view='audit' then
    v_data:=public.admin_security_events_v2(coalesce(p_args->>'search',''),coalesce(p_args->>'category',''),v_page);
  elsif p_view='recovery_queue' then
    v_data:=public.admin_recovery_queue(coalesce(p_args->>'status','open'),coalesce(p_args->>'number',''),v_page);
  elsif p_view='recovery_request' then
    select jsonb_build_object('request',jsonb_build_object('id',r.id,'student_number',r.student_number,'contact',r.contact,
        'message',r.message,'status',r.status,'review_note',r.review_note,'created_at',r.created_at,'updated_at',r.updated_at),
      'history',coalesce((select jsonb_agg(jsonb_build_object('previous_status',v.previous_status,'status',v.status,
        'note',v.note,'created_at',v.created_at) order by v.created_at) from public.recovery_request_reviews v
        where v.request_id=r.id),'[]'))
    into v_data from public.recovery_help_requests r where r.id=(p_args->>'id')::uuid;
    if v_data is null then return jsonb_build_object('status','missing','admin',a); end if;
  else raise exception 'Unsupported administrator view';
  end if;
  return jsonb_build_object('status','ok','admin',a,'data',v_data,'token',public.admin_change_token());
end $$;

-- Phone-code verification in one transaction: count the attempt, then issue the
-- single-use reset grant and audit event only for the correct code.
create function public.verify_reset_otp(p_challenge uuid,p_otp_hash text,p_grant_hash text) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare c public.otp_challenges%rowtype; v_attempts integer;
begin
  if p_grant_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid grant digest'; end if;
  select * into c from public.otp_challenges where id=p_challenge for update;
  if not found or c.verified_at is not null or c.locked_at is not null or c.expires_at<=now() then
    return jsonb_build_object('status','invalid');
  end if;
  if c.attempts>=5 then return jsonb_build_object('status','locked','remaining',0); end if;
  v_attempts:=c.attempts+1;
  if c.otp_hash is distinct from p_otp_hash then
    update public.otp_challenges set attempts=v_attempts,
      locked_at=case when v_attempts>=5 then now() else locked_at end where id=c.id;
    return jsonb_build_object('status',case when v_attempts>=5 then 'locked' else 'incorrect' end,
      'remaining',greatest(0,5-v_attempts));
  end if;
  update public.otp_challenges set attempts=v_attempts,verified_at=now() where id=c.id;
  insert into public.reset_grants(challenge_id,student_id,grant_hash,expires_at)
    values(c.id,c.student_id,p_grant_hash,now()+interval '10 minutes');
  insert into public.audit_events(student_id,event_type,details) values(c.student_id,'otp_verified','{}');
  return jsonb_build_object('status','verified');
end $$;

create function public.record_reset_otp_delivery(p_challenge uuid,p_status text,p_channel text,p_reference text,
  p_issue text,p_issued boolean) returns void
language plpgsql security definer set search_path=public,extensions as $$
declare v_student uuid;
begin
  update public.otp_challenges set delivery_status=p_status,delivery_channel=coalesce(p_channel,delivery_channel),
    provider_reference=coalesce(p_reference,provider_reference),delivery_issue=p_issue,
    delivery_checked_at=case when p_reference is null then delivery_checked_at else now() end
  where id=p_challenge returning student_id into v_student;
  if p_issued and v_student is not null then
    insert into public.audit_events(student_id,event_type,details) values(v_student,'otp_issued',jsonb_build_object('channel',p_channel));
  end if;
end $$;

-- Runs after the generic response has been sent. Decides which recovery email
-- the account can use and creates a reset link only for eligible accounts.
create function public.prepare_password_reset(p_email text,p_token_hash text) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare s public.demo_students%rowtype; r public.student_recovery%rowtype; v_token uuid;
begin
  if p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid token digest'; end if;
  select * into s from public.demo_students where email=p_email::citext and active;
  if not found then return jsonb_build_object('kind','none'); end if;
  select * into r from public.student_recovery where student_id=s.id;
  if s.must_change_password or not coalesce(nullif(s.phone,'')=r.phone_verified,false) then
    return jsonb_build_object('kind','options','invited',s.must_change_password,
      'student',jsonb_build_object('id',s.id,'email',s.email,'first_name',s.first_name));
  end if;
  insert into public.reset_tokens(student_id,token_hash,expires_at)
    values(s.id,p_token_hash,now()+interval '15 minutes') returning id into v_token;
  return jsonb_build_object('kind','reset','token_id',v_token,
    'student',jsonb_build_object('id',s.id,'email',s.email,'first_name',s.first_name));
end $$;

-- Applies several hourly limits in one call, in the order given.
create function public.recovery_rate_many(p_keys jsonb) returns boolean
language plpgsql security definer set search_path=public,extensions as $$
declare k jsonb;
begin
  for k in select value from jsonb_array_elements(p_keys) loop
    if not public.recovery_rate(k->>'key',(k->>'limit')::integer) then return false; end if;
  end loop;
  return true;
end $$;

create function public.alternate_lookup(p_token text,p_rate jsonb) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare a public.alternate_recovery%rowtype;
begin
  if not public.recovery_rate_many(p_rate) then return jsonb_build_object('status','limited'); end if;
  select * into a from public.alternate_recovery where token_hash=p_token;
  return jsonb_build_object('status','ok','student_id',a.student_id,'secret',a.secret,'method',a.method);
end $$;

create function public.record_admin_student_event(p_admin uuid,p_student uuid,p_admin_event text,p_admin_details jsonb,
  p_student_event text,p_student_details jsonb) returns void
language plpgsql security definer set search_path=public,extensions as $$
begin
  if p_admin_event is not null then
    insert into public.admin_audit_events(admin_id,event_type,target_student_id,details)
      values(p_admin,p_admin_event,p_student,coalesce(p_admin_details,'{}'));
  end if;
  if p_student_event is not null then
    insert into public.audit_events(student_id,event_type,details) values(p_student,p_student_event,coalesce(p_student_details,'{}'));
  end if;
end $$;

revoke all on function public.student_sign_in_finish(bigint,text,text,text),public.student_context(uuid,text,integer,jsonb),
  public.complete_first_login_v2(uuid,text,integer,text,boolean,boolean,text),public.student_sign_out(uuid,text,integer),
  public.admin_context(uuid,text,integer),public.admin_sign_in_finish(bigint,text,text,text,text),
  public.admin_sign_in_verify(uuid,text),public.admin_sign_out(uuid,text,integer),public.admin_change_token(),
  public.admin_read(uuid,text,integer,text,jsonb),public.verify_reset_otp(uuid,text,text),
  public.record_reset_otp_delivery(uuid,text,text,text,text,boolean),public.prepare_password_reset(text,text),
  public.recovery_rate_many(jsonb),public.alternate_lookup(text,jsonb),
  public.record_admin_student_event(uuid,uuid,text,jsonb,text,jsonb),public.student_record_revision(),
  public.authenticate_demo_student(text,text),public.authenticate_admin(text,text) from public,anon,authenticated;
grant execute on function public.student_sign_in_finish(bigint,text,text,text),public.student_context(uuid,text,integer,jsonb),
  public.complete_first_login_v2(uuid,text,integer,text,boolean,boolean,text),public.student_sign_out(uuid,text,integer),
  public.admin_context(uuid,text,integer),public.admin_sign_in_finish(bigint,text,text,text,text),
  public.admin_sign_in_verify(uuid,text),public.admin_sign_out(uuid,text,integer),public.admin_change_token(),
  public.admin_read(uuid,text,integer,text,jsonb),public.verify_reset_otp(uuid,text,text),
  public.record_reset_otp_delivery(uuid,text,text,text,text,boolean),public.prepare_password_reset(text,text),
  public.recovery_rate_many(jsonb),public.alternate_lookup(text,jsonb),
  public.record_admin_student_event(uuid,uuid,text,jsonb,text,jsonb),
  public.authenticate_demo_student(text,text),public.authenticate_admin(text,text) to service_role;
notify pgrst,'reload schema';
commit;
