import { supabase } from './_shared/supabase.mjs';

// Runs only on the published production deploy. No user records or audit history
// are removed: the RPC cleans bounded batches of expired operational artifacts.
export const config = { schedule: '43 */6 * * *' };

export default async function securityMaintenance() {
  await supabase('rpc/cleanup_expired_security_state', { method: 'POST', body: '{}' });
  console.info('Expired security-state maintenance completed.');
  return new Response(null, { status: 204 });
}
