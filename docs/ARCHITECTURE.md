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
- `portal.html` is the authenticated academic dashboard.
- `profile.html` displays the signed-in student's Supabase-backed information.
- `support.html` provides a safe lost-phone fallback message.
- `admin/` contains the separate administrator interface.
- `assets/css/`, `assets/js/`, and `assets/images/` group reusable browser assets by type.

Frontend code performs usability validation and renders feedback, but it does not decide whether credentials, reset links, or OTPs are valid. Those decisions remain on the server.

### Server: `netlify/functions/`

Every top-level function file corresponds to a Netlify endpoint. `netlify.toml` maps readable routes such as `/api/login` to these functions.

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

Reusable server helpers live in `netlify/functions/_shared/`. Provider integration, database access, cookie handling, and common HTTP behavior are kept there to avoid inconsistent copies.

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
3. A valid normal account receives a signed, HTTP-only student cookie.
4. A valid temporary password receives a short setup-only cookie instead.
5. The portal and profile APIs verify the student cookie and compare its password-version value with the current database record.
6. Changing the password invalidates older student sessions.

### New-student onboarding

1. An authorized administrator creates the student record.
2. The server generates a random temporary password and stores only its bcrypt hash.
3. Resend emails the temporary password to the student.
4. The password expires after 24 hours and is valid only for first-time setup.
5. The student signs in and must create a permanent password before entering the portal.
6. The temporary password becomes invalid and a security confirmation email is sent.

### Password recovery

1. The student submits an email address.
2. The request endpoint returns the same public response whether or not the account exists.
3. For a valid active account, Resend sends a 15-minute single-use link.
4. Opening the link starts a five-minute OTP challenge and sends the code to the registered phone through UniSMS.
5. The student has at most five verification attempts; each attempt is consumed atomically in the database.
6. Successful verification creates a short-lived reset grant.
7. Supabase changes the password and consumes the reset credentials in one database operation.
8. Resend sends a password-change security notice.

A reset link can issue no more than three phone codes and enforces a 60-second cooldown between deliveries.

### Administrator sign-in and data refresh

1. The administrator submits an email address and password.
2. A one-time verification code is sent by email.
3. Successful verification creates a separate 30-minute administrator cookie.
4. Administrator write requests require a matching CSRF token and an allowed role.
5. Dashboard, student, and audit views refresh from server APIs every eight seconds while the page is visible.

The student cookie and administrator cookie use different names, validation rules, and lifetimes. Signing in or out of one portal does not overwrite the other portal's session.

## Design decisions

- **No frontend framework:** The project remains easy to open, inspect, and explain using standard web technologies.
- **Serverless functions instead of browser-to-database writes:** Secrets and privileged operations stay on the server.
- **Separate recovery channels:** Possession of the email link alone is not enough to change a password.
- **Database functions for password changes:** Related updates occur atomically, reducing partially completed reset states.
- **Independent administrator session:** Student and administrator access can be tested together without session interference.
- **Near-real-time admin refresh:** Server-mediated refresh keeps the secret database model intact while showing recent changes promptly.
