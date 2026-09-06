import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyMigrations,
  createDatabase,
  loadConditionMigrations,
  loadSampleRoster,
  runSqlScript,
  type SqlDatabase,
} from '@midnight-demo/db';

import { resolveRingScope } from './index.js';

async function seededDb(): Promise<SqlDatabase> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'read-scope-')), 'test.db');
  const db = createDatabase({ url: `file:${file}` });
  await applyMigrations(db, loadConditionMigrations());
  await runSqlScript(db, loadSampleRoster());
  return db;
}

const sorted = (p: Promise<string[]>) => p.then((r) => r.sort());

test('admin sees every ring', async () => {
  const db = await seededDb();
  assert.deepEqual(await sorted(resolveRingScope(db, { role: 'admin' })), ['ring-1', 'ring-2', 'ring-3']);
});

test('worker sees only rings currently assigned to them', async () => {
  const db = await seededDb();
  assert.deepEqual(await resolveRingScope(db, { role: 'worker', workerId: 'worker-1' }), ['ring-1']);
  assert.deepEqual(await resolveRingScope(db, { role: 'worker', workerId: 'worker-2' }), ['ring-2']);
  assert.deepEqual(await resolveRingScope(db, { role: 'worker', workerId: 'nobody' }), []);
  assert.deepEqual(await resolveRingScope(db, { role: 'worker' }), []);
});
