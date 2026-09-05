# Password recovery acceptance checks

Run `npm test` and `npm run build` before a release. Run
`supabase/tests/resumable-otp.sql` in the project's SQL editor to exercise the
database state transitions in a transaction that rolls back all fixture rows.

For a student test, use an authorized account and phone:

1. Request a reset email. Check that an email typo can be corrected and that
   resend has a countdown. The response must not disclose account existence.
2. Open the email link. Receive one SMS. Refresh and reopen that same link:
   the active code and its original deadline must remain usable.
3. Paste a six-digit code, including a code with a leading zero. Check phone
   autofill when the device/browser offers it. Verify an incorrect code gives
   an actionable error, and a correct code advances once.
4. Request another code after the cooldown. Only the newest code should work.
   A rapid duplicate resend must resume that challenge instead of sending again.
5. Check delayed delivery and temporarily unavailable SMS service: neither
   should be described as an expired email link. A provider timeout consumes an
   issuance slot because delivery may have occurred despite the timeout.
6. Allow a code to expire. A new code can be requested while the email link
   remains valid and the three-send budget is not exhausted.
7. Confirm password match feedback, normal sign-in after success, and rejection
   of used links. The OTP timer stops after verification; the password step has
   its own ten-minute deadline.

The verified password step is tied to the tab holding its reset grant. Reopening
the email link after verification explains how to return to that tab or request
a new link; it never treats email access alone as proof of phone verification.

Automated provider tests use mocked transport and do not prove handset delivery.
Check actual SMS receipt during the authorized student test. Never record a
student's password, OTP, reset token, or reset grant in test reports.
