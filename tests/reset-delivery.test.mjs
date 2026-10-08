import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import start from '../netlify/functions/_routes/start-reset.mjs';
import verify from '../netlify/functions/_routes/verify-otp.mjs';
import { otpDigest } from '../netlify/functions/_shared/http.mjs';
import { TEST_SECRETS } from './helpers/database.mjs';

const id = '12345678-1234-1234-1234-123456789abc';
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
const request = (body, origin = 'https://example.test') => new Request(origin + '/api/start-reset', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
});
test.beforeEach(() => {
  Object.assign(process.env, { ...TEST_SECRETS, SUPABASE_URL: 'https://example.test', SUPABASE_SECRET_KEY: 'sb_secret_test',
    SMS_PROVIDER: 'unisms', UNISMS_API_KEY: 'test-key', UNISMS_SENDER_ID: 'Test', UNISMS_TRIAL_MODE: 'false' });
});
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});
test('the SMS code matches the reserved digest and verifies successfully', async () => {
  let hash; let sentCode; let sends = 0; let recorded;
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
      assert.ok(options.signal, 'Provider calls have a time limit');
      return Response.json({ message: { status: 'sent', reference_id: 'test-message' } });
    }
    if (url.includes('record_reset_otp_delivery')) { recorded = body; return Response.json(null); }
    if (url.includes('verify_reset_otp')) {
      assert.equal(body.p_otp_hash, hash);
      return Response.json({ status: 'verified' });
    }
    throw new Error('Unexpected request ' + url);
  };
  const result = await (await start(request({ token: 'a'.repeat(43) }))).json();
  assert.equal(result.status, 'active');
  assert.equal(sends, 1);
  assert.equal(result.demoOtp, undefined);
  assert.deepEqual([recorded.p_status, recorded.p_channel, recorded.p_reference, recorded.p_issued], ['sent', 'unisms_sms', 'test-message', true]);
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
    const body=JSON.parse(options.body);
    failed=body.p_status==='unknown' && body.p_issued===false;
    return Response.json(null);
  };
  const result=await (await start(request({token:'a'.repeat(43)}))).json();
  assert.equal(result.status,'unknown'); assert.equal(sends,1); assert.ok(failed); assert.equal(result.demoOtp,undefined);
});
test('a deployed site never shows a simulated code, even with DEMO_MODE enabled', async () => {
  Object.assign(process.env,{SMS_PROVIDER:'',DEMO_MODE:'true'});
  globalThis.fetch=async url => url.includes('prepare_reset_otp')
    ? Response.json({status:'reserved',challenge_id:id,phone:'+639000000000',expires_at:new Date(Date.now()+300000).toISOString()})
    : Response.json(null);
  const deployed=await (await start(request({token:'a'.repeat(43)},'https://www.resetworkflow.site'))).json();
  assert.equal(deployed.demoOtp,undefined);assert.equal(deployed.status,'unknown');
  const local=await (await start(request({token:'a'.repeat(43)},'http://localhost:8888'))).json();
  assert.match(local.demoOtp,/^\d{6}$/,'Simulated delivery remains available on a developer machine');
});
test('a recording failure after a sent SMS still reports the code as sent', async () => {
  globalThis.fetch=async url => {
    if(url.includes('prepare_reset_otp'))return Response.json({status:'reserved',challenge_id:id,phone:'+639000000000',expires_at:new Date(Date.now()+300000).toISOString()});
    if(url.includes('unismsapi.com'))return Response.json({message:{status:'sent',reference_id:'ok'}});
    return Response.json({message:'Synthetic outage'},{status:503});
  };
  const result=await start(request({token:'a'.repeat(43)}));
  assert.equal(result.status,200);assert.equal((await result.json()).status,'active');
});
test('pending provider acceptance is preserved and a later rejection is read without another SMS',async()=>{
  let sends=0,reads=0,stored,updated; let reserved=true;
  globalThis.fetch=async(url,options={})=>{
    const body=options.body?JSON.parse(options.body):{};
    if(url.includes('prepare_reset_otp'))return Response.json({status:reserved?'reserved':'pending',challenge_id:id,student_id:id,
      phone:'+639000000000',expires_at:new Date(Date.now()+300000).toISOString(),remaining_sends:2,
      check_delivery:!reserved,provider_reference:reserved?null:'safe-reference',delivery_channel:'unisms_sms'});
    if(url.includes('unismsapi.com')){
      if(options.method==='GET'){reads++;return Response.json({message:{status:'failed',fail_reason:'OTP does not follow valid format. PRIVATE'}});}
      sends++;return Response.json({message:{status:'pending',reference_id:'safe-reference'}});
    }
    if(url.includes('record_reset_otp_delivery'))stored=body;
    if(url.includes('otp_challenges?'))updated=body;
    return Response.json([{id}]);
  };
  const initial=await (await start(request({token:'a'.repeat(43)}))).json();
  assert.equal(initial.status,'pending');assert.equal(initial.sent,false);assert.equal(stored.p_status,'pending');
  assert.equal(stored.p_reference,'safe-reference');assert.equal(initial.provider_reference,undefined);
  reserved=false;
  const final=await (await start(request({token:'a'.repeat(43)}))).json();
  assert.equal(final.status,'failed');assert.equal(final.deliveryIssue,'content_rejected');assert.equal(final.remainingSends,0);
  assert.equal(updated.delivery_issue,'content_rejected');
  assert.equal(sends,1);assert.equal(reads,1);assert.equal(JSON.stringify(final).includes('PRIVATE'),false);
});
test('incorrect code consumes an attempt without granting a reset', async () => {
  globalThis.fetch=async (url, options) => {
    assert.ok(url.includes('verify_reset_otp'));
    assert.notEqual(JSON.parse(options.body).p_otp_hash,otpDigest('123456'));
    return Response.json({status:'locked',remaining:0});
  };
  const response=await verify(request({challengeId:id,code:'654321'}));
  assert.equal(response.status,400);
  const body=await response.json();
  assert.equal(body.grantToken,undefined);assert.match(body.message,/Request a new reset link/);
});
test('verified codes cannot be replayed', async () => {
  let calls=0;
  globalThis.fetch=async () => { calls++; return Response.json({status:'invalid'}); };
  const response=await verify(request({challengeId:id,code:'123456'}));
  assert.equal(response.status,410); assert.equal(calls,1);
});
test('verification, grant and audit event are one database call, bound to the returned grant', async () => {
  let calls=0,grantHash;
  globalThis.fetch=async (url,options) => {
    calls++;assert.ok(url.includes('verify_reset_otp'));
    grantHash=JSON.parse(options.body).p_grant_hash;
    return Response.json({status:'verified'});
  };
  const response=await verify(request({challengeId:id,code:'012345'}));
  const {grantToken}=await response.json();
  assert.equal(response.status,200);assert.equal(calls,1);
  assert.equal(createHash('sha256').update(grantToken).digest('hex'),grantHash);
});
