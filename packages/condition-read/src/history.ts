import type { SqlDatabase } from '@midnight-demo/db';
import {
  APP_TIME_ZONE,
  conditionEntryKey,
  zonedDayStartMs,
  type ConditionBand,
} from '@midnight-demo/shared';

import type { ConditionReader } from './reader.js';

export interface DayEntry {
  periodStartMs: number;
  entryKey: string;
  band: ConditionBand;
  recordedAtMs: number;
  scoreCommitmentHex: string;
  verified: boolean;
  txId?: string | null;
  value?: number;
}

export interface RingHistory {
  ringId: string;
  timezone: string;
  workerId: string | null;
  workerName: string | null;
  entries: DayEntry[];
}

export interface HistoryQuery {
  ringIds: readonly string[];
  fromMs: number;
  toMs: number;
  salt: Uint8Array;
}

interface RingMeta {
  workerId: string | null;
  workerName: string | null;
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ');
}

async function ringMeta(db: SqlDatabase, ringIds: readonly string[]): Promise<Map<string, RingMeta>> {
  if (ringIds.length === 0) return new Map();
  const rows = await db.all<{
    ring_id: string;
    worker_id: string | null;
    worker_name: string | null;
  }>(
    `SELECT r.id AS ring_id, w.id AS worker_id, wp.name AS worker_name
       FROM rings r
       LEFT JOIN ring_worker_map m ON m.ring_id = r.id AND m.to_ts IS NULL
       LEFT JOIN workers w ON w.id = m.worker_id
       LEFT JOIN worker_pii wp ON wp.worker_id = w.id
      WHERE r.id IN (${placeholders(ringIds.length)})`,
    [...ringIds],
  );
  return new Map(
    rows.map((row) => [row.ring_id, { workerId: row.worker_id, workerName: row.worker_name }]),
  );
}

function dayStarts(fromMs: number, toMs: number, timeZone: string): number[] {
  const out: number[] = [];
  let day = zonedDayStartMs(fromMs, timeZone);
  for (let i = 0; i < 400 && day <= toMs; i += 1) {
    out.push(day);
    day = zonedDayStartMs(day + 25 * 3_600_000, timeZone);
  }
  return out;
}

export async function conditionHistory(
  db: SqlDatabase,
  reader: ConditionReader,
  query: HistoryQuery,
): Promise<RingHistory[]> {
  const meta = await ringMeta(db, query.ringIds);
  const result: RingHistory[] = [];

  for (const ringId of query.ringIds) {
    const info = meta.get(ringId);
    if (!info) continue;

    const entries: DayEntry[] = [];
    for (const periodStartMs of dayStarts(query.fromMs, query.toMs, APP_TIME_ZONE)) {
      const entryKey = await conditionEntryKey(ringId, periodStartMs, query.salt);
      const onChain = await reader.read(entryKey);
      if (!onChain) continue;
      entries.push({
        periodStartMs,
        entryKey: entryKey.toString(),
        band: onChain.band,
        recordedAtMs: onChain.recordedAtMs,
        scoreCommitmentHex: onChain.scoreCommitmentHex,
        verified: onChain.verified,
        txId: onChain.txId ?? null,
      });
    }

    result.push({
      ringId,
      timezone: APP_TIME_ZONE,
      workerId: info.workerId,
      workerName: info.workerName,
      entries,
    });
  }

  return result;
}
