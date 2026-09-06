import type { ConditionReader, OnChainEntry } from '@midnight-demo/condition-read';
import type { SqlDatabase } from '@midnight-demo/db';
import { bytesToHex, classifyCondition, conditionBandFromOrdinal } from '@midnight-demo/shared';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';

import type { NetworkConfig } from './config.js';
import { loadCompiledContract } from './contract.js';

export interface ConditionRegistryStatus {
  contractAddress: string;
  network: string;
  submissionCount: string;
  lastSubmittedKey: string;
  lastSubmittedBand: string;
  entries: Array<{
    entryKey: string;
    band: string;
    periodStartMs: number;
    recordedAtMs: number;
    scoreCommitmentHex: string;
    verified: boolean;
  }>;
}

export async function queryConditionRegistry(
  network: NetworkConfig,
  contractAddress: string,
): Promise<ConditionRegistryStatus> {
  const loaded = await loadCompiledContract();
  const provider = indexerPublicDataProvider(network.indexer, network.indexerWS);
  const contractState = await provider.queryContractState(contractAddress);
  if (!contractState) throw new Error(`Contract state not found: ${contractAddress}`);
  const state = loaded.module.ledger(contractState.data);
  return {
    contractAddress,
    network: network.networkId,
    submissionCount: state.submissionCount.toString(),
    lastSubmittedKey: state.lastSubmittedKey.toString(),
    lastSubmittedBand: conditionBandFromOrdinal(Number(state.lastSubmittedBand)),
    entries: Array.from(state.entries, ([key, entry]) => ({
      entryKey: key.toString(),
      band: conditionBandFromOrdinal(Number(entry.band)),
      periodStartMs: Number(entry.periodStartMs),
      recordedAtMs: Number(entry.recordedAt),
      scoreCommitmentHex: bytesToHex(entry.scoreCommitment),
      verified: Boolean(entry.verified),
    })),
  };
}

export interface IndexerReaderOptions {
  ttlMs?: number;
}

export function indexerConditionReader(
  network: NetworkConfig,
  contractAddress: string,
  options: IndexerReaderOptions = {},
): ConditionReader {
  const ttlMs = options.ttlMs ?? 15_000;
  let cache: { at: number; entries: Map<string, OnChainEntry> } | null = null;

  async function load(): Promise<Map<string, OnChainEntry>> {
    if (cache && Date.now() - cache.at < ttlMs) return cache.entries;
    if (!contractAddress) throw new Error('condition-registry contract address is not configured');

    const loaded = await loadCompiledContract();
    const provider = indexerPublicDataProvider(network.indexer, network.indexerWS);
    const contractState = await provider.queryContractState(contractAddress);
    if (!contractState) throw new Error(`Contract state not found: ${contractAddress}`);
    const state = loaded.module.ledger(contractState.data);

    const entries = new Map<string, OnChainEntry>();
    for (const [key, entry] of state.entries) {
      const band = conditionBandFromOrdinal(Number(entry.band));
      if (band === 'unclassified') continue;
      entries.set(key.toString(), {
        band,
        periodStartMs: Number(entry.periodStartMs),
        recordedAtMs: Number(entry.recordedAt),
        scoreCommitmentHex: bytesToHex(entry.scoreCommitment),
        verified: Boolean(entry.verified),
      });
    }
    cache = { at: Date.now(), entries };
    return entries;
  }

  return {
    async read(entryKey: bigint) {
      const entries = await load();
      return entries.get(entryKey.toString()) ?? null;
    },
  };
}

export interface ReconcileResult {
  confirmed: number;

  localChecked: number;
  mismatches: Array<{ entryKey: string; dbBand: string; chainBand: string }>;

  valueMismatches: Array<{ entryKey: string; value: number; valueBand: string; chainBand: string }>;
  missing: string[];
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
  network: NetworkConfig,
  contractAddress: string,
  opts: { entryKeys?: readonly string[]; phased?: boolean } = {},
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
    localChecked: 0,
    mismatches: [],
    valueMismatches: [],
    missing: [],
  };
  let reader: ConditionReader | null = null;

  for (const row of rows) {
    const value = feedValues.get(`${row.ring_id}|${Number(row.recorded_at_ms)}`);
    const valueBand = value === undefined ? null : classifyCondition(value);

    if (opts.phased && !row.reconciled_at) {
      await db.execute(
        'UPDATE submissions SET chain_verified_at = ?, reconciled_at = ? WHERE entry_key = ?',
        [now, now, row.entry_key],
      );
      result.localChecked += 1;
      continue;
    }

    reader ??= indexerConditionReader(network, contractAddress);
    const onChain = await reader.read(BigInt(row.entry_key));
    if (!onChain) {
      result.missing.push(row.entry_key);
      continue;
    }

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
