# Supabase Scripts

These scripts are organized by purpose so a new installation is not confused with an existing-database upgrade.

## New installation

Run the following files in the Supabase SQL Editor in this exact order:

1. `setup/01-core-schema.sql`
2. `setup/02-administrator-schema.sql`
3. `migrations/20260905071805_resumable_otp_delivery.sql`
4. `migrations/20260917090000_alternate_recovery.sql`
5. `migrations/20260920090000_student_owned_onboarding.sql`
6. `migrations/20260928090000_performance_and_delivery.sql`
7. `migrations/20261009090000_sessions_and_round_trips.sql`

The core script creates the student, sign-in-attempt, reset, OTP, grant, and audit structures. It deliberately creates no student credential; add students through the authenticated administrator portal.

The administrator script creates administrator accounts, two-step login challenges, administrator audit events, student-management functions, temporary-password onboarding, and Supabase Realtime publications. It does not create a default administrator account; see `docs/SETUP_AND_DEPLOYMENT.md` for the one-time administrator statement.

## Existing installation upgrades

Use these only when their feature is missing from an existing database:

- `upgrades/student-portal-auth.sql`
- `upgrades/temporary-password-onboarding.sql`

After the earlier applicable upgrades, apply the timestamped files in `migrations/` in filename order. The September 28 migration adds bounded provider-delivery checks, atomic access-attempt reservations, read-only recovery status, smaller admin reporting queries, supporting indexes, and an expired-state cleanup RPC. Apply it before deploying the matching functions and browser controllers. Failed/uncertain sends count toward the send limit because a provider timeout can still result in delivery.

The October 9 migration adds sign-out revocation (`session_version`), constant-work sign-in for unknown accounts, and combined functions that let each common request finish in one database call: `student_context`, `admin_read`, `admin_change_token`, `verify_reset_otp`, `prepare_password_reset`, and the sign-in helpers. It is additive; earlier functions remain for an older deploy during release or rollback.

Review each script and back up important data before running an upgrade. Do not execute an upgrade merely because it appears in this folder; confirm whether its schema changes are already present.

## Maintenance

`security-maintenance` on Netlify calls `cleanup_expired_security_state()` four times daily after the September 28 upgrade. It removes at most 500 old rows per operational table per run, plus dependent expired artifacts. Audit history, support requests, student profiles, and recovery methods are retained. `maintenance/cleanup-expired-records.sql` invokes the same bounded routine for a manual maintenance run.

## Access model

Project tables use row-level security without public browser policies. Database access is performed by Netlify Functions using a server-only Supabase secret key. Never copy that key into SQL comments, frontend code, documentation, or screenshots.
