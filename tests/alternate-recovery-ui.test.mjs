import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {normalizeBackupCode,validBackupCode,normalizeOtp,passwordRules,remainingSeconds,formatCountdown} from '../public/assets/js/recovery-utils.mjs';
import {validatePassword} from '../netlify/functions/_shared/http.mjs';
import {recoveryCodes} from '../netlify/functions/_shared/recovery.mjs';

test('saved backup codes accept real generated format, spaces, and case without accepting six-digit OTPs',()=>{
  for(const code of recoveryCodes()) {
    assert.ok(validBackupCode(code));
    assert.ok(validBackupCode(' '+code.toLowerCase().replaceAll('-', ' ')+' '));
    assert.equal(normalizeBackupCode(code).length,32);
  }
  for(const code of ['', '123456','G'.repeat(32),'A'.repeat(31),'A'.repeat(33)])assert.equal(validBackupCode(code),false);
});
test('OTP paste and time display handle spaces, leading zeros, and expired deadlines',()=>{
  assert.equal(normalizeOtp('012 345'),'012345');
  assert.equal(normalizeOtp('01-23-45'),'012345');
  assert.equal(remainingSeconds(1000,1001),0);
  assert.equal(remainingSeconds(1000,1),1);
  assert.equal(formatCountdown(300),'05:00');
  assert.equal(formatCountdown(600),'10:00');
  assert.equal(formatCountdown(0),'00:00');
});
test('visible password rules exactly match the alternate recovery endpoint policy',()=>{
  for(const password of ['', 'short','LongPassword123!','LongPassword7654321!','A'.repeat(120)+'abc123!','A'.repeat(130)+'abc123!','alllowercase123!','ALLUPPERCASE123!','NoSymbolPassword123','NoNumbersPassword!']) {
    assert.equal(Object.values(passwordRules(password)).every(Boolean),validatePassword(password),password);
  }
});
test('public recovery has unique bindings, separate code sources, and no persistent proofs',async()=>{
  const recover=await readFile(new URL('../public/recover.html',import.meta.url),'utf8');
  const help=await readFile(new URL('../public/recovery-help.html',import.meta.url),'utf8');
  const script=await readFile(new URL('../public/assets/js/recovery.js',import.meta.url),'utf8');
  const union=new Set();
  for(const html of [recover,help]) {
    const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
    assert.equal(ids.length,new Set(ids).size);
    ids.forEach(id=>union.add(id));
    assert.match(html,/type="module"/);
  }
  for(const [,id] of script.matchAll(/\$\("#([a-z][a-z0-9-]*)/g))assert.ok(union.has(id),id);
  for(const step of ['choose','details','verify','password','success','stopped'])assert.match(recover,new RegExp(`data-view="${step}"`));
  assert.doesNotMatch(script,/localStorage|sessionStorage|console\.log|URLSearchParams/);
  assert.match(script,/beforeunload/);
  assert.match(script,/pagehide/);
  assert.match(script,/AbortController/);
  assert.match(script,/submit\.replaceChildren\(\.\.\.original\)/,'Retry preserves accessible button names and decorative arrows');
  assert.match(script,/requestGeneration\+\+/,'Abandoned responses cannot revive an old flow');
  assert.match(recover,/No 7-digit number/);
  assert.match(recover,/one-time-code/);
  assert.match(recover.replace(/\s+/g,' '),/Texts are never resent automatically/);
  assert.match(help.replace(/\s+/g,' '),/does not reset your password/);
});
