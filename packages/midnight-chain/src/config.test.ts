import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveNetwork } from './config.js';

test('resolveNetwork supports the local devnet profile', () => {
  const local = resolveNetwork('local');
  assert.equal(local.networkId, 'local');
  assert.equal(local.midnightNetworkId, 'undeployed');
  assert.match(local.indexer, /127\.0\.0\.1:8088/);
  assert.match(local.node, /127\.0\.0\.1:9944/);
  assert.equal(local.faucet, '');
});

test('resolveNetwork keeps preview / preprod', () => {
  assert.equal(resolveNetwork('preprod').midnightNetworkId, 'preprod');
  assert.equal(resolveNetwork('preview').midnightNetworkId, 'preview');
});

test('resolveNetwork rejects unknown networks', () => {
  assert.throws(() => resolveNetwork('mainnet'), /Unsupported Midnight network/);
});
