-- Removes expired reset artifacts that are older than one day.
-- Run manually during maintenance or schedule with Supabase Cron.
delete from public.reset_grants where expires_at < now() - interval '1 day';
delete from public.otp_challenges where expires_at < now() - interval '1 day';
delete from public.reset_tokens where expires_at < now() - interval '1 day';
delete from public.reset_requests where created_at < now() - interval '1 day';
delete from public.student_login_attempts where created_at < now() - interval '1 day';
delete from public.admin_login_challenges where expires_at < now() - interval '1 day';
delete from public.admin_login_attempts where created_at < now() - interval '1 day';
