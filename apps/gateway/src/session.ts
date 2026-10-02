export type SessionRole = 'admin' | 'worker';

export interface SessionPayload {
  sub: string;
  role: SessionRole;
  workerId: string | null;
  exp: number;
  guest?: boolean;
}

export const WALLET_SESSION_MS = 12 * 60 * 60 * 1000;
export const GUEST_SESSION_MS = 2 * 60 * 60 * 1000;

const encoder = new TextEncoder();

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string) {
  if (secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = base64Url(encoder.encode(JSON.stringify(payload)));
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(`v1.${body}`));
  return `v1.${body}.${base64Url(new Uint8Array(mac))}`;
}

function isPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.sub === 'string' &&
    (p.role === 'admin' || p.role === 'worker') &&
    (p.workerId === null || typeof p.workerId === 'string') &&
    typeof p.exp === 'number' &&
    (p.guest === undefined || typeof p.guest === 'boolean')
  );
}

export async function verifySession(token: string, secret: string, now = Date.now()): Promise<SessionPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const [, body, mac] = parts as [string, string, string];
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      new Uint8Array(fromBase64Url(mac)),
      encoder.encode(`v1.${body}`),
    );
  } catch {
    return null;
  }
  if (!valid) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
  } catch {
    return null;
  }
  if (!isPayload(payload) || payload.exp <= now) return null;
  return payload;
}
