# Alternate account recovery

## Student journey

After first password setup, the student is directed to `security.html`. Existing
students can open Security & recovery from the dashboard or profile. Enrollment
is optional and must happen before access is lost. Normal sign-in remains
password-based: an enrolled authenticator is a recovery factor, not login MFA.

Students can enroll a compatible TOTP authenticator by scanning the QR code or
entering its setup key, then verifying a six-digit code. Confirmation generates
ten single-use backup codes. Codes can be copied, downloaded, or printed, and are
shown only in that response. Losing that response requires authenticated code
regeneration. New codes invalidate every old code and pending alternate recovery.

Phone recovery must first verify the current phone on the student record. The
security page does not change contact details. First-time phone verification
also generates backup codes when no authenticator or codes exist. SMS-only users
request a fresh phone code before replacing backup codes. Changing the stored phone invalidates
phone verification and pending SMS recovery. SMS delivery uses the existing
UniSMS integration; there is no simulated-code fallback.

`recover.html` requires a backup code plus either the enrolled authenticator or
verified phone. A verified request grants ten minutes to change the password; it
does not sign the user in or allow contact/factor changes. Codes are consumed at
successful verification, even if the student subsequently leaves the reset flow.
The browser keeps the request token in memory, not local storage or URLs. A page
reload starts a new recovery flow; unused backup codes remain available.

## Security controls

- Recovery codes contain 128 random bits each and are stored only as keyed hashes.
- TOTP secrets are AES-256-GCM encrypted, bound to the student ID, with a separate
  HKDF-derived key from the existing server-only APP_PEPPER. Preserve APP_PEPPER
  securely; changing it without re-encryption prevents existing factor use.
- TOTP uses SHA-1, six digits, 30-second periods, and a one-step clock allowance.
  The last accepted step is stored to prevent replay. Students may need to wait
  for the next code immediately after enrollment or a security change.
- Settings require a valid current student session and current password. Existing
  authenticators must also be proven before replacement, removal or code renewal.
- Attempts and rate limits are database-backed; state transitions lock the student
  and recovery rows. Backup consumption and reset authorization are transactional.
- All new tables have RLS enabled and no anonymous/authenticated grants. Only the
  existing Netlify service role may use the new procedures.
- Any password change invalidates previous sessions and all outstanding reset
  authorizations. It does not silently remove enrolled authenticators.
- Security changes send notices to the existing account email. Notification
  failure does not undo a completed change; the UI reports that failure.
- No secrets are sent to external QR services, logged, or placed in public URLs.

## Remote support boundary

`recovery-help.html` stores an unverified assistance request. Super administrators
can review it at `admin/recovery.html`, with CSRF protection and an audit entry.
Contact details submitted here are not verified and do not replace account data.
Marking a request resolved does not issue credentials, remove factors or reset a
password. A responsible administrator must complete an approved identity-check
process independently. Do not accept a student number, birthday, or ID photograph
alone as proof. Do not store identity documents or passwords in review notes.

## Deployment and verification

Apply `supabase/migrations/20260917090000_alternate_recovery.sql` once, then publish
the functions and frontend together. Existing recovery data and accounts are
preserved. Back up the database before schema changes. The migration is atomic.

Run `npm test`, `npm run build`, and `npm run format:check`. Database tests use
embedded PostgreSQL with pgcrypto, not production student records. API integration
tests run actual handlers and SQL; only provider delivery is mocked. Crypto tests
include RFC 6238 vectors. A real phone and authenticator-app smoke test is still
needed to verify provider delivery and device interoperability for the demo.

Inspect `audit_events` for `recovery_*`, `alternate_recovery_verified`, and
`alternate_password_reset_completed`; staff reviews appear in admin audit events.
Apply the project's data-retention policy to completed support requests. They may
contain personal contact information and should not be retained indefinitely.
Expired alternate challenges and old rate-limit rows may be purged by an approved
maintenance job; deleting unused backup codes is not a cleanup operation.

Passkeys, physical security keys, login MFA, and automated identity-proofing are
not part of this phase. No claim of NIST assurance-level certification is made.
