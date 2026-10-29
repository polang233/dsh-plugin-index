import test from 'node:test';
import assert from 'node:assert/strict';
import { signedLikeRequest, verifySignedLike } from '../shared/signed-like.js';
import { voterFingerprint } from '../shared/visitor-identity.js';

test('gateway votes retain the original daily identity and reject forged or expired bodies', async () => {
  const secret = 'synthetic-secret-at-least-32-characters';
  const now = Date.parse('2026-10-29T12:00:00Z');
  const options = { endpoint: 'https://counter.example/api/like', secret, visitorSalt: 'old-salt', ip: '2001:db8::1234', now };
  const signed = await signedLikeRequest(new Request('https://site.example/api/like', { method: 'POST', body: '{"name":"example","source":"install"}' }), options);
  assert.equal(await verifySignedLike(signed.clone(), { secret, now }), await voterFingerprint({ salt: 'old-salt', day: '2026-10-29', ip: '2001:db8::9999' }));
  assert.equal(signed.headers.has('cf-connecting-ip'), false);
  assert.equal(await verifySignedLike(new Request(signed, { body: '{"name":"other"}' }), { secret, now }), null);
  assert.equal(await verifySignedLike(signed.clone(), { secret, now: now + 121000 }), null);
  assert.equal(await verifySignedLike(signed.clone(), { secret: secret + 'x', now }), null);
});
