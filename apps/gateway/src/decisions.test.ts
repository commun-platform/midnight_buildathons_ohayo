import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { fakeReader } from '@midnight-demo/condition-read';
import {
  applyMigrations,
  createDatabase,
  loadConditionMigrations,
  loadSampleRoster,
  runSqlScript,
  type SqlDatabase,
} from '@midnight-demo/db';

import { dayStartFromDate, reasonRequired } from './decisions.js';
import { handleApi, TEST_ADMIN_KEY_HASH } from './test-support.js';

const SALT = new Uint8Array(16).fill(0x5a);
const DAY = '2026-08-16';
const DAY_MS = Date.parse('2026-08-16T00:00:00+09:00');

async function seeded(): Promise<SqlDatabase> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gw-decisions-')), 'test.db');
  const db = createDatabase({ url: `file:${file}` });
  await applyMigrations(db, loadConditionMigrations());
  await runSqlScript(db, loadSampleRoster());
  const insert = `INSERT INTO submissions (entry_key, ring_id, period_start_ms, timezone, recorded_at_ms,
                    band, score_commitment_hex, submitted_at) VALUES (?, ?, ?, 'Asia/Tokyo', ?, ?, ?, ?)`;
  await db.batch([
    { sql: insert, parameters: ['k-1', 'ring-1', DAY_MS, DAY_MS + 3_600_000, 'danger', 'aa'.repeat(32), 'now'] },
    { sql: insert, parameters: ['k-2', 'ring-2', DAY_MS, DAY_MS + 3_600_000, 'normal', 'bb'.repeat(32), 'now'] },
  ]);
  return db;
}

function call(db: SqlDatabase, method: string, pathname: string, token?: string, body?: unknown) {
  return handleApi(
    new Request(`http://gw${pathname}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    { db, reader: fakeReader(new Map()), salt: SALT },
  );
}

async function json(response: Response | null): Promise<any> {
  assert.ok(response);
  return response.json();
}

const decide = (db: SqlDatabase, body: Record<string, unknown>, token = 'admin') =>
  call(db, 'POST', '/api/decisions', token, { date: DAY, ...body });

test('the reason rule: caution / danger days need a reason to let someone work', () => {
  for (const band of ['caution', 'danger']) {
    assert.equal(reasonRequired(band, 'worked'), true);
    assert.equal(reasonRequired(band, 'light_duty'), true);
    assert.equal(reasonRequired(band, 'rested'), false);
  }
  assert.equal(reasonRequired('normal', 'worked'), false);
  assert.equal(reasonRequired(null, 'worked'), false);
});

test('dates resolve to the local day start and reject impossible days', () => {
  assert.equal(dayStartFromDate(DAY), DAY_MS);
  assert.equal(dayStartFromDate('2026-02-30'), null);
  assert.equal(dayStartFromDate('16/08/2026'), null);
});

test('a danger day rejects "worked" without a reason and records the band from the server', async () => {
  const db = await seeded();

  const missing = await decide(db, { workerId: 'worker-1', decision: 'worked', reason: '   ' });
  assert.equal(missing?.status, 400);
  assert.equal((await json(missing)).code, 'reason_required');
  assert.equal((await decide(db, { workerId: 'worker-1', decision: 'light_duty' }))?.status, 400);

  const created = await decide(db, {
    workerId: 'worker-1',
    decision: 'worked',
    reason: '本人と面談、午前のみ監視付きで就業',
    band: 'normal',
  });
  assert.equal(created?.status, 201);
  const d = (await json(created)).decision;
  assert.equal(d.band, 'danger');
  assert.equal(d.entryKey, 'k-1');
  assert.equal(d.date, DAY);
  assert.equal(d.decidedBy, TEST_ADMIN_KEY_HASH);
  assert.equal(d.current, true);
});

test('resting needs no reason, nor does a normal day or a day with no reading', async () => {
  const db = await seeded();
  assert.equal((await decide(db, { workerId: 'worker-1', decision: 'rested' }))?.status, 201);
  assert.equal((await decide(db, { workerId: 'worker-2', decision: 'worked' }))?.status, 201);
  const empty = await decide(db, { workerId: 'worker-3', decision: 'worked' });
  assert.equal(empty?.status, 201);
  assert.equal((await json(empty)).decision.band, null);
});

test('decisions are append-only: a correction supersedes the current row, nothing is overwritten', async () => {
  const db = await seeded();
  const first = (await json(await decide(db, { workerId: 'worker-1', decision: 'rested' }))).decision;

  const unlinked = await decide(db, { workerId: 'worker-1', decision: 'worked', reason: '人手不足' });
  assert.equal(unlinked?.status, 409);
  assert.equal((await json(unlinked)).currentId, first.id);
  assert.equal(
    (await decide(db, { workerId: 'worker-1', decision: 'worked', reason: 'x', supersedesId: 'wd-nope' }))?.status,
    409,
  );

  const second = (
    await json(await decide(db, { workerId: 'worker-1', decision: 'light_duty', reason: '軽作業に変更', supersedesId: first.id }))
  ).decision;
  assert.equal(second.supersedesId, first.id);
  assert.equal(
    (await decide(db, { workerId: 'worker-1', decision: 'worked', reason: 'x', supersedesId: first.id }))?.status,
    409,
  );

  const current = (await json(await call(db, 'GET', `/api/decisions?from=${DAY}&to=${DAY}&workerId=worker-1`, 'admin'))).decisions;
  assert.deepEqual(current.map((d: { id: string }) => d.id), [second.id]);
  const all = (await json(await call(db, 'GET', `/api/decisions?from=${DAY}&to=${DAY}&history=1`, 'admin'))).decisions;
  assert.deepEqual(
    all.map((d: { id: string; current: boolean }) => [d.id, d.current]),
    [[first.id, false], [second.id, true]],
  );

  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    assert.equal((await call(db, method, '/api/decisions', 'admin', {}))?.status, 405);
  }
  await assert.rejects(() => db.execute("UPDATE work_decisions SET reason = 'edited'"), /append-only/);
  await assert.rejects(() => db.execute('DELETE FROM work_decisions'), /append-only/);

  const audit = await db.all<{ target_id: string; before_json: string | null }>(
    "SELECT target_id, before_json FROM audit_log WHERE action = 'work_decision.create' ORDER BY ts",
  );
  assert.deepEqual(audit.map((a) => a.target_id), [first.id, second.id]);
  assert.equal(audit[0]?.before_json, null);
  assert.equal(JSON.parse(audit[1]?.before_json ?? '{}').id, first.id);
});

test('the recorded band is a snapshot: later changes to the entry do not rewrite it', async () => {
  const db = await seeded();
  await decide(db, { workerId: 'worker-1', decision: 'rested' });
  await db.execute("UPDATE submissions SET band = 'normal' WHERE entry_key = 'k-1'");
  const [d] = (await json(await call(db, 'GET', `/api/decisions?from=${DAY}&to=${DAY}`, 'admin'))).decisions;
  assert.equal(d.band, 'danger');
});

test('only the admin records decisions; a worker reads only their own', async () => {
  const db = await seeded();
  await decide(db, { workerId: 'worker-1', decision: 'worked', reason: '面談済み' });
  await decide(db, { workerId: 'worker-2', decision: 'worked' });

  assert.equal((await call(db, 'GET', '/api/decisions'))?.status, 401);
  assert.equal((await decide(db, { workerId: 'worker-1', decision: 'rested' }, 'worker-1'))?.status, 403);
  assert.equal((await call(db, 'GET', '/api/decisions?workerId=worker-2', 'worker-1'))?.status, 403);

  const own = (await json(await call(db, 'GET', `/api/decisions?from=${DAY}&to=${DAY}`, 'worker-1'))).decisions;
  assert.deepEqual(own.map((d: { workerId: string; reason: string }) => [d.workerId, d.reason]), [['worker-1', '面談済み']]);

  assert.equal((await decide(db, { workerId: 'worker-9', decision: 'rested' }))?.status, 404);
  assert.equal((await decide(db, { workerId: 'worker-1', decision: 'fired' }))?.status, 400);
  assert.equal((await decide(db, { workerId: 'worker-1', decision: 'rested', date: '2999-01-01' }))?.status, 400);
  assert.equal((await decide(db, { workerId: 'worker-1', decision: 'rested', reason: 'x'.repeat(501) }))?.status, 400);
  assert.equal((await call(db, 'GET', '/api/decisions?from=2026-08-20&to=2026-08-10', 'admin'))?.status, 400);
});
