import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadSampleRoster, runSqlScript, type SqlDatabase } from '@midnight-demo/db';
import {
  bytesToHex,
  partnerKeyId,
  partnerScoreMessage,
  type PartnerKey,
  type PartnerScore,
  type SignedPartnerScore,
} from '@midnight-demo/shared';

import { openIngesterDb } from './db.js';
import { partnerCursor, PartnerPullError, pullPartnerScores, type PartnerConfig } from './partner.js';

interface FakePartner {
  config: PartnerConfig;
  fetch: typeof fetch;
  sign(score: PartnerScore): Promise<SignedPartnerScore>;
  feed: SignedPartnerScore[];
  status?: number;
  keyIdOverride?: string;
  requests: string[];
}

async function fakePartner(pageSize = 2): Promise<FakePartner> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as {
    privateKey: PartnerKey;
    publicKey: PartnerKey;
  };
  const publicKeyHex = bytesToHex(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  const keyId = await partnerKeyId(publicKeyHex);
  const partner: FakePartner = {
    config: { url: 'http://partner.test', apiKey: 'k', publicKeyHex },
    feed: [],
    requests: [],
    async sign(score) {
      const signature = await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new Uint8Array(partnerScoreMessage(score)));
      return { ...score, signature: bytesToHex(new Uint8Array(signature)) };
    },
    fetch: (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      partner.requests.push(url.search);
      if (partner.status) return new Response('{}', { status: partner.status });
      const since = Number(url.searchParams.get('since'));
      const scores = partner.feed.slice(since, since + pageSize);
      return Response.json({
        schemaVersion: 1,
        keyId: partner.keyIdOverride ?? keyId,
        nextCursor: String(since + scores.length),
        scores,
      });
    }) as typeof fetch,
  };
  return partner;
}

async function rosterDb(): Promise<SqlDatabase> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-partner-')), 'ingester.db');
  const db = await openIngesterDb({ LIBSQL_URL: `file:${file}` });
  await runSqlScript(db, loadSampleRoster());
  return db;
}

const score = (id: string, ringId: string, value: number, minute = '00'): PartnerScore => ({
  id,
  ringId,
  measuredAt: `2026-09-29T22:${minute}:00.000Z`,
  score: value,
});

async function readings(db: SqlDatabase) {
  return db.all<{ ring_id: string; value: number; source: string; status: string; external_id: string }>(
    'SELECT ring_id, value, source, status, external_id FROM condition_readings ORDER BY id',
  );
}

test('pull stores signed scores as pending partner readings and advances the cursor', async () => {
  const db = await rosterDb();
  const partner = await fakePartner();
  partner.feed.push(
    await partner.sign(score('m-1', 'ring-1', 78.5)),
    await partner.sign(score('m-2', 'ring-2', 31, '01')),
    await partner.sign(score('m-3', 'ring-3', 55, '02')),
  );

  const first = await pullPartnerScores(db, partner.config, partner.fetch);
  assert.deepEqual(
    { ...first },
    { fetched: 3, inserted: 3, duplicates: 0, conflicts: 0, badSignature: 0, invalid: 0, unknownRing: 0, cursor: '3' },
  );
  assert.deepEqual(partner.requests, ['?since=0', '?since=2', '?since=3']);
  assert.equal(await partnerCursor(db), '3');
  const rows = await readings(db);
  assert.deepEqual(rows.map((r) => [r.ring_id, Number(r.value), r.source, r.status, r.external_id]), [
    ['ring-1', 78.5, 'partner_api', 'pending', 'm-1'],
    ['ring-2', 31, 'partner_api', 'pending', 'm-2'],
    ['ring-3', 55, 'partner_api', 'pending', 'm-3'],
  ]);

  const again = await pullPartnerScores(db, partner.config, partner.fetch);
  assert.equal(again.fetched, 0);
  assert.equal((await readings(db)).length, 3);
});

test('a replayed page is idempotent and a changed replay is a conflict, never an overwrite', async () => {
  const db = await rosterDb();
  const partner = await fakePartner();
  partner.feed.push(await partner.sign(score('m-1', 'ring-1', 78)));
  await pullPartnerScores(db, partner.config, partner.fetch);

  partner.feed.push(
    await partner.sign(score('m-1', 'ring-1', 78)),
    await partner.sign(score('m-1', 'ring-1', 20)),
  );
  const replay = await pullPartnerScores(db, partner.config, partner.fetch);
  assert.equal(replay.duplicates, 1);
  assert.equal(replay.conflicts, 1);
  assert.equal(replay.inserted, 0);
  const rows = await readings(db);
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0]?.value), 78);
});

test('a duplicated id inside one page is caught before it reaches the database', async () => {
  const db = await rosterDb();
  const partner = await fakePartner(10);
  partner.feed.push(
    await partner.sign(score('m-1', 'ring-1', 78)),
    await partner.sign(score('m-1', 'ring-1', 78)),
    await partner.sign(score('m-1', 'ring-1', 40)),
  );
  const result = await pullPartnerScores(db, partner.config, partner.fetch);
  assert.deepEqual([result.inserted, result.duplicates, result.conflicts], [1, 1, 1]);
  assert.equal((await readings(db)).length, 1);
});

test('bad signatures, out-of-range values and unknown rings are rejected but consumed', async () => {
  const db = await rosterDb();
  const partner = await fakePartner(10);
  const good = await partner.sign(score('m-1', 'ring-1', 70));
  partner.feed.push(
    { ...good, score: 99 },
    { ...(await partner.sign(score('m-2', 'ring-1', 70, '01'))), signature: 'zz' },
    await partner.sign(score('m-3', 'ring-1', 150, '02')),
    await partner.sign(score('m-4', 'ring-x', 70, '03')),
    await partner.sign(score('m-5', 'ring-2', 45, '04')),
  );

  const result = await pullPartnerScores(db, partner.config, partner.fetch);
  assert.deepEqual(
    [result.fetched, result.badSignature, result.invalid, result.unknownRing, result.inserted],
    [5, 2, 1, 1, 1],
  );
  assert.deepEqual((await readings(db)).map((r) => r.external_id), ['m-5']);
  assert.equal(result.cursor, '5');
});

test('a foreign signing key or an HTTP error aborts the pull without moving the cursor', async () => {
  const db = await rosterDb();
  const partner = await fakePartner();
  partner.feed.push(await partner.sign(score('m-1', 'ring-1', 70)));

  partner.keyIdOverride = 'ffffffffffffffff';
  await assert.rejects(() => pullPartnerScores(db, partner.config, partner.fetch), PartnerPullError);
  assert.equal(await partnerCursor(db), '0');

  partner.keyIdOverride = undefined;
  partner.status = 401;
  await assert.rejects(
    () => pullPartnerScores(db, partner.config, partner.fetch),
    (error) => error instanceof PartnerPullError && error.status === 401,
  );
  assert.equal(await partnerCursor(db), '0');
  assert.deepEqual(await readings(db), []);

  partner.status = undefined;
  const other = await fakePartner();
  await assert.rejects(
    () => pullPartnerScores(db, { ...partner.config, publicKeyHex: other.config.publicKeyHex }, partner.fetch),
    PartnerPullError,
  );
});
