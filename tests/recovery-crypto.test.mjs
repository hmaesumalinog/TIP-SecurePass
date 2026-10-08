import assert from 'node:assert/strict';
import test from 'node:test';
import { createCipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { base32, totp, encryptSecret, decryptSecret, matchingStep, recoveryCodes, codeHash } from '../netlify/functions/_shared/recovery.mjs';
import { TEST_SECRETS } from './helpers/database.mjs';
Object.assign(process.env,TEST_SECRETS);
const secret=base32(Buffer.from('12345678901234567890'));
test('authenticator matches RFC 6238 SHA1 reference vectors',()=>{
  for(const [time,expected] of [[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']]) assert.equal(totp(secret,Math.floor(time/30),8),expected);
});
test('encrypted authenticator secrets are randomized and bound to the student',()=>{
  const value=encryptSecret(secret,'student-one');
  assert.match(value,/^v2\./);
  assert.equal(decryptSecret(value,'student-one'),secret);
  assert.notEqual(value,encryptSecret(secret,'student-one'));
  assert.throws(()=>decryptSecret(value,'student-two'));
  assert.throws(()=>decryptSecret(value.slice(0,-3)+'xxx','student-one'));
  assert.ok(!value.includes(secret));
});
test('encryption key is independent of the code pepper; legacy v1 secrets still decrypt',()=>{
  // A v1 secret exactly as stored before the keys were separated.
  const key=Buffer.from(hkdfSync('sha256',TEST_SECRETS.APP_PEPPER,'TIP SecurePass','recovery-encryption-v1',32));
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from('student-one'));
  const encrypted=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
  const legacy=['v1',iv.toString('base64url'),encrypted.toString('base64url'),cipher.getAuthTag().toString('base64url')].join('.');
  assert.equal(decryptSecret(legacy,'student-one'),secret);
  const current=encryptSecret(secret,'student-one');
  process.env.APP_PEPPER='a-rotated-code-pepper-for-this-test-only-1234';
  try {
    assert.equal(decryptSecret(current,'student-one'),secret,'Rotating APP_PEPPER does not break v2 secrets');
  } finally { process.env.APP_PEPPER=TEST_SECRETS.APP_PEPPER; }
  assert.throws(()=>decryptSecret('v9.a.b.c','student-one'),/Unsupported/);
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
