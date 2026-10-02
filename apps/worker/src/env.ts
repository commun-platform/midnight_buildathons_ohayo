import type { CheckpointBucket } from './checkpoint-store.js';
import type { ChainRunnerContainer, ProofServerContainer } from './containers.js';
import type { FetcherLike, WorkerVars } from './deps.js';

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env extends WorkerVars {
  DB: D1Database;
  ASSETS: Fetcher;
  WALLET_STATE: R2Bucket & CheckpointBucket;
  CHAIN_RUNNER: DurableObjectNamespace<ChainRunnerContainer>;
  PROOF_SERVER: DurableObjectNamespace<ProofServerContainer>;
  PARTNER?: FetcherLike;
  AUTH_RATE_LIMITER?: RateLimiter;
  OPERATING_WALLET_MNEMONIC?: string;
  DEVELOPMENT_PRIVATE_STATE_PASSWORD?: string;
}
