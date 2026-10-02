import type { Viewer } from '@midnight-demo/condition-read';
import type { SqlDatabase } from '@midnight-demo/db';

import { verifySession } from './session.js';

const BEARER = /^Bearer\s+(.+)$/i;

export interface AuthConfig {
  sessionSecret: string;
  adminKeyHashes: readonly string[];
  guestEntry: boolean;
  walletNetworkId: string;
  guestSubmissionLimit: number;
  guestHourlyLimit: number;
}

export interface SessionViewer extends Viewer {
  subject: string;
  guestId: string | null;
  guestRingId: string | null;
  expiresAt: number;
}

export async function authenticate(
  deps: { db: SqlDatabase; auth?: AuthConfig },
  request: Request,
): Promise<SessionViewer | null> {
  if (!deps.auth) return null;
  const token = BEARER.exec(request.headers.get('authorization')?.trim() ?? '')?.[1];
  if (!token) return null;
  const session = await verifySession(token, deps.auth.sessionSecret);
  if (!session) return null;

  if (session.guest) {
    const guestId = session.sub.startsWith('guest:') ? session.sub.slice('guest:'.length) : '';
    const guest = await deps.db.first<{ worker_id: string; ring_id: string }>(
      'SELECT worker_id, ring_id FROM guest_sessions WHERE id = ? AND expires_at > ?',
      [guestId, new Date().toISOString()],
    );
    if (!guest) return null;
    const workerId = session.role === 'worker' ? guest.worker_id : null;
    if (session.workerId !== workerId) return null;
    return {
      role: session.role,
      workerId,
      subject: session.sub,
      guestId,
      guestRingId: guest.ring_id,
      expiresAt: session.exp,
    };
  }

  if (session.role === 'admin') {
    if (session.workerId !== null || !deps.auth.adminKeyHashes.includes(session.sub)) return null;
    return { role: 'admin', workerId: null, subject: session.sub, guestId: null, guestRingId: null, expiresAt: session.exp };
  }

  const binding = await deps.db.first<{ worker_id: string }>(
    `SELECT b.worker_id FROM wallet_bindings b JOIN workers w ON w.id = b.worker_id
      WHERE b.key_hash = ? AND b.revoked_at IS NULL`,
    [session.sub],
  );
  if (!binding || binding.worker_id !== session.workerId) return null;
  return {
    role: 'worker',
    workerId: binding.worker_id,
    subject: session.sub,
    guestId: null,
    guestRingId: null,
    expiresAt: session.exp,
  };
}

export function authConfigFromEnv(env: Record<string, string | undefined>): AuthConfig | undefined {
  const sessionSecret = env.SESSION_SECRET?.trim();
  if (!sessionSecret) return undefined;
  const positive = (value: string | undefined, fallback: number) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : fallback;
  };
  return {
    sessionSecret,
    adminKeyHashes: (env.ADMIN_WALLET_KEY_HASHES ?? '')
      .split(/[\s,]+/)
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    guestEntry: env.GUEST_ENTRY?.trim() === '1',
    walletNetworkId: env.WALLET_NETWORK_ID?.trim() || 'preprod',
    guestSubmissionLimit: positive(env.GUEST_SUBMISSION_LIMIT, 3),
    guestHourlyLimit: positive(env.GUEST_HOURLY_LIMIT, 30),
  };
}
