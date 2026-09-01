import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canUseInfobipForPhone,
  isInfobipReference,
  normalizeInfobipPhone,
  sendInfobipOtp,
  sendInfobipPin,
  verifyInfobipPin
} from '../netlify/functions/_shared/infobip.mjs';

const originalFetch = globalThis.fetch;
const originalEnvironment = { ...process.env };

function configure() {
  process.env.SMS_PROVIDER = 'infobip';
  process.env.INFOBIP_BASE_URL = 'example.api.infobip.com';
  process.env.INFOBIP_API_KEY = 'secret-test-key';
  process.env.INFOBIP_2FA_APPLICATION_ID = 'application-id';
  process.env.INFOBIP_2FA_MESSAGE_ID = 'message-id';
  process.env.INFOBIP_SMS_FROM = 'ServiceSMS';
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of Object.keys(process.env)) if (!(name in originalEnvironment)) delete process.env[name];
  Object.assign(process.env, originalEnvironment);
});

test('normalizes common Philippine phone formats to international digits', () => {
  assert.equal(normalizeInfobipPhone('+63 967 153 6804'), '639671536804');
  assert.equal(normalizeInfobipPhone('0967-153-6804'), '639671536804');
  assert.equal(normalizeInfobipPhone('00639671536804'), '639671536804');
});

test('free-trial eligibility is limited to configured verified recipients', () => {
  configure();
  process.env.INFOBIP_TRIAL_MODE = 'true';
  process.env.INFOBIP_TRIAL_ALLOWED_PHONE = '639671536804';
  assert.equal(canUseInfobipForPhone('09671536804'), true);
  assert.equal(canUseInfobipForPhone('09171234567'), false);
});

test('sends and verifies a PIN through the Infobip 2FA endpoints', async () => {
  configure();
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/verify')) return Response.json({ verified: true });
    return Response.json({ pinId: 'ABC_def-12345678' });
  };

  const sent = await sendInfobipPin('09671536804');
  assert.equal(sent.to, '639671536804');
  assert.equal(isInfobipReference(sent.reference), true);
  assert.equal(await verifyInfobipPin(sent.reference, '123456'), true);
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/2fa\/2\/pin$/);
  assert.match(requests[1].url, /\/2fa\/2\/pin\/ABC_def-12345678\/verify$/);
  assert.equal(JSON.parse(requests[0].options.body).to, '639671536804');
  assert.equal(JSON.parse(requests[1].options.body).pin, '123456');
});

test('sends a six-digit OTP through the Infobip SMS API', async () => {
  configure();
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return Response.json({
      messages: [{
        messageId: 'sms-message-id',
        status: { groupName: 'PENDING', name: 'PENDING_ACCEPTED' }
      }]
    });
  };

  const sent = await sendInfobipOtp('09671536804', '123456');
  const body = JSON.parse(request.options.body);
  assert.equal(sent.to, '639671536804');
  assert.match(request.url, /\/sms\/3\/messages$/);
  assert.equal(body.messages[0].sender, 'ServiceSMS');
  assert.equal(body.messages[0].destinations[0].to, '639671536804');
  assert.match(body.messages[0].content.text, /123456/);
});
