import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.INGESTER_SALT_HEX ??= '5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a';

const { loadSampleFeed, loadSampleRoster, runSqlScript } = await import('@midnight-demo/db');
const { openIngesterDb } = await import('./db.js');
const { loadAndPlan, recordPlannedLocally } = await import('./pipeline.js');

function freshDbEnv(): Record<string, string> {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-pipe-')), 'ingester.db');
  return { LIBSQL_URL: `file:${file}` };
}

async function seededDb() {
  const db = await openIngesterDb(freshDbEnv());
  await runSqlScript(db, loadSampleRoster());
  await runSqlScript(db, loadSampleFeed());
  return db;
}

test('loadAndPlan plans the known in-range rings and skips the rest', async () => {
  const db = await seededDb();
  const { plan } = await loadAndPlan(db);
  assert.equal(plan.planned.length, 2);
  assert.deepEqual(plan.planned.map((p) => p.ringId).sort(), ['ring-1', 'ring-2']);
  assert.equal(plan.skipped.filter((s) => s.kind === 'unknown-ring').length, 1);
  assert.equal(plan.skipped.filter((s) => s.kind === 'invalid-value').length, 1);
});

test('recording locally then re-planning is idempotent', async () => {
  const db = await seededDb();
  const first = await loadAndPlan(db);
  const added = await recordPlannedLocally(db, first);
  assert.equal(added.length, 2);

  const rerun = await loadAndPlan(db);
  assert.equal(rerun.plan.planned.length, 0);
  assert.equal(rerun.plan.skipped.filter((s) => s.kind === 'already-submitted').length, 2);
});

test('an empty DB plans nothing', async () => {
  const db = await openIngesterDb(freshDbEnv());
  const { plan } = await loadAndPlan(db);
  assert.deepEqual(plan, { planned: [], skipped: [] });
});
