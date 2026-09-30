import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { securityHeaders } from './security.js';

function connectSrc(headers: Record<string, string>): string {
  const directive = headers['content-security-policy']?.split('; ').find((d) => d.startsWith('connect-src '));
  assert.ok(directive);
  return directive;
}

test('connect-src allows only the SADAKO origin without a partner', () => {
  assert.equal(connectSrc(securityHeaders()), "connect-src 'self'");
});

test('connect-src adds exactly the partner origin, never its path', () => {
  assert.equal(
    connectSrc(securityHeaders('http://localhost:8788/v1/measurements')),
    "connect-src 'self' http://localhost:8788",
  );
  assert.equal(
    connectSrc(securityHeaders('https://sadako-partner.example.workers.dev')),
    "connect-src 'self' https://sadako-partner.example.workers.dev",
  );
});

test('a malformed or non-http partner URL is ignored', () => {
  assert.equal(connectSrc(securityHeaders('not a url')), "connect-src 'self'");
  assert.equal(connectSrc(securityHeaders('javascript:alert(1)')), "connect-src 'self'");
});

test('without a partner the headers are exactly apps/dashboard/public/_headers', () => {
  const file = fs.readFileSync(new URL('../../dashboard/public/_headers', import.meta.url), 'utf8');
  const fromFile = Object.fromEntries(
    file
      .split(/\r?\n/)
      .map((line) => line.trim().match(/^([A-Za-z-]+):\s*(.+)$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => [(m[1] as string).toLowerCase(), m[2] as string]),
  );
  assert.deepEqual(securityHeaders(), fromFile);
});
