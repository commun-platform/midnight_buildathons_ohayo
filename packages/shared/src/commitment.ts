import { CompactTypeUnsignedInteger, persistentCommit } from '@midnight-ntwrk/compact-runtime';

const scoreCentiType = new CompactTypeUnsignedInteger((1n << 32n) - 1n, 4);

export function conditionScoreCommitment(scoreCenti: number, nonce: Uint8Array): Uint8Array {
  if (nonce.length !== 32) throw new Error('Condition score nonce must be 32 bytes');
  return persistentCommit(scoreCentiType, BigInt(scoreCenti), nonce);
}
