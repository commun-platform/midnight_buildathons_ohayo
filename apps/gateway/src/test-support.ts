import type { SqlDatabase } from '@midnight-demo/db';

import type { AuthConfig } from './auth.js';
import type { GatewayDeps } from './deps.js';
import { handleApi as realHandleApi } from './routes.js';
import { signSession, WALLET_SESSION_MS } from './session.js';

export const TEST_ADMIN_KEY_HASH = 'a'.repeat(64);

export function testAuth(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    sessionSecret: 'test-session-secret-0123456789abcdef',
    adminKeyHashes: [TEST_ADMIN_KEY_HASH],
    guestEntry: false,
    walletNetworkId: 'preprod',
    guestSubmissionLimit: 3,
    guestHourlyLimit: 30,
    ...overrides,
  };
}

export const workerKeyHash = (workerId: string) =>
  Array.from(new TextEncoder().encode(workerId.padEnd(32, '_').slice(0, 32)), (b) => b.toString(16).padStart(2, '0')).join('');

async function bindForTest(db: SqlDatabase, workerId: string): Promise<boolean> {
  if (!(await db.first('SELECT 1 FROM workers WHERE id = ?', [workerId]))) return false;
  const keyHash = workerKeyHash(workerId);
  const bound = await db.first('SELECT 1 FROM wallet_bindings WHERE key_hash = ? AND revoked_at IS NULL', [keyHash]);
  if (!bound) {
    await db.execute(
      'INSERT INTO wallet_bindings (id, key_hash, worker_id, created_at) VALUES (?, ?, ?, ?)',
      [`wb-test-${workerId}`, keyHash, workerId, new Date().toISOString()],
    );
  }
  return true;
}

export async function sessionFor(deps: GatewayDeps & { auth: AuthConfig }, token: string): Promise<string | null> {
  const exp = Date.now() + WALLET_SESSION_MS;
  if (token === 'admin') {
    return signSession({ sub: TEST_ADMIN_KEY_HASH, role: 'admin', workerId: null, exp }, deps.auth.sessionSecret);
  }
  if (!(await bindForTest(deps.db, token))) return null;
  return signSession({ sub: workerKeyHash(token), role: 'worker', workerId: token, exp }, deps.auth.sessionSecret);
}

export async function handleApi(request: Request, deps: GatewayDeps): Promise<Response | null> {
  const withAuth = { ...deps, auth: deps.auth ?? testAuth() };
  const token = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!token || token.startsWith('v1.')) return realHandleApi(request, withAuth);
  const session = await sessionFor(withAuth, token);
  if (!session) return realHandleApi(request, withAuth);
  const headers = new Headers(request.headers);
  headers.set('authorization', `Bearer ${session}`);
  const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text();
  return realHandleApi(new Request(request.url, { method: request.method, headers, body }), withAuth);
}

export async function handleRead(request: Request, deps: GatewayDeps): Promise<Response | null> {
  if (!new URL(request.url).pathname.startsWith('/api/conditions/')) return null;
  return handleApi(request, deps);
}
