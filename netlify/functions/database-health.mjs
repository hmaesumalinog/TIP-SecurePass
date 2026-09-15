import { supabase } from './_shared/supabase.mjs';

// Netlify runs scheduled functions only on the published production deploy.
export const config = { schedule: '17 */6 * * *' };

export default async function databaseHealth() {
  try {
    // HEAD executes a bounded database read without returning student records.
    // Do not request a count: that would add unnecessary database work.
    await supabase('demo_students?select=id&limit=1', {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    // Never log provider responses, credentials, or student information.
    console.error('Database health check failed. Check Supabase availability and server configuration.');
    throw new Error('Database health check failed');
  }
  console.info('Database health check succeeded (read-only, no response body).');
  return new Response(null, { status: 204 });
}
