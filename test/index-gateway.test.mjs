import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { serveIndex } from '../edgeone/lib/index-gateway.js';
import { verifySignedRead } from '../shared/signed-read.js';

const body = '{"plugins":[{"name":"synthetic"}]}';
const hash = createHash('sha256').update(body).digest('hex');
const secret = 'synthetic-gateway-secret-with-at-least-32-characters';
const now = Date.parse('2026-10-29T12:00:00Z');
const config = {
  release: { sources: { cloudflare: 'https://cf.example/index.json', github: 'https://gh.example/index.json' }, snapshot: 'https://edge.example/snapshot.json', expectedHash: hash },
  counterEndpoint: 'https://counter.example/internal/read', gatewaySecret: secret, visitorSalt: 'synthetic-visitor-salt',
};
function fixture(counter = async () => Response.json({ accepted: true })) {
  const cached = new Map();
  const queued = new Map();
  const events = [];
  const context = {
    now: () => now, random: () => 1,
    cache: { async match(key) { return cached.get(key.url)?.clone(); }, async put(key, value) { cached.set(key.url, value); } },
    store: { async setJSON(key, value) { queued.set(key, value); } },
    async fetch(input) {
      if (input instanceof Request) {
        events.push(await verifySignedRead(input.clone(), { secret, now }));
        return counter();
      }
      return new Response(body);
    },
  };
  const request = agent => {
    const value = new Request('https://gateway.example/index.json', { headers: { 'user-agent': agent } });
    value.eo = { clientIp: '192.0.2.1', geo: { countryCodeAlpha2: 'CN' } };
    return value;
  };
  return { context, request, queued, events };
}

test('cached and uncached index requests both produce authenticated anonymous read events', async () => {
  const { context, request, events } = fixture();
  assert.equal(await (await serveIndex(request('synthetic-client'), config, context)).text(), body);
  assert.equal(await (await serveIndex(request('synthetic-client'), config, context)).text(), body);
  assert.equal(events.length, 2);
  assert.notEqual(events[0].id, events[1].id);
  assert.equal(events[0].visitor, events[1].visitor);
  assert.equal(JSON.stringify(events).includes('192.0.2.1'), false);
  assert.equal(JSON.stringify(events).includes('synthetic-client'), false);
});

test('counter failures queue the read before serving the index', async () => {
  const { context, request, queued } = fixture(async () => new Response('', { status: 503 }));
  const response = await serveIndex(request('synthetic-client'), config, context);
  assert.equal(response.status, 200);
  assert.equal(queued.size, 1);
  assert.equal(await response.text(), body);
});

test('health checks do not create read events', async () => {
  const { context, request, events } = fixture();
  const response = await serveIndex(request('dshopen-check'), config, context);
  assert.equal(response.status, 200);
  assert.equal(events.length, 0);
});

test('a simultaneous reporting and queue outage does not break index access', async () => {
  const { context, request } = fixture(async () => new Response('', { status: 503 }));
  context.store.setJSON = async () => { throw new Error('Synthetic storage outage'); };
  const response = await serveIndex(request('synthetic-client'), config, context);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), body);
});
