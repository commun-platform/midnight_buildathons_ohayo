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

test('admin feed: condition_readings CRUD + submit 501', async () => {
  const db = await bareDb();
  const deps = { db, reader: fakeReader(new Map()), salt: SALT };
  const call = (r: Request) => handleApi(r, deps);

  await call(POST('/api/rings', { id: 'ring-1', label: 'RING-A' }, ADMIN));

  assert.deepEqual((await body(await call(GET('/api/staged', ADMIN)))).rows, []);

  const added = await body(
    await call(POST('/api/staged', { ringId: 'ring-1', recordedAt: '2026-08-20T08:30:00+09:00', value: 72 }, ADMIN)),
  );
  assert.equal(added.band, 'normal');
  assert.equal(added.status, 'pending');
  const id = added.id as number;

  assert.equal(
    (await call(POST('/api/staged', { ringId: 'ring-1', recordedAt: '2026-08-20T08:30:00+09:00', value: 200 }, ADMIN)))?.status,
    400,
  );
  assert.equal(
    (await call(POST('/api/staged', { ringId: 'ring-z', recordedAt: '2026-08-20T08:30:00+09:00', value: 50 }, ADMIN)))?.status,
    404,
  );

  const patched = await body(await call(PATCH(`/api/staged/${id}`, { value: 30 }, ADMIN)));
  assert.equal(patched.band, 'danger');

  assert.equal((await call(DEL(`/api/staged/${id}`, ADMIN)))?.status, 200);
  assert.equal((await call(DEL(`/api/staged/${id}`, ADMIN)))?.status, 404);

  assert.equal((await call(POST('/api/staged/submit', {}, ADMIN)))?.status, 501);
  assert.equal(
    (await call(POST('/api/submit', { ringId: 'ring-1', value: 50, recordedAt: '2026-08-20T08:30:00+09:00' }, ADMIN)))?.status,
    501,
  );
});
