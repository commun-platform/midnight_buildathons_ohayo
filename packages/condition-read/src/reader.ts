import type { SqlDatabase } from '@midnight-demo/db';
import type { ConditionBand } from '@midnight-demo/shared';

export interface OnChainEntry {
  band: ConditionBand;
  periodStartMs: number;
  recordedAtMs: number;
  scoreCommitmentHex: string;
  verified: boolean;
  txId?: string | null;
}

export interface ConditionReader {
  read(entryKey: bigint): Promise<OnChainEntry | null>;
}

export function fakeReader(entries: Map<string, OnChainEntry>): ConditionReader {
  return {
    async read(entryKey: bigint) {
      return entries.get(entryKey.toString()) ?? null;
    },
  };
}

export function dbConditionReader(db: SqlDatabase): ConditionReader {
  return {
    async read(entryKey: bigint) {
      const row = await db.first<{
        band: string;
        recorded_at_ms: number;
        period_start_ms: number;
        score_commitment_hex: string;
        chain_verified_at: string | null;
        tx_id: string | null;
      }>(
        `SELECT band, recorded_at_ms, period_start_ms, score_commitment_hex, chain_verified_at, tx_id
           FROM submissions WHERE entry_key = ?`,
        [entryKey.toString()],
      );
      if (!row) return null;
      return {
        band: row.band as ConditionBand,
        periodStartMs: Number(row.period_start_ms),
        recordedAtMs: Number(row.recorded_at_ms),
        scoreCommitmentHex: row.score_commitment_hex,
        verified: row.chain_verified_at != null,
        txId: row.tx_id,
      };
    },
  };
}
