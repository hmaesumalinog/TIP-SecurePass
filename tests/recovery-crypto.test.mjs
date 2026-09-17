import assert from 'node:assert/strict';
import test from 'node:test';
import { base32, totp, encryptSecret, decryptSecret, matchingStep, recoveryCodes, codeHash } from '../netlify/functions/_shared/recovery.mjs';
process.env.APP_PEPPER='test-pepper-not-a-production-secret-123456789';
const secret=base32(Buffer.from('12345678901234567890'));
test('authenticator matches RFC 6238 SHA1 reference vectors',()=>{
  for(const [time,expected] of [[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']]) assert.equal(totp(secret,Math.floor(time/30),8),expected);
});
test('encrypted authenticator secrets are randomized and bound to the student',()=>{
  const value=encryptSecret(secret,'student-one');
  assert.equal(decryptSecret(value,'student-one'),secret);
  assert.notEqual(value,encryptSecret(secret,'student-one'));
  assert.throws(()=>decryptSecret(value,'student-two'));
  assert.throws(()=>decryptSecret(value.slice(0,-3)+'xxx','student-one'));
  assert.ok(!value.includes(secret));
});
test('authenticator accepts only six-digit codes within its small clock window',()=>{
  const value=encryptSecret(secret,'one'),time=1234567890000,step=Math.floor(time/30000);
  assert.equal(matchingStep(value,'one',totp(secret,step),time),step);
  assert.equal(matchingStep(value,'one',totp(secret,step-1),time),step-1);
  assert.equal(matchingStep(value,'one',totp(secret,step-3),time),-1);
  assert.equal(matchingStep(value,'one','123',time),-1);
});
test('backup codes contain 128 random bits and normalize without losing entropy',()=>{
  const codes=recoveryCodes();assert.equal(codes.length,10);assert.equal(new Set(codes).size,10);
  for(const code of codes){assert.match(code,/^(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/);assert.equal(codeHash(code),codeHash(code.toLowerCase().replaceAll('-',' ')));assert.notEqual(codeHash(code),code);}
});
