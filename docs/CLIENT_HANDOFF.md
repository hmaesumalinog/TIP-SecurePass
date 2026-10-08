# Client handoff

This guide accompanies the source folder and GitHub repository. It explains what is included, how to open the project, and what must be arranged separately to operate the existing website.

## 1. Check the source package

The transfer folder includes the application source, browser assets, SQL setup and migration files, dependency lockfile, tests, and documentation. Start with the root `README.md`.

Local dependencies (`node_modules/`), hosting cache (`.netlify/`), temporary screenshots and test scripts (`tmp/`), private environment files, and local Git data (`.git/`) are deliberately excluded from the ZIP. These are not required source files. Dependencies can be installed with `npm ci`; Git history remains available through the repository.

Keep `package-lock.json`, all SQL migrations, and the test suite. They make installation reproducible and help the next maintainer verify changes. Earlier SQL upgrades are retained for older installations; they are not instructions to rerun them on the current database. Third-party dependencies retain their own licenses and notices.

## 2. Open and check the project

Install Node.js 20 or newer, then open the folder in your editor and run:

```bash
npm ci
npm test
npm run format:check
```

These tests use synthetic data and mocked provider delivery. They do not sign in to real student accounts or spend SMS credits.

The handoff audit found development-tool dependency advisories, while the
production-only dependency audit was clean. Review the recorded
[development dependency audit](SECURITY.md#development-dependency-audit) before
using or upgrading the local tooling. The application and lockfile have been
preserved; the source package is not a claim that every development dependency
is free of advisories.

To use the complete application locally, copy `.env.example` to `.env`, supply development credentials privately, and run `npx netlify dev`. See [Setup and deployment](SETUP_AND_DEPLOYMENT.md) for the exact configuration. Never commit the completed `.env` file.

If only the layout needs to be demonstrated, the local fixture servers described in [Alternate recovery](ALTERNATE_RECOVERY.md#deployment-and-verification) and [Email recovery](EMAIL_RECOVERY.md#verification) provide sample states without contacting the production services.

## 3. Arrange service access

Receiving the source folder or a GitHub invitation does not transfer hosting, database, domain, or provider accounts. Arrange each service with its current owner:

| Service                         | What the client needs                                                        |
| ------------------------------- | ---------------------------------------------------------------------------- |
| GitHub                          | Access to the repository and an agreed maintainer or owner                   |
| Netlify                         | Access to the existing site, deployments, logs, and environment settings     |
| Supabase                        | Access to the existing project, database, backups, and usage view            |
| Resend                          | Access to the sending domain, delivery logs, and the agreed API credential   |
| UniSMS                          | The agreed API credential, sender configuration, and SMS-credit arrangements |
| Domain registrar and Cloudflare | The agreed registration, DNS, renewal, and billing responsibilities          |

The current website is [www.resetworkflow.site](https://www.resetworkflow.site/), with [administrator sign-in](https://www.resetworkflow.site/admin/login). Its Netlify site is `tipsecurepass`; its Supabase project reference is `ysrqbnplayazrbhjepyb`.

For this handoff, keep the existing database and region. Do not create a replacement database, rerun initial setup, or change the Netlify site link simply because the project is opened on another computer. A source transfer does not include a database export.

Share credentials through a private password manager or another agreed secure channel. An administrator account for the portal is separate from access to Netlify, Supabase, and the other services.

## 4. Preserve existing recovery credentials

The deployed application uses three separate server values:

- `SESSION_SECRET` signs session cookies. Changing it requires everyone to sign in again.
- `APP_PEPPER` protects OTP and backup-code digests and reads older `v1` authenticator enrollments. Changing it can invalidate saved codes and those older enrollments.
- `RECOVERY_ENCRYPTION_KEY` protects `v2` authenticator enrollments. Changing it without a data-migration plan makes those enrolled secrets unreadable.

Keep the deployed values during the handoff. Do not generate replacements as a routine installation step for an existing live project. Preserve them in the service's protected environment settings and an owner-controlled secure backup. API-key changes should be coordinated, deployed, and verified before the old provider credential is retired.

No API key, password, backup code, authenticator key, or production database export belongs in the source archive or README.

## 5. Verify the client can operate the project

Complete a walkthrough together using authorized demonstration accounts:

1. Open both the student and administrator pages over HTTPS.
2. Sign in to the administrator area and view the student directory and audit log.
3. Demonstrate a new invitation, password setup, policy acknowledgments, authenticator enrollment, and backup-code download.
4. Let the student add their own recovery phone and verify it with one deliberately requested SMS.
5. Demonstrate email recovery or backup-code recovery, then confirm the new password works.
6. Sign out and verify the protected pages require sign-in again.
7. Confirm who handles maintenance, domain renewal, provider credit, support requests, and future changes.

Live email and phone checks are separate from the automated test results. Provider acceptance does not prove inbox placement or physical SMS receipt.

## 6. Maintain and release changes

The site currently uses manual Netlify deployment. A GitHub push alone does not update the live website. Run the checks in the [deployment guide](SETUP_AND_DEPLOYMENT.md#4-validate-before-deployment), apply only missing database migrations, and publish through the intended Netlify site.

Read [Performance and operations](PERFORMANCE_AND_OPERATIONS.md) before changing refresh intervals, caching, retention, or scheduled jobs. Keep the existing tests and security comments: they explain why a control is present and make later changes safer to review.

Record the accepted source commit, handoff date, service-access status, and maintenance responsibilities in the client's private handoff record. Keep personal contact details and commercial terms out of the public repository.
