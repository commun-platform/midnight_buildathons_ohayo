import type { SqlDatabase, SqlStatement } from '@midnight-demo/db';
import type {
  ConditionRecord,
  PlannedSubmission,
  Ring,
  SubmissionRecord,
  TransactionSummary,
} from '@midnight-demo/ingester-core';
import { APP_TIME_ZONE, type ConditionBand } from '@midnight-demo/shared';

export async function loadRoster(db: SqlDatabase): Promise<Ring[]> {
  const rows = await db.all<{ ring_id: string }>('SELECT id AS ring_id FROM rings');
  return rows.map((row) => ({ ringId: row.ring_id, timezone: APP_TIME_ZONE }));
}

export async function loadConditionFeed(db: SqlDatabase): Promise<ConditionRecord[]> {
  const rows = await db.all<{ ring_id: string; recorded_at: string; value: number }>(
    'SELECT ring_id, recorded_at, value FROM condition_readings ORDER BY id',
  );
  return rows.map((row) => ({
    ringId: row.ring_id,
    recordedAt: row.recorded_at,
    value: row.value,
  }));
}

export async function submittedEntryKeys(db: SqlDatabase): Promise<Set<string>> {
  const rows = await db.all<{ entry_key: string }>('SELECT entry_key FROM submissions');
  return new Set(rows.map((row) => row.entry_key));
}

const INSERT_SUBMISSION = `INSERT OR IGNORE INTO submissions (
  entry_key, ring_id, period_start_ms, timezone, recorded_at_ms,
  band, score_commitment_hex, tx_id, tx_hash, block_height, submitted_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

export function submissionInserts(records: readonly SubmissionRecord[]): SqlStatement[] {
  return records.map((record) => ({
    sql: INSERT_SUBMISSION,
    parameters: [
      record.entryKey,
      record.ringId,
      record.periodStartMs,
      record.timezone,
      record.recordedAtMs,
      record.band,
      record.scoreCommitmentHex,
      record.txId ?? null,
      record.txHash ?? null,
      record.blockHeight ?? null,
      record.submittedAt,
    ],
  }));
}

export async function recordSubmissions(
  db: SqlDatabase,
  records: readonly SubmissionRecord[],
): Promise<void> {
  if (records.length === 0) return;
  await db.batch(submissionInserts(records));
}

export function submissionRecord(
  submission: PlannedSubmission,
  tx: TransactionSummary,
  storedBand: ConditionBand,
  submittedAt: string,
): SubmissionRecord {
  return {
    entryKey: submission.entryKey,
    ringId: submission.ringId,
    timezone: submission.timezone,
    periodStartMs: submission.periodStartMs,
    recordedAtMs: submission.recordedAtMs,
    band: storedBand,
    scoreCommitmentHex: submission.scoreCommitmentHex,
    txId: tx.txId,
    txHash: tx.txHash,
    blockHeight: tx.blockHeight,
    submittedAt,
  };
}
