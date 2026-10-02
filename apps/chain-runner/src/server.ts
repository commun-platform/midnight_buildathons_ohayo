import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import {
  conditionChain,
  conditionContractAddress,
  getOrCreateWalletCredentials,
  resolveNetwork,
  walletSyncDirectory,
} from '@midnight-demo/midnight-chain';
import { bytesToHex, hexToBytes } from '@midnight-demo/shared';
import { conditionScoreCommitment } from '@midnight-demo/shared/commitment';

import { openCheckpoint, readWalletFiles, sealCheckpoint, writeWalletFiles } from './checkpoint.js';
import { handleRunner, type RunnerDeps } from './handler.js';
import { jobRegistry, type JobRegistry } from './jobs.js';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function log(message: string): void {
  process.stderr.write(`${new Date().toISOString()} ${message}\n`);
}

function trackStage(jobs: JobRegistry): void {
  const write = process.stdout.write.bind(process.stdout) as (...args: unknown[]) => boolean;
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    const line = String(chunk).trim().split('\n').at(-1)?.trim();
    if (line && jobs.running) jobs.setStage(line.slice(0, 200));
    return write(chunk, ...rest);
  }) as typeof process.stdout.write;
}

function checkpointStore(syncDir: string, seed: string, url: string | undefined) {
  return {
    async restore(): Promise<string> {
      if (!url) return 'no checkpoint store configured';
      if (fs.existsSync(path.join(syncDir, 'dust.json'))) return 'local wallet state is present';
      const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (response.status === 404) return 'no checkpoint stored yet; syncing from the seed';
      if (!response.ok) throw new Error(`checkpoint restore returned ${response.status}`);
      writeWalletFiles(syncDir, await openCheckpoint(new Uint8Array(await response.arrayBuffer()), seed));
      return 'restored from the stored checkpoint';
    },
    async save(): Promise<void> {
      if (!url) return;
      const files = readWalletFiles(syncDir);
      if (!files.dust) return;
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: await sealCheckpoint(files, seed),
        signal: AbortSignal.timeout(300_000),
      });
      if (!response.ok) throw new Error(`checkpoint upload returned ${response.status}`);
    },
  };
}

function warmProofServer(proofServer: string): void {
  void fetch(new URL('/ready', proofServer), { signal: AbortSignal.timeout(20 * 60_000) })
    .then((response) => log(`proof server answered ${response.status}`))
    .catch((error: unknown) => log(`proof server warm-up failed: ${errorMessage(error)}`));
}

function makeDeps(): RunnerDeps {
  const network = resolveNetwork(process.env.MIDNIGHT_NETWORK);
  const address = conditionContractAddress();
  const seed = getOrCreateWalletCredentials().seed;
  const jobs = jobRegistry();
  const checkpoint = checkpointStore(
    walletSyncDirectory(network.networkId, seed),
    seed,
    process.env.WALLET_CHECKPOINT_URL?.trim() || undefined,
  );
  trackStage(jobs);
  const fail = (kind: string) => (error: unknown) => {
    const message = `${kind}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
    log(message);
    jobs.abort(message.split('\n')[0]?.slice(0, 500) ?? kind);
  };
  process.on('unhandledRejection', fail('unhandled rejection'));
  process.on('uncaughtException', fail('uncaught exception'));
  return {
    chain: conditionChain(network, address),
    jobs,
    commit: (scoreCenti, nonceHex) => bytesToHex(conditionScoreCommitment(scoreCenti, hexToBytes(nonceHex))),
    async beforeJob() {
      jobs.setStage('restoring the wallet checkpoint');
      const restored = await checkpoint.restore().catch((error: unknown) => {
        log(`checkpoint restore failed, syncing from the seed: ${errorMessage(error)}`);
        return 'checkpoint unavailable; syncing from the seed';
      });
      log(restored);
      jobs.setStage(`wallet sync (${restored})`);
      warmProofServer(network.proofServer);
    },
    async afterJob() {
      jobs.setStage('saving the wallet checkpoint');
      await checkpoint.save().catch((error: unknown) => log(`checkpoint upload failed: ${errorMessage(error)}`));
    },
  };
}

export function startRunner(port = Number(process.env.PORT ?? 8080)) {
  const deps = makeDeps();
  const server = http.createServer((request, response) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(chunk as Buffer);
      const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
      const result = await handleRunner(
        new Request(`http://runner${request.url ?? '/'}`, {
          method: request.method,
          headers: { 'content-type': request.headers['content-type'] ?? 'application/json' },
          body: hasBody ? Buffer.concat(chunks).toString('utf8') : undefined,
        }),
        deps,
      );
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    })().catch((error: unknown) => {
      log(`request failed: ${errorMessage(error)}`);
      response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: errorMessage(error) }));
    });
  });
  server.listen(port, () => log(`chain runner on :${port}`));
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) startRunner();
