// Local-only QA: synthetic data and in-memory delivery. Never contacts providers.
// node tests/helpers/email-recovery-preview.mjs -> http://127.0.0.1:4176/__qa
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import * as emails from '../../netlify/functions/_shared/resend.mjs';

const root=resolve('public');
let mode='normal', stats={email:0,start:0,sms:0,verify:0,save:0}, active=false, verified=false;
const templates={
  reset:()=>emails.resetEmail({firstName:'Alex',resetLink:'https://resetworkflow.site/reset.html?token=LOCAL-PREVIEW-NOT-A-REAL-RESET-TOKEN'}),
  welcome:()=>emails.studentWelcomeEmail({firstName:'Alex',studentNumber:'7654321',temporaryPassword:'Preview-Only-1!',signInLink:'https://resetworkflow.site/'}),
  invitation:()=>emails.recoveryOptionsEmail({firstName:'Alex',origin:'https://resetworkflow.site',invited:true}),
  options:()=>emails.recoveryOptionsEmail({firstName:'Alex',origin:'https://resetworkflow.site',invited:false}),
  changed:()=>emails.resetConfirmationEmail({firstName:'Alex'}),
  setup:()=>emails.firstLoginConfirmationEmail({firstName:'Alex'}),
  admin:()=>emails.adminVerificationEmail({displayName:'Test Administrator',code:'012345'}),
  ...Object.fromEntries(['confirm','codes','disable','phone_confirm','password reset'].map(event=>[event.replaceAll(' ','-'),()=>emails.securityNoticeEmail({event})]))
};
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://127.0.0.1:4176').pathname;
  const json=(body,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
  if(path==='/__qa') {
    res.setHeader('Content-Type','text/html');res.end('<h1>Local-only recovery QA</h1><p>No real messages or accounts. Phone code: 012345.</p>'+['normal','slow','network','limited','reset','wrong','expired','otp-expiry','save-expiry','save-error','notice-error','pending','sms-failure'].map(m=>`<p><a href="/__qa/${m}">${m}</a></p>`).join('')+'<h2>Email previews</h2>'+Object.keys(templates).map(k=>`<p><a href="/__email/${k}">${k}</a></p>`).join(''));return;
  }
  if(path.startsWith('/__qa/')) {
    mode=path.split('/').pop();stats={email:0,start:0,sms:0,verify:0,save:0};active=false;verified=false;
    res.writeHead(302,{Location:['normal','slow','network','limited'].includes(mode)?'/forgot.html':'/reset.html?token='+'V'.repeat(43)});res.end();return;
  }
  if(path==='/__stats')return json(stats);
  if(path.startsWith('/__email/')){
    const render=templates[path.split('/').pop()];if(!render){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});res.end(render().html);return;
  }
  if(path.startsWith('/api/')) {
    let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw||'{}');
    if(mode==='slow')await new Promise(resolve=>setTimeout(resolve,1000));
    if(path==='/api/request-reset') {
      stats.email++;
      if(mode==='network'){res.destroy();return;}
      if(mode==='limited')return json({message:'Too many reset requests. Wait 15 minutes before trying again.'},429);
      return json({message:'If an account matches that email, we will send its available recovery steps.'});
    }
    if(path==='/api/start-reset') {
      stats.start++;
      if(mode==='expired')return json({message:'This link has expired.'},410);
      if(verified)return json({status:'verified'});
      const sent=!active||body.resend;if(sent)stats.sms++;
      active=true;
      return json({status:mode==='pending'&&stats.start<3?'pending':mode==='sms-failure'?'failed':'active',challengeId:'11111111-1111-4111-8111-111111111111',maskedPhone:'+63 ••• ••• 0000',expiresIn:mode==='otp-expiry'?3:300,retryAfter:3,remainingSends:Math.max(0,3-stats.sms),sent});
    }
    if(path==='/api/verify-otp') {
      stats.verify++;
      if(mode==='wrong'||body.code!=='012345')return json({message:stats.verify<5?`That code is not correct. ${5-stats.verify} attempts remaining.`:'Too many incorrect attempts. Request a new reset link.'},400);
      verified=true;return json({grantToken:'G'.repeat(43),expiresIn:mode==='save-expiry'?3:600});
    }
    if(path==='/api/complete-reset') {
      stats.save++;
      if(mode==='save-error'){res.destroy();return;}
      if(!verified)return json({message:'No verified session.'},410);
      return json({message:'Synthetic password saved only.',noticeSent:mode!=='notice-error'});
    }
    return json({message:'Fixture endpoint not implemented'},404);
  }
  try {
    let file=resolve(root,'.'+(path==='/'?'/index.html':path));
    if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
    let content=await readFile(file);
    // Short waits only in this fixture, never in the deployed asset.
    if(path==='/assets/js/email-recovery.js')content=Buffer.from(content.toString().replaceAll('Date.now() + 60000','Date.now() + 3000'));
    res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(content);
  } catch {res.writeHead(404);res.end('Not found');}
});
server.listen(4176,'127.0.0.1',()=>console.log('Local-only recovery QA: http://127.0.0.1:4176/__qa'));
