import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/worker.js';

// A D1 stand-in that answers the statements stats() batches, by matching their SQL.
function database() {
  const statement = sql => ({
    bind() { return this; },
    sql
  });
  const answer = sql => {
    if (sql.includes('SUM(reads), 0)')) return { results: [{ reads: 500 }] };
    if (sql.includes('FROM reads WHERE')) return { results: [{ day: '2026-10-21', reads: 300, readers: 120 }] };
    if (sql.includes('MIN(day)')) return { results: [{ day: '2026-10-21' }] };
    if (sql.includes('GROUP BY country')) return { results: [{ country: 'CN', reads: 250, readers: 100 }, { country: 'TW', reads: 50, readers: 20 }] };
    return { results: [] };
  };
  return { prepare: statement, batch: async statements => statements.map(item => answer(item.sql)) };
}

function cacheStore() {
  const entries = new Map();
  return { default: { match: async request => entries.get(request.url)?.clone(), put: async (request, response) => { entries.set(request.url, response); } }, entries };
}

async function statsJson(env) {
  const waits = [];
  const response = await worker.fetch(new Request('https://dshopen.org/stats.json'), env, { waitUntil: promise => waits.push(promise) });
  await Promise.all(waits);
  return response.json();
}

test('without an analytics token the country split is the Worker\'s own count of people', async () => {
  globalThis.caches = cacheStore();
  const body = await statsJson({ DB: database() });
  assert.equal(body.countries.source, 'd1');
  assert.equal(body.countries.metric, 'readers');
  assert.equal(body.countries.last30Days[0].country, 'CN');
  assert.equal(body.today.readers, 0);
  assert.equal(body.last30Days.readers, 120);
});

test('with a token the split comes from Cloudflare analytics, summed over 30 days and cached', async () => {
  globalThis.caches = cacheStore();
  const queries = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    queries.push({ url, body: JSON.parse(options.body), auth: options.headers.authorization });
    const zone = {};
    for (let at = 0; at < 30; at++) zone[`d${at}`] = at < 27 ? [] : [{ count: 40, dimensions: { clientCountryName: 'CN' } }, { count: 10, dimensions: { clientCountryName: 'HK' } }, { count: 2, dimensions: { clientCountryName: '' } }];
    return Response.json({ data: { viewer: { zones: [zone] } } });
  };
  try {
    const env = { DB: database(), CF_ANALYTICS_TOKEN: 'token', CF_ZONE_ID: 'zone' };
    const body = await statsJson(env);
    assert.equal(body.countries.source, 'cloudflare');
    assert.equal(body.countries.metric, 'reads');
    assert.deepEqual(body.countries.last30Days, [{ country: 'CN', reads: 120 }, { country: 'HK', reads: 30 }, { country: 'XX', reads: 6 }]);
    assert.equal(body.countries.today.length, 3);
    // People still come from D1.
    assert.equal(body.last30Days.readers, 120);
    assert.equal(queries.length, 1);
    assert.equal(queries[0].url, 'https://api.cloudflare.com/client/v4/graphql');
    assert.equal(queries[0].auth, 'Bearer token');
    assert.equal(queries[0].body.variables.zone, 'zone');
    assert.equal(queries[0].body.query.match(/httpRequestsAdaptiveGroups/g).length, 30);
    assert.match(queries[0].body.query, /clientRequestPath: "\/index.json"/);
    await statsJson(env);
    assert.equal(queries.length, 1, 'the second request is served from the cache');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a failed analytics query falls back to the D1 split', async () => {
  globalThis.caches = cacheStore();
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  globalThis.fetch = async () => Response.json({ errors: [{ message: 'not authorized' }] });
  console.error = () => {};
  try {
    const body = await statsJson({ DB: database(), CF_ANALYTICS_TOKEN: 'token', CF_ZONE_ID: 'zone' });
    assert.equal(body.countries.source, 'd1');
    assert.equal(globalThis.caches.entries.size, 0);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});
