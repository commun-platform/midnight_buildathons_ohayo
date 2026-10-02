import {
  applyMigrations,
  createDatabase,
  libsqlConfigFromEnv,
  loadConditionMigrations,
  type SqlDatabase,
} from '@midnight-demo/db';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

export async function openIngesterDb(
  env: Record<string, string | undefined> = process.env,
): Promise<SqlDatabase> {
  const effectiveEnv = env.LIBSQL_URL?.trim()
    ? env
    : { ...env, LIBSQL_URL: `file:${path.join(repoRoot, 'data', 'ingester-local.db')}` };

  const db = createDatabase(libsqlConfigFromEnv(effectiveEnv));
  await applyMigrations(db, loadConditionMigrations());
  return db;
}
