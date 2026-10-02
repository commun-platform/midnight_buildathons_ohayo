import type { SqlDatabase, SqlStatement } from '@midnight-demo/db';
import {
  importPartnerPublicKey,
  type PartnerScore,
  partnerKeyId,
  verifyPartnerScore,
  type SignedPartnerScore,
} from '@midnight-demo/shared';

export const PARTNER_SOURCE = 'partner_api';

export interface PartnerConfig {
  url: string;
  apiKey: string;
  publicKeyHex: string;
}

export interface PullResult {
  fetched: number;
  inserted: number;
  duplicates: number;
  conflicts: number;
  badSignature: number;
  invalid: number;
  unknownRing: number;
  cursor: string;
}

export class PartnerPullError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'PartnerPullError';
  }
}

interface DailyScoresPage {
  schemaVersion: number;
  keyId: string;
  nextCursor: string;
  scores: SignedPartnerScore[];
}

const MAX_PAGES = 100;

function isPage(value: unknown): value is DailyScoresPage {
  if (!value || typeof value !== 'object') return false;
  const page = value as Record<string, unknown>;
  return (
    page.schemaVersion === 1 &&
    typeof page.keyId === 'string' &&
    typeof page.nextCursor === 'string' &&
    Array.isArray(page.scores)
  );
}

function isScoreShape(value: unknown): value is SignedPartnerScore {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    typeof s.ringId === 'string' &&
    typeof s.measuredAt === 'string' &&
    typeof s.score === 'number' &&
    typeof s.signature === 'string'
  );
}

function inRange(score: SignedPartnerScore): boolean {
  return (
    Number.isFinite(score.score) &&
    score.score >= 0 &&
    score.score <= 100 &&
    Number.isFinite(Date.parse(score.measuredAt))
  );
}

async function fetchPage(config: PartnerConfig, cursor: string, fetchFn: typeof fetch): Promise<DailyScoresPage> {
  const url = new URL('/v1/daily-scores', config.url);
  url.searchParams.set('since', cursor);
  let response: Response;
  try {
    response = await fetchFn(url, { headers: { authorization: `Bearer ${config.apiKey}` } });
  } catch (error) {
    throw new PartnerPullError(`partner unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) throw new PartnerPullError(`partner returned HTTP ${response.status}`, response.status);
  const body = (await response.json().catch(() => null)) as unknown;
  if (!isPage(body)) throw new PartnerPullError('partner returned an unexpected daily-scores payload');
  return body;
}

async function storedPartnerScore(db: SqlDatabase, externalId: string): Promise<PartnerScore | null> {
  const row = await db.first<{ ring_id: string; recorded_at: string; value: number }>(
    'SELECT ring_id, recorded_at, value FROM condition_readings WHERE external_id = ?',
    [externalId],
  );
  return row ? { id: externalId, ringId: row.ring_id, measuredAt: row.recorded_at, score: Number(row.value) } : null;
}

function sameContent(a: PartnerScore, b: PartnerScore): boolean {
  return a.ringId === b.ringId && a.measuredAt === b.measuredAt && a.score === b.score;
}

export async function partnerCursor(db: SqlDatabase): Promise<string> {
  const row = await db.first<{ cursor: string }>('SELECT cursor FROM partner_sync WHERE source = ?', [PARTNER_SOURCE]);
  return row?.cursor ?? '0';
}

export async function pullPartnerScores(
  db: SqlDatabase,
  config: PartnerConfig,
  fetchFn: typeof fetch = fetch,
): Promise<PullResult> {
  const key = await importPartnerPublicKey(config.publicKeyHex);
  const expectedKeyId = await partnerKeyId(config.publicKeyHex);
  const rings = new Set(
    (await db.all<{ id: string }>('SELECT id FROM rings')).map((row) => row.id),
  );
  const result: PullResult = {
    fetched: 0,
    inserted: 0,
    duplicates: 0,
    conflicts: 0,
    badSignature: 0,
    invalid: 0,
    unknownRing: 0,
    cursor: await partnerCursor(db),
  };

  for (let pageNo = 0; pageNo < MAX_PAGES; pageNo += 1) {
    const page = await fetchPage(config, result.cursor, fetchFn);
    if (page.keyId !== expectedKeyId) {
      throw new PartnerPullError(`partner signs with key ${page.keyId}, expected ${expectedKeyId}`);
    }
    if (page.scores.length === 0 || page.nextCursor === result.cursor) break;

    const statements: SqlStatement[] = [];
    const seenInPage = new Map<string, SignedPartnerScore>();
    const createdAt = new Date().toISOString();
    for (const raw of page.scores) {
      result.fetched += 1;
      if (!isScoreShape(raw) || !(await verifyPartnerScore(key, raw))) {
        result.badSignature += 1;
        continue;
      }
      if (!inRange(raw)) {
        result.invalid += 1;
        continue;
      }
      if (!rings.has(raw.ringId)) {
        result.unknownRing += 1;
        continue;
      }
      const existing = seenInPage.get(raw.id) ?? (await storedPartnerScore(db, raw.id));
      if (existing) {
        if (sameContent(existing, raw)) result.duplicates += 1;
        else result.conflicts += 1;
        continue;
      }
      seenInPage.set(raw.id, raw);
      statements.push({
        sql: `INSERT INTO condition_readings
                (ring_id, recorded_at, value, source, status, external_id, partner_sig, created_at)
              VALUES (?, ?, ?, 'partner_api', 'pending', ?, ?, ?)`,
        parameters: [raw.ringId, raw.measuredAt, raw.score, raw.id, raw.signature, createdAt],
      });
      result.inserted += 1;
    }

    statements.push({
      sql: `INSERT INTO partner_sync (source, cursor, synced_at) VALUES (?, ?, ?)
            ON CONFLICT (source) DO UPDATE SET cursor = excluded.cursor, synced_at = excluded.synced_at`,
      parameters: [PARTNER_SOURCE, page.nextCursor, createdAt],
    });
    await db.batch(statements);
    result.cursor = page.nextCursor;
  }

  return result;
}
