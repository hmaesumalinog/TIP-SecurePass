# Security Notes

This document explains the controls already present and the boundaries that remain for an academic project.

## Trust boundary

Everything under `public/` is visible to any site visitor. It must contain no secret keys, password hashes, provider credentials, private database URLs, or trusted authorization decisions.

Netlify Functions are the trusted application boundary. They receive browser requests, validate data, use protected environment variables, and communicate with Supabase, Resend, and UniSMS.

## Credentials and passwords

- Student and administrator passwords are compared against PostgreSQL `pgcrypto` bcrypt hashes.
- Passwords must contain 12 to 128 characters, upper- and lowercase letters, a digit, and a symbol.
- Passwords that resemble a student-number pattern are rejected.
- New-student temporary passwords are generated with a cryptographically secure random source.
- Temporary passwords expire after 24 hours and cannot be used to access the full portal without permanent-password setup.
- The plaintext temporary password is not stored; it exists only long enough for the server to build the welcome email.

## Reset credentials

- Reset links contain random high-entropy tokens.
- The database stores hashes of reset tokens, OTPs, and reset grants rather than their raw values.
- Reset links expire after 15 minutes and are single-use.
- OTPs expire after five minutes and lock after five failed attempts.
- A verified OTP creates a separate short-lived grant for the password-change step.
- The database function changes the password and consumes reset credentials atomically.

## Request privacy and abuse resistance

- The reset-request page returns a generic response so it does not directly disclose whether an email exists.
- Reset requests are limited using hashed email identifiers and hashed IP data.
- Student-number and email formats are normalized and validated by server functions.
- Errors returned to the browser avoid exposing internal database or provider details.

Rate limits in this project are database-backed and suitable for demonstration-scale traffic. A public institutional deployment should add edge-level abuse controls, centralized monitoring, alerting, and documented operational response.

## Sessions

### Student session

- Cookie name: `tip_securepass_session`
- Normal lifetime: four hours
- First-login setup lifetime: ten minutes
- Cookie flags: `HttpOnly`, `Secure`, and `SameSite=Strict`
- Session signature: HMAC-SHA-256 using `APP_PEPPER`
- Password-version comparison invalidates sessions after a password change

### Administrator session

- Cookie name: `tip_securepass_admin`
- Lifetime: 30 minutes
- Cookie flags: `HttpOnly`, `Secure`, and `SameSite=Strict`
- Separate HMAC signature namespace from the student session
- Role checked against the current administrator database record
- State-changing requests require a session-bound CSRF value
- Password sign-in is followed by a single-use email verification code

Because the two cookies have different names and validation paths, the student and administrator portals can remain signed in without replacing each other's session.

## Database access

- Row-level security is enabled on project tables.
- No anonymous or browser-facing table policies are created.
- Restricted SQL functions used for password operations revoke access from public, anonymous, and ordinary authenticated roles.
- Netlify Functions use a server-only Supabase secret or service-role key.
- Audit tables record security events without intentionally storing plaintext credentials.

## Email and SMS

- Resend and UniSMS are called only from server functions.
- Email links use the configured canonical `SITE_URL`.
- Each email call uses a unique idempotency key where applicable.
- The SMS recipient is normalized to E.164 form.
- `DEMO_MODE=false` hides browser-only provider simulations.
- If a real eligible SMS attempt fails, the production workflow reports the failure instead of exposing the secret OTP in the page.

Email authentication and SMS delivery status must be reviewed in the provider dashboards. Successful API acceptance does not guarantee final inbox placement or handset delivery.

## Browser protections

`netlify.toml` configures:

- Content Security Policy restricted to same-origin application resources
- Anti-framing protection
- MIME-sniffing protection
- A strict referrer policy
- Disabled camera, microphone, geolocation, and payment permissions
- No-index and no-store headers on administrator pages

The administrator URL is not a secret. Search-engine exclusion supports privacy but does not replace authentication.

## Sensitive files

The following must not be shared publicly:

- `.env`
- `.netlify/`
- Provider API keys
- Supabase secret or service-role keys
- Live student or administrator credentials
- Screenshots containing personal information or secrets
- Production database exports

`.env.example` is safe to share only while it contains placeholders.

## Limitations before institutional use

An official production system would additionally require:

- Integration with the institution's authoritative identity provider and student information system
- Formal data-protection impact and retention reviews
- Accessibility testing against the institution's required standard
- Centralized logs, alerting, backup, recovery, and incident response
- Strong administrator lifecycle management and hardware-backed MFA where available
- Rate limiting and bot protection designed for public traffic
- Independent source review and penetration testing
- Load, reliability, and failure-recovery testing
- Provider contracts, sender registration, and approved message templates
- Written user-support and lost-device identity-verification procedures

This project demonstrates the workflow and its core controls; it should not be described as an official institutional system.
