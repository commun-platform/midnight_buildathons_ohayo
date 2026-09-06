import type { SqlDatabase } from '@midnight-demo/db';
import {
  loadSalt,
  planSubmissions,
  type Plan,
  type PlannedSubmission,
  type SubmissionRecord,
} from '@midnight-demo/ingester-core';
import { fileURLToPath } from 'node:url';

import { loadRoster, recordSubmissions, submittedEntryKeys } from './db.js';
import { dbConditionSource, type ConditionSource } from './sources.js';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

export interface LoadedInputs {
  salt: Uint8Array;
  plan: Plan;
}

export async function loadAndPlan(
  db: SqlDatabase,
  source: ConditionSource = dbConditionSource(db),
): Promise<LoadedInputs> {
  const salt = loadSalt();
  const plan = await planSubmissions({
    conditions: await source.load(),
    roster: await loadRoster(db),
    salt,
    submittedEntryKeys: await submittedEntryKeys(db),
  });
  return { salt, plan };
}

export function summarize(inputs: LoadedInputs): string {
  const lines: string[] = [];
  lines.push(`planned: ${inputs.plan.planned.length}   skipped: ${inputs.plan.skipped.length}`);
  for (const submission of inputs.plan.planned) {
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: submission.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(submission.periodStartMs);
    lines.push(
      `  + ${submission.ringId.padEnd(12)} ${day} ${submission.timezone.padEnd(14)} ${String(submission.value).padStart(5)}  ${submission.band.padEnd(7)}  key=${submission.entryKey.slice(0, 12)}…`,
    );
  }
  for (const skip of inputs.plan.skipped) {
    lines.push(`  - ${skip.kind}: ${JSON.stringify(skip)}`);
  }
  return lines.join('\n');
}

export async function recordPlannedLocally(
  db: SqlDatabase,
  inputs: LoadedInputs,
): Promise<SubmissionRecord[]> {
  const now = new Date().toISOString();
  const records = inputs.plan.planned.map((submission) => toLocalRecord(submission, now));
  await recordSubmissions(db, records);
  return records;
}

function toLocalRecord(submission: PlannedSubmission, submittedAt: string): SubmissionRecord {
  return {
    entryKey: submission.entryKey,
    ringId: submission.ringId,
    timezone: submission.timezone,
    periodStartMs: submission.periodStartMs,
    recordedAtMs: submission.recordedAtMs,
    band: submission.band,
    scoreCommitmentHex: submission.scoreCommitmentHex,
    submittedAt,
  };
}
