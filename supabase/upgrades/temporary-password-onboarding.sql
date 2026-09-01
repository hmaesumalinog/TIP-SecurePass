-- Adds single-use, expiring temporary-password onboarding to an existing
-- TIP SecurePass installation. New installations receive this through the
-- administrator schema.

alter table public.demo_students
  add column if not exists must_change_password boolean not null default false,
  add column if not exists temporary_password_expires_at timestamptz;

drop function if exists public.admin_create_demo_student(text, text, text, text, integer, text, text, text);

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

  return query select v_student.id, v_student.student_number,
    v_student.email::text, v_student.password_changed_at;
end;
$$;

create or replace function public.admin_issue_temporary_password(
  p_student_id uuid, p_temporary_password text
)
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
  return query select v_student.id, v_student.student_number, v_student.email::text,
    v_student.first_name, v_student.password_changed_at;
end;
$$;

create or replace function public.complete_first_login_password(
  p_student_id uuid, p_password text
)
returns table(id uuid, email text, first_name text, password_changed_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_student public.demo_students%rowtype;
  v_changed_at timestamptz;
begin
  if length(p_password) < 12 or length(p_password) > 128
     or p_password !~ '[A-Z]' or p_password !~ '[a-z]'
     or p_password !~ '[0-9]' or p_password !~ '[^A-Za-z0-9]'
     or p_password ~ '20[0-9]{2}[- ]?[0-9]{4,}' then
    raise exception 'Password does not meet the required policy';
  end if;

  select * into v_student
  from public.demo_students
  where demo_students.id = p_student_id
  for update;

  if not found or not v_student.active or not v_student.must_change_password
     or v_student.temporary_password_expires_at is null
     or v_student.temporary_password_expires_at <= now() then
    return;
  end if;

  v_changed_at := clock_timestamp();
  update public.demo_students
  set password_hash = crypt(p_password, gen_salt('bf', 12)),
      must_change_password = false,
      temporary_password_expires_at = null,
      password_changed_at = v_changed_at
  where demo_students.id = v_student.id;

  insert into public.audit_events(student_id, event_type, details)
  values (v_student.id, 'first_login_password_completed', '{"temporary_password_invalidated":true}'::jsonb);

  return query select v_student.id, v_student.email::text, v_student.first_name, v_changed_at;
end;
$$;

-- An ordinary verified password reset also completes any still-pending setup.
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
     or p_password !~ '[0-9]' or p_password !~ '[^A-Za-z0-9]'
     or p_password ~ '20[0-9]{2}[- ]?[0-9]{4,}' then
    raise exception 'Password does not meet the required policy';
  end if;

  select * into v_grant from public.reset_grants
  where grant_hash = p_grant_hash and used_at is null and expires_at > now()
  for update;
  if not found then return; end if;

  select * into v_challenge from public.otp_challenges
  where id = v_grant.challenge_id and verified_at is not null and locked_at is null;
  if not found then return; end if;

  select * into v_student from public.demo_students where id = v_grant.student_id and active = true;
  if not found then return; end if;

  update public.demo_students
  set password_hash = crypt(p_password, gen_salt('bf', 12)), password_changed_at = now(),
      must_change_password = false, temporary_password_expires_at = null
  where id = v_student.id;
  update public.reset_grants set used_at = now() where id = v_grant.id;
  update public.reset_tokens set used_at = now() where id = v_challenge.reset_token_id;
  update public.otp_challenges set locked_at = now()
  where reset_token_id = v_challenge.reset_token_id and id <> v_challenge.id and locked_at is null;

  insert into public.audit_events(student_id, event_type, details)
  values (v_student.id, 'password_reset_completed', '{"email_notice":"queued"}'::jsonb)
  returning id into v_event_id;

  return query select v_student.id, v_student.email::text, v_student.first_name, v_event_id;
end;
$$;

drop function if exists public.authenticate_demo_student(text, text);

create function public.authenticate_demo_student(p_student_number text, p_password text)
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

revoke all on function public.admin_create_demo_student(text, text, text, text, integer, text, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_issue_temporary_password(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_first_login_password(uuid, text) from public, anon, authenticated;
revoke all on function public.complete_password_reset(text, text) from public, anon, authenticated;
revoke all on function public.authenticate_demo_student(text, text) from public, anon, authenticated;
grant execute on function public.admin_create_demo_student(text, text, text, text, integer, text, text, text, text) to service_role;
grant execute on function public.admin_issue_temporary_password(uuid, text) to service_role;
grant execute on function public.complete_first_login_password(uuid, text) to service_role;
grant execute on function public.complete_password_reset(text, text) to service_role;
grant execute on function public.authenticate_demo_student(text, text) to service_role;
