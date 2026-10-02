import type { SqlDatabase } from '@midnight-demo/db';
import type { ConditionChain } from '@midnight-demo/ingester-core';
import { classifyCondition } from '@midnight-demo/shared';

export interface ReconcileResult {
  confirmed: number;
  mismatches: Array<{ entryKey: string; dbBand: string; chainBand: string }>;
  valueMismatches: Array<{ entryKey: string; value: number; valueBand: string; chainBand: string }>;
  missing: string[];
}

export interface ReconcileOptions {
  entryKeys?: readonly string[];
}

interface ReconcileRow {
  entry_key: string;
  band: string;
  ring_id: string;
  recorded_at_ms: number;
  reconciled_at: string | null;
}

async function feedValueIndex(
  db: SqlDatabase,
  rings: readonly string[],
): Promise<Map<string, number>> {
  const index = new Map<string, number>();
  if (rings.length === 0) return index;
  const rows = await db.all<{ ring_id: string; recorded_at: string; value: number }>(
    `SELECT ring_id, recorded_at, value FROM condition_readings
      WHERE ring_id IN (${rings.map(() => '?').join(', ')})`,
    [...rings],
  );
  for (const row of rows) {
    const ms = Date.parse(row.recorded_at);
    if (Number.isFinite(ms)) index.set(`${row.ring_id}|${ms}`, row.value);
  }
  return index;
}

export async function reconcileSubmissions(
  db: SqlDatabase,
  chain: Pick<ConditionChain, 'readEntries'>,
  opts: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const cols = `entry_key, band, ring_id, recorded_at_ms, reconciled_at`;
  const rows = opts.entryKeys?.length
    ? await db.all<ReconcileRow>(
        `SELECT ${cols} FROM submissions WHERE entry_key IN (${opts.entryKeys.map(() => '?').join(', ')})`,
        [...opts.entryKeys],
      )
    : await db.all<ReconcileRow>(
        `SELECT ${cols} FROM submissions WHERE chain_verified_at IS NULL`,
      );

  const feedValues = await feedValueIndex(db, [...new Set(rows.map((r) => r.ring_id))]);
  const now = new Date().toISOString();
  const result: ReconcileResult = {
    confirmed: 0,
    mismatches: [],
    valueMismatches: [],
    missing: [],
  };

  const chainKeys = rows.map((row) => row.entry_key);
  const onChainEntries: Awaited<ReturnType<ConditionChain['readEntries']>> = chainKeys.length
    ? await chain.readEntries(chainKeys)
    : new Map();

  for (const row of rows) {
    const onChain = onChainEntries.get(row.entry_key);
    if (!onChain) {
      result.missing.push(row.entry_key);
      continue;
    }

    const value = feedValues.get(`${row.ring_id}|${Number(row.recorded_at_ms)}`);
    const valueBand = value === undefined ? null : classifyCondition(value);
    const bandMismatch = onChain.band !== row.band;
    const valueMismatch = valueBand !== null && valueBand !== onChain.band;
    if (bandMismatch) {
      result.mismatches.push({ entryKey: row.entry_key, dbBand: row.band, chainBand: onChain.band });
    }
    if (valueMismatch) {
      result.valueMismatches.push({
        entryKey: row.entry_key,
        value: value as number,
        valueBand: valueBand as string,
        chainBand: onChain.band,
      });
    }

    const ok = !bandMismatch && !valueMismatch;
    await db.execute(
      'UPDATE submissions SET band = ?, chain_verified_at = ?, reconciled_at = ? WHERE entry_key = ?',
      [onChain.band, ok ? now : null, now, row.entry_key],
    );
    if (ok) result.confirmed += 1;
  }

  return result;
}
