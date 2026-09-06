import type { SqlDatabase } from '@midnight-demo/db';
import {
  planSubmissions,
  type PlannedSubmission,
  type Ring,
  type SkipReason,
} from '@midnight-demo/ingester-core';
import { APP_TIME_ZONE, classifyCondition, type ConditionBand } from '@midnight-demo/shared';

import type { NetworkConfig } from './config.js';
import { indexerConditionReader, reconcileSubmissions } from './reader.js';
import { getOrCreateWalletCredentials } from './state.js';
import { submitCondition } from './submit.js';
import { createWallet, ensureDust, persistWalletState, syncWallet } from './wallet.js';

export interface ReadingInput {
  ringId: string;
  value: number;
  recordedAt: string;
  salt: Uint8Array;

  tamper?: boolean;
}

export interface SubmittedReading {
  entryKey: string;
  ringId: string;
  periodStartMs: number;
  recordedAtMs: number;
  band: string;
  storedBand: string;
  tampered: boolean;
  scoreCommitmentHex: string;
  txId: string;
  txHash: string | null;
  blockHeight: string;

  recovered?: boolean;
}

function wrongBand(band: ConditionBand): ConditionBand {
  return band === 'normal' ? 'danger' : 'normal';
}

function bandSampleValue(band: ConditionBand): number {
  return band === 'normal' ? 75 : band === 'caution' ? 50 : 25;
}

function crossBandValue(value: number): number {
  return bandSampleValue(wrongBand(classifyCondition(value)));
}

interface SubmissionRow {
  ring_id: string;
  period_start_ms: number;
  recorded_at_ms: number;
  band: string;
  score_commitment_hex: string;
  tx_id: string | null;
  tx_hash: string | null;
  block_height: string | null;
}

async function tamperStoredRecord(
  db: SqlDatabase,
  network: NetworkConfig,
  contractAddress: string,
  entryKey: string,
  value: number,
): Promise<SubmittedReading> {
  const row = await db.first<SubmissionRow>(
    `SELECT ring_id, period_start_ms, recorded_at_ms, band, score_commitment_hex,
            tx_id, tx_hash, block_height
       FROM submissions WHERE entry_key = ?`,
    [entryKey],
  );
  if (!row) throw new ReadingNotPlannable(undefined);

  const onChain = await indexerConditionReader(network, contractAddress).read(BigInt(entryKey));
  const trueBand = (onChain?.band ?? row.band) as ConditionBand;
  const storedBand = classifyCondition(value);

  await db.execute('UPDATE submissions SET band = ?, chain_verified_at = ? WHERE entry_key = ?', [
    storedBand,
    null,
    entryKey,
  ]);
  await writeFeedValue(db, row.ring_id, Number(row.recorded_at_ms), value);

  return {
    entryKey,
    ringId: row.ring_id,
    periodStartMs: Number(row.period_start_ms),
    recordedAtMs: Number(row.recorded_at_ms),
    band: trueBand,
    storedBand,
    tampered: storedBand !== trueBand,
    scoreCommitmentHex: row.score_commitment_hex,
    txId: row.tx_id ?? 'unknown',
    txHash: row.tx_hash,
    blockHeight: row.block_height ?? 'unknown',
  };
}

const ALREADY_ON_CHAIN = /entry already submitted for this ring\/day/;

function isAlreadyOnChain(error: unknown): boolean {
  return ALREADY_ON_CHAIN.test(error instanceof Error ? error.message : String(error));
}

async function backfillFromChain(
  db: SqlDatabase,
  network: NetworkConfig,
  contractAddress: string,
  planned: PlannedSubmission,
  fallbackValue: number,
): Promise<SubmittedReading | null> {
  const onChain = await indexerConditionReader(network, contractAddress).read(BigInt(planned.entryKey));
  if (!onChain) return null;

  await recordSubmissionRow(
    db,
    {
      ...planned,
      periodStartMs: onChain.periodStartMs,
      recordedAtMs: onChain.recordedAtMs,
      scoreCommitmentHex: onChain.scoreCommitmentHex,
    },
    { txId: 'backfilled', txHash: null, blockHeight: 'unknown' },
    onChain.band,
  );
  await writeFeedValue(db, planned.ringId, onChain.recordedAtMs, fallbackValue);

  return {
    entryKey: planned.entryKey,
    ringId: planned.ringId,
    periodStartMs: onChain.periodStartMs,
    recordedAtMs: onChain.recordedAtMs,
    band: onChain.band,
    storedBand: onChain.band,
    tampered: false,
    scoreCommitmentHex: onChain.scoreCommitmentHex,
    txId: 'backfilled',
    txHash: null,
    blockHeight: 'unknown',
    recovered: true,
  };
}

export class ReadingNotPlannable extends Error {
  constructor(readonly reason: SkipReason | undefined) {
    super(`reading not plannable${reason ? `: ${reason.kind}` : ''}`);
    this.name = 'ReadingNotPlannable';
  }
}

async function loadRoster(db: SqlDatabase): Promise<Ring[]> {
  const rows = await db.all<{ ring_id: string }>('SELECT id AS ring_id FROM rings');
  return rows.map((row) => ({
    ringId: row.ring_id,
    timezone: APP_TIME_ZONE,
  }));
}

async function submittedEntryKeys(db: SqlDatabase): Promise<Set<string>> {
  const rows = await db.all<{ entry_key: string }>('SELECT entry_key FROM submissions');
  return new Set(rows.map((row) => row.entry_key));
}

async function recordSubmissionRow(
  db: SqlDatabase,
  planned: PlannedSubmission,
  tx: { txId: string; txHash: string | null; blockHeight: string },
  storedBand: string,
): Promise<void> {
  await db.execute(
    `INSERT OR IGNORE INTO submissions (
       entry_key, ring_id, period_start_ms, timezone, recorded_at_ms,
       band, score_commitment_hex, tx_id, tx_hash, block_height, submitted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      planned.entryKey,
      planned.ringId,
      planned.periodStartMs,
      planned.timezone,
      planned.recordedAtMs,
      storedBand,
      planned.scoreCommitmentHex,
      tx.txId,
      tx.txHash,
      tx.blockHeight,
      new Date().toISOString(),
    ],
  );
}

async function writeFeedValue(
  db: SqlDatabase,
  ringId: string,
  recordedAtMs: number,
  value: number,
): Promise<void> {
  const recordedAt = new Date(recordedAtMs).toISOString();
  await db.execute('DELETE FROM condition_readings WHERE ring_id = ? AND recorded_at = ?', [
    ringId,
    recordedAt,
  ]);
  await db.execute(
    `INSERT INTO condition_readings (ring_id, recorded_at, value, source, status, created_at)
     VALUES (?, ?, ?, 'manual', 'submitted', ?)`,
    [ringId, recordedAt, value, new Date().toISOString()],
  );
}

export async function submitReading(
  db: SqlDatabase,
  network: NetworkConfig,
  contractAddress: string,
  input: ReadingInput,
): Promise<SubmittedReading> {
  const chainValue = input.tamper ? crossBandValue(input.value) : input.value;
  const plan = await planSubmissions({
    conditions: [{ ringId: input.ringId, recordedAt: input.recordedAt, value: chainValue }],
    roster: await loadRoster(db),
    salt: input.salt,
    submittedEntryKeys: await submittedEntryKeys(db),
  });
  const planned = plan.planned[0];
  if (!planned) {
    const skip = plan.skipped[0];
    if (input.tamper && skip?.kind === 'already-submitted') {
      return tamperStoredRecord(db, network, contractAddress, skip.entryKey, input.value);
    }
    throw new ReadingNotPlannable(skip);
  }

  const wallet = await createWallet(
    network.networkId,
    network,
    getOrCreateWalletCredentials().seed,
  );
  try {
    await syncWallet(wallet, network.networkId);
    await ensureDust(wallet, network.faucet);
    let tx: Awaited<ReturnType<typeof submitCondition>>;
    try {
      tx = await submitCondition(wallet, network, contractAddress, planned);
    } catch (error) {
      if (!isAlreadyOnChain(error)) throw error;
      const recovered = await backfillFromChain(db, network, contractAddress, planned, input.value);
      if (!recovered) throw error;
      return recovered;
    }
    const tampered = Boolean(input.tamper);
    const storedBand = tampered ? classifyCondition(input.value) : planned.band;
    await recordSubmissionRow(db, planned, tx, storedBand);
    await writeFeedValue(db, planned.ringId, planned.recordedAtMs, input.value);
    return {
      entryKey: planned.entryKey,
      ringId: planned.ringId,
      periodStartMs: planned.periodStartMs,
      recordedAtMs: planned.recordedAtMs,
      band: planned.band,
      storedBand,
      tampered,
      scoreCommitmentHex: planned.scoreCommitmentHex,
      txId: tx.txId,
      txHash: tx.txHash,
      blockHeight: tx.blockHeight,
    };
  } finally {
    wallet.checkpoint?.unsubscribe();
    await persistWalletState(wallet, network.networkId);
    await wallet.wallet.stop();
  }
}

export interface SubmittedStagedFeed {
  submitted: number;
  skipped: number;
  reconcile:
    | { confirmed: number; mismatches: number; valueMismatches: number; missing: number }
    | null;
}

export async function submitStagedFeed(
  db: SqlDatabase,
  network: NetworkConfig,
  contractAddress: string,
  salt: Uint8Array,
): Promise<SubmittedStagedFeed> {
  const feed = await db.all<{ ring_id: string; recorded_at: string; value: number }>(
    'SELECT ring_id, recorded_at, value FROM condition_readings ORDER BY id',
  );
  const valueByRingId = new Map(feed.map((row) => [row.ring_id, row.value]));
  const plan = await planSubmissions({
    conditions: feed.map((row) => ({
      ringId: row.ring_id,
      recordedAt: row.recorded_at,
      value: row.value,
    })),
    roster: await loadRoster(db),
    salt,
    submittedEntryKeys: await submittedEntryKeys(db),
  });
  if (plan.planned.length === 0) {
    return { submitted: 0, skipped: plan.skipped.length, reconcile: null };
  }

  const wallet = await createWallet(network.networkId, network, getOrCreateWalletCredentials().seed);
  try {
    await syncWallet(wallet, network.networkId);
    await ensureDust(wallet, network.faucet);
    for (const planned of plan.planned) {
      try {
        const tx = await submitCondition(wallet, network, contractAddress, planned);
        await recordSubmissionRow(db, planned, tx, planned.band);
      } catch (error) {
        if (!isAlreadyOnChain(error)) throw error;
        const recovered = await backfillFromChain(
          db,
          network,
          contractAddress,
          planned,
          valueByRingId.get(planned.ringId) ?? planned.value,
        );
        if (!recovered) throw error;
      }
    }
    const r = await reconcileSubmissions(db, network, contractAddress, {
      entryKeys: plan.planned.map((planned) => planned.entryKey),
    });
    return {
      submitted: plan.planned.length,
      skipped: plan.skipped.length,
      reconcile: {
        confirmed: r.confirmed,
        mismatches: r.mismatches.length,
        valueMismatches: r.valueMismatches.length,
        missing: r.missing.length,
      },
    };
  } finally {
    wallet.checkpoint?.unsubscribe();
    await persistWalletState(wallet, network.networkId);
    await wallet.wallet.stop();
  }
}
