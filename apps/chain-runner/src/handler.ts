import type { ConditionChain, RunnerSubmitRequest } from '@midnight-demo/ingester-core';
import { hexToBytes } from '@midnight-demo/shared';

import { JobBusyError, type JobRegistry } from './jobs.js';

export interface RunnerDeps {
  chain: ConditionChain;
  jobs: JobRegistry;
  commit?: (scoreCenti: number, nonceHex: string) => string;
  beforeJob?: () => Promise<void>;
  afterJob?: () => Promise<void>;
}

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_READINGS = 50;
const MAX_ENTRY_KEYS = 500;
const JOB_ID = /^[A-Za-z0-9-]{1,64}$/;
const HEX = /^(?:[0-9a-fA-F]{2}){16,64}$/;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function isStringArray(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every((v) => typeof v === 'string');
}

export function parseSubmitRequest(value: unknown): RunnerSubmitRequest | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  if (typeof r.saltHex !== 'string' || !HEX.test(r.saltHex)) return null;
  if (!isStringArray(r.submittedEntryKeys, 100_000)) return null;
  if (!Array.isArray(r.readings) || r.readings.length === 0 || r.readings.length > MAX_READINGS) return null;
  if (!Array.isArray(r.roster) || r.roster.length > 10_000) return null;
  const readings = r.readings.every(
    (x) =>
      x &&
      typeof x === 'object' &&
      typeof (x as Record<string, unknown>).ringId === 'string' &&
      typeof (x as Record<string, unknown>).recordedAt === 'string' &&
      typeof (x as Record<string, unknown>).value === 'number',
  );
  const roster = r.roster.every(
    (x) =>
      x &&
      typeof x === 'object' &&
      typeof (x as Record<string, unknown>).ringId === 'string' &&
      typeof (x as Record<string, unknown>).timezone === 'string',
  );
  if (!readings || !roster) return null;
  return value as RunnerSubmitRequest;
}

async function runJob(deps: RunnerDeps, request: RunnerSubmitRequest) {
  await deps.beforeJob?.();
  try {
    return await deps.chain.submitReadings({
      readings: request.readings,
      roster: request.roster,
      submittedEntryKeys: new Set(request.submittedEntryKeys),
      salt: hexToBytes(request.saltHex),
    });
  } finally {
    await deps.afterJob?.();
  }
}

export async function handleRunner(request: Request, deps: RunnerDeps): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (pathname === '/health') {
    if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });
    return json(200, { ok: true, running: deps.jobs.running, stage: deps.jobs.stage });
  }

  if (pathname === '/jobs') {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
    const body = (await readJson(request)) as { jobId?: unknown; request?: unknown } | null;
    const jobId = typeof body?.jobId === 'string' && JOB_ID.test(body.jobId) ? body.jobId : null;
    const submit = parseSubmitRequest(body?.request);
    if (!jobId || !submit) return json(400, { error: 'Expected { jobId, request }' });
    try {
      const status = deps.jobs.start(jobId, () => runJob(deps, submit));
      return json(202, { jobId, status });
    } catch (error) {
      if (error instanceof JobBusyError) return json(409, { error: error.message });
      throw error;
    }
  }

  const job = pathname.match(/^\/jobs\/([A-Za-z0-9-]{1,64})$/);
  if (job) {
    if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });
    return json(200, deps.jobs.get(job[1] as string));
  }

  if (pathname === '/read') {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
    const body = (await readJson(request)) as { entryKeys?: unknown } | null;
    if (!isStringArray(body?.entryKeys, MAX_ENTRY_KEYS)) return json(400, { error: 'Expected { entryKeys }' });
    const entries = await deps.chain.readEntries(body.entryKeys);
    return json(200, { entries: Object.fromEntries(entries) });
  }

  if (pathname === '/open') {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
    if (!deps.commit) return json(501, { error: 'Commitments are not available' });
    const body = (await readJson(request)) as { scoreCenti?: unknown; nonceHex?: unknown } | null;
    const scoreCenti = body?.scoreCenti;
    const nonceHex = body?.nonceHex;
    if (
      typeof scoreCenti !== 'number' ||
      !Number.isInteger(scoreCenti) ||
      scoreCenti < 0 ||
      scoreCenti > 10_000 ||
      typeof nonceHex !== 'string' ||
      !/^[0-9a-f]{64}$/.test(nonceHex)
    ) {
      return json(400, { error: 'Expected { scoreCenti, nonceHex }' });
    }
    return json(200, { scoreCommitmentHex: deps.commit(scoreCenti, nonceHex) });
  }

  return json(404, { error: 'Not found' });
}
