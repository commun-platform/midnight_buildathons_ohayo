import { config as loadEnv } from 'dotenv';
import path from 'node:path';

import { loadSampleFeed, loadSampleRoster, runSqlScript } from '@midnight-demo/db';

import { openIngesterDb } from './db.js';
import { loadAndPlan, recordPlannedLocally, repoRoot, summarize } from './pipeline.js';

loadEnv({ path: path.join(repoRoot, '.env'), quiet: true });
loadEnv({ path: path.join(repoRoot, '.env.local'), quiet: true });

type Command = 'plan' | 'record' | 'seed';

async function main(): Promise<void> {
  const command = (process.argv[2] ?? 'plan') as Command;
  const db = await openIngesterDb();

  if (command === 'seed') {
    if (process.argv.includes('--sample')) {
      await runSqlScript(db, loadSampleRoster());
      await runSqlScript(db, loadSampleFeed());
      process.stdout.write('applied packages/db/seed/sample-roster.sql + sample-feed.sql\n');
    } else {
      process.stdout.write('nothing to seed (pass --sample for the roster + feed fixtures)\n');
    }
    return;
  }

  const inputs = await loadAndPlan(db);
  process.stdout.write(`${summarize(inputs)}\n`);

  if (command === 'plan') return;

  if (command === 'record') {
    if (!process.argv.includes('--local')) {
      throw new Error(
        'On-chain submission runs from apps/development/condition-cli (Midnight SDK + a ' +
          'funded operating wallet). Run: npm run ingest:submit. Use `record --local` to ' +
          'record planned entries in the submissions table for offline idempotency testing.',
      );
    }
    const added = await recordPlannedLocally(db, inputs);
    process.stdout.write(
      `\nrecorded ${added.length} entr${added.length === 1 ? 'y' : 'ies'} to the submissions table (no on-chain tx)\n`,
    );
    return;
  }

  throw new Error(`Unknown command: ${command}. Use: seed | plan | record --local`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
