import type { SqlDatabase } from '@midnight-demo/db';
import type {
  ConditionChain,
  ReadingOutcome,
  RunnerJob,
  RunnerSubmitRequest,
} from '@midnight-demo/ingester-core';
import { bytesToHex } from '@midnight-demo/shared';

import { reconcileSubmissions } from './reconcile.js';
import { loadRoster, submittedEntryKeys } from './store.js';
import { crossBandValue, recordOutcomes, type QueuedReading } from './submit.js';

export interface EnqueueOptions {
  tamper?: boolean;
  ringIds?: readonly string[];
  limit?: number;
  queuedBy?: string;
}

export interface ChainRunner extends Pick<ConditionChain, 'readEntries'> {
  startJob(jobId: string, request: RunnerSubmitRequest): Promise<void>;
  job(jobId: string): Promise<RunnerJob>;
}

export interface DrainOptions {
  openingKeyHex?: string;
  now?: Date;
  newId?: () => string;
  batchSize?: number;
  timeoutMs?: number;
}

export type DrainResult =
  | { action: 'idle' }
  | { action: 'busy' }
  | { action: 'started'; jobId: string; readings: number }
  | { action: 'waiting'; jobId: string; stage: string | null }
  | {
      action: 'recorded';
      jobId: string;
      submitted: number;
      skipped: number;
      failed: number;
      tampered: number;
      confirmed: number;
    }
  | { action: 'failed'; jobId: string; error: string }
  | { action: 'lost'; jobId: string; error: string };

export interface ChainJobView {
  id: string;
  status: 'running' | 'done' | 'failed' | 'lost';
  stage: string | null;
  readings: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export const JOB_BATCH_SIZE = 10;
export const JOB_TIMEOUT_MS = 90 * 60_000;

interface QueuedRow {
  id: number;
  ring_id: string;
  recorded_at: string;
  value: number;
  queued_tamper: number;
  queued_by: string | null;
}

interface JobRow {
  id: string;
  reading_ids: string;
  status: ChainJobView['status'];
  stage: string | null;
  started_at: string;
  finished_at: string | null;
  error: string | null;
}

const QUEUED_COLUMNS = 'id, ring_id, recorded_at, value, queued_tamper, queued_by';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toReading(row: QueuedRow): QueuedReading {
  return {
    id: Number(row.id),
    ringId: row.ring_id,
    recordedAt: row.recorded_at,
    value: Number(row.value),
    tamper: Number(row.queued_tamper) === 1,
    ...(row.queued_by ? { submittedBy: row.queued_by } : {}),
  };
}

function readingIds(row: JobRow): number[] {
  const parsed = JSON.parse(row.reading_ids) as unknown;
  return Array.isArray(parsed) ? parsed.map(Number) : [];
}

export async function enqueueReadings(
  db: SqlDatabase,
  options: EnqueueOptions = {},
  now = new Date(),
): Promise<number> {
  if (options.ringIds && options.ringIds.length === 0) return 0;
  const rows = await db.all<{ id: number }>(
    `SELECT id FROM condition_readings
      WHERE status IN ('pending', 'failed')
        ${options.ringIds ? `AND ring_id IN (${options.ringIds.map(() => '?').join(', ')})` : ''}
      ORDER BY id`,
    options.ringIds ? [...options.ringIds] : [],
  );
  const picked = options.limit === undefined ? rows : rows.slice(0, Math.max(0, options.limit));
  if (picked.length === 0) return 0;
  await db.batch(
    picked.map((row) => ({
      sql: `UPDATE condition_readings
               SET status = 'queued', queued_by = ?, queued_at = ?, queued_tamper = ?, last_error = NULL
             WHERE id = ? AND status IN ('pending', 'failed')`,
      parameters: [options.queuedBy ?? null, now.toISOString(), options.tamper ? 1 : 0, Number(row.id)],
    })),
  );
  return picked.length;
}

async function finishJob(
  db: SqlDatabase,
  jobId: string,
  status: 'done' | 'failed' | 'lost',
  error: string | null,
  now: Date,
): Promise<void> {
  await db.execute('UPDATE chain_jobs SET status = ?, finished_at = ?, error = ? WHERE id = ?', [
    status,
    now.toISOString(),
    error,
    jobId,
  ]);
}

async function jobReadings(db: SqlDatabase, ids: readonly number[]): Promise<Map<number, QueuedReading>> {
  if (ids.length === 0) return new Map();
  const rows = await db.all<QueuedRow>(
    `SELECT ${QUEUED_COLUMNS} FROM condition_readings
      WHERE status = 'queued' AND id IN (${ids.map(() => '?').join(', ')})`,
    [...ids],
  );
  return new Map(rows.map((row) => [Number(row.id), toReading(row)]));
}

async function settleJob(
  db: SqlDatabase,
  runner: ChainRunner,
  row: JobRow,
  now: Date,
  timeoutMs: number,
  openingKeyHex: string | undefined,
): Promise<DrainResult> {
  let job: RunnerJob;
  try {
    job = await runner.job(row.id);
  } catch (error) {
    job = { state: 'running', stage: `unreachable: ${errorMessage(error)}` };
  }

  if (job.state === 'running') {
    if (now.getTime() - Date.parse(row.started_at) > timeoutMs) {
      const error = `the chain runner did not finish within ${Math.round(timeoutMs / 60_000)} minutes`;
      await finishJob(db, row.id, 'lost', error, now);
      return { action: 'lost', jobId: row.id, error };
    }
    const stage = job.stage ?? null;
    await db.execute('UPDATE chain_jobs SET stage = ? WHERE id = ?', [stage, row.id]);
    return { action: 'waiting', jobId: row.id, stage };
  }

  if (job.state === 'unknown') {
    const error = 'the chain runner restarted before the job finished; its readings stay queued';
    await finishJob(db, row.id, 'lost', error, now);
    return { action: 'lost', jobId: row.id, error };
  }

  const ids = readingIds(row);
  if (job.state === 'failed') {
    await db.batch(
      ids.map((id) => ({
        sql: "UPDATE condition_readings SET status = 'failed', last_error = ? WHERE id = ? AND status = 'queued'",
        parameters: [job.error, id],
      })),
    );
    await finishJob(db, row.id, 'failed', job.error, now);
    return { action: 'failed', jobId: row.id, error: job.error };
  }

  if (job.outcomes.length !== ids.length) {
    const error = `the chain runner returned ${job.outcomes.length} outcomes for ${ids.length} readings`;
    await finishJob(db, row.id, 'failed', error, now);
    return { action: 'failed', jobId: row.id, error };
  }
  const current = await jobReadings(db, ids);
  const readings: QueuedReading[] = [];
  const outcomes: ReadingOutcome[] = [];
  ids.forEach((id, index) => {
    const reading = current.get(id);
    if (!reading) return;
    readings.push(reading);
    outcomes.push(job.outcomes[index] as ReadingOutcome);
  });
  const recorded = await recordOutcomes(db, readings, outcomes, openingKeyHex ? { openingKeyHex } : {});
  let confirmed = 0;
  if (recorded.confirmable.length > 0) {
    try {
      confirmed = (await reconcileSubmissions(db, runner, { entryKeys: recorded.confirmable })).confirmed;
    } catch {
      confirmed = 0;
    }
  }
  await finishJob(db, row.id, 'done', null, now);
  return {
    action: 'recorded',
    jobId: row.id,
    submitted: recorded.submitted.length,
    skipped: recorded.skipped,
    failed: recorded.failed,
    tampered: recorded.tampered,
    confirmed,
  };
}

export async function drainQueue(
  db: SqlDatabase,
  runner: ChainRunner,
  salt: Uint8Array,
  options: DrainOptions = {},
): Promise<DrainResult> {
  const now = options.now ?? new Date();
  const running = await db.first<JobRow>(
    "SELECT id, reading_ids, status, stage, started_at, finished_at, error FROM chain_jobs WHERE status = 'running'",
  );
  if (running) return settleJob(db, runner, running, now, options.timeoutMs ?? JOB_TIMEOUT_MS, options.openingKeyHex);

  const rows = await db.all<QueuedRow>(
    `SELECT ${QUEUED_COLUMNS} FROM condition_readings WHERE status = 'queued' ORDER BY id LIMIT ?`,
    [options.batchSize ?? JOB_BATCH_SIZE],
  );
  if (rows.length === 0) return { action: 'idle' };

  const readings = rows.map(toReading);
  const request: RunnerSubmitRequest = {
    readings: readings.map(({ ringId, recordedAt, value, tamper }) => ({
      ringId,
      recordedAt,
      value: tamper ? crossBandValue(value) : value,
    })),
    roster: await loadRoster(db),
    submittedEntryKeys: [...(await submittedEntryKeys(db))],
    saltHex: bytesToHex(salt),
  };
  const jobId = options.newId ? options.newId() : crypto.randomUUID();
  try {
    await db.execute(
      "INSERT INTO chain_jobs (id, reading_ids, status, started_at) VALUES (?, ?, 'running', ?)",
      [jobId, JSON.stringify(readings.map((r) => r.id)), now.toISOString()],
    );
  } catch {
    return { action: 'busy' };
  }
  try {
    await runner.startJob(jobId, request);
  } catch (error) {
    const message = `the chain runner did not accept the job: ${errorMessage(error)}`;
    await finishJob(db, jobId, 'lost', message, now);
    return { action: 'lost', jobId, error: message };
  }
  return { action: 'started', jobId, readings: readings.length };
}

export async function latestChainJob(db: SqlDatabase): Promise<ChainJobView | null> {
  const row = await db.first<JobRow>(
    `SELECT id, reading_ids, status, stage, started_at, finished_at, error FROM chain_jobs
      ORDER BY CASE status WHEN 'running' THEN 0 ELSE 1 END, started_at DESC LIMIT 1`,
  );
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    stage: row.stage,
    readings: readingIds(row).length,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
  };
}
