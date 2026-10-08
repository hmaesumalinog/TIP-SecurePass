# TIP SecurePass

TIP SecurePass is an academic student-portal project focused on password-reset security and usability. It combines a responsive student interface, a small administrator portal, server-side APIs, a Supabase database, Resend email delivery, and UniSMS phone verification.

The project uses plain HTML, CSS, and JavaScript on the frontend. There is no React application, frontend build framework, or PHP runtime requirement.

> **Project scope:** This is an independent academic project. It is not affiliated with, endorsed by, or connected to the official Technological Institute of the Philippines student portal.

## Main features

- Seven-digit student-number sign-in with clear invalid-credential feedback
- Separate student and administrator sessions, allowing both portals to remain signed in in the same browser
- Signing out ends the session on the server, including any copied cookie
- Supabase-backed student profile information
- Email-link and SMS-code password recovery
- Generic recovery responses and equal-cost password checks that reduce account-discovery signals
- Single-use reset links, expiring OTP challenges, attempt limits, and password-policy checks
- Administrator two-step sign-in, student management, account onboarding, and audit history
- Live administrator updates: other administrators' changes appear within about 15 seconds
- Automatic welcome email with a one-time temporary password for a newly created student
- Forced permanent-password setup on the student's first sign-in
- Responsive layouts for desktop, tablet, and mobile screens
- Automated tests for email, SMS, temporary-password, and session-isolation behavior

## Technology

| Area     | Technology                                 | Responsibility                                                        |
| -------- | ------------------------------------------ | --------------------------------------------------------------------- |
| Frontend | HTML, CSS, vanilla JavaScript              | Student and administrator interfaces                                  |
| Server   | Netlify Functions using JavaScript modules | Authentication, validation, sessions, and provider calls              |
| Database | Supabase PostgreSQL                        | Student records, reset state, administrator records, and audit events |
| Email    | Resend                                     | Reset links, account setup, and security notices                      |
| SMS      | UniSMS                                     | Six-digit password-reset verification codes                           |
| Hosting  | Netlify                                    | Static pages, serverless functions, routing, and security headers     |

## Folder guide

```text
TIP SecurePass/
├── README.md                     Start here
├── .env.example                  Safe environment-variable template
├── netlify.toml                  Hosting, routes, and security headers
├── docs/                         Architecture, setup, security, and demo guide
├── public/                       Files published as the website
│   ├── admin/                    Administrator pages
│   └── assets/
│       ├── css/                  Student, portal, and admin styles
│       ├── js/                   Browser-side behavior
│       └── images/               Project artwork
├── netlify/functions/
│   ├── api.mjs                   The single API function; routes /api/* requests
│   ├── _routes/                  One module per API endpoint
│   ├── _shared/                  Reusable server helpers
│   ├── database-health.mjs       Scheduled activity check
│   └── security-maintenance.mjs  Scheduled cleanup of expired records
├── scripts/                      Asset versioning for long browser caching
├── supabase/
│   ├── setup/                    New-database scripts in execution order
│   ├── migrations/               Upgrades, applied in filename order
│   ├── upgrades/                 Scripts for an existing installation
│   └── maintenance/              Optional maintenance queries
└── tests/                         Automated Node.js tests
```

Every `/api/*` request runs in `netlify/functions/api.mjs`, which passes it to the matching module in `_routes/` (for example `/api/login` → `_routes/login.mjs`). One function means the first request of a visit starts the server for every request that follows. Shared implementation code is kept in `_shared/` so provider credentials and security logic are not duplicated.

## Getting started

1. Read [Setup and deployment](docs/SETUP_AND_DEPLOYMENT.md).
2. Review [Architecture](docs/ARCHITECTURE.md) to understand how the parts communicate.
3. Read [Security notes](docs/SECURITY.md) before changing authentication or reset logic.
4. Use the [Demonstration guide](docs/DEMONSTRATION_GUIDE.md) when presenting the project.
5. Follow [Administrator and onboarding workflows](docs/ADMIN_AND_ONBOARDING.md) for invitations, student-owned phone setup, privacy acknowledgments, and recovery reviews.

For local development:

```bash
npm install
cp .env.example .env
# Add your own development credentials to .env.
npx netlify dev
```

Open `http://localhost:8888`. Never place real credentials in frontend files, screenshots, documentation, or Git history.

## Verification

After editing anything in `public/assets/`, refresh the asset versions so browsers pick up the change:

```bash
npm run version-assets
```

Run all automated tests from the project root:

```bash
npm test
```

Run a local Netlify build check:

```bash
npm run build
```

These checks confirm the project files and tested provider contracts. A final release should also be tested with fresh email and SMS messages using authorized test accounts.

## Important operating notes

See [Email recovery and transactional messages](docs/EMAIL_RECOVERY.md) for the
student flow, shared email templates, and local-only visual test scenarios.

- Use synthetic or specifically authorized student information during demonstrations.
- Keep `DEMO_MODE=false` when demonstrating real SMS delivery. A visible demonstration code must never be exposed after a real SMS attempt.
- Add demonstration students through the administrator portal using synthetic or specifically authorized information.
- Keep `.env`, Netlify local state, provider keys, Supabase secret keys, and live account credentials out of the client handoff archive.
- The administrator pages are intentionally excluded from search-engine indexing, but the URL alone is not a security control. Access is enforced by server-side authentication and role checks.
