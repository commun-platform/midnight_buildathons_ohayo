import assert from 'node:assert/strict';
import test from 'node:test';

import { zonedDayStartMs } from './period.js';

test('Asia/Tokyo day start for an evening-UTC reading rolls to the next JST day', () => {
  const reading = Date.parse('2026-08-15T23:41:07.512Z');
  assert.equal(zonedDayStartMs(reading, 'Asia/Tokyo'), Date.parse('2026-08-16T00:00:00+09:00'));
});

test('Asia/Tokyo day start for a morning-UTC reading stays on the same JST day', () => {
  const reading = Date.parse('2026-08-15T10:00:00.000Z');
  assert.equal(zonedDayStartMs(reading, 'Asia/Tokyo'), Date.parse('2026-08-15T00:00:00+09:00'));
});

test('UTC zone day start is plain midnight UTC', () => {
  const reading = Date.parse('2026-08-15T23:41:07.000Z');
  assert.equal(zonedDayStartMs(reading, 'UTC'), Date.parse('2026-08-15T00:00:00Z'));
});

test('America/New_York day start uses the EDT offset in August', () => {
  const reading = Date.parse('2026-08-15T02:00:00.000Z');
  assert.equal(zonedDayStartMs(reading, 'America/New_York'), Date.parse('2026-08-14T00:00:00-04:00'));
});

test('the day start is idempotent (feeding it back yields itself)', () => {
  const reading = Date.parse('2026-08-15T23:41:07.512Z');
  const start = zonedDayStartMs(reading, 'Asia/Tokyo');
  assert.equal(zonedDayStartMs(start, 'Asia/Tokyo'), start);
});
