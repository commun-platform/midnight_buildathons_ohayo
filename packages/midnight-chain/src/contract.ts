import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

import { witnesses } from '@midnight-demo/condition-registry-contract/witnesses';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

import { contractArtifactsPath, contractModulePath } from './config.js';

export interface LedgerConditionEntry {
  periodStartMs: bigint;
  recordedAt: bigint;
  scoreCommitment: Uint8Array;
  band: number | bigint;
  verified: boolean;
}

export interface ConditionLedger {
  entries: Iterable<[bigint, LedgerConditionEntry]> & {
    lookup?(key: bigint): LedgerConditionEntry;
    member?(key: bigint): boolean;
  };
  submissionCount: bigint;
  lastSubmittedKey: bigint;
  lastSubmittedBand: number | bigint;
}

export interface LoadedContract {
  module: {
    Contract: new (witnesses: unknown) => unknown;
    ledger(state: unknown): ConditionLedger;
  };
  compiledContract: unknown;
}

export async function loadCompiledContract(): Promise<LoadedContract> {
  if (!fs.existsSync(contractModulePath)) {
    throw new Error(
      `condition-registry artifacts are missing (${contractModulePath}). Run: npm run contract:compile`,
    );
  }
  const contractModule = await import(pathToFileURL(contractModulePath).href) as LoadedContract['module'];
  const compiledContract = CompiledContract.make(
    'condition-registry',
    contractModule.Contract as never,
  ).pipe(
    CompiledContract.withWitnesses(witnesses as never),
    CompiledContract.withCompiledFileAssets(contractArtifactsPath),
  );
  return { module: contractModule, compiledContract };
}
