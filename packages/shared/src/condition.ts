import { CompactTypeUnsignedInteger, persistentCommit } from '@midnight-ntwrk/compact-runtime';

async function sha256(value: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(value).buffer));
}

export type ConditionBand = 'normal' | 'caution' | 'danger';

export const CONDITION_BAND_LABELS_JA: Record<ConditionBand, string> = {
  normal: '正常',
  caution: '要注意',
  danger: '危険',
};

export const CONDITION_BAND_ORDINAL: Record<ConditionBand, number> = {
  danger: 1,
  caution: 2,
  normal: 3,
};

export function conditionBandFromOrdinal(ordinal: number): ConditionBand | 'unclassified' {
  return (['unclassified', 'danger', 'caution', 'normal'] as const)[ordinal] ?? 'unclassified';
}

export const CONDITION_NORMAL_MIN = 60;
export const CONDITION_CAUTION_MIN = 40;

export const CONDITION_SCORE_SCALE = 100;

export function classifyCondition(value: number): ConditionBand {
  if (value >= CONDITION_NORMAL_MIN) return 'normal';
  if (value >= CONDITION_CAUTION_MIN) return 'caution';
  return 'danger';
}

export function conditionScoreCenti(value: number): number {
  const centi = Math.round(value * CONDITION_SCORE_SCALE);
  if (!Number.isInteger(centi) || centi < 0 || centi > 100 * CONDITION_SCORE_SCALE) {
    throw new Error(`Condition value ${value} is outside the supported 0..100 range`);
  }
  return centi;
}

export const CONDITION_NORMAL_MIN_CENTI = CONDITION_NORMAL_MIN * CONDITION_SCORE_SCALE;
export const CONDITION_CAUTION_MIN_CENTI = CONDITION_CAUTION_MIN * CONDITION_SCORE_SCALE;

export function classifyConditionCenti(scoreCenti: number): ConditionBand {
  if (scoreCenti >= CONDITION_NORMAL_MIN_CENTI) return 'normal';
  if (scoreCenti >= CONDITION_CAUTION_MIN_CENTI) return 'caution';
  return 'danger';
}

const scoreCentiType = new CompactTypeUnsignedInteger((1n << 32n) - 1n, 4);

export function conditionScoreCommitment(scoreCenti: number, nonce: Uint8Array): Uint8Array {
  if (nonce.length !== 32) throw new Error('Condition score nonce must be 32 bytes');
  return persistentCommit(scoreCentiType, BigInt(scoreCenti), nonce);
}

function bigUint64BE(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, false);
  return out;
}

export async function conditionEntryKey(
  ringId: string,
  periodStartMs: number | bigint,
  salt: Uint8Array,
): Promise<bigint> {
  if (!ringId) throw new Error('ringId is required');
  const period = BigInt(periodStartMs);
  if (period < 0n || period >= 1n << 64n) throw new Error('periodStartMs is outside u64');
  const ring = new TextEncoder().encode(ringId);
  const periodBytes = bigUint64BE(period);
  const buffer = new Uint8Array(ring.length + periodBytes.length + salt.length);
  buffer.set(ring, 0);
  buffer.set(periodBytes, ring.length);
  buffer.set(salt, ring.length + periodBytes.length);

  const digest = await sha256(buffer);
  let acc = 0n;
  for (let i = 0; i < 31; i += 1) acc = (acc << 8n) | BigInt(digest[i] ?? 0);
  return acc;
}

export const CONDITION_DAY_WINDOW_MS = 108_000_000;
