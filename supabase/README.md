# Supabase Scripts

These scripts are organized by purpose so a new installation is not confused with an existing-database upgrade.

## New installation

Run the following files in the Supabase SQL Editor in this exact order:

1. `setup/01-core-schema.sql`
2. `setup/02-administrator-schema.sql`

The core script creates the student, sign-in-attempt, reset, OTP, grant, and audit structures. It deliberately creates no student credential; add students through the authenticated administrator portal.

The administrator script creates administrator accounts, two-step login challenges, administrator audit events, student-management functions, temporary-password onboarding, and Supabase Realtime publications. It does not create a default administrator account; see `docs/SETUP_AND_DEPLOYMENT.md` for the one-time administrator statement.

## Existing installation upgrades

Use these only when their feature is missing from an existing database:

- `upgrades/student-portal-auth.sql`
- `upgrades/temporary-password-onboarding.sql`

After the earlier applicable upgrades, apply the timestamped file in `migrations/`. The current hardening migration adds atomic OTP attempt handling, sign-in throttling records, reset-code issuance limits, exact student-number password checks, and dashboard aggregates.

Review each script and back up important data before running an upgrade. Do not execute an upgrade merely because it appears in this folder; confirm whether its schema changes are already present.

## Maintenance

`maintenance/cleanup-expired-records.sql` removes expired one-time reset workflow records. Review its retention periods before manual execution or scheduling.

## Access model

Project tables use row-level security without public browser policies. Database access is performed by Netlify Functions using a server-only Supabase secret key. Never copy that key into SQL comments, frontend code, documentation, or screenshots.
