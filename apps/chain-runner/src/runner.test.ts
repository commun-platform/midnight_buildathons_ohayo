import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ConditionChain, ReadingOutcome, RunnerSubmitRequest } from '@midnight-demo/ingester-core';

import { openCheckpoint, readWalletFiles, sealCheckpoint, writeWalletFiles } from './checkpoint.js';
import { handleRunner, parseSubmitRequest, type RunnerDeps } from './handler.js';
import { jobRegistry } from './jobs.js';

const seed = 'ab'.repeat(32);
const otherSeed = 'cd'.repeat(32);

const submit: RunnerSubmitRequest = {
  readings: [{ ringId: 'ring-1', recordedAt: '2026-08-20T08:30:00+09:00', value: 72 }],
  roster: [{ ringId: 'ring-1', timezone: 'Asia/Tokyo' }],
  submittedEntryKeys: [],
  saltHex: '5a'.repeat(16),
};

function post(pathname: string, body: unknown): Request {
  return new Request(`http://runner${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function deps(options: { gate?: Promise<void>; fail?: string } = {}): RunnerDeps & { seen: unknown[] } {
  const seen: unknown[] = [];
  const outcome: ReadingOutcome = { status: 'failed', error: 'placeholder' };
  const chain: ConditionChain = {
    async submitReadings(request) {
      seen.push(request);
      await options.gate;
      if (options.fail) throw new Error(options.fail);
      return request.readings.map(() => outcome);
    },
    async readEntries(keys) {
      return new Map(
        keys
          .filter((k) => k === '42')
          .map((k) => [k, { band: 'normal' as const, periodStartMs: 1, recordedAtMs: 2, scoreCommitmentHex: 'aa', verified: true }]),
      );
    },
  };
  return { chain, jobs: jobRegistry(), seen };
}

test('a sealed wallet checkpoint opens only with the same seed', async () => {
  const files = { shielded: '{"a":1}', unshielded: '{"b":2}', dust: '{"c":3}' };
  const sealed = await sealCheckpoint(files, seed);
  assert.ok(!new TextDecoder().decode(sealed).includes('"c":3'));
  assert.deepEqual(await openCheckpoint(sealed, seed), files);
  await assert.rejects(openCheckpoint(sealed, otherSeed), /does not open/);
  const tampered = sealed.slice();
  tampered[tampered.length - 1] = (tampered[tampered.length - 1] as number) ^ 1;
  await assert.rejects(openCheckpoint(tampered, seed), /does not open/);
  await assert.rejects(openCheckpoint(new Uint8Array(10), seed), /invalid size/);
});

test('wallet files round-trip through a directory', () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'runner-')), 'sync');
  writeWalletFiles(dir, { dust: 'D', shielded: 'S' });
  assert.deepEqual(readWalletFiles(dir), { shielded: 'S', dust: 'D' });
});

test('a job runs once, reports its stage while running, then its outcomes', async () => {
  let release!: () => void;
  const d = deps({ gate: new Promise<void>((resolve) => (release = resolve)) });
  const started = await handleRunner(post('/jobs', { jobId: 'job-1', request: submit }), d);
  assert.equal(started.status, 202);
  assert.deepEqual(await started.json(), { jobId: 'job-1', status: 'started' });

  d.jobs.setStage('Sync progress: 10%');
  const running = await handleRunner(new Request('http://runner/jobs/job-1'), d);
  assert.deepEqual(await running.json(), { state: 'running', stage: 'Sync progress: 10%' });

  const again = await handleRunner(post('/jobs', { jobId: 'job-1', request: submit }), d);
  assert.deepEqual(await again.json(), { jobId: 'job-1', status: 'exists' });
  const busy = await handleRunner(post('/jobs', { jobId: 'job-2', request: submit }), d);
  assert.equal(busy.status, 409);

  release();
  await d.jobs.settled();
  const done = (await (await handleRunner(new Request('http://runner/jobs/job-1'), d)).json()) as {
    state: string;
    outcomes: unknown[];
  };
  assert.equal(done.state, 'done');
  assert.equal(done.outcomes.length, 1);
  assert.equal(d.seen.length, 1);
  const health = await (await handleRunner(new Request('http://runner/health'), d)).json();
  assert.deepEqual(health, { ok: true, running: null, stage: null });
});

test('a job that throws is reported as failed and frees the runner', async () => {
  const d = deps({ fail: 'Wallet has no tNIGHT' });
  await handleRunner(post('/jobs', { jobId: 'job-1', request: submit }), d);
  await d.jobs.settled();
  assert.deepEqual(await (await handleRunner(new Request('http://runner/jobs/job-1'), d)).json(), {
    state: 'failed',
    error: 'Wallet has no tNIGHT',
  });
  const next = await handleRunner(post('/jobs', { jobId: 'job-2', request: submit }), d);
  assert.equal(next.status, 202);
});

test('an unknown job is reported as unknown', async () => {
  const d = deps();
  assert.deepEqual(await (await handleRunner(new Request('http://runner/jobs/nope'), d)).json(), { state: 'unknown' });
});

test('malformed job requests are rejected', async () => {
  const d = deps();
  for (const body of [
    { jobId: 'job 1', request: submit },
    { jobId: 'job-1' },
    { jobId: 'job-1', request: { ...submit, saltHex: 'zz' } },
    { jobId: 'job-1', request: { ...submit, readings: [] } },
    { jobId: 'job-1', request: { ...submit, readings: [{ ringId: 'r', recordedAt: 'x', value: '72' }] } },
  ]) {
    assert.equal((await handleRunner(post('/jobs', body), d)).status, 400);
  }
  assert.equal(parseSubmitRequest(submit), submit);
  assert.equal(d.seen.length, 0);
});

test('read returns only the entries the chain has', async () => {
  const d = deps();
  const response = await handleRunner(post('/read', { entryKeys: ['42', '43'] }), d);
  assert.deepEqual(await response.json(), {
    entries: { '42': { band: 'normal', periodStartMs: 1, recordedAtMs: 2, scoreCommitmentHex: 'aa', verified: true } },
  });
  assert.equal((await handleRunner(post('/read', { entryKeys: 'x' }), d)).status, 400);
});

test('an aborted job is reported as failed, frees the runner, and a late result does not overwrite it', async () => {
  let release!: () => void;
  const d = deps({ gate: new Promise<void>((resolve) => (release = resolve)) });
  await handleRunner(post('/jobs', { jobId: 'job-1', request: submit }), d);
  d.jobs.abort('unhandled rejection: socket hang up');
  assert.deepEqual(await (await handleRunner(new Request('http://runner/jobs/job-1'), d)).json(), {
    state: 'failed',
    error: 'unhandled rejection: socket hang up',
  });
  assert.equal((await handleRunner(post('/jobs', { jobId: 'job-2', request: submit }), d)).status, 202);
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(((await (await handleRunner(new Request('http://runner/jobs/job-1'), d)).json()) as { state: string }).state, 'failed');
});

test('open recomputes a commitment and rejects malformed input', async () => {
  const d = { ...deps(), commit: (scoreCenti: number, nonceHex: string) => `${scoreCenti}:${nonceHex.slice(0, 4)}` };
  const ok = await handleRunner(post('/open', { scoreCenti: 7200, nonceHex: '11'.repeat(32) }), d);
  assert.deepEqual(await ok.json(), { scoreCommitmentHex: '7200:1111' });
  assert.equal((await handleRunner(post('/open', { scoreCenti: 7200.5, nonceHex: '11'.repeat(32) }), d)).status, 400);
  assert.equal((await handleRunner(post('/open', { scoreCenti: 7200, nonceHex: 'zz' }), d)).status, 400);
  assert.equal((await handleRunner(post('/open', { scoreCenti: 7200, nonceHex: '11'.repeat(32) }), deps())).status, 501);
});
