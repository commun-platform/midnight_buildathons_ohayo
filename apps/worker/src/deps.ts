import { dbConditionReader, type OnChainEntry } from '@midnight-demo/condition-read';
import { d1Database, type D1DatabaseLike } from '@midnight-demo/db/d1';
import { authConfigFromEnv } from '@midnight-demo/gateway/auth';
import { enqueueStagedWith, reconcileWith } from '@midnight-demo/gateway/chain-deps';
import { saltFromHex, type GatewayDeps } from '@midnight-demo/gateway/deps';
import type { ChainRunner } from '@midnight-demo/ingester/queue';
import type { RunnerJob, RunnerSubmitRequest } from '@midnight-demo/ingester-core';

export interface FetcherLike {
  fetch(request: Request): Promise<Response>;
}

export interface WorkerBindings {
  DB: D1DatabaseLike;
  PARTNER?: FetcherLike;
}

const VAR_NAMES = [
  'MIDNIGHT_NETWORK',
  'CONDITION_REGISTRY_CONTRACT_ADDRESS',
  'PUBLIC_MIDNIGHT_NETWORK',
  'PUBLIC_MIDNIGHT_EXPLORER_URL',
  'PUBLIC_PARTNER_URL',
  'PARTNER_URL',
  'PARTNER_API_KEY',
  'PARTNER_PUBLIC_KEY',
  'INGESTER_SALT_HEX',
  'SESSION_SECRET',
  'ADMIN_WALLET_KEY_HASHES',
  'GUEST_ENTRY',
  'GUEST_SUBMISSION_LIMIT',
  'GUEST_HOURLY_LIMIT',
  'WALLET_NETWORK_ID',
] as const;

export type WorkerVars = Partial<Record<(typeof VAR_NAMES)[number], string>>;

export function workerVars(env: object): Record<string, string | undefined> {
  const source = env as Record<string, unknown>;
  const vars: Record<string, string | undefined> = {};
  for (const name of VAR_NAMES) {
    const value = source[name];
    if (typeof value === 'string') vars[name] = value;
  }
  return vars;
}

export function containerRunner(fetchRunner: (request: Request) => Promise<Response>): ChainRunner {
  async function call(pathname: string, body?: unknown): Promise<Response> {
    return fetchRunner(
      new Request(`http://chain-runner${pathname}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  }
  async function failure(response: Response): Promise<Error> {
    return new Error(`the chain runner answered ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return {
    async startJob(jobId: string, request: RunnerSubmitRequest) {
      const response = await call('/jobs', { jobId, request });
      if (response.status !== 202) throw await failure(response);
    },
    async job(jobId: string) {
      const response = await call(`/jobs/${encodeURIComponent(jobId)}`);
      if (!response.ok) throw await failure(response);
      return (await response.json()) as RunnerJob;
    },
    async readEntries(entryKeys: readonly string[]) {
      if (entryKeys.length === 0) return new Map();
      const response = await call('/read', { entryKeys });
      if (!response.ok) throw await failure(response);
      const { entries } = (await response.json()) as { entries: Record<string, OnChainEntry> };
      return new Map(Object.entries(entries));
    },
  };
}

export function gatewayDeps(env: WorkerBindings & object, runner: ChainRunner): GatewayDeps {
  const vars = workerVars(env);
  const db = d1Database(env.DB);
  const partnerUrl = vars.PARTNER_URL?.trim();
  const apiKey = vars.PARTNER_API_KEY?.trim();
  const publicKeyHex = vars.PARTNER_PUBLIC_KEY?.trim();
  const partnerBinding = env.PARTNER;
  const auth = authConfigFromEnv(vars);
  return {
    db,
    reader: dbConditionReader(db),
    salt: saltFromHex(vars.INGESTER_SALT_HEX),
    config: {
      ...(vars.PUBLIC_MIDNIGHT_NETWORK ? { network: vars.PUBLIC_MIDNIGHT_NETWORK } : {}),
      ...(vars.PUBLIC_MIDNIGHT_EXPLORER_URL ? { explorerUrl: vars.PUBLIC_MIDNIGHT_EXPLORER_URL } : {}),
      ...(vars.PUBLIC_PARTNER_URL || partnerUrl ? { partnerUrl: vars.PUBLIC_PARTNER_URL || partnerUrl } : {}),
      submitQueued: true,
    },
    ...(partnerUrl && apiKey && publicKeyHex ? { partner: { url: partnerUrl, apiKey, publicKeyHex } } : {}),
    ...(partnerBinding
      ? { fetch: ((input: RequestInfo | URL, init?: RequestInit) => partnerBinding.fetch(new Request(input, init))) as typeof fetch }
      : {}),
    ...(auth ? { auth } : {}),
    reconcile: reconcileWith(db, runner),
    submitStaged: enqueueStagedWith(db),
  };
}
