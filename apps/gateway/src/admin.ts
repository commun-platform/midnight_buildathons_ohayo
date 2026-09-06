import type { SqlDatabase } from '@midnight-demo/db';
import { classifyCondition } from '@midnight-demo/shared';

import { authenticate } from './auth.js';
import type { GatewayDeps } from './deps.js';

const ADMIN_PATH = /^\/api\/(roster|staged|submit|rings|workers)(\/.*)?$/;

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
  }>(
    `SELECT w.id, wp.name,
            (SELECT m.ring_id FROM ring_worker_map m
              WHERE m.worker_id = w.id AND m.to_ts IS NULL LIMIT 1) AS ring_id
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

function validateFeed(
  b: { recordedAt?: unknown; value?: unknown },
): { recordedAt?: string; value?: number } | { error: string } {
  const out: { recordedAt?: string; value?: number } = {};
  if (b.recordedAt !== undefined) {
    const recordedAt = str(b.recordedAt);
    if (!recordedAt || !Number.isFinite(Date.parse(recordedAt))) {
      return { error: 'recordedAt must be an ISO 8601 timestamp' };
    }
    out.recordedAt = recordedAt;
  }
  if (b.value !== undefined) {
    const value = typeof b.value === 'number' ? b.value : Number.NaN;
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      return { error: 'value must be a number in 0..100' };
    }
    out.value = value;
  }
  return out;
}

async function staged(
  db: SqlDatabase,
  deps: GatewayDeps,
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
    return json(200, await deps.submitStaged());
  }

  if (rest === '' && method === 'GET') {
    const rows = await db.all<{
      id: number;
      ring_id: string;
      ring_label: string | null;
      recorded_at: string;
      value: number;
      status: string;
      worker_name: string | null;
    }>(
      `SELECT cr.id, cr.ring_id, r.label AS ring_label, cr.recorded_at, cr.value, cr.status,
              wp.name AS worker_name
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
      rows: rows.map((row) => ({
        id: row.id,
        ringId: row.ring_id,
        ringLabel: row.ring_label,
        workerName: row.worker_name,
        recordedAt: row.recorded_at,
        value: row.value,
        band: classifyCondition(row.value),
        status: row.status,
        submitted: submitted.has(`${row.ring_id}|${Date.parse(row.recorded_at)}`),
      })),
    });
  }

  if (rest === '' && method === 'POST') {
    const b = await readBody(request);
    if (!b) return json(400, { error: 'Invalid JSON body' });
    const ringId = str(b.ringId);
    if (!ringId || !(await db.first('SELECT 1 FROM rings WHERE id = ?', [ringId]))) {
      return json(404, { error: 'Unknown ring' });
    }
    const fields = validateFeed(b);
    if ('error' in fields) return json(400, fields);
    if (fields.recordedAt === undefined || fields.value === undefined) {
      return json(400, { error: 'recordedAt and value are required' });
    }
    await db.execute(
      `INSERT INTO condition_readings (ring_id, recorded_at, value, source, status, created_at)
       VALUES (?, ?, ?, 'manual', 'pending', ?)`,
      [ringId, fields.recordedAt, fields.value, now()],
    );
    const created = await db.first<{ id: number }>(
      'SELECT id FROM condition_readings WHERE ring_id = ? AND recorded_at = ? ORDER BY id DESC LIMIT 1',
      [ringId, fields.recordedAt],
    );
    return json(200, {
      id: created?.id ?? null,
      ringId,
      recordedAt: fields.recordedAt,
      value: fields.value,
      band: classifyCondition(fields.value),
      status: 'pending',
      submitted: false,
    });
  }

  const idMatch = rest.match(/^\/(\d+)$/);
  if (idMatch) {
    const rid = Number(idMatch[1]);
    if (method === 'DELETE') {
      const n = await db.execute('DELETE FROM condition_readings WHERE id = ?', [rid]);
      return n === 0 ? json(404, { error: 'Unknown reading' }) : json(200, { deleted: rid });
    }
    if (method === 'PATCH') {
      const b = await readBody(request);
      if (!b) return json(400, { error: 'Invalid JSON body' });
      const fields = validateFeed(b);
      if ('error' in fields) return json(400, fields);
      const sets: string[] = [];
      const params: (string | number)[] = [];
      if (fields.recordedAt !== undefined) {
        sets.push('recorded_at = ?');
        params.push(fields.recordedAt);
      }
      if (fields.value !== undefined) {
        sets.push('value = ?');
        params.push(fields.value);
      }
      if (!sets.length) return json(400, { error: 'recordedAt or value is required' });
      params.push(rid);
      const n = await db.execute(
        `UPDATE condition_readings SET ${sets.join(', ')} WHERE id = ?`,
        params,
      );
      if (n === 0) return json(404, { error: 'Unknown reading' });
      const row = await db.first<{ ring_id: string; recorded_at: string; value: number }>(
        'SELECT ring_id, recorded_at, value FROM condition_readings WHERE id = ?',
        [rid],
      );
      return json(200, {
        id: rid,
        ringId: row?.ring_id,
        recordedAt: row?.recorded_at,
        value: row?.value,
        band: row ? classifyCondition(row.value) : null,
      });
    }
    return json(405, { error: 'Method not allowed' });
  }
  return json(404, { error: 'Unknown API route' });
}

async function submit(db: SqlDatabase, deps: GatewayDeps, request: Request): Promise<Response> {
  const b = await readBody(request);
  if (!b) return json(400, { error: 'Invalid JSON body' });
  const ringId = str(b.ringId);
  const value = typeof b.value === 'number' ? b.value : Number.NaN;
  const recordedAt = str(b.recordedAt);
  const tamper = b.tamper === true;
  if (!ringId) return json(400, { error: 'ringId is required' });
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    return json(400, { error: 'value must be a number in 0..100' });
  }
  if (!recordedAt || !Number.isFinite(Date.parse(recordedAt))) {
    return json(400, { error: 'recordedAt must be an ISO 8601 timestamp' });
  }
  if (!(await db.first('SELECT 1 FROM rings WHERE id = ?', [ringId]))) {
    return json(404, { error: 'Unknown ring' });
  }
  if (!deps.submit) {
    return json(501, {
      error: 'Submitting runs on a local devnet — start `gateway serve` with MIDNIGHT_NETWORK set.',
    });
  }
  const result = await deps.submit({ ringId, value, recordedAt, tamper });
  if (!result.ok) return json(409, { error: result.reason });
  return json(200, result);
}

export async function handleAdmin(request: Request, deps: GatewayDeps): Promise<Response | null> {
  const url = new URL(request.url);
  if (!ADMIN_PATH.test(url.pathname)) return null;

  const viewer = await authenticate(deps.db, request);
  if (!viewer) return json(401, { error: 'Unauthorized' });
  if (viewer.role !== 'admin') return json(403, { error: 'Forbidden — admin only' });

  const db = deps.db;
  const method = request.method;
  const seg = url.pathname.split('/').filter(Boolean);
  const kind = seg[1];
  const id = seg[2] ? decodeURIComponent(seg[2]) : null;

  if (kind === 'roster' && method === 'GET') return roster(db);
  if (kind === 'rings') return rings(db, method, id, request);
  if (kind === 'workers') return workers(db, method, id, request);
  if (kind === 'staged') {
    return staged(db, deps, method, url.pathname.slice('/api/staged'.length), request);
  }
  if (kind === 'submit' && method === 'POST') return submit(db, deps, request);

  return json(404, { error: 'Unknown API route' });
}
