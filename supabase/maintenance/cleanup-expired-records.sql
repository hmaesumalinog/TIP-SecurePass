-- Requires migrations/20260928090000_performance_and_delivery.sql.
-- This routine is also scheduled by the Netlify security-maintenance function.
-- Only expired operational state is deleted; audit/support history is retained.
select public.cleanup_expired_security_state();
