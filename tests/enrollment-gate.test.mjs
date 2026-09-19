import assert from 'node:assert/strict';
import test from 'node:test';
import profile from '../netlify/functions/profile.mjs';
import { createSession, sessionCookie } from '../netlify/functions/_shared/session.mjs';

test('portal enrollment gate fails closed on status errors and leaks no profile',async(t)=>{
  Object.assign(process.env,{APP_PEPPER:'test-only-enrollment-pepper-1234567890',SUPABASE_URL:'https://database.example.invalid',SUPABASE_SECRET_KEY:'test'});
  const student={id:'test-student',password_changed_at:'2026-09-19T00:00:00Z',email:'synthetic@example.invalid'};
  let status={status:'ok',enabled:false};
  t.mock.method(globalThis,'fetch',async(url)=>{
    if(String(url).includes('rpc/recovery_settings')) return Response.json(status);
    return Response.json([student]);
  });
  const request=new Request('https://portal.example.invalid/api/profile',{headers:{Cookie:sessionCookie(createSession(student))}});
  for(const value of [{status:'unavailable'},{status:'ok'},{status:'ok',enabled:'true'},{status:'ok',enabled:false}]){
    status=value;
    const response=await profile(request),body=await response.json();
    assert.ok([403,503].includes(response.status));
    assert.equal(body.student,undefined);
    assert.match(response.headers.get('cache-control'),/no-store/);
  }
  status={status:'ok',enabled:true};
  assert.equal((await profile(request)).status,200);
});
