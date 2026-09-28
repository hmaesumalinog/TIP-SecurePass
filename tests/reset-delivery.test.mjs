import test from 'node:test';
import assert from 'node:assert/strict';
import start from '../netlify/functions/start-reset.mjs';
import verify from '../netlify/functions/verify-otp.mjs';
import { otpDigest } from '../netlify/functions/_shared/http.mjs';

const id = '12345678-1234-1234-1234-123456789abc';
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const request = (body) => new Request('https://example.test/api/start-reset', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
});
test.beforeEach(() => {
  Object.assign(process.env, { SUPABASE_URL: 'https://example.test', SUPABASE_SECRET_KEY: 'sb_secret_test',
    APP_PEPPER: 'test-pepper-that-is-at-least-thirty-two-characters', SMS_PROVIDER: 'unisms',
    UNISMS_API_KEY: 'test-key', UNISMS_SENDER_ID: 'Test', UNISMS_TRIAL_MODE: 'false' });
});
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});
test('the SMS code matches the reserved digest and verifies successfully', async () => {
  let hash; let sentCode; let sends = 0;
  globalThis.fetch = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : {};
    if (url.includes('prepare_reset_otp')) {
      hash = body.p_otp_hash;
      return Response.json({ status: 'reserved', challenge_id: id, student_id: id, phone: '+639000000000',
        expires_at: new Date(Date.now()+300000).toISOString(), retry_after: 60, remaining_sends: 2 });
    }
    if (url.includes('unismsapi.com')) {
      sends++; sentCode = body.content.match(/\b\d{6}\b/)[0];
      assert.equal(hash, otpDigest(sentCode));
      return Response.json({ message: { status: 'sent', reference_id: 'test-message' } });
    }
    if (url.includes('otp_challenges?') && !options.method) return Response.json([{
      id, student_id: id, otp_hash: hash, expires_at: new Date(Date.now()+300000).toISOString(),
      attempts: 0, locked_at: null, verified_at: null
    }]);
    if (url.includes('consume_student_otp_attempt')) {
      assert.equal(body.p_correct, true);
      return Response.json([{ status: 'verified', student_id: id }]);
    }
    return Response.json([{ id }]);
  };
  const result = await (await start(request({ token: 'a'.repeat(43) }))).json();
  assert.equal(result.status, 'active');
  assert.equal(sends, 1);
  assert.equal(result.demoOtp, undefined);
  const verified = await verify(request({ challengeId: id, code: sentCode }));
  assert.equal(verified.status, 200);
  assert.ok((await verified.json()).grantToken);
});
for (const status of ['active', 'pending', 'unknown', 'failed', 'expired', 'limited', 'verified']) {
  test(status + ' state never sends another SMS', async () => {
    let calls=0;
    globalThis.fetch=async (url) => {
      calls++;
      assert.ok(url.includes('prepare_reset_otp'));
      return Response.json({ status, challenge_id:id, retry_after:35 });
    };
    const response=await start(request({token:'a'.repeat(43)}));
    assert.equal((await response.json()).status,status);
    assert.equal(calls,1);
  });
}
test('provider outage remains uncertain without returning a demo code or retrying SMS', async () => {
  let sends=0; let failed=false;
  globalThis.fetch=async (url, options) => {
    if(url.includes('prepare_reset_otp')) return Response.json({status:'reserved',challenge_id:id,phone:'+639000000000'});
    if(url.includes('unismsapi.com')) { sends++; return Response.json({error:'unavailable'},{status:503}); }
    failed=JSON.parse(options.body).delivery_status==='unknown';
    return Response.json([{id}]);
  };
  const result=await (await start(request({token:'a'.repeat(43)}))).json();
  assert.equal(result.status,'unknown'); assert.equal(sends,1); assert.ok(failed); assert.equal(result.demoOtp,undefined);
});
test('pending provider acceptance is preserved and a later rejection is read without another SMS',async()=>{
  let sends=0,reads=0,stored; let reserved=true;
  globalThis.fetch=async(url,options={})=>{
    const body=options.body?JSON.parse(options.body):{};
    if(url.includes('prepare_reset_otp'))return Response.json({status:reserved?'reserved':'pending',challenge_id:id,student_id:id,
      phone:'+639000000000',expires_at:new Date(Date.now()+300000).toISOString(),remaining_sends:2,
      check_delivery:!reserved,provider_reference:reserved?null:'safe-reference',delivery_channel:'unisms_sms'});
    if(url.includes('unismsapi.com')){
      if(options.method==='GET'){reads++;return Response.json({message:{status:'failed',fail_reason:'OTP does not follow valid format. PRIVATE'}});}
      sends++;return Response.json({message:{status:'pending',reference_id:'safe-reference'}});
    }
    if(url.includes('otp_challenges?'))stored=body;
    return Response.json([{id}]);
  };
  const initial=await (await start(request({token:'a'.repeat(43)}))).json();
  assert.equal(initial.status,'pending');assert.equal(initial.sent,false);assert.equal(stored.delivery_status,'pending');
  assert.equal(stored.provider_reference,'safe-reference');assert.equal(initial.provider_reference,undefined);
  reserved=false;
  const final=await (await start(request({token:'a'.repeat(43)}))).json();
  assert.equal(final.status,'failed');assert.equal(final.deliveryIssue,'content_rejected');assert.equal(final.remainingSends,0);
  assert.equal(sends,1);assert.equal(reads,1);assert.equal(JSON.stringify(final).includes('PRIVATE'),false);
});
test('incorrect code consumes an attempt without granting a reset', async () => {
  globalThis.fetch=async (url, options) => {
    if(url.includes('otp_challenges?')) return Response.json([{id,student_id:id,otp_hash:otpDigest('123456'),
      expires_at:new Date(Date.now()+300000).toISOString(),attempts:4}]);
    assert.ok(url.includes('consume_student_otp_attempt'));
    assert.equal(JSON.parse(options.body).p_correct,false);
    return Response.json([{status:'locked',remaining:0}]);
  };
  const response=await verify(request({challengeId:id,code:'654321'}));
  assert.equal(response.status,400);
  assert.equal((await response.json()).grantToken,undefined);
});
test('verified codes cannot be replayed', async () => {
  let calls=0;
  globalThis.fetch=async () => {
    calls++;
    return Response.json([{id,verified_at:new Date().toISOString()}]);
  };
  const response=await verify(request({challengeId:id,code:'123456'}));
  assert.equal(response.status,410); assert.equal(calls,1);
});
test('an audit outage after OTP verification does not hide the issued reset grant', async () => {
  globalThis.fetch=async url=>{
    if(url.includes('otp_challenges?'))return Response.json([{id,student_id:id,otp_hash:otpDigest('012345'),expires_at:new Date(Date.now()+300000).toISOString(),attempts:0}]);
    if(url.includes('consume_student_otp_attempt'))return Response.json([{status:'verified',student_id:id}]);
    if(url.includes('reset_grants?'))return Response.json([{id}]);
    if(url.includes('audit_events?'))return Response.json({message:'Synthetic audit outage'},{status:503});
    throw new Error('Unexpected test request');
  };
  const response=await verify(request({challengeId:id,code:'012345'}));
  assert.equal(response.status,200);assert.ok((await response.json()).grantToken);
});
