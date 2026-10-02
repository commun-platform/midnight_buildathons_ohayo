import type { SqlDatabase } from '@midnight-demo/db';
import { PartnerPullError, pullPartnerScores } from '@midnight-demo/ingester/partner';
import { latestChainJob } from '@midnight-demo/ingester/queue';
import { SHOWCASE_RING_IDS, seedShowcase, showcasePlan } from '@midnight-demo/ingester/showcase';
import { classifyCondition } from '@midnight-demo/shared';

import { authenticate, type SessionViewer } from './auth.js';
import type { GatewayDeps } from './deps.js';
import { generateInviteCode, inviteHash } from './login.js';

const INVITE_MS = 7 * 24 * 60 * 60 * 1000;

const ADMIN_PATH = /^\/api\/(roster|staged|rings|workers|partner|showcase)(\/.*)?$/;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const newId = (prefix: string): string => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
const now = () => new Date().toISOString();

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}
function optStr(v: unknown): string | null {
  const s = str(v);
  return s || null;
}
async function count(db: SqlDatabase, sql: string, params: unknown[]): Promise<number> {
  const row = await db.first<{ n: number }>(sql, params as never);
  return Number(row?.n ?? 0);
}

async function resolveId(
  db: SqlDatabase,
  table: string,
  prefix: string,
  raw: unknown,
): Promise<{ id: string } | { error: string }> {
  if (raw === undefined || raw === null || raw === '') return { id: newId(prefix) };
  const id = String(raw).trim();
  if (!ID_RE.test(id)) return { error: 'id must be lowercase a-z, 0-9 and dashes' };
  const dup = await db.first(`SELECT 1 FROM ${table} WHERE id = ?`, [id]);
  return dup ? { error: `id "${id}" is taken` } : { id };
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function roster(db: SqlDatabase): Promise<Response> {
  const rings = await db.all<{
    id: string;
    label: string;
    status: string;
    worker_id: string | null;
    worker_name: string | null;
    submission_count: number;
  }>(
    `SELECT r.id, r.label, r.status,
            m.worker_id, wp.name AS worker_name,
            (SELECT COUNT(*) FROM submissions sub WHERE sub.ring_id = r.id) AS submission_count
       FROM rings r
       LEFT JOIN ring_worker_map m ON m.ring_id = r.id AND m.to_ts IS NULL
       LEFT JOIN worker_pii wp ON wp.worker_id = m.worker_id
      ORDER BY r.label, r.id`,
  );

  const workers = await db.all<{
    id: string;
    name: string;
    ring_id: string | null;
    wallet_bound: number;
  }>(
    `SELECT w.id, wp.name,
            (SELECT m.ring_id FROM ring_worker_map m
              WHERE m.worker_id = w.id AND m.to_ts IS NULL LIMIT 1) AS ring_id,
            EXISTS (SELECT 1 FROM wallet_bindings b
              WHERE b.worker_id = w.id AND b.revoked_at IS NULL) AS wallet_bound
       FROM workers w
       LEFT JOIN worker_pii wp ON wp.worker_id = w.id
      ORDER BY wp.name, w.id`,
  );

  return json(200, {
    rings: rings.map((r) => ({
      id: r.id,
      label: r.label,
      status: r.status,
      workerId: r.worker_id,
      workerName: r.worker_name,
      submissionCount: Number(r.submission_count),
    })),
    workers: workers.map((w) => ({
      id: w.id,
      name: w.name,
      assignedRing: w.ring_id,
      walletBound: Boolean(w.wallet_bound),
    })),
  });
}

async function assignRingWorker(
  db: SqlDatabase,
  ringId: string,
  workerId: string | null,
): Promise<void> {
  await db.execute('UPDATE ring_worker_map SET to_ts = ? WHERE ring_id = ? AND to_ts IS NULL', [
    now(),
    ringId,
  ]);
  if (workerId) {
    await db.execute(
      'INSERT INTO ring_worker_map (ring_id, worker_id, from_ts, to_ts) VALUES (?, ?, ?, NULL)',
      [ringId, workerId, now()],
    );
  }
}

async function rings(
  db: SqlDatabase,
  method: string,
  id: string | null,
  request: Request,
): Promise<Response> {
  if (!id && method === 'POST') {
    const b = await readBody(request);
    if (!b) return json(400, { error: 'Invalid JSON body' });
    const label = str(b.label);
    if (!label) return json(400, { error: 'label is required' });
    const idr = await resolveId(db, 'rings', 'ring', b.id);
    if ('error' in idr) return json(409, idr);
    await db.execute(
      'INSERT INTO rings (id, label, owner_label, status, created_at) VALUES (?, ?, ?, ?, ?)',
      [idr.id, label, 'vendor', 'deployed', now()],
    );
    return json(200, { id: idr.id, label });
  }
  if (!id) return json(405, { error: 'Method not allowed' });
  const ring = await db.first<{ status: string }>('SELECT status FROM rings WHERE id = ?', [id]);
  if (!ring) return json(404, { error: 'Unknown ring' });

  const used = async () =>
    (await count(db, 'SELECT COUNT(*) AS n FROM submissions WHERE ring_id = ?', [id])) +
    (await count(db, 'SELECT COUNT(*) AS n FROM condition_readings WHERE ring_id = ?', [id]));

  if (method === 'DELETE') {
    if ((await used()) > 0) return json(409, { error: 'ring still has submissions / readings' });
    await db.execute('DELETE FROM ring_worker_map WHERE ring_id = ?', [id]);
    await db.execute('DELETE FROM rings WHERE id = ?', [id]);
    return json(200, { deleted: id });
  }
  if (method === 'PATCH') {
    const b = await readBody(request);
    if (!b) return json(400, { error: 'Invalid JSON body' });
    if (b.label !== undefined) {
      const label = str(b.label);
      if (!label) return json(400, { error: 'label cannot be empty' });
      await db.execute('UPDATE rings SET label = ? WHERE id = ?', [label, id]);
    }
    if (b.status !== undefined) {
      const s = str(b.status);
      if (!['pooled', 'deployed', 'retired', 'lost'].includes(s)) {
        return json(400, { error: 'status must be pooled | deployed | retired | lost' });
      }
      await db.execute('UPDATE rings SET status = ? WHERE id = ?', [s, id]);
    }

    if (b.workerId !== undefined) {
      const workerId = optStr(b.workerId);
      if (workerId && !(await db.first('SELECT 1 FROM workers WHERE id = ?', [workerId]))) {
        return json(404, { error: 'Unknown worker' });
      }
      await assignRingWorker(db, id, workerId);
    }
    return json(200, { id });
  }
  return json(405, { error: 'Method not allowed' });
}

async function workers(
  db: SqlDatabase,
  method: string,
  id: string | null,
  request: Request,
): Promise<Response> {
  if (!id && method === 'POST') {
    const b = await readBody(request);
    if (!b) return json(400, { error: 'Invalid JSON body' });
    const name = str(b.name);
    if (!name) return json(400, { error: 'name is required' });
    const idr = await resolveId(db, 'workers', 'worker', b.id);
    if ('error' in idr) return json(409, idr);
    await db.execute('INSERT INTO workers (id, created_at) VALUES (?, ?)', [idr.id, now()]);
    await db.execute('INSERT INTO worker_pii (worker_id, name) VALUES (?, ?)', [idr.id, name]);
    return json(200, { id: idr.id, name });
  }
  if (!id) return json(405, { error: 'Method not allowed' });
  if (!(await db.first('SELECT 1 FROM workers WHERE id = ?', [id]))) {
    return json(404, { error: 'Unknown worker' });
  }

  if (method === 'PATCH') {
    const b = await readBody(request);
    if (!b) return json(400, { error: 'Invalid JSON body' });

    if (b.name !== undefined) {
      const name = str(b.name);
      if (!name) return json(400, { error: 'name cannot be empty' });
      await db.execute('UPDATE worker_pii SET name = ? WHERE worker_id = ?', [name, id]);
    }
    return json(200, { id });
  }
  if (method === 'DELETE') {
    const refs = await count(
      db,
      'SELECT COUNT(*) AS n FROM ring_worker_map WHERE worker_id = ? AND to_ts IS NULL',
      [id],
    );
    if (refs > 0) return json(409, { error: 'worker is still assigned a ring' });
    await db.execute('DELETE FROM worker_pii WHERE worker_id = ?', [id]);
    await db.execute('DELETE FROM workers WHERE id = ?', [id]);
    return json(200, { deleted: id });
  }
  return json(405, { error: 'Method not allowed' });
}

async function staged(
  db: SqlDatabase,
  deps: GatewayDeps,
  viewer: SessionViewer,
  method: string,
  rest: string,
  request: Request,
): Promise<Response> {
  if (rest === '/submit') {
    if (method !== 'POST') return json(405, { error: 'Method not allowed' });
    if (!deps.submitStaged) {
      return json(501, {
        error: 'Submitting runs on a local devnet — start `gateway serve` with MIDNIGHT_NETWORK set.',
      });
    }
    const b = (await readBody(request)) ?? {};
    const tamper = b.tamper === true;
    if (!viewer.guestId) {
      return json(200, await deps.submitStaged({ tamper, submittedBy: viewer.subject }));
    }
    const limit = await guestSubmissionsLeft(db, deps, viewer);
    if (limit <= 0) {
      return json(429, { error: 'The guest sandbox submission limit is reached', code: 'guest_limit' });
    }
    return json(
      200,
      await deps.submitStaged({ tamper, ringIds: [viewer.guestRingId ?? ''], limit, submittedBy: viewer.subject }),
    );
  }

  if (rest === '' && method === 'GET') {
    const rows = await db.all<{
      id: number;
      ring_id: string;
      ring_label: string | null;
      recorded_at: string;
      value: number;
      status: string;
      source: string;
      skip_reason: string | null;
      last_error: string | null;
      worker_name: string | null;
    }>(
      `SELECT cr.id, cr.ring_id, r.label AS ring_label, cr.recorded_at, cr.value, cr.status,
              cr.source, cr.skip_reason, cr.last_error, wp.name AS worker_name
         FROM condition_readings cr
         LEFT JOIN rings r ON r.id = cr.ring_id
         LEFT JOIN ring_worker_map m ON m.ring_id = cr.ring_id AND m.to_ts IS NULL
         LEFT JOIN worker_pii wp ON wp.worker_id = m.worker_id
        ORDER BY cr.recorded_at DESC, cr.id DESC`,
    );
    const submitted = new Set(
      (
        await db.all<{ ring_id: string; recorded_at_ms: number }>(
          'SELECT ring_id, recorded_at_ms FROM submissions',
        )
      ).map((r) => `${r.ring_id}|${Number(r.recorded_at_ms)}`),
    );
    return json(200, {
      job: await latestChainJob(db),
      rows: rows.map((row) => ({
        id: row.id,
        ringId: row.ring_id,
        ringLabel: row.ring_label,
        workerName: row.worker_name,
        recordedAt: row.recorded_at,
        value: row.source === 'partner_api' ? null : row.value,
        band: classifyCondition(row.value),
        source: row.source,
        status: row.status,
        skipReason: row.skip_reason,
        lastError: row.last_error,
        submitted: submitted.has(`${row.ring_id}|${Date.parse(row.recorded_at)}`),
      })),
    });
  }

  if (rest === '') return json(405, { error: 'Method not allowed' });

  const idMatch = rest.match(/^\/(\d+)$/);
  if (idMatch) {
    const rid = Number(idMatch[1]);
    if (method === 'DELETE') {
      if (viewer.guestId) {
        const own = await db.first('SELECT 1 FROM condition_readings WHERE id = ? AND ring_id = ?', [rid, viewer.guestRingId]);
        if (!own) return json(403, { error: 'The guest sandbox can only delete its own readings', code: 'sandbox' });
      }
      const n = await db.execute('DELETE FROM condition_readings WHERE id = ?', [rid]);
      return n === 0 ? json(404, { error: 'Unknown reading' }) : json(200, { deleted: rid });
    }
    return json(405, { error: 'Method not allowed' });
  }
  return json(404, { error: 'Unknown API route' });
}

async function guestSubmissionsLeft(db: SqlDatabase, deps: GatewayDeps, viewer: SessionViewer): Promise<number> {
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const own =
    (await count(db, 'SELECT COUNT(*) AS n FROM submissions WHERE submitted_by = ?', [viewer.subject])) +
    (await count(db, "SELECT COUNT(*) AS n FROM condition_readings WHERE status = 'queued' AND queued_by = ?", [
      viewer.subject,
    ]));
  const lastHour =
    (await count(
      db,
      "SELECT COUNT(*) AS n FROM submissions WHERE submitted_by LIKE 'guest:%' AND submitted_at > ?",
      [hourAgo],
    )) +
    (await count(
      db,
      "SELECT COUNT(*) AS n FROM condition_readings WHERE status = 'queued' AND queued_by LIKE 'guest:%' AND queued_at > ?",
      [hourAgo],
    ));
  const perGuest = deps.auth?.guestSubmissionLimit ?? 3;
  const perHour = deps.auth?.guestHourlyLimit ?? 30;
  return Math.min(perGuest - own, perHour - lastHour);
}

async function issueInvite(db: SqlDatabase, workerId: string, viewer: SessionViewer): Promise<Response> {
  if (!(await db.first('SELECT 1 FROM workers WHERE id = ?', [workerId]))) {
    return json(404, { error: 'Unknown worker' });
  }
  const code = generateInviteCode();
  const expiresAt = new Date(Date.now() + INVITE_MS).toISOString();
  await db.batch([
    {
      sql: 'INSERT INTO worker_invites (code_hash, worker_id, expires_at, created_by) VALUES (?, ?, ?, ?)',
      parameters: [await inviteHash(code), workerId, expiresAt, viewer.subject],
    },
    {
      sql: `INSERT INTO audit_log (id, actor_user_id, action, target_table, target_id, after_json, ts)
            VALUES (?, ?, 'worker_invite.create', 'worker_invites', ?, ?, ?)`,
      parameters: [`al-${crypto.randomUUID()}`, viewer.subject, workerId, JSON.stringify({ workerId, expiresAt }), now()],
    },
  ]);
  return json(200, { workerId, code, expiresAt });
}

async function revokeWallet(db: SqlDatabase, workerId: string, viewer: SessionViewer): Promise<Response> {
  const at = now();
  const n = await db.execute('UPDATE wallet_bindings SET revoked_at = ? WHERE worker_id = ? AND revoked_at IS NULL', [
    at,
    workerId,
  ]);
  if (n === 0) return json(404, { error: 'No wallet is bound to this worker' });
  await db.execute(
    `INSERT INTO audit_log (id, actor_user_id, action, target_table, target_id, after_json, ts)
     VALUES (?, ?, 'wallet_binding.revoke', 'wallet_bindings', ?, ?, ?)`,
    [`al-${crypto.randomUUID()}`, viewer.subject, workerId, JSON.stringify({ workerId, revokedAt: at }), at],
  );
  return json(200, { workerId, revokedAt: at });
}

async function partnerPull(db: SqlDatabase, deps: GatewayDeps): Promise<Response> {
  if (!deps.partner) {
    return json(501, {
      error: 'Partner pull needs PARTNER_URL, PARTNER_API_KEY and PARTNER_PUBLIC_KEY.',
    });
  }
  try {
    return json(200, await pullPartnerScores(db, deps.partner, deps.fetch ?? fetch));
  } catch (error) {
    if (error instanceof PartnerPullError) return json(502, { error: error.message });
    throw error;
  }
}

async function showcaseStatus(db: SqlDatabase): Promise<Record<string, unknown>> {
  const plan = showcasePlan(new Date());
  const ringList = SHOWCASE_RING_IDS.map(() => '?').join(', ');
  const counts = await db.all<{ status: string; n: number }>(
    `SELECT status, COUNT(*) AS n FROM condition_readings WHERE ring_id IN (${ringList}) GROUP BY status`,
    [...SHOWCASE_RING_IDS],
  );
  const submitted = await count(db, `SELECT COUNT(*) AS n FROM submissions WHERE ring_id IN (${ringList})`, [
    ...SHOWCASE_RING_IDS,
  ]);
  return {
    workers: SHOWCASE_RING_IDS.length,
    planned: plan.readings.length,
    next: { from: plan.from, to: plan.to },
    readings: Object.fromEntries(counts.map((c) => [c.status, Number(c.n)])),
    submitted,
  };
}

async function showcase(db: SqlDatabase, deps: GatewayDeps, viewer: SessionViewer, method: string): Promise<Response> {
  if (method === 'GET') return json(200, await showcaseStatus(db));
  if (method !== 'POST') return json(405, { error: 'Method not allowed' });
  if (viewer.guestId) return json(403, { error: 'The guest sandbox cannot seed the showcase', code: 'sandbox' });
  const seeded = await seedShowcase(db);
  await db.execute(
    `INSERT INTO audit_log (id, actor_user_id, action, target_table, target_id, after_json, ts)
     VALUES (?, ?, 'showcase.seed', 'condition_readings', ?, ?, ?)`,
    [`al-${crypto.randomUUID()}`, viewer.subject, `${seeded.from}..${seeded.to}`, JSON.stringify(seeded), now()],
  );
  const queued =
    deps.submitStaged && deps.config?.submitQueued
      ? ((await deps.submitStaged({ ringIds: SHOWCASE_RING_IDS, submittedBy: viewer.subject })).queued ?? 0)
      : 0;
  return json(200, { ...seeded, queued, status: await showcaseStatus(db) });
}

export async function handleAdmin(request: Request, deps: GatewayDeps): Promise<Response | null> {
  const url = new URL(request.url);
  if (!ADMIN_PATH.test(url.pathname)) return null;

  const viewer = await authenticate(deps, request);
  if (!viewer) return json(401, { error: 'Unauthorized' });
  if (viewer.role !== 'admin') return json(403, { error: 'Forbidden — admin only' });

  const db = deps.db;
  const method = request.method;
  const seg = url.pathname.split('/').filter(Boolean);
  const kind = seg[1];
  const id = seg[2] ? decodeURIComponent(seg[2]) : null;

  if ((kind === 'rings' || kind === 'workers') && method !== 'GET' && viewer.guestId) {
    return json(403, { error: 'The guest sandbox cannot change the roster', code: 'sandbox' });
  }
  if (kind === 'roster' && method === 'GET') return roster(db);
  if (kind === 'rings') return rings(db, method, id, request);
  if (kind === 'workers' && id && seg[3] === 'invite' && !seg[4]) {
    return method === 'POST' ? issueInvite(db, id, viewer) : json(405, { error: 'Method not allowed' });
  }
  if (kind === 'workers' && id && seg[3] === 'wallet' && !seg[4]) {
    return method === 'DELETE' ? revokeWallet(db, id, viewer) : json(405, { error: 'Method not allowed' });
  }
  if (kind === 'workers') return workers(db, method, id, request);
  if (kind === 'staged') {
    return staged(db, deps, viewer, method, url.pathname.slice('/api/staged'.length), request);
  }
  if (kind === 'showcase' && !id) return showcase(db, deps, viewer, method);
  if (kind === 'partner' && id === 'pull' && !seg[3]) {
    return method === 'POST' ? partnerPull(db, deps) : json(405, { error: 'Method not allowed' });
  }

  return json(404, { error: 'Unknown API route' });
}
