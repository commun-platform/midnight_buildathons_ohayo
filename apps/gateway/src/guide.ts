import type { SqlDatabase } from '@midnight-demo/db';

import { authenticate, type SessionViewer } from './auth.js';
import type { GatewayDeps } from './deps.js';

export const GUIDE_STEPS = ['measure', 'submit', 'decide', 'public_verify', 'tamper'] as const;

export type GuideStep = (typeof GUIDE_STEPS)[number];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function exists(db: SqlDatabase, sql: string, params: unknown[]): Promise<boolean> {
  return Boolean(await db.first(sql, params as never));
}

async function guideState(db: SqlDatabase, viewer: SessionViewer): Promise<Record<GuideStep, boolean>> {
  const ring = viewer.guestRingId;
  const measure = ring
    ? await exists(db, 'SELECT 1 FROM condition_readings WHERE ring_id = ? LIMIT 1', [ring])
    : await exists(db, 'SELECT 1 FROM condition_readings LIMIT 1', []);
  const decided = await exists(db, 'SELECT 1 FROM work_decisions WHERE decided_by = ? LIMIT 1', [viewer.subject]);
  const submitted = await exists(
    db,
    'SELECT 1 FROM submissions WHERE submitted_by = ? AND chain_verified_at IS NOT NULL LIMIT 1',
    [viewer.subject],
  );
  const disclosed = await exists(
    db,
    "SELECT 1 FROM audit_log WHERE actor_user_id = ? AND action = 'disclosure.issue' LIMIT 1",
    [viewer.subject],
  );
  const tamper = await exists(
    db,
    "SELECT 1 FROM audit_log WHERE actor_user_id = ? AND action = 'reconcile.mismatch' LIMIT 1",
    [viewer.subject],
  );
  return { measure, submit: submitted, decide: decided, public_verify: disclosed, tamper };
}

export async function recordMismatch(db: SqlDatabase, viewer: SessionViewer, entryKeys: readonly string[]): Promise<void> {
  const ts = new Date().toISOString();
  await db.execute(
    `INSERT INTO audit_log (id, actor_user_id, action, target_table, target_id, before_json, after_json, ts)
     VALUES (?, ?, 'reconcile.mismatch', 'submissions', ?, NULL, NULL, ?)`,
    [crypto.randomUUID(), viewer.subject, entryKeys.join(',').slice(0, 2000), ts],
  );
}

export async function handleGuide(request: Request, deps: GatewayDeps): Promise<Response> {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });
  const viewer = await authenticate(deps, request);
  if (!viewer) return json(401, { error: 'Unauthorized' });
  const state = await guideState(deps.db, viewer);
  return json(200, { steps: GUIDE_STEPS.map((key) => ({ key, done: state[key] })) });
}
