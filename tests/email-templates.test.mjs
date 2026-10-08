import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,readdir} from 'node:fs/promises';
import * as email from '../netlify/functions/_shared/resend.mjs';
import {securityNotice} from '../netlify/functions/_shared/recovery.mjs';
import complete from '../netlify/functions/_routes/complete-reset.mjs';
import requestReset from '../netlify/functions/_routes/request-reset.mjs';
import { TEST_SECRETS } from './helpers/database.mjs';

const base='https://portal.example.invalid';
function setEnv(t,key,value) {
 const before=process.env[key];process.env[key]=value;
 t.after(()=>{if(before===undefined)delete process.env[key];else process.env[key]=before;});
}
const messages=()=>[
 email.resetEmail({firstName:'Test',resetLink:base+'/reset.html?token=not-a-real-token'}),
 email.resetConfirmationEmail({firstName:'Test'}),
 email.firstLoginConfirmationEmail({firstName:'Test'}),
 email.studentWelcomeEmail({firstName:'Test',studentNumber:'7654321',temporaryPassword:'Synthetic!Password1',signInLink:base}),
 email.adminVerificationEmail({displayName:'Test Admin',code:'012345'}),
 ...[true,false].map(invited=>email.recoveryOptionsEmail({firstName:'Test',origin:base,invited})),
 ...['confirm','codes','disable','phone_confirm','password reset'].map(event=>email.securityNoticeEmail({event}))
];
test('all 12 email variants share the branded responsive template and plain-text alternative',()=>{
 for(const message of messages()) {
  assert.match(message.html,/<!doctype html>/i);
  assert.match(message.html,/name="viewport"/);
  assert.match(message.html,/data-email-template=/);
  assert.match(message.html,/role="presentation"/);
  assert.match(message.html,/Keep your account private/);
  assert.match(message.text,/not the official TIP student portal/);
  assert.match(message.html,/not the official TIP student portal/);
  assert.doesNotMatch(message.html,/<script|<link|<img|<iframe/i);
  assert.ok(Buffer.byteLength(message.html)<30000);
 }
});
test('security notices translate every internal action into a readable explanation without exposing secrets',()=>{
 for(const [event,title] of Object.entries({confirm:'Authenticator connected',codes:'New backup codes created',disable:'Authenticator recovery removed',phone_confirm:'Recovery phone verified','password reset':'Your password has been changed'})) {
  const message=email.securityNoticeEmail({event});assert.ok(message.text.includes(title));
  assert.doesNotMatch(message.html,/phone_confirm|\(confirm\)|\(codes\)/);
 }
 assert.doesNotMatch(email.securityNoticeEmail({event:'unexpected-secret-123'}).html,/unexpected-secret/);
});
test('identity is safely escaped without rewriting links, names, or temporary credentials',t=>{
 setEnv(t,'EMAIL_APP_NAME','Test <Portal>');
 setEnv(t,'SITE_URL','https://portal.example.invalid');
 const message=email.studentWelcomeEmail({firstName:'<Alex>',studentNumber:'7654321',temporaryPassword:'Reset Workflow-resetworkflow.site1!',signInLink:'https://resetworkflow.site/?next="value"'});
 assert.match(message.html,/Test &lt;Portal&gt;/);
 assert.match(message.html,/&lt;Alex&gt;/);
 assert.match(message.html,/Reset Workflow-resetworkflow.site1!/);
 assert.match(message.html,/href="https:\/\/resetworkflow.site\/\?next=&quot;value&quot;"/);
 assert.match(message.text,/Temporary password: Reset Workflow-resetworkflow.site1!/);
});
test('email action links reject executable, unencrypted, and embedded-credential URLs',()=>{
 for(const resetLink of ['javascript:alert(1)','http://example.invalid/','https://user:secret@example.invalid/']) {
  assert.throws(()=>email.resetEmail({resetLink}),/HTTPS/);
 }
});
test('all application email delivery stays behind the shared sender; no inline paragraph notices',async()=>{
 for(const path of ['../netlify/functions/','../netlify/functions/_routes/']) {
  const folder=new URL(path,import.meta.url);
  for(const name of await readdir(folder)) {
   if(!name.endsWith('.mjs'))continue;
   const source=await readFile(new URL(name,folder),'utf8');
   assert.doesNotMatch(source,/api\.resend\.com|html\s*:/,name);
  }
 }
 const source=await readFile(new URL('../netlify/functions/_shared/recovery.mjs',import.meta.url),'utf8');
 assert.match(source,/securityNoticeEmail\(\{event\}\)/);
 assert.doesNotMatch(source,/html\s*:/);
});
const request=body=>new Request(base+'/api/complete-reset',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
function environment(t) {
 for(const [key,value]of Object.entries({RESEND_API_KEY:'synthetic',SITE_URL:base,SUPABASE_URL:base,SUPABASE_SECRET_KEY:'sb_secret_test',...TEST_SECRETS}))setEnv(t,key,value);
}
test('Resend receives both template formats, recipient, and idempotency key',async t=>{
 environment(t);let captured;
 t.mock.method(globalThis,'fetch',async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');captured=options;return Response.json({id:'synthetic'});});
 assert.equal(await securityNotice('test@example.invalid','codes','test-event'),true);
 const body=JSON.parse(captured.body);
 assert.deepEqual(body.to,['test@example.invalid']);
 assert.equal(captured.headers['Idempotency-Key'],'recovery-test-event');
 assert.match(body.html,/data-email-template="account-security"/);
 assert.match(body.text,/previous set is no longer valid/);
});
test('successful password change is not reported as failure when email and audit logging fail',async t=>{
 environment(t);
 t.mock.method(globalThis,'fetch',async url=>{
  if(url.includes('complete_password_reset'))return Response.json([{email:'test@example.invalid',first_name:'Test',event_id:'event',student_id:'student'}]);
  return Response.json({message:'Synthetic failure'},{status:503});
 });
 const result=await complete(request({grantToken:'a'.repeat(43),password:'Long!Password123'}));
 assert.equal(result.status,200);assert.equal((await result.json()).noticeSent,false);
});
test('forgot-password response does not reveal unknown, invited, or phone-enabled account state',async t=>{
 environment(t);const results=[];
 for(const state of ['missing','invited','no-phone','ready']) {
  let sent,audited;
  t.mock.method(globalThis,'fetch',async(url,options={})=>{
   if(url.includes('api.resend.com')){sent=JSON.parse(options.body);return Response.json({id:'synthetic'});}
   if(url.includes('rpc/reserve_access_attempt'))return Response.json('synthetic-reservation');
   if(url.includes('rpc/prepare_password_reset')) {
    const student={id:'student',email:'test@example.invalid',first_name:'Test'};
    return Response.json(state==='missing'?{kind:'none'}:state==='ready'?{kind:'reset',token_id:'token',student}:{kind:'options',invited:state==='invited',student});
   }
   if(url.includes('audit_events'))audited=JSON.parse(options.body);
   return Response.json([{id:'synthetic'}]);
  });
  const response=await requestReset(request({email:'test@example.invalid'}));
  assert.equal(response.status,200);results.push(await response.json());
  if(state!=='missing'){assert.match(sent.html,/data-email-template=/);assert.equal(audited.details.delivery,'sent');}
  else {assert.equal(sent,undefined);assert.equal(audited,undefined);}
  if(state==='ready')assert.match(sent.text,/reset\.html\?token=/);
 }
 for(const result of results)assert.deepEqual(result,results[0]);
});
test('forgot-password answers before any account lookup or email, so timing reveals nothing',async t=>{
 environment(t);const order=[];let background,release;const gate=new Promise(resolve=>{release=resolve;});
 t.mock.method(globalThis,'fetch',async(url)=>{
  if(url.includes('rpc/reserve_access_attempt')){order.push('reserve');return Response.json('synthetic-reservation');}
  if(url.includes('rpc/prepare_password_reset')){order.push('lookup');await gate;return Response.json({kind:'reset',token_id:'t',student:{id:'s',email:'test@example.invalid',first_name:'Test'}});}
  if(url.includes('api.resend.com')){order.push('email');return Response.json({id:'synthetic'});}
  order.push('audit');return Response.json([{id:'synthetic'}]);
 });
 const response=await requestReset(request({email:'test@example.invalid'}),{ip:'192.0.2.1',waitUntil:promise=>{background=promise;}});
 assert.equal(response.status,200);
 assert.equal(order.includes('email'),false,'The response does not wait for the account lookup or email');
 release();await background;
 assert.deepEqual(order,['reserve','lookup','email','audit']);
});
