import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { cachedCatalog } from '../edgeone/lib/cached-catalog.js';

const body = '{"plugins":[{"name":"synthetic"}]}';
const expectedHash = createHash('sha256').update(body).digest('hex');
const sources = { cloudflare: 'https://cf.example/index.json', github: 'https://gh.example/index.json' };
const snapshot = 'https://edge.example/release.json';

function memoryCache() {
  const entries = new Map();
  return {
    entries,
    async match(key) { return entries.get(key.url)?.clone(); },
    async put(key, response) { entries.set(key.url, response); },
  };
}

test('a verified release is cached at the edge but clients cannot cache past request accounting', async () => {
  const cache = memoryCache();
  let calls = 0;
  const options = { sources, snapshot, expectedHash, country: 'CN', fetch: async () => { calls++; return new Response(body); } };
  const first = await cachedCatalog(options, { cache });
  assert.equal(first.source, 'github');
  assert.equal(first.response.headers.get('cache-control'), 'no-store');
  assert.equal(await first.response.text(), body);
  const second = await cachedCatalog(options, { cache });
  assert.equal(second.source, 'cache');
  assert.equal(second.response.headers.get('cache-control'), 'no-store');
  assert.equal(await second.response.text(), body);
  assert.equal(calls, 1);
});

test('an expired cache or failed cache write does not prevent serving a verified index', async () => {
  const cache = { async match() { throw new Error('expired'); }, async put() { throw new Error('unavailable'); } };
  const result = await cachedCatalog({ sources, snapshot, expectedHash, country: 'US', fetch: async () => new Response(body) }, { cache });
  assert.equal(result.source, 'cloudflare');
  assert.equal(await result.response.text(), body);
});

test('a cache entry for another release is ignored', async () => {
  const cache = { async match() { return new Response('stale', { headers: { 'x-dsh-release': 'a'.repeat(64) } }); }, async put() {} };
  const result = await cachedCatalog({ sources, snapshot, expectedHash, country: 'CN', fetch: async () => new Response(body) }, { cache });
  assert.equal(result.source, 'github');
  assert.equal(await result.response.text(), body);
  await assert.rejects(cachedCatalog({ expectedHash: 'invalid' }, { cache }), /Invalid release hash/);
});
