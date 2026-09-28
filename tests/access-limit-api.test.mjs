import test from 'node:test';
import assert from 'node:assert/strict';
import login from '../netlify/functions/login.mjs';
import adminLogin from '../netlify/functions/admin-login-start.mjs';
import requestReset from '../netlify/functions/request-reset.mjs';

for(const [kind,handler,body] of [['student',login,{studentNumber:'7654321',password:'Synthetic!Password123'}],
  ['admin',adminLogin,{email:'test@example.invalid',password:'Synthetic!Password123'}],
  ['reset',requestReset,{email:'test@example.invalid'}]]) {
  test(kind+' limits stop the request before authentication or delivery',async t=>{
    const saved={SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SECRET_KEY:process.env.SUPABASE_SECRET_KEY};
    Object.assign(process.env,{SUPABASE_URL:'https://database.example.invalid',SUPABASE_SECRET_KEY:'sb_secret_test'});
    t.after(()=>{for(const [key,value]of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
    let calls=0;
    t.mock.method(globalThis,'fetch',async(url,options)=>{
      calls++;assert.match(url,/rpc\/reserve_access_attempt$/);
      const input=JSON.parse(options.body);assert.equal(input.p_kind,kind);
      assert.match(input.p_identifier,/^[a-f0-9]{64}$/);assert.match(input.p_ip,/^[a-f0-9]{64}$/);
      assert.ok(options.signal);return Response.json(null);
    });
    const response=await handler(new Request('https://example.invalid/function',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),{ip:'192.0.2.1'});
    assert.equal(response.status,429);assert.equal(calls,1);assert.match(response.headers.get('cache-control'),/no-store/);
  });
}
