-- Persist the challenge before sending SMS so refreshes can resume safely.
alter table public.otp_challenges
  add column if not exists delivery_status text not null default 'sent',
  add column if not exists delivery_channel text not null default 'sms';

create or replace function public.prepare_reset_otp(
  p_token_hash text, p_otp_hash text, p_resend boolean default false,
  p_previous_id uuid default null
) returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare
  t public.reset_tokens%rowtype;
  c public.otp_challenges%rowtype;
  v_phone text;
  v_retry integer;
begin
  select * into t from public.reset_tokens r where r.token_hash=p_token_hash for update;
  if not found or t.used_at is not null or t.expires_at <= now() then
    return jsonb_build_object('status','invalid');
  end if;
  select s.phone into v_phone from public.demo_students s where s.id=t.student_id and s.active;
  if not found then return jsonb_build_object('status','invalid'); end if;
  select * into c from public.otp_challenges o where o.reset_token_id=t.id
    order by o.created_at desc, o.id desc limit 1;
  v_retry := greatest(0,ceil(extract(epoch from(t.otp_last_issued_at + interval '60 seconds'-now())))::integer);
  if c.verified_at is not null then return jsonb_build_object('status','verified'); end if;
  -- A second click with the old challenge id resumes the newly issued challenge.
  if c.id is not null and (not p_resend or c.id is distinct from p_previous_id or v_retry>0) then
    return jsonb_build_object('status',case
      when c.locked_at is not null then 'locked'
      when c.expires_at<=now() then 'expired'
      when c.delivery_status='pending' and c.created_at<now()-interval '30 seconds' then 'failed'
      when c.delivery_status='sent' then 'active'
      else c.delivery_status end,
      'challenge_id',c.id,'phone',v_phone,'expires_at',c.expires_at,
      'retry_after',v_retry,'remaining_sends',greatest(0,3-t.otp_issued_count));
  end if;
  if t.otp_issued_count>=3 then return jsonb_build_object('status','limited'); end if;
  if v_retry>0 then return jsonb_build_object('status','pending','retry_after',v_retry); end if;
  if p_otp_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid OTP digest'; end if;
  update public.otp_challenges o set locked_at=now() where o.reset_token_id=t.id and o.locked_at is null;
  update public.reset_tokens r set otp_issued_count=r.otp_issued_count+1,otp_last_issued_at=now() where r.id=t.id;
  insert into public.otp_challenges(reset_token_id,student_id,otp_hash,expires_at,delivery_status)
    values(t.id,t.student_id,p_otp_hash,least(now()+interval '5 minutes',t.expires_at),'pending') returning * into c;
  return jsonb_build_object('status','reserved','challenge_id',c.id,'student_id',t.student_id,
    'phone',v_phone,'expires_at',c.expires_at,'retry_after',60,'remaining_sends',2-t.otp_issued_count);
end $$;
revoke all on function public.prepare_reset_otp(text,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.prepare_reset_otp(text,text,boolean,uuid) to service_role;
