# Email recovery and transactional messages

## Student journey

`forgot.html` and `reset.html` share `assets/js/email-recovery.js`, the recovery
layout stylesheet, and a small email-specific stylesheet. They do not load the
login controller. The same four-step progress indicator follows the student:

1. **Your email:** enter the address already connected to the account.
2. **Check your inbox:** a generic acknowledgement, the entered address for
   checking typos, an explicit resend button, and delivery troubleshooting.
3. **Phone code:** the six-digit SMS code, expiry timer, attempt guidance, and an
   explicit resend. Reopening a link checks its existing challenge; it does not
   automatically resend a text.
4. **New password:** matching server-side password rules, confirmation,
   show/hide controls, a ten-minute grant, and a clear completion screen.

An account without a verified phone receives recovery-option instructions.
An invited account receives first-time setup guidance instead of a reset link.
All three cases, including an unknown address, have the same public response.
Students missing enrolled methods can use the administrator assistance route;
this does not bypass identity review or grant access automatically.

The client waits 60 seconds between email requests, including uncertain network
responses. A server rate-limit response asks the student to wait 15 minutes.
Changing the email field does not remove that in-page cooldown. Server limits
remain authoritative; client timers are guidance, not a security boundary.

Recovery tokens and grants stay in memory, not browser storage. The email token
is removed from the URL after phone verification. Pages suppress outgoing
referrers, clear sensitive inputs when leaving, and warn before abandoning an
active save or verified session. An uncertain password-save response does not
claim success or failure: it explains that the student should try signing in
with the new password. Notification failure does not undo a completed reset.

## One email template

`netlify/functions/_shared/email-template.mjs` owns the responsive HTML wrapper,
header, message preview, optional action button, complete fallback URL, security
footer, and equivalent plain-text content. Inline styles and presentation tables
avoid a dependency on external CSS, fonts, logos, or tracking images.

`_shared/resend.mjs` defines the message content and sends it through Resend:

- Student invitation and temporary password
- First-login password confirmation
- Requested password-reset link and password-change confirmation
- Invitation help and alternate recovery instructions
- Administrator sign-in verification code
- Authenticator connected or removed
- Backup codes regenerated
- Recovery phone verified
- Password changed through alternate recovery

All dynamic HTML values are escaped. Action links must use HTTPS without
embedded credentials. Configured branding is applied to identity fields only,
never by replacing text inside credentials or token URLs. Security notices do
not contain recovery codes, authenticator secrets, passwords, or phone numbers.
Only the invitation and administrator-code templates contain their intended
short-lived credentials. The configured sender and idempotency keys are retained.

Existing messages already received cannot be restyled. New messages use the new
layout after deployment. Email clients may render details differently or choose
plain text. Provider acceptance is not proof of delivery or inbox placement.

## Verification

Run `npm test`, `npm run format:check`, and `npm run build` before release.
The suite covers template completeness, escaping, link safety, identity
configuration, generic recovery responses, provider payloads, and notification
failure after a committed password change, alongside the database/API tests.

For local visual QA:

```sh
node tests/helpers/email-recovery-preview.mjs
```

Open `http://127.0.0.1:4176/__qa`. It provides synthetic recovery scenarios and
all 12 email previews. It never calls Supabase, Resend, or an SMS provider.
Its short timers are fixture-only. No preview query parameter can bypass
verification on the deployed reset page. Stop the fixture with Ctrl+C.

Check request validation, duplicate clicks, address correction, email cooldowns,
wrong and pasted SMS codes, pending delivery, explicit resend, expiry, password
mismatch, successful completion, notice failure, and uncertain network results.
Review the pages at 320, 390, 768, and 1440 pixels. A real delivery demonstration
requires an authorized recipient and a new request; it is separate from local QA.
