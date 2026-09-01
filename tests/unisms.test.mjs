import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canUseUniSmsForPhone,
  normalizeUniSmsPhone,
  sendUniSmsOtp
} from '../netlify/functions/_shared/unisms.mjs';

const originalFetch = globalThis.fetch;
const originalEnvironment = { ...process.env };

function configure() {
  process.env.SMS_PROVIDER = 'unisms';
  process.env.UNISMS_BASE_URL = 'https://unismsapi.com/api';
  process.env.UNISMS_API_KEY = 'sk_test-key';
  process.env.UNISMS_SENDER_ID = 'Unisoft';
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of Object.keys(process.env)) if (!(name in originalEnvironment)) delete process.env[name];
  Object.assign(process.env, originalEnvironment);
});

test('normalizes Philippine phone numbers to UniSMS E.164 format', () => {
  assert.equal(normalizeUniSmsPhone('+63 967 153 6804'), '+639671536804');
  assert.equal(normalizeUniSmsPhone('0967-153-6804'), '+639671536804');
  assert.equal(normalizeUniSmsPhone('00639671536804'), '+639671536804');
});

test('uses UniSMS when configured and honors the optional trial allowlist', () => {
  configure();
  assert.equal(canUseUniSmsForPhone('09671536804'), true);
  process.env.UNISMS_TRIAL_MODE = 'true';
  process.env.UNISMS_ALLOWED_PHONE = '+639671536804';
  assert.equal(canUseUniSmsForPhone('09671536804'), true);
  assert.equal(canUseUniSmsForPhone('09171234567'), false);
});

test('sends a six-digit OTP with UniSMS Basic Auth and sender ID', async () => {
  configure();
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return Response.json({
      message: {
        status: 'sent',
        reference_id: 'msg_test-123',
        fail_reason: null
      }
    }, { status: 201 });
  };

  const sent = await sendUniSmsOtp('09671536804', '123456');
  const body = JSON.parse(request.options.body);
  assert.equal(sent.recipient, '+639671536804');
  assert.equal(sent.referenceId, 'msg_test-123');
  assert.equal(request.url, 'https://unismsapi.com/api/sms');
  assert.equal(request.options.headers.Authorization, `Basic ${Buffer.from('sk_test-key:').toString('base64')}`);
  assert.equal(body.recipient, '+639671536804');
  assert.equal(body.sender_id, 'Unisoft');
  assert.match(body.content, /123456/);
  assert.equal(body.metadata.template, 'password_reset_otp');
});

test('rejects a failed UniSMS response', async () => {
  configure();
  globalThis.fetch = async () => Response.json({
    message: { status: 'failed', fail_reason: 'Insufficient SMS credits.' }
  }, { status: 201 });
  await assert.rejects(() => sendUniSmsOtp('09671536804', '123456'), /Insufficient SMS credits/);
});
