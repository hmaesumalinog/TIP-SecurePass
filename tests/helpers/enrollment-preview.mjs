// Local-only visual QA fixtures. No credentials, database, email, or SMS calls.
// Run: node tests/helpers/enrollment-preview.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import QRCode from 'qrcode';

const root=resolve('public');
let enabled=false,broken=false,logoutFails=false,phoneVerified=false,smsFailure=false,remaining=0;
const previewCodes=()=>Array.from({length:10},(_,i)=>`PREVIEW-ONLY-NOT-VALID-CODE-${i+1}`);
const previewQr=await QRCode.toDataURL('LOCAL VISUAL TEST ONLY - NOT AN AUTHENTICATOR KEY');
const student={studentNumber:'7654321',firstName:'Demo',lastName:'Student',fullName:'Demo Student',email:'demo@example.invalid',phone:'+639000000000',age:21,program:'BS Information Technology',yearLevel:3};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:4175');
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  if(url.pathname==='/__fixtures'){
    res.writeHead(200,{'Content-Type':'text/html'});
    res.end('<h1>Local-only enrollment QA</h1><p>No real accounts or providers are connected. Use any password except wrong; code 123456.</p><a href="/__fixture/new">New student setup</a><br><a href="/__fixture/existing">Existing unenrolled student</a><br><a href="/__fixture/enrolled">Enrolled student</a><br><a href="/__fixture/error">Database error</a><br><a href="/__fixture/logout-error">Sign-out error</a><br><a href="/__fixture/sms-error">SMS provider error</a><br><a href="/__fixture/empty-codes">No backup codes left</a>');return;
  }
  if(url.pathname.startsWith('/__fixture/')){
    const mode=url.pathname.split('/').pop();enabled=['enrolled','sms-error','empty-codes'].includes(mode);broken=mode==='error';logoutFails=mode==='logout-error';smsFailure=mode==='sms-error';phoneVerified=false;remaining=enabled&&mode!=='empty-codes'?10:0;
    res.writeHead(302,{Location:mode==='existing'?'/portal.html':'/security.html?onboarding=1'});res.end();return;
  }
  if(url.pathname==='/api/profile'){
    if(broken)return json({message:'Security settings could not be loaded. Refresh to retry.'},503);
    return enabled?json({student}):json({code:'AUTHENTICATOR_SETUP_REQUIRED',message:'Set up authenticator'},403);
  }
  if(url.pathname==='/api/logout') return json({message:logoutFails?'Try again':'Signed out'},logoutFails?500:200);
  if(url.pathname==='/.netlify/functions/security-settings'){
    if(req.method==='GET')return broken?json({message:'Local test: settings unavailable. Use another fixture to restore.'},503):json({status:'ok',enabled,remaining,phoneVerified,maskedPhone:'+63 ••• ••• 0000'});
    let body='';for await(const chunk of req)body+=chunk;
    const input=JSON.parse(body);
    if(!input.password||input.password==='wrong')return json({message:'Could not verify this change. Check your current password and verification code.'},400);
    if(input.action==='begin')return json({message:'Local visual test only: enter 123456 to confirm.',secret:'LOCAL-PREVIEW-NOT-A-REAL-SETUP-KEY',qr:previewQr});
    if(input.action==='confirm'){
      if(input.code!=='123456')return json({message:'Could not verify this change. Check your verification code.'},400);
      enabled=true;remaining=10;return json({message:'Authenticator confirmed in local preview.',codes:previewCodes()});
    }
    if(input.action==='phone_start')return smsFailure?json({message:'SMS delivery could not be confirmed. If a code arrives, you can still enter it. Wait at least 60 seconds before trying again.'},502):json({message:'SMS sent in preview only.'});
    if(input.code!=='123456')return json({message:'Could not verify this change. Check the code and try again.'},400);
    if(input.action==='phone_confirm'){phoneVerified=true;return json({message:'Phone verified in preview.'});}
    if(input.action==='codes'){remaining=10;return json({message:'Replacement codes in preview.',codes:previewCodes()});}
    if(input.action==='disable'){enabled=false;remaining=0;return json({message:'Removed in preview.'});}
    return json({message:'Not implemented in this visual fixture.'},400);
  }
  if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/.netlify/'))return json({message:'Local fixture does not call production.'},404);
  const path=resolve(root,`.${url.pathname==='/'?'/index.html':url.pathname}`);
  if(!path.startsWith(root+sep)){res.writeHead(403);res.end();return;}
  try{
    const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
    const content=await readFile(path);res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});res.end(content);
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(4175,'127.0.0.1',()=>console.log('Local-only QA: http://127.0.0.1:4175/__fixtures'));
