import path from 'node:path';

import type { ConditionPrivateState } from '@midnight-demo/condition-registry-contract/witnesses';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';

import {
  contractArtifactsPath,
  privateStatePassword,
  stateDir,
  type NetworkConfig,
} from './config.js';
import { walletAddress, type WalletContext } from './wallet.js';

export function createProviders(wallet: WalletContext, network: NetworkConfig) {
  const walletProvider = {
    getCoinPublicKey: () => wallet.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => wallet.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(transaction: unknown, ttl?: Date) {
      const recipe = await wallet.wallet.balanceUnboundTransaction(
        transaction as never,
        {
          shieldedSecretKeys: wallet.shieldedSecretKeys,
          dustSecretKey: wallet.dustSecretKey,
        },
        {
          ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000),
          tokenKindsToBalance: ['dust'],
        },
      );
      return wallet.wallet.finalizeRecipe(recipe);
    },
    submitTx: (transaction: unknown) => wallet.wallet.submitTransaction(transaction as never) as never,
  };
  const zkConfigProvider = new NodeZkConfigProvider(contractArtifactsPath);
  const privateStateProvider = levelPrivateStateProvider<string, ConditionPrivateState>({
    privateStateStoreName: path.join(stateDir, 'condition-private-state'),
    signingKeyStoreName: path.join(stateDir, 'condition-signing-keys'),
    accountId: walletAddress(wallet),
    privateStoragePasswordProvider: privateStatePassword,
  });

  return {
    privateStateProvider,
    publicDataProvider: indexerPublicDataProvider(network.indexer, network.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(network.proofServer, zkConfigProvider, {
      timeout: 900_000,
    }),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

export async function waitForProofServer(network: NetworkConfig): Promise<void> {
  const base = new URL(network.proofServer);
  const local = base.hostname === '127.0.0.1' || base.hostname === 'localhost';
  const readyUrl = local ? base : new URL('/ready', base);
  let lastError: unknown;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(readyUrl, {
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) return;
      lastError = new Error(`Proof server returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Proof server is unavailable: ${lastError instanceof Error ? lastError.message : lastError}`);
}
