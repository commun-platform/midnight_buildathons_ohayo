import type { ConditionReader, OnChainEntry } from '@midnight-demo/condition-read';
import { bytesToHex, conditionBandFromOrdinal } from '@midnight-demo/shared';
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

async function loadConditionEntries(
  network: NetworkConfig,
  contractAddress: string,
): Promise<Map<string, OnChainEntry>> {
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
  return entries;
}

export async function readConditionEntries(
  network: NetworkConfig,
  contractAddress: string,
  entryKeys: readonly string[],
): Promise<Map<string, OnChainEntry>> {
  if (entryKeys.length === 0) return new Map();
  const entries = await loadConditionEntries(network, contractAddress);
  const found = new Map<string, OnChainEntry>();
  for (const key of entryKeys) {
    const entry = entries.get(key);
    if (entry) found.set(key, entry);
  }
  return found;
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
    const entries = await loadConditionEntries(network, contractAddress);
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
