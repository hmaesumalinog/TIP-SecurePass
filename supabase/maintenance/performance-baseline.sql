-- Read-only measurements. No credentials, account details, or message content.
select
  (select count(*) from public.demo_students) as students,
  (select count(*) from public.audit_events) as student_events,
  (select count(*) from public.admin_audit_events) as admin_events,
  pg_database_size(current_database()) as database_bytes,
  octet_length(public.admin_security_events('','',1)::text) as legacy_audit_payload_bytes;

explain (analyze, buffers)
select public.admin_security_summary(), public.admin_security_events('','',1);
