import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adminVerificationEmail,
  firstLoginConfirmationEmail,
  resetConfirmationEmail,
  resetEmail,
  studentWelcomeEmail
} from '../netlify/functions/_shared/resend.mjs';

const messages = [
  resetEmail({ firstName: 'Prince', resetLink: 'https://resetworkflow.site/reset.html?token=test-token' }),
  resetConfirmationEmail({ firstName: 'Prince' }),
  studentWelcomeEmail({
    firstName: 'Prince',
    studentNumber: '2026008',
    temporaryPassword: 'Temporary-Only-1!',
    signInLink: 'https://resetworkflow.site/'
  }),
  firstLoginConfirmationEmail({ firstName: 'Prince' }),
  adminVerificationEmail({ displayName: 'Administrator', code: '123456' })
];

test('transactional messages include matching plain-text and HTML content', () => {
  for (const message of messages) {
    assert.ok(message.subject);
    assert.ok(message.text);
    assert.ok(message.html);
    assert.match(message.text, /resetworkflow\.site/i);
    assert.match(message.html, /resetworkflow\.site/i);
  }
});

test('student-facing messages clearly identify the site as an academic demonstration', () => {
  for (const message of messages.slice(0, 4)) {
    assert.match(message.text, /academic demonstration/i);
    assert.match(message.text, /not the official TIP student portal/i);
    assert.doesNotMatch(message.subject, /TIP SecurePass/i);
  }
});

test('email templates escape user-controlled values', () => {
  const message = studentWelcomeEmail({
    firstName: '<script>alert(1)</script>',
    studentNumber: '<b>2026008</b>',
    temporaryPassword: '<unsafe>',
    signInLink: 'https://resetworkflow.site/?next="bad"'
  });

  assert.doesNotMatch(message.html, /<script>/i);
  assert.doesNotMatch(message.html, /<unsafe>/i);
  assert.match(message.html, /&lt;script&gt;/i);
  assert.match(message.html, /&lt;unsafe&gt;/i);
  assert.match(message.html, /&quot;bad&quot;/i);
});
