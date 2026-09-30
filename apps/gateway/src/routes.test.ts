import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { fakeReader, type OnChainEntry } from '@midnight-demo/condition-read';
import {
  applyMigrations,
  createDatabase,
  loadConditionMigrations,
  loadSampleRoster,
  runSqlScript,
  type SqlDatabase,
} from '@midnight-demo/db';
import { conditionEntryKey } from '@midnight-demo/shared';

import { handleApi, handleRead } from './routes.js';

const SALT = new Uint8Array(16).fill(0x5a);
const AUG16_JST = Date.parse('2026-08-16T00:00:00+09:00');

async function seeded(): Promise<{ db: SqlDatabase; reader: ReturnType<typeof fakeReader> }> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gw-routes-')), 'test.db');
  const db = createDatabase({ url: `file:${file}` });
  await applyMigrations(db, loadConditionMigrations());
  await runSqlScript(db, loadSampleRoster());

  const entry: OnChainEntry = {
    band: 'caution',
    periodStartMs: AUG16_JST,
    recordedAtMs: Date.parse('2026-08-15T22:10:00.000Z'),
    scoreCommitmentHex: 'ab'.repeat(32),
    verified: true,
  };
  const key1 = await conditionEntryKey('ring-1', AUG16_JST, SALT);
  const key2 = await conditionEntryKey('ring-2', AUG16_JST, SALT);
  const key3 = await conditionEntryKey('ring-3', AUG16_JST, SALT);
  const reader = fakeReader(
    new Map([
      [key1.toString(), entry],
      [key2.toString(), { ...entry, band: 'danger' }],
      [key3.toString(), { ...entry, band: 'normal' }],
    ]),
  );
  return { db, reader };
}

function get(path: string, token?: string): Request {
  return new Request(`http://gw${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function post(path: string, body: unknown, token?: string): Request {
  return new Request(`http://gw${path}`, {
    method: 'POST',
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const INSERT_SUB = `INSERT INTO submissions (
  entry_key, ring_id, period_start_ms, timezone, recorded_at_ms,
  band, score_commitment_hex, submitted_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

async function withSubmissions(db: SqlDatabase): Promise<void> {
  await db.batch([
    { sql: INSERT_SUB, parameters: ['k-1', 'ring-1', 1, 'Asia/Tokyo', 2, 'normal', 'aa'.repeat(32), 'now'] },
    { sql: INSERT_SUB, parameters: ['k-2', 'ring-2', 1, 'Asia/Tokyo', 2, 'danger', 'bb'.repeat(32), 'now'] },
  ]);
}

const range = '?from=2026-08-15T00:00:00%2B09:00&to=2026-08-18T00:00:00%2B09:00';

async function bodyOf(response: Response | null): Promise<any> {
  assert.ok(response);
  return response.json();
}

test('non-matching path falls through (null)', async () => {
  const { db, reader } = await seeded();
  assert.equal(await handleRead(get('/health'), { db, reader, salt: SALT }), null);
});

test('missing / unknown token is 401', async () => {
  const { db, reader } = await seeded();
  assert.equal((await handleRead(get('/api/conditions/all'), { db, reader, salt: SALT }))?.status, 401);
  assert.equal((await handleRead(get('/api/conditions/all', 'nope'), { db, reader, salt: SALT }))?.status, 401);
});

test('admin gets every ring on /all', async () => {
  const { db, reader } = await seeded();
  const res = await handleRead(get(`/api/conditions/all${range}`, 'admin'), { db, reader, salt: SALT });
  const body = await bodyOf(res);
  assert.equal(res?.status, 200);
  assert.deepEqual(body.rings.map((r: any) => r.ringId).sort(), ['ring-1', 'ring-2', 'ring-3']);
  const one = body.rings.find((r: any) => r.ringId === 'ring-1');
  assert.equal(one.workerName, '作業員 一郎');
  assert.equal(one.entries[0].band, 'caution');
});

test('a worker token is their worker id and scopes to themselves', async () => {
  const { db, reader } = await seeded();
  const deps = { db, reader, salt: SALT };

  const mine = await handleRead(get(`/api/conditions/worker/worker-1${range}`, 'worker-1'), deps);
  assert.equal(mine?.status, 200);
  assert.deepEqual((await bodyOf(mine)).rings.map((r: any) => r.ringId), ['ring-1']);

  assert.equal((await handleRead(get('/api/conditions/worker/worker-2', 'worker-1'), deps))?.status, 403);
  assert.equal((await handleRead(get('/api/conditions/all', 'worker-1'), deps))?.status, 403);
});

test('/api/conditions/mine returns the caller\'s whole resolved scope', async () => {
  const { db, reader } = await seeded();
  const deps = { db, reader, salt: SALT };
  const ids = async (token: string) =>
    (await bodyOf(await handleRead(get(`/api/conditions/mine${range}`, token), deps))).rings
      .map((r: any) => r.ringId)
      .sort();
  assert.deepEqual(await ids('admin'), ['ring-1', 'ring-2', 'ring-3']);
  assert.deepEqual(await ids('worker-1'), ['ring-1']);
});

test('a worker sees their own raw value; admin does not', async () => {
  const { db } = await seeded();
  const recordedAtMs = Date.parse('2026-08-15T22:12:41.000Z');
  await db.execute(
    `INSERT INTO condition_readings (ring_id, recorded_at, value, source, status, created_at)
     VALUES (?, ?, ?, 'partner_api', 'pending', ?)`,
    ['ring-1', new Date(recordedAtMs).toISOString(), 78, new Date().toISOString()],
  );
  const key1 = await conditionEntryKey('ring-1', AUG16_JST, SALT);
  const reader = fakeReader(
    new Map([
      [
        key1.toString(),
        {
          band: 'normal',
          periodStartMs: AUG16_JST,
          recordedAtMs,
          scoreCommitmentHex: 'cd'.repeat(32),
          verified: true,
        } satisfies OnChainEntry,
      ],
    ]),
  );
  const deps = { db, reader, salt: SALT };

  const mine = await bodyOf(
    await handleRead(get(`/api/conditions/worker/worker-1${range}`, 'worker-1'), deps),
  );
  assert.equal(mine.rings[0].entries[0].value, 78);

  const other = await bodyOf(
    await handleRead(get(`/api/conditions/worker/worker-1${range}`, 'admin'), deps),
  );
  assert.equal(other.rings[0].entries[0].value, undefined);
});

test('invalid range is 400', async () => {
  const { db, reader } = await seeded();
  const res = await handleRead(get('/api/conditions/all?from=2026-09-01&to=2026-08-01', 'admin'), {
    db,
    reader,
    salt: SALT,
  });
  assert.equal(res?.status, 400);
});

test('handleApi: /api/config is unauthenticated display strings', async () => {
  const { db, reader } = await seeded();
  const res = await handleApi(get('/api/config'), {
    db,
    reader,
    salt: SALT,
    config: { network: 'Midnight Local', explorerUrl: 'https://explorer.example' },
  });
  assert.equal(res?.status, 200);
  assert.deepEqual(await bodyOf(res), {
    network: 'Midnight Local',
    explorerUrl: 'https://explorer.example',
    submitEnabled: false,
    partnerPullEnabled: false,
    partnerUrl: null,
  });
});

test('handleApi: /api/me resolves the role from the token', async () => {
  const { db, reader } = await seeded();
  const deps = { db, reader, salt: SALT };

  assert.equal((await handleApi(get('/api/me'), deps))?.status, 401);

  const adm = await bodyOf(await handleApi(get('/api/me', 'admin'), deps));
  assert.equal(adm.role, 'admin');
  assert.equal(adm.admin, true);
  assert.equal(adm.workerId, null);
  assert.equal(adm.ringId, null);

  const wkr = await bodyOf(await handleApi(get('/api/me', 'worker-1'), deps));
  assert.equal(wkr.role, 'worker');
  assert.equal(wkr.workerId, 'worker-1');
  assert.equal(wkr.workerName, '作業員 一郎');
  assert.equal(wkr.admin, false);
  assert.equal(wkr.ringId, 'ring-1');

  await db.execute("UPDATE ring_worker_map SET to_ts = '2026-09-01T00:00:00Z' WHERE worker_id = 'worker-1'");
  assert.equal((await bodyOf(await handleApi(get('/api/me', 'worker-1'), deps))).ringId, null);
});

test('handleApi: unknown /api route is 404, non-/api is null', async () => {
  const { db, reader } = await seeded();
  const deps = { db, reader, salt: SALT };
  assert.equal((await handleApi(get('/api/nope'), deps))?.status, 404);
  assert.equal(await handleApi(get('/index.html'), deps), null);
});

test('handleApi: POST /api/reconcile — auth, scope, 501/200', async () => {
  const { db, reader } = await seeded();
  await withSubmissions(db);
  let seen: readonly string[] = [];
  const deps = {
    db,
    reader,
    salt: SALT,
    reconcile: async (keys: readonly string[]) => {
      seen = keys;
      return { confirmed: keys.length, localChecked: 0, mismatches: 0, valueMismatches: 0, missing: 0 };
    },
  };

  assert.equal((await handleApi(post('/api/reconcile', { entryKeys: ['k-1'] }), deps))?.status, 401);
  assert.equal((await handleApi(post('/api/reconcile', {}, 'admin'), deps))?.status, 400);

  const wkr = await handleApi(post('/api/reconcile', { entryKeys: ['k-1', 'k-2'] }, 'worker-1'), deps);
  assert.equal(wkr?.status, 200);
  assert.deepEqual([...seen], ['k-1']);

  assert.equal((await handleApi(post('/api/reconcile', { entryKeys: ['k-2'] }, 'worker-1'), deps))?.status, 403);

  const noCap = await handleApi(post('/api/reconcile', { entryKeys: ['k-1'] }, 'admin'), {
    db,
    reader,
    salt: SALT,
  });
  assert.equal(noCap?.status, 501);
});
