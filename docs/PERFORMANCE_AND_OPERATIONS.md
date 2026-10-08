# Performance and operations

The application keeps public HTML/CSS/JavaScript on Netlify and uses server-only
functions for database access. Private API responses must remain `no-store`.
Reducing redundant reads must never bypass session revocation or role checks.

## Where the time goes

Netlify Functions run in Ohio (`us-east-2`, fixed on the Free plan) and the
database is in Mumbai (`ap-south-1`). Each database call therefore costs a
cross-region round trip, so the design keeps the number of calls per request
small rather than relying on caching.

| Request                    | Database calls before October 9 | Now |
| -------------------------- | ------------------------------: | --: |
| Student sign-in            |                               4 |   2 |
| Portal or profile load     |                               2 |   1 |
| Security & recovery change |                             4–6 | 2–3 |
| Phone-code verification    |                               4 |   1 |
| Any administrator view     |                               2 |   1 |
| Administrator sign-in      |                               5 |   2 |

All endpoints run in one function (`netlify/functions/api.mjs`). The first
request of a visit starts it for every later request, and the sign-in and
recovery pages start it with `/api/health` while the person is still typing.

## Live administrator updates

| What runs                         | Response body | Database calls      | How often                                           |
| --------------------------------- | ------------: | ------------------- | --------------------------------------------------- |
| Change check (`/api/admin/pulse`) |     ~40 bytes | 1 (indexed lookups) | Every 15 s while in use, 60 s when idle             |
| Full view reload                  |     view size | 1                   | Only when the change token differs, and every 5 min |

Open tabs share checks over a browser channel, so two visible tabs cost about
the same as one; a change made in one tab refreshes the others at once. Checks
stop while a page is hidden or offline and back off after failures. In a
real-time browser test, two visible tabs made 2 checks in 34 seconds (4 if each
tab checked separately), and a change appeared in both within about 12 seconds.

Compared with the previous 60-second full reload, an administrator now sees
other people's changes about four times sooner, while a quiet minute costs four
~40-byte checks instead of one full list or dashboard. This response size excludes HTTP headers and the database-to-function response; it is not a measurement of total database egress. This is near-real-time
polling through the server, not a Supabase Realtime subscription.

## Browser caching

Every CSS, JavaScript, and image reference carries a content hash
(`?v=...`). Netlify serves `/assets/*` with a one-year immutable cache, so
returning visitors load pages without revalidating assets, and an edited file
gets a new URL immediately. Run `npm run version-assets` after editing assets;
`npm test` fails if any reference is out of date.

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
remain exact and are recalculated when the dashboard reloads after a detected change or the five-minute fallback interval.

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
2. Apply only missing timestamped migrations through October 9, in filename order, to the correct Supabase project. Keep the database in its existing region.
3. Verify its new RPCs and browser-role restrictions using read-only queries.
4. Deploy the matching frontend/functions together, then verify public routes,
   private endpoint authorization, pagination, and pending SMS presentation.
5. Confirm both scheduled functions are registered and inspect their logs.

The migration adds columns and new function versions without replacing the old
reporting or OTP functions. New controllers request `format=compact`; old tabs
still receive their expected list totals. A previous application deploy can
therefore coexist with the additive database upgrade during release or rollback.

The October 9 deployment changes browser API URLs and requires the new session
secrets. Refresh already-open pages and sign in again after deployment. Older
per-function URLs are no longer exposed by the new application bundle. A rollback
of the application code does not undo database changes or replace server secrets.

## October 9 validation

- All 85 automated tests passed, including sign-out revocation, student/admin
  session isolation, constant-work authentication, legacy authenticator-secret
  decryption, combined database requests, OTP replay and delivery handling, asset
  versions, and shared administrator change checks.
- Local browser checks passed 39 page/viewport combinations. Production checks
  passed 36 public-page/viewport combinations at 320, 375, 768, and 1280 pixels,
  with no horizontal overflow or unexpected script, network, or CSP errors.
  The production dependency audit reported no known vulnerabilities at testing.
- The live database upgrade was verified: both session-version columns and all
  18 expected functions were present; browser roles could execute none of those
  functions, while the server role could execute all of them.
- Synthetic checks passed on both the draft and production deployments for first
  login, policy acceptance, authenticator enrollment, portal access, sign-out,
  email reset requests, backup-code/authenticator recovery, administrator views,
  and change tokens. All synthetic student and administrator records were removed.
- Live email tests used Resend's test inbox only. No live SMS was sent for this
  release. These checks do not establish inbox placement or handset delivery.
- Production samples measured profile requests at about 1.2–1.3 seconds and
  administrator views at about 0.6–1.2 seconds. These are small-sample observations,
  not load-tested guarantees. The database remains in Mumbai.

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
