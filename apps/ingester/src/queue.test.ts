import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadSampleRoster, runSqlScript, type SqlDatabase } from '@midnight-demo/db';
import type { RunnerJob, RunnerSubmitRequest } from '@midnight-demo/ingester-core';
import { hexToBytes } from '@midnight-demo/shared';

import { openIngesterDb } from './db.js';
import { drainQueue, enqueueReadings, latestChainJob, type ChainRunner } from './queue.js';
import { fakeChain } from './test-chain.js';

const salt = new Uint8Array(16).fill(0x5a);
const t0 = new Date('2026-08-20T10:00:00Z');

async function rosterDb(): Promise<SqlDatabase> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-queue-')), 'ingester.db');
  const db = await openIngesterDb({ LIBSQL_URL: `file:${file}` });
  await runSqlScript(db, loadSampleRoster());
  return db;
}

async function reading(db: SqlDatabase, ringId: string, value: number, at: string): Promise<void> {
  await db.execute(
    `INSERT INTO condition_readings (ring_id, recorded_at, value, source, status, created_at)
     VALUES (?, ?, ?, 'partner_api', 'pending', ?)`,
    [ringId, at, value, at],
  );
}

async function statuses(db: SqlDatabase): Promise<string[]> {
  return (await db.all<{ status: string }>('SELECT status FROM condition_readings ORDER BY id')).map((r) => r.status);
}

function fakeRunner() {
  const chain = fakeChain();
  const requests: RunnerSubmitRequest[] = [];
  const jobs = new Map<string, RunnerJob>();
  const runner: ChainRunner & {
    requests: typeof requests;
    jobs: typeof jobs;
    finish(jobId: string): Promise<void>;
    ledger: typeof chain.ledger;
  } = {
    requests,
    jobs,
    ledger: chain.ledger,
    async startJob(jobId, request) {
      requests.push(request);
      jobs.set(jobId, { state: 'running', stage: 'syncing' });
    },
    async job(jobId) {
      return jobs.get(jobId) ?? { state: 'unknown' };
    },
    readEntries: (keys) => chain.readEntries(keys),
    async finish(jobId) {
      const request = requests.at(-1) as RunnerSubmitRequest;
      const outcomes = await chain.submitReadings({
        readings: request.readings,
        roster: request.roster,
        submittedEntryKeys: new Set(request.submittedEntryKeys),
        salt: hexToBytes(request.saltHex),
      });
      jobs.set(jobId, { state: 'done', outcomes });
    },
  };
  return runner;
}

function ids() {
  let n = 0;
  return () => `job-${++n}`;
}

test('enqueue marks pending and failed readings queued with the requester and tamper flag', async () => {
  const db = await rosterDb();
  await reading(db, 'ring-1', 72, '2026-08-20T08:30:00+09:00');
  await reading(db, 'ring-2', 40, '2026-08-20T08:30:00+09:00');
  await db.execute("UPDATE condition_readings SET status = 'failed', last_error = 'x' WHERE ring_id = 'ring-2'");

  assert.equal(await enqueueReadings(db, { queuedBy: 'admin:abc', tamper: true }, t0), 2);
  const rows = await db.all<{ status: string; queued_by: string; queued_tamper: number; last_error: string | null }>(
    'SELECT status, queued_by, queued_tamper, last_error FROM condition_readings ORDER BY id',
  );
  assert.deepEqual(
    rows.map((r) => [r.status, r.queued_by, Number(r.queued_tamper), r.last_error]),
    [
      ['queued', 'admin:abc', 1, null],
      ['queued', 'admin:abc', 1, null],
    ],
  );
  assert.equal(await enqueueReadings(db, {}, t0), 0);
});

test('enqueue honours the ring filter and the limit', async () => {
  const db = await rosterDb();
  await reading(db, 'ring-1', 72, '2026-08-20T08:30:00+09:00');
  await reading(db, 'ring-2', 40, '2026-08-20T08:30:00+09:00');
  await reading(db, 'ring-2', 41, '2026-08-21T08:30:00+09:00');

  assert.equal(await enqueueReadings(db, { ringIds: [] }), 0);
  assert.equal(await enqueueReadings(db, { ringIds: ['ring-2'], limit: 1 }), 1);
  assert.deepEqual(await statuses(db), ['pending', 'queued', 'pending']);
});

test('drain is idle and never calls the runner when nothing is queued', async () => {
  const db = await rosterDb();
  const runner = fakeRunner();
  await reading(db, 'ring-1', 72, '2026-08-20T08:30:00+09:00');
  assert.deepEqual(await drainQueue(db, runner, salt, { now: t0 }), { action: 'idle' });
  assert.equal(runner.requests.length, 0);
});

test('drain starts one job, waits for it, then records and confirms the outcomes', async () => {
  const db = await rosterDb();
  const runner = fakeRunner();
  await reading(db, 'ring-1', 72, '2026-08-20T08:30:00+09:00');
  await reading(db, 'ring-2', 40, '2026-08-20T08:30:00+09:00');
  await enqueueReadings(db, { queuedBy: 'admin:abc' }, t0);

  const started = await drainQueue(db, runner, salt, { now: t0, newId: ids() });
  assert.deepEqual(started, { action: 'started', jobId: 'job-1', readings: 2 });
  assert.equal(runner.requests[0]?.saltHex, '5a'.repeat(16));
  assert.deepEqual(runner.requests[0]?.readings.map((r) => r.value), [72, 40]);

  assert.deepEqual(await drainQueue(db, runner, salt, { now: t0 }), {
    action: 'waiting',
    jobId: 'job-1',
    stage: 'syncing',
  });
  assert.equal((await latestChainJob(db))?.stage, 'syncing');
  assert.equal(runner.requests.length, 1);

  await runner.finish('job-1');
  const recorded = await drainQueue(db, runner, salt, { now: t0 });
  assert.deepEqual(recorded, {
    action: 'recorded',
    jobId: 'job-1',
    submitted: 2,
    skipped: 0,
    failed: 0,
    tampered: 0,
    confirmed: 2,
  });
  assert.deepEqual(await statuses(db), ['submitted', 'submitted']);
  const subs = await db.all<{ submitted_by: string; chain_verified_at: string | null }>(
    'SELECT submitted_by, chain_verified_at FROM submissions',
  );
  assert.ok(subs.every((s) => s.submitted_by === 'admin:abc' && s.chain_verified_at));
  const job = await latestChainJob(db);
  assert.equal(job?.status, 'done');
  assert.equal(job?.readings, 2);
  assert.deepEqual(await drainQueue(db, runner, salt, { now: t0 }), { action: 'idle' });
});

test('a tampered queued row sends a cross-band value, keeps the worker value locally and is not auto-confirmed', async () => {
  const db = await rosterDb();
  const runner = fakeRunner();
  await reading(db, 'ring-1', 72, '2026-08-20T08:30:00+09:00');
  await enqueueReadings(db, { tamper: true }, t0);

  await drainQueue(db, runner, salt, { now: t0, newId: ids() });
  assert.deepEqual(runner.requests[0]?.readings.map((r) => r.value), [25]);
  await runner.finish('job-1');
  const recorded = await drainQueue(db, runner, salt, { now: t0 });
  assert.equal(recorded.action, 'recorded');
  assert.equal(recorded.action === 'recorded' && recorded.tampered, 1);
  assert.equal(recorded.action === 'recorded' && recorded.confirmed, 0);
  const sub = await db.first<{ band: string; chain_verified_at: string | null }>(
    'SELECT band, chain_verified_at FROM submissions',
  );
  assert.equal(sub?.band, 'normal');
  assert.equal(sub?.chain_verified_at, null);
  const [onChain] = [...runner.ledger.values()];
  assert.equal(onChain?.band, 'danger');
});

test('only one job runs at a time; a second drain while one runs does not start another', async () => {
  const db = await rosterDb();
  const runner = fakeRunner();
  await reading(db, 'ring-1', 72, '2026-08-20T08:30:00+09:00');
  await enqueueReadings(db, {}, t0);
  await drainQueue(db, runner, salt, { now: t0, newId: ids() });
  await reading(db, 'ring-2', 40, '2026-08-20T08:30:00+09:00');
  await enqueueReadings(db, {}, t0);
  const second = await drainQueue(db, runner, salt, { now: t0, newId: () => 'job-x' });
  assert.equal(second.action, 'waiting');
  assert.equal(runner.requests.length, 1);
  await assert.rejects(
    db.execute("INSERT INTO chain_jobs (id, reading_ids, status, started_at) VALUES ('job-y', '[]', 'running', 'x')"),
  );
});

test('a job the runner no longer knows is lost and its readings are retried by the next drain', async () => {
  const db = await rosterDb();
  const runner = fakeRunner();
  await reading(db, 'ring-1', 72, '2026-08-20T08:30:00+09:00');
  await enqueueReadings(db, {}, t0);
  await drainQueue(db, runner, salt, { now: t0, newId: ids() });
  runner.jobs.clear();

  const lost = await drainQueue(db, runner, salt, { now: t0 });
  assert.equal(lost.action, 'lost');
  assert.deepEqual(await statuses(db), ['queued']);
  const again = await drainQueue(db, runner, salt, { now: t0, newId: () => 'job-2' });
  assert.deepEqual(again, { action: 'started', jobId: 'job-2', readings: 1 });
});

test('a runner that cannot be reached keeps the job until the timeout, then loses it', async () => {
  const db = await rosterDb();
  const runner = fakeRunner();
  await reading(db, 'ring-1', 72, '2026-08-20T08:30:00+09:00');
  await enqueueReadings(db, {}, t0);
  await drainQueue(db, runner, salt, { now: t0, newId: ids() });
  runner.job = async () => {
    throw new Error('connection refused');
  };
  const waiting = await drainQueue(db, runner, salt, { now: new Date(t0.getTime() + 60_000), timeoutMs: 600_000 });
  assert.equal(waiting.action, 'waiting');
  const lost = await drainQueue(db, runner, salt, { now: new Date(t0.getTime() + 601_000), timeoutMs: 600_000 });
  assert.equal(lost.action, 'lost');
  assert.deepEqual(await statuses(db), ['queued']);
});

test('a job the runner rejects is lost immediately and its readings stay queued', async () => {
  const db = await rosterDb();
  const runner = fakeRunner();
  runner.startJob = async () => {
    throw new Error('503');
  };
  await reading(db, 'ring-1', 72, '2026-08-20T08:30:00+09:00');
  await enqueueReadings(db, {}, t0);
  const r = await drainQueue(db, runner, salt, { now: t0, newId: ids() });
  assert.equal(r.action, 'lost');
  assert.equal((await latestChainJob(db))?.status, 'lost');
  assert.deepEqual(await statuses(db), ['queued']);
});

test('a failed job marks its readings failed with the error', async () => {
  const db = await rosterDb();
  const runner = fakeRunner();
  await reading(db, 'ring-1', 72, '2026-08-20T08:30:00+09:00');
  await enqueueReadings(db, {}, t0);
  await drainQueue(db, runner, salt, { now: t0, newId: ids() });
  runner.jobs.set('job-1', { state: 'failed', error: 'Wallet has no tNIGHT' });
  const r = await drainQueue(db, runner, salt, { now: t0 });
  assert.deepEqual(r, { action: 'failed', jobId: 'job-1', error: 'Wallet has no tNIGHT' });
  const row = await db.first<{ status: string; last_error: string }>('SELECT status, last_error FROM condition_readings');
  assert.deepEqual({ ...row }, { status: 'failed', last_error: 'Wallet has no tNIGHT' });
  assert.equal(await enqueueReadings(db, {}, t0), 1);
});

test('a reading deleted while its job runs is left out of the recorded outcomes', async () => {
  const db = await rosterDb();
  const runner = fakeRunner();
  await reading(db, 'ring-1', 72, '2026-08-20T08:30:00+09:00');
  await reading(db, 'ring-2', 40, '2026-08-20T08:30:00+09:00');
  await enqueueReadings(db, {}, t0);
  await drainQueue(db, runner, salt, { now: t0, newId: ids() });
  await db.execute("DELETE FROM condition_readings WHERE ring_id = 'ring-2'");
  await runner.finish('job-1');
  const r = await drainQueue(db, runner, salt, { now: t0 });
  assert.equal(r.action === 'recorded' && r.submitted, 1);
  assert.equal((await db.all('SELECT entry_key FROM submissions')).length, 1);
});
