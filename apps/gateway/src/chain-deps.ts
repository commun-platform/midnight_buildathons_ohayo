import type { SqlDatabase } from '@midnight-demo/db';
import { enqueueReadings } from '@midnight-demo/ingester/queue';
import { reconcileSubmissions } from '@midnight-demo/ingester/reconcile';
import { submitStagedFeed } from '@midnight-demo/ingester/submit';
import type { ConditionChain } from '@midnight-demo/ingester-core';

import type { ReconcileFn, SubmitStagedFn } from './deps.js';

export function reconcileWith(db: SqlDatabase, chain: Pick<ConditionChain, 'readEntries'>): ReconcileFn {
  return async (entryKeys) => {
    const r = await reconcileSubmissions(db, chain, { entryKeys: [...entryKeys] });
    return {
      confirmed: r.confirmed,
      mismatches: r.mismatches.length,
      valueMismatches: r.valueMismatches.length,
      missing: r.missing.length,
    };
  };
}

export function submitStagedWith(
  db: SqlDatabase,
  chain: ConditionChain,
  salt: Uint8Array,
  openingKeyHex?: string,
): SubmitStagedFn {
  return (options) => submitStagedFeed(db, chain, salt, { ...options, ...(openingKeyHex ? { openingKeyHex } : {}) });
}

export function enqueueStagedWith(db: SqlDatabase): SubmitStagedFn {
  return async (options) => ({
    queued: await enqueueReadings(db, {
      ...(options.tamper ? { tamper: true } : {}),
      ...(options.ringIds ? { ringIds: options.ringIds } : {}),
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      ...(options.submittedBy ? { queuedBy: options.submittedBy } : {}),
    }),
    submitted: 0,
    skipped: 0,
    failed: 0,
    tampered: 0,
    reconcile: null,
  });
}
