import { authenticate, type AuthConfig } from './auth.js';
import type { GatewayDeps } from './deps.js';
import { GUEST_SESSION_MS, signSession, WALLET_SESSION_MS, type SessionRole } from './session.js';
import { isWalletSignature, sha256Hex, verifyWalletSignature, walletKeyHash } from './wallet-signature.js';

export const LOGIN_DOMAIN = 'SADAKO-LOGIN-V1';
const CHALLENGE_MS = 5 * 60 * 1000;
const INVITE_RE = /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const randomHex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

export function normalizeInviteCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.toUpperCase().replace(/[\s_]/g, '');
  const dashed = code.includes('-') ? code : code.replace(/^(.{4})(.{4})(.{4})$/, '$1-$2-$3');
  return INVITE_RE.test(dashed) ? dashed : null;
}

export function generateInviteCode(): string {
  const chars = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((g) => g.join('')).join('-');
}

export const inviteHash = (code: string) => sha256Hex(`sadako-invite-v1:${code}`);

export function loginMessage(parts: {
  origin: string;
  challengeId: string;
  nonce: string;
  issuedAt: string;
  inviteHash: string | null;
}): string {
  return [
    LOGIN_DOMAIN,
    parts.origin,
    parts.challengeId,
    parts.nonce,
    parts.issuedAt,
    ...(parts.inviteHash ? [`invite:${parts.inviteHash}`] : []),
  ].join('\n');
}

async function issue(
  auth: AuthConfig,
  payload: { sub: string; role: SessionRole; workerId: string | null; exp: number; guest?: boolean },
): Promise<Response> {
  const session = await signSession(payload, auth.sessionSecret);
  return json(200, {
    session,
    role: payload.role,
    workerId: payload.workerId,
    guest: Boolean(payload.guest),
    expiresAt: new Date(payload.exp).toISOString(),
  });
}

async function challenge(request: Request, deps: GatewayDeps): Promise<Response> {
  const body = await readBody(request);
  if (!body) return json(400, { error: 'Invalid JSON body' });
  let invite: string | null = null;
  if (body.inviteCode !== undefined && body.inviteCode !== null && body.inviteCode !== '') {
    const code = normalizeInviteCode(body.inviteCode);
    if (!code) return json(400, { error: 'The invite code looks wrong', code: 'invite_invalid' });
    invite = await inviteHash(code);
    const usable = await deps.db.first(
      'SELECT 1 FROM worker_invites WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?',
      [invite, new Date().toISOString()],
    );
    if (!usable) return json(400, { error: 'The invite code is unknown, used or expired', code: 'invite_invalid' });
  }
  const now = Date.now();
  const challengeId = crypto.randomUUID();
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + CHALLENGE_MS).toISOString();
  const message = loginMessage({
    origin: new URL(request.url).origin,
    challengeId,
    nonce: randomHex(16),
    issuedAt,
    inviteHash: invite,
  });
  await deps.db.batch([
    { sql: 'DELETE FROM auth_challenges WHERE expires_at < ?', parameters: [new Date(now - 3_600_000).toISOString()] },
    {
      sql: 'INSERT INTO auth_challenges (id, message, invite_hash, expires_at) VALUES (?, ?, ?, ?)',
      parameters: [challengeId, message, invite, expiresAt],
    },
  ]);
  return json(200, { challengeId, message, expiresAt });
}

async function verify(request: Request, deps: GatewayDeps, auth: AuthConfig): Promise<Response> {
  const body = await readBody(request);
  if (!body || typeof body.challengeId !== 'string') return json(400, { error: 'challengeId is required' });
  const signature = { data: body.data, signature: body.signature, verifyingKey: body.verifyingKey };
  if (!isWalletSignature(signature)) return json(400, { error: 'data, signature and verifyingKey are required' });

  const row = await deps.db.first<{ message: string; invite_hash: string | null; expires_at: string; used_at: string | null }>(
    'SELECT message, invite_hash, expires_at, used_at FROM auth_challenges WHERE id = ?',
    [body.challengeId],
  );
  if (!row) return json(400, { error: 'Unknown challenge', code: 'challenge_unknown' });
  const now = new Date();
  if (row.used_at) return json(409, { error: 'This challenge was already used', code: 'challenge_used' });
  if (row.expires_at <= now.toISOString()) return json(410, { error: 'The challenge expired', code: 'challenge_expired' });
  const claimed = await deps.db.execute('UPDATE auth_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL', [
    now.toISOString(),
    body.challengeId,
  ]);
  if (claimed !== 1) return json(409, { error: 'This challenge was already used', code: 'challenge_used' });

  if (!(await verifyWalletSignature(signature, row.message))) {
    return json(401, { error: 'The wallet signature does not match this challenge', code: 'bad_signature' });
  }
  const keyHash = await walletKeyHash(signature.verifyingKey);
  const exp = now.getTime() + WALLET_SESSION_MS;

  if (auth.adminKeyHashes.includes(keyHash)) {
    return issue(auth, { sub: keyHash, role: 'admin', workerId: null, exp });
  }

  if (row.invite_hash) {
    const invite = await deps.db.first<{ worker_id: string }>(
      'SELECT worker_id FROM worker_invites WHERE code_hash = ?',
      [row.invite_hash],
    );
    const bound = await deps.db.first(
      'SELECT 1 FROM wallet_bindings WHERE revoked_at IS NULL AND (key_hash = ? OR worker_id = ?)',
      [keyHash, invite?.worker_id ?? ''],
    );
    if (!invite || bound) {
      return json(409, { error: 'This wallet or worker is already bound', code: 'already_bound' });
    }
    const consumed = await deps.db.execute(
      'UPDATE worker_invites SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?',
      [now.toISOString(), row.invite_hash, now.toISOString()],
    );
    if (consumed !== 1) return json(409, { error: 'The invite code was already used or expired', code: 'invite_used' });
    await deps.db.batch([
      {
        sql: 'INSERT INTO wallet_bindings (id, key_hash, worker_id, created_at) VALUES (?, ?, ?, ?)',
        parameters: [`wb-${crypto.randomUUID()}`, keyHash, invite.worker_id, now.toISOString()],
      },
      {
        sql: `INSERT INTO audit_log (id, actor_user_id, action, target_table, target_id, after_json, ts)
              VALUES (?, ?, 'wallet_binding.create', 'wallet_bindings', ?, ?, ?)`,
        parameters: [
          `al-${crypto.randomUUID()}`,
          keyHash,
          invite.worker_id,
          JSON.stringify({ keyHash, workerId: invite.worker_id }),
          now.toISOString(),
        ],
      },
    ]);
    return issue(auth, { sub: keyHash, role: 'worker', workerId: invite.worker_id, exp });
  }

  const binding = await deps.db.first<{ worker_id: string }>(
    'SELECT worker_id FROM wallet_bindings WHERE key_hash = ? AND revoked_at IS NULL',
    [keyHash],
  );
  if (binding) return issue(auth, { sub: keyHash, role: 'worker', workerId: binding.worker_id, exp });
  return json(403, {
    error: 'This wallet is not registered. Ask the admin for an invite code.',
    code: 'unregistered',
    keyHash,
  });
}

async function guestEntry(deps: GatewayDeps, auth: AuthConfig): Promise<Response> {
  const id = randomHex(4);
  const workerId = `guest-${id}`;
  const ringId = `ring-guest-${id}`;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const exp = now + GUEST_SESSION_MS;
  await deps.db.batch([
    { sql: 'INSERT INTO workers (id, created_at) VALUES (?, ?)', parameters: [workerId, nowIso] },
    { sql: 'INSERT INTO worker_pii (worker_id, name) VALUES (?, ?)', parameters: [workerId, `ゲスト ${id.slice(0, 4)}`] },
    {
      sql: "INSERT INTO rings (id, label, status, created_at) VALUES (?, ?, 'deployed', ?)",
      parameters: [ringId, `GUEST-${id.slice(0, 4).toUpperCase()}`, nowIso],
    },
    {
      sql: 'INSERT INTO ring_worker_map (ring_id, worker_id, from_ts, to_ts) VALUES (?, ?, ?, NULL)',
      parameters: [ringId, workerId, nowIso],
    },
    {
      sql: 'INSERT INTO guest_sessions (id, worker_id, ring_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      parameters: [id, workerId, ringId, nowIso, new Date(exp).toISOString()],
    },
  ]);
  return issue(auth, { sub: `guest:${id}`, role: 'worker', workerId, exp, guest: true });
}

async function guestPersona(request: Request, deps: GatewayDeps, auth: AuthConfig): Promise<Response> {
  const viewer = await authenticate(deps, request);
  if (!viewer || !viewer.guestId) return json(401, { error: 'A guest session is required' });
  const body = await readBody(request);
  const role = body?.role;
  if (role !== 'admin' && role !== 'worker') return json(400, { error: 'role must be admin or worker' });
  const guest = await deps.db.first<{ worker_id: string }>('SELECT worker_id FROM guest_sessions WHERE id = ?', [
    viewer.guestId,
  ]);
  if (!guest) return json(401, { error: 'A guest session is required' });
  return issue(auth, {
    sub: viewer.subject,
    role,
    workerId: role === 'worker' ? guest.worker_id : null,
    exp: viewer.expiresAt,
    guest: true,
  });
}

export async function handleAuth(request: Request, deps: GatewayDeps): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/auth/')) return null;
  const auth = deps.auth;
  if (!auth) return json(503, { error: 'Login is not configured (SESSION_SECRET)' });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  if (path === '/api/auth/challenge') return challenge(request, deps);
  if (path === '/api/auth/verify') return verify(request, deps, auth);
  if (path === '/api/auth/guest' || path === '/api/auth/guest/persona') {
    if (!auth.guestEntry) return json(404, { error: 'Guest entry is disabled' });
    return path === '/api/auth/guest' ? guestEntry(deps, auth) : guestPersona(request, deps, auth);
  }
  return json(404, { error: 'Unknown API route' });
}
