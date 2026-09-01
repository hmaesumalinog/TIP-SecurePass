-- Adds authenticated student-portal fields to an existing TIP SecurePass
-- installation. New installations already include these fields in the core schema.

alter table public.demo_students add column if not exists last_name text not null default '';
alter table public.demo_students add column if not exists age integer;
alter table public.demo_students add column if not exists program text not null default 'Bachelor of Science in Information Technology';
alter table public.demo_students add column if not exists year_level text not null default '4th Year';
alter table public.demo_students add column if not exists must_change_password boolean not null default false;
alter table public.demo_students add column if not exists temporary_password_expires_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'demo_students_age_check'
  ) then
    alter table public.demo_students
      add constraint demo_students_age_check check (age between 15 and 100);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'demo_students_number_format_check'
  ) then
    alter table public.demo_students
      add constraint demo_students_number_format_check check (student_number ~ '^[0-9]{7}$') not valid;
  end if;
end $$;

-- Existing nonconforming student numbers must be corrected before the format
-- constraint can be validated. New and updated rows are already protected by
-- the NOT VALID constraint added above.
do $$
begin
  if not exists (
    select 1 from public.demo_students
    where student_number !~ '^[0-9]{7}$'
  ) then
    alter table public.demo_students
      validate constraint demo_students_number_format_check;
  end if;
end $$;

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

revoke all on function public.authenticate_demo_student(text, text) from public, anon, authenticated;
grant execute on function public.authenticate_demo_student(text, text) to service_role;
