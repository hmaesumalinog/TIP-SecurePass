// Builds a throwaway PostgreSQL database (PGlite, in memory) with the exact
// installation order documented in supabase/README.md. No network access.
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { citext } from '@electric-sql/pglite/contrib/citext';

export const SCHEMA_FILES = [
  'setup/01-core-schema.sql',
  'setup/02-administrator-schema.sql',
  'migrations/20260905071805_resumable_otp_delivery.sql',
  'migrations/20260917090000_alternate_recovery.sql',
  'migrations/20260920090000_student_owned_onboarding.sql',
  'migrations/20260928090000_performance_and_delivery.sql',
  'migrations/20261009090000_sessions_and_round_trips.sql'
];

// Synthetic, test-only values. Each is at least 32 characters.
export const TEST_SECRETS = {
  APP_PEPPER: 'test-only-code-pepper-0123456789abcdef',
  SESSION_SECRET: 'test-only-session-secret-0123456789abcd',
  RECOVERY_ENCRYPTION_KEY: 'test-only-encryption-key-0123456789abc'
};

export async function createDatabase(files = SCHEMA_FILES) {
  const db = new PGlite({ extensions: { pgcrypto, citext } });
  await db.exec('create role anon; create role authenticated; create role service_role; create schema extensions; create publication supabase_realtime;');
  for (const file of files) await db.exec(await readFile(new URL(`../../supabase/${file}`, import.meta.url), 'utf8'));
  return db;
}
