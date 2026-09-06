import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('the ingester carries no Midnight-SDK, wallet, or proving dependency', () => {
  const pkg = JSON.parse(read('apps/ingester/package.json')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of Object.keys(deps)) {
    assert.doesNotMatch(
      name,
      /^@midnight-ntwrk\/|wallet-sdk|@midnight-demo\/midnight-chain/,
      `apps/ingester must not depend on ${name}`,
    );
  }
});

test('the ingester sources import neither the Midnight SDK nor midnight-chain', () => {
  const dir = path.join(repoRoot, 'apps/ingester/src');
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
    const source = fs.readFileSync(path.join(dir, entry), 'utf8');
    assert.doesNotMatch(source, /@midnight-ntwrk\/|@midnight-demo\/midnight-chain/, `apps/ingester/src/${entry}`);
  }
});

test('on-chain workspaces enforce the development-host boundary', () => {
  const guarded: Array<[string, string[]]> = [
    ['apps/development/condition-cli/package.json', ['deploy', 'submit', 'fund', 'wallet', 'funding']],
    ['contracts/condition-registry/package.json', ['compile']],
  ];
  for (const [relativePath, scripts] of guarded) {
    const pkg = JSON.parse(read(relativePath)) as { scripts: Record<string, string> };
    for (const name of scripts) {
      assert.match(
        pkg.scripts[name] ?? '',
        /require-development-host\.mjs/,
        `${relativePath}#${name} must enforce the host boundary`,
      );
    }
  }
});
