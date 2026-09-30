import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadSampleFeed, loadSampleRoster, runSqlScript } from '@midnight-demo/db';
import type { SubmissionRecord } from '@midnight-demo/ingester-core';

import { openIngesterDb } from './db.js';
import { loadConditionFeed, loadRoster, recordSubmissions, submittedEntryKeys } from './store.js';

function fileEnv(): Record<string, string> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-db-')), 'ingester.db');
  return { LIBSQL_URL: `file:${file}` };
}

const record: SubmissionRecord = {
  entryKey: '99',
  ringId: 'ring-1',
  timezone: 'Asia/Tokyo',
  periodStartMs: Date.parse('2026-08-16T00:00:00+09:00'),
  recordedAtMs: Date.parse('2026-08-15T22:10:00.000Z'),
  band: 'normal',
  scoreCommitmentHex: 'ab'.repeat(32),
  submittedAt: '2026-08-16T00:05:00.000Z',
};

test('openIngesterDb migrates; roster/feed/submissions start empty', async () => {
  const db = await openIngesterDb(fileEnv());
  assert.deepEqual(await loadRoster(db), []);
  assert.deepEqual(await loadConditionFeed(db), []);
  assert.deepEqual([...(await submittedEntryKeys(db))], []);
});

test('a fresh database has an empty roster and feed', async () => {
  const db = await openIngesterDb(fileEnv());

  assert.deepEqual(await loadRoster(db), []);
  assert.deepEqual(await loadConditionFeed(db), []);
});

test('the opt-in sample roster + feed populate the tables', async () => {
  const db = await openIngesterDb(fileEnv());
  await runSqlScript(db, loadSampleRoster());
  await runSqlScript(db, loadSampleFeed());

  const roster = await loadRoster(db);
  assert.deepEqual(roster.map((r) => r.ringId).sort(), ['ring-1', 'ring-2', 'ring-3']);
  assert.equal(roster.find((r) => r.ringId === 'ring-1')?.timezone, 'Asia/Tokyo');

  const feed = await loadConditionFeed(db);
  assert.equal(feed.length, 4);
  assert.equal(feed[0]?.ringId, 'ring-1');
  assert.equal(feed[0]?.value, 78);
});

test('recordSubmissions is insert-or-ignore and feeds submittedEntryKeys', async () => {
  const db = await openIngesterDb(fileEnv());
  await recordSubmissions(db, [record]);
  await recordSubmissions(db, [record]);
  assert.deepEqual([...(await submittedEntryKeys(db))], ['99']);

  const row = await db.first<{ band: string; timezone: string }>(
    'SELECT band, timezone FROM submissions WHERE entry_key = ?',
    ['99'],
  );
  assert.equal(row?.band, 'normal');
  assert.equal(row?.timezone, 'Asia/Tokyo');
});
