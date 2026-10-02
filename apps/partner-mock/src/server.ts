import { config as loadEnv } from 'dotenv';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyMigrations, createDatabase } from '@midnight-demo/db';

import { handlePartner, type PartnerDeps } from './handler.js';
import { loadPartnerMigrations } from './migrations.js';
import { partnerSigner } from './signing.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
loadEnv({ path: path.join(repoRoot, '.env'), quiet: true });
loadEnv({ path: path.join(repoRoot, '.env.local'), quiet: true });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required (npm run keygen -w @midnight-demo/partner-mock)`);
  return value;
}

function databaseUrl(): string {
  const configured = process.env.PARTNER_DB_URL?.trim();
  if (configured) return configured;
  const dataDir = path.join(repoRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  return `file:${path.join(dataDir, 'partner-mock.db')}`;
}

async function makeDeps(): Promise<PartnerDeps> {
  const db = createDatabase({ url: databaseUrl() });
  await applyMigrations(db, loadPartnerMigrations());
  return {
    db,
    apiKey: required('PARTNER_API_KEY'),
    signer: await partnerSigner(required('PARTNER_SIGNING_KEY')),
    allowedOrigin: process.env.PARTNER_ALLOWED_ORIGIN?.trim() || 'http://localhost:8787',
  };
}

export async function startPartnerServer(port = Number(process.env.PARTNER_PORT ?? 8788)) {
  const deps = await makeDeps();
  const server = http.createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS';
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (typeof value === 'string') headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(', '));
      }
      const result = await handlePartner(
        new Request(`http://${request.headers.host ?? 'localhost'}${request.url ?? '/'}`, {
          method: request.method,
          headers,
          body: hasBody ? Buffer.concat(chunks).toString('utf8') : undefined,
        }),
        deps,
      );
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    })().catch((error) => {
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    });
  });
  server.listen(port, () => {
    process.stdout.write(`partner mock on http://127.0.0.1:${port}  (key ${deps.signer.keyId})\n`);
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) void startPartnerServer();
