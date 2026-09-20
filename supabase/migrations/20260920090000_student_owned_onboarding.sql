-- Student-owned onboarding and privacy-minimized administrator reporting.
-- Apply after 20260917090000_alternate_recovery.sql. No existing birthdays or
-- policy acknowledgments are inferred; old phone numbers are preserved.
begin;
alter table public.demo_students
  add column birth_date date,
  add column terms_version text,
  add column privacy_version text,
  add column policies_accepted_at timestamptz,
  add column record_version integer not null default 1;
alter table public.demo_students alter column phone set default '';
alter table public.student_recovery
  add column pending_phone text,
  add column pending_phone_hash text,
  add column pending_phone_until timestamptz,
  add column pending_phone_sent_at timestamptz,
  add column pending_phone_version timestamptz;

create function public.student_record_revision() returns trigger
language plpgsql set search_path=public as $$
begin new.record_version:=old.record_version+1; return new; end $$;
create trigger student_record_revision before update on public.demo_students
for each row execute function public.student_record_revision();

create function public.admin_create_student_v2(p_student_number text,p_email text,p_first_name text,p_last_name text,
  p_birth_date date,p_program text,p_year_level text,p_temporary_password text)
returns table(id uuid,student_number text,email text,password_changed_at timestamptz)
language plpgsql security definer set search_path=public,extensions as $$
declare s public.demo_students%rowtype;
begin
  if p_student_number !~ '^[0-9]{7}$' or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    or length(trim(p_first_name)) not between 1 and 80 or length(trim(p_last_name)) not between 1 and 80
    or p_birth_date is null or extract(year from age(current_date,p_birth_date)) not between 15 and 100
    or length(trim(p_program)) not between 1 and 160 or length(trim(p_year_level)) not between 1 and 40
    or length(p_temporary_password) not between 12 and 128 then raise exception 'Invalid student details'; end if;
  insert into public.demo_students(student_number,email,first_name,last_name,birth_date,age,phone,program,year_level,
    password_hash,active,must_change_password,temporary_password_expires_at,password_changed_at)
  values(p_student_number,lower(trim(p_email)),trim(p_first_name),trim(p_last_name),p_birth_date,
    extract(year from age(current_date,p_birth_date))::int,'',trim(p_program),trim(p_year_level),
    crypt(p_temporary_password,gen_salt('bf',12)),true,true,now()+interval '24 hours',clock_timestamp()) returning * into s;
  return query select s.id,s.student_number,s.email::text,s.password_changed_at;
end $$;

create function public.accept_student_policies(p_sid uuid,p_version text,p_terms boolean,p_privacy boolean,p_policy text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare s public.demo_students%rowtype;
begin
  select * into s from public.demo_students where id=p_sid for update;
  if not found or not s.active or s.must_change_password or s.password_changed_at is distinct from nullif(p_version,'')::timestamptz then
    return jsonb_build_object('status','unauthorized'); end if;
  if p_terms is distinct from true or p_privacy is distinct from true or p_policy is distinct from '2026-09-20' then
    return jsonb_build_object('status','invalid'); end if;
  if s.terms_version is distinct from p_policy or s.privacy_version is distinct from p_policy then
    update public.demo_students set terms_version=p_policy,privacy_version=p_policy,policies_accepted_at=now() where id=s.id;
    insert into public.audit_events(student_id,event_type,details) values(s.id,'policies_accepted',jsonb_build_object('version',p_policy));
  end if;
  return jsonb_build_object('status','ok');
end $$;

create function public.complete_student_onboarding(p_sid uuid,p_version text,p_password text,p_terms boolean,p_privacy boolean,p_policy text)
returns table(id uuid,email text,first_name text,password_changed_at timestamptz)
language plpgsql security definer set search_path=public,extensions as $$
declare s public.demo_students%rowtype; completed record;
begin
  select * into s from public.demo_students where demo_students.id=p_sid for update;
  if not found or s.password_changed_at is distinct from nullif(p_version,'')::timestamptz
    or p_terms is distinct from true or p_privacy is distinct from true or p_policy is distinct from '2026-09-20' then return; end if;
  select * into completed from public.complete_first_login_password(p_sid,p_password);
  if completed.id is null then return; end if;
  perform public.accept_student_policies(p_sid,completed.password_changed_at::text,p_terms,p_privacy,p_policy);
  return query select completed.id,completed.email,completed.first_name,completed.password_changed_at;
end $$;

-- A new number never becomes a recovery destination before SMS ownership proof.
-- A fresh authenticator code authorizes a number change. Resends can reuse only
-- the same, unexpired, session-version-bound approval and have a 60s cooldown.
create function public.student_phone_settings(p_sid uuid,p_version text,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare s public.demo_students%rowtype; r public.student_recovery%rowtype; n text; step bigint;
begin
  select * into s from public.demo_students where id=p_sid for update;
  if not found or not s.active or s.must_change_password or s.password_changed_at is distinct from nullif(p_version,'')::timestamptz then
    return jsonb_build_object('status','unauthorized'); end if;
  select * into r from public.student_recovery where student_id=s.id for update;
  if not found or r.secret is null then return jsonb_build_object('status','invalid'); end if;
  if r.window_at<now()-interval '15 minutes' then
    update public.student_recovery set failures=0,window_at=now() where student_id=s.id; r.failures:=0;
  end if;
  if r.failures>=5 then return jsonb_build_object('status','limited'); end if;
  update public.student_recovery set failures=failures+1 where student_id=s.id;
  if p_data->>'password' is null or length(p_data->>'password')>128 or s.password_hash<>crypt(p_data->>'password',s.password_hash) then
    return jsonb_build_object('status','invalid'); end if;
  if p_action='phone_start' then
    n:=p_data->>'phone';
    if n is null or n !~ '^\+639[0-9]{9}$' then return jsonb_build_object('status','invalid'); end if;
    if r.pending_phone_sent_at>now()-interval '60 seconds' then return jsonb_build_object('status','limited'); end if;
    if r.pending_phone is distinct from n or r.pending_phone_version is distinct from s.password_changed_at
      or r.pending_phone_until is null or r.pending_phone_until<=now() then
      step:=coalesce((p_data->>'step')::bigint,-1);
      if step<=r.last_step or p_data->>'secret' is distinct from r.secret then return jsonb_build_object('status','invalid'); end if;
      update public.student_recovery set last_step=step where student_id=s.id;
    end if;
    update public.student_recovery set pending_phone=n,pending_phone_hash=p_data->>'hash',
      pending_phone_until=now()+interval '5 minutes',pending_phone_sent_at=now(),pending_phone_version=s.password_changed_at where student_id=s.id;
  elsif p_action='phone_confirm' then
    if r.pending_phone is null or r.pending_phone_until is null or r.pending_phone_until<=now()
      or r.pending_phone_version is distinct from s.password_changed_at or r.pending_phone_hash is distinct from p_data->>'hash' then
      return jsonb_build_object('status','invalid'); end if;
    -- Changing the number invalidates old email/SMS authorizations as well.
    update public.reset_tokens set used_at=now() where student_id=s.id and used_at is null;
    update public.reset_grants set used_at=now() where student_id=s.id and used_at is null;
    update public.otp_challenges set locked_at=now() where student_id=s.id and locked_at is null;
    update public.alternate_recovery set used=true where student_id=s.id and method='sms';
    update public.demo_students set phone=r.pending_phone where id=s.id;
    update public.student_recovery set phone_verified=r.pending_phone,pending_phone=null,pending_phone_hash=null,
      pending_phone_until=null,pending_phone_version=null where student_id=s.id;
  else return jsonb_build_object('status','invalid'); end if;
  update public.student_recovery set failures=0 where student_id=s.id;
  insert into public.audit_events(student_id,event_type,details) values(s.id,'recovery_'||p_action,'{}');
  return jsonb_build_object('status','ok');
end $$;

-- Only booleans and counts leave the server's security reporting view.
create view public.admin_student_security with (security_invoker=true) as
select s.id,s.student_number,s.email,s.first_name,s.last_name,s.birth_date,s.program,s.year_level,s.active,
  s.record_version,s.must_change_password,s.temporary_password_expires_at,s.password_changed_at,s.created_at,
  r.secret is not null as authenticator_enabled,
  coalesce(nullif(s.phone,'')=r.phone_verified,false) as phone_verified,
  jsonb_array_length(coalesce(r.codes,'[]')) as backup_codes_remaining,
  coalesce(s.terms_version='2026-09-20' and s.privacy_version='2026-09-20',false) as policies_accepted,
  s.policies_accepted_at,
  s.must_change_password and coalesce(s.temporary_password_expires_at<=now(),true) as invitation_expired,
  case when not s.active then 'inactive'
    when s.must_change_password then 'invited'
    when r.secret is null or s.terms_version is distinct from '2026-09-20' or s.privacy_version is distinct from '2026-09-20' then 'setup'
    when jsonb_array_length(coalesce(r.codes,'[]'))=0 then 'attention'
    else 'ready' end as security_status
from public.demo_students s left join public.student_recovery r on r.student_id=s.id;
revoke all on public.admin_student_security from public,anon,authenticated;
grant select on public.admin_student_security to service_role;

create function public.admin_student_directory(p_search text default '',p_filter text default '',p_page integer default 1)
returns jsonb language sql security definer set search_path=public,extensions as $$
  with matches as (
    select * from public.admin_student_security s
    where (p_filter='' or s.security_status=p_filter)
      and (p_search='' or position(lower(p_search) in lower(s.student_number||' '||s.first_name||' '||s.last_name||' '||s.email))>0)
  ), page as (select * from matches order by created_at desc,id limit 20 offset (greatest(1,least(p_page,100000))-1)*20)
  select jsonb_build_object('students',coalesce((select jsonb_agg(to_jsonb(page)-'birth_date') from page),'[]'),
    'total',(select count(*) from matches),'page',greatest(1,p_page),'pageSize',20);
$$;

create function public.admin_security_summary() returns jsonb
language sql security definer set search_path=public,extensions as $$
 select jsonb_build_object(
  'students',count(*),'active',count(*) filter(where active),
  'ready',count(*) filter(where security_status='ready'),
  'invited',count(*) filter(where security_status='invited'),
  'expired',count(*) filter(where active and invitation_expired),
  'setup',count(*) filter(where security_status='setup'),
  'attention',count(*) filter(where security_status='attention'),
  'authenticators',count(*) filter(where active and authenticator_enabled),
  'phones',count(*) filter(where active and phone_verified),
  'pendingRequests',(select count(*) from recovery_help_requests where status in ('pending','reviewing')),
  'failures24h',(select count(*) from audit_events where event_type='login_failed' and created_at>now()-interval '24 hours'),
  'resets7d',(select count(*) from audit_events where event_type in ('password_reset_completed','alternate_password_reset_completed') and created_at>now()-interval '7 days')
 ) from admin_student_security;
$$;

create function public.admin_security_events(p_search text default '',p_category text default '',p_page integer default 1)
returns jsonb language sql security definer set search_path=public,extensions as $$
 with events as (
  select 's-'||e.id as id,e.event_type,e.created_at,e.student_id,'student'::text as source,
    'Student / system'::text as actor from audit_events e
  union all
  select 'a-'||e.id,e.event_type,e.created_at,e.target_student_id,'admin',coalesce(a.display_name,'Administrator / system')
    from admin_audit_events e left join admin_accounts a on a.id=e.admin_id
 ), matches as (
  select e.*,s.student_number,concat_ws(' ',s.first_name,s.last_name) as student_name
  from events e left join demo_students s on s.id=e.student_id
  where (p_category='' or e.source=p_category)
   and (p_search='' or position(lower(p_search) in lower(concat_ws(' ',e.event_type,replace(e.event_type,'_',' '),s.student_number,s.first_name,s.last_name,e.actor)))>0)
 ), page as (select * from matches order by created_at desc,id desc limit 25 offset (greatest(1,least(p_page,100000))-1)*25)
 select jsonb_build_object('events',coalesce((select jsonb_agg(page) from page),'[]'),
  'total',(select count(*) from matches),'page',greatest(1,p_page),'pageSize',25);
$$;

create table public.recovery_request_reviews (
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.recovery_help_requests(id) on delete cascade,
 admin_id uuid references public.admin_accounts(id),previous_status text not null,status text not null,note text not null,
 created_at timestamptz not null default now()
);
alter table public.recovery_request_reviews enable row level security;
revoke all on public.recovery_request_reviews from public,anon,authenticated;
grant all on public.recovery_request_reviews to service_role;
create index recovery_review_request_idx on public.recovery_request_reviews(request_id,created_at desc);
create function public.review_recovery_request(p_id uuid,p_admin uuid,p_status text,p_note text,p_expected text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare r public.recovery_help_requests%rowtype;
begin
 select * into r from recovery_help_requests where id=p_id for update;
 if not found then return jsonb_build_object('status','missing'); end if;
 if r.updated_at is distinct from nullif(p_expected,'')::timestamptz then return jsonb_build_object('status','conflict'); end if;
 if p_status not in ('reviewing','resolved','declined') or length(trim(p_note)) not between 10 and 1000
  or (r.status='pending' and p_status='resolved') or r.status in ('resolved','declined') then return jsonb_build_object('status','invalid'); end if;
 update recovery_help_requests set status=p_status,review_note=trim(p_note),reviewed_by=p_admin,updated_at=clock_timestamp() where id=p_id;
 insert into recovery_request_reviews(request_id,admin_id,previous_status,status,note) values(p_id,p_admin,r.status,p_status,trim(p_note));
 insert into admin_audit_events(admin_id,event_type,details) values(p_admin,'recovery_request_reviewed',jsonb_build_object('request_id',p_id,'status',p_status));
 return jsonb_build_object('status','ok');
end $$;

revoke all on function public.student_record_revision(),public.admin_create_student_v2(text,text,text,text,date,text,text,text),
 public.accept_student_policies(uuid,text,boolean,boolean,text),public.complete_student_onboarding(uuid,text,text,boolean,boolean,text),
 public.student_phone_settings(uuid,text,text,jsonb),public.admin_student_directory(text,text,integer),public.admin_security_summary(),
 public.admin_security_events(text,text,integer),public.review_recovery_request(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.admin_create_student_v2(text,text,text,text,date,text,text,text),
 public.accept_student_policies(uuid,text,boolean,boolean,text),public.complete_student_onboarding(uuid,text,text,boolean,boolean,text),
 public.student_phone_settings(uuid,text,text,jsonb),public.admin_student_directory(text,text,integer),public.admin_security_summary(),
 public.admin_security_events(text,text,integer),public.review_recovery_request(uuid,uuid,text,text,text) to service_role;
-- Reissuing invitations cannot silently reset an established account.
create function public.reissue_student_invitation(p_student_id uuid,p_temporary_password text)
returns table(id uuid,student_number text,email text,first_name text,password_changed_at timestamptz)
language plpgsql security definer set search_path=public,extensions as $$
begin
 perform 1 from demo_students s where s.id=p_student_id and s.active and s.must_change_password for update;
 if not found then return; end if;
 return query select * from admin_issue_temporary_password(p_student_id,p_temporary_password);
end $$;
revoke all on function public.reissue_student_invitation(uuid,text) from public,anon,authenticated;
grant execute on function public.reissue_student_invitation(uuid,text) to service_role;

create function public.invalidate_student_identity_changes() returns trigger
language plpgsql security definer set search_path=public,extensions as $$
begin
 if new.email is distinct from old.email or new.active is distinct from old.active then
  new.password_changed_at:=clock_timestamp();
  update reset_tokens set used_at=now() where student_id=new.id and used_at is null;
  update reset_grants set used_at=now() where student_id=new.id and used_at is null;
  update otp_challenges set locked_at=now() where student_id=new.id and locked_at is null;
  update alternate_recovery set used=true where student_id=new.id and not used;
 end if;
 if new.password_hash is distinct from old.password_hash or new.email is distinct from old.email or new.active is distinct from old.active then
  update student_recovery set pending_phone=null,pending_phone_hash=null,pending_phone_until=null,pending_phone_version=null,
    pending_secret=null,pending_until=null where student_id=new.id;
 end if;
 return new;
end $$;
create trigger invalidate_identity before update of email,active,password_hash on demo_students
for each row execute function invalidate_student_identity_changes();
revoke all on function public.invalidate_student_identity_changes() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
