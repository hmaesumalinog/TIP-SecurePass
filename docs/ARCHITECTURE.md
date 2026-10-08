# System Architecture

## Overview

TIP SecurePass follows a small three-layer web architecture. Static pages handle presentation, Netlify Functions handle trusted application logic, and Supabase stores persistent records. Email and SMS providers are called only from the server layer.

```text
Student or administrator browser
              |
              | HTTPS requests to /api/*
              v
       Netlify Functions
        /      |       \
       /       |        \
Supabase    Resend      UniSMS
database    email       SMS OTP
```

The browser never receives the Supabase secret key, Resend key, UniSMS key, raw password hashes, reset-token hashes, or OTP hashes.

## Layer responsibilities

### Frontend: `public/`

The frontend is plain HTML, CSS, and vanilla JavaScript.

- `index.html` handles student sign-in.
- `forgot.html` starts password recovery.
- `reset.html` handles the email-link, phone-code, and new-password stages.
- `assets/js/email-recovery.js` controls both email-recovery pages. It shares
  password and code-format helpers with the alternate-recovery flow; login
  behavior remains in `assets/js/site.js`.
- `portal.html` is the authenticated academic dashboard.
- `profile.html` displays the signed-in student's Supabase-backed information.
- `support.html` provides a safe lost-phone fallback message.
- `admin/` contains the separate administrator interface.
- `assets/css/`, `assets/js/`, and `assets/images/` group reusable browser assets by type.

Frontend code performs usability validation and renders feedback, but it does not decide whether credentials, reset links, or OTPs are valid. Those decisions remain on the server.

### Server: `netlify/functions/`

`api.mjs` is the single HTTP function. It answers every `/api/*` request and passes each one to its endpoint module in `_routes/` (for example `_routes/login.mjs` for `/api/login`). Because all endpoints share one function, the first request of a visit starts it for every request that follows. Sign-in and recovery pages also call `/api/health` while the person is still typing, so the real request rarely waits for the function to start.

The other two files are scheduled jobs: `database-health.mjs` and `security-maintenance.mjs`.

The server layer is responsible for:

- Validating and normalizing incoming data
- Applying request limits and generic account-recovery responses
- Creating signed student and administrator sessions
- Generating cryptographically random reset links, OTPs, and temporary passwords
- Hashing sensitive one-time values before database storage
- Calling Supabase with a server-only secret key
- Sending email through Resend and SMS through UniSMS
- Enforcing administrator roles and CSRF checks
- Returning safe error messages to the browser

Reusable server helpers live in `netlify/functions/_shared/`. Provider integration, database access, cookie handling, server secrets (`keys.mjs`), and common HTTP behavior are kept there to avoid inconsistent copies.

### Data: `supabase/`

Supabase PostgreSQL stores:

- Student identity and profile records
- Bcrypt password hashes
- Reset-request rate-limit records
- Hashed, expiring reset tokens
- Hashed, expiring OTP challenges and attempt counts
- Short-lived password-reset grants
- Student security events
- Administrator accounts, login challenges, and audit events

Row-level security is enabled and no public table policies are created. The browser uses the project APIs instead of directly querying these tables.

## Main workflows

### Student sign-in

1. The student submits a seven-digit student number and password.
2. `/api/login` asks a restricted Supabase function to verify the bcrypt password hash.
3. A valid normal account receives a signed, HTTP-only student cookie. Reserving the attempt, checking the password, and recording the result take two database calls.
4. A valid temporary password receives a short setup-only cookie instead.
5. The portal and profile APIs verify the student cookie and compare its password and session versions with the current database record. One database call returns the profile and recovery summary together.
6. Changing the password or signing out invalidates older student sessions.

### New-student onboarding

1. An authorized administrator creates the student record.
2. The server generates a random temporary password and stores only its bcrypt hash.
3. Resend emails the temporary password to the student.
4. The password expires after 24 hours and is valid only for first-time setup.
5. The student signs in and must create a permanent password before entering the portal.
6. The temporary password becomes invalid and a security confirmation email is sent.

### Password recovery

1. The student submits an email address.
2. The request endpoint returns the same public response, at the same point, whether or not the account exists.
3. After the response, the server checks the account. For a valid active account with a verified phone, Resend sends a 15-minute single-use link; other accounts receive their available recovery options.
4. Opening the link starts a five-minute OTP challenge and sends the code to the registered phone through UniSMS.
5. The student has at most five verification attempts. Counting the attempt, checking the code, and creating the short-lived reset grant happen in one database transaction.
6. The reset grant authorizes only the password-change step.
7. Supabase changes the password and consumes the reset credentials in one database operation.
8. Resend sends a password-change security notice.

A reset link can issue no more than three phone codes and enforces a 60-second cooldown between deliveries.

### Administrator sign-in and data refresh

1. The administrator submits an email address and password.
2. A one-time verification code is sent by email.
3. Successful verification creates a separate 30-minute administrator cookie.
4. Administrator write requests require a matching CSRF token and an allowed role.
5. Each administrator view loads with one request, which also confirms the session.
6. Live updates: while a page is visible, it asks `/api/admin/pulse` for a short change token every 15 seconds when in use (every 60 seconds when idle). The full view reloads only when the token changes, and every five minutes for time-based states. Open tabs share these checks, and a change made in one tab refreshes the others at once. Checks pause while the page is hidden or offline and back off after failures.

The student cookie and administrator cookie use different names, validation rules, and lifetimes. Signing in or out of one portal does not overwrite the other portal's session.

## Design decisions

- **No frontend framework:** The project remains easy to open, inspect, and explain using standard web technologies.
- **Serverless functions instead of browser-to-database writes:** Secrets and privileged operations stay on the server.
- **Separate recovery channels:** Possession of the email link alone is not enough to change a password.
- **Database functions for password changes:** Related updates occur atomically, reducing partially completed reset states.
- **Independent administrator session:** Student and administrator access can be tested together without session interference.
- **Near-real-time admin updates:** A small server-checked change token shows other administrators' changes within about 15 seconds without giving the browser database access.
- **One API function:** Keeps routing in code and avoids a separate cold start for each endpoint.

## Performance and delivery boundaries

- Every administrator read validates the session, checks the role, and returns the view in one database call (`admin_read`). List responses include the open-request count, so the sidebar does not make a second request. Lists fetch one extra row to determine whether another page exists, rather than counting the complete result on every refresh.
- The change token (`admin_change_token`) combines the newest audit-event IDs and the support-request count and latest update. Each part is an indexed lookup.
- The dashboard uses a dedicated eight-event query. It does not load or count the entire audit report. Composite time indexes support recent-event ordering; student and support lists have indexes for their common ordering and filters.
- Student portal responses include their recovery summary. A normal portal load uses one browser API request and one database call (`student_context`). Status reads do not write enrollment rows or acquire enrollment locks.
- Sign-in/reset limits reserve an attempt atomically in PostgreSQL before further work. A successful sign-in marks that reservation successful; an interrupted attempt remains counted for its 15-minute window. Identifier/IP row locks are acquired in a consistent order.
- UniSMS accepting a reset SMS as pending does not mark it sent. The challenge stores its provider reference. Status checks are reserved in PostgreSQL at least five seconds apart, with at most eight per challenge. Checks never send another SMS. Provider errors are reduced to safe categories before leaving the server.
- Database requests have an eight-second timeout by default, and email and SMS calls six seconds. Nothing is retried automatically. An uncertain SMS timeout keeps the existing challenge available if its code arrives. Audit logging failures are recorded in the function log and never turn a completed action into an error.
- The `security-maintenance` scheduled function runs every six hours and deletes bounded batches of operational state expired for more than one day. Student profiles, enrolled factors, audit history, and support requests are not deleted.
- Security responses remain `no-store`; do not cache private responses at the CDN. Every asset URL carries a content hash, so browsers keep assets for a year and fetch a file again only after it changes (`npm run version-assets`). The existing Supabase Realtime publication is not used by the browser and is not required for this update model.

See `docs/PERFORMANCE_AND_OPERATIONS.md` for measurement and release checks.
