import type { SqlDatabase, SqlStatement } from '@midnight-demo/db';
import { APP_TIME_ZONE, classifyCondition, zonedDayStartMs, type ConditionBand } from '@midnight-demo/shared';

export const SHOWCASE_DAYS = 7;
export const SHOWCASE_ACTOR = 'showcase';

const DAY_MS = 86_400_000;
const GUEST_CHUNK = 20;

export interface ShowcaseWorker {
  workerId: string;
  name: string;
  ringId: string;
  ringLabel: string;
  values: readonly (number | null)[];
  decisions: readonly { day: number; decision: 'worked' | 'light_duty' | 'rested'; reason: string }[];
}

export const SHOWCASE_WORKERS: readonly ShowcaseWorker[] = [
  {
    workerId: 'showcase-a',
    name: '見本 A',
    ringId: 'ring-showcase-a',
    ringLabel: 'SHOW-A',
    values: [78, 82, 75, 80, 84, 79, 81],
    decisions: [],
  },
  {
    workerId: 'showcase-b',
    name: '見本 B',
    ringId: 'ring-showcase-b',
    ringLabel: 'SHOW-B',
    values: [66, 58, 52, 61, 47, 63, 70],
    decisions: [],
  },
  {
    workerId: 'showcase-c',
    name: '見本 C',
    ringId: 'ring-showcase-c',
    ringLabel: 'SHOW-C',
    values: [55, 38, 62, 35, 44, 68, 72],
    decisions: [
      { day: 1, decision: 'rested', reason: '危険バンドのため休養' },
      { day: 3, decision: 'worked', reason: '本人と面談のうえ、監督者が付き添い短時間の就業とした' },
    ],
  },
  {
    workerId: 'showcase-d',
    name: '見本 D',
    ringId: 'ring-showcase-d',
    ringLabel: 'SHOW-D',
    values: [71, 64, null, 59, 66, 73, 69],
    decisions: [],
  },
];

export const SHOWCASE_RING_IDS: readonly string[] = SHOWCASE_WORKERS.map((w) => w.ringId);

export interface ShowcaseReading {
  ringId: string;
  date: string;
  recordedAt: string;
  value: number;
  band: ConditionBand;
}

export interface ShowcaseDecision {
  id: string;
  workerId: string;
  periodStartMs: number;
  band: ConditionBand;
  decision: 'worked' | 'light_duty' | 'rested';
  reason: string;
}

export interface ShowcasePlan {
  from: string;
  to: string;
  readings: ShowcaseReading[];
  decisions: ShowcaseDecision[];
}

const localDate = (ms: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);

function weekdaySlot(dayStartMs: number): number {
  const days = Math.round(Date.parse(`${localDate(dayStartMs)}T00:00:00Z`) / DAY_MS);
  return ((days % SHOWCASE_DAYS) + SHOWCASE_DAYS) % SHOWCASE_DAYS;
}

export function showcaseDayStarts(now: Date): number[] {
  const today = zonedDayStartMs(now.getTime(), APP_TIME_ZONE);
  return Array.from({ length: SHOWCASE_DAYS }, (_, day) =>
    zonedDayStartMs(today - (SHOWCASE_DAYS - day) * DAY_MS + DAY_MS / 2, APP_TIME_ZONE),
  );
}

export function showcasePlan(now: Date): ShowcasePlan {
  const starts = showcaseDayStarts(now);
  const readings: ShowcaseReading[] = [];
  const decisions: ShowcaseDecision[] = [];
  SHOWCASE_WORKERS.forEach((worker, index) => {
    for (const start of starts) {
      const day = weekdaySlot(start);
      const value = worker.values[day];
      if (value === null || value === undefined) continue;
      readings.push({
        ringId: worker.ringId,
        date: localDate(start),
        recordedAt: new Date(start + 7 * 3_600_000 + (3 + index * 11) * 60_000).toISOString(),
        value,
        band: classifyCondition(value),
      });
      const d = worker.decisions.find((x) => x.day === day);
      if (!d) continue;
      decisions.push({
        id: `showcase-${worker.workerId}-${localDate(start)}`,
        workerId: worker.workerId,
        periodStartMs: start,
        band: classifyCondition(value),
        decision: d.decision,
        reason: d.reason,
      });
    }
  });
  readings.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  return {
    from: localDate(starts[0] as number),
    to: localDate(starts[starts.length - 1] as number),
    readings,
    decisions,
  };
}

export interface SeedShowcaseResult {
  from: string;
  to: string;
  ringIds: readonly string[];
  readings: number;
  decisions: number;
}

export async function seedShowcase(db: SqlDatabase, now = new Date()): Promise<SeedShowcaseResult> {
  const plan = showcasePlan(now);
  const at = now.toISOString();
  const assignedFrom = new Date((showcaseDayStarts(now)[0] as number) - DAY_MS).toISOString();
  const roster: SqlStatement[] = SHOWCASE_WORKERS.flatMap((w) => [
    { sql: 'INSERT OR IGNORE INTO workers (id, created_at) VALUES (?, ?)', parameters: [w.workerId, at] },
    { sql: 'INSERT OR IGNORE INTO worker_pii (worker_id, name) VALUES (?, ?)', parameters: [w.workerId, w.name] },
    {
      sql: "INSERT OR IGNORE INTO rings (id, label, owner_label, status, created_at) VALUES (?, ?, 'vendor', 'deployed', ?)",
      parameters: [w.ringId, w.ringLabel, at],
    },
    {
      sql: `INSERT INTO ring_worker_map (ring_id, worker_id, from_ts, to_ts)
            SELECT ?, ?, ?, NULL
             WHERE NOT EXISTS (SELECT 1 FROM ring_worker_map WHERE ring_id = ? AND to_ts IS NULL)`,
      parameters: [w.ringId, w.workerId, assignedFrom, w.ringId],
    },
  ]);
  await db.batch(roster);

  let readings = 0;
  for (const r of plan.readings) {
    readings += await db.execute(
      `INSERT OR IGNORE INTO condition_readings (ring_id, recorded_at, value, source, external_id, created_at)
       VALUES (?, ?, ?, 'partner_api', ?, ?)`,
      [r.ringId, r.recordedAt, r.value, `showcase:${r.ringId}:${r.date}`, at],
    );
  }
  let decisions = 0;
  for (const d of plan.decisions) {
    decisions += await db.execute(
      `INSERT OR IGNORE INTO work_decisions (id, worker_id, period_start_ms, entry_key, band, decision, reason, decided_by, decided_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      [d.id, d.workerId, d.periodStartMs, d.band, d.decision, d.reason, SHOWCASE_ACTOR, at],
    );
  }
  return { from: plan.from, to: plan.to, ringIds: SHOWCASE_RING_IDS, readings, decisions };
}

export interface SandboxResetResult {
  guests: number;
  challenges: number;
}

const marks = (n: number): string => Array.from({ length: n }, () => '?').join(', ');

function guestPurge(guests: readonly { id: string; worker_id: string; ring_id: string }[]): SqlStatement[] {
  const ids = guests.map((g) => g.id);
  const subjects = ids.map((id) => `guest:${id}`);
  const workers = guests.map((g) => g.worker_id);
  const rings = guests.map((g) => g.ring_id);
  return [
    {
      sql: `WITH RECURSIVE kept(id) AS (
              SELECT supersedes_id FROM work_decisions
               WHERE supersedes_id IS NOT NULL AND decided_by NOT IN (${marks(subjects.length)})
              UNION
              SELECT w.supersedes_id FROM work_decisions w JOIN kept k ON w.id = k.id
               WHERE w.supersedes_id IS NOT NULL)
            DELETE FROM work_decisions
             WHERE decided_by IN (${marks(subjects.length)})
               AND id NOT IN (SELECT id FROM kept WHERE id IS NOT NULL)`,
      parameters: [...subjects, ...subjects],
    },
    { sql: `DELETE FROM audit_log WHERE actor_user_id IN (${marks(subjects.length)})`, parameters: subjects },
    { sql: `DELETE FROM condition_readings WHERE ring_id IN (${marks(rings.length)})`, parameters: rings },
    { sql: `DELETE FROM submissions WHERE ring_id IN (${marks(rings.length)})`, parameters: rings },
    { sql: `DELETE FROM ring_worker_map WHERE ring_id IN (${marks(rings.length)})`, parameters: rings },
    { sql: `DELETE FROM rings WHERE id IN (${marks(rings.length)})`, parameters: rings },
    { sql: `DELETE FROM worker_pii WHERE worker_id IN (${marks(workers.length)})`, parameters: workers },
    { sql: `DELETE FROM workers WHERE id IN (${marks(workers.length)})`, parameters: workers },
    { sql: `DELETE FROM guest_sessions WHERE id IN (${marks(ids.length)})`, parameters: ids },
  ];
}

export async function resetSandbox(db: SqlDatabase, now = new Date()): Promise<SandboxResetResult> {
  const at = now.toISOString();
  const expired = await db.all<{ id: string; worker_id: string; ring_id: string }>(
    'SELECT id, worker_id, ring_id FROM guest_sessions WHERE expires_at <= ? ORDER BY expires_at',
    [at],
  );
  for (let i = 0; i < expired.length; i += GUEST_CHUNK) {
    await db.batch(guestPurge(expired.slice(i, i + GUEST_CHUNK)));
  }
  const challenges = await db.execute('DELETE FROM auth_challenges WHERE expires_at <= ?', [at]);
  return { guests: expired.length, challenges };
}
