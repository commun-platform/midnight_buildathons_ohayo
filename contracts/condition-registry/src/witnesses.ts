import { hexToBytes } from '@midnight-demo/shared';
import type { WitnessContext } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';

export type ConditionPrivateEntry = {
  entryKey: string;
  scoreCenti: number;
  nonceHex: string;
};

export type ConditionPrivateState = {
  submitterSecretKeyHex: string;
  entries: ConditionPrivateEntry[];
};

export const CONDITION_PRIVATE_STATE_ID = 'conditionPrivateState';

export function createConditionPrivateState(
  submitterSecretKeyHex: string,
  entries: ConditionPrivateEntry[] = [],
): ConditionPrivateState {
  if (!/^(?:[0-9a-fA-F]{2}){32}$/.test(submitterSecretKeyHex)) {
    throw new Error('submitterSecretKeyHex must be 32 bytes of hex');
  }
  return { submitterSecretKeyHex, entries };
}

function findEntry(state: ConditionPrivateState, entryKey: bigint): ConditionPrivateEntry {
  const entry = state.entries.find((candidate) => candidate.entryKey === entryKey.toString());
  if (!entry) throw new Error(`Private condition entry not found for key ${entryKey}`);
  return entry;
}

export const witnesses = {
  submitterSecretKey({
    privateState,
  }: WitnessContext<unknown, ConditionPrivateState>): [ConditionPrivateState, Uint8Array] {
    const key = hexToBytes(privateState.submitterSecretKeyHex ?? '');
    if (key.length !== 32) {
      throw new Error('Private state holds no 32-byte submitter key — redeploy or restore it');
    }
    return [privateState, key];
  },
  privateScoreCenti(
    { privateState }: WitnessContext<unknown, ConditionPrivateState>,
    entryKey: bigint,
  ): [ConditionPrivateState, bigint] {
    return [privateState, BigInt(findEntry(privateState, entryKey).scoreCenti)];
  },
  privateScoreNonce(
    { privateState }: WitnessContext<unknown, ConditionPrivateState>,
    entryKey: bigint,
  ): [ConditionPrivateState, Uint8Array] {
    return [privateState, hexToBytes(findEntry(privateState, entryKey).nonceHex)];
  },
};
