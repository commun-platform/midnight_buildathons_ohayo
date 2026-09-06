import {
  bytesToHex,
  classifyConditionCenti,
  conditionEntryKey,
  conditionScoreCenti,
  conditionScoreCommitment,
  zonedDayStartMs,
} from '@midnight-demo/shared';

import type { ConditionRecord, PlannedSubmission, Ring, SkipReason } from './types.js';

export interface PlanOptions {
  conditions: readonly ConditionRecord[];
  roster: readonly Ring[];
  salt: Uint8Array;
  submittedEntryKeys: ReadonlySet<string>;
  nonce?: () => Uint8Array;
}

export interface Plan {
  planned: PlannedSubmission[];
  skipped: SkipReason[];
}

function randomNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export async function planSubmissions(options: PlanOptions): Promise<Plan> {
  const ringById = new Map(options.roster.map((ring) => [ring.ringId, ring]));
  const nextNonce = options.nonce ?? randomNonce;
  const seen = new Set<string>(options.submittedEntryKeys);
  const planned: PlannedSubmission[] = [];
  const skipped: SkipReason[] = [];

  for (const record of options.conditions) {
    const ring = ringById.get(record.ringId);
    if (!ring) {
      skipped.push({
        kind: 'unknown-ring',
        ringId: record.ringId,
        recordedAt: record.recordedAt,
      });
      continue;
    }

    const recordedAtMs = Date.parse(record.recordedAt);
    if (
      !Number.isFinite(recordedAtMs) ||
      typeof record.value !== 'number' ||
      !Number.isFinite(record.value) ||
      record.value < 0 ||
      record.value > 100
    ) {
      skipped.push({
        kind: 'invalid-value',
        ringId: record.ringId,
        recordedAt: record.recordedAt,
        value: record.value,
      });
      continue;
    }

    const periodStartMs = zonedDayStartMs(recordedAtMs, ring.timezone);
    const entryKey = (await conditionEntryKey(ring.ringId, periodStartMs, options.salt)).toString();
    if (seen.has(entryKey)) {
      skipped.push({ kind: 'already-submitted', entryKey, ringId: ring.ringId, periodStartMs });
      continue;
    }
    seen.add(entryKey);

    const scoreCenti = conditionScoreCenti(record.value);
    const nonce = nextNonce();
    const scoreCommitment = conditionScoreCommitment(scoreCenti, nonce);

    planned.push({
      entryKey,
      ringId: ring.ringId,
      timezone: ring.timezone,
      periodStartMs,
      recordedAtMs,
      value: record.value,
      scoreCenti,
      nonceHex: bytesToHex(nonce),
      scoreCommitmentHex: bytesToHex(scoreCommitment),
      band: classifyConditionCenti(scoreCenti),
    });
  }

  return { planned, skipped };
}
