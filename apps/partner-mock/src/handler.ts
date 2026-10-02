import type { SqlDatabase } from '@midnight-demo/db';
import type { SignedPartnerScore } from '@midnight-demo/shared';

import { parseVitals, scoreFromVitals, simulatedScore } from './score.js';
import type { PartnerSigner } from './signing.js';

export interface PartnerDeps {
  db: SqlDatabase;
  apiKey: string;
  signer: PartnerSigner;
  allowedOrigin?: string;
  pageSize?: number;
}

const RING_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY = 4096;
const MAX_SIMULATE_RINGS = 50;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

function corsHeaders(request: Request, deps: PartnerDeps): Record<string, string> {
  const origin = request.headers.get('origin');
  if (!origin || !deps.allowedOrigin || origin !== deps.allowedOrigin) return {};
  return { 'access-control-allow-origin': origin, vary: 'Origin' };
}

function preflight(request: Request, deps: PartnerDeps): Response {
  const cors = corsHeaders(request, deps);
  const method = request.headers.get('access-control-request-method')?.toUpperCase();
  const headers = (request.headers.get('access-control-request-headers') ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (!cors['access-control-allow-origin'] || method !== 'POST' || headers.some((h) => h !== 'content-type')) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...cors,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '600',
    },
  });
}

function authorized(request: Request, deps: PartnerDeps): boolean {
  const header = request.headers.get('authorization') ?? '';
  return Boolean(deps.apiKey) && header === `Bearer ${deps.apiKey}`;
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > MAX_BODY) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function canonicalInstant(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

async function insertMeasurement(
  db: SqlDatabase,
  row: { id: string; ringId: string; measuredAt: string; score: number; vitals: unknown; origin: 'device' | 'simulate' },
): Promise<number> {
  return db.execute(
    `INSERT OR IGNORE INTO partner_measurements (id, ring_id, measured_at, score, vitals_json, origin, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.ringId,
      row.measuredAt,
      row.score,
      row.vitals === undefined ? null : JSON.stringify(row.vitals),
      row.origin,
      new Date().toISOString(),
    ],
  );
}

async function postMeasurement(request: Request, deps: PartnerDeps): Promise<Response> {
  const cors = corsHeaders(request, deps);
  const body = await readJson(request);
  if (!body) return json(400, { error: 'invalid JSON body' }, cors);
  const ringId = typeof body.ringId === 'string' ? body.ringId.trim() : '';
  if (!RING_ID_RE.test(ringId)) return json(400, { error: 'ringId is required' }, cors);
  const measuredAt = canonicalInstant(body.measuredAt);
  if (!measuredAt) return json(400, { error: 'measuredAt must be an ISO 8601 timestamp' }, cors);

  let score: number;
  let vitals: unknown;
  if (body.vitals !== undefined) {
    const parsed = parseVitals(body.vitals);
    if (!parsed) return json(400, { error: 'vitals needs numeric heartRate, hrvMs, sleepHours, spo2, skinTempDelta' }, cors);
    score = scoreFromVitals(parsed);
    vitals = parsed;
  } else if (typeof body.score === 'number' && Number.isFinite(body.score) && body.score >= 0 && body.score <= 100) {
    score = Math.round(body.score * 100) / 100;
  } else {
    return json(400, { error: 'send vitals or a score in 0..100' }, cors);
  }

  const id = `m-${crypto.randomUUID()}`;
  await insertMeasurement(deps.db, { id, ringId, measuredAt, score, vitals, origin: 'device' });
  return json(201, { id, ringId, measuredAt, score }, cors);
}

async function dailyScores(url: URL, deps: PartnerDeps): Promise<Response> {
  const since = url.searchParams.get('since') ?? '0';
  if (!/^\d+$/.test(since)) return json(400, { error: 'since must be a cursor returned by this API' });
  const max = deps.pageSize ?? 100;
  const requested = Number(url.searchParams.get('limit') ?? max);
  const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, max) : max;

  const rows = await deps.db.all<{ seq: number; id: string; ring_id: string; measured_at: string; score: number }>(
    'SELECT seq, id, ring_id, measured_at, score FROM partner_measurements WHERE seq > ? ORDER BY seq LIMIT ?',
    [Number(since), limit],
  );
  const scores: SignedPartnerScore[] = [];
  for (const row of rows) {
    const score = { id: row.id, ringId: row.ring_id, measuredAt: row.measured_at, score: Number(row.score) };
    scores.push({ ...score, signature: await deps.signer.sign(score) });
  }
  const last = rows[rows.length - 1];
  return json(200, {
    schemaVersion: 1,
    keyId: deps.signer.keyId,
    nextCursor: last ? String(last.seq) : since,
    scores,
  });
}

async function simulate(request: Request, deps: PartnerDeps): Promise<Response> {
  const body = await readJson(request);
  if (!body) return json(400, { error: 'invalid JSON body' });
  const date = typeof body.date === 'string' ? body.date : '';
  if (!DATE_RE.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))) {
    return json(400, { error: 'date must be YYYY-MM-DD' });
  }
  const ringIds = Array.isArray(body.ringIds) ? body.ringIds : [];
  if (
    ringIds.length === 0 ||
    ringIds.length > MAX_SIMULATE_RINGS ||
    !ringIds.every((r): r is string => typeof r === 'string' && RING_ID_RE.test(r))
  ) {
    return json(400, { error: `ringIds must list 1..${MAX_SIMULATE_RINGS} ring ids` });
  }
  const measuredAt = new Date(`${date}T07:30:00+09:00`).toISOString();
  const created = [];
  for (const ringId of ringIds) {
    const id = `sim-${ringId}-${date}`;
    const score = await simulatedScore(ringId, date);
    const inserted = await insertMeasurement(deps.db, { id, ringId, measuredAt, score, vitals: undefined, origin: 'simulate' });
    created.push({ id, ringId, measuredAt, score, created: inserted > 0 });
  }
  return json(200, { scores: created });
}

export async function handlePartner(request: Request, deps: PartnerDeps): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/health' && request.method === 'GET') return json(200, { ok: true });

  if (path === '/v1/measurements') {
    if (request.method === 'OPTIONS') return preflight(request, deps);
    if (request.method === 'POST') return postMeasurement(request, deps);
    return json(405, { error: 'method not allowed' }, corsHeaders(request, deps));
  }

  if (path === '/v1/daily-scores' || path === '/v1/simulate') {
    if (!authorized(request, deps)) return json(401, { error: 'unauthorized' });
    if (path === '/v1/daily-scores' && request.method === 'GET') return dailyScores(url, deps);
    if (path === '/v1/simulate' && request.method === 'POST') return simulate(request, deps);
    return json(405, { error: 'method not allowed' });
  }

  return json(404, { error: 'not found' });
}
