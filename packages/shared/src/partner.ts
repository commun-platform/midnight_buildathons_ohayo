import { bytesToHex, hexToBytes } from './hex.js';

export const PARTNER_SCORE_DOMAIN = 'sadako-partner-score-v1';

export type PartnerKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

export interface PartnerScore {
  id: string;
  ringId: string;
  measuredAt: string;
  score: number;
}

export interface SignedPartnerScore extends PartnerScore {
  signature: string;
}

export function partnerScoreMessage(score: PartnerScore): Uint8Array {
  return new TextEncoder().encode(
    [PARTNER_SCORE_DOMAIN, score.id, score.ringId, score.measuredAt, String(score.score)].join('\n'),
  );
}

export async function partnerKeyId(publicKeyHex: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(hexToBytes(publicKeyHex)));
  return bytesToHex(new Uint8Array(digest)).slice(0, 16);
}

export async function importPartnerPublicKey(publicKeyHex: string): Promise<PartnerKey> {
  const raw = hexToBytes(publicKeyHex);
  if (raw.length !== 32) throw new Error('PARTNER_PUBLIC_KEY must be a 32-byte Ed25519 key in hex');
  return crypto.subtle.importKey('raw', new Uint8Array(raw), { name: 'Ed25519' }, false, ['verify']);
}

export async function verifyPartnerScore(key: PartnerKey, score: SignedPartnerScore): Promise<boolean> {
  let signature: Uint8Array;
  try {
    signature = hexToBytes(score.signature);
  } catch {
    return false;
  }
  if (signature.length !== 64) return false;
  return crypto.subtle.verify(
    { name: 'Ed25519' },
    key,
    new Uint8Array(signature),
    new Uint8Array(partnerScoreMessage(score)),
  );
}
