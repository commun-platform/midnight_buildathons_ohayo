import fs from 'node:fs';
import path from 'node:path';

import { getOrCreateWalletCredentials, resolveNetwork, walletSyncDirectory } from '@midnight-demo/midnight-chain';

import { readWalletFiles, sealCheckpoint } from './checkpoint.js';

async function main(): Promise<void> {
  const [command, flag, out] = process.argv.slice(2);
  if (command !== 'export' || flag !== '--out' || !out) {
    throw new Error('usage: checkpoint export --out <file>');
  }
  const network = resolveNetwork(process.env.MIDNIGHT_NETWORK);
  const seed = getOrCreateWalletCredentials().seed;
  const dir = walletSyncDirectory(network.networkId, seed);
  const files = readWalletFiles(dir);
  if (!files.dust) {
    throw new Error(`no synced wallet state in ${dir} - run the ${network.networkId} deploy or status first`);
  }
  const sealed = await sealCheckpoint(files, seed);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true, mode: 0o700 });
  fs.writeFileSync(out, sealed, { mode: 0o600 });
  process.stdout.write(`sealed ${network.networkId} wallet checkpoint: ${out} (${sealed.length} bytes)\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
