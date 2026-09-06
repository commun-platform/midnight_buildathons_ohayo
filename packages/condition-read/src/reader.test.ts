import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyMigrations,
  createDatabase,
  loadConditionMigrations,
  type SqlDatabase,
} from '@midnight-demo/db';

import { dbConditionReader } from './index.js';

async function migratedDb(): Promise<SqlDatabase> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'read-reader-')), 'test.db');
  const db = createDatabase({ url: `file:${file}` });
  await applyMigrations(db, loadConditionMigrations());
  return db;
}

const INSERT = `INSERT INTO submissions (
  entry_key, ring_id, period_start_ms, timezone, recorded_at_ms,
  band, score_commitment_hex, tx_id, submitted_at, chain_verified_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

test('dbConditionReader returns the submissions-table entry with verified + txId', async () => {
  const db = await migratedDb();
  await db.batch([
    { sql: INSERT, parameters: ['111', 'ring-a', 1_000, 'Asia/Tokyo', 1_500, 'normal', 'aa'.repeat(32), 'tx-abc', 'now', '2026-08-30T00:00:00Z'] },
    { sql: INSERT, parameters: ['222', 'ring-b', 2_000, 'Asia/Tokyo', 2_500, 'danger', 'bb'.repeat(32), null, 'now', null] },
  ]);
  const reader = dbConditionReader(db);

  const confirmed = await reader.read(111n);
  assert.deepEqual(confirmed, {
    band: 'normal',
    periodStartMs: 1_000,
    recordedAtMs: 1_500,
    scoreCommitmentHex: 'aa'.repeat(32),
    verified: true,
    txId: 'tx-abc',
  });

  const unconfirmed = await reader.read(222n);
  assert.equal(unconfirmed?.band, 'danger');
  assert.equal(unconfirmed?.verified, false);
  assert.equal(unconfirmed?.txId, null);

  assert.equal(await reader.read(999n), null);
});
