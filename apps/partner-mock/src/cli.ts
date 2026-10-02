import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { APP_TIME_ZONE, bytesToHex } from '@midnight-demo/shared';

import { generatePartnerKeys } from './signing.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
loadEnv({ path: path.join(repoRoot, '.env'), quiet: true });
loadEnv({ path: path.join(repoRoot, '.env.local'), quiet: true });

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function keygen(): Promise<void> {
  const keys = await generatePartnerKeys();
  const apiKey = bytesToHex(crypto.getRandomValues(new Uint8Array(24)));
  process.stdout.write(
    `PARTNER_SIGNING_KEY=${keys.signingKey}\nPARTNER_PUBLIC_KEY=${keys.publicKeyHex}\nPARTNER_API_KEY=${apiKey}\n`,
  );
}

async function simulate(): Promise<void> {
  const base = process.env.PARTNER_URL?.trim() || 'http://127.0.0.1:8788';
  const apiKey = process.env.PARTNER_API_KEY?.trim();
  if (!apiKey) throw new Error('PARTNER_API_KEY is required');
  const ringIds = (flag('rings') ?? '').split(',').map((r) => r.trim()).filter(Boolean);
  if (ringIds.length === 0) throw new Error('pass --rings ring-1,ring-2');
  const date =
    flag('date') ??
    new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now());
  const response = await fetch(new URL('/v1/simulate', base), {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ringIds, date }),
  });
  process.stdout.write(`${response.status} ${await response.text()}\n`);
  if (!response.ok) process.exitCode = 1;
}

const command = process.argv[2];
const run = command === 'keygen' ? keygen : command === 'simulate' ? simulate : null;
if (!run) {
  process.stdout.write('Usage: cli.ts keygen | simulate --rings ring-1,ring-2 [--date YYYY-MM-DD]\n');
} else {
  run().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
