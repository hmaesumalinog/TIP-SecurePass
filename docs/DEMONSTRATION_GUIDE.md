# Demonstration Guide

This guide gives the student team a clear presentation order. Use only authorized test email addresses and phone numbers.

## Before the presentation

- Confirm the deployed site opens over HTTPS.
- Confirm Netlify, Supabase, Resend, and UniSMS show healthy service status.
- Use a funded or trial-authorized UniSMS recipient.
- Prepare one existing student and one unused seven-digit student number.
- Open the student portal and administrator portal in separate tabs.
- Keep provider dashboards available only if the panel asks for technical evidence; do not expose API keys.
- Request fresh reset links during the rehearsal. Old links are intentionally single-use and expire after 15 minutes.

## Suggested presentation flow

### 1. State the problem

Explain that password recovery must be secure without becoming confusing. A reset email alone can be risky if an inbox is compromised, while unclear steps can cause students to abandon the process or contact support unnecessarily.

### 2. Show administrator protection

Open `/admin/login` and explain that the administrator uses a password plus a one-time email verification code. Point out that the administrator session is separate from the student session.

### 3. Add a student

In the student management page:

1. Enter a unique seven-digit student number.
2. Enter the student's authorized test email and E.164 phone number.
3. Complete the name, age, program, and year-level fields.
4. Save the record.

Explain that the server generates the temporary password. The database stores only its bcrypt hash, while the plaintext value exists briefly on the server to create the welcome email.

### 4. Complete first-time setup

Open the welcome email and sign in with the temporary password. Show that the account cannot enter the portal immediately and must create a permanent password first. After completion, explain that the temporary password is invalidated.

### 5. Show normal sign-in and profile data

Sign in with the seven-digit student number and permanent password. Open the profile page and show that identity fields come from the signed-in student's Supabase record rather than hard-coded browser data.

### 6. Demonstrate incorrect credentials

Sign out, try an incorrect password, and point out the clear but non-revealing error. Then sign in using the correct password to show that credential verification is functional.

### 7. Demonstrate password recovery

1. Select **Forgot password?**
2. Submit the registered email address.
3. Explain that the same public confirmation is shown even for an unknown email, reducing account enumeration.
4. Open the fresh Resend email link.
5. Show the masked registered phone number.
6. Enter one incorrect OTP to demonstrate error handling, if the test plan allows it.
7. Enter the UniSMS code received by the authorized phone.
8. Create a policy-compliant new password.
9. Return to sign-in and prove that the new password works and the former password does not.

### 8. Close with auditability

Return to the administrator audit page and show the corresponding security activity. Explain that audit records support troubleshooting and review without storing plaintext passwords, OTPs, or reset links.

## Key security points to explain

- The email link and phone code are separate verification factors.
- The reset link expires after 15 minutes and is single-use.
- The SMS code expires after five minutes and permits at most five attempts.
- Raw reset tokens, OTPs, grants, and passwords are not stored in the database.
- Student and administrator sessions use different signed, HTTP-only cookies.
- Password changes invalidate older student sessions.
- Privileged database access and provider keys remain in Netlify Functions.
- Database password changes and reset-credential invalidation happen together.

## Key usability points to explain

- The workflow shows clear progress from request to new password.
- The registered phone is masked on screen.
- OTP fields support typing, pasting, keyboard navigation, and visible errors.
- Password requirements and strength feedback appear before submission.
- Layouts adapt to phones, tablets, and desktops.
- A safe support path is available when the registered phone cannot be used.

## Common panel questions

### Why not send the OTP by email too?

Using the registered phone as a separate channel means access to the email link alone is not sufficient to reset the password.

### Why use Netlify Functions?

Static browser code cannot safely contain database or provider secrets. The functions form a small trusted server layer while preserving a plain HTML, CSS, and JavaScript frontend.

### Is the administrator page private because the URL is not linked?

No. An unlinked URL is only less discoverable. Actual protection comes from server-verified credentials, a one-time email code, signed sessions, role checks, and CSRF validation.

### Is the dashboard truly real-time?

Student records and audit data are read from Supabase through protected server APIs. Visible administrator pages automatically refresh every eight seconds, which provides near-real-time updates without exposing the database secret to the browser.

### Can email delivery always be forced into the inbox?

No. The project can authenticate its sending domain and follow good delivery practices, but the recipient's email provider makes the final inbox or spam decision.

### Is this ready for an official school deployment?

It is an academic implementation and defense demonstration. Official use would require institutional identity integration, formal privacy and accessibility reviews, operations and incident-response ownership, load testing, monitoring, and an independent security assessment.

## Presentation boundary

Do not claim that this project is the official TIP portal, that it uses official student records, or that automated tests alone prove production security. Present it as a working academic implementation of a safer and clearer recovery workflow.
