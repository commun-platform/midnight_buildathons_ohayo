import type { SqlDatabase } from '@midnight-demo/db';
import type { Viewer } from '@midnight-demo/condition-read';

const BEARER = /^Bearer\s+(.+)$/i;

export const ADMIN_TOKEN = 'admin';

export async function authenticate(db: SqlDatabase, request: Request): Promise<Viewer | null> {
  const token = BEARER.exec(request.headers.get('authorization')?.trim() ?? '')?.[1];
  if (!token) return null;

  if (token === ADMIN_TOKEN) return { role: 'admin', workerId: null };

  const worker = await db.first<{ id: string }>('SELECT id FROM workers WHERE id = ?', [token]);
  if (!worker) return null;
  return { role: 'worker', workerId: worker.id };
}
