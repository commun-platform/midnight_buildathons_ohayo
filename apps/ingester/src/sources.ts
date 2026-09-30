import type { SqlDatabase } from '@midnight-demo/db';
import type { ConditionRecord } from '@midnight-demo/ingester-core';

import { loadConditionFeed } from './store.js';

export interface ConditionSource {
  load(): Promise<ConditionRecord[]>;
}

export function dbConditionSource(db: SqlDatabase): ConditionSource {
  return { load: () => loadConditionFeed(db) };
}
