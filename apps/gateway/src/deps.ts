import type { ConditionReader } from '@midnight-demo/condition-read';
import type { SqlDatabase } from '@midnight-demo/db';
import type { PartnerConfig } from '@midnight-demo/ingester/partner';

import type { AuthConfig } from './auth.js';
import { hexToBytes } from '@midnight-demo/shared';

export type ReconcileFn = (entryKeys: readonly string[]) => Promise<{
  confirmed: number;
  localChecked: number;
  mismatches: number;
  valueMismatches: number;
  missing: number;
}>;

export interface SubmitStagedOptions {
  tamper?: boolean;
  ringIds?: readonly string[];
  limit?: number;
  submittedBy?: string;
}

export type SubmitStagedFn = (options: SubmitStagedOptions) => Promise<{
  submitted: number;
  skipped: number;
  failed: number;
  tampered: number;
  reconcile: { confirmed: number; mismatches: number; valueMismatches: number; missing: number } | null;
}>;

export interface GatewayDeps {
  db: SqlDatabase;
  reader: ConditionReader;
  salt: Uint8Array;
  config?: { network?: string; explorerUrl?: string; partnerUrl?: string };
  reconcile?: ReconcileFn;
  submitStaged?: SubmitStagedFn;
  partner?: PartnerConfig;
  fetch?: typeof fetch;
  auth?: AuthConfig;
}

export function saltFromHex(hex: string | undefined): Uint8Array {
  const trimmed = hex?.trim();
  if (!trimmed) throw new Error('INGESTER_SALT_HEX is required for the read API');
  const bytes = hexToBytes(trimmed);
  if (bytes.length < 16) throw new Error('INGESTER_SALT_HEX must be at least 16 bytes');
  return bytes;
}
