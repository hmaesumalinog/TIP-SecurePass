import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
test('email recovery pages bind all controller elements, with no persistent recovery proofs',async()=>{
 const source=await readFile(new URL('../public/assets/js/email-recovery.js',import.meta.url),'utf8');
 const ids=new Set();
 for(const page of ['forgot','reset']) {
  const html=await readFile(new URL('../public/'+page+'.html',import.meta.url),'utf8');
  const pageIds=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(pageIds.length,new Set(pageIds).size);pageIds.forEach(id=>ids.add(id));
  assert.match(html,/type="module"/);assert.match(html,/name="referrer" content="no-referrer"/);
  assert.doesNotMatch(html,/src="assets\/js\/site\.js/);
 }
 for(const [,id]of source.matchAll(/\$\("#([a-z][a-z0-9-]*)/g))assert.ok(ids.has(id),id);
 assert.doesNotMatch(source,/sessionStorage|localStorage|console\.log|preview\s*===/);
 assert.match(source,/normalizeOtp\(code.value\)/);
 assert.match(source,/if \(busy/);
 assert.match(source,/AbortController/);
 assert.match(source,/pagehide/);
 assert.match(source,/replaceChildren\(\.\.\.original\)/);
 assert.match(source,/emailDeadline = Date.now\(\) \+ 15 \* 60000/);
 assert.match(source,/token = ""/);
});
