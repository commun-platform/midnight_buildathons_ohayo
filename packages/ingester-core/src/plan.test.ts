import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyCondition } from '@midnight-demo/shared';

import { planSubmissions, type Ring } from './index.js';

const SALT = new Uint8Array(16).fill(0x5a);
const fixedNonce = () => new Uint8Array(32).fill(1);

const roster: Ring[] = [
  { ringId: 'ring-a', timezone: 'Asia/Tokyo' },
  { ringId: 'ring-b', timezone: 'Asia/Tokyo' },
];

function plan(
  conditions: Array<{ ringId: string; recordedAt: string; value: number }>,
  submitted: Iterable<string> = [],
) {
  return planSubmissions({
    conditions,
    roster,
    salt: SALT,
    submittedEntryKeys: new Set(submitted),
    nonce: fixedNonce,
  });
}

test('plans one submission per known ring with the band and score channels set', async () => {
  const { planned, skipped } = await plan([
    { ringId: 'ring-a', recordedAt: '2026-08-15T22:10:00.000Z', value: 75 },
    { ringId: 'ring-b', recordedAt: '2026-08-15T21:40:00.000Z', value: 28.5 },
  ]);

  assert.equal(skipped.length, 0);
  assert.equal(planned.length, 2);

  const a = planned.find((p) => p.ringId === 'ring-a');
  assert.ok(a);
  assert.equal(a.scoreCenti, 7500);
  assert.equal(a.band, 'normal');
  assert.equal(a.band, classifyCondition(75));
  assert.equal(a.periodStartMs, Date.parse('2026-08-16T00:00:00+09:00'));
  assert.equal(a.scoreCommitmentHex.length, 64);
  assert.match(a.entryKey, /^\d+$/);

  const b = planned.find((p) => p.ringId === 'ring-b');
  assert.equal(b?.band, 'danger');
});

test('skips an unknown ring', async () => {
  const { planned, skipped } = await plan([
    { ringId: 'ring-x', recordedAt: '2026-08-15T22:10:00.000Z', value: 70 },
  ]);
  assert.equal(planned.length, 0);
  assert.deepEqual(skipped, [
    { kind: 'unknown-ring', ringId: 'ring-x', recordedAt: '2026-08-15T22:10:00.000Z' },
  ]);
});

test('skips out-of-range and non-numeric values', async () => {
  const { planned, skipped } = await plan([
    { ringId: 'ring-a', recordedAt: '2026-08-15T22:10:00.000Z', value: 150 },
    { ringId: 'ring-a', recordedAt: '2026-08-15T22:11:00.000Z', value: Number.NaN },
  ]);
  assert.equal(planned.length, 0);
  assert.equal(skipped.length, 2);
  assert.ok(skipped.every((s) => s.kind === 'invalid-value'));
});

test('de-duplicates two readings for the same ring on the same local day', async () => {
  const { planned, skipped } = await plan([
    { ringId: 'ring-a', recordedAt: '2026-08-15T21:00:00.000Z', value: 61 },
    { ringId: 'ring-a', recordedAt: '2026-08-15T23:30:00.000Z', value: 44 },
  ]);
  assert.equal(planned.length, 1);
  assert.equal(planned[0]?.value, 61);
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0]?.kind, 'already-submitted');
});

test('idempotency: a ring/day already in the ledger is skipped', async () => {
  const first = await plan([
    { ringId: 'ring-a', recordedAt: '2026-08-15T22:10:00.000Z', value: 75 },
  ]);
  const entryKey = first.planned[0]!.entryKey;

  const rerun = await plan(
    [{ ringId: 'ring-a', recordedAt: '2026-08-15T22:10:00.000Z', value: 75 }],
    [entryKey],
  );
  assert.equal(rerun.planned.length, 0);
  assert.equal(rerun.skipped[0]?.kind, 'already-submitted');
});

test('the same ring on the next local day is a distinct entry', async () => {
  const { planned } = await plan([
    { ringId: 'ring-a', recordedAt: '2026-08-15T22:10:00.000Z', value: 70 },
    { ringId: 'ring-a', recordedAt: '2026-08-16T22:10:00.000Z', value: 55 },
  ]);
  assert.equal(planned.length, 2);
  assert.notEqual(planned[0]?.entryKey, planned[1]?.entryKey);
});
