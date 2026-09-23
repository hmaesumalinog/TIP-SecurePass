import assert from 'node:assert/strict';
import test from 'node:test';
import {createSmsReceipt,readSmsReceipt} from '../netlify/functions/_shared/sms-receipt.mjs';

test('SMS delivery receipt is bound to the authenticated student, password version and latest challenge',()=>{
  const original=process.env.APP_PEPPER;
  process.env.APP_PEPPER='synthetic-receipt-test-pepper-1234567890';
  try {
    const context={sid:'synthetic-student',version:123,hash:'synthetic-code-digest'};
    const token=createSmsReceipt({...context,referenceId:'msg_synthetic'},1000);
    assert.equal(readSmsReceipt(token,context,1001).ref,'msg_synthetic');
    for(const changed of [{sid:'someone-else'},{version:124},{hash:'replacement-code'},{hash:''}])
      assert.equal(readSmsReceipt(token,{...context,...changed},1001),null);
    assert.equal(readSmsReceipt(token,context,301000),null);
    assert.equal(readSmsReceipt(token+'extra',context,1001),null);
    assert.equal(readSmsReceipt('bad.token.extra',context,1001),null);
    assert.equal(readSmsReceipt(token,context,0),null);
    const badReference=createSmsReceipt({...context,referenceId:'../sms'},1000);
    assert.equal(readSmsReceipt(badReference,context,1001),null);
    const payload=JSON.parse(Buffer.from(token.split('.')[0],'base64url').toString());
    assert.equal(payload.hash,undefined);assert.equal(payload.phone,undefined);assert.equal(payload.otp,undefined);
  }finally{if(original===undefined)delete process.env.APP_PEPPER;else process.env.APP_PEPPER=original;}
});
