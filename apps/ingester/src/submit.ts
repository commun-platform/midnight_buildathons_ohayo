import type { SqlDatabase } from '@midnight-demo/db';
import type { ConditionChain, ReadingOutcome, SkipReason } from '@midnight-demo/ingester-core';
import { classifyCondition, type ConditionBand } from '@midnight-demo/shared';

import { reconcileSubmissions } from './reconcile.js';
import { loadRoster, submissionInserts, submissionRecord, submittedEntryKeys } from './store.js';

export interface SubmitQueueOptions {
  tamper?: boolean;
  ringIds?: readonly string[];
  limit?: number;
  submittedBy?: string;
}

export interface SubmittedStagedFeed {
  submitted: number;
  skipped: number;
  failed: number;
  tampered: number;
  reconcile:
    | { confirmed: number; mismatches: number; valueMismatches: number; missing: number }
    | null;
}

export interface QueuedReading {
  id: number;
  ringId: string;
  recordedAt: string;
  value: number;
}

export interface RecordedOutcomes {
  submitted: string[];
  skipped: number;
  failed: number;
  tampered: number;
}

const SKIP_REASON: Record<SkipReason['kind'], string> = {
  'already-submitted': 'already_submitted',
  'unknown-ring': 'unknown_ring',
  'invalid-value': 'invalid_value',
};

function wrongBand(band: ConditionBand): ConditionBand {
  return band === 'normal' ? 'danger' : 'normal';
}

function bandSampleValue(band: ConditionBand): number {
  return band === 'normal' ? 75 : band === 'caution' ? 50 : 25;
}

export function crossBandValue(value: number): number {
  return bandSampleValue(wrongBand(classifyCondition(value)));
}

export async function queuedReadings(
  db: SqlDatabase,
  ringIds?: readonly string[],
): Promise<QueuedReading[]> {
  if (ringIds && ringIds.length === 0) return [];
  const rows = await db.all<{ id: number; ring_id: string; recorded_at: string; value: number }>(
    `SELECT id, ring_id, recorded_at, value FROM condition_readings
      WHERE status IN ('pending', 'queued', 'failed')
        ${ringIds ? `AND ring_id IN (${ringIds.map(() => '?').join(', ')})` : ''}
      ORDER BY id`,
    ringIds ? [...ringIds] : [],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    ringId: row.ring_id,
    recordedAt: row.recorded_at,
    value: Number(row.value),
  }));
}

export async function recordOutcomes(
  db: SqlDatabase,
  readings: readonly QueuedReading[],
  outcomes: readonly ReadingOutcome[],
  submittedBy?: string,
): Promise<RecordedOutcomes> {
  if (outcomes.length !== readings.length) {
    throw new Error(`the chain returned ${outcomes.length} outcomes for ${readings.length} readings`);
  }
  const result: RecordedOutcomes = { submitted: [], skipped: 0, failed: 0, tampered: 0 };
  for (const [index, outcome] of outcomes.entries()) {
    const reading = readings[index] as QueuedReading;
    if (outcome.status === 'skipped') {
      await db.execute(
        "UPDATE condition_readings SET status = 'skipped', skip_reason = ?, last_error = NULL WHERE id = ?",
        [SKIP_REASON[outcome.reason.kind], reading.id],
      );
      result.skipped += 1;
      continue;
    }
    if (outcome.status === 'failed') {
      await db.execute(
        "UPDATE condition_readings SET status = 'failed', last_error = ? WHERE id = ?",
        [outcome.error, reading.id],
      );
      result.failed += 1;
      continue;
    }
    const { submission, tx, recovered } = outcome;
    const storedBand = recovered ? submission.band : classifyCondition(reading.value);
    if (storedBand !== submission.band) result.tampered += 1;
    await db.batch([
      ...submissionInserts([submissionRecord(submission, tx, storedBand, new Date().toISOString(), submittedBy)]),
      {
        sql: "UPDATE condition_readings SET status = 'submitted', skip_reason = NULL, last_error = NULL WHERE id = ?",
        parameters: [reading.id],
      },
    ]);
    result.submitted.push(submission.entryKey);
  }
  return result;
}

export async function submitStagedFeed(
  db: SqlDatabase,
  chain: ConditionChain,
  salt: Uint8Array,
  options: SubmitQueueOptions = {},
): Promise<SubmittedStagedFeed> {
  const queued = await queuedReadings(db, options.ringIds);
  const readings = options.limit === undefined ? queued : queued.slice(0, Math.max(0, options.limit));
  if (readings.length === 0) return { submitted: 0, skipped: 0, failed: 0, tampered: 0, reconcile: null };
  const outcomes = await chain.submitReadings({
    readings: readings.map(({ ringId, recordedAt, value }) => ({
      ringId,
      recordedAt,
      value: options.tamper ? crossBandValue(value) : value,
    })),
    roster: await loadRoster(db),
    submittedEntryKeys: await submittedEntryKeys(db),
    salt,
  });
  const { submitted, skipped, failed, tampered } = await recordOutcomes(db, readings, outcomes, options.submittedBy);
  if (submitted.length === 0 || tampered > 0) {
    return { submitted: submitted.length, skipped, failed, tampered, reconcile: null };
  }

  const r = await reconcileSubmissions(db, chain, { entryKeys: submitted });
  return {
    submitted: submitted.length,
    skipped,
    failed,
    tampered,
    reconcile: {
      confirmed: r.confirmed,
      mismatches: r.mismatches.length,
      valueMismatches: r.valueMismatches.length,
      missing: r.missing.length,
    },
  };
}
