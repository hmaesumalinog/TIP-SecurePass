-- TIP SecurePass core database schema.
-- Run once in Supabase Dashboard -> SQL Editor for a new installation.
-- No login account is seeded. Create students through the administrator portal.

create extension if not exists pgcrypto;
create extension if not exists citext;

create table if not exists public.demo_students (
  id uuid primary key default gen_random_uuid(),
  student_number text not null unique check (student_number ~ '^[0-9]{7}$'),
  email citext not null unique,
  first_name text not null,
  last_name text not null default '',
  age integer check (age between 15 and 100),
  phone text not null,
  program text not null default 'Bachelor of Science in Information Technology',
  year_level text not null default '4th Year',
  password_hash text not null,
  active boolean not null default true,
  password_changed_at timestamptz,
  must_change_password boolean not null default false,
  temporary_password_expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.reset_requests (
  id bigint generated always as identity primary key,
  identifier_hash text not null,
  ip_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists reset_requests_identifier_time_idx on public.reset_requests(identifier_hash, created_at desc);
create index if not exists reset_requests_ip_time_idx on public.reset_requests(ip_hash, created_at desc);

create table if not exists public.student_login_attempts (
  id bigint generated always as identity primary key,
  student_number_hash text not null,
  ip_hash text not null,
  succeeded boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists student_login_attempts_number_time_idx on public.student_login_attempts(student_number_hash, created_at desc);
create index if not exists student_login_attempts_ip_time_idx on public.student_login_attempts(ip_hash, created_at desc);

create table if not exists public.reset_tokens (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.demo_students(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  otp_issued_count integer not null default 0 check (otp_issued_count between 0 and 3),
  otp_last_issued_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists reset_tokens_student_idx on public.reset_tokens(student_id, created_at desc);

create table if not exists public.otp_challenges (
  id uuid primary key default gen_random_uuid(),
  reset_token_id uuid not null references public.reset_tokens(id) on delete cascade,
  student_id uuid not null references public.demo_students(id) on delete cascade,
  otp_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  verified_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists otp_challenges_token_idx on public.otp_challenges(reset_token_id, created_at desc);

create table if not exists public.reset_grants (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null unique references public.otp_challenges(id) on delete cascade,
  student_id uuid not null references public.demo_students(id) on delete cascade,
  grant_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  student_id uuid references public.demo_students(id) on delete set null,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_events_student_time_idx on public.audit_events(student_id, created_at desc);

alter table public.demo_students enable row level security;
alter table public.reset_requests enable row level security;
alter table public.student_login_attempts enable row level security;
alter table public.reset_tokens enable row level security;
alter table public.otp_challenges enable row level security;
alter table public.reset_grants enable row level security;
alter table public.audit_events enable row level security;

-- No public policies are created. Only the server-side Supabase secret/service
-- role used by Netlify Functions can read or modify these tables.

create or replace function public.complete_password_reset(p_grant_hash text, p_password text)
returns table(student_id uuid, email text, first_name text, event_id bigint)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_grant public.reset_grants%rowtype;
  v_challenge public.otp_challenges%rowtype;
  v_student public.demo_students%rowtype;
  v_event_id bigint;
begin
  if length(p_password) < 12 or length(p_password) > 128
     or p_password !~ '[A-Z]' or p_password !~ '[a-z]'
     or p_password !~ '[0-9]' or p_password !~ '[^A-Za-z0-9]' then
    raise exception 'Password does not meet the required policy';
  end if;

  select * into v_grant
  from public.reset_grants
  where grant_hash = p_grant_hash and used_at is null and expires_at > now()
  for update;
  if not found then return; end if;

  select * into v_challenge
  from public.otp_challenges
  where id = v_grant.challenge_id and verified_at is not null and locked_at is null;
  if not found then return; end if;

  select * into v_student from public.demo_students where id = v_grant.student_id and active = true;
  if not found then return; end if;
  if position(v_student.student_number in p_password) > 0 then
    raise exception 'Password must not contain the student number';
  end if;

  update public.demo_students
  set password_hash = crypt(p_password, gen_salt('bf', 12)), password_changed_at = now(),
      must_change_password = false, temporary_password_expires_at = null
  where id = v_student.id;
  update public.reset_grants set used_at = now() where id = v_grant.id;
  update public.reset_tokens set used_at = now() where id = v_challenge.reset_token_id;
  update public.otp_challenges set locked_at = now() where reset_token_id = v_challenge.reset_token_id and id <> v_challenge.id and locked_at is null;

  insert into public.audit_events(student_id, event_type, details)
  values (v_student.id, 'password_reset_completed', '{"email_notice":"queued"}'::jsonb)
  returning id into v_event_id;

  return query select v_student.id, v_student.email::text, v_student.first_name, v_event_id;
end;
$$;

revoke all on function public.complete_password_reset(text, text) from public, anon, authenticated;
grant execute on function public.complete_password_reset(text, text) to service_role;

create or replace function public.reserve_reset_otp(p_token_hash text)
returns table(status text, reset_token_id uuid, student_id uuid, phone text, retry_after integer)
language plpgsql security definer set search_path = public, extensions
as $$
declare v_token public.reset_tokens%rowtype; v_phone text; v_retry integer;
begin
  select * into v_token from public.reset_tokens where token_hash = p_token_hash for update;
  if not found or v_token.used_at is not null or v_token.expires_at <= now() then
    return query select 'invalid'::text, null::uuid, null::uuid, null::text, 0; return;
  end if;
  if v_token.otp_issued_count >= 3 then
    return query select 'limited'::text, v_token.id, v_token.student_id, null::text, 0; return;
  end if;
  if v_token.otp_last_issued_at is not null and v_token.otp_last_issued_at > now() - interval '60 seconds' then
    v_retry := greatest(1, ceil(extract(epoch from (v_token.otp_last_issued_at + interval '60 seconds' - now())))::integer);
    return query select 'cooldown'::text, v_token.id, v_token.student_id, null::text, v_retry; return;
  end if;
  select s.phone into v_phone from public.demo_students s where s.id = v_token.student_id and s.active = true;
  if not found then return query select 'invalid'::text, null::uuid, null::uuid, null::text, 0; return; end if;
  update public.reset_tokens set otp_issued_count = otp_issued_count + 1, otp_last_issued_at = now() where id = v_token.id;
  update public.otp_challenges set locked_at = now() where reset_token_id = v_token.id and locked_at is null;
  return query select 'reserved'::text, v_token.id, v_token.student_id, v_phone, 0;
end;
$$;

create or replace function public.consume_student_otp_attempt(p_challenge_id uuid, p_correct boolean)
returns table(status text, student_id uuid, attempts integer, remaining integer)
language plpgsql security definer set search_path = public, extensions
as $$
declare v_challenge public.otp_challenges%rowtype; v_attempts integer;
begin
  select * into v_challenge from public.otp_challenges where id = p_challenge_id for update;
  if not found or v_challenge.verified_at is not null or v_challenge.locked_at is not null or v_challenge.expires_at <= now() then
    return query select 'invalid'::text, null::uuid, 0, 0; return;
  end if;
  if v_challenge.attempts >= 5 then return query select 'locked'::text, v_challenge.student_id, v_challenge.attempts, 0; return; end if;
  v_attempts := v_challenge.attempts + 1;
  if p_correct then
    update public.otp_challenges set attempts = v_attempts, verified_at = now() where id = v_challenge.id;
    return query select 'verified'::text, v_challenge.student_id, v_attempts, 5 - v_attempts;
  else
    update public.otp_challenges set attempts = v_attempts, locked_at = case when v_attempts >= 5 then now() else locked_at end where id = v_challenge.id;
    return query select case when v_attempts >= 5 then 'locked' else 'incorrect' end, v_challenge.student_id, v_attempts, greatest(0, 5 - v_attempts);
  end if;
end;
$$;

revoke all on function public.reserve_reset_otp(text) from public, anon, authenticated;
revoke all on function public.consume_student_otp_attempt(uuid, boolean) from public, anon, authenticated;
grant execute on function public.reserve_reset_otp(text) to service_role;
grant execute on function public.consume_student_otp_attempt(uuid, boolean) to service_role;

create or replace function public.authenticate_demo_student(p_student_number text, p_password text)
returns table(
  id uuid, student_number text, email text, first_name text, last_name text,
  age integer, phone text, program text, year_level text, password_changed_at timestamptz,
  must_change_password boolean, temporary_password_expires_at timestamptz
)
language sql
security definer
set search_path = public, extensions
as $$
  select s.id, s.student_number, s.email::text, s.first_name, s.last_name,
         s.age, s.phone, s.program, s.year_level, s.password_changed_at,
         s.must_change_password, s.temporary_password_expires_at
  from public.demo_students s
  where s.active = true
    and s.student_number = p_student_number
    and s.password_hash = crypt(p_password, s.password_hash)
  limit 1;
$$;

revoke all on function public.authenticate_demo_student(text, text) from public, anon, authenticated;
grant execute on function public.authenticate_demo_student(text, text) to service_role;
