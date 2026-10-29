import assert from 'node:assert/strict';
import test from 'node:test';
import { signedReadRequest, verifySignedRead } from '../shared/signed-read.js';

const secret = 'synthetic-gateway-secret-with-at-least-32-characters';
const now = Date.parse('2026-10-29T00:05:00Z');
const event = { id: '00000000-0000-4000-8000-000000000001', day: '2026-10-29', visitor: '0123456789abcdef01234567', country: 'CN' };
const endpoint = 'https://counter.example/internal/read';

test('a signed synthetic read is verified without transmitting client addresses', async () => {
  const request = await signedReadRequest(event, { endpoint, secret, now });
  assert.deepEqual(await verifySignedRead(request.clone(), { secret, now }), event);
  const body = await request.text();
  assert.equal(body.includes('192.0.2.'), false);
  assert.equal(body.includes('userAgent'), false);
});

test('tampered bodies, paths, secrets and expired signatures are rejected', async () => {
  const request = await signedReadRequest(event, { endpoint, secret, now });
  const headers = request.headers;
  const changed = new Request(endpoint, { method: 'POST', headers, body: JSON.stringify({ ...event, country: 'JP' }) });
  assert.equal(await verifySignedRead(changed, { secret, now }), null);
  const path = new Request('https://counter.example/internal/read?other=1', { method: 'POST', headers, body: JSON.stringify(event) });
  assert.equal(await verifySignedRead(path, { secret, now }), null);
  assert.equal(await verifySignedRead(request.clone(), { secret: 'another-synthetic-secret-of-at-least-32-characters', now }), null);
  assert.equal(await verifySignedRead(request.clone(), { secret, now: now + 121_000 }), null);
});

test('oversized bodies, extra client data and weak secrets are rejected', async () => {
  const request = await signedReadRequest(event, { endpoint, secret, now });
  const oversized = new Request(endpoint, { method: 'POST', headers: request.headers, body: 'x'.repeat(2049) });
  assert.equal(await verifySignedRead(oversized, { secret, now }), null);
  await assert.rejects(signedReadRequest({ ...event, ip: '192.0.2.1' }, { endpoint, secret, now }), /Unexpected read event fields/);
  await assert.rejects(signedReadRequest(event, { endpoint, secret: 'short', now }), /Invalid gateway secret/);
  await assert.rejects(signedReadRequest(event, { endpoint: 'http://counter.example/internal/read', secret, now }), /Invalid counter endpoint/);
});
