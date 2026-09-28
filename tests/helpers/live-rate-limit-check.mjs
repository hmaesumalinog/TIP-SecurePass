// Explicit opt-in only. Uses synthetic hashes, never authenticates a student,
// sends no messages, and deletes only the exact records created by this check.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

const project = 'ysrqbnplayazrbhjepyb';
assert.equal(process.argv[2], `--project=${project}`, 'Pass the exact project ID to opt into the live check.');
const env = JSON.parse(execFileSync('./node_modules/.bin/netlify', ['env:list', '--json'], { encoding: 'utf8' }));
assert.equal(new URL(env.SUPABASE_URL).hostname, `${project}.supabase.co`);
const secret = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
assert.ok(secret, 'Server database credentials are required.');
const headers = { apikey: secret, 'Content-Type': 'application/json' };
if (!secret.startsWith('sb_secret_')) headers.Authorization = `Bearer ${secret}`;
const hash = value => createHash('sha256').update(value).digest('hex');
const identifier = hash(`release-check-identifier:${randomUUID()}`);
const ip = hash(`release-check-ip:${randomUUID()}`);
async function request(path, options = {}) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options, headers, signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  if (!response.ok) {
    let code = 'unclassified';
    try { code = JSON.parse(text).code || code; } catch {}
    throw new Error(`Database check returned HTTP ${response.status}, code ${code}`);
  }
  return text ? JSON.parse(text) : null;
}
try {
  const results = await Promise.allSettled(Array.from({ length: 16 }, () => request('rpc/reserve_access_attempt', {
    method: 'POST', body: JSON.stringify({ p_kind: 'student', p_identifier: identifier, p_ip: ip })
  })));
  const failures = results.filter(result => result.status === 'rejected').map(result => ({
    name: result.reason.name, message: result.reason.message
  }));
  assert.deepEqual(failures, [], 'All concurrent requests must complete.');
  const allowed = results.filter(result => result.value !== null).length;
  assert.equal(allowed, 5, 'Exactly five simultaneous attempts must reserve a slot.');
  console.log(JSON.stringify({ liveConcurrentRequests: 16, allowed, blocked: 16 - allowed, messagesSent: 0 }));
} finally {
  await request(`student_login_attempts?student_number_hash=eq.${identifier}&ip_hash=eq.${ip}`, { method: 'DELETE' });
  for (const key of [`access:student:id:${identifier}`, `access:student:ip:${ip}`]) {
    await request(`recovery_limits?key=eq.${encodeURIComponent(key)}`, { method: 'DELETE' });
  }
  const remaining = await request(`student_login_attempts?student_number_hash=eq.${identifier}&ip_hash=eq.${ip}&select=id`);
  assert.equal(remaining.length, 0);
  console.log('Synthetic rate-limit records removed. No student accounts or audit history changed.');
}
