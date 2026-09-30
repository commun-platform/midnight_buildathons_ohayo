import type { OnChainEntry } from '@midnight-demo/condition-read';
import type { ConditionBand } from '@midnight-demo/shared';

export interface Ring {
  ringId: string;
  timezone: string;
}

export interface ConditionRecord {
  ringId: string;
  recordedAt: string;
  value: number;
}

export interface PlannedSubmission {
  entryKey: string;
  ringId: string;
  timezone: string;
  periodStartMs: number;
  recordedAtMs: number;
  value: number;
  scoreCenti: number;
  nonceHex: string;
  scoreCommitmentHex: string;
  band: ConditionBand;
}

export type SkipReason =
  | { kind: 'unknown-ring'; ringId: string; recordedAt: string }
  | { kind: 'invalid-value'; ringId: string; recordedAt: string; value: unknown }
  | { kind: 'already-submitted'; entryKey: string; ringId: string; periodStartMs: number };

export interface SubmissionRecord {
  entryKey: string;
  ringId: string;
  timezone: string;
  periodStartMs: number;
  recordedAtMs: number;
  band: ConditionBand;
  scoreCommitmentHex: string;
  txId?: string;
  txHash?: string | null;
  blockHeight?: string;
  submittedAt: string;
  submittedBy?: string;
}

export interface TransactionSummary {
  txId: string;
  txHash: string | null;
  blockHeight: string;
}

export interface SubmitReadingsRequest {
  readings: readonly ConditionRecord[];
  roster: readonly Ring[];
  submittedEntryKeys: ReadonlySet<string>;
  salt: Uint8Array;
}

export type ReadingOutcome =
  | { status: 'submitted'; submission: PlannedSubmission; tx: TransactionSummary; recovered: boolean }
  | { status: 'skipped'; reason: SkipReason }
  | { status: 'failed'; error: string };

export interface ConditionChain {
  submitReadings(request: SubmitReadingsRequest): Promise<ReadingOutcome[]>;
  readEntries(entryKeys: readonly string[]): Promise<Map<string, OnChainEntry>>;
}
