// Local-only visual QA fixtures. No credentials, database, email, or SMS calls.
// Run: node tests/helpers/enrollment-preview.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root=resolve('public');
let enabled=false,broken=false,logoutFails=false;
const student={studentNumber:'7654321',firstName:'Demo',lastName:'Student',fullName:'Demo Student',email:'demo@example.invalid',phone:'+639000000000',age:21,program:'BS Information Technology',yearLevel:3};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:4175');
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  if(url.pathname==='/__fixtures'){
    res.writeHead(200,{'Content-Type':'text/html'});
    res.end('<h1>Local-only enrollment QA</h1><p>No real accounts or providers are connected.</p><a href="/__fixture/new">New student setup</a><br><a href="/__fixture/existing">Existing unenrolled student</a><br><a href="/__fixture/enrolled">Enrolled student</a><br><a href="/__fixture/error">Database error</a><br><a href="/__fixture/logout-error">Sign-out error</a>');return;
  }
  if(url.pathname.startsWith('/__fixture/')){
    const mode=url.pathname.split('/').pop();enabled=mode==='enrolled';broken=mode==='error';logoutFails=mode==='logout-error';
    res.writeHead(302,{Location:mode==='new'?'/security.html?onboarding=1':'/portal.html'});res.end();return;
  }
  if(url.pathname==='/api/profile'){
    if(broken)return json({message:'Security settings could not be loaded. Refresh to retry.'},503);
    return enabled?json({student}):json({code:'AUTHENTICATOR_SETUP_REQUIRED',message:'Set up authenticator'},403);
  }
  if(url.pathname==='/api/logout') return json({message:logoutFails?'Try again':'Signed out'},logoutFails?500:200);
  if(url.pathname==='/.netlify/functions/security-settings'){
    if(req.method==='GET') return json({status:'ok',enabled,remaining:enabled?10:0,phoneVerified:false});
    let body='';for await(const chunk of req)body+=chunk;
    const input=JSON.parse(body);
    if(input.action==='begin')return json({message:'Local visual test only: enter 123456 to confirm.',secret:'LOCAL-PREVIEW-NOT-A-REAL-SETUP-KEY',qr:'/assets/images/brand-mark.svg'});
    if(input.action==='confirm'){
      if(input.code!=='123456')return json({message:'Could not verify this change. Check your verification code.'},400);
      enabled=true;return json({message:'Authenticator confirmed in local preview.',codes:Array.from({length:10},(_,i)=>`PREVIEW-ONLY-NOT-VALID-CODE-${i+1}`)});
    }
    if(input.action==='disable'){enabled=false;return json({message:'Removed in preview.'});}
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
