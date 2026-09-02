-- TIP SecurePass administrator database schema.
-- Run after 01-core-schema.sql. This script does not create an administrator
-- credential; create the first administrator separately during setup.

create table if not exists public.admin_accounts (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  display_name text not null,
  password_hash text not null,
  role text not null default 'super_admin' check (role in ('super_admin', 'viewer')),
  active boolean not null default true,
  password_changed_at timestamptz not null default now(),
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_login_attempts (
  id bigint generated always as identity primary key,
  email_hash text not null,
  ip_hash text not null,
  succeeded boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists admin_login_attempts_email_time_idx on public.admin_login_attempts(email_hash, created_at desc);
create index if not exists admin_login_attempts_ip_time_idx on public.admin_login_attempts(ip_hash, created_at desc);

create table if not exists public.admin_login_challenges (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.admin_accounts(id) on delete cascade,
  otp_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  verified_at timestamptz,
  locked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists admin_login_challenges_admin_time_idx on public.admin_login_challenges(admin_id, created_at desc);

create table if not exists public.admin_audit_events (
  id bigint generated always as identity primary key,
  admin_id uuid references public.admin_accounts(id) on delete set null,
  event_type text not null,
  target_student_id uuid references public.demo_students(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_events_time_idx on public.admin_audit_events(created_at desc);

alter table public.admin_accounts enable row level security;
alter table public.admin_login_attempts enable row level security;
alter table public.admin_login_challenges enable row level security;
alter table public.admin_audit_events enable row level security;

create or replace function public.authenticate_admin(p_email text, p_password text)
returns table(id uuid, email text, display_name text, role text, password_changed_at timestamptz)
language sql
security definer
set search_path = public, extensions
as $$
  select a.id, a.email::text, a.display_name, a.role, a.password_changed_at
  from public.admin_accounts a
  where a.active = true
    and a.email = p_email
    and a.password_hash = crypt(p_password, a.password_hash)
  limit 1;
$$;

create or replace function public.admin_create_demo_student(
  p_student_number text, p_email text, p_first_name text, p_last_name text,
  p_age integer, p_phone text, p_program text, p_year_level text,
  p_temporary_password text
)
returns table(id uuid, student_number text, email text, password_changed_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_student public.demo_students%rowtype;
begin
  if p_student_number !~ '^[0-9]{7}$' then raise exception 'Student number must contain exactly 7 digits'; end if;
  if p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email address is invalid'; end if;
  if length(trim(p_first_name)) < 1 or length(trim(p_last_name)) < 1 then raise exception 'Student name is required'; end if;
  if p_age < 15 or p_age > 100 then raise exception 'Age is invalid'; end if;
  if length(regexp_replace(p_phone, '[^0-9]', '', 'g')) < 10 then raise exception 'Phone number is invalid'; end if;
  if length(p_temporary_password) < 12 or length(p_temporary_password) > 128 then raise exception 'Temporary password is invalid'; end if;

  insert into public.demo_students (
    student_number, email, first_name, last_name, age, phone, program,
    year_level, password_hash, active, must_change_password,
    temporary_password_expires_at, password_changed_at
  ) values (
    p_student_number, lower(trim(p_email)), trim(p_first_name), trim(p_last_name),
    p_age, trim(p_phone), trim(p_program), trim(p_year_level),
    crypt(p_temporary_password, gen_salt('bf', 12)), true, true,
    now() + interval '24 hours', now()
  ) returning * into v_student;

  return query select v_student.id, v_student.student_number, v_student.email::text, v_student.password_changed_at;
end;
$$;

create or replace function public.admin_issue_temporary_password(p_student_id uuid, p_temporary_password text)
returns table(id uuid, student_number text, email text, first_name text, password_changed_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_student public.demo_students%rowtype;
begin
  if length(p_temporary_password) < 12 or length(p_temporary_password) > 128 then raise exception 'Temporary password is invalid'; end if;
  update public.demo_students
  set password_hash = crypt(p_temporary_password, gen_salt('bf', 12)),
      must_change_password = true,
      temporary_password_expires_at = now() + interval '24 hours',
      password_changed_at = now()
  where demo_students.id = p_student_id and active = true
  returning * into v_student;
  if not found then return; end if;
  return query select v_student.id, v_student.student_number, v_student.email::text, v_student.first_name, v_student.password_changed_at;
end;
$$;

create or replace function public.complete_first_login_password(p_student_id uuid, p_password text)
returns table(id uuid, email text, first_name text, password_changed_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_student public.demo_students%rowtype; v_changed_at timestamptz;
begin
  if length(p_password) < 12 or length(p_password) > 128
     or p_password !~ '[A-Z]' or p_password !~ '[a-z]'
     or p_password !~ '[0-9]' or p_password !~ '[^A-Za-z0-9]' then
    raise exception 'Password does not meet the required policy';
  end if;
  select * into v_student from public.demo_students where demo_students.id = p_student_id for update;
  if not found or not v_student.active or not v_student.must_change_password
     or v_student.temporary_password_expires_at is null
     or v_student.temporary_password_expires_at <= now() then return; end if;
  if position(v_student.student_number in p_password) > 0 then
    raise exception 'Password must not contain the student number';
  end if;
  v_changed_at := clock_timestamp();
  update public.demo_students
  set password_hash = crypt(p_password, gen_salt('bf', 12)), must_change_password = false,
      temporary_password_expires_at = null, password_changed_at = v_changed_at
  where demo_students.id = v_student.id;
  insert into public.audit_events(student_id, event_type, details)
  values (v_student.id, 'first_login_password_completed', '{"temporary_password_invalidated":true}'::jsonb);
  return query select v_student.id, v_student.email::text, v_student.first_name, v_changed_at;
end;
$$;

revoke all on function public.authenticate_admin(text, text) from public, anon, authenticated;
revoke all on function public.admin_create_demo_student(text, text, text, text, integer, text, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_issue_temporary_password(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_first_login_password(uuid, text) from public, anon, authenticated;
grant execute on function public.authenticate_admin(text, text) to service_role;
grant execute on function public.admin_create_demo_student(text, text, text, text, integer, text, text, text, text) to service_role;
grant execute on function public.admin_issue_temporary_password(uuid, text) to service_role;
grant execute on function public.complete_first_login_password(uuid, text) to service_role;

create or replace function public.consume_admin_otp_attempt(p_challenge_id uuid, p_correct boolean)
returns table(status text, admin_id uuid, attempts integer, remaining integer)
language plpgsql security definer set search_path = public, extensions
as $$
declare v_challenge public.admin_login_challenges%rowtype; v_attempts integer;
begin
  select * into v_challenge from public.admin_login_challenges where id = p_challenge_id for update;
  if not found or v_challenge.verified_at is not null or v_challenge.locked_at is not null or v_challenge.expires_at <= now() then
    return query select 'invalid'::text, null::uuid, 0, 0; return;
  end if;
  if v_challenge.attempts >= 5 then return query select 'locked'::text, v_challenge.admin_id, v_challenge.attempts, 0; return; end if;
  v_attempts := v_challenge.attempts + 1;
  update public.admin_login_challenges set attempts = v_attempts,
    verified_at = case when p_correct then now() else verified_at end,
    locked_at = case when not p_correct and v_attempts >= 5 then now() else locked_at end
  where id = v_challenge.id;
  return query select case when p_correct then 'verified' when v_attempts >= 5 then 'locked' else 'incorrect' end,
    v_challenge.admin_id, v_attempts, greatest(0, 5 - v_attempts);
end;
$$;

create or replace function public.security_dashboard_metrics()
returns table(students bigint, active bigint, resets bigint, failures bigint)
language sql security definer set search_path = public, extensions
as $$
  select
    (select count(*) from public.demo_students),
    (select count(*) from public.demo_students s where s.active = true),
    (select count(*) from public.audit_events where event_type = 'password_reset_completed'),
    (select count(*) from public.audit_events where event_type = 'login_failed');
$$;

revoke all on function public.consume_admin_otp_attempt(uuid, boolean) from public, anon, authenticated;
revoke all on function public.security_dashboard_metrics() from public, anon, authenticated;
grant execute on function public.consume_admin_otp_attempt(uuid, boolean) to service_role;
grant execute on function public.security_dashboard_metrics() to service_role;

-- Make changes visible to Supabase Realtime when a permitted subscriber is used.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'demo_students') then
    alter publication supabase_realtime add table public.demo_students;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'audit_events') then
    alter publication supabase_realtime add table public.audit_events;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'admin_audit_events') then
    alter publication supabase_realtime add table public.admin_audit_events;
  end if;
end $$;
