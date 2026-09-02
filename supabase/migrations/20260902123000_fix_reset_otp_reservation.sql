-- Fix an output-column name collision in reserve_reset_otp.
-- Without the table alias, PostgreSQL can interpret reset_token_id as either
-- the return column or the otp_challenges column and reject the reservation.

create or replace function public.reserve_reset_otp(p_token_hash text)
returns table(status text, reset_token_id uuid, student_id uuid, phone text, retry_after integer)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token public.reset_tokens%rowtype;
  v_phone text;
  v_retry integer;
begin
  select * into v_token
  from public.reset_tokens
  where token_hash = p_token_hash
  for update;

  if not found or v_token.used_at is not null or v_token.expires_at <= now() then
    return query select 'invalid'::text, null::uuid, null::uuid, null::text, 0;
    return;
  end if;

  if v_token.otp_issued_count >= 3 then
    return query select 'limited'::text, v_token.id, v_token.student_id, null::text, 0;
    return;
  end if;

  if v_token.otp_last_issued_at is not null
     and v_token.otp_last_issued_at > now() - interval '60 seconds' then
    v_retry := greatest(
      1,
      ceil(extract(epoch from (
        v_token.otp_last_issued_at + interval '60 seconds' - now()
      )))::integer
    );
    return query select 'cooldown'::text, v_token.id, v_token.student_id, null::text, v_retry;
    return;
  end if;

  select s.phone into v_phone
  from public.demo_students as s
  where s.id = v_token.student_id and s.active = true;

  if not found then
    return query select 'invalid'::text, null::uuid, null::uuid, null::text, 0;
    return;
  end if;

  update public.reset_tokens
  set otp_issued_count = otp_issued_count + 1,
      otp_last_issued_at = now()
  where id = v_token.id;

  update public.otp_challenges as challenge
  set locked_at = now()
  where challenge.reset_token_id = v_token.id
    and challenge.locked_at is null;

  return query
  select 'reserved'::text, v_token.id, v_token.student_id, v_phone, 0;
end;
$$;

revoke all on function public.reserve_reset_otp(text)
from public, anon, authenticated;
grant execute on function public.reserve_reset_otp(text) to service_role;
