import assert from 'node:assert/strict';
import test from 'node:test';
import databaseHealth, { config } from '../netlify/functions/database-health.mjs';

test('database health check is scheduled four times daily', () => {
  assert.equal(config.schedule, '17 */6 * * *');
});

test('health check performs one bounded HEAD request without retrieving records', async (t) => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SECRET_KEY;
  process.env.SUPABASE_URL = 'https://health-test.supabase.co';
  process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
  t.after(() => {
    if (oldUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = oldKey;
  });
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://health-test.supabase.co/rest/v1/demo_students?select=id&limit=1');
    assert.equal(options.method, 'HEAD');
    assert.equal(options.headers.get('Prefer'), null);
    assert.equal(options.headers.get('apikey'), 'sb_secret_test');
    assert.equal(options.body, undefined);
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(null, { status: 200 });
  });
  assert.equal((await databaseHealth()).status, 204);
  assert.equal(fetchMock.mock.callCount(), 1);
  fetchMock.mock.mockImplementation(async () => new Response('private provider detail', { status: 503 }));
  const errors = t.mock.method(console, 'error', () => {});
  await assert.rejects(databaseHealth(), /^Error: Database health check failed$/);
  assert.equal(fetchMock.mock.callCount(), 2);
  assert.doesNotMatch(JSON.stringify(errors.mock.calls), /private provider detail/);
  fetchMock.mock.mockImplementation(async () => { throw new DOMException('timed out', 'TimeoutError'); });
  await assert.rejects(databaseHealth(), /^Error: Database health check failed$/);
  assert.equal(fetchMock.mock.callCount(), 3);
});
