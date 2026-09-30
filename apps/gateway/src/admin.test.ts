import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { fakeReader } from '@midnight-demo/condition-read';
import {
  applyMigrations,
  createDatabase,
  loadConditionMigrations,
  type SqlDatabase,
} from '@midnight-demo/db';
import { handlePartner } from '@midnight-demo/partner-mock/handler';
import { loadPartnerMigrations } from '@midnight-demo/partner-mock/migrations';
import { generatePartnerKeys, partnerSigner } from '@midnight-demo/partner-mock/signing';

import { handleApi } from './routes.js';

const SALT = new Uint8Array(16).fill(0x5a);
const ADMIN = 'admin';

async function bareDb(): Promise<SqlDatabase> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gw-admin-')), 'test.db');
  const db = createDatabase({ url: `file:${file}` });
  await applyMigrations(db, loadConditionMigrations());
  return db;
}

function req(method: string, path: string, body?: unknown, token?: string): Request {
  return new Request(`http://gw${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
const POST = (p: string, b: unknown, t?: string) => req('POST', p, b, t);
const PATCH = (p: string, b: unknown, t?: string) => req('PATCH', p, b, t);
const DEL = (p: string, t?: string) => req('DELETE', p, undefined, t);
const GET = (p: string, t?: string) => req('GET', p, undefined, t);

async function body(r: Response | null): Promise<any> {
  assert.ok(r);
  return r.json();
}

test('admin roster: build ring → worker → assign', async () => {
  const db = await bareDb();
  const deps = { db, reader: fakeReader(new Map()), salt: SALT };
  const call = (r: Request) => handleApi(r, deps);

  assert.equal((await call(GET('/api/roster')))?.status, 401);

  const empty = await body(await call(GET('/api/roster', ADMIN)));
  assert.deepEqual([empty.rings, empty.workers], [[], []]);

  const ring = await body(await call(POST('/api/rings', { id: 'ring-1', label: 'RING-A' }, ADMIN)));
  assert.equal(ring.id, 'ring-1');
  assert.equal(
    (await call(POST('/api/rings', { id: 'ring-1', label: 'RING-A' }, ADMIN)))?.status,
    409,
  );

  const worker = await body(
    await call(POST('/api/workers', { id: 'worker-1', name: '作業員 一郎' }, ADMIN)),
  );
  assert.equal(worker.id, 'worker-1');

  assert.equal((await call(GET('/api/roster', 'worker-1')))?.status, 403);

  assert.equal((await call(PATCH('/api/rings/ring-1', { workerId: 'nope' }, ADMIN)))?.status, 404);
  assert.equal((await call(PATCH('/api/rings/ring-1', { workerId: 'worker-1' }, ADMIN)))?.status, 200);

  const full = await body(await call(GET('/api/roster', ADMIN)));
  assert.equal(full.rings[0].workerName, '作業員 一郎');
  assert.equal(full.workers[0].assignedRing, 'ring-1');

  assert.equal((await call(DEL('/api/workers/worker-1', ADMIN)))?.status, 409);
  assert.equal((await call(PATCH('/api/rings/ring-1', { workerId: null }, ADMIN)))?.status, 200);
  assert.equal((await call(DEL('/api/workers/worker-1', ADMIN)))?.status, 200);
});

test('admin queue: list and delete readings, but never enter or edit a score', async () => {
  const db = await bareDb();
  const deps = { db, reader: fakeReader(new Map()), salt: SALT };
  const call = (r: Request) => handleApi(r, deps);

  await call(POST('/api/rings', { id: 'ring-1', label: 'RING-A' }, ADMIN));
  assert.deepEqual((await body(await call(GET('/api/staged', ADMIN)))).rows, []);

  assert.equal(
    (await call(POST('/api/staged', { ringId: 'ring-1', recordedAt: '2026-08-20T08:30:00+09:00', value: 72 }, ADMIN)))?.status,
    405,
  );
  await db.execute(
    `INSERT INTO condition_readings (ring_id, recorded_at, value, source, status, created_at)
     VALUES ('ring-1', '2026-08-20T08:30:00+09:00', 72, 'partner_api', 'pending', '2026-08-20T00:00:00Z')`,
  );
  const rows = (await body(await call(GET('/api/staged', ADMIN)))).rows;
  assert.equal(rows.length, 1);
  const id = rows[0].id as number;
  assert.equal((await call(PATCH(`/api/staged/${id}`, { value: 30 }, ADMIN)))?.status, 405);
  assert.equal((await call(GET('/api/staged', 'worker-1')))?.status, 401);

  assert.equal((await call(DEL(`/api/staged/${id}`, ADMIN)))?.status, 200);
  assert.equal((await call(DEL(`/api/staged/${id}`, ADMIN)))?.status, 404);

  assert.equal((await call(POST('/api/staged/submit', {}, ADMIN)))?.status, 501);
  assert.equal(
    (await call(POST('/api/submit', { ringId: 'ring-1', value: 50, recordedAt: '2026-08-20T08:30:00+09:00' }, ADMIN)))?.status,
    405,
  );
});

test('admin queue submit passes the tamper option through and is admin-only', async () => {
  const db = await bareDb();
  const seen: Array<{ tamper?: boolean }> = [];
  const deps = {
    db,
    reader: fakeReader(new Map()),
    salt: SALT,
    submitStaged: async (options: { tamper?: boolean }) => {
      seen.push(options);
      return { submitted: 1, skipped: 0, failed: 0, tampered: options.tamper ? 1 : 0, reconcile: null };
    },
  };
  const call = (r: Request) => handleApi(r, deps);

  assert.equal((await body(await call(GET('/api/config')))).submitEnabled, true);
  assert.equal((await call(POST('/api/staged/submit', {}, 'worker-1')))?.status, 401);
  assert.equal((await body(await call(POST('/api/staged/submit', {}, ADMIN)))).tampered, 0);
  assert.equal((await body(await call(POST('/api/staged/submit', { tamper: true }, ADMIN)))).tampered, 1);
  assert.equal((await body(await call(POST('/api/staged/submit', { tamper: 'yes' }, ADMIN)))).tampered, 0);
  assert.deepEqual(seen, [{ tamper: false }, { tamper: true }, { tamper: false }]);
});

async function partnerPeer() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gw-partner-')), 'partner.db');
  const db = createDatabase({ url: `file:${file}` });
  await applyMigrations(db, loadPartnerMigrations());
  const keys = await generatePartnerKeys();
  const deps = { db, apiKey: 'partner-key', signer: await partnerSigner(keys.signingKey), allowedOrigin: 'http://gw' };
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) =>
    handlePartner(new Request(input, init), deps)) as typeof fetch;
  return { deps, fetchFn, config: { url: 'http://partner', apiKey: 'partner-key', publicKeyHex: keys.publicKeyHex } };
}

test('admin partner pull: queue signed partner scores without exposing the raw value', async () => {
  const db = await bareDb();
  const peer = await partnerPeer();
  const base = { db, reader: fakeReader(new Map()), salt: SALT };
  await handleApi(POST('/api/rings', { id: 'ring-1', label: 'RING-A' }, ADMIN), base);

  assert.equal((await handleApi(POST('/api/partner/pull', {}, ADMIN), base))?.status, 501);

  const deps = { ...base, partner: peer.config, fetch: peer.fetchFn };
  const call = (r: Request) => handleApi(r, deps);
  assert.equal((await call(POST('/api/partner/pull', {}, 'worker-1')))?.status, 401);
  assert.equal((await call(GET('/api/partner/pull', ADMIN)))?.status, 405);
  assert.equal((await body(await call(GET('/api/config')))).partnerPullEnabled, true);

  await handlePartner(
    new Request('http://partner/v1/measurements', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ringId: 'ring-1', measuredAt: '2026-09-30T08:00:00+09:00', score: 33 }),
    }),
    peer.deps,
  );
  await handlePartner(
    new Request('http://partner/v1/simulate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer partner-key' },
      body: JSON.stringify({ ringIds: ['ring-9'], date: '2026-09-30' }),
    }),
    peer.deps,
  );

  const pulled = await body(await call(POST('/api/partner/pull', {}, ADMIN)));
  assert.equal(pulled.fetched, 2);
  assert.equal(pulled.inserted, 1);
  assert.equal(pulled.unknownRing, 1);
  assert.equal(pulled.badSignature, 0);

  const staged = await body(await call(GET('/api/staged', ADMIN)));
  assert.equal(staged.rows.length, 1);
  const row = staged.rows[0];
  assert.equal(row.source, 'partner_api');
  assert.equal(row.value, null);
  assert.equal(row.band, 'danger');
  assert.equal(row.status, 'pending');
  assert.ok(!JSON.stringify(staged).includes('33'));

  assert.equal((await call(PATCH(`/api/staged/${row.id}`, { value: 90 }, ADMIN)))?.status, 405);
  assert.equal((await body(await call(POST('/api/partner/pull', {}, ADMIN)))).fetched, 0);

  const unreachable = { ...deps, fetch: (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch };
  assert.equal((await handleApi(POST('/api/partner/pull', {}, ADMIN), unreachable))?.status, 502);
});
