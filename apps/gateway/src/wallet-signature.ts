import { schnorr } from '@noble/curves/secp256k1';

export interface WalletSignature {
  data: string;
  signature: string;
  verifyingKey: string;
}

const encoder = new TextEncoder();

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

export function isWalletSignature(value: unknown): value is WalletSignature {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.data === 'string' &&
    typeof s.signature === 'string' &&
    typeof s.verifyingKey === 'string' &&
    s.data.length <= 2048 &&
    s.signature.length > 0 &&
    s.signature.length <= 1024 &&
    s.verifyingKey.length > 0 &&
    s.verifyingKey.length <= 1024
  );
}

export const SIGNED_MESSAGE_PREFIX = 'midnight_signed_message:';

export function signedMessageBytes(message: string): Uint8Array {
  const data = encoder.encode(message);
  const header = encoder.encode(`${SIGNED_MESSAGE_PREFIX}${data.length}:`);
  const bytes = new Uint8Array(header.length + data.length);
  bytes.set(header, 0);
  bytes.set(data, header.length);
  return bytes;
}

export async function verifyWalletSignature(signature: WalletSignature, canonical: string): Promise<boolean> {
  if (signature.data !== canonical) return false;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(signedMessageBytes(canonical))));
  try {
    return schnorr.verify(signature.signature, digest, signature.verifyingKey);
  } catch {
    return false;
  }
}

export function walletKeyHash(verifyingKey: string): Promise<string> {
  return sha256Hex(verifyingKey);
}
