import type { SqlDatabase } from '@midnight-demo/db';

export type ViewerRole = 'admin' | 'worker';

export interface Viewer {
  role: ViewerRole;
  workerId?: string | null;
}

export interface RingAssignment {
  ringId: string;
  fromMs: number;
  toMs: number | null;
}

export async function workerAssignments(db: SqlDatabase, workerId: string): Promise<RingAssignment[]> {
  const rows = await db.all<{ ring_id: string; from_ts: string; to_ts: string | null }>(
    'SELECT ring_id, from_ts, to_ts FROM ring_worker_map WHERE worker_id = ?',
    [workerId],
  );
  return rows.map((row) => ({
    ringId: row.ring_id,
    fromMs: Date.parse(row.from_ts),
    toMs: row.to_ts ? Date.parse(row.to_ts) : null,
  }));
}

export function heldAt(assignments: readonly RingAssignment[], ringId: string, atMs: number): boolean {
  return assignments.some(
    (a) => a.ringId === ringId && a.fromMs <= atMs && (a.toMs === null || atMs < a.toMs),
  );
}

export async function resolveRingScope(db: SqlDatabase, viewer: Viewer): Promise<string[]> {
  if (viewer.role === 'admin') {
    const rows = await db.all<{ id: string }>('SELECT id FROM rings');
    return rows.map((row) => row.id);
  }

  if (!viewer.workerId) return [];
  const rows = await db.all<{ ring_id: string }>(
    'SELECT ring_id FROM ring_worker_map WHERE worker_id = ? AND to_ts IS NULL',
    [viewer.workerId],
  );
  return rows.map((row) => row.ring_id);
}
