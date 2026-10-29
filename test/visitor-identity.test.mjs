import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { readerFingerprint, voterFingerprint } from '../shared/visitor-identity.js';

const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const base = { salt: 'synthetic-salt', day: '2026-10-29', ip: '192.0.2.1' };

test('reader fingerprints match the existing Worker and change by UTC day or user agent', async () => {
  const actual = await readerFingerprint({ ...base, userAgent: 'test-client' });
  assert.equal(actual, hash('synthetic-salt|2026-10-29|192.0.2.1|test-client'));
  assert.notEqual(actual, await readerFingerprint({ ...base, day: '2026-10-30', userAgent: 'test-client' }));
  assert.notEqual(actual, await readerFingerprint({ ...base, userAgent: 'other-client' }));
});

test('vote fingerprints match the existing Worker and group IPv6 addresses by /64', async () => {
  assert.equal(await voterFingerprint(base), hash('synthetic-salt|like|2026-10-29|192.0.2.1'));
  const first = await voterFingerprint({ ...base, ip: '2001:0db8:0000:0001:ffff::9' });
  const second = await voterFingerprint({ ...base, ip: '2001:db8:0:1::2' });
  assert.equal(first, hash('synthetic-salt|like|2026-10-29|2001:db8:0:1::/64'));
  assert.equal(first, second);
});

test('missing visitor addresses and oversized user agents cannot collapse unrelated visitors together', async () => {
  await assert.rejects(readerFingerprint({ ...base, ip: '', userAgent: 'test' }), /Invalid visitor identity/);
  await assert.rejects(readerFingerprint({ ...base, userAgent: 'x'.repeat(4097) }), /Invalid user agent/);
});
