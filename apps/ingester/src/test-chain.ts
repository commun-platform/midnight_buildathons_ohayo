import {
  planSubmissions,
  type ConditionChain,
  type ReadingOutcome,
  type SkipReason,
} from '@midnight-demo/ingester-core';

export type Ledger = Awaited<ReturnType<ConditionChain['readEntries']>>;

export function fakeChain(options: { fail?: string } = {}): ConditionChain & { ledger: Ledger; calls: number } {
  const ledger: Ledger = new Map();
  const chain = {
    ledger,
    calls: 0,
    async submitReadings(request: Parameters<ConditionChain['submitReadings']>[0]) {
      chain.calls += 1;
      const seen = new Set(request.submittedEntryKeys);
      const outcomes: ReadingOutcome[] = [];
      for (const reading of request.readings) {
        const plan = await planSubmissions({
          conditions: [reading],
          roster: request.roster,
          salt: request.salt,
          submittedEntryKeys: seen,
        });
        const planned = plan.planned[0];
        if (!planned) {
          outcomes.push({ status: 'skipped', reason: plan.skipped[0] as SkipReason });
          continue;
        }
        seen.add(planned.entryKey);
        if (options.fail) {
          outcomes.push({ status: 'failed', error: options.fail });
          continue;
        }
        const existing = ledger.get(planned.entryKey);
        if (existing) {
          outcomes.push({
            status: 'submitted',
            submission: { ...planned, band: existing.band, scoreCommitmentHex: existing.scoreCommitmentHex },
            tx: { txId: 'backfilled', txHash: null, blockHeight: 'unknown' },
            recovered: true,
          });
          continue;
        }
        ledger.set(planned.entryKey, {
          band: planned.band,
          periodStartMs: planned.periodStartMs,
          recordedAtMs: planned.recordedAtMs,
          scoreCommitmentHex: planned.scoreCommitmentHex,
          verified: true,
        });
        outcomes.push({
          status: 'submitted',
          submission: planned,
          tx: { txId: `tx-${ledger.size}`, txHash: `hash-${ledger.size}`, blockHeight: String(ledger.size) },
          recovered: false,
        });
      }
      return outcomes;
    },
    async readEntries(entryKeys: readonly string[]) {
      const found: Ledger = new Map();
      for (const key of entryKeys) {
        const entry = ledger.get(key);
        if (entry) found.set(key, entry);
      }
      return found;
    },
  };
  return chain;
}
