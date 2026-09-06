import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Migration } from './migrate.js';

const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));
const seedDir = fileURLToPath(new URL('../seed/', import.meta.url));

export function loadConditionMigrations(): Migration[] {
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .map((file) => ({
      name: file.replace(/\.sql$/, ''),
      sql: fs.readFileSync(path.join(migrationsDir, file), 'utf8'),
    }));
}

export function loadSampleRoster(): string {
  return fs.readFileSync(path.join(seedDir, 'sample-roster.sql'), 'utf8');
}

export function loadSampleFeed(): string {
  return fs.readFileSync(path.join(seedDir, 'sample-feed.sql'), 'utf8');
}
