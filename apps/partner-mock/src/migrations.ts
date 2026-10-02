import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Migration } from '@midnight-demo/db';

const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));

export function loadPartnerMigrations(): Migration[] {
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => ({
      name: file.replace(/\.sql$/, ''),
      sql: fs.readFileSync(path.join(migrationsDir, file), 'utf8'),
    }));
}
