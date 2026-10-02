import { config as loadEnv } from 'dotenv';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { dbConditionReader } from '@midnight-demo/condition-read';
import {
  applyMigrations,
  createDatabase,
  libsqlConfigFromEnv,
  loadConditionMigrations,
} from '@midnight-demo/db';
import type { PartnerConfig } from '@midnight-demo/ingester/partner';
import { resetSandbox } from '@midnight-demo/ingester/showcase';
import type { ConditionChain } from '@midnight-demo/ingester-core';

import { authConfigFromEnv } from './auth.js';
import { reconcileWith, submitStagedWith } from './chain-deps.js';
import { saltFromHex, type GatewayDeps } from './deps.js';
import { bytesToHex, hexToBytes } from '@midnight-demo/shared';
import { handleApi } from './routes.js';
import { securityHeaders } from './security.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
loadEnv({ path: path.join(repoRoot, '.env'), quiet: true });
loadEnv({ path: path.join(repoRoot, '.env.local'), quiet: true });

const dashboardDir = path.join(repoRoot, 'apps', 'dashboard', 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function headerRecord(raw: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string') out[key] = value;
    else if (Array.isArray(value)) out[key] = value.join(', ');
  }
  return out;
}

function makeDeps(): GatewayDeps {
  const env = process.env as Record<string, string | undefined>;
  const url = env.LIBSQL_URL?.trim()
    ? env
    : { ...env, LIBSQL_URL: `file:${path.join(repoRoot, 'data', 'ingester-local.db')}` };
  const db = createDatabase(libsqlConfigFromEnv(url));
  return {
    db,
    reader: dbConditionReader(db),
    salt: saltFromHex(env.INGESTER_SALT_HEX),
    config: {
      network: env.PUBLIC_MIDNIGHT_NETWORK,
      explorerUrl: env.PUBLIC_MIDNIGHT_EXPLORER_URL,
      partnerUrl: env.PUBLIC_PARTNER_URL?.trim() || env.PARTNER_URL?.trim() || undefined,
      contractAddress: env.CONDITION_REGISTRY_CONTRACT_ADDRESS?.trim() || undefined,
    },
    partner: partnerFromEnv(env),
    auth: authConfigFromEnv(env),
    ...(env.OPENING_KEY?.trim() ? { openingKeyHex: env.OPENING_KEY.trim() } : {}),
  };
}

function partnerFromEnv(env: Record<string, string | undefined>): PartnerConfig | undefined {
  const url = env.PARTNER_URL?.trim();
  const apiKey = env.PARTNER_API_KEY?.trim();
  const publicKeyHex = env.PARTNER_PUBLIC_KEY?.trim();
  return url && apiKey && publicKeyHex ? { url, apiKey, publicKeyHex } : undefined;
}

async function chainCapability(): Promise<ConditionChain | undefined> {
  const network = process.env.MIDNIGHT_NETWORK?.trim();
  const address = process.env.CONDITION_REGISTRY_CONTRACT_ADDRESS?.trim();
  if (!network || !address) return undefined;
  // @ts-ignore
  const chain = await import('@midnight-demo/midnight-chain').catch(() => null);
  if (!chain) return undefined;
  return chain.conditionChain(chain.resolveNetwork(network), address) as ConditionChain;
}

async function commitmentOpener(): Promise<GatewayDeps['openCommitment']> {
  // @ts-ignore
  const commitment = await import('@midnight-demo/shared/commitment').catch(() => null);
  if (!commitment) return undefined;
  return async (scoreCenti, nonceHex) =>
    bytesToHex(commitment.conditionScoreCommitment(scoreCenti, hexToBytes(nonceHex)));
}

async function serveStatic(pathname: string, headers: Record<string, string>): Promise<Response> {
  if (!fs.existsSync(dashboardDir)) return new Response('Not found', { status: 404 });
  const clean = pathname.replace(/\.\.+/g, '').replace(/^\/+/, '');
  const candidate = clean && !clean.endsWith('/') ? path.join(dashboardDir, clean) : '';
  const file = candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    ? candidate
    : path.join(dashboardDir, 'index.html');
  const body = await fsp.readFile(file);
  return new Response(body, {
    headers: {
      ...headers,
      'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    },
  });
}

const SANDBOX_RESET_MS = 60 * 60_000;

export async function startServer(
  depsInput?: GatewayDeps,
  port = Number(process.env.PORT ?? 8787),
) {
  const deps = depsInput ?? makeDeps();
  await applyMigrations(deps.db, loadConditionMigrations()).catch((err) => {
    process.stderr.write(`migration skipped: ${err instanceof Error ? err.message : String(err)}\n`);
  });
  const chain = deps.reconcile && deps.submitStaged ? undefined : await chainCapability();
  if (chain) {
    deps.reconcile ??= reconcileWith(deps.db, chain);
    deps.submitStaged ??= submitStagedWith(deps.db, chain, deps.salt, deps.openingKeyHex);
    deps.chain ??= chain;
  }
  if (deps.chain) deps.openCommitment ??= await commitmentOpener();

  if (deps.auth?.guestEntry) {
    setInterval(() => {
      resetSandbox(deps.db).catch((error: unknown) => {
        process.stderr.write(`sandbox reset failed: ${error instanceof Error ? error.message : String(error)}
`);
      });
    }, SANDBOX_RESET_MS).unref();
  }

  const staticHeaders = securityHeaders(deps.config?.partnerUrl);

  const server = http.createServer((request, response) => {
    void (async () => {
      const url = `http://${request.headers.host ?? 'localhost'}${request.url ?? '/'}`;
      const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
      const bodyText = hasBody
        ? await new Promise<string>((resolve) => {
            const chunks: Buffer[] = [];
            request.on('data', (c) => chunks.push(c as Buffer));
            request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          })
        : undefined;
      const fetchRequest = new Request(url, {
        method: request.method,
        headers: headerRecord(request.headers),
        body: bodyText,
      });
      const result =
        (await handleApi(fetchRequest, deps)) ??
        (await serveStatic(new URL(url).pathname, staticHeaders));
      response.writeHead(result.status, Object.fromEntries(result.headers));
      const buf = Buffer.from(await result.arrayBuffer());
      response.end(buf);
    })().catch((error) => {
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    });
  });
  server.listen(port, () => {
    process.stdout.write(`gateway on http://127.0.0.1:${port}  (read API + dashboard)\n`);
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) void startServer();
