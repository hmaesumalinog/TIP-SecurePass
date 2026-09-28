-- Apply after student_owned_onboarding. All APIs remain server-only.
begin;

alter table public.otp_challenges
  add column if not exists provider_reference text,
  add column if not exists delivery_issue text,
  add column if not exists delivery_checked_at timestamptz,
  add column if not exists delivery_check_count integer not null default 0;

create function public.prepare_reset_otp_v2(
  p_token_hash text, p_otp_hash text, p_resend boolean default false,
  p_previous_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare t reset_tokens%rowtype; c otp_challenges%rowtype; v_phone text; v_retry integer; v_check boolean:=false;
begin
  select * into t from reset_tokens where token_hash=p_token_hash for update;
  if not found or t.used_at is not null or t.expires_at<=now() then return jsonb_build_object('status','invalid'); end if;
  select phone into v_phone from demo_students where id=t.student_id and active;
  if not found then return jsonb_build_object('status','invalid'); end if;
  select * into c from otp_challenges where reset_token_id=t.id order by created_at desc,id desc limit 1;
  v_retry:=greatest(0,ceil(extract(epoch from(t.otp_last_issued_at+interval '60 seconds'-now())))::integer);
  if c.verified_at is not null then return jsonb_build_object('status','verified'); end if;
  if c.id is not null and (not p_resend or c.id is distinct from p_previous_id or v_retry>0 or c.delivery_issue='content_rejected') then
    -- Reserve a read-only provider lookup across tabs. Never send another SMS here.
    if c.locked_at is null and c.expires_at>now() and c.provider_reference is not null
      and c.delivery_status in ('pending','unknown') and c.delivery_check_count<8
      and (c.delivery_checked_at is null or c.delivery_checked_at<now()-interval '5 seconds') then
      update otp_challenges set delivery_checked_at=now(),delivery_check_count=delivery_check_count+1 where id=c.id;
      v_check:=true;
    end if;
    return jsonb_build_object('status',case
      when c.locked_at is not null then 'locked' when c.expires_at<=now() then 'expired'
      when c.delivery_status='sent' then 'active'
      when c.delivery_status in ('pending','unknown') and
        (c.delivery_check_count>=8 or (c.provider_reference is null and c.created_at<now()-interval '30 seconds')) then 'unknown'
      else c.delivery_status end,
      'challenge_id',c.id,'phone',v_phone,'expires_at',c.expires_at,'retry_after',v_retry,
      'remaining_sends',case when c.delivery_issue='content_rejected' then 0 else greatest(0,3-t.otp_issued_count) end,
      'provider_reference',c.provider_reference,'delivery_channel',c.delivery_channel,
      'delivery_issue',c.delivery_issue,'check_delivery',v_check);
  end if;
  if t.otp_issued_count>=3 then return jsonb_build_object('status','limited'); end if;
  if v_retry>0 then return jsonb_build_object('status','pending','retry_after',v_retry); end if;
  if p_otp_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid OTP digest'; end if;
  update otp_challenges set locked_at=now() where reset_token_id=t.id and locked_at is null;
  update reset_tokens set otp_issued_count=otp_issued_count+1,otp_last_issued_at=now() where id=t.id;
  insert into otp_challenges(reset_token_id,student_id,otp_hash,expires_at,delivery_status)
    values(t.id,t.student_id,p_otp_hash,least(now()+interval '5 minutes',t.expires_at),'pending') returning * into c;
  return jsonb_build_object('status','reserved','challenge_id',c.id,'student_id',t.student_id,'phone',v_phone,
    'expires_at',c.expires_at,'retry_after',60,'remaining_sends',2-t.otp_issued_count);
end $$;

-- Status reads do not insert rows or acquire the enrollment mutation locks.
create function public.recovery_status(p_sid uuid,p_version text) returns jsonb
language sql stable security definer set search_path=public,extensions as $$
  select coalesce((select jsonb_build_object('status','ok','enabled',r.secret is not null,
    'phoneVerified',coalesce(nullif(s.phone,'')=r.phone_verified,false),
    'remaining',jsonb_array_length(coalesce(r.codes,'[]')))
    from demo_students s left join student_recovery r on r.student_id=s.id
    where s.id=p_sid and s.active and not s.must_change_password
      and s.password_changed_at is not distinct from nullif(p_version,'')::timestamptz),
    jsonb_build_object('status','unauthorized'));
$$;

-- Reserve an attempt before authentication. In-flight attempts count as failures
-- until the server marks that exact reservation successful. All checks are bounded.
create function public.reserve_access_attempt(p_kind text,p_identifier text,p_ip text) returns bigint
language plpgsql security definer set search_path=public,extensions as $$
declare v_id bigint; v_since timestamptz:=now()-interval '15 minutes'; v_limit integer; v_ip_limit integer;
  v_table text; v_column text; v_failed text; v_count integer; v_ip_count integer; v_lock text;
begin
  if p_identifier !~ '^[a-f0-9]{64}$' or p_ip !~ '^[a-f0-9]{64}$' then raise exception 'Invalid rate key'; end if;
  case p_kind
    when 'student' then v_table:='student_login_attempts';v_column:='student_number_hash';v_limit:=5;v_ip_limit:=12;v_failed:='and not succeeded';
    when 'admin' then v_table:='admin_login_attempts';v_column:='email_hash';v_limit:=5;v_ip_limit:=12;v_failed:='and not succeeded';
    when 'reset' then v_table:='reset_requests';v_column:='identifier_hash';v_limit:=3;v_ip_limit:=8;v_failed:='';
    else raise exception 'Invalid rate scope';
  end case;
  -- Sorted row locks serialize each identifier/IP pair and prevent lock cycles.
  -- These small lock records share the existing one-day operational cleanup.
  for v_lock in select distinct k from unnest(array[
    'access:'||p_kind||':id:'||p_identifier,'access:'||p_kind||':ip:'||p_ip]) k order by k
  loop
    insert into recovery_limits as r(key,hits,window_at) values(v_lock,0,now())
      on conflict(key) do update set window_at=excluded.window_at;
  end loop;
  execute format('select count(*) from (select 1 from %I where %I=$1 and created_at>$2 %s limit %s) a',v_table,v_column,v_failed,v_limit)
    into v_count using p_identifier,v_since;
  execute format('select count(*) from (select 1 from %I where ip_hash=$1 and created_at>$2 %s limit %s) a',v_table,v_failed,v_ip_limit)
    into v_ip_count using p_ip,v_since;
  if v_count>=v_limit or v_ip_count>=v_ip_limit then return null; end if;
  if p_kind='reset' then
    insert into reset_requests(identifier_hash,ip_hash) values(p_identifier,p_ip) returning id into v_id;
  elsif p_kind='student' then
    insert into student_login_attempts(student_number_hash,ip_hash,succeeded) values(p_identifier,p_ip,false) returning id into v_id;
  else
    insert into admin_login_attempts(email_hash,ip_hash,succeeded) values(p_identifier,p_ip,false) returning id into v_id;
  end if;
  return v_id;
end $$;

create function public.reserve_admin_login_challenge(p_admin uuid,p_hash text) returns uuid
language plpgsql security definer set search_path=public,extensions as $$
declare v_id uuid; v_count integer;
begin
  perform 1 from admin_accounts where id=p_admin and active for update;
  if not found or p_hash !~ '^[a-f0-9]{64}$' then return null; end if;
  select count(*) into v_count from (select 1 from admin_login_challenges
    where admin_id=p_admin and created_at>now()-interval '15 minutes' limit 3) a;
  if v_count>=3 then return null; end if;
  insert into admin_login_challenges(admin_id,otp_hash,expires_at)
    values(p_admin,p_hash,now()+interval '5 minutes') returning id into v_id;
  return v_id;
end $$;

create index if not exists audit_events_time_id_idx on audit_events(created_at desc,id desc);
create index if not exists audit_events_type_time_idx on audit_events(event_type,created_at desc);
create index if not exists admin_audit_events_time_id_idx on admin_audit_events(created_at desc,id desc);
create index if not exists students_created_id_idx on demo_students(created_at desc,id);
create index if not exists recovery_help_status_time_idx on recovery_help_requests(status,created_at desc,id);
create index if not exists recovery_help_student_time_idx on recovery_help_requests(student_number,created_at desc,id);

create function public.admin_recent_security_events() returns jsonb
language sql stable security definer set search_path=public,extensions as $$
  with recent as (
    (select 's-'||e.id as id,e.event_type,e.created_at,e.student_id,'student' as source,
      'Student / system' as actor from audit_events e order by e.created_at desc,e.id desc limit 8)
    union all
    (select 'a-'||e.id,e.event_type,e.created_at,e.target_student_id,'admin',coalesce(a.display_name,'Administrator / system')
      from admin_audit_events e left join admin_accounts a on a.id=e.admin_id order by e.created_at desc,e.id desc limit 8)
  ), page as (
    select * from recent order by created_at desc,id desc limit 8
  ) select coalesce(jsonb_agg(to_jsonb(page)||jsonb_build_object('student_number',s.student_number,
    'student_name',concat_ws(' ',s.first_name,s.last_name)) order by page.created_at desc,page.id desc),'[]')
    from page left join demo_students s on s.id=page.student_id;
$$;

create function public.admin_student_directory_v2(p_search text default '',p_filter text default '',p_page integer default 1)
returns jsonb language sql stable security definer set search_path=public,extensions as $$
  with page as materialized (
    select * from admin_student_security s where (p_filter='' or s.security_status=p_filter)
      and (p_search='' or position(lower(p_search) in lower(s.student_number||' '||s.first_name||' '||s.last_name||' '||s.email))>0)
    order by created_at desc,id limit 21 offset (greatest(1,least(p_page,100000))-1)*20
  ), visible as (select * from page order by created_at desc,id limit 20)
  select jsonb_build_object('students',coalesce((select jsonb_agg(to_jsonb(visible)-'birth_date' order by created_at desc,id) from visible),'[]'),
    'hasMore',(select count(*)>20 from page),'page',greatest(1,p_page),'pageSize',20,
    'pendingRequests',(select count(*) from recovery_help_requests where status in ('pending','reviewing')));
$$;

create function public.admin_security_events_v2(p_search text default '',p_category text default '',p_page integer default 1)
returns jsonb language sql stable security definer set search_path=public,extensions as $$
  with events as (
    select 's-'||e.id as id,e.event_type,e.created_at,e.student_id,'student'::text as source,'Student / system'::text as actor from audit_events e
    union all
    select 'a-'||e.id,e.event_type,e.created_at,e.target_student_id,'admin',coalesce(a.display_name,'Administrator / system')
      from admin_audit_events e left join admin_accounts a on a.id=e.admin_id
  ), page as materialized (
    select e.*,s.student_number,concat_ws(' ',s.first_name,s.last_name) as student_name
    from events e left join demo_students s on s.id=e.student_id
    where (p_category='' or e.source=p_category)
      and (p_search='' or position(lower(p_search) in lower(concat_ws(' ',e.event_type,replace(e.event_type,'_',' '),s.student_number,s.first_name,s.last_name,e.actor)))>0)
    order by e.created_at desc,e.id desc limit 26 offset (greatest(1,least(p_page,100000))-1)*25
  ), visible as (select * from page order by created_at desc,id desc limit 25)
  select jsonb_build_object('events',coalesce((select jsonb_agg(visible order by created_at desc,id desc) from visible),'[]'),
    'hasMore',(select count(*)>25 from page),'page',greatest(1,p_page),'pageSize',25,
    'pendingRequests',(select count(*) from recovery_help_requests where status in ('pending','reviewing')));
$$;

create function public.admin_recovery_queue(p_status text,p_number text,p_page integer) returns jsonb
language sql stable security definer set search_path=public,extensions as $$
  with page as materialized (
    select id,student_number,status,created_at,updated_at from recovery_help_requests
    where (p_number='' or student_number=p_number)
      and (p_status='all' or (p_status='open' and status in ('pending','reviewing')) or status=p_status)
    order by created_at desc,id limit 21 offset (greatest(1,least(p_page,100000))-1)*20
  ), visible as (select * from page order by created_at desc,id limit 20)
  select jsonb_build_object('requests',coalesce((select jsonb_agg(visible order by created_at desc,id) from visible),'[]'),
    'hasMore',(select count(*)>20 from page),'page',greatest(1,p_page),'pageSize',20,
    'pendingRequests',(select count(*) from recovery_help_requests where status in ('pending','reviewing')));
$$;

-- Bounded maintenance removes only expired operational state. Audit and support
-- history remain intact until the owner chooses a separate retention policy.
create function public.cleanup_expired_security_state() returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare v_table text; v_column text; v_rows integer; v_counts jsonb:='{}';
begin
  foreach v_table in array array['reset_grants','otp_challenges','reset_tokens','reset_requests',
    'student_login_attempts','admin_login_challenges','admin_login_attempts','alternate_recovery','recovery_limits'] loop
    v_column:=case when v_table='recovery_limits' then 'window_at'
      when v_table in ('reset_requests','student_login_attempts','admin_login_attempts') then 'created_at' else 'expires_at' end;
    execute format('delete from %I where ctid in (select ctid from %I where %I<now()-interval ''1 day'' limit 500)',v_table,v_table,v_column);
    get diagnostics v_rows=row_count;
    v_counts:=v_counts||jsonb_build_object(v_table,v_rows);
  end loop;
  return v_counts;
end $$;

revoke all on function public.prepare_reset_otp_v2(text,text,boolean,uuid),public.admin_student_directory_v2(text,text,integer),
  public.admin_security_events_v2(text,text,integer),public.recovery_status(uuid,text),public.reserve_access_attempt(text,text,text),
  public.reserve_admin_login_challenge(uuid,text),public.admin_recent_security_events(),
  public.admin_recovery_queue(text,text,integer),public.cleanup_expired_security_state() from public,anon,authenticated;
grant execute on function public.prepare_reset_otp_v2(text,text,boolean,uuid),public.admin_student_directory_v2(text,text,integer),
  public.admin_security_events_v2(text,text,integer),public.recovery_status(uuid,text),public.reserve_access_attempt(text,text,text),
  public.reserve_admin_login_challenge(uuid,text),public.admin_recent_security_events(),
  public.admin_recovery_queue(text,text,integer),public.cleanup_expired_security_state() to service_role;
commit;
