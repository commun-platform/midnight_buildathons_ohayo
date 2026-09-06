import { createClient } from '@libsql/client';

import { createDatabaseWith, type DatabaseConfig } from './factory.js';
import type { SqlDatabase } from './sql.js';

export * from './sql.js';
export * from './factory.js';
export { LibSqlDatabase } from './libsql.js';
export * from './migrate.js';
export { loadConditionMigrations, loadSampleFeed, loadSampleRoster } from './migrations.js';

export function createDatabase(config: DatabaseConfig): SqlDatabase {
  return createDatabaseWith(config, ({ url, authToken }) => createClient({ url, authToken }));
}
