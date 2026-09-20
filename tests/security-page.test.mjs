import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const html=await readFile(new URL('../public/security.html',import.meta.url),'utf8');
const script=await readFile(new URL('../public/assets/js/security.js',import.meta.url),'utf8');
test('security page binds its dedicated controller to unique existing elements',()=>{
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(ids.length,new Set(ids).size,'HTML IDs must be unique');
  for(const [,id] of script.matchAll(/\$\("#([a-z][a-z0-9-]*)/g))assert.ok(ids.includes(id),`Missing controller target: ${id}`);
  for(const [,src] of html.matchAll(/(?:src|href)="(assets\/[^"]+)"/g))assert.ok(!src.includes('recovery.js'),'Shared public reset controller must not control student settings');
  assert.match(html,/security\.js\?v=20260920/);
});
test('separate recovery forms identify the code source and protect saved-code handoff',()=>{
  for(const id of ['identity-form','connect-form','manage-form','phone-form','saved-form'])assert.match(html,new RegExp(`<form id="${id}"`));
  assert.match(html,/Six-digit code from the app you just added/);
  assert.match(html,/Six-digit SMS code/);
  assert.match(html,/id="saved-check"\s+required/);
  assert.doesNotMatch(script,/localStorage|sessionStorage|console\.log/,'Proofs and codes must not be persisted or logged');
  assert.match(script,/window\.addEventListener\("beforeunload"/);
});
