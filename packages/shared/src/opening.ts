import { bytesToHex, hexToBytes } from './hex.js';

export interface ScoreOpening {
  scoreCenti: number;
  nonceHex: string;
}

export interface DisclosureReceipt {
  v: 1;
  entryKey: string;
  scoreCenti: number;
  nonceHex: string;
  scoreCommitmentHex: string;
  periodDate: string;
  issuedAt: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SEALED = /^v1\.([0-9a-f]{24})\.([0-9a-f]+)$/;
const NONCE = /^[0-9a-f]{64}$/;
const ENTRY_KEY = /^\d{1,90}$/;

async function openingKey(keyHex: string) {
  const bytes = hexToBytes(keyHex.trim());
  if (bytes.length !== 32) throw new Error('OPENING_KEY must be 32 bytes of hex');
  return crypto.subtle.importKey('raw', new Uint8Array(bytes), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function additionalData(entryKey: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(encoder.encode(`ohayo-opening-v1:${entryKey}`));
}

export function isScoreOpening(value: unknown): value is ScoreOpening {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.scoreCenti === 'number' &&
    Number.isInteger(o.scoreCenti) &&
    o.scoreCenti >= 0 &&
    o.scoreCenti <= 10_000 &&
    typeof o.nonceHex === 'string' &&
    NONCE.test(o.nonceHex)
  );
}

export async function sealOpening(keyHex: string, entryKey: string, opening: ScoreOpening): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new Uint8Array(
    encoder.encode(JSON.stringify({ scoreCenti: opening.scoreCenti, nonceHex: opening.nonceHex })),
  );
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: additionalData(entryKey) },
    await openingKey(keyHex),
    plaintext,
  );
  return `v1.${bytesToHex(iv)}.${bytesToHex(new Uint8Array(ciphertext))}`;
}

export async function openOpening(keyHex: string, entryKey: string, sealed: string): Promise<ScoreOpening> {
  const match = SEALED.exec(sealed);
  if (!match) throw new Error('the stored opening has an unknown format');
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(hexToBytes(match[1] as string)), additionalData: additionalData(entryKey) },
      await openingKey(keyHex),
      new Uint8Array(hexToBytes(match[2] as string)),
    );
  } catch {
    throw new Error('the stored opening does not open with this key');
  }
  const opening = JSON.parse(decoder.decode(plaintext)) as unknown;
  if (!isScoreOpening(opening)) throw new Error('the stored opening is malformed');
  return opening;
}

export function parseDisclosureReceipt(value: unknown): DisclosureReceipt | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  if (r.v !== 1) return null;
  if (typeof r.entryKey !== 'string' || !ENTRY_KEY.test(r.entryKey)) return null;
  if (!isScoreOpening({ scoreCenti: r.scoreCenti, nonceHex: r.nonceHex })) return null;
  if (typeof r.scoreCommitmentHex !== 'string' || !NONCE.test(r.scoreCommitmentHex)) return null;
  if (typeof r.periodDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.periodDate)) return null;
  if (typeof r.issuedAt !== 'string' || !Number.isFinite(Date.parse(r.issuedAt))) return null;
  return {
    v: 1,
    entryKey: r.entryKey,
    scoreCenti: r.scoreCenti as number,
    nonceHex: r.nonceHex as string,
    scoreCommitmentHex: r.scoreCommitmentHex,
    periodDate: r.periodDate,
    issuedAt: r.issuedAt,
  };
}

export function periodDate(periodStartMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(periodStartMs),
  );
}
