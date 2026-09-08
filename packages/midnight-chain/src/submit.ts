import {
  CONDITION_PRIVATE_STATE_ID,
  createConditionPrivateState,
} from '@midnight-demo/condition-registry-contract/witnesses';
import type { PlannedSubmission } from '@midnight-demo/ingester-core';
import { hexToBytes } from '@midnight-demo/shared';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';

import type { NetworkConfig } from './config.js';
import { loadCompiledContract } from './contract.js';
import { createProviders, waitForProofServer } from './providers.js';
import { getOrCreateWalletCredentials, submitterSecretKeyHex } from './state.js';
import type { WalletContext } from './wallet.js';

export interface TransactionSummary {
  txId: string;
  txHash: string | null;
  blockHeight: string;
}

function summarizeTransaction(transaction: unknown): TransactionSummary {
  const publicData = (transaction as {
    public?: { txId?: unknown; txHash?: unknown; blockHeight?: unknown };
  }).public;
  return {
    txId: String(publicData?.txId ?? 'unknown'),
    txHash: typeof publicData?.txHash === 'string' && publicData.txHash ? publicData.txHash : null,
    blockHeight: String(publicData?.blockHeight ?? 'unknown'),
  };
}

export async function submitCondition(
  wallet: WalletContext,
  network: NetworkConfig,
  contractAddress: string,
  planned: PlannedSubmission,
): Promise<TransactionSummary> {
  const loaded = await loadCompiledContract();
  const providers = createProviders(wallet, network);
  await waitForProofServer(network);

  providers.privateStateProvider.setContractAddress(contractAddress);
  const current = await providers.privateStateProvider.get(CONDITION_PRIVATE_STATE_ID);
  const submitterKey =
    current?.submitterSecretKeyHex ?? submitterSecretKeyHex(getOrCreateWalletCredentials().seed);
  const nextPrivateState = createConditionPrivateState(submitterKey, [
    ...(current?.entries ?? []).filter((entry) => entry.entryKey !== planned.entryKey),
    { entryKey: planned.entryKey, scoreCenti: planned.scoreCenti, nonceHex: planned.nonceHex },
  ]);
  await providers.privateStateProvider.set(CONDITION_PRIVATE_STATE_ID, nextPrivateState);

  const deployed = (await findDeployedContract(providers as never, {
    compiledContract: loaded.compiledContract as never,
    contractAddress,
    privateStateId: CONDITION_PRIVATE_STATE_ID,
    initialPrivateState: nextPrivateState,
  })) as unknown as {
    callTx: { submitCondition(...args: unknown[]): Promise<unknown> };
  };

  return summarizeTransaction(
    await deployed.callTx.submitCondition(
      BigInt(planned.entryKey),
      BigInt(planned.periodStartMs),
      BigInt(planned.recordedAtMs),
      hexToBytes(planned.scoreCommitmentHex),
    ),
  );
}
