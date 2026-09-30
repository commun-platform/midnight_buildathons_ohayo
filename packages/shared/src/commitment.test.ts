import assert from 'node:assert/strict';
import test from 'node:test';

import { conditionScoreCommitment } from './commitment.js';

test('scoreCommitment needs a 32-byte nonce and is deterministic', () => {
  const nonce = new Uint8Array(32).fill(3);
  const c1 = conditionScoreCommitment(7350, nonce);
  const c2 = conditionScoreCommitment(7350, nonce);
  assert.equal(Buffer.from(c1).toString('hex'), Buffer.from(c2).toString('hex'));
  assert.equal(c1.length, 32);
  assert.throws(() => conditionScoreCommitment(7350, new Uint8Array(16)), /32 bytes/);
});
