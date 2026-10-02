import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

const WORKER_ENTRIES = [
  'apps/gateway/src/routes.ts',
  'apps/gateway/src/deps.ts',
  'apps/gateway/src/decisions.ts',
  'apps/gateway/src/security.ts',
  'apps/gateway/src/chain-deps.ts',
  'apps/worker/src/worker.ts',
  'apps/partner-mock/src/worker.ts',
  'apps/ingester/src/partner.ts',
  'apps/ingester/src/store.ts',
  'apps/ingester/src/submit.ts',
  'apps/ingester/src/reconcile.ts',
  'apps/ingester/src/queue.ts',
  'packages/condition-read/src/index.ts',
  'packages/db/src/d1.ts',
  'packages/db/src/migrate.ts',
];

const FORBIDDEN = [
  /^@midnight-ntwrk\//,
  /^@midnight-demo\/midnight-chain/,
  /^@midnight-demo\/condition-registry-contract/,
  /^@midnight-demo\/shared\/commitment$/,
  /^@libsql\//,
  /^@polkadot\//,
  /^node:/,
  /^dotenv$/,
];

function workspaceDirs(): Map<string, string> {
  const dirs = new Map<string, string>();
  for (const parent of ['apps', 'apps/development', 'contracts', 'packages']) {
    for (const entry of fs.readdirSync(path.join(repoRoot, parent), { withFileTypes: true })) {
      const manifest = path.join(repoRoot, parent, entry.name, 'package.json');
      if (!entry.isDirectory() || !fs.existsSync(manifest)) continue;
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { name: string };
      dirs.set(pkg.name, path.join(repoRoot, parent, entry.name));
    }
  }
  return dirs;
}

const workspaces = workspaceDirs();

function resolveWorkspace(specifier: string): string | null {
  const match = specifier.match(/^(@midnight-demo\/[^/]+)(\/.*)?$/);
  const dir = match && workspaces.get(match[1] as string);
  if (!match || !dir) return null;
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
    exports?: string | Record<string, string>;
  };
  const subpath = `.${match[2] ?? ''}`;
  const target = typeof pkg.exports === 'string'
    ? (subpath === '.' ? pkg.exports : undefined)
    : pkg.exports?.[subpath];
  assert.ok(target, `${specifier} is not exported by ${match[1]}`);
  return path.join(dir, target);
}

function valueImports(source: string): string[] {
  const found: string[] = [];
  const statement = /^\s*(import|export)\s+(type\s+)?([^;()]*?)\s*from\s+['"]([^'"]+)['"]/gm;
  for (const match of source.matchAll(statement)) {
    const [, , typeOnly, clause = '', specifier = ''] = match;
    if (typeOnly) continue;
    const named = clause.trim().match(/^\{([\s\S]*)\}$/);
    const names = named ? (named[1] as string).split(',').map((n) => n.trim()).filter(Boolean) : [];
    if (named && names.length > 0 && names.every((n) => n.startsWith('type '))) continue;
    found.push(specifier);
  }
  for (const match of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) found.push(match[1] as string);
  for (const match of source.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) found.push(match[1] as string);
  return found;
}

function reach(entries: readonly string[]): { files: Set<string>; external: Map<string, string> } {
  const files = new Set<string>();
  const external = new Map<string, string>();
  const queue = entries.map((entry) => path.join(repoRoot, entry));
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of valueImports(fs.readFileSync(file, 'utf8'))) {
      const next = specifier.startsWith('.')
        ? path.resolve(path.dirname(file), specifier.replace(/\.js$/, '.ts'))
        : resolveWorkspace(specifier);
      if (next) queue.push(next);
      else if (!external.has(specifier)) external.set(specifier, path.relative(repoRoot, file));
    }
  }
  return { files, external };
}

function relative(files: Set<string>): string[] {
  return [...files].map((file) => path.relative(repoRoot, file).split(path.sep).join('/'));
}

test('the Worker request path never reaches the Compact runtime, the SDK, libSQL, or Node built-ins', () => {
  const { files, external } = reach(WORKER_ENTRIES);
  for (const [specifier, from] of external) {
    for (const pattern of FORBIDDEN) {
      assert.doesNotMatch(specifier, pattern, `${from} reaches ${specifier}`);
    }
  }
  const reached = relative(files);
  for (const expected of [
    'apps/gateway/src/admin.ts',
    'apps/gateway/src/auth.ts',
    'packages/shared/src/condition.ts',
    'packages/shared/src/period.ts',
    'packages/condition-read/src/history.ts',
  ]) {
    assert.ok(reached.includes(expected), `expected the walk to reach ${expected}`);
  }
  assert.ok(!reached.includes('packages/shared/src/commitment.ts'));
  assert.ok(!reached.includes('packages/ingester-core/src/plan.ts'));
});

test('the boundary walk does flag a module that commits scores', () => {
  const { external } = reach(['packages/ingester-core/src/plan.ts']);
  assert.ok(external.has('@midnight-ntwrk/compact-runtime'));
});

test('midnight-chain carries no database dependency', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'packages/midnight-chain/package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string> };
  assert.equal(pkg.dependencies?.['@midnight-demo/db'], undefined);
  const dir = path.join(repoRoot, 'packages/midnight-chain/src');
  for (const entry of fs.readdirSync(dir)) {
    if (!entry.endsWith('.ts')) continue;
    const source = fs.readFileSync(path.join(dir, entry), 'utf8');
    assert.doesNotMatch(source, /@midnight-demo\/db|SqlDatabase/, `packages/midnight-chain/src/${entry}`);
  }
});
