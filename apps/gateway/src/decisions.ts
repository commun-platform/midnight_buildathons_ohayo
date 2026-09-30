import type { SqlDatabase } from '@midnight-demo/db';
import { APP_TIME_ZONE, zonedDayStartMs } from '@midnight-demo/shared';

import { authenticate } from './auth.js';
import type { GatewayDeps } from './deps.js';

export const DECISIONS = ['worked', 'light_duty', 'rested'] as const;
export type Decision = (typeof DECISIONS)[number];

const MAX_REASON = 500;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

interface DecisionRow {
  id: string;
  worker_id: string;
  period_start_ms: number;
  entry_key: string | null;
  band: string | null;
  decision: Decision;
  reason: string;
  decided_by: string;
  decided_at: string;
  supersedes_id: string | null;
  is_current: number;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

const localDate = (ms: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);

export function dayStartFromDate(date: string): number | null {
  if (!DATE_RE.test(date)) return null;
  const midday = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(midday)) return null;
  const start = zonedDayStartMs(midday, APP_TIME_ZONE);
  return localDate(start) === date ? start : null;
}

export function reasonRequired(band: string | null, decision: Decision): boolean {
  return (band === 'caution' || band === 'danger') && decision !== 'rested';
}

function present(row: DecisionRow) {
  return {
    id: row.id,
    workerId: row.worker_id,
    date: localDate(Number(row.period_start_ms)),
    periodStartMs: Number(row.period_start_ms),
    entryKey: row.entry_key,
    band: row.band,
    decision: row.decision,
    reason: row.reason,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at,
    supersedesId: row.supersedes_id,
    current: Boolean(row.is_current),
  };
}

const SELECT_DECISIONS = `SELECT d.*,
  NOT EXISTS (SELECT 1 FROM work_decisions n WHERE n.supersedes_id = d.id) AS is_current
  FROM work_decisions d`;

async function currentDecision(db: SqlDatabase, workerId: string, periodStartMs: number): Promise<DecisionRow | null> {
  return db.first<DecisionRow>(
    `${SELECT_DECISIONS}
      WHERE d.worker_id = ? AND d.period_start_ms = ?
        AND NOT EXISTS (SELECT 1 FROM work_decisions n WHERE n.supersedes_id = d.id)`,
    [workerId, periodStartMs],
  );
}

async function dayEntry(
  db: SqlDatabase,
  workerId: string,
  periodStartMs: number,
): Promise<{ entry_key: string; band: string } | null> {
  return db.first<{ entry_key: string; band: string }>(
    `SELECT s.entry_key, s.band FROM submissions s
      WHERE s.period_start_ms = ?
        AND s.ring_id IN (
          SELECT m.ring_id FROM ring_worker_map m
           WHERE m.worker_id = ?
             AND (m.to_ts IS NULL OR (m.from_ts < ? AND m.to_ts > ?)))
      ORDER BY s.submitted_at DESC LIMIT 1`,
    [
      periodStartMs,
      workerId,
      new Date(periodStartMs + DAY_MS).toISOString(),
      new Date(periodStartMs).toISOString(),
    ],
  );
}

async function listDecisions(db: SqlDatabase, url: URL, workerId: string | null): Promise<Response> {
  const today = localDate(Date.now());
  const from = dayStartFromDate(url.searchParams.get('from') ?? localDate(Date.now() - 30 * DAY_MS));
  const to = dayStartFromDate(url.searchParams.get('to') ?? today);
  if (from === null || to === null || from > to) {
    return json(400, { error: 'from / to must be YYYY-MM-DD with from <= to' });
  }
  const history = url.searchParams.get('history') === '1';
  const where = ['d.period_start_ms BETWEEN ? AND ?'];
  const params: (string | number)[] = [from, to];
  if (workerId) {
    where.push('d.worker_id = ?');
    params.push(workerId);
  }
  if (!history) where.push('NOT EXISTS (SELECT 1 FROM work_decisions n WHERE n.supersedes_id = d.id)');
  const rows = await db.all<DecisionRow>(
    `${SELECT_DECISIONS} WHERE ${where.join(' AND ')} ORDER BY d.period_start_ms DESC, d.decided_at`,
    params,
  );
  return json(200, { decisions: rows.map(present) });
}

async function createDecision(db: SqlDatabase, request: Request, actor: string): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json(400, { error: 'Invalid JSON body' });
  }
  const workerId = typeof body.workerId === 'string' ? body.workerId.trim() : '';
  if (!workerId || !(await db.first('SELECT 1 FROM workers WHERE id = ?', [workerId]))) {
    return json(404, { error: 'Unknown worker' });
  }
  const periodStartMs = dayStartFromDate(typeof body.date === 'string' ? body.date : '');
  if (periodStartMs === null) return json(400, { error: 'date must be YYYY-MM-DD' });
  if (periodStartMs > Date.now()) return json(400, { error: 'date is in the future' });
  const decision = body.decision as Decision;
  if (!DECISIONS.includes(decision)) {
    return json(400, { error: `decision must be one of ${DECISIONS.join(', ')}` });
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length > MAX_REASON) return json(400, { error: `reason is limited to ${MAX_REASON} characters` });
  const supersedesId = typeof body.supersedesId === 'string' && body.supersedesId ? body.supersedesId : null;

  const entry = await dayEntry(db, workerId, periodStartMs);
  const band = entry?.band ?? null;
  if (!reason && reasonRequired(band, decision)) {
    return json(400, {
      error: 'A reason is required to let a worker work on a caution or danger day',
      code: 'reason_required',
    });
  }

  const current = await currentDecision(db, workerId, periodStartMs);
  if ((current?.id ?? null) !== supersedesId) {
    return json(409, {
      error: 'The decision for this day has changed; reload and correct the current one',
      code: 'stale',
      currentId: current?.id ?? null,
    });
  }

  const row = {
    id: `wd-${crypto.randomUUID()}`,
    worker_id: workerId,
    period_start_ms: periodStartMs,
    entry_key: entry?.entry_key ?? null,
    band,
    decision,
    reason,
    decided_by: actor,
    decided_at: new Date().toISOString(),
    supersedes_id: supersedesId,
  };
  try {
    await db.batch([
      {
        sql: `INSERT INTO work_decisions
                (id, worker_id, period_start_ms, entry_key, band, decision, reason, decided_by, decided_at, supersedes_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        parameters: [
          row.id,
          row.worker_id,
          row.period_start_ms,
          row.entry_key,
          row.band,
          row.decision,
          row.reason,
          row.decided_by,
          row.decided_at,
          row.supersedes_id,
        ],
      },
      {
        sql: `INSERT INTO audit_log (id, actor_user_id, action, target_table, target_id, before_json, after_json, ts)
              VALUES (?, ?, 'work_decision.create', 'work_decisions', ?, ?, ?, ?)`,
        parameters: [
          `al-${crypto.randomUUID()}`,
          actor,
          row.id,
          current ? JSON.stringify(present(current)) : null,
          JSON.stringify(row),
          row.decided_at,
        ],
      },
    ]);
  } catch (error) {
    if (/UNIQUE|constraint/i.test(error instanceof Error ? error.message : String(error))) {
      return json(409, { error: 'The decision for this day has changed; reload and correct the current one', code: 'stale' });
    }
    throw error;
  }
  return json(201, { decision: present({ ...row, is_current: 1 }) });
}

export async function handleDecisions(request: Request, deps: GatewayDeps): Promise<Response> {
  const viewer = await authenticate(deps.db, request);
  if (!viewer) return json(401, { error: 'Unauthorized' });
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const asked = url.searchParams.get('workerId');
    if (viewer.role === 'worker') {
      if (!viewer.workerId || (asked && asked !== viewer.workerId)) return json(403, { error: 'Forbidden' });
      return listDecisions(deps.db, url, viewer.workerId);
    }
    return listDecisions(deps.db, url, asked);
  }
  if (request.method === 'POST') {
    if (viewer.role !== 'admin') return json(403, { error: 'Forbidden — admin only' });
    return createDecision(deps.db, request, 'admin');
  }
  return json(405, { error: 'Method not allowed — decisions are append-only' });
}
