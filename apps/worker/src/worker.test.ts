import assert from 'node:assert/strict';
import test from 'node:test';

import type { D1DatabaseLike } from '@midnight-demo/db/d1';

import { handleCheckpoint, MAX_CHECKPOINT_BYTES, walletCheckpointKey, walletCheckpointPreviousKey } from './checkpoint-store.js';
import { containerRunner, gatewayDeps, workerVars } from './deps.js';

function memoryBucket() {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async get(key: string) {
      const value = objects.get(key);
      return value ? { body: new Response(value).body as ReadableStream, size: value.length } : null;
    },
    async put(key: string, value: ArrayBuffer) {
      objects.set(key, new Uint8Array(value));
    },
  };
}

const unusedDb = {} as D1DatabaseLike;

test('the checkpoint store keeps the latest upload and the one before it', async () => {
  const bucket = memoryBucket();
  const url = 'http://state.internal/checkpoint';
  assert.equal((await handleCheckpoint(new Request(url), bucket, 'preprod')).status, 404);

  const put = (bytes: number[]) =>
    handleCheckpoint(new Request(url, { method: 'PUT', body: new Uint8Array(bytes) }), bucket, 'preprod');
  assert.equal((await put([1, 2, 3])).status, 204);
  assert.equal((await put([4, 5])).status, 204);
  assert.deepEqual([...(bucket.objects.get(walletCheckpointKey('preprod')) ?? [])], [4, 5]);
  assert.deepEqual([...(bucket.objects.get(walletCheckpointPreviousKey('preprod')) ?? [])], [1, 2, 3]);

  const restored = await handleCheckpoint(new Request(url), bucket, 'preprod');
  assert.deepEqual([...new Uint8Array(await restored.arrayBuffer())], [4, 5]);
});

test('the checkpoint store rejects empty and oversized uploads and other paths', async () => {
  const bucket = memoryBucket();
  const url = 'http://state.internal/checkpoint';
  assert.equal((await handleCheckpoint(new Request(url, { method: 'PUT', body: new Uint8Array() }), bucket, 'preprod')).status, 413);
  const declared = new Request(url, {
    method: 'PUT',
    headers: { 'content-length': String(MAX_CHECKPOINT_BYTES + 1) },
    body: new Uint8Array([1]),
  });
  assert.equal((await handleCheckpoint(declared, bucket, 'preprod')).status, 413);
  assert.equal((await handleCheckpoint(new Request('http://state.internal/other'), bucket, 'preprod')).status, 404);
  assert.equal((await handleCheckpoint(new Request(url, { method: 'DELETE' }), bucket, 'preprod')).status, 405);
  assert.equal(bucket.objects.size, 0);
});

test('the runner client posts jobs, polls them and reads entries', async () => {
  const seen: Array<{ method: string; path: string; body: string }> = [];
  const runner = containerRunner(async (request) => {
    const path = new URL(request.url).pathname;
    seen.push({ method: request.method, path, body: request.method === 'POST' ? await request.text() : '' });
    if (path === '/jobs') return new Response('{}', { status: 202 });
    if (path === '/jobs/job-1') return Response.json({ state: 'running', stage: 'syncing' });
    if (path === '/read') {
      return Response.json({
        entries: { '42': { band: 'normal', periodStartMs: 1, recordedAtMs: 2, scoreCommitmentHex: 'aa', verified: true } },
      });
    }
    return new Response('nope', { status: 404 });
  });
  const request = { readings: [], roster: [], submittedEntryKeys: [], saltHex: '00'.repeat(16) };
  await runner.startJob('job-1', request);
  assert.deepEqual(JSON.parse(seen[0]?.body ?? ''), { jobId: 'job-1', request });
  assert.deepEqual(await runner.job('job-1'), { state: 'running', stage: 'syncing' });
  const entries = await runner.readEntries(['42']);
  assert.equal(entries.get('42')?.band, 'normal');
  assert.equal((await runner.readEntries([])).size, 0);
  assert.equal(seen.filter((s) => s.path === '/read').length, 1);
});

test('the runner client turns a refused job into an error', async () => {
  const runner = containerRunner(async () => new Response('job job-0 is still running', { status: 409 }));
  await assert.rejects(
    runner.startJob('job-1', { readings: [], roster: [], submittedEntryKeys: [], saltHex: '00'.repeat(16) }),
    /409: job job-0 is still running/,
  );
  await assert.rejects(runner.job('job-1'), /409/);
});

test('the Worker deps queue submissions and route partner pulls through the service binding', async () => {
  const partnerCalls: string[] = [];
  const env = {
    DB: unusedDb,
    PARTNER: {
      async fetch(request: Request) {
        partnerCalls.push(request.url);
        return new Response('ok');
      },
    },
    INGESTER_SALT_HEX: '5a'.repeat(16),
    SESSION_SECRET: 's'.repeat(40),
    PUBLIC_PARTNER_URL: 'https://ohayo-partner.example.workers.dev',
    PARTNER_URL: 'https://ohayo-partner.example.workers.dev',
    PARTNER_API_KEY: 'key',
    PARTNER_PUBLIC_KEY: 'ab'.repeat(32),
    GUEST_ENTRY: '1',
    OPERATING_WALLET_MNEMONIC: 'never exposed to the gateway',
  };
  const deps = gatewayDeps(env, containerRunner(async () => new Response('{}')));
  assert.equal(deps.config?.submitQueued, true);
  assert.equal(deps.config?.partnerUrl, 'https://ohayo-partner.example.workers.dev');
  assert.equal(deps.partner?.apiKey, 'key');
  assert.equal(deps.auth?.guestEntry, true);
  await deps.fetch?.('https://ohayo-partner.example.workers.dev/v1/daily-scores?since=0');
  assert.deepEqual(partnerCalls, ['https://ohayo-partner.example.workers.dev/v1/daily-scores?since=0']);
  assert.ok(!('OPERATING_WALLET_MNEMONIC' in workerVars(env)));
});

test('the Worker deps have no partner and no login without their settings', () => {
  const deps = gatewayDeps({ DB: unusedDb, INGESTER_SALT_HEX: '5a'.repeat(16) }, containerRunner(async () => new Response('{}')));
  assert.equal(deps.partner, undefined);
  assert.equal(deps.auth, undefined);
  assert.equal(deps.fetch, undefined);
  assert.throws(() => gatewayDeps({ DB: unusedDb }, containerRunner(async () => new Response('{}'))), /INGESTER_SALT_HEX/);
});
