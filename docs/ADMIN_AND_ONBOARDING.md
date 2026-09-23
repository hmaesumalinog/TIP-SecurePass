# Administrator workspace and student onboarding

This release separates academic record management from student-owned recovery
methods. The project remains an academic demonstration, not an official T.I.P.
service or a certified institutional identity system.

## New student journey

1. A super administrator chooses **Students → Invite student** and enters the
   seven-digit student number, first/last name, birthday, email, program and year.
   There is no administrator phone field. A duplicate number or email is rejected.
2. The account is created with a hashed, random temporary password. Resend emails
   the sign-in instructions; the temporary password expires in 24 hours. An email
   failure is reported separately from successful account creation. Do not create
   a duplicate account: open its details and reissue the invitation instead.
3. The student signs in and chooses a personal password. Separate, unchecked
   controls accept the demonstration terms and acknowledge the privacy notice.
   The server records version `2026-09-20` and an acceptance timestamp atomically
   with first-login completion. A stale temporary-password session cannot finish.
4. The student connects an authenticator and saves the one-time backup codes.
   Only confirmed enrollment unlocks the portal. The authenticator is used for
   recovery and sensitive changes, not additional everyday login MFA.
5. The completion screen offers **Add my recovery phone (optional)**. The student
   enters their number, current password and a fresh authenticator code. Only a
   valid SMS code activates the number. Existing numbers remain active until the
   replacement is verified. Only Philippine mobile numbers are supported here.

Existing students who have not acknowledged the current notices see that step
on their next portal visit. Existing authenticator enrollments, phones and backup
codes are retained. Birthdays are not inferred from a stored age; an existing
unknown birthday can remain blank. New invitations require a valid birthday.

## Administrator pages

- **Security:** recovery readiness, incomplete setups, pending invitations,
  exhausted codes, open assistance requests, failed sign-ins over 24 hours, and
  completed resets over seven days. Missing an optional phone is not a failure.
- **Students:** server-side search and readiness filters, 20 records per page,
  a details dialog and a separate editing form. Birthdays are fetched only when
  opening details. Concurrent edits fail with a reload message instead of
  overwriting newer data. Viewer-role administrators cannot mutate accounts.
- **Audit log:** read-only, paginated history with student names/numbers,
  administrator actors, event explanations, source filtering and search. Raw
  event payloads are not sent to the browser. Failed sign-ins are not presented
  as proof of an attack; accepted email is not proof of inbox delivery.
- **Recovery requests:** a filtered queue, on-demand request details, required
  internal notes and append-only review history. Start a review before resolving.
  Resolved/declined requests are read-only; simultaneous stale reviews are rejected.
  Marking a request resolved does not send credentials, remove factors, change
  a contact, or reply to the submitted address. Follow a separately approved
  identity-verification/support process. A birthday or student number alone is
  not sufficient evidence, and identity documents should not be stored in notes.

Data refreshes every 30 seconds while visible, pauses during editing/review
dialogs, and refreshes after successful changes. The Refresh button is available
for immediate updates. This is authenticated polling, not a public Realtime
subscription to confidential database tables.

## Recovery and access safeguards

- Only students add or change phone numbers; administrators see verified status,
  not full numbers, passwords, OTPs, authenticator secrets or backup codes.
- Phone changes use database-backed attempt limits, a 60-second resend cooldown,
  a five-minute SMS expiry and current-session-version checks. An uncertain
  provider response does not trigger an automatic second SMS.
- Phone enrollment SMS identifies Reset Workflow, the phone-verification purpose,
  the six-digit code and its five-minute expiry. Password recovery uses a separate
  purpose in the same structured format. Provider acceptance still requires a
  live check; a format change alone is not proof of successful delivery.
- After requesting a phone code, the page shows queued, sent, failed or unknown
  provider status. It makes at most three automatic read-only checks, with a
  manual check available afterward. These checks never send another SMS. A
  short-lived signed receipt is bound to the signed-in student, password version
  and latest pending challenge; cancellation stops browser checks. The server
  allows at most 12 checks per receipt and never returns the SMS body or OTP.
  A provider-reported **sent** status is not proof of physical handset receipt.
- Number changes invalidate outstanding email/SMS reset authorizations. Email
  or active-status changes revoke existing sessions and pending authorizations.
- Invitation reissue is only for accounts still awaiting first login. It is
  not an administrator bypass for an established account's enrolled factors.
- An email reset without a verified phone sends recovery options/invitation
  instructions instead of creating an unusable SMS-dependent reset link.
- Student and administrator cookies remain separate, including logout behavior.
- The reporting view, review-history table and procedures are restricted to the
  existing server service role; anonymous/browser roles have no direct access.

## Deployment

Apply `supabase/migrations/20260920090000_student_owned_onboarding.sql` once after
the alternate-recovery migration, then deploy the functions and frontend together.
It is an atomic, additive migration: no student credentials or existing factors
are reset, and no fabricated birthdays or acknowledgments are inserted.

Run `npm test`, `npm run build`, and `npm run format:check`. New database and HTTP
integration tests exercise the actual SQL and handlers with embedded PostgreSQL;
email/SMS delivery is mocked. `tests/helpers/enrollment-preview.mjs` provides
synthetic browser fixtures for admin pages and student onboarding. It is local
only and is not included in the Netlify publish directory.

Before institutional use, the project owner must approve the policy text, identify
the responsible privacy contact, establish retention/deletion periods and approve
the identity-proofing process. The notices intentionally disclose the current
demonstration limits. A checkbox does not establish legal compliance. Physical
SMS receipt, inbox placement and authenticator-app interoperability require
authorized live-device checks; automated tests do not prove those outcomes.
