import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyCondition,
  classifyConditionCenti,
  conditionBandFromOrdinal,
  conditionEntryKey,
  conditionScoreCenti,
  conditionScoreCommitment,
  CONDITION_BAND_ORDINAL,
} from './index.js';

test('classification thresholds are 60 and 40', () => {
  assert.equal(classifyCondition(60), 'normal');
  assert.equal(classifyCondition(59), 'caution');
  assert.equal(classifyCondition(40), 'caution');
  assert.equal(classifyCondition(39), 'danger');
});

test('centi classification matches the whole-point classification', () => {
  for (const value of [0, 39.4, 40, 59.9, 60, 73.5, 100]) {
    assert.equal(classifyConditionCenti(conditionScoreCenti(value)), classifyCondition(value));
  }
  assert.equal(conditionScoreCenti(73.5), 7350);
});

test('band ordinals match the condition-registry ConditionBand enum', () => {
  assert.deepEqual(CONDITION_BAND_ORDINAL, { danger: 1, caution: 2, normal: 3 });
  assert.equal(conditionBandFromOrdinal(0), 'unclassified');
  assert.equal(conditionBandFromOrdinal(1), 'danger');
  assert.equal(conditionBandFromOrdinal(2), 'caution');
  assert.equal(conditionBandFromOrdinal(3), 'normal');
  assert.equal(conditionBandFromOrdinal(99), 'unclassified');
});

test('conditionScoreCenti rejects out-of-range values', () => {
  assert.throws(() => conditionScoreCenti(-1), /0\.\.100/);
  assert.throws(() => conditionScoreCenti(101), /0\.\.100/);
});

test('entryKey is deterministic, salt-dependent, and a valid field element', async () => {
  const salt = new Uint8Array(16).fill(7);
  const a = await conditionEntryKey('ring-0042', 1_755_183_600, salt);
  const again = await conditionEntryKey('ring-0042', 1_755_183_600, salt);
  const otherDay = await conditionEntryKey('ring-0042', 1_755_270_000, salt);
  const otherSalt = await conditionEntryKey('ring-0042', 1_755_183_600, new Uint8Array(16).fill(9));

  assert.equal(a, again);
  assert.notEqual(a, otherDay);
  assert.notEqual(a, otherSalt);
  assert.ok(a < 1n << 248n);
});

test('scoreCommitment needs a 32-byte nonce and is deterministic', () => {
  const nonce = new Uint8Array(32).fill(3);
  const c1 = conditionScoreCommitment(7350, nonce);
  const c2 = conditionScoreCommitment(7350, nonce);
  assert.equal(Buffer.from(c1).toString('hex'), Buffer.from(c2).toString('hex'));
  assert.equal(c1.length, 32);
  assert.throws(() => conditionScoreCommitment(7350, new Uint8Array(16)), /32 bytes/);
});
