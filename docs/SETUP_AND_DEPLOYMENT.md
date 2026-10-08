# Setup and Deployment

This guide describes a clean installation. For a client receiving the existing project, start with [Client handoff](CLIENT_HANDOFF.md). Existing deployed installations should use upgrade scripts only when their matching change has not already been applied.

## Prerequisites

- Node.js 20 or newer
- A Netlify site
- A Supabase project
- A verified Resend sending domain and API key
- A UniSMS account with an API key, approved sender ID, and available SMS credit
- A domain name is optional; the Netlify-provided domain also works

## 1. Prepare the database

Open the Supabase SQL Editor and run the new-installation scripts in this exact order:

1. `supabase/setup/01-core-schema.sql`
2. `supabase/setup/02-administrator-schema.sql`
3. `supabase/migrations/20260905071805_resumable_otp_delivery.sql`
4. `supabase/migrations/20260917090000_alternate_recovery.sql`
5. `supabase/migrations/20260920090000_student_owned_onboarding.sql`
6. `supabase/migrations/20260928090000_performance_and_delivery.sql`
7. `supabase/migrations/20261009090000_sessions_and_round_trips.sql`

The scripts do not create a default student credential. After creating the first administrator, use the administrator portal to add students.

The second script creates the administrator tables and functions but deliberately does not create a default administrator credential. Create the first administrator separately with values chosen for the project:

```sql
insert into public.admin_accounts (
  email,
  display_name,
  password_hash,
  role
)
values (
  'administrator@example.com',
  'Project Administrator',
  crypt('CHANGE_THIS_STRONG_PASSWORD', gen_salt('bf', 12)),
  'super_admin'
);
```

Replace the email and password before executing the statement. Run it once, do not place the resulting credential in project documentation, and store it using the client's approved password manager.

### Existing database

Do not rerun the complete setup merely to apply one later feature. The scripts under `supabase/upgrades/` are intended for an existing installation:

- `student-portal-auth.sql` adds or verifies the student profile and authentication fields.
- `temporary-password-onboarding.sql` adds the first-login temporary-password workflow.

Then apply only the missing timestamped migrations in filename order. The required sequence is also listed in [Supabase scripts](../supabase/README.md). Do not rerun a migration that has already been verified on the live project.

Review an upgrade in the SQL Editor before executing it and take a database backup for any environment containing important records.

## 2. Configure environment variables

Copy `.env.example` to `.env` for local development. Add equivalent values in **Netlify > Site configuration > Environment variables** for deployment.

| Variable                  |   Required | Purpose                                                                     |
| ------------------------- | ---------: | --------------------------------------------------------------------------- |
| `SITE_URL`                |        Yes | Public origin used when creating email links                                |
| `EMAIL_APP_NAME`          |        Yes | Name displayed in transactional email copy                                  |
| `SESSION_SECRET`          |        Yes | At least 32 random characters; signs student and administrator sessions     |
| `APP_PEPPER`              |        Yes | A different 32+ character value; keys one-time code and backup-code digests |
| `RECOVERY_ENCRYPTION_KEY` |        Yes | A third 32+ character value; encrypts authenticator secrets                 |
| `DEMO_MODE`               |         No | `true` shows simulated SMS codes only on `localhost` with no SMS provider   |
| `SUPABASE_URL`            |        Yes | Supabase project URL                                                        |
| `SUPABASE_SECRET_KEY`     |        Yes | Current server-only Supabase secret key                                     |
| `RESEND_API_KEY`          |        Yes | Server-only Resend API key                                                  |
| `RESEND_FROM`             |        Yes | Display name and address on a verified sending domain                       |
| `SMS_PROVIDER`            |        Yes | Set to `unisms` for the primary SMS integration                             |
| `UNISMS_BASE_URL`         |        Yes | Normally `https://unismsapi.com/api`                                        |
| `UNISMS_API_KEY`          |        Yes | Server-only UniSMS API key                                                  |
| `UNISMS_SENDER_ID`        |        Yes | Sender ID approved by UniSMS                                                |
| `UNISMS_TRIAL_MODE`       |        Yes | `true` restricts real messages to the configured test list                  |
| `UNISMS_ALLOWED_PHONE`    | Trial only | Comma-separated E.164 test numbers allowed in trial mode                    |

`SUPABASE_SERVICE_ROLE_KEY` is supported only as a legacy fallback. Prefer `SUPABASE_SECRET_KEY` for a new configuration.

Use three different values for the server secrets. See [Security notes](SECURITY.md) for what rotating each one affects.

### Secret-handling rules

- Never add `.env` to the client package or Git repository.
- Never place a server key in `public/`, `netlify.toml`, screenshots, reports, or presentation slides.
- Use protected environment-variable scopes in Netlify.
- Rotate a key immediately if it is accidentally exposed.
- After changing environment variables, create a new deployment so the functions receive the updated values.

## 3. Run locally

See [Administrator and onboarding guide](ADMIN_AND_ONBOARDING.md)
for the new invitation, policy, phone-verification and review workflows.

From the project root:

```bash
npm ci
cp .env.example .env
# Replace every placeholder needed for the selected environment.
npx netlify dev
```

Open `http://localhost:8888` for the student site and `http://localhost:8888/admin/login` for the administrator site.

On Windows, copy `.env.example` to `.env` using File Explorer or `Copy-Item .env.example .env` in PowerShell. The npm commands are the same.

Local HTTPS-only cookies may behave differently from deployed HTTPS in some browsers. Use the deployed test site for final session and provider verification.

## 4. Validate before deployment

Run:

```bash
npm run version-assets
npm test
npx netlify build
```

`npm run version-assets` gives every CSS, JavaScript, and image reference a content-based version, which lets browsers cache assets for a year. The test suite fails if a reference is out of date.

Also perform a fresh end-to-end test using authorized test data:

1. Create or identify a test student.
2. Confirm the welcome or reset email arrives and its link opens the expected domain.
3. Confirm the SMS reaches the registered E.164 phone number.
4. Confirm an incorrect OTP is rejected and the correct OTP advances once.
5. Set a new password and confirm the old password no longer signs in.
6. Confirm the profile belongs to the signed-in student.
7. Confirm the administrator audit view records the expected event.

Automated tests do not prove current email reputation, SMS account funding, DNS state, or provider approval. Those items require live provider checks.

## 5. Deploy on Netlify

The project requires no frontend build command. Netlify reads `netlify.toml`, publishes `public/`, and bundles `netlify/functions/`.

The current site uses manual deployments. After validation, run:

```bash
npm run build
npx netlify deploy --prod --no-build
```

Pushing to GitHub updates the source repository; it does not publish this site unless a Git build integration is separately enabled. Confirm the deployed site ID before publishing.

For a Git-connected site:

1. Apply any new file in `supabase/migrations/` to the database before deploying the code that uses it.
2. Push the clean source folder to the selected repository.
3. Import or connect the repository in Netlify.
4. Confirm the publish directory is `public` and functions directory is `netlify/functions`.
5. Add all required environment variables.
6. Deploy the site.
7. Verify `/`, `/forgot.html`, `/admin/login`, and a complete authorized reset workflow.

For a custom domain, point the domain's DNS to Netlify using the records Netlify provides. When DNS is managed outside Netlify, make the `www` address the primary domain so visitors are served from the nearest Netlify location; Netlify then redirects the bare domain to it. Keep that canonical HTTPS address in `SITE_URL` and in Resend links.

Keep Netlify's optional built-with badge disabled. Its injected script uses inline content that conflicts with this application's strict Content Security Policy.

## 6. Email-delivery preparation

To improve legitimate delivery, authenticate the sending domain using the DNS records provided by Resend. Use a consistent `From` address, retain the plain-text email version, avoid misleading school affiliation claims, and monitor bounces or complaints.

No sender can guarantee placement in every recipient's primary inbox. Final placement is decided by the recipient's mail provider and may depend on domain reputation, prior engagement, content, and organization-level filters.

## 7. Maintenance

`supabase/maintenance/cleanup-expired-records.sql` removes expired one-time workflow records while retaining appropriate audit history. Review it before scheduling or running it.

Periodically review:

- Expired or inactive student records
- Administrator accounts and roles
- Netlify function logs
- Resend delivery and bounce logs
- UniSMS delivery results and available credit
- Supabase audit events
- Dependency-free browser compatibility and mobile layout
