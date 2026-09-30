export interface Vitals {
  heartRate: number;
  hrvMs: number;
  sleepHours: number;
  spo2: number;
  skinTempDelta: number;
}

const VITAL_FIELDS = ['heartRate', 'hrvMs', 'sleepHours', 'spo2', 'skinTempDelta'] as const;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export function scoreFromVitals(v: Vitals): number {
  const total =
    30 * clamp01(v.sleepHours / 8) +
    25 * clamp01((v.hrvMs - 20) / 60) +
    20 * clamp01((90 - v.heartRate) / 35) +
    15 * clamp01((v.spo2 - 90) / 8) +
    10 * clamp01(1 - Math.abs(v.skinTempDelta) / 1.5);
  return Math.round(total * 100) / 100;
}

export function parseVitals(input: unknown): Vitals | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as Record<string, unknown>;
  const out: Partial<Vitals> = {};
  for (const field of VITAL_FIELDS) {
    const value = record[field];
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    out[field] = value;
  }
  return out as Vitals;
}

export async function simulatedScore(ringId: string, date: string): Promise<number> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${ringId}|${date}`)),
  );
  const n = ((digest[0] ?? 0) << 8) | (digest[1] ?? 0);
  return 20 + (n % 8001) / 100;
}
