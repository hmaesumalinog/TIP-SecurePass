-- Server-only recovery state. No browser role may read secrets or issue grants.
begin;
create table public.student_recovery (
  student_id uuid primary key references public.demo_students(id) on delete cascade,
  secret text, pending_secret text, pending_until timestamptz,
  last_step bigint not null default -1,
  phone_verified text, phone_hash text, phone_until timestamptz,
  phone_sent_at timestamptz, codes jsonb not null default '[]',
  failures integer not null default 0, window_at timestamptz not null default now()
);
create table public.recovery_limits (
  key text primary key, hits integer not null, window_at timestamptz not null
);
create table public.alternate_recovery (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.demo_students(id) on delete cascade,
  token_hash text not null unique, code_hash text not null,
  otp_hash text, method text not null check(method in ('authenticator','sms')),
  phone text, version timestamptz, secret text,
  attempts integer not null default 0, verified boolean not null default false,
  used boolean not null default false, expires_at timestamptz not null default now()+interval '5 minutes',
  created_at timestamptz not null default now()
);
create table public.recovery_help_requests (
  id uuid primary key default gen_random_uuid(),
  student_number text not null check(student_number ~ '^[0-9]{7}$'),
  contact text not null check(length(contact) between 5 and 254),
  message text not null check(length(message) between 10 and 1000),
  status text not null default 'pending' check(status in ('pending','reviewing','resolved','declined')),
  review_note text, reviewed_by uuid references public.admin_accounts(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table public.student_recovery enable row level security;
alter table public.recovery_limits enable row level security;
alter table public.alternate_recovery enable row level security;
alter table public.recovery_help_requests enable row level security;
revoke all on public.student_recovery, public.recovery_limits, public.alternate_recovery, public.recovery_help_requests from public, anon, authenticated;
grant all on public.student_recovery, public.recovery_limits, public.alternate_recovery, public.recovery_help_requests to service_role;
create index on public.alternate_recovery(student_id, created_at);

create function public.recovery_rate(p_key text, p_limit integer) returns boolean
language plpgsql security definer set search_path=public,extensions as $$
declare n integer;
begin
  insert into public.recovery_limits as r values(p_key,1,now())
  on conflict(key) do update set
    hits=case when r.window_at < now()-interval '1 hour' then 1 else r.hits+1 end,
    window_at=case when r.window_at < now()-interval '1 hour' then now() else r.window_at end
  returning hits into n;
  return n<=p_limit;
end $$;

-- All security mutations lock the student first, then their recovery state.
create function public.recovery_settings(p_sid uuid, p_version text, p_action text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare s public.demo_students%rowtype; r public.student_recovery%rowtype; step bigint;
begin
  select * into s from public.demo_students where id=p_sid for update;
  if not found or not s.active or s.must_change_password or s.password_changed_at is distinct from nullif(p_version,'')::timestamptz then
    return jsonb_build_object('status','unauthorized');
  end if;
  insert into public.student_recovery(student_id) values(s.id) on conflict do nothing;
  select * into r from public.student_recovery where student_id=s.id for update;
  if p_action='status' then return jsonb_build_object('status','ok','enabled',r.secret is not null,
    'phoneVerified',r.phone_verified=s.phone,'remaining',jsonb_array_length(r.codes)); end if;
  if r.window_at < now()-interval '15 minutes' then
    update public.student_recovery set failures=0,window_at=now() where student_id=s.id; r.failures:=0;
  end if;
  if r.failures>=5 then return jsonb_build_object('status','limited'); end if;
  update public.student_recovery set failures=failures+1 where student_id=s.id;
  if p_data->>'password' is null or length(p_data->>'password')>128 or
     s.password_hash <> crypt(p_data->>'password',s.password_hash) then return jsonb_build_object('status','invalid'); end if;
  -- Existing factors cannot be replaced using only a stolen password/session.
  if p_action in ('begin','codes','disable') and r.secret is not null then
    step:=coalesce((p_data->>'step')::bigint,-1);
    if step<=r.last_step or p_data->>'secret' is distinct from r.secret then return jsonb_build_object('status','invalid'); end if;
    update public.student_recovery set last_step=step where student_id=s.id;
  end if;
  if p_action='begin' then
    update public.student_recovery set pending_secret=p_data->>'newSecret',pending_until=now()+interval '10 minutes' where student_id=s.id;
  elsif p_action='confirm' then
    step:=coalesce((p_data->>'step')::bigint,-1);
    if r.pending_until is null or r.pending_until<=now() or step<0 or p_data->>'secret' is distinct from r.pending_secret then return jsonb_build_object('status','invalid'); end if;
    update public.student_recovery set secret=pending_secret,pending_secret=null,pending_until=null,last_step=step,codes=p_data->'codes' where student_id=s.id;
    update public.alternate_recovery set used=true where student_id=s.id;
  elsif p_action='phone_start' then
    if r.phone_sent_at>now()-interval '60 seconds' then return jsonb_build_object('status','limited'); end if;
    update public.student_recovery set phone_hash=p_data->>'hash',phone_until=now()+interval '5 minutes',phone_sent_at=now() where student_id=s.id;
  elsif p_action='phone_confirm' then
    if r.phone_until is null or r.phone_until<=now() or r.phone_hash is distinct from p_data->>'hash' then return jsonb_build_object('status','invalid'); end if;
    if p_data->'codes' is not null and (r.secret is not null or jsonb_array_length(r.codes)>0) then return jsonb_build_object('status','invalid'); end if;
    update public.student_recovery set phone_verified=s.phone,phone_hash=null,phone_until=null where student_id=s.id;
    if r.secret is null and jsonb_array_length(r.codes)=0 and p_data->'codes' is not null then
      update public.student_recovery set codes=p_data->'codes' where student_id=s.id;
    end if;
  elsif p_action='codes' then
    if r.secret is null and r.phone_verified is distinct from s.phone then return jsonb_build_object('status','unavailable'); end if;
    -- Without an authenticator, fresh phone proof is required to regenerate codes.
    if r.secret is null and (r.phone_until is null or r.phone_until<=now() or r.phone_hash is distinct from p_data->>'hash') then return jsonb_build_object('status','invalid'); end if;
    update public.student_recovery set codes=p_data->'codes',phone_hash=null,phone_until=null where student_id=s.id;
    update public.alternate_recovery set used=true where student_id=s.id;
  elsif p_action='disable' then
    update public.student_recovery set secret=null,pending_secret=null,codes='[]' where student_id=s.id;
    update public.alternate_recovery set used=true where student_id=s.id;
  else return jsonb_build_object('status','invalid'); end if;
  update public.student_recovery set failures=0 where student_id=s.id;
  insert into public.audit_events(student_id,event_type,details) values(s.id,'recovery_'||p_action,'{}');
  return jsonb_build_object('status','ok');
end $$;

create function public.alternate_start(p_number text,p_code text,p_method text,p_token text,p_otp text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare s public.demo_students%rowtype; r public.student_recovery%rowtype;
begin
  select * into s from public.demo_students where student_number=p_number and active and not must_change_password for update;
  if not found then return jsonb_build_object('status','invalid'); end if;
  select * into r from public.student_recovery where student_id=s.id for update;
  if not found or not r.codes @> jsonb_build_array(p_code) then return jsonb_build_object('status','invalid'); end if;
  if (select count(*) from public.alternate_recovery where student_id=s.id and created_at>now()-interval '1 hour')>=3
     or exists(select 1 from public.alternate_recovery where student_id=s.id and created_at>now()-interval '60 seconds') then return jsonb_build_object('status','invalid'); end if;
  if (p_method='authenticator' and r.secret is null) or (p_method='sms' and r.phone_verified is distinct from s.phone)
     or p_method not in ('authenticator','sms') then return jsonb_build_object('status','invalid'); end if;
  insert into public.alternate_recovery(student_id,token_hash,code_hash,otp_hash,method,phone,version,secret)
  values(s.id,p_token,p_code,p_otp,p_method,s.phone,s.password_changed_at,r.secret);
  return jsonb_build_object('status','ok','phone',s.phone,'studentId',s.id);
end $$;

create function public.alternate_verify(p_token text,p_otp text,p_step bigint,p_secret text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare a public.alternate_recovery%rowtype; r public.student_recovery%rowtype; s public.demo_students%rowtype;
begin
  select * into a from public.alternate_recovery where token_hash=p_token;
  if not found then return jsonb_build_object('status','invalid'); end if;
  select * into s from public.demo_students where id=a.student_id for update;
  select * into r from public.student_recovery where student_id=s.id for update;
  select * into a from public.alternate_recovery where token_hash=p_token for update;
  if a.used or a.verified or a.expires_at<=now() or a.attempts>=5 or not s.active or s.must_change_password
    or a.version is distinct from s.password_changed_at or not r.codes @> jsonb_build_array(a.code_hash) then return jsonb_build_object('status','invalid'); end if;
  update public.alternate_recovery set attempts=attempts+1 where id=a.id;
  if a.method='sms' then
    if a.otp_hash is distinct from p_otp or a.phone is distinct from s.phone or r.phone_verified is distinct from s.phone then return jsonb_build_object('status','invalid'); end if;
  else
    if p_step is null or p_step<=r.last_step or p_secret is distinct from r.secret or a.secret is distinct from r.secret then return jsonb_build_object('status','invalid'); end if;
    update public.student_recovery set last_step=p_step where student_id=s.id;
  end if;
  update public.student_recovery set codes=codes-a.code_hash where student_id=s.id;
  update public.alternate_recovery set verified=true,expires_at=now()+interval '10 minutes' where id=a.id;
  insert into public.audit_events(student_id,event_type,details) values(s.id,'alternate_recovery_verified',jsonb_build_object('method',a.method));
  return jsonb_build_object('status','ok');
end $$;

create function public.alternate_finish(p_token text,p_password text)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare a public.alternate_recovery%rowtype; s public.demo_students%rowtype;
begin
  select * into a from public.alternate_recovery where token_hash=p_token;
  if not found then return jsonb_build_object('status','invalid'); end if;
  select * into s from public.demo_students where id=a.student_id for update;
  select * into a from public.alternate_recovery where token_hash=p_token for update;
  if a.used or not a.verified or a.expires_at<=now() or not s.active or a.version is distinct from s.password_changed_at then return jsonb_build_object('status','invalid'); end if;
  if length(p_password) not between 12 and 128 or p_password !~ '[A-Z]' or p_password !~ '[a-z]'
    or p_password !~ '[0-9]' or p_password !~ '[^A-Za-z0-9]' or position(s.student_number in p_password)>0 then return jsonb_build_object('status','policy'); end if;
  update public.demo_students set password_hash=crypt(p_password,gen_salt('bf',12)),password_changed_at=clock_timestamp(),must_change_password=false,temporary_password_expires_at=null where id=s.id;
  insert into public.audit_events(student_id,event_type,details) values(s.id,'alternate_password_reset_completed',jsonb_build_object('method',a.method));
  return jsonb_build_object('status','ok','email',s.email,'id',s.id,'event',a.id);
end $$;

-- Any password change invalidates ALL recovery authorizations and old sessions.
create function public.invalidate_recovery_on_password_change() returns trigger
language plpgsql security definer set search_path=public,extensions as $$
begin
  if new.password_hash is distinct from old.password_hash then
    if new.password_changed_at is not distinct from old.password_changed_at then new.password_changed_at:=clock_timestamp(); end if;
    update public.reset_tokens set used_at=now() where student_id=new.id and used_at is null;
    update public.reset_grants set used_at=now() where student_id=new.id and used_at is null;
    update public.otp_challenges set locked_at=now() where student_id=new.id and locked_at is null;
    update public.alternate_recovery set used=true where student_id=new.id and not used;
    update public.student_recovery set pending_secret=null,pending_until=null,phone_hash=null,phone_until=null where student_id=new.id;
  end if;
  if new.phone is distinct from old.phone then
    update public.student_recovery set phone_verified=null,phone_hash=null,phone_until=null where student_id=new.id;
    update public.alternate_recovery set used=true where student_id=new.id and method='sms';
  end if;
  return new;
end $$;
create trigger invalidate_recovery before update of password_hash,phone on public.demo_students
for each row execute function public.invalidate_recovery_on_password_change();

-- Use the same student-first lock order as alternate recovery to avoid deadlocks
-- when two different grants attempt to reset the same account concurrently.
create or replace function public.complete_password_reset(p_grant_hash text,p_password text)
returns table(student_id uuid,email text,first_name text,event_id bigint)
language plpgsql security definer set search_path=public,extensions as $$
declare g public.reset_grants%rowtype; c public.otp_challenges%rowtype;
  s public.demo_students%rowtype; event bigint;
begin
  select * into g from public.reset_grants where grant_hash=p_grant_hash;
  if not found then return; end if;
  select * into s from public.demo_students where id=g.student_id and active for update;
  if not found then return; end if;
  select * into g from public.reset_grants where grant_hash=p_grant_hash and used_at is null and expires_at>now() for update;
  if not found then return; end if;
  select * into c from public.otp_challenges where id=g.challenge_id and verified_at is not null and locked_at is null;
  if not found then return; end if;
  if length(p_password) not between 12 and 128 or p_password !~ '[A-Z]' or p_password !~ '[a-z]'
    or p_password !~ '[0-9]' or p_password !~ '[^A-Za-z0-9]' or position(s.student_number in p_password)>0 then raise exception 'Password does not meet policy or contains student number'; end if;
  update public.demo_students set password_hash=crypt(p_password,gen_salt('bf',12)),password_changed_at=clock_timestamp(),must_change_password=false,temporary_password_expires_at=null where id=s.id;
  insert into public.audit_events(student_id,event_type,details) values(s.id,'password_reset_completed','{"email_notice":"queued"}') returning id into event;
  return query select s.id,s.email::text,s.first_name,event;
end $$;

revoke all on function public.recovery_rate(text,integer),public.recovery_settings(uuid,text,text,jsonb),public.alternate_start(text,text,text,text,text),public.alternate_verify(text,text,bigint,text),public.alternate_finish(text,text),public.invalidate_recovery_on_password_change() from public,anon,authenticated;
grant execute on function public.recovery_rate(text,integer),public.recovery_settings(uuid,text,text,jsonb),public.alternate_start(text,text,text,text,text),public.alternate_verify(text,text,bigint,text),public.alternate_finish(text,text) to service_role;
commit;
