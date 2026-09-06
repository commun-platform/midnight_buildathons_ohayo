import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export type NetworkId = 'preview' | 'preprod' | 'local';

export interface NetworkConfig {
  networkId: NetworkId;
  midnightNetworkId: string;
  indexer: string;
  indexerWS: string;
  node: string;
  proofServer: string;
  faucet: string;
}

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
export const developmentEnvPath = path.join(repoRoot, '.env');
loadEnv({ path: developmentEnvPath, quiet: true });
loadEnv({ path: path.join(repoRoot, '.env.local'), quiet: true });

export const stateDir = path.join(repoRoot, '.state', 'midnight-chain');
export const contractArtifactsPath = path.join(
  repoRoot,
  'contracts/condition-registry/src/managed/condition-registry',
);
export const contractModulePath = path.join(contractArtifactsPath, 'contract/index.js');

const NETWORKS: Record<NetworkId, Omit<NetworkConfig, 'proofServer'>> = {
  preview: {
    networkId: 'preview',
    midnightNetworkId: 'preview',
    indexer: 'https://indexer.preview.midnight.network/api/v4/graphql',
    indexerWS: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
    node: 'https://rpc.preview.midnight.network',
    faucet: 'https://midnight-tmnight-preview.nethermind.dev',
  },
  preprod: {
    networkId: 'preprod',
    midnightNetworkId: 'preprod',
    indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
    indexerWS: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
    node: 'https://rpc.preprod.midnight.network',
    faucet: 'https://midnight-tmnight-preprod.nethermind.dev',
  },
  local: {
    networkId: 'local',
    midnightNetworkId: 'undeployed',
    indexer: 'http://127.0.0.1:8088/api/v4/graphql',
    indexerWS: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
    node: 'http://127.0.0.1:9944',
    faucet: '',
  },
};

export function resolveNetwork(value?: string): NetworkConfig {
  const network = value ?? process.env.MIDNIGHT_NETWORK ?? 'preprod';
  if (network !== 'preview' && network !== 'preprod' && network !== 'local') {
    throw new Error(`Unsupported Midnight network: ${network} (expected preview | preprod | local)`);
  }

  const base = NETWORKS[network];
  return {
    ...base,
    indexer: process.env.MIDNIGHT_INDEXER_URL ?? base.indexer,
    indexerWS: process.env.MIDNIGHT_INDEXER_WS_URL ?? base.indexerWS,
    node: process.env.MIDNIGHT_NODE_URL ?? base.node,
    proofServer: process.env.MIDNIGHT_PROOF_SERVER_URL ?? 'http://127.0.0.1:6300',
  };
}

export function privateStatePassword(): string {
  const password = process.env.DEVELOPMENT_PRIVATE_STATE_PASSWORD?.trim();
  if (!password || password.length < 16) {
    throw new Error('DEVELOPMENT_PRIVATE_STATE_PASSWORD must contain at least 16 characters');
  }
  const characterClasses = [/[A-Z]/, /[a-z]/, /\d/, /[^A-Za-z0-9]/]
    .filter((pattern) => pattern.test(password)).length;
  return characterClasses >= 3 ? password : `Aa1!${password}`;
}

export function genesisSeed(): string {
  const raw = (process.env.MIDNIGHT_GENESIS_SEED ?? '').trim().replace(/^0x/i, '');
  const seed = raw || '0000000000000000000000000000000000000000000000000000000000000001';
  if (!/^[0-9a-fA-F]{64}$/.test(seed)) {
    throw new Error('MIDNIGHT_GENESIS_SEED must be 32 bytes of hex');
  }
  return seed;
}

export function conditionContractAddress(explicit?: string): string {
  const address = explicit?.trim() || process.env.CONDITION_REGISTRY_CONTRACT_ADDRESS?.trim();
  if (!address) {
    throw new Error(
      'CONDITION_REGISTRY_CONTRACT_ADDRESS is required (set it in .env after `npm run development:deploy`, or pass --contract)',
    );
  }
  return address;
}
