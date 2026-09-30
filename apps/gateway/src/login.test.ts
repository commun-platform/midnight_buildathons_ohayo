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
  loadSampleRoster,
  runSqlScript,
  type SqlDatabase,
} from '@midnight-demo/db';
import { schnorr } from '@noble/curves/secp256k1';

import type { AuthConfig } from './auth.js';
import type { GatewayDeps, SubmitStagedOptions } from './deps.js';
import { handleApi } from './routes.js';
import { signSession } from './session.js';
import { TEST_ADMIN_KEY_HASH, testAuth } from './test-support.js';
import { signedMessageBytes, walletKeyHash } from './wallet-signature.js';

const SALT = new Uint8Array(16).fill(0x5a);
const ORIGIN = 'http://gw.test';

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function wallet() {
  const privateKey = schnorr.utils.randomPrivateKey();
  const verifyingKey = hex(schnorr.getPublicKey(privateKey));
  return {
    verifyingKey,
    keyHash: () => walletKeyHash(verifyingKey),
    async sign(message: string) {
      const data = new TextEncoder().encode(message);
      const prefixed = new Uint8Array([...new TextEncoder().encode(`midnight_signed_message:${data.length}:`), ...data]);
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', prefixed));
      return { data: message, signature: hex(schnorr.sign(digest, privateKey)), verifyingKey };
    },
    async signUnprefixed(message: string) {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message)));
      return { data: message, signature: hex(schnorr.sign(digest, privateKey)), verifyingKey };
    },
  };
}

async function setup(auth: Partial<AuthConfig> = {}, extra: Partial<GatewayDeps> = {}) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gw-login-')), 'test.db');
  const db = createDatabase({ url: `file:${file}` });
  await applyMigrations(db, loadConditionMigrations());
  await runSqlScript(db, loadSampleRoster());
  const deps: GatewayDeps = { db, reader: fakeReader(new Map()), salt: SALT, auth: testAuth(auth), ...extra };
  const call = async (method: string, pathname: string, body?: unknown, session?: string) => {
    const response = await handleApi(
      new Request(`${ORIGIN}${pathname}`, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(session ? { authorization: `Bearer ${session}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
      deps,
    );
    assert.ok(response);
    return { status: response.status, body: (await response.json()) as any };
  };
  const adminSession = await signSession(
    { sub: TEST_ADMIN_KEY_HASH, role: 'admin', workerId: null, exp: Date.now() + 60_000 },
    deps.auth!.sessionSecret,
  );
  return { db, deps, call, adminSession };
}

async function login(call: Awaited<ReturnType<typeof setup>>['call'], w: ReturnType<typeof wallet>, inviteCode?: string) {
  const challenge = await call('POST', '/api/auth/challenge', inviteCode ? { inviteCode } : {});
  assert.equal(challenge.status, 200);
  const signed = await w.sign(challenge.body.message);
  return { challenge: challenge.body, result: await call('POST', '/api/auth/verify', { challengeId: challenge.body.challengeId, ...signed }) };
}

test('the old tokens no longer log anyone in', async () => {
  const { call } = await setup();
  assert.equal((await call('GET', '/api/me', undefined, 'admin')).status, 401);
  assert.equal((await call('GET', '/api/me', undefined, 'worker-1')).status, 401);
  assert.equal((await call('GET', '/api/roster', undefined, 'admin')).status, 401);
});

test('signatures follow the connector spec: midnight_signed_message:<byte length>: before the data', () => {
  assert.equal(new TextDecoder().decode(signedMessageBytes('abc')), 'midnight_signed_message:3:abc');
  assert.equal(new TextDecoder().decode(signedMessageBytes('判断')), 'midnight_signed_message:6:判断');
});

test('a signature over the bare message (without the connector prefix) is refused', async () => {
  const w = wallet();
  const { call } = await setup({ adminKeyHashes: [await w.keyHash()] });
  const c = (await call('POST', '/api/auth/challenge', {})).body;
  const bare = await call('POST', '/api/auth/verify', { challengeId: c.challengeId, ...(await w.signUnprefixed(c.message)) });
  assert.deepEqual([bare.status, bare.body.code], [401, 'bad_signature']);
});

test('the challenge names the origin and is signed as-is', async () => {
  const { call } = await setup();
  const { body } = await call('POST', '/api/auth/challenge', {});
  const lines = body.message.split('\n');
  assert.equal(lines[0], 'SADAKO-LOGIN-V1');
  assert.equal(lines[1], ORIGIN);
  assert.equal(lines[2], body.challengeId);
  assert.equal(lines.length, 5);
});

test('an unregistered wallet is refused with its key hash; an admin key logs in as admin', async () => {
  const w = wallet();
  const { call } = await setup();
  const refused = (await login(call, w)).result;
  assert.equal(refused.status, 403);
  assert.equal(refused.body.code, 'unregistered');
  assert.equal(refused.body.keyHash, await w.keyHash());

  const admin = await setup({ adminKeyHashes: [await w.keyHash()] });
  const ok = (await login(admin.call, w)).result;
  assert.equal(ok.status, 200);
  assert.equal(ok.body.role, 'admin');
  const me = await admin.call('GET', '/api/me', undefined, ok.body.session);
  assert.deepEqual([me.body.role, me.body.guest], ['admin', false]);
});

test('a challenge cannot be reused, outlive its expiry, or be signed by another key', async () => {
  const w = wallet();
  const { call, db } = await setup({ adminKeyHashes: [await w.keyHash()] });

  const first = await login(call, w);
  assert.equal(first.result.status, 200);
  const replay = await call('POST', '/api/auth/verify', {
    challengeId: first.challenge.challengeId,
    ...(await w.sign(first.challenge.message)),
  });
  assert.deepEqual([replay.status, replay.body.code], [409, 'challenge_used']);

  const stale = (await call('POST', '/api/auth/challenge', {})).body;
  await db.execute("UPDATE auth_challenges SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", [stale.challengeId]);
  const expired = await call('POST', '/api/auth/verify', { challengeId: stale.challengeId, ...(await w.sign(stale.message)) });
  assert.deepEqual([expired.status, expired.body.code], [410, 'challenge_expired']);

  const other = wallet();
  const c = (await call('POST', '/api/auth/challenge', {})).body;
  const forged = { ...(await other.sign(c.message)), verifyingKey: w.verifyingKey };
  const mismatch = await call('POST', '/api/auth/verify', { challengeId: c.challengeId, ...forged });
  assert.deepEqual([mismatch.status, mismatch.body.code], [401, 'bad_signature']);

  const c2 = (await call('POST', '/api/auth/challenge', {})).body;
  const wrongData = await w.sign(`${c2.message}\nextra`);
  const mismatchData = await call('POST', '/api/auth/verify', { challengeId: c2.challengeId, ...wrongData });
  assert.deepEqual([mismatchData.status, mismatchData.body.code], [401, 'bad_signature']);
  const reuseAfterFailure = await call('POST', '/api/auth/verify', { challengeId: c2.challengeId, ...(await w.sign(c2.message)) });
  assert.equal(reuseAfterFailure.status, 409);

  assert.equal((await call('POST', '/api/auth/verify', { challengeId: 'nope', ...(await w.sign('x')) })).status, 400);
});

test('an invite binds a wallet to a worker once; the code cannot be reused', async () => {
  const { call, adminSession } = await setup();
  const invite = await call('POST', '/api/workers/worker-1/invite', {}, adminSession);
  assert.equal(invite.status, 200);
  assert.match(invite.body.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  const w = wallet();
  const { challenge, result } = await login(call, w, invite.body.code.toLowerCase().replace(/-/g, ''));
  assert.match(challenge.message.split('\n')[5], /^invite:[0-9a-f]{64}$/);
  assert.equal(result.status, 200);
  assert.deepEqual([result.body.role, result.body.workerId], ['worker', 'worker-1']);
  const me = await call('GET', '/api/me', undefined, result.body.session);
  assert.equal(me.body.workerId, 'worker-1');

  const again = (await login(call, w)).result;
  assert.deepEqual([again.status, again.body.workerId], [200, 'worker-1']);

  const reuse = await call('POST', '/api/auth/challenge', { inviteCode: invite.body.code });
  assert.deepEqual([reuse.status, reuse.body.code], [400, 'invite_invalid']);
  assert.equal((await call('POST', '/api/auth/challenge', { inviteCode: 'NOT-A-CODE' })).body.code, 'invite_invalid');

  const roster = await call('GET', '/api/roster', undefined, adminSession);
  const worker1 = roster.body.workers.find((x: { id: string }) => x.id === 'worker-1');
  assert.equal(worker1.walletBound, true);
});

test('two challenges racing on one invite bind only one wallet', async () => {
  const { call, adminSession } = await setup();
  const { code } = (await call('POST', '/api/workers/worker-2/invite', {}, adminSession)).body;
  const a = wallet();
  const b = wallet();
  const ca = (await call('POST', '/api/auth/challenge', { inviteCode: code })).body;
  const cb = (await call('POST', '/api/auth/challenge', { inviteCode: code })).body;
  const first = await call('POST', '/api/auth/verify', { challengeId: ca.challengeId, ...(await a.sign(ca.message)) });
  const second = await call('POST', '/api/auth/verify', { challengeId: cb.challengeId, ...(await b.sign(cb.message)) });
  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.equal((await login(call, b)).result.body.code, 'unregistered');
});

test('revoking a binding ends its sessions; tampered, expired or de-listed sessions are refused', async () => {
  const w = wallet();
  const { call, adminSession, deps } = await setup();
  const { code } = (await call('POST', '/api/workers/worker-1/invite', {}, adminSession)).body;
  const session = (await login(call, w, code)).result.body.session as string;
  assert.equal((await call('GET', '/api/me', undefined, session)).status, 200);

  assert.equal((await call('DELETE', '/api/workers/worker-1/wallet', undefined, adminSession)).status, 200);
  assert.equal((await call('GET', '/api/me', undefined, session)).status, 401);
  assert.equal((await login(call, w)).result.body.code, 'unregistered');
  assert.equal((await call('DELETE', '/api/workers/worker-1/wallet', undefined, adminSession)).status, 404);

  const [v, body, mac] = adminSession.split('.');
  const forgedBody = Buffer.from(JSON.stringify({ sub: 'x', role: 'admin', workerId: null, exp: Date.now() + 60_000 }))
    .toString('base64url');
  assert.equal((await call('GET', '/api/me', undefined, `${v}.${forgedBody}.${mac}`)).status, 401);
  assert.ok(body);
  const expired = await signSession(
    { sub: TEST_ADMIN_KEY_HASH, role: 'admin', workerId: null, exp: Date.now() - 1 },
    deps.auth!.sessionSecret,
  );
  assert.equal((await call('GET', '/api/me', undefined, expired)).status, 401);
  const delisted = await setup({ adminKeyHashes: [] });
  assert.equal((await delisted.call('GET', '/api/me', undefined, adminSession)).status, 401);
});

test('guest entry is off unless GUEST_ENTRY=1', async () => {
  const { call } = await setup();
  assert.equal((await call('POST', '/api/auth/guest', {})).status, 404);
  assert.equal((await call('GET', '/api/config')).body.guestEntry, false);
});

test('a guest gets a fresh worker and ring, can switch persona, and the sandbox limits hold', async () => {
  const calls: SubmitStagedOptions[] = [];
  const { call, db } = await setup(
    { guestEntry: true, guestSubmissionLimit: 3, guestHourlyLimit: 5 },
    {
      submitStaged: async (options) => {
        calls.push(options);
        return { submitted: 0, skipped: 0, failed: 0, tampered: 0, reconcile: null };
      },
    },
  );
  const entered = await call('POST', '/api/auth/guest', {});
  assert.equal(entered.status, 200);
  assert.equal(entered.body.guest, true);
  assert.equal(entered.body.role, 'worker');
  const workerId = entered.body.workerId as string;
  assert.match(workerId, /^guest-[0-9a-f]{8}$/);
  const me = (await call('GET', '/api/me', undefined, entered.body.session)).body;
  assert.deepEqual([me.guest, me.ringId], [true, `ring-${workerId}`]);

  const second = (await call('POST', '/api/auth/guest', {})).body;
  assert.notEqual(second.workerId, workerId);

  const admin = (await call('POST', '/api/auth/guest/persona', { role: 'admin' }, entered.body.session)).body;
  assert.equal(admin.role, 'admin');
  assert.equal((await call('GET', '/api/roster', undefined, admin.session)).status, 200);
  const blocked = await call('POST', '/api/rings', { label: 'X' }, admin.session);
  assert.deepEqual([blocked.status, blocked.body.code], [403, 'sandbox']);
  assert.equal((await call('POST', '/api/workers/worker-1/invite', {}, admin.session)).status, 403);
  assert.equal((await call('DELETE', '/api/workers/worker-1/wallet', undefined, admin.session)).status, 403);

  await db.execute(
    `INSERT INTO condition_readings (ring_id, recorded_at, value, source, status, created_at)
     VALUES ('ring-1', '2026-09-30T08:00:00Z', 50, 'partner_api', 'pending', '2026-09-30T08:00:00Z')`,
  );
  const foreign = await db.first<{ id: number }>("SELECT id FROM condition_readings WHERE ring_id = 'ring-1'");
  assert.equal((await call('DELETE', `/api/staged/${foreign?.id}`, undefined, admin.session)).status, 403);

  assert.equal((await call('POST', '/api/staged/submit', { tamper: true }, admin.session)).status, 200);
  assert.deepEqual(calls[0], {
    tamper: true,
    ringIds: [`ring-${workerId}`],
    limit: 3,
    submittedBy: `guest:${workerId.slice('guest-'.length)}`,
  });

  const insert = `INSERT INTO submissions (entry_key, ring_id, period_start_ms, timezone, recorded_at_ms,
                    band, score_commitment_hex, submitted_at, submitted_by) VALUES (?, ?, 1, 'Asia/Tokyo', 1, 'normal', 'aa', ?, ?)`;
  const nowIso = new Date().toISOString();
  await db.execute(insert, ['g-1', `ring-${workerId}`, nowIso, calls[0]?.submittedBy ?? '']);
  await db.execute(insert, ['g-2', `ring-${second.workerId}`, nowIso, `guest:${second.workerId.slice(6)}`]);
  await db.execute(insert, ['g-3', `ring-${second.workerId}`, nowIso, `guest:${second.workerId.slice(6)}`]);
  await call('POST', '/api/staged/submit', {}, admin.session);
  assert.equal(calls[1]?.limit, 2);

  await db.execute(insert, ['g-4', `ring-${workerId}`, nowIso, calls[0]?.submittedBy ?? '']);
  await db.execute(insert, ['g-5', `ring-${workerId}`, nowIso, calls[0]?.submittedBy ?? '']);
  const capped = await call('POST', '/api/staged/submit', {}, admin.session);
  assert.deepEqual([capped.status, capped.body.code], [429, 'guest_limit']);

  const back = (await call('POST', '/api/auth/guest/persona', { role: 'worker' }, admin.session)).body;
  assert.equal(back.workerId, workerId);
  assert.equal((await call('GET', '/api/conditions/worker/worker-1', undefined, back.session)).status, 403);

  await db.execute("UPDATE guest_sessions SET expires_at = '2000-01-01T00:00:00.000Z'");
  assert.equal((await call('GET', '/api/me', undefined, back.session)).status, 401);
  assert.equal((await call('POST', '/api/auth/guest/persona', { role: 'admin' }, back.session)).status, 401);
});
