import assert from 'node:assert/strict';
import test from 'node:test';

import { openOpening, parseDisclosureReceipt, periodDate, sealOpening } from './opening.js';

const key = 'ab'.repeat(32);
const opening = { scoreCenti: 7200, nonceHex: '11'.repeat(32) };

test('a sealed opening opens only with the same key and entry key', async () => {
  const sealed = await sealOpening(key, '42', opening);
  assert.match(sealed, /^v1\.[0-9a-f]{24}\.[0-9a-f]+$/);
  assert.ok(!sealed.includes('7200'));
  assert.deepEqual(await openOpening(key, '42', sealed), opening);
  await assert.rejects(openOpening('cd'.repeat(32), '42', sealed), /does not open/);
  await assert.rejects(openOpening(key, '43', sealed), /does not open/);
  await assert.rejects(openOpening(key, '42', 'nonsense'), /unknown format/);
  await assert.rejects(sealOpening('ab', '42', opening), /32 bytes/);
});

test('a disclosure receipt is parsed strictly', () => {
  const receipt = {
    v: 1,
    entryKey: '42',
    scoreCenti: 7200,
    nonceHex: '11'.repeat(32),
    scoreCommitmentHex: '22'.repeat(32),
    periodDate: '2026-10-02',
    issuedAt: '2026-10-02T09:00:00.000Z',
  };
  assert.deepEqual(parseDisclosureReceipt(receipt), receipt);
  assert.equal(parseDisclosureReceipt({ ...receipt, v: 2 }), null);
  assert.equal(parseDisclosureReceipt({ ...receipt, scoreCenti: 10_001 }), null);
  assert.equal(parseDisclosureReceipt({ ...receipt, nonceHex: 'zz' }), null);
  assert.equal(parseDisclosureReceipt({ ...receipt, entryKey: '0x2a' }), null);
  assert.equal(parseDisclosureReceipt('receipt'), null);
});

test('the period date is the calendar day in the app time zone', () => {
  assert.equal(periodDate(Date.parse('2026-10-01T15:00:00Z'), 'Asia/Tokyo'), '2026-10-02');
});
