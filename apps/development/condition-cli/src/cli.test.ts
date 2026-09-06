import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

test('condition-cli routes on-chain work through @midnight-demo/midnight-chain', () => {
  const cli = fs.readFileSync(path.join(here, 'cli.ts'), 'utf8');
  assert.match(cli, /@midnight-demo\/midnight-chain/);
  assert.match(cli, /deployConditionRegistry/);
  assert.match(cli, /submitCondition/);
  assert.match(cli, /recordSubmissions/);
  assert.match(cli, /txId/);
});

test('condition-cli scripts enforce the development-host boundary', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };
  for (const name of ['deploy', 'submit', 'fund']) {
    assert.match(pkg.scripts[name] ?? '', /require-development-host\.mjs/);
  }
});
