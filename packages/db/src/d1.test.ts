import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createClient, type Client, type InArgs } from '@libsql/client';

import {
  applyMigrations,
  d1Database,
  loadConditionMigrations,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
  type SqlParameter,
} from './index.js';

interface FakeStatement extends D1PreparedStatementLike {
  sql: string;
  args: SqlParameter[];
}

function fakeD1(client: Client): D1DatabaseLike & { batches: number } {
  const run = (sql: string, args: SqlParameter[]) =>
    client.execute({ sql, args: args as unknown as InArgs });
  const statement = (sql: string, args: SqlParameter[]): FakeStatement => ({
    sql,
    args,
    bind: (...values) => statement(sql, values),
    first: async <T>() => ((await run(sql, args)).rows[0] as T | undefined) ?? null,
    all: async <T>() => ({ results: (await run(sql, args)).rows as unknown as T[] }),
    run: async () => ({ meta: { changes: Number((await run(sql, args)).rowsAffected) } }),
  });
  const fake = {
    batches: 0,
    prepare: (sql: string) => statement(sql, []),
    batch: async (statements: D1PreparedStatementLike[]) => {
      fake.batches += 1;
      return client.batch(
        (statements as FakeStatement[]).map((s) => ({ sql: s.sql, args: s.args as unknown as InArgs })),
        'write',
      );
    },
  };
  return fake;
}

function fileClient(): Client {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'd1-test-')), 'test.db');
  return createClient({ url: `file:${file}` });
}

test('D1SqlDatabase runs the condition migrations', async () => {
  const db = d1Database(fakeD1(fileClient()));
  assert.equal(db.kind, 'd1');
  assert.deepEqual(await applyMigrations(db, loadConditionMigrations()), ['0001_condition_schema']);
  assert.deepEqual(await applyMigrations(db, loadConditionMigrations()), []);
});

test('D1SqlDatabase first / all / execute / batch round-trip', async () => {
  const binding = fakeD1(fileClient());
  const db = d1Database(binding);
  await applyMigrations(db, loadConditionMigrations());

  assert.equal(
    await db.execute('INSERT INTO rings (id, label, created_at) VALUES (?, ?, ?)', [
      'r1',
      'RING-1',
      '2026-09-30T00:00:00.000Z',
    ]),
    1,
  );
  assert.equal((await db.first<{ label: string }>('SELECT label FROM rings WHERE id = ?', ['r1']))?.label, 'RING-1');
  assert.equal(await db.first('SELECT label FROM rings WHERE id = ?', ['missing']), null);
  assert.equal((await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM rings'))?.n, 1);

  await db.batch([
    { sql: 'INSERT INTO rings (id, label, created_at) VALUES (?, ?, ?)', parameters: ['r2', 'RING-2', '2026-09-30T00:00:00.000Z'] },
    { sql: 'INSERT INTO rings (id, label, created_at) VALUES (?, ?, ?)', parameters: ['r3', 'RING-3', '2026-09-30T00:00:00.000Z'] },
  ]);
  assert.equal(binding.batches, 1);
  assert.deepEqual(
    (await db.all<{ id: string }>('SELECT id FROM rings ORDER BY id')).map((row) => row.id),
    ['r1', 'r2', 'r3'],
  );
  assert.equal(await db.execute('DELETE FROM rings WHERE id IN (?, ?)', ['r2', 'r3']), 2);
});

test('D1SqlDatabase sends a batch as one atomic call', async () => {
  const db = d1Database(fakeD1(fileClient()));
  await applyMigrations(db, loadConditionMigrations());

  await assert.rejects(() =>
    db.batch([
      { sql: 'INSERT INTO rings (id, label, created_at) VALUES (?, ?, ?)', parameters: ['r1', 'A', '2026-09-30T00:00:00.000Z'] },
      { sql: 'INSERT INTO rings (id, label, created_at) VALUES (?, ?, ?)', parameters: ['r1', 'B', '2026-09-30T00:00:00.000Z'] },
    ]),
  );
  assert.deepEqual(await db.all('SELECT id FROM rings'), []);
});
