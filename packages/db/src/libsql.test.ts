import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyMigrations,
  createDatabase,
  loadConditionMigrations,
  loadSampleFeed,
  loadSampleRoster,
  runSqlScript,
  type SqlDatabase,
} from './index.js';

function fileDb(): SqlDatabase {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'db-test-')), 'test.db');
  return createDatabase({ url: `file:${file}` });
}

test('applyMigrations runs the schema once and is idempotent', async () => {
  const db = fileDb();
  const first = await applyMigrations(db, loadConditionMigrations());
  assert.deepEqual(first, ['0001_condition_schema', '0002_guest_decisions_resettable']);

  const second = await applyMigrations(db, loadConditionMigrations());
  assert.deepEqual(second, []);

  const tables = await db.all<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
  );
  const names = tables.map((row) => row.name);
  for (const expected of [
    'rings',
    'ring_worker_map',
    'workers',
    'worker_pii',
    'condition_readings',
    'submissions',
    'salt_epochs',
    'contract_deployments',
    'audit_log',
  ]) {
    assert.ok(names.includes(expected), `missing table ${expected}`);
  }
});

test('the sample roster fixture populates rings and workers', async () => {
  const db = fileDb();
  await applyMigrations(db, loadConditionMigrations());
  await runSqlScript(db, loadSampleRoster());

  assert.equal((await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM rings'))?.n, 3);
  assert.equal((await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM workers'))?.n, 3);
});

test('LibSqlDatabase first / all / execute / batch round-trip', async () => {
  const db = fileDb();
  await applyMigrations(db, loadConditionMigrations());

  const changed = await db.execute(
    'INSERT INTO rings (id, label, created_at) VALUES (?, ?, ?)',
    ['r1', 'RING-1', '2026-08-29T00:00:00.000Z'],
  );
  assert.equal(changed, 1);

  const one = await db.first<{ label: string }>('SELECT label FROM rings WHERE id = ?', ['r1']);
  assert.equal(one?.label, 'RING-1');

  await db.batch([
    {
      sql: 'INSERT INTO rings (id, label, created_at) VALUES (?, ?, ?)',
      parameters: ['r2', 'RING-2', '2026-08-29T00:00:00.000Z'],
    },
    {
      sql: 'INSERT INTO rings (id, label, created_at) VALUES (?, ?, ?)',
      parameters: ['r3', 'RING-3', '2026-08-29T00:00:00.000Z'],
    },
  ]);

  const all = await db.all<{ id: string }>('SELECT id FROM rings ORDER BY id');
  assert.deepEqual(all.map((row) => row.id), ['r1', 'r2', 'r3']);
  assert.equal(db.kind, 'libsql');
});

test('condition_readings rejects a value outside the partner 0..100 scale', async () => {
  const db = fileDb();
  await applyMigrations(db, loadConditionMigrations());
  await runSqlScript(db, loadSampleRoster());

  const insert = (value: number) =>
    db.execute(
      `INSERT INTO condition_readings (ring_id, recorded_at, value, source, created_at)
       VALUES ('ring-1', ?, ?, 'partner_api', '2026-08-20T00:00:00Z')`,
      [`2026-08-20T0${value % 10}:00:00Z`, value],
    );

  await assert.rejects(() => insert(101), /CHECK|constraint/i);
  await assert.rejects(() => insert(-1), /CHECK|constraint/i);
  await insert(0);
  await insert(100);
});
