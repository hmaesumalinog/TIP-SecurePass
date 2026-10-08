<p align="center">
  <img src="public/assets/images/brand-mark.svg" width="64" height="64" alt="TIP SecurePass shield">
</p>

# TIP SecurePass

A student portal focused on secure, understandable password recovery. Students can manage their recovery methods, while administrators handle invitations, student records, security activity, and recovery assistance.

[Student portal](https://www.resetworkflow.site/) · [Administrator sign-in](https://www.resetworkflow.site/admin/login) · [Setup guide](docs/SETUP_AND_DEPLOYMENT.md) · [Client handoff](docs/CLIENT_HANDOFF.md)

## What the project includes

| Students                                                          | Administrators                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------- |
| Seven-digit student-number sign-in                                | Separate sign-in with an email verification code        |
| Guided first-login password and privacy setup                     | Student invitations with temporary-password emails      |
| Authenticator enrollment and saved backup codes                   | Student search, details, editing, and readiness filters |
| Student-owned recovery phone verification                         | Security dashboard and searchable audit history         |
| Email-link and SMS-code password recovery                         | Recovery-assistance review queue                        |
| Recovery without email using a backup code and an enrolled factor | Automatic change checks across open administrator tabs  |

Student and administrator sessions can coexist in the same browser. Signing out invalidates the corresponding session on the server. Reset links and codes expire, attempts are limited, and password changes invalidate outstanding recovery credentials.

## Technology

| Layer     | Technology                            | Purpose                                                            |
| --------- | ------------------------------------- | ------------------------------------------------------------------ |
| Interface | HTML, CSS, vanilla JavaScript         | Responsive student and administrator pages                         |
| Server    | Netlify Functions, JavaScript modules | Authentication, validation, sessions, and provider requests        |
| Database  | Supabase PostgreSQL                   | Profiles, recovery state, access controls, and audit records       |
| Email     | Resend                                | Invitations, reset links, verification codes, and security notices |
| SMS       | UniSMS                                | Phone verification and password-recovery codes                     |

All browser requests go through the site's `/api/*` routes. Database credentials, provider keys, and trusted verification logic stay on the server. Administrator updates use small change checks, approximately every 15 seconds while active, with slower checks when idle.

## Getting started

Use Node.js 20 or newer with npm. From the project root:

```bash
npm ci
cp .env.example .env
```

Fill in `.env` using the [environment-variable guide](docs/SETUP_AND_DEPLOYMENT.md#2-configure-environment-variables), then start the local server:

```bash
npx netlify dev
```

Open `http://localhost:8888` for students or `http://localhost:8888/admin/login` for administrators. On Windows, copy `.env.example` to `.env` with File Explorer or PowerShell's `Copy-Item`.

For a new database, follow the exact [SQL installation order](supabase/README.md#new-installation). For the existing deployed project, do not rerun setup scripts or replace its security keys merely to transfer the source folder. Read the [handoff guide](docs/CLIENT_HANDOFF.md) first.

Opening an HTML file directly previews only its static layout. Sign-in, recovery, email, SMS, and database access require the configured server.

## Project structure

```text
TIP-SecurePass/
├── README.md                 Project overview and starting point
├── .env.example              Environment template; contains no live credentials
├── netlify.toml              Hosting, routes, and response headers
├── package.json              Commands and dependencies
├── package-lock.json         Exact dependency versions for npm ci
├── public/                   Published pages and browser assets
│   ├── admin/                Administrator pages
│   └── assets/               CSS, JavaScript, and images
├── netlify/functions/
│   ├── api.mjs               Entry point for /api/*
│   ├── _routes/              Request handlers
│   ├── _shared/              Security, database, and provider helpers
│   ├── database-health.mjs   Scheduled database check
│   └── security-maintenance.mjs
├── supabase/                 Setup, migrations, maintenance, and SQL tests
├── scripts/                  Asset versioning
├── tests/                    Automated checks and local browser fixtures
└── docs/                     Setup, architecture, operation, and demo guides
```

The [architecture guide](docs/ARCHITECTURE.md) explains the responsibilities of each layer and the main authentication and recovery flows.

## Development and verification

| Command                  | Purpose                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `npm ci`                 | Install the versions recorded in the lockfile                      |
| `npm test`               | Run the automated tests using synthetic data and mocked delivery   |
| `npm run format:check`   | Check formatting                                                   |
| `npm run version-assets` | Refresh content hashes after editing browser assets                |
| `npm run build`          | Validate the Netlify configuration and bundle the server functions |

The automated test suite does not send real email or SMS and does not require production credentials. Browser fixtures are kept outside `public/` and are not deployed. Before demonstrating provider delivery, use a specifically authorized test email address and phone number.

The current site uses manual Netlify deployment; pushing to GitHub updates the source repository but does not publish the website. See [deployment instructions](docs/SETUP_AND_DEPLOYMENT.md#5-deploy-on-netlify).

## Documentation

| Guide                                                              | Read it when you need to…                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| [Client handoff](docs/CLIENT_HANDOFF.md)                           | Receive the source and arrange access to the existing services           |
| [Setup and deployment](docs/SETUP_AND_DEPLOYMENT.md)               | Configure a local environment or publish a release                       |
| [System architecture](docs/ARCHITECTURE.md)                        | Explain how the interface, server, database, and providers work together |
| [Security notes](docs/SECURITY.md)                                 | Understand sessions, secrets, recovery controls, and their limits        |
| [Administrator and onboarding guide](docs/ADMIN_AND_ONBOARDING.md) | Invite students and manage security or assistance requests               |
| [Alternate recovery](docs/ALTERNATE_RECOVERY.md)                   | Understand authenticators, backup codes, and recovery without email      |
| [Email recovery](docs/EMAIL_RECOVERY.md)                           | Review the email/SMS flow and transactional templates                    |
| [Performance and operations](docs/PERFORMANCE_AND_OPERATIONS.md)   | Maintain polling, caching, delivery checks, and scheduled jobs           |
| [Acceptance checks](docs/RECOVERY_TESTING.md)                      | Rehearse recovery success and failure cases                              |
| [Demonstration guide](docs/DEMONSTRATION_GUIDE.md)                 | Present the project and answer common questions                          |

## Project scope

This is an independent academic project. It is not affiliated with, endorsed by, or connected to the official Technological Institute of the Philippines student portal.

Use synthetic or specifically authorized student information. Keep credentials, database exports, and screenshots containing private information out of the repository and source package. The administrator URL is protected by server-side authentication and role checks; an unlinked URL alone is not a security control.
