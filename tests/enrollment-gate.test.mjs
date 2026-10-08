import assert from 'node:assert/strict';
import test from 'node:test';
import profile from '../netlify/functions/_routes/profile.mjs';
import { createSession, sessionCookie } from '../netlify/functions/_shared/session.mjs';
import { TEST_SECRETS } from './helpers/database.mjs';

test('portal enrollment gate fails closed on status errors and leaks no profile',async(t)=>{
  Object.assign(process.env,{...TEST_SECRETS,SUPABASE_URL:'https://database.example.invalid',SUPABASE_SECRET_KEY:'test'});
  const student={id:'test-student',password_changed_at:'2026-09-19T00:00:00Z',email:'synthetic@example.invalid',first_name:'Test',
    last_name:'Student',student_number:'7654321',policies_accepted:true};
  let context={status:'ok',student,recovery:{enabled:false}},calls=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls++;
    assert.match(String(url),/rpc\/student_context$/,'Profile and recovery status come from one database call');
    const body=JSON.parse(options.body);assert.equal(body.p_session,0);assert.equal(body.p_rate,null);
    if(context==='outage')return Response.json({message:'Synthetic outage'},{status:503});
    return Response.json(context);
  });
  const request=new Request('https://portal.example.invalid/api/profile',{headers:{Cookie:sessionCookie(createSession(student))}});
  for(const value of [{status:'unauthorized'},'outage',{status:'ok',student,recovery:{}},{status:'ok',student,recovery:{enabled:'true'}},
    {status:'ok',student,recovery:{enabled:false}},{status:'ok',student:{...student,policies_accepted:false},recovery:{enabled:true}}]){
    context=value;
    const response=await profile(request),body=await response.json();
    assert.ok([401,403,500].includes(response.status));
    assert.equal(body.student,undefined);
    assert.match(response.headers.get('cache-control'),/no-store/);
  }
  context={status:'ok',student,recovery:{enabled:true,phoneVerified:false,remaining:10,secret:'v2.private'}};
  const allowed=await profile(request),body=await allowed.json();
  assert.equal(allowed.status,200);assert.equal(body.student.studentNumber,'7654321');
  assert.equal(JSON.stringify(body).includes('private'),false,'Encrypted factors never reach the browser');
  assert.equal(calls,7);
});
