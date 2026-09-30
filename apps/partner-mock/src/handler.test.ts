import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { applyMigrations, createDatabase } from '@midnight-demo/db';
import { importPartnerPublicKey, partnerKeyId, verifyPartnerScore } from '@midnight-demo/shared';

import { handlePartner, type PartnerDeps } from './handler.js';
import { loadPartnerMigrations } from './migrations.js';
import { scoreFromVitals } from './score.js';
import { generatePartnerKeys, partnerSigner } from './signing.js';

const API_KEY = 'test-partner-key';
const ORIGIN = 'http://localhost:8787';

async function partnerDeps(pageSize?: number): Promise<PartnerDeps> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'partner-')), 'partner.db');
  const db = createDatabase({ url: `file:${file}` });
  await applyMigrations(db, loadPartnerMigrations());
  const keys = await generatePartnerKeys();
  return { db, apiKey: API_KEY, signer: await partnerSigner(keys.signingKey), allowedOrigin: ORIGIN, pageSize };
}

function call(deps: PartnerDeps, method: string, pathname: string, init: { body?: unknown; key?: string; headers?: Record<string, string> } = {}) {
  return handlePartner(
    new Request(`http://partner${pathname}`, {
      method,
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(init.key ? { authorization: `Bearer ${init.key}` } : {}),
        ...init.headers,
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    }),
    deps,
  );
}

const goodVitals = { heartRate: 55, hrvMs: 80, sleepHours: 8, spo2: 98, skinTempDelta: 0 };
const badVitals = { heartRate: 110, hrvMs: 10, sleepHours: 0, spo2: 85, skinTempDelta: 2 };

test('the score formula spans 0..100 and is deterministic', () => {
  assert.equal(scoreFromVitals(goodVitals), 100);
  assert.equal(scoreFromVitals(badVitals), 0);
  const mid = { heartRate: 72, hrvMs: 45, sleepHours: 6, spo2: 95, skinTempDelta: 0.3 };
  assert.equal(scoreFromVitals(mid), scoreFromVitals({ ...mid }));
  assert.equal(scoreFromVitals(mid), 60.58);
});

test('POST /v1/measurements scores vitals or accepts a score, and rejects bad input', async () => {
  const deps = await partnerDeps();
  const fromVitals = await call(deps, 'POST', '/v1/measurements', {
    body: { ringId: 'ring-1', measuredAt: '2026-09-30T07:30:00+09:00', vitals: goodVitals },
  });
  assert.equal(fromVitals.status, 201);
  const created = await fromVitals.json() as any;
  assert.equal(created.score, 100);
  assert.equal(created.measuredAt, '2026-09-29T22:30:00.000Z');

  const direct = await (await call(deps, 'POST', '/v1/measurements', {
    body: { ringId: 'ring-1', measuredAt: '2026-09-30T08:00:00Z', score: 41.237 },
  })).json() as any;
  assert.equal(direct.score, 41.24);

  for (const body of [
    { ringId: '', measuredAt: '2026-09-30T08:00:00Z', score: 50 },
    { ringId: 'ring-1', measuredAt: 'yesterday', score: 50 },
    { ringId: 'ring-1', measuredAt: '2026-09-30T08:00:00Z', score: 101 },
    { ringId: 'ring-1', measuredAt: '2026-09-30T08:00:00Z', vitals: { heartRate: 60 } },
  ]) {
    assert.equal((await call(deps, 'POST', '/v1/measurements', { body })).status, 400);
  }
});

test('CORS is granted only to the configured SADAKO origin', async () => {
  const deps = await partnerDeps();
  const preflight = (origin: string, headers = 'content-type') =>
    call(deps, 'OPTIONS', '/v1/measurements', {
      headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': headers },
    });

  const ok = await preflight(ORIGIN);
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal((await preflight('https://evil.example')).status, 403);
  assert.equal((await preflight(ORIGIN, 'content-type, authorization')).status, 403);

  const posted = await call(deps, 'POST', '/v1/measurements', {
    body: { ringId: 'ring-1', measuredAt: '2026-09-30T08:00:00Z', score: 50 },
    headers: { origin: 'https://evil.example' },
  });
  assert.equal(posted.headers.get('access-control-allow-origin'), null);
});

test('GET /v1/daily-scores needs the API key, pages by cursor, and signs every score', async () => {
  const deps = await partnerDeps(2);
  for (const minute of ['00', '01', '02']) {
    await call(deps, 'POST', '/v1/measurements', {
      body: { ringId: 'ring-1', measuredAt: `2026-09-30T08:${minute}:00Z`, score: 60 },
    });
  }

  assert.equal((await call(deps, 'GET', '/v1/daily-scores')).status, 401);
  assert.equal((await call(deps, 'GET', '/v1/daily-scores', { key: 'wrong' })).status, 401);
  assert.equal((await call(deps, 'GET', '/v1/daily-scores?since=abc', { key: API_KEY })).status, 400);

  const first = await (await call(deps, 'GET', '/v1/daily-scores', { key: API_KEY })).json() as any;
  assert.equal(first.schemaVersion, 1);
  assert.equal(first.keyId, await partnerKeyId(deps.signer.publicKeyHex));
  assert.equal(first.scores.length, 2);
  const second = await (await call(deps, 'GET', `/v1/daily-scores?since=${first.nextCursor}`, { key: API_KEY })).json() as any;
  assert.equal(second.scores.length, 1);
  const done = await (await call(deps, 'GET', `/v1/daily-scores?since=${second.nextCursor}`, { key: API_KEY })).json() as any;
  assert.deepEqual(done.scores, []);
  assert.equal(done.nextCursor, second.nextCursor);

  const key = await importPartnerPublicKey(deps.signer.publicKeyHex);
  for (const score of [...first.scores, ...second.scores]) {
    assert.equal(await verifyPartnerScore(key, score), true);
    assert.equal(await verifyPartnerScore(key, { ...score, score: score.score + 1 }), false);
  }
  const again = await (await call(deps, 'GET', '/v1/daily-scores', { key: API_KEY })).json() as any;
  assert.deepEqual(again.scores, first.scores);
});

test('POST /v1/simulate is deterministic and idempotent', async () => {
  const deps = await partnerDeps();
  const body = { ringIds: ['ring-1', 'ring-2'], date: '2026-09-30' };
  assert.equal((await call(deps, 'POST', '/v1/simulate', { body })).status, 401);

  const first = await (await call(deps, 'POST', '/v1/simulate', { body, key: API_KEY })).json() as any;
  assert.deepEqual(first.scores.map((s: { created: boolean }) => s.created), [true, true]);
  for (const s of first.scores) assert.ok(s.score >= 20 && s.score <= 100);
  const again = await (await call(deps, 'POST', '/v1/simulate', { body, key: API_KEY })).json() as any;
  assert.deepEqual(again.scores.map((s: { created: boolean }) => s.created), [false, false]);
  assert.deepEqual(again.scores.map((s: { score: number }) => s.score), first.scores.map((s: { score: number }) => s.score));

  assert.equal((await call(deps, 'POST', '/v1/simulate', { body: { ringIds: [], date: '2026-09-30' }, key: API_KEY })).status, 400);
  assert.equal((await call(deps, 'POST', '/v1/simulate', { body: { ringIds: ['ring-1'], date: '30/09' }, key: API_KEY })).status, 400);
});

test('health and unknown routes', async () => {
  const deps = await partnerDeps();
  assert.deepEqual(await (await call(deps, 'GET', '/health')).json(), { ok: true });
  assert.equal((await call(deps, 'GET', '/v1/nope')).status, 404);
});
