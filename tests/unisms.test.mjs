import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canUseUniSmsForPhone,
  getUniSmsStatus,
  normalizeUniSmsPhone,
  otpMessage,
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
  await assert.rejects(() => sendUniSmsOtp('09671536804', '123456'), {code:'SMS_REJECTED'});
});

test('both OTP templates include the real brand, purpose, code and actual five-minute expiry in one SMS', () => {
  for(const purpose of ['password_reset','phone_verification']) {
    const message=otpMessage('012345',purpose);
    assert.match(message,/Your ResetWorkflowApp OTP code is 012345\. Use it to /);
    assert.match(message,/Expires in 5 minutes/);
    assert.match(message,/Please do not share\./);
    assert.match(message,purpose==='password_reset'?/reset your password/:/verify your recovery phone number/);
    assert.doesNotMatch(message,/UniSMS account/);
    assert.ok(message.length<=160);
    assert.match(message,/^[A-Za-z0-9 .]+$/);
  }
  assert.throws(()=>otpMessage('12345'));
  assert.throws(()=>otpMessage('123456','other'));
  assert.throws(()=>otpMessage('123456','constructor'));
});

test('phone setup sends its own template and retains pending status',async()=>{
  configure();
  globalThis.fetch=async(url,options)=>{
    const body=JSON.parse(options.body);
    assert.match(body.content,/verify your recovery phone number/);
    assert.equal(body.metadata.template,'phone_verification_otp');
    return Response.json({message:{reference_id:'msg_phone',status:'pending'}});
  };
  assert.equal((await sendUniSmsOtp('09000000000','123456','phone_verification')).status,'pending');
});

test('delivery lookups are read-only and never return message content, OTP or recipient',async()=>{
  configure();let calls=0;
  for(const status of ['pending','retrying','sent','failed','unexpected']) {
    globalThis.fetch=async(url,options)=>{
      calls++;
      assert.equal(url,'https://unismsapi.com/api/sms/msg_test');
      assert.equal(options.method,'GET');assert.equal(options.body,undefined);
      return Response.json({message:{status,content:'123456',recipient:'+639000000000',fail_reason:'private provider detail'}});
    };
    assert.deepEqual(await getUniSmsStatus('msg_test'),{status:status==='retrying'?'pending':status==='unexpected'?'unknown':status});
  }
  assert.equal(calls,5);
  await assert.rejects(()=>getUniSmsStatus('../other'));
  assert.equal(calls,5);
});

test('content-filter failures expose only a fixed safe category, for queued and immediate rejections',async()=>{
  configure();
  for(const reason of [
    'Unacceptable content: OTP does not follow valid format. Your code is 012345 for +639000000000.',
    'Blocked by content filter: PRIVATE'
  ]) {
    globalThis.fetch=async()=>Response.json({message:{status:'failed',fail_reason:reason,content:'012345',recipient:'+639000000000'}});
    assert.deepEqual(await getUniSmsStatus('msg_rejected'),{status:'failed',failureCode:'content_rejected'});
    await assert.rejects(()=>sendUniSmsOtp('09000000000','012345','phone_verification'),{
      code:'SMS_REJECTED',failureCode:'content_rejected',message:'UniSMS rejected the SMS message.'
    });
  }
  for(const status of ['pending','sent']) {
    globalThis.fetch=async()=>Response.json({message:{status,fail_reason:'Unacceptable content'}});
    assert.deepEqual(await getUniSmsStatus('msg_not-failed'),{status});
  }
});

test('HTTP content rejections are classified without leaking raw error text or retrying',async()=>{
  configure();let calls=0;
  for(const status of [400,422]) {
    globalThis.fetch=async()=>{calls++;return Response.json({error:'Unacceptable content: OTP does not follow valid format. Private code 012345.'},{status});};
    await assert.rejects(()=>sendUniSmsOtp('09000000000','012345','phone_verification'),{
      code:'SMS_REJECTED',failureCode:'content_rejected',message:`UniSMS returned ${status}.`
    });
  }
  assert.equal(calls,2,'One provider request per explicit send');
  globalThis.fetch=async()=>Response.json({error:'Private account diagnostic'},{status:401});
  await assert.rejects(()=>sendUniSmsOtp('09000000000','012345'),{message:'UniSMS returned 401.'});
});
