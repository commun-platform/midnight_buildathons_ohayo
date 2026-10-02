import {
  planSubmissions,
  type PlannedSubmission,
  type ReadingOutcome,
  type SubmitReadingsRequest,
} from '@midnight-demo/ingester-core';

import type { NetworkConfig } from './config.js';
import { readConditionEntries } from './reader.js';
import { getOrCreateWalletCredentials } from './state.js';
import { submitCondition } from './submit.js';
import { createWallet, ensureDust, persistWalletState, syncWallet, type WalletContext } from './wallet.js';

type PlannedStep = { planned: PlannedSubmission } | { outcome: ReadingOutcome };

const ALREADY_ON_CHAIN = /entry already submitted for this ring\/day/;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function planReadings(request: SubmitReadingsRequest): Promise<PlannedStep[]> {
  const seen = new Set(request.submittedEntryKeys);
  const steps: PlannedStep[] = [];
  for (const reading of request.readings) {
    const plan = await planSubmissions({
      conditions: [reading],
      roster: request.roster,
      salt: request.salt,
      submittedEntryKeys: seen,
    });
    const planned = plan.planned[0];
    const reason = plan.skipped[0];
    if (planned) {
      seen.add(planned.entryKey);
      steps.push({ planned });
    } else if (reason) {
      steps.push({ outcome: { status: 'skipped', reason } });
    } else {
      steps.push({ outcome: { status: 'failed', error: 'reading was neither planned nor skipped' } });
    }
  }
  return steps;
}

async function recoverFromChain(
  network: NetworkConfig,
  contractAddress: string,
  planned: PlannedSubmission,
): Promise<ReadingOutcome | null> {
  const onChain = (await readConditionEntries(network, contractAddress, [planned.entryKey])).get(
    planned.entryKey,
  );
  if (!onChain) return null;
  return {
    status: 'submitted',
    submission: {
      ...planned,
      periodStartMs: onChain.periodStartMs,
      recordedAtMs: onChain.recordedAtMs,
      scoreCommitmentHex: onChain.scoreCommitmentHex,
      band: onChain.band,
    },
    tx: { txId: 'backfilled', txHash: null, blockHeight: 'unknown' },
    recovered: true,
  };
}

async function submitPlanned(
  wallet: WalletContext,
  network: NetworkConfig,
  contractAddress: string,
  planned: PlannedSubmission,
): Promise<ReadingOutcome> {
  try {
    const tx = await submitCondition(wallet, network, contractAddress, planned);
    return { status: 'submitted', submission: planned, tx, recovered: false };
  } catch (error) {
    if (ALREADY_ON_CHAIN.test(errorMessage(error))) {
      const recovered = await recoverFromChain(network, contractAddress, planned).catch(() => null);
      if (recovered) return recovered;
    }
    return { status: 'failed', error: errorMessage(error) };
  }
}

export async function submitReadings(
  network: NetworkConfig,
  contractAddress: string,
  request: SubmitReadingsRequest,
): Promise<ReadingOutcome[]> {
  const steps = await planReadings(request);
  if (steps.every((step) => 'outcome' in step)) {
    return steps.map((step) => (step as { outcome: ReadingOutcome }).outcome);
  }

  const wallet = await createWallet(network.networkId, network, getOrCreateWalletCredentials().seed);
  try {
    await syncWallet(wallet, network.networkId);
    await ensureDust(wallet, network.faucet);
    const outcomes: ReadingOutcome[] = [];
    for (const step of steps) {
      outcomes.push(
        'outcome' in step
          ? step.outcome
          : await submitPlanned(wallet, network, contractAddress, step.planned),
      );
    }
    return outcomes;
  } finally {
    wallet.checkpoint?.unsubscribe();
    await persistWalletState(wallet, network.networkId);
    await wallet.wallet.stop();
  }
}
