import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  applyMigrations,
  createDatabase,
  loadConditionMigrations,
  loadSampleRoster,
  runSqlScript,
  type SqlDatabase,
} from '@midnight-demo/db';
import { conditionEntryKey } from '@midnight-demo/shared';

import { conditionHistory, fakeReader, type OnChainEntry } from './index.js';

const SALT = new Uint8Array(16).fill(0x5a);
const AUG16_JST = Date.parse('2026-08-16T00:00:00+09:00');
const AUG17_JST = Date.parse('2026-08-17T00:00:00+09:00');

async function seededDb(): Promise<SqlDatabase> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'read-hist-')), 'test.db');
  const db = createDatabase({ url: `file:${file}` });
  await applyMigrations(db, loadConditionMigrations());
  await runSqlScript(db, loadSampleRoster());
  return db;
}

function onChain(overrides: Partial<OnChainEntry> = {}): OnChainEntry {
  return {
    band: 'normal',
    periodStartMs: AUG16_JST,
    recordedAtMs: Date.parse('2026-08-15T22:10:00.000Z'),
    scoreCommitmentHex: 'ab'.repeat(32),
    verified: true,
    ...overrides,
  };
}

test('assembles per-ring history, joins names, omits days with no on-chain entry', async () => {
  const db = await seededDb();
  const keyA = await conditionEntryKey('ring-1', AUG16_JST, SALT);
  const keyB = await conditionEntryKey('ring-2', AUG17_JST, SALT);

  const reader = fakeReader(
    new Map([
      [keyA.toString(), onChain({ band: 'caution' })],
      [keyB.toString(), onChain({ band: 'danger', periodStartMs: AUG17_JST })],
    ]),
  );

  const history = await conditionHistory(db, reader, {
    ringIds: ['ring-1', 'ring-2'],
    fromMs: Date.parse('2026-08-15T00:00:00+09:00'),
    toMs: Date.parse('2026-08-18T00:00:00+09:00'),
    salt: SALT,
  });

  const a = history.find((h) => h.ringId === 'ring-1');
  assert.ok(a);
  assert.equal(a.workerId, 'worker-1');
  assert.equal(a.workerName, '作業員 一郎');
  assert.equal(a.entries.length, 1);
  assert.equal(a.entries[0]?.band, 'caution');
  assert.equal(a.entries[0]?.periodStartMs, AUG16_JST);
  assert.equal(a.entries[0]?.entryKey, keyA.toString());

  const b = history.find((h) => h.ringId === 'ring-2');
  assert.equal(b?.entries.length, 1);
  assert.equal(b?.entries[0]?.band, 'danger');
});

test('empty scope yields empty history; unknown ring is skipped', async () => {
  const db = await seededDb();
  const reader = fakeReader(new Map());
  assert.deepEqual(
    await conditionHistory(db, reader, {
      ringIds: [],
      fromMs: 0,
      toMs: Date.now(),
      salt: SALT,
    }),
    [],
  );
  assert.deepEqual(
    await conditionHistory(db, reader, {
      ringIds: ['ring-unknown'],
      fromMs: AUG16_JST,
      toMs: AUG17_JST,
      salt: SALT,
    }),
    [],
  );
});
