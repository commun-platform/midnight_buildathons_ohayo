import assert from 'node:assert/strict';
import test from 'node:test';

import { bytesToHex, hexToBytes } from './hex.js';

test('bytesToHex / hexToBytes round-trip', () => {
  const bytes = new Uint8Array([0x00, 0x0f, 0xa5, 0xff]);
  assert.equal(bytesToHex(bytes), '000fa5ff');
  assert.deepEqual(hexToBytes('000fa5ff'), bytes);
});

test('hexToBytes accepts a 0x prefix', () => {
  assert.deepEqual(hexToBytes('0x5a5a'), new Uint8Array([0x5a, 0x5a]));
});

test('hexToBytes rejects odd-length and non-hex input', () => {
  assert.throws(() => hexToBytes('abc'), /even-length/);
  assert.throws(() => hexToBytes('zz'), /hexadecimal/);
});
