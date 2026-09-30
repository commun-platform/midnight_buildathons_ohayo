import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('the shared entry point stays free of the Compact runtime', () => {
  for (const file of ['index.ts', 'condition.ts', 'hex.ts', 'period.ts', 'partner.ts']) {
    const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /@midnight-ntwrk\/|\.\/commitment\.js/, `packages/shared/src/${file}`);
  }
});
