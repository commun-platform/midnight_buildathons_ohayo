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
  type SqlDatabase,
} from '@midnight-demo/db';

import {
  saltFromHex,
  type GatewayDeps,
  type ReconcileFn,
  type SubmitFn,
  type SubmitStagedFn,
} from './deps.js';
import { handleApi } from './routes.js';

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
    },
  };
}

async function reconcileCapability(db: SqlDatabase): Promise<ReconcileFn | undefined> {
  const network = process.env.MIDNIGHT_NETWORK?.trim();
  const address = process.env.CONDITION_REGISTRY_CONTRACT_ADDRESS?.trim();
  if (!network || !address) return undefined;
  // @ts-ignore
  const chain = await import('@midnight-demo/midnight-chain').catch(() => null);
  if (!chain) return undefined;
  const cfg = chain.resolveNetwork(network);
  return async (entryKeys) => {
    const r = await chain.reconcileSubmissions(db, cfg, address, {
      entryKeys: [...entryKeys],
      phased: true,
    });
    return {
      confirmed: r.confirmed,
      localChecked: r.localChecked,
      mismatches: r.mismatches.length,
      valueMismatches: r.valueMismatches.length,
      missing: r.missing.length,
    };
  };
}

async function submitCapability(db: SqlDatabase, salt: Uint8Array): Promise<SubmitFn | undefined> {
  const network = process.env.MIDNIGHT_NETWORK?.trim();
  const address = process.env.CONDITION_REGISTRY_CONTRACT_ADDRESS?.trim();
  if (!network || !address) return undefined;
  // @ts-ignore
  const chain = await import('@midnight-demo/midnight-chain').catch(() => null);
  if (!chain) return undefined;
  const cfg = chain.resolveNetwork(network);
  return async ({ ringId, value, recordedAt, tamper }) => {
    try {
      const r = await chain.submitReading(db, cfg, address, {
        ringId,
        value,
        recordedAt,
        salt,
        tamper,
      });
      return {
        ok: true as const,
        entryKey: r.entryKey,
        ringId: r.ringId,
        periodStartMs: r.periodStartMs,
        band: r.band,
        storedBand: r.storedBand,
        tampered: r.tampered,
        txId: r.txId,
        blockHeight: r.blockHeight,
        recovered: r.recovered,
      };
    } catch (error) {
      const reason = notPlannableReason(error);
      if (reason !== null) return { ok: false as const, reason: `not plannable (${reason})` };
      throw error;
    }
  };
}

async function submitStagedCapability(
  db: SqlDatabase,
  salt: Uint8Array,
): Promise<SubmitStagedFn | undefined> {
  const network = process.env.MIDNIGHT_NETWORK?.trim();
  const address = process.env.CONDITION_REGISTRY_CONTRACT_ADDRESS?.trim();
  if (!network || !address) return undefined;
  // @ts-ignore
  const chain = await import('@midnight-demo/midnight-chain').catch(() => null);
  if (!chain) return undefined;
  const cfg = chain.resolveNetwork(network);
  return () => chain.submitStagedFeed(db, cfg, address, salt);
}

function notPlannableReason(error: unknown): string | null {
  if (error instanceof Error && error.name === 'ReadingNotPlannable') {
    return (error as { reason?: { kind?: string } }).reason?.kind ?? 'unknown';
  }
  return null;
}

async function serveStatic(pathname: string): Promise<Response> {
  if (!fs.existsSync(dashboardDir)) return new Response('Not found', { status: 404 });
  const clean = pathname.replace(/\.\.+/g, '').replace(/^\/+/, '');
  const candidate = clean && !clean.endsWith('/') ? path.join(dashboardDir, clean) : '';
  const file = candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    ? candidate
    : path.join(dashboardDir, 'index.html');
  const body = await fsp.readFile(file);
  return new Response(body, {
    headers: { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' },
  });
}

export async function startServer(
  depsInput?: GatewayDeps,
  port = Number(process.env.PORT ?? 8787),
) {
  const deps = depsInput ?? makeDeps();
  await applyMigrations(deps.db, loadConditionMigrations()).catch((err) => {
    process.stderr.write(`migration skipped: ${err instanceof Error ? err.message : String(err)}\n`);
  });
  if (!deps.reconcile) deps.reconcile = await reconcileCapability(deps.db);
  if (!deps.submit) deps.submit = await submitCapability(deps.db, deps.salt);
  if (!deps.submitStaged) deps.submitStaged = await submitStagedCapability(deps.db, deps.salt);

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
        (await serveStatic(new URL(url).pathname));
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
