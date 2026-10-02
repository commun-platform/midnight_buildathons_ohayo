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
import { sealOpening } from '@midnight-demo/shared';

import type { GatewayDeps } from './deps.js';
import { handleApi } from './test-support.js';

const SALT = new Uint8Array(16).fill(0x5a);
const KEY = 'ab'.repeat(32);
const NONCE = '11'.repeat(32);
const PERIOD_START = Date.parse('2026-10-01T15:00:00Z');
const TX_HASH = 'cd'.repeat(32);

async function fakeCommit(scoreCenti: number, nonceHex: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${scoreCenti}:${nonceHex}`));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function setup(options: { opening?: boolean; key?: string | null; chain?: boolean } = {}) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gw-public-')), 'test.db');
  const db: SqlDatabase = createDatabase({ url: `file:${file}` });
  await applyMigrations(db, loadConditionMigrations());
  await runSqlScript(db, loadSampleRoster());
  const commitment = await fakeCommit(7200, NONCE);
  const opening = options.opening === false ? null : await sealOpening(KEY, '42', { scoreCenti: 7200, nonceHex: NONCE });
  await db.execute(
    `INSERT INTO submissions (entry_key, ring_id, period_start_ms, timezone, recorded_at_ms, band,
       score_commitment_hex, tx_id, tx_hash, block_height, submitted_at, opening_ciphertext)
     VALUES ('42', 'ring-1', ?, 'Asia/Tokyo', ?, 'normal', ?, 'tx-1', ?, '123', '2026-10-02T00:00:00Z', ?)`,
    [PERIOD_START, PERIOD_START + 3_600_000, commitment, TX_HASH, opening],
  );
  const ledger = new Map<string, OnChainEntry>([
    [
      '42',
      {
        band: 'normal',
        periodStartMs: PERIOD_START,
        recordedAtMs: PERIOD_START + 3_600_000,
        scoreCommitmentHex: commitment,
        verified: true,
      },
    ],
  ]);
  const deps: GatewayDeps = {
    db,
    reader: fakeReader(new Map()),
    salt: SALT,
    config: { contractAddress: 'cafe' },
    ...(options.chain === false
      ? {}
      : { chain: { readEntries: async (keys: readonly string[]) => new Map(keys.flatMap((k) => (ledger.has(k) ? [[k, ledger.get(k) as OnChainEntry]] : []))) } }),
    openCommitment: fakeCommit,
    ...(options.key === null ? {} : { openingKeyHex: options.key ?? KEY }),
  };
  const call = async (method: string, pathname: string, body?: unknown, token?: string) => {
    const response = await handleApi(
      new Request(`http://gw${pathname}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
      deps,
    );
    assert.ok(response);
    return { status: response.status, body: (await response.json()) as any };
  };
  return { db, deps, call, ledger, commitment };
}

test('the public entry is read from the chain without a login, and never shows who or the value', async () => {
  const { call, commitment, db } = await setup();
  const byKey = await call('GET', '/api/public/entry?entryKey=42');
  assert.equal(byKey.status, 200);
  assert.deepEqual(
    {
      band: byKey.body.band,
      periodDate: byKey.body.periodDate,
      scoreCommitmentHex: byKey.body.scoreCommitmentHex,
      source: byKey.body.source,
      tx: byKey.body.tx,
      contractAddress: byKey.body.contractAddress,
      notOnLedger: byKey.body.notOnLedger,
    },
    {
      band: 'normal',
      periodDate: '2026-10-02',
      scoreCommitmentHex: commitment,
      source: 'chain',
      tx: { txHash: TX_HASH, blockHeight: '123' },
      contractAddress: 'cafe',
      notOnLedger: ['workerName', 'ringId', 'value'],
    },
  );
  const text = JSON.stringify(byKey.body);
  assert.ok(!text.includes('ring-1') && !text.includes('7200') && !text.includes('worker-1'));

  assert.equal((await call('GET', `/api/public/entry?tx=0x${TX_HASH.toUpperCase()}`)).body.entryKey, '42');
  assert.equal((await call('GET', '/api/public/entry?tx=deadbeefdeadbeef')).status, 404);
  assert.equal((await call('GET', '/api/public/entry?entryKey=abc')).status, 400);
  assert.equal((await call('GET', '/api/public/entry')).status, 400);
  assert.equal((await call('GET', '/api/public/entry?entryKey=43')).status, 404);

  await db.execute("UPDATE submissions SET band = 'danger'");
  assert.equal((await call('GET', '/api/public/entry?entryKey=42')).body.band, 'normal');
});

test('the public entry needs a chain reader', async () => {
  const { call } = await setup({ chain: false });
  assert.equal((await call('GET', '/api/public/entry?entryKey=42')).status, 501);
});

test('only the worker the entry belongs to can issue a disclosure receipt, and it is audited', async () => {
  const { call, db, commitment } = await setup();
  const issued = await call('POST', '/api/disclosures', { entryKey: '42' }, 'worker-1');
  assert.equal(issued.status, 200);
  assert.deepEqual(
    { ...issued.body, issuedAt: typeof issued.body.issuedAt },
    {
      v: 1,
      entryKey: '42',
      scoreCenti: 7200,
      nonceHex: NONCE,
      scoreCommitmentHex: commitment,
      periodDate: '2026-10-02',
      issuedAt: 'string',
    },
  );
  const audit = await db.all<{ action: string; target_id: string }>('SELECT action, target_id FROM audit_log');
  assert.deepEqual(audit.map((a) => ({ ...a })), [{ action: 'disclosure.issue', target_id: '42' }]);

  assert.equal((await call('POST', '/api/disclosures', { entryKey: '42' }, 'admin')).status, 403);
  assert.equal((await call('POST', '/api/disclosures', { entryKey: '42' }, 'worker-2')).status, 404);
  assert.equal((await call('POST', '/api/disclosures', { entryKey: '42' })).status, 401);
  assert.equal((await call('POST', '/api/disclosures', { entryKey: 'x' }, 'worker-1')).status, 400);
});

test('a receipt cannot be issued without a stored opening or an opening key', async () => {
  const noOpening = await setup({ opening: false });
  const r = await noOpening.call('POST', '/api/disclosures', { entryKey: '42' }, 'worker-1');
  assert.deepEqual([r.status, r.body.code], [409, 'no_opening']);
  const noKey = await setup({ key: null });
  assert.equal((await noKey.call('POST', '/api/disclosures', { entryKey: '42' }, 'worker-1')).status, 501);
});

test('a receipt matches the on-chain commitment only when its value and nonce are the real ones', async () => {
  const { call } = await setup();
  const receipt = (await call('POST', '/api/disclosures', { entryKey: '42' }, 'worker-1')).body;
  const ok = await call('POST', '/api/public/receipt', { receipt });
  assert.deepEqual([ok.status, ok.body.matches, ok.body.value, ok.body.entry.band], [200, true, 72, 'normal']);

  const forged = await call('POST', '/api/public/receipt', { receipt: { ...receipt, scoreCenti: 3000 } });
  assert.deepEqual([forged.body.matches, forged.body.value], [false, undefined]);
  const otherNonce = await call('POST', '/api/public/receipt', { receipt: { ...receipt, nonceHex: '22'.repeat(32) } });
  assert.equal(otherNonce.body.matches, false);
  assert.equal((await call('POST', '/api/public/receipt', { receipt: { v: 1 } })).status, 400);
  assert.equal((await call('POST', '/api/public/receipt', { receipt: { ...receipt, entryKey: '43' } })).status, 404);
});

test('a chain that cannot be read gives 503, not a crash', async () => {
  const { call, deps } = await setup();
  deps.chain = { readEntries: async () => { throw new Error('Durable Object reset'); } };
  const r = await call('GET', '/api/public/entry?entryKey=42');
  assert.deepEqual([r.status, r.body.code], [503, 'chain_unavailable']);
  const receipt = { v: 1, entryKey: '42', scoreCenti: 7200, nonceHex: NONCE, scoreCommitmentHex: 'ab'.repeat(32), periodDate: '2026-10-02', issuedAt: '2026-10-02T00:00:00Z' };
  assert.equal((await call('POST', '/api/public/receipt', { receipt })).status, 503);
});
