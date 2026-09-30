import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadSampleFeed, loadSampleRoster, runSqlScript, type SqlDatabase } from '@midnight-demo/db';
import {
  planSubmissions,
  type ConditionChain,
  type ReadingOutcome,
  type SkipReason,
} from '@midnight-demo/ingester-core';

import { openIngesterDb } from './db.js';
import { reconcileSubmissions } from './reconcile.js';
import { submitStagedFeed } from './submit.js';

type Ledger = Awaited<ReturnType<ConditionChain['readEntries']>>;

const salt = new Uint8Array(16).fill(0x5a);
const recordedAt = '2026-08-20T08:30:00+09:00';

function fakeChain(options: { fail?: string } = {}): ConditionChain & { ledger: Ledger; calls: number } {
  const ledger: Ledger = new Map();
  const chain = {
    ledger,
    calls: 0,
    async submitReadings(request: Parameters<ConditionChain['submitReadings']>[0]) {
      chain.calls += 1;
      const seen = new Set(request.submittedEntryKeys);
      const outcomes: ReadingOutcome[] = [];
      for (const reading of request.readings) {
        const plan = await planSubmissions({
          conditions: [reading],
          roster: request.roster,
          salt: request.salt,
          submittedEntryKeys: seen,
        });
        const planned = plan.planned[0];
        if (!planned) {
          outcomes.push({ status: 'skipped', reason: plan.skipped[0] as SkipReason });
          continue;
        }
        seen.add(planned.entryKey);
        if (options.fail) {
          outcomes.push({ status: 'failed', error: options.fail });
          continue;
        }
        const existing = ledger.get(planned.entryKey);
        if (existing) {
          outcomes.push({
            status: 'submitted',
            submission: { ...planned, band: existing.band, scoreCommitmentHex: existing.scoreCommitmentHex },
            tx: { txId: 'backfilled', txHash: null, blockHeight: 'unknown' },
            recovered: true,
          });
          continue;
        }
        ledger.set(planned.entryKey, {
          band: planned.band,
          periodStartMs: planned.periodStartMs,
          recordedAtMs: planned.recordedAtMs,
          scoreCommitmentHex: planned.scoreCommitmentHex,
          verified: true,
        });
        outcomes.push({
          status: 'submitted',
          submission: planned,
          tx: { txId: `tx-${ledger.size}`, txHash: `hash-${ledger.size}`, blockHeight: String(ledger.size) },
          recovered: false,
        });
      }
      return outcomes;
    },
    async readEntries(entryKeys: readonly string[]) {
      const found: Ledger = new Map();
      for (const key of entryKeys) {
        const entry = ledger.get(key);
        if (entry) found.set(key, entry);
      }
      return found;
    },
  };
  return chain;
}

async function rosterDb(): Promise<SqlDatabase> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-submit-')), 'ingester.db');
  const db = await openIngesterDb({ LIBSQL_URL: `file:${file}` });
  await runSqlScript(db, loadSampleRoster());
  return db;
}

async function submissionRow(db: SqlDatabase, entryKey: string) {
  return db.first<{ band: string; tx_id: string; chain_verified_at: string | null }>(
    'SELECT band, tx_id, chain_verified_at FROM submissions WHERE entry_key = ?',
    [entryKey],
  );
}

async function queue(db: SqlDatabase, ringId: string, value: number, at = recordedAt): Promise<void> {
  await db.execute(
    `INSERT INTO condition_readings (ring_id, recorded_at, value, source, status, created_at)
     VALUES (?, ?, ?, 'partner_api', 'pending', ?)`,
    [ringId, at, value, at],
  );
}

async function onlyEntryKey(db: SqlDatabase): Promise<string> {
  const rows = await db.all<{ entry_key: string }>('SELECT entry_key FROM submissions');
  assert.equal(rows.length, 1);
  return (rows[0] as { entry_key: string }).entry_key;
}

test('the queue submit records the chain result and confirms it against the chain', async () => {
  const db = await rosterDb();
  const chain = fakeChain();
  await queue(db, 'ring-1', 72);
  await queue(db, 'ring-1', 30, '2026-08-20T18:00:00+09:00');

  const r = await submitStagedFeed(db, chain, salt);
  assert.deepEqual(r, {
    submitted: 1,
    skipped: 1,
    failed: 0,
    tampered: 0,
    reconcile: { confirmed: 1, mismatches: 0, valueMismatches: 0, missing: 0 },
  });
  const entryKey = await onlyEntryKey(db);
  assert.equal((await submissionRow(db, entryKey))?.band, 'normal');
  assert.notEqual((await submissionRow(db, entryKey))?.chain_verified_at, null);
  assert.equal(chain.ledger.get(entryKey)?.band, 'normal');
  assert.deepEqual(await statuses(db), [['submitted', null], ['skipped', 'already_submitted']]);
});

test('a tampered submit keeps the worker value locally and is caught on the second verify', async () => {
  const db = await rosterDb();
  const chain = fakeChain();
  await queue(db, 'ring-1', 72);

  const r = await submitStagedFeed(db, chain, salt, { tamper: true });
  assert.equal(r.submitted, 1);
  assert.equal(r.tampered, 1);
  assert.equal(r.reconcile, null);
  const entryKey = await onlyEntryKey(db);
  assert.equal(chain.ledger.get(entryKey)?.band, 'danger');
  assert.equal((await submissionRow(db, entryKey))?.band, 'normal');
  assert.deepEqual(
    await db.all('SELECT value FROM condition_readings'),
    [{ value: 72 }],
  );

  const first = await reconcileSubmissions(db, chain, { entryKeys: [entryKey], phased: true });
  assert.deepEqual([first.localChecked, first.confirmed, first.mismatches.length], [1, 0, 0]);
  const caught = await reconcileSubmissions(db, chain, { entryKeys: [entryKey], phased: true });
  assert.equal(caught.mismatches.length, 1);
  assert.equal(caught.valueMismatches.length, 1);
  assert.equal(caught.confirmed, 0);
  const row = await submissionRow(db, entryKey);
  assert.equal(row?.band, 'danger');
  assert.equal(row?.chain_verified_at, null);
});

test('an entry already on chain but missing locally is backfilled from the chain, never tampered', async () => {
  const db = await rosterDb();
  const chain = fakeChain();
  await queue(db, 'ring-1', 72);
  await submitStagedFeed(db, chain, salt);
  await db.execute('DELETE FROM submissions');
  await db.execute("UPDATE condition_readings SET status = 'pending'");

  const again = await submitStagedFeed(db, chain, salt, { tamper: true });
  assert.equal(again.submitted, 1);
  assert.equal(again.tampered, 0);
  const entryKey = await onlyEntryKey(db);
  const row = await submissionRow(db, entryKey);
  assert.equal(row?.tx_id, 'backfilled');
  assert.equal(row?.band, 'normal');
});

test('an unknown ring is skipped and nothing reaches the chain', async () => {
  const db = await rosterDb();
  const chain = fakeChain();
  await queue(db, 'ring-x', 50);
  const r = await submitStagedFeed(db, chain, salt);
  assert.deepEqual([r.submitted, r.skipped], [0, 1]);
  assert.equal(chain.ledger.size, 0);
  assert.deepEqual(await statuses(db), [['skipped', 'unknown_ring']]);
});

async function statuses(db: SqlDatabase) {
  return (
    await db.all<{ status: string; skip_reason: string | null; last_error: string | null }>(
      'SELECT status, skip_reason, last_error FROM condition_readings ORDER BY id',
    )
  ).map((row) => [row.status, row.skip_reason ?? row.last_error]);
}

test('submitStagedFeed submits the queue once and records each outcome on its reading', async () => {
  const db = await rosterDb();
  await runSqlScript(db, loadSampleFeed());
  const chain = fakeChain();

  const first = await submitStagedFeed(db, chain, salt);
  assert.equal(first.submitted, 2);
  assert.equal(first.skipped, 2);
  assert.equal(first.failed, 0);
  assert.deepEqual(first.reconcile, { confirmed: 2, mismatches: 0, valueMismatches: 0, missing: 0 });
  assert.deepEqual(await statuses(db), [
    ['submitted', null],
    ['submitted', null],
    ['skipped', 'unknown_ring'],
    ['skipped', 'invalid_value'],
  ]);

  const second = await submitStagedFeed(db, chain, salt);
  assert.deepEqual(second, { submitted: 0, skipped: 0, failed: 0, tampered: 0, reconcile: null });
  assert.equal(chain.calls, 1);
});

test('a failed submission stays in the queue with its error and goes through on retry', async () => {
  const db = await rosterDb();
  await db.execute(
    `INSERT INTO condition_readings (ring_id, recorded_at, value, source, status, external_id, created_at)
     VALUES ('ring-1', ?, 64, 'partner_api', 'pending', 'm-1', ?)`,
    [recordedAt, recordedAt],
  );

  const failed = await submitStagedFeed(db, fakeChain({ fail: 'proof server unavailable' }), salt);
  assert.deepEqual(failed, { submitted: 0, skipped: 0, failed: 1, tampered: 0, reconcile: null });
  assert.deepEqual(await statuses(db), [['failed', 'proof server unavailable']]);

  const retried = await submitStagedFeed(db, fakeChain(), salt);
  assert.equal(retried.submitted, 1);
  assert.deepEqual(await statuses(db), [['submitted', null]]);
  const rows = await db.all<{ external_id: string }>('SELECT external_id FROM condition_readings');
  assert.deepEqual(rows.map((r) => r.external_id), ['m-1']);
});

test('reconcile reports an entry the chain does not have as missing', async () => {
  const db = await rosterDb();
  const chain = fakeChain();
  await queue(db, 'ring-1', 72);
  await submitStagedFeed(db, chain, salt, { tamper: true });
  const entryKey = await onlyEntryKey(db);
  chain.ledger.clear();

  const result = await reconcileSubmissions(db, chain);
  assert.deepEqual(result.missing, [entryKey]);
  assert.equal(result.confirmed, 0);
});
