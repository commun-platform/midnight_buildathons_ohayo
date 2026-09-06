import type { Client } from '@libsql/client';

import { LibSqlDatabase } from './libsql.js';
import type { SqlDatabase } from './sql.js';

export interface DatabaseConfig {
  url: string;
  authToken?: string;
}

export function createDatabaseWith(
  config: DatabaseConfig,
  makeClient: (options: { url: string; authToken?: string }) => Client,
): SqlDatabase {
  return new LibSqlDatabase(makeClient({ url: config.url, authToken: config.authToken }));
}

export function libsqlConfigFromEnv(env: Record<string, string | undefined>): DatabaseConfig {
  const url = env.LIBSQL_URL?.trim();
  if (!url) {
    throw new Error(
      'LIBSQL_URL is required (e.g. http://127.0.0.1:8080 for the docker server, or file:data/local.db)',
    );
  }
  return { url, authToken: env.LIBSQL_AUTH_TOKEN?.trim() || undefined };
}
