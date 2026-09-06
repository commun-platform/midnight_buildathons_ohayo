import { hexToBytes } from '@midnight-demo/shared';
import type { WitnessContext } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';

export type ConditionPrivateEntry = {
  entryKey: string;
  scoreCenti: number;
  nonceHex: string;
};

export type ConditionPrivateState = {
  entries: ConditionPrivateEntry[];
};

export const CONDITION_PRIVATE_STATE_ID = 'conditionPrivateState';

export function createConditionPrivateState(
  entries: ConditionPrivateEntry[] = [],
): ConditionPrivateState {
  return { entries };
}

function findEntry(state: ConditionPrivateState, entryKey: bigint): ConditionPrivateEntry {
  const entry = state.entries.find((candidate) => candidate.entryKey === entryKey.toString());
  if (!entry) throw new Error(`Private condition entry not found for key ${entryKey}`);
  return entry;
}

export const witnesses = {
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
