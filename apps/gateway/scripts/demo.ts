import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { dbConditionReader } from '@midnight-demo/condition-read';
import {
  applyMigrations,
  createDatabase,
  loadConditionMigrations,
  loadSampleRoster,
  runSqlScript,
} from '@midnight-demo/db';
import { conditionEntryKey } from '@midnight-demo/shared';

import { handleRead } from '../src/test-support.js';

const SALT = new Uint8Array(16).fill(0x5a);
const AUG16_JST = Date.parse('2026-08-16T00:00:00+09:00');
const AUG15_JST = Date.parse('2026-08-15T00:00:00+09:00');

const INSERT = `INSERT INTO submissions (
  entry_key, ring_id, period_start_ms, timezone, recorded_at_ms,
  band, score_commitment_hex, submitted_at, chain_verified_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

async function main(): Promise<void> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gw-demo-')), 'demo.db');
  const db = createDatabase({ url: `file:${file}` });
  await applyMigrations(db, loadConditionMigrations());
  await runSqlScript(db, loadSampleRoster());

  const recorded = Date.parse('2026-08-15T22:10:00.000Z');
  const rows: Array<[string, number, number, string, string | null]> = [
    ['ring-1', AUG15_JST, recorded, 'normal', '2026-08-16T09:00:00Z'],
    ['ring-1', AUG16_JST, recorded, 'caution', '2026-08-16T09:00:00Z'],
    ['ring-2', AUG16_JST, recorded, 'danger', null],
  ];
  await db.batch(
    await Promise.all(
      rows.map(async ([ring, periodStartMs, recordedAtMs, band, verifiedAt]) => ({
        sql: INSERT,
        parameters: [
          (await conditionEntryKey(ring, periodStartMs, SALT)).toString(),
          ring,
          periodStartMs,
          'Asia/Tokyo',
          recordedAtMs,
          band,
          'ab'.repeat(32),
          new Date().toISOString(),
          verifiedAt,
        ] as (string | number | null)[],
      })),
    ),
  );

  const deps = { db, reader: dbConditionReader(db), salt: SALT };

  const range = '?from=2026-08-14T00:00:00%2B09:00&to=2026-08-18T00:00:00%2B09:00';
  const calls: Array<[string, string, string]> = [
    ['admin      → /all', '/api/conditions/all', 'admin'],
    ['worker-1   → /worker/worker-1', '/api/conditions/worker/worker-1', 'worker-1'],
    ['worker-1   → /worker/worker-2', '/api/conditions/worker/worker-2', 'worker-1'],
    ['(no token) → /all', '/api/conditions/all', ''],
  ];

  for (const [label, pathname, token] of calls) {
    const request = new Request(`http://gw${pathname}${range}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    const response = await handleRead(request, deps);
    const body = response ? await response.json() : null;
    process.stdout.write(`\n=== ${label} ===  [${response?.status}]\n`);
    if (body && 'rings' in body) {
      for (const ring of body.rings) {
        const bands =
          ring.entries
            .map((e: { band: string; verified: boolean }) => `${e.band}${e.verified ? '' : '?'}`)
            .join(', ') || '(none)';
        process.stdout.write(`  ${ring.ringId} (${ring.workerName ?? "-"}): ${bands}\n`);
      }
    } else {
      process.stdout.write(`  ${JSON.stringify(body)}\n`);
    }
  }
  process.stdout.write('\n(? = not yet chain-confirmed / chain_verified_at NULL)\n');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
