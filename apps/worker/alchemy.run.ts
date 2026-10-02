import path from 'node:path';

import * as Alchemy from 'alchemy';
import * as Cloudflare from 'alchemy/Cloudflare';
import { localState } from 'alchemy/State';
import * as Config from 'effect/Config';
import * as Effect from 'effect/Effect';

import type { ChainRunnerContainer, ProofServerContainer } from './src/containers.js';

const here = import.meta.dirname;
const repoRoot = path.resolve(here, '../..');
const compatibilityDate = '2026-09-26';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required - see docs/deploy_cloudflare.md`);
  return value;
}

const subdomain = required('WORKERS_SUBDOMAIN');
const workerName = 'midnight-proof-ohayo';
const partnerWorkerName = `${workerName}-partner`;
const siteUrl = `https://${workerName}.${subdomain}.workers.dev`;
const partnerUrl = `https://${partnerWorkerName}.${subdomain}.workers.dev`;

export const Database = Cloudflare.D1.Database('Database', {
  name: 'ohayo',
  migrations: path.join(repoRoot, 'packages/db/migrations'),
});

export const PartnerDatabase = Cloudflare.D1.Database('PartnerDatabase', {
  name: 'ohayo-partner',
  migrations: path.join(repoRoot, 'apps/partner-mock/migrations'),
});

export const WalletState = Cloudflare.R2.Bucket('WalletState', {
  name: 'ohayo-wallet-state',
  forceDestroy: true,
});

export const Partner = Cloudflare.Worker('Partner', {
  name: partnerWorkerName,
  main: path.join(repoRoot, 'apps/partner-mock/src/worker.ts'),
  compatibility: { date: compatibilityDate },
  env: {
    DB: PartnerDatabase,
    PARTNER_ALLOWED_ORIGIN: siteUrl,
    PARTNER_API_KEY: Config.Redacted('PARTNER_API_KEY'),
    PARTNER_SIGNING_KEY: Config.Redacted('PARTNER_SIGNING_KEY'),
  },
});

export const Ohayo = Cloudflare.Worker('Ohayo', {
  name: workerName,
  main: path.join(here, 'src/worker.ts'),
  compatibility: { date: compatibilityDate, flags: ['nodejs_compat'] },
  crons: ['* * * * *'],
  assets: {
    directory: path.join(repoRoot, 'apps/dashboard/public'),
    runWorkerFirst: true,
    notFoundHandling: 'single-page-application',
  },
  env: {
    DB: Database,
    WALLET_STATE: WalletState,
    PARTNER: Partner,
    AUTH_RATE_LIMITER: Cloudflare.RateLimit('AUTH_RATE_LIMITER', {
      namespaceId: 4102,
      simple: { limit: 20, period: 60 },
    }),
    CHAIN_RUNNER: Cloudflare.Container<ChainRunnerContainer>('ChainRunner', {
      className: 'ChainRunnerContainer',
      context: repoRoot,
      dockerfile: path.join(repoRoot, 'apps/chain-runner/Dockerfile'),
      vcpu: 1,
      memoryMib: 3072,
      maxInstances: 1,
      observability: { logs: { enabled: true } },
    }),
    PROOF_SERVER: Cloudflare.Container<ProofServerContainer>('ProofServer', {
      className: 'ProofServerContainer',
      image: 'docker.io/midnightntwrk/proof-server:8.1.0',
      instanceType: 'standard-1',
      maxInstances: 1,
      observability: { logs: { enabled: true } },
    }),
    MIDNIGHT_NETWORK: 'preprod',
    WALLET_NETWORK_ID: 'preprod',
    PUBLIC_MIDNIGHT_NETWORK: 'Midnight Preprod',
    CONDITION_REGISTRY_CONTRACT_ADDRESS: Config.String('CONDITION_REGISTRY_CONTRACT_ADDRESS'),
    PUBLIC_PARTNER_URL: partnerUrl,
    PARTNER_URL: partnerUrl,
    GUEST_ENTRY: '1',
    GUEST_SUBMISSION_LIMIT: '3',
    GUEST_HOURLY_LIMIT: '30',
    INGESTER_SALT_HEX: Config.Redacted('INGESTER_SALT_HEX'),
    SESSION_SECRET: Config.Redacted('SESSION_SECRET'),
    ADMIN_WALLET_KEY_HASHES: Config.Redacted('ADMIN_WALLET_KEY_HASHES'),
    PARTNER_API_KEY: Config.Redacted('PARTNER_API_KEY'),
    PARTNER_PUBLIC_KEY: Config.String('PARTNER_PUBLIC_KEY'),
    OPERATING_WALLET_MNEMONIC: Config.Redacted('DEVELOPMENT_WALLET_MNEMONIC'),
    DEVELOPMENT_PRIVATE_STATE_PASSWORD: Config.Redacted('DEVELOPMENT_PRIVATE_STATE_PASSWORD'),
  },
});

export default Alchemy.Stack(
  'Ohayo',
  { providers: Cloudflare.providers(), state: localState() },
  Effect.gen(function* () {
    const partner = yield* Partner;
    const ohayo = yield* Ohayo;
    return { url: ohayo.url, partnerUrl: partner.url };
  }),
);
