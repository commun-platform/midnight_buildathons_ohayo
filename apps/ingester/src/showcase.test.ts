import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { SqlDatabase } from '@midnight-demo/db';
import { APP_TIME_ZONE, zonedDayStartMs } from '@midnight-demo/shared';

import { openIngesterDb } from './db.js';
import { resetSandbox, SHOWCASE_ACTOR, SHOWCASE_DAYS, seedShowcase, showcasePlan } from './showcase.js';
import { submitStagedFeed } from './submit.js';
import { fakeChain } from './test-chain.js';

const salt = new Uint8Array(16).fill(0x5a);
const NOW = new Date('2026-10-03T03:00:00Z');
const DAY_MS = 86_400_000;

async function freshDb(): Promise<SqlDatabase> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-showcase-')), 'ingester.db');
  return openIngesterDb({ LIBSQL_URL: `file:${file}` });
}

test('the showcase plan covers the last 7 days before today, with every band and one missing day', () => {
  const plan = showcasePlan(NOW);
  assert.deepEqual([plan.from, plan.to], ['2026-09-26', '2026-10-02']);
  assert.equal(plan.readings.length, 4 * SHOWCASE_DAYS - 1);
  assert.deepEqual(new Set(plan.readings.map((r) => r.band)), new Set(['normal', 'caution', 'danger']));
  const today = zonedDayStartMs(NOW.getTime(), APP_TIME_ZONE);
  for (const r of plan.readings) {
    const at = Date.parse(r.recordedAt);
    assert.ok(at < today, `${r.recordedAt} is before today`);
    assert.ok(at >= today - SHOWCASE_DAYS * DAY_MS);
  }
  const perRing = new Map<string, number>();
  for (const r of plan.readings) perRing.set(r.ringId, (perRing.get(r.ringId) ?? 0) + 1);
  assert.deepEqual([...perRing.values()].sort(), [6, 7, 7, 7]);
  assert.deepEqual(
    plan.decisions.map((d) => `${d.band}:${d.decision}`).sort(),
    ['danger:rested', 'danger:worked'],
  );
  assert.ok(plan.decisions.every((d) => d.reason.length > 0));
});

test('seeding is idempotent and its readings go on chain like any other', async () => {
  const db = await freshDb();
  const first = await seedShowcase(db, NOW);
  assert.deepEqual([first.readings, first.decisions], [27, 2]);
  const again = await seedShowcase(db, NOW);
  assert.deepEqual([again.readings, again.decisions], [0, 0]);
  assert.equal((await db.all('SELECT 1 FROM ring_worker_map WHERE ring_id LIKE ?', ['ring-showcase-%'])).length, 4);

  const readings = await db.all<{ source: string; status: string }>(
    "SELECT source, status FROM condition_readings WHERE ring_id LIKE 'ring-showcase-%'",
  );
  assert.ok(readings.every((r) => r.source === 'partner_api' && r.status === 'pending'));

  await db.execute("UPDATE condition_readings SET status = 'queued'");
  const chain = fakeChain();
  const result = await submitStagedFeed(db, chain, salt, { submittedBy: 'admin-key' });
  assert.deepEqual([result.submitted, result.skipped, result.failed], [27, 0, 0]);

  const tomorrow = new Date(NOW.getTime() + DAY_MS);
  const fresh = showcasePlan(tomorrow).readings.filter((r) => r.date === '2026-10-03').length;
  const later = await seedShowcase(db, tomorrow);
  assert.deepEqual([later.readings, later.decisions, later.to], [fresh, showcasePlan(tomorrow).decisions.filter((d) => d.id.endsWith('2026-10-03')).length, '2026-10-03']);
  const overlap = showcasePlan(tomorrow).readings.filter((r) => r.date !== '2026-10-03');
  const before = new Map(showcasePlan(NOW).readings.map((r) => [`${r.ringId}|${r.date}`, r.value]));
  assert.ok(overlap.every((r) => before.get(`${r.ringId}|${r.date}`) === r.value));
});

async function guest(db: SqlDatabase, id: string, expiresAt: string): Promise<void> {
  const ring = `ring-guest-${id}`;
  const worker = `guest-${id}`;
  await db.batch([
    { sql: 'INSERT INTO workers (id, created_at) VALUES (?, ?)', parameters: [worker, '2026-10-02T00:00:00Z'] },
    { sql: 'INSERT INTO worker_pii (worker_id, name) VALUES (?, ?)', parameters: [worker, `ゲスト ${id}`] },
    {
      sql: "INSERT INTO rings (id, label, status, created_at) VALUES (?, ?, 'deployed', ?)",
      parameters: [ring, `GUEST-${id}`, '2026-10-02T00:00:00Z'],
    },
    {
      sql: 'INSERT INTO ring_worker_map (ring_id, worker_id, from_ts, to_ts) VALUES (?, ?, ?, NULL)',
      parameters: [ring, worker, '2026-10-02T00:00:00Z'],
    },
    {
      sql: 'INSERT INTO guest_sessions (id, worker_id, ring_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      parameters: [id, worker, ring, '2026-10-02T00:00:00Z', expiresAt],
    },
    {
      sql: `INSERT INTO condition_readings (ring_id, recorded_at, value, source, status, created_at)
            VALUES (?, '2026-10-02T01:00:00Z', 30, 'partner_api', 'submitted', '2026-10-02T01:00:00Z')`,
      parameters: [ring],
    },
    {
      sql: `INSERT INTO submissions (entry_key, ring_id, period_start_ms, timezone, recorded_at_ms, band,
              score_commitment_hex, submitted_at, submitted_by)
            VALUES (?, ?, 1, 'Asia/Tokyo', 1, 'danger', 'aa', '2026-10-02T01:00:00Z', ?)`,
      parameters: [[...id].map((c) => c.charCodeAt(0)).join(''), ring, `guest:${id}`],
    },
    {
      sql: `INSERT INTO audit_log (id, actor_user_id, action, target_table, target_id, ts)
            VALUES (?, ?, 'disclosure.issue', 'submissions', 'x', '2026-10-02T01:00:00Z')`,
      parameters: [`al-${id}`, `guest:${id}`],
    },
  ]);
}

async function decide(db: SqlDatabase, id: string, by: string, supersedes: string | null, periodStartMs: number) {
  await db.execute(
    `INSERT INTO work_decisions (id, worker_id, period_start_ms, decision, reason, decided_by, decided_at, supersedes_id)
     VALUES (?, 'showcase-c', ?, 'rested', 'test', ?, '2026-10-02T02:00:00Z', ?)`,
    [id, periodStartMs, by, supersedes],
  );
}

test('the nightly reset removes expired guests and what they did, and keeps the showcase and live guests', async () => {
  const db = await freshDb();
  await seedShowcase(db, NOW);
  const seeded = showcasePlan(NOW).decisions;
  const rested = seeded.find((d) => d.decision === 'rested');
  const worked = seeded.find((d) => d.decision === 'worked');
  assert.ok(rested && worked);

  await guest(db, 'old1', '2026-10-02T02:00:00Z');
  await guest(db, 'old2', '2026-10-02T02:30:00Z');
  await guest(db, 'live', '2026-10-03T05:00:00Z');
  await decide(db, 'd-old1', 'guest:old1', rested.id, rested.periodStartMs);
  await decide(db, 'd-live', 'guest:live', 'd-old1', rested.periodStartMs);
  await decide(db, 'd-old2', 'guest:old2', worked.id, worked.periodStartMs);
  await db.execute(
    "INSERT INTO auth_challenges (id, message, expires_at) VALUES ('c-old', 'm', '2026-10-02T00:00:00Z'), ('c-new', 'm', '2026-10-03T09:00:00Z')",
  );

  const result = await resetSandbox(db, NOW);
  assert.deepEqual(result, { guests: 2, challenges: 1 });

  const left = async (sql: string) => (await db.all<{ id: string }>(sql)).map((r) => r.id).sort();
  assert.deepEqual(await left('SELECT id FROM guest_sessions'), ['live']);
  assert.deepEqual(await left("SELECT id FROM workers WHERE id LIKE 'guest-%'"), ['guest-live']);
  assert.deepEqual(await left("SELECT id FROM rings WHERE id LIKE 'ring-guest-%'"), ['ring-guest-live']);
  assert.deepEqual(
    await left("SELECT DISTINCT ring_id AS id FROM condition_readings WHERE ring_id LIKE 'ring-guest-%'"),
    ['ring-guest-live'],
  );
  assert.deepEqual(await left("SELECT DISTINCT ring_id AS id FROM submissions"), ['ring-guest-live']);
  assert.deepEqual(await left('SELECT actor_user_id AS id FROM audit_log'), ['guest:live']);
  assert.deepEqual(await left('SELECT id FROM auth_challenges'), ['c-new']);

  assert.deepEqual(await left('SELECT id FROM work_decisions'), ['d-live', 'd-old1', rested.id, worked.id].sort());
  assert.equal((await db.all('SELECT 1 FROM work_decisions WHERE decided_by = ?', [SHOWCASE_ACTOR])).length, 2);
  assert.equal(
    (await db.all("SELECT 1 FROM condition_readings WHERE ring_id LIKE 'ring-showcase-%'")).length,
    27,
  );

  await assert.rejects(() => db.execute('DELETE FROM work_decisions WHERE id = ?', [rested.id]), /append-only/);
  assert.equal(await db.execute("DELETE FROM work_decisions WHERE id = 'd-live'"), 1);
});
