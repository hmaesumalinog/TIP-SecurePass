import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import api, { routes } from '../netlify/functions/api.mjs';
import { versionAssets } from '../scripts/version-assets.mjs';

test('one API function serves every endpoint the pages call, and nothing else',async()=>{
  const sources=[];
  for(const file of ['site.js','portal.js','security.js','recovery.js','email-recovery.js','admin.js','enrollment.js'])
    sources.push(await readFile(new URL('../public/assets/js/'+file,import.meta.url),'utf8'));
  const text=sources.join('\n');
  assert.doesNotMatch(text,/\.netlify\/functions/,'Pages use the /api routes only');
  for(const [, path] of text.matchAll(/["`](\/api\/[a-z/-]+)/g)) {
    const endpoint=path.replace(/\/$/,'');
    if(endpoint==='/api/admin') continue; // Prefix joined with an action name below.
    assert.ok(routes.has(endpoint),'Missing route for '+endpoint);
  }
  for(const action of ['issue-temporary-password','send-reset'])assert.ok(routes.has('/api/admin/'+action));
  for(const step of ['request-reset','start-reset','verify-otp','complete-reset'])assert.ok(routes.has('/api/'+step));
  const missing=await api(new Request('https://example.invalid/api/unknown'));
  assert.equal(missing.status,404);assert.match(missing.headers.get('cache-control'),/no-store/);
  const health=await api(new Request('https://example.invalid/api/health'));
  assert.equal(health.status,204);
});

test('netlify.toml has no API redirects that could shadow the function routes',async()=>{
  const config=await readFile(new URL('../netlify.toml',import.meta.url),'utf8');
  assert.doesNotMatch(config,/from = "\/api/);
  assert.match(config,/max-age=31536000, immutable/);
});

test('every asset reference carries its current content hash',async()=>{
  // Long browser caching is safe only if every changed file gets a new URL.
  const outdated=await versionAssets({write:false});
  assert.deepEqual(outdated,[],'Run "npm run version-assets" to update: '+outdated.join(', '));
});
