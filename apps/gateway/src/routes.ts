import {
  conditionHistory,
  resolveRingScope,
  type RingHistory,
  type Viewer,
} from '@midnight-demo/condition-read';

import type { SqlDatabase } from '@midnight-demo/db';

import { handleAdmin } from './admin.js';
import { authenticate } from './auth.js';
import type { GatewayDeps } from './deps.js';

export type { GatewayDeps } from './deps.js';

const THIRTY_DAYS_MS = 30 * 86_400_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function parseRange(url: URL): { fromMs: number; toMs: number } | null {
  const now = Date.now();
  const toRaw = url.searchParams.get('to');
  const fromRaw = url.searchParams.get('from');
  const toMs = toRaw ? Date.parse(toRaw) : now;
  const fromMs = fromRaw ? Date.parse(fromRaw) : toMs - THIRTY_DAYS_MS;
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) return null;
  return { fromMs, toMs };
}

function seesEveryone(viewer: Viewer): boolean {
  return viewer.role === 'admin';
}

async function targetRings(
  deps: GatewayDeps,
  viewer: Viewer,
  kind: string,
  id: string | undefined,
): Promise<string[] | null> {
  if (kind === 'mine') return resolveRingScope(deps.db, viewer);
  if (kind === 'all') return resolveRingScope(deps.db, { role: 'admin' });
  if (kind === 'worker') {
    if (!id) return null;
    return resolveRingScope(deps.db, { role: 'worker', workerId: id });
  }
  return null;
}

function authorizeTarget(viewer: Viewer, kind: string, id: string | undefined): boolean {
  if (kind === 'mine') return true;
  if (seesEveryone(viewer)) return true;
  if (kind === 'all') return false;
  if (kind === 'worker') return viewer.workerId === id;
  return false;
}

async function attachOwnConditionValues(db: SqlDatabase, history: RingHistory[]): Promise<void> {
  const rings = history.map((r) => r.ringId);
  if (rings.length === 0) return;

  const rows = await db.all<{ ring_id: string; recorded_at: string; value: number }>(
    `SELECT ring_id, recorded_at, value FROM condition_readings
      WHERE ring_id IN (${rings.map(() => '?').join(', ')})`,
    rings,
  );
  const byRingAndTime = new Map<string, number>();
  for (const row of rows) {
    const ms = Date.parse(row.recorded_at);
    if (Number.isFinite(ms)) byRingAndTime.set(`${row.ring_id}|${ms}`, row.value);
  }

  for (const ring of history) {
    for (const entry of ring.entries) {
      const value = byRingAndTime.get(`${ring.ringId}|${entry.recordedAtMs}`);
      if (value !== undefined) entry.value = value;
    }
  }
}

export async function handleRead(request: Request, deps: GatewayDeps): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/conditions/')) return null;
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const viewer = await authenticate(deps.db, request);
  if (!viewer) return json(401, { error: 'Unauthorized' });

  const [, , kind, id] = url.pathname.split('/').filter(Boolean);
  if (!authorizeTarget(viewer, kind ?? '', id)) return json(403, { error: 'Forbidden' });

  const range = parseRange(url);
  if (!range) return json(400, { error: 'Invalid from/to range' });

  const requested = await targetRings(deps, viewer, kind ?? '', id);
  if (requested === null) return json(404, { error: 'Unknown conditions target' });

  const scope = new Set(await resolveRingScope(deps.db, viewer));
  const allowed = seesEveryone(viewer) ? requested : requested.filter((ring) => scope.has(ring));
  if (requested.length > 0 && allowed.length === 0) return json(403, { error: 'Forbidden' });

  const history = await conditionHistory(deps.db, deps.reader, {
    ringIds: allowed,
    fromMs: range.fromMs,
    toMs: range.toMs,
    salt: deps.salt,
  });

  if (viewer.role === 'worker') await attachOwnConditionValues(deps.db, history);

  return json(200, {
    range: {
      from: new Date(range.fromMs).toISOString(),
      to: new Date(range.toMs).toISOString(),
    },
    rings: history,
  });
}

function handleConfig(deps: GatewayDeps): Response {
  return json(200, {
    network: deps.config?.network ?? null,
    explorerUrl: deps.config?.explorerUrl ?? null,
    submitEnabled: Boolean(deps.submit),
  });
}

async function handleMe(request: Request, deps: GatewayDeps): Promise<Response> {
  const viewer = await authenticate(deps.db, request);
  if (!viewer) return json(401, { error: 'Unauthorized' });

  const worker = viewer.workerId
    ? await deps.db.first<{ name: string }>('SELECT name FROM worker_pii WHERE worker_id = ?', [
        viewer.workerId,
      ])
    : null;

  return json(200, {
    role: viewer.role,
    admin: viewer.role === 'admin',
    workerId: viewer.workerId ?? null,
    workerName: worker?.name ?? null,
  });
}

async function handleReconcile(request: Request, deps: GatewayDeps): Promise<Response> {
  const viewer = await authenticate(deps.db, request);
  if (!viewer) return json(401, { error: 'Unauthorized' });

  let body: { entryKeys?: unknown };
  try {
    body = (await request.json()) as { entryKeys?: unknown };
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }
  const requested = Array.isArray(body.entryKeys)
    ? body.entryKeys.filter((k): k is string => typeof k === 'string').slice(0, 200)
    : [];
  if (requested.length === 0) return json(400, { error: 'entryKeys[] is required' });

  const rows = await deps.db.all<{ entry_key: string; ring_id: string }>(
    `SELECT entry_key, ring_id FROM submissions
      WHERE entry_key IN (${requested.map(() => '?').join(', ')})`,
    requested,
  );
  let allowed: string[];
  if (seesEveryone(viewer)) {
    allowed = rows.map((r) => r.entry_key);
  } else {
    const scope = new Set(await resolveRingScope(deps.db, viewer));
    allowed = rows.filter((r) => scope.has(r.ring_id)).map((r) => r.entry_key);
  }
  if (allowed.length === 0) return json(403, { error: 'Forbidden' });

  if (!deps.reconcile) {
    return json(501, {
      error: 'Reconciliation runs on the operator host — run `npm run condition:reconcile`.',
    });
  }
  return json(200, await deps.reconcile(allowed));
}

export async function handleApi(request: Request, deps: GatewayDeps): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return null;

  const admin = await handleAdmin(request, deps);
  if (admin) return admin;

  if (request.method === 'POST' && url.pathname === '/api/reconcile') {
    return handleReconcile(request, deps);
  }
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  if (url.pathname === '/api/config') return handleConfig(deps);
  if (url.pathname === '/api/me') return handleMe(request, deps);

  return (await handleRead(request, deps)) ?? json(404, { error: 'Unknown API route' });
}
