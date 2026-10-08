# Security Notes

This document explains the controls already present and the boundaries that remain for an academic project.

## Trust boundary

Everything under `public/` is visible to any site visitor. It must contain no secret keys, password hashes, provider credentials, private database URLs, or trusted authorization decisions.

Netlify Functions are the trusted application boundary. They receive browser requests, validate data, use protected environment variables, and communicate with Supabase, Resend, and UniSMS.

## Credentials and passwords

- Student and administrator passwords are compared against PostgreSQL `pgcrypto` bcrypt hashes.
- Passwords must contain 12 to 128 characters, upper- and lowercase letters, a digit, and a symbol.
- Passwords containing the student's exact seven-digit number are rejected by both the server and database password-change functions.
- New-student temporary passwords are generated with a cryptographically secure random source.
- Temporary passwords expire after 24 hours and cannot be used to access the full portal without permanent-password setup.
- The plaintext temporary password is not stored; it exists only long enough for the server to build the welcome email.

## Reset credentials

- Reset links contain random high-entropy tokens.
- The database stores hashes of reset tokens, OTPs, and reset grants rather than their raw values.
- Reset links expire after 15 minutes and are single-use.
- OTPs expire after five minutes and consume attempts atomically, locking after five failed attempts even when submissions overlap.
- Each reset link can issue at most three phone codes, with a 60-second issuance cooldown.
- A verified OTP creates a separate short-lived grant for the password-change step.
- The database function changes the password and consumes reset credentials atomically.

## Request privacy and abuse resistance

- The reset-request page returns the same response, at the same point, for every email address. The account lookup and the email itself are handled after the response has been sent, so response time does not reveal whether an address belongs to an account. Backup-code recovery sends its optional SMS the same way.
- Student and administrator sign-in perform one bcrypt comparison even when the student number or email does not exist, so a wrong password and an unknown account take comparable time.
- Reset requests are limited using hashed email identifiers and hashed IP data.
- Student-number and email formats are normalized and validated by server functions.
- Student password sign-in is temporarily throttled by hashed student number and hashed IP address.
- Errors returned to the browser avoid exposing internal database or provider details.

Rate limits in this project are database-backed and suitable for demonstration-scale traffic. A public institutional deployment should add edge-level abuse controls, centralized monitoring, alerting, and documented operational response.

## Sessions

### Student session

- Cookie name: `tip_securepass_session`
- Normal lifetime: four hours
- First-login setup lifetime: ten minutes
- Cookie flags: `HttpOnly`, `Secure`, and `SameSite=Strict`
- Session signature: HMAC-SHA-256 using `SESSION_SECRET`
- Password-version comparison invalidates sessions after a password change
- Session-version comparison invalidates every copy of a session when the student signs out

### Administrator session

- Cookie name: `tip_securepass_admin`
- Lifetime: 30 minutes
- Cookie flags: `HttpOnly`, `Secure`, and `SameSite=Strict`
- Separate HMAC signature namespace from the student session
- Role checked against the current administrator database record
- Signing out increments the administrator's session version, ending that session everywhere
- State-changing requests require a session-bound CSRF value
- Password sign-in is followed by a single-use email verification code

Because the two cookies have different names and validation paths, the student and administrator portals can remain signed in without replacing each other's session.

## Server secrets

The current format separates session signing, code hashing, and authenticator encryption. Legacy `v1` authenticator enrollments still depend on `APP_PEPPER`, so plan any key rotation around the data that uses it:

| Variable                  | Protects                                               | Effect of rotating it                                                           |
| ------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| `SESSION_SECRET`          | Student and administrator cookies, SMS status receipts | Everyone signs in again                                                         |
| `APP_PEPPER`              | Code digests and legacy `v1` authenticator encryption  | Saved codes, codes in flight, and legacy authenticator enrollments stop working |
| `RECOVERY_ENCRYPTION_KEY` | Encryption of authenticator secrets (`v2`)             | Connected authenticators stop working; students must connect them again         |

Authenticator secrets created before the keys were separated are marked `v1`. They remain readable through `APP_PEPPER` and are re-encrypted with `RECOVERY_ENCRYPTION_KEY` the next time the student connects or replaces an authenticator.

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
- Email and SMS provider calls stop waiting after six seconds, so a slow provider cannot hold a request open.
- The SMS recipient is normalized to E.164 form.
- Simulated SMS codes are shown only to a developer running the site on `localhost` with `DEMO_MODE=true` and no SMS provider. A deployed site never shows a code in the browser, whatever its settings.
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

## Development dependency audit

The October 9, 2026 tooling update pins Netlify CLI 27.12.0 and refreshes its
compatible transitive dependencies. Use Node.js 24 LTS; the minimum supported
version is 22.13.0. The application source and production dependency versions are
unchanged.

| Audit scope                                      | Before the update                   | After the update |
| ------------------------------------------------ | ----------------------------------- | ---------------- |
| Production dependencies (`npm audit --omit=dev`) | 0                                   | 0                |
| All dependencies (`npm audit`)                   | 25: 1 critical, 23 high, 1 moderate | 16: all high     |

The critical `proxy-addr` dependency is updated from 2.0.7 to 2.0.8. Compatible
fixes also update `brace-expansion`, `fast-uri`, `fastify`, `multiparty`,
`smol-toml`, `source-map-js`, and `toml`; the new CLI no longer includes
`extract-zip` in this dependency tree. No forced updates, dependency overrides,
or audit exclusions were used.

All remaining affected packages are development dependencies. The 16 entries
include dependent packages; they are not 16 separate vulnerabilities in the
portal. They trace to these upstream libraries:

- `braces@3.0.3`: no published patched version for [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
- `node-forge@1.4.0`: no published patched version for [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
- `sharp@0.34.5`: the [current image-library fix](https://github.com/advisories/GHSA-wq5f-xc86-pv6w) requires 0.35.5, outside `ipx@3.1.1`'s declared `^0.34.3` range in the Netlify development image tooling.

These tools are not dependencies of the deployed request handlers, but they
still matter on a maintainer's computer. Keep development servers private,
avoid public preview tunnels, and do not process untrusted projects, glob
patterns, certificates, or images with the local tooling. These precautions
reduce exposure; they do not resolve the upstream advisories.

The upgrade was checked in an isolated source copy with automated tests, local
browser fixtures, an offline Netlify build, and the actual Netlify development
server. Recheck both audit commands when receiving the project, since advisory
data changes. A full audit still returns a nonzero status until the remaining
findings are resolved. Do not run `npm audit fix --force`: at this review it
proposes Netlify CLI 2.13.1, a breaking downgrade. Review later upstream releases
and repeat the compatibility checks before updating the lockfile again.

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
