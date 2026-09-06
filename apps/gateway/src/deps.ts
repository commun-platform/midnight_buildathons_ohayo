import type { ConditionReader } from '@midnight-demo/condition-read';
import type { SqlDatabase } from '@midnight-demo/db';
import { hexToBytes } from '@midnight-demo/shared';

export type ReconcileFn = (entryKeys: readonly string[]) => Promise<{
  confirmed: number;
  localChecked: number;
  mismatches: number;
  valueMismatches: number;
  missing: number;
}>;

export type SubmitFn = (input: {
  ringId: string;
  value: number;
  recordedAt: string;
  tamper?: boolean;
}) => Promise<
  | {
      ok: true;
      entryKey: string;
      ringId: string;
      periodStartMs: number;
      band: string;
      storedBand: string;
      tampered: boolean;
      txId: string;
      blockHeight: string;

      recovered?: boolean;
    }
  | { ok: false; reason: string }
>;

export type SubmitStagedFn = () => Promise<{
  submitted: number;
  skipped: number;
  reconcile: { confirmed: number; mismatches: number; valueMismatches: number; missing: number } | null;
}>;

export interface GatewayDeps {
  db: SqlDatabase;
  reader: ConditionReader;
  salt: Uint8Array;
  config?: { network?: string; explorerUrl?: string };
  reconcile?: ReconcileFn;
  submit?: SubmitFn;
  submitStaged?: SubmitStagedFn;
}

export function saltFromHex(hex: string | undefined): Uint8Array {
  const trimmed = hex?.trim();
  if (!trimmed) throw new Error('INGESTER_SALT_HEX is required for the read API');
  const bytes = hexToBytes(trimmed);
  if (bytes.length < 16) throw new Error('INGESTER_SALT_HEX must be at least 16 bytes');
  return bytes;
}
