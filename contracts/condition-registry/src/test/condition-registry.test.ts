import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CostModel,
  QueryContext,
  createConstructorContext,
  sampleContractAddress,
  type CircuitContext,
} from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import {
  classifyConditionCenti,
  conditionEntryKey,
  conditionScoreCommitment,
  CONDITION_BAND_ORDINAL,
  CONDITION_CAUTION_MIN_CENTI,
  CONDITION_DAY_WINDOW_MS,
  CONDITION_NORMAL_MIN_CENTI,
  type ConditionBand,
} from '@midnight-demo/shared';
import { describe, expect, it } from 'vitest';

import {
  Contract,
  ledger,
  ConditionBand as ContractConditionBand,
  type Ledger,
} from '../managed/condition-registry/contract/index.js';
import {
  createConditionPrivateState,
  witnesses,
  type ConditionPrivateEntry,
  type ConditionPrivateState,
} from '../witnesses.js';

const SALT = new Uint8Array(16).fill(0x5a);
const DAY_START_MS = Date.parse('2026-08-15T00:00:00.000+09:00');

class ConditionRegistrySimulator {
  readonly contract: Contract<ConditionPrivateState>;
  context: CircuitContext<ConditionPrivateState>;

  constructor(privateEntries: ConditionPrivateEntry[]) {
    this.contract = new Contract<ConditionPrivateState>(witnesses);
    const initial = this.contract.initialState(
      createConstructorContext(createConditionPrivateState(privateEntries), '0'.repeat(64)),
    );
    this.context = {
      currentPrivateState: initial.currentPrivateState,
      currentZswapLocalState: initial.currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(
        initial.currentContractState.data,
        sampleContractAddress(),
      ),
    };
  }

  submit(s: Submission): Ledger {
    this.context = this.contract.impureCircuits.submitCondition(
      this.context,
      s.entryKey,
      s.periodStartMs,
      s.recordedAt,
      s.scoreCommitment,
    ).context;
    return ledger(this.context.currentQueryContext.state);
  }
}

interface Submission {
  entryKey: bigint;
  periodStartMs: bigint;
  recordedAt: bigint;
  scoreCommitment: Uint8Array;
  privateEntry: ConditionPrivateEntry;
}

async function buildSubmission(options: {
  ring?: string;
  periodStartMs?: number;
  recordedAt?: number;
  value: number;
  commitValue?: number;
  nonceFill?: number;
}): Promise<Submission> {
  const ring = options.ring ?? 'ring-test-1';
  const periodStartMs = options.periodStartMs ?? DAY_START_MS;
  const recordedAt = options.recordedAt ?? periodStartMs + 23 * 3_600_000;
  const scoreCenti = Math.round(options.value * 100);
  const commitCenti = Math.round((options.commitValue ?? options.value) * 100);
  const nonce = new Uint8Array(32).fill(options.nonceFill ?? 1);
  const entryKey = await conditionEntryKey(ring, periodStartMs, SALT);
  return {
    entryKey,
    periodStartMs: BigInt(periodStartMs),
    recordedAt: BigInt(recordedAt),
    scoreCommitment: conditionScoreCommitment(commitCenti, nonce),
    privateEntry: {
      entryKey: entryKey.toString(),
      scoreCenti,
      nonceHex: Buffer.from(nonce).toString('hex'),
    },
  };
}

describe('condition-registry submitCondition', () => {
  const bandCases: Array<[ConditionBand, number]> = [
    ['normal', 90],
    ['caution', 50],
    ['danger', 20],
  ];

  for (const [band, value] of bandCases) {
    it(`records a ${value}-point value as ${band}`, async () => {
      const s = await buildSubmission({ value, ring: `ring-${band}` });
      const sim = new ConditionRegistrySimulator([s.privateEntry]);
      const state = sim.submit(s);

      const entry = state.entries.lookup(s.entryKey);
      expect(entry.verified).toBe(true);
      expect(entry.band).toBe(ContractConditionBand[band]);
      expect(entry.band).toBe(CONDITION_BAND_ORDINAL[band]);
      expect(entry.periodStartMs).toBe(s.periodStartMs);
      expect(entry.recordedAt).toBe(s.recordedAt);
      expect(state.submissionCount).toBe(1n);
      expect(state.lastSubmittedBand).toBe(CONDITION_BAND_ORDINAL[band]);
      expect(classifyConditionCenti(Math.round(value * 100))).toBe(band);
    });
  }

  it('classifies the band boundaries at 60 and 40', async () => {
    for (const [value, band] of [
      [60, 'normal'],
      [59, 'caution'],
      [40, 'caution'],
      [39, 'danger'],
    ] as Array<[number, ConditionBand]>) {
      const s = await buildSubmission({ value, ring: `ring-b${value}` });
      const sim = new ConditionRegistrySimulator([s.privateEntry]);
      const state = sim.submit(s);
      expect(state.entries.lookup(s.entryKey).band).toBe(CONDITION_BAND_ORDINAL[band]);
    }
  });

  it('rejects a second submission for the same entryKey', async () => {
    const s = await buildSubmission({ value: 72 });
    const sim = new ConditionRegistrySimulator([s.privateEntry]);
    sim.submit(s);
    expect(() => sim.submit(s)).toThrow('entry already submitted');
  });

  it('rejects a score commitment that does not match the private value', async () => {
    const s = await buildSubmission({ value: 80, commitValue: 30 });
    const sim = new ConditionRegistrySimulator([s.privateEntry]);
    expect(() => sim.submit(s)).toThrow('score commitment mismatch');
  });

  it('rejects a recordedAt before the period day', async () => {
    const s = await buildSubmission({ value: 65, recordedAt: DAY_START_MS - 1 });
    const sim = new ConditionRegistrySimulator([s.privateEntry]);
    expect(() => sim.submit(s)).toThrow('recordedAt is before the period day');
  });

  it('rejects a recordedAt past the 30h window', async () => {
    const s = await buildSubmission({
      value: 65,
      recordedAt: DAY_START_MS + CONDITION_DAY_WINDOW_MS,
    });
    const sim = new ConditionRegistrySimulator([s.privateEntry]);
    expect(() => sim.submit(s)).toThrow('recordedAt is after the period-day window');
  });
});

describe('condition-registry constants stay in step with the circuit', () => {
  it('the compact source uses the same centi thresholds as the shared module', () => {
    const source = fs.readFileSync(
      fileURLToPath(new URL('../condition-registry.compact', import.meta.url)),
      'utf8',
    );
    expect(source).toContain(`>= ${CONDITION_NORMAL_MIN_CENTI}`);
    expect(source).toContain(`>= ${CONDITION_CAUTION_MIN_CENTI}`);
    expect(source).toContain(`${CONDITION_DAY_WINDOW_MS}`);
  });

  it('the ConditionBand enum ordinals match', () => {
    expect(ContractConditionBand.danger).toBe(CONDITION_BAND_ORDINAL.danger);
    expect(ContractConditionBand.caution).toBe(CONDITION_BAND_ORDINAL.caution);
    expect(ContractConditionBand.normal).toBe(CONDITION_BAND_ORDINAL.normal);
    expect(ContractConditionBand.unclassified).toBe(0);
  });
});
