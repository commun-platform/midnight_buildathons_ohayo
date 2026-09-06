import type { SqlDatabase } from '@midnight-demo/db';

export type ViewerRole = 'admin' | 'worker';

export interface Viewer {
  role: ViewerRole;
  workerId?: string | null;
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
