# Scheduled database health check

`netlify/functions/database-health.mjs` performs one read-only Supabase database
check every six hours on the published Netlify production deployment. It runs at
00:17, 06:17, 12:17 and 18:17 UTC (08:17, 14:17, 20:17 and 02:17 Philippine time).

The check uses the existing server-side Supabase environment variables. It sends
a HEAD request to `demo_students` selecting only `id`, limited to one row, without requesting
a count. No student records are returned, stored or logged. It sends no email or
SMS, makes no database writes and uses no browser polling or Realtime connection.
An empty `demo_students` table is also a successful health check.

There are approximately 120 invocations per 30 days. Response bodies contribute
zero bytes; HTTP headers, transport overhead and normal platform usage still
apply. Each request has a 10-second timeout and no application-level retry loop.

## Operations

In Netlify, open Functions, select `database-health`, and inspect its schedule and
logs. Use Run now to test it. Success logs contain only a fixed health message.
A failed request throws a sanitized error so the invocation is marked failed.
Failure does not automatically send a notification or resume a paused project.
If checks fail, inspect Supabase project status and the existing Netlify Supabase
environment configuration. Resume a paused project in the Supabase dashboard.

Scheduled functions are not public HTTP endpoints and run automatically only on
published production deployments. Local tests mock the database transport.
To remove the schedule, remove this function and redeploy.

This is a best-effort inactivity safeguard, not an uptime guarantee. Supabase
Free projects can still be paused for insufficient activity. A paid plan is the
supported way to prevent inactivity pausing.

References:

- https://supabase.com/docs/guides/platform/free-project-pausing
- https://docs.netlify.com/build/functions/scheduled-functions/
