# Performance and operations

The application keeps public HTML/CSS/JavaScript on Netlify and uses server-only
functions for database access. Private API responses must remain `no-store`.
Reducing redundant reads must never bypass session revocation or role checks.

## Request budget

| Active view                          | Browser requests per automatic refresh | Supabase requests | Interval              |
| ------------------------------------ | -------------------------------------: | ----------------: | --------------------- |
| Admin dashboard                      |                                      1 |                 3 | 60 seconds            |
| Admin students, audit, recovery list |                                      1 |                 2 | 60 seconds            |
| Student portal                       |                        1 on navigation |                 2 | No background polling |

Admin background refresh pauses for hidden pages, offline devices, and open edit
dialogs. Failures back off to 120, 240, then 300 seconds. Manual refresh and
successful changes refresh immediately. Each visible tab has its own scheduler;
this is near-real-time polling, not a Supabase Realtime subscription.

Compared with the previous 30-second refresh and separate request badge,
steady-state list-view database requests fall from 8 to 2 per minute (75%).
Dashboard database requests fall from 6 to 3 per minute (50%). Student portal
reads fall from 4 to 2 (50%). These are code-derived request reductions, not a
promise of the same percentage reduction in billed bytes or response time.

## What to measure

1. In Supabase Usage, record Database Egress and the billing-cycle dates.
2. In Database Query Performance, inspect call counts, total execution time,
   mean time, and returned rows for reporting and recovery routines.
3. Check Netlify function invocation counts, failures, and duration.
4. Compare representative active-admin periods and normal student journeys.
   Avoid calling one network sample a page-load or database benchmark.
5. Use `EXPLAIN (ANALYZE, BUFFERS)` for read-only SQL on representative data before
   adding further indexes. Deep offset pagination and arbitrary substring
   search are still candidates for cursor/search-index work if the data grows.

The eight-event dashboard query and list pagination do not calculate an exact
total of the whole audit history. The directory and audit page show the current
page and enable Next only when another row exists. Dashboard summary counts
remain exact and are recalculated once per visible minute.

## Delivery and recovery

Provider acceptance, provider-reported sent status, and physical phone receipt
are distinct. Reset SMS status is persisted alongside the existing challenge.
Up to eight provider reads are allowed, at least five seconds apart. An expired,
replaced, locked, or verified challenge cannot initiate another delivery lookup.
No status check resends a code. A content rejection stops resending that message
for the same reset link. A network timeout stays uncertain because a code could
still arrive. OTP proof and expiry remain enforced in PostgreSQL.

Do not send test messages to real users as part of automated tests. The test
suite uses embedded PostgreSQL and mocked email/SMS transport. A live handset
check needs an explicitly scoped recipient and credit allowance.

## Maintenance and retention

`security-maintenance` runs at 00:43, 06:43, 12:43, and 18:43 UTC on production.
It deletes batches of expired operational records after a one-day buffer. Audit
events, recovery support requests/reviews, and enrolled recovery methods are
retained. Choose a separate archival/retention policy before deleting that
history. The existing bounded database health check remains independent.

## Release order

1. Run `npm test`; build the Netlify functions.
2. Apply the targeted September 28 migration to the correct Supabase project.
3. Verify its new RPCs and browser-role restrictions using read-only queries.
4. Deploy the matching frontend/functions together, then verify public routes,
   private endpoint authorization, pagination, and pending SMS presentation.
5. Confirm both scheduled functions are registered and inspect their logs.

The migration adds columns and new function versions without replacing the old
reporting or OTP functions. New controllers request `format=compact`; old tabs
still receive their expected list totals. A previous application deploy can
therefore coexist with the additive database upgrade during release or rollback.

## September 28 validation

- All 75 automated tests passed, including embedded PostgreSQL recovery,
  onboarding, enrollment, rate-limit, and SMS-status cases. Email and SMS were
  mocked; this did not send messages or reset a live student's password.
- Browser checks covered 39 page/viewport combinations at 320, 375, 768, and
  1280 pixels with no horizontal overflow or JavaScript page errors. The
  synthetic reset journey issued one SMS, verified its code, and saved a
  password. Rejected and uncertain delivery states were also exercised.
- The targeted migration was applied to the live project. All nine new RPCs
  were present and unavailable to browser roles. Legacy RPCs remain available
  to the server for old-tab and rollback compatibility.
- The live eight-event dashboard response measured 1,854 bytes versus 6,463
  bytes for the previous event-list response on the same small dataset. This
  approximately 71% reduction describes that response only, not total egress.
- Two consecutive live concurrency checks each admitted exactly 5 of 16
  simultaneous synthetic attempts and blocked 11. An initial run had one
  request error before these successful repeats; its cause was not captured.
  All test-only attempt and lock records were removed after each check.
- All 17 HTML pages had resolvable local file references. Formatting and the
  Netlify build passed; the production dependency audit reported no known
  vulnerabilities at the time of testing.

To repeat the local browser checks, start `tests/helpers/enrollment-preview.mjs`
and `tests/helpers/email-recovery-preview.mjs` with Node, then run
`tests/helpers/browser-review.mjs`. The helper needs Google Chrome and Playwright;
set `PLAYWRIGHT_PATH` to an installed Playwright package if it is not on the
project's dependency path. These preview servers use synthetic fixtures only.

The optional `tests/helpers/live-rate-limit-check.mjs` requires an explicit
`--project=ysrqbnplayazrbhjepyb` argument and the authorized Netlify CLI account.
It reads server credentials in memory, creates random test-only rate keys, and
cleans up only those exact keys. It never authenticates a student or sends a
message. Do not run it as an automated production monitor or load test.
