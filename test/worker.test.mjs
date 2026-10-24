import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
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
    assert.equal(globalThis.caches.entries.has('https://dshopen.org/__stats/countries-v1'), false);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

test('stats.json is served from the edge cache and refreshed in the background once stale', async t => {
  globalThis.caches = cacheStore();
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-24T12:00:00Z') });
  let batches = 0;
  const DB = database();
  const batch = DB.batch;
  DB.batch = async statements => { batches++; return batch(statements); };
  await statsJson({ DB });
  const runs = batches;
  const fresh = await worker.fetch(new Request('https://dshopen.org/stats.json?x=1'), { DB }, { waitUntil() {} });
  assert.equal(batches, runs, 'a fresh copy answers without D1, whatever the query string');
  assert.equal(fresh.headers.get('cache-control'), 'public, max-age=300');
  assert.equal(fresh.headers.get('x-stored-at'), null);
  t.mock.timers.tick(300_001);
  const waits = [];
  const stale = await worker.fetch(new Request('https://dshopen.org/stats.json'), { DB }, { waitUntil: promise => waits.push(promise) });
  assert.equal((await stale.json()).total, 500, 'a stale copy still answers at once');
  await Promise.all(waits);
  assert.ok(batches > runs, 'and is recomputed in the background');
});

// A local D1 stand-in executes real SQL, including transactional batches.
const LOGO_BYTES = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

function likeEnvironment(t, names = ['dsh-pet', '@scope/name']) {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-24T12:00:00Z') });
  t.mock.method(Math, 'random', () => 1);
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../cloudflare/schema.sql', import.meta.url), 'utf8'));
  t.after(() => sqlite.close());
  const execute = (sql, values) => {
    const statement = sqlite.prepare(sql);
    if (statement.columns().length) return { results: statement.all(...values).map(row => ({ ...row })) };
    return { results: [], meta: { changes: Number(statement.run(...values).changes) } };
  };
  const prepare = (sql, values = []) => ({
    sql, values,
    bind(...bound) { return prepare(sql, bound); },
    async run() { return execute(sql, values); },
    async all() { return execute(sql, values); }
  });
  const requests = [];
  const env = {
    STATS_SALT: 'test-salt',
    DB: {
      prepare,
      async batch(statements) {
        sqlite.exec('BEGIN');
        try {
          const results = statements.map(item => execute(item.sql, item.values));
          sqlite.exec('COMMIT');
          return results;
        } catch (error) {
          sqlite.exec('ROLLBACK');
          throw error;
        }
      }
    },
    ASSETS: { async fetch(request) {
      requests.push(request);
      if (new URL(request.url).pathname === '/assets/badge-logo.png') return new Response(LOGO_BYTES, { headers: { 'content-type': 'image/png' } });
      return Response.json({ plugins: names.map(name => ({ name })) });
    } }
  };
  return { env, sqlite, requests, names };
}

function sendLike(env, name = 'dsh-pet', source = 'like', { ip = '192.0.2.1', ua = 'test-client', type = 'application/json' } = {}) {
  return worker.fetch(new Request('https://dshopen.org/api/like', {
    method: 'POST',
    headers: { 'content-type': type, 'cf-connecting-ip': ip, 'user-agent': ua },
    body: JSON.stringify({ name, source })
  }), env, {});
}

function readLikes(env) {
  return worker.fetch(new Request('https://dshopen.org/likes.json'), env, {});
}

function assertCors(response) {
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
}

test('likes accept JSON and text/plain, support scoped names, and publish the totals', async t => {
  const { env, requests } = likeEnvironment(t, ['dsh-pet', '@scope/name', 'dsh~pet']);
  const response = await sendLike(env);
  assert.equal(response.status, 200);
  assertCors(response);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { name: 'dsh-pet', likes: 1, counted: true });
  const installed = await sendLike(env, '@scope/name', 'install', { type: 'text/plain;charset=UTF-8' });
  assert.equal(installed.status, 200);
  assertCors(installed);
  assert.deepEqual(await installed.json(), { name: '@scope/name', likes: 1, counted: true });
  assert.equal((await sendLike(env, 'dsh~pet')).status, 200);
  const listed = await readLikes(env);
  assert.equal(listed.status, 200);
  assertCors(listed);
  assert.equal(listed.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(listed.headers.get('cache-control'), 'public, max-age=60');
  const body = await listed.json();
  assert.equal(body.schema, 1);
  assert.equal(body.generatedAt, '2026-10-24T12:00:00.000Z');
  assert.match(body.rule, /three days/);
  assert.deepEqual(body.likes, { 'dsh-pet': 1, '@scope/name': 1, 'dsh~pet': 1 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://dshopen.org/index.json');
});

test('like and install share one daily vote, and a new UTC day allows another', async t => {
  const { env, sqlite } = likeEnvironment(t);
  assert.equal((await (await sendLike(env)).json()).counted, true);
  for (const source of ['like', 'install']) {
    const response = await sendLike(env, 'dsh-pet', source);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { name: 'dsh-pet', likes: 1, counted: false });
  }
  t.mock.timers.setTime(Date.parse('2026-10-25T00:00:00Z'));
  assert.deepEqual(await (await sendLike(env, 'dsh-pet', 'install')).json(), { name: 'dsh-pet', likes: 2, counted: true });
  const votes = sqlite.prepare('SELECT * FROM like_votes ORDER BY day').all();
  assert.equal(votes.length, 2);
  assert.notEqual(votes[0].hash, votes[1].hash);
});

test('likes and reads use the same salted daily hash, and IP, UA, and salt distinguish people', async t => {
  const { env, sqlite } = likeEnvironment(t);
  await sendLike(env);
  await sendLike(env, 'dsh-pet', 'like', { ip: '192.0.2.2' });
  await sendLike(env, 'dsh-pet', 'like', { ua: 'another-client' });
  const waits = [];
  await worker.fetch(new Request('https://dshopen.org/index.json', {
    headers: { 'cf-connecting-ip': '192.0.2.1', 'user-agent': 'test-client' }
  }), env, { waitUntil: promise => waits.push(promise) });
  await Promise.all(waits);
  const expected = createHash('sha256').update('test-salt|2026-10-24|192.0.2.1|test-client').digest('hex').slice(0, 24);
  assert.equal(sqlite.prepare('SELECT hash FROM visitors').get().hash, expected);
  assert.equal(sqlite.prepare('SELECT hash FROM like_votes WHERE hash = ?').get(expected).hash, expected);
  env.STATS_SALT = 'another-salt';
  assert.deepEqual(await (await sendLike(env)).json(), { name: 'dsh-pet', likes: 4, counted: true });
  const votes = sqlite.prepare('SELECT * FROM like_votes').all();
  assert.equal(votes.length, 4);
  assert.deepEqual(Object.keys(votes[0]).sort(), ['day', 'hash', 'name']);
  assert.ok(votes.every(vote => /^[a-f0-9]{24}$/.test(vote.hash)));
});

test('unknown and malformed plugin names return 400 without recording a vote', async t => {
  const { env, sqlite } = likeEnvironment(t);
  for (const name of ['missing', '', '../dsh-pet', '@scope', 'DSH-PET', 'x'.repeat(215), null, 42]) {
    const response = await sendLike(env, name);
    assert.equal(response.status, 400);
    assertCors(response);
    assert.deepEqual(await response.json(), { error: 'unknown-plugin' });
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM like_votes').get().count, 0);
  assert.deepEqual((await (await readLikes(env)).json()).likes, {});
});

test('the published plugin list is cached for five minutes and then refreshed', async t => {
  const { env, requests, names } = likeEnvironment(t);
  await sendLike(env);
  names.push('new-plugin');
  assert.equal((await sendLike(env, 'new-plugin')).status, 400);
  t.mock.timers.tick(5 * 60_000 - 1);
  assert.equal((await sendLike(env, 'new-plugin')).status, 400);
  assert.equal(requests.length, 1);
  t.mock.timers.tick(1);
  assert.equal((await sendLike(env, 'new-plugin')).status, 200);
  assert.equal(requests.length, 2);
});

test('the daily limit is 100 distinct plugins, duplicates remain successful, and tomorrow resets it', async t => {
  const names = Array.from({ length: 101 }, (_, i) => `plugin-${i}`);
  const { env, sqlite, requests } = likeEnvironment(t, names);
  for (const name of names.slice(0, 100)) {
    const response = await sendLike(env, name);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).counted, true);
  }
  const limited = await sendLike(env, names[100], 'install');
  assert.equal(limited.status, 429);
  assertCors(limited);
  assert.deepEqual(await limited.json(), { error: 'daily-limit' });
  assert.deepEqual(await (await sendLike(env, names[0], 'install')).json(), { name: names[0], likes: 1, counted: false });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM like_votes').get().count, 100);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM likes').get().count, 100);
  assert.equal(requests.length, 1);
  assert.equal((await sendLike(env, names[100], 'like', { ip: '192.0.2.2' })).status, 200);
  t.mock.timers.setTime(Date.parse('2026-10-25T00:00:00Z'));
  assert.deepEqual(await (await sendLike(env, names[100])).json(), { name: names[100], likes: 2, counted: true });
});

test('reads decay lazily, omit zero totals, and leave stored totals untouched', async t => {
  const { env, sqlite } = likeEnvironment(t);
  sqlite.exec("INSERT INTO likes VALUES ('dsh-pet', 5, '2026-10-17'), ('@scope/name', 1, '2026-10-14')");
  assert.deepEqual((await (await readLikes(env)).json()).likes, { 'dsh-pet': 3 });
  assert.equal(sqlite.prepare("SELECT count FROM likes WHERE name = 'dsh-pet'").get().count, 5);
  assert.deepEqual(await (await sendLike(env, '@scope/name')).json(), { name: '@scope/name', likes: 1, counted: true });
  assert.deepEqual({ ...sqlite.prepare("SELECT * FROM likes WHERE name = '@scope/name'").get() }, {
    name: '@scope/name', count: 1, decayed_at: '2026-10-24'
  });
});

test('writes settle whole decay cycles, preserve the remainder, and restart after reaching zero', async t => {
  const { env, sqlite } = likeEnvironment(t);
  sqlite.exec("INSERT INTO likes VALUES ('dsh-pet', 5, '2026-10-17'), ('@scope/name', 1, '2026-10-21')");
  assert.deepEqual(await (await sendLike(env)).json(), { name: 'dsh-pet', likes: 4, counted: true });
  assert.deepEqual({ ...sqlite.prepare("SELECT * FROM likes WHERE name = 'dsh-pet'").get() }, {
    name: 'dsh-pet', count: 4, decayed_at: '2026-10-23'
  });
  assert.deepEqual(await (await sendLike(env, '@scope/name')).json(), { name: '@scope/name', likes: 1, counted: true });
  assert.equal(sqlite.prepare("SELECT decayed_at FROM likes WHERE name = '@scope/name'").get().decayed_at, '2026-10-24');
  t.mock.timers.setTime(Date.parse('2026-10-26T00:00:00Z'));
  assert.deepEqual((await (await readLikes(env)).json()).likes, { 'dsh-pet': 3, '@scope/name': 1 });
  t.mock.timers.setTime(Date.parse('2026-10-27T00:00:00Z'));
  assert.deepEqual((await (await readLikes(env)).json()).likes, { 'dsh-pet': 3 });
});

test('a duplicate returns the decayed total without modifying the stored total', async t => {
  const { env, sqlite } = likeEnvironment(t);
  await sendLike(env);
  sqlite.exec("UPDATE likes SET count = 1, decayed_at = '2026-10-14' WHERE name = 'dsh-pet'");
  assert.deepEqual(await (await sendLike(env, 'dsh-pet', 'install')).json(), { name: 'dsh-pet', likes: 0, counted: false });
  assert.equal(sqlite.prepare('SELECT count FROM likes').get().count, 1);
  assert.deepEqual((await (await readLikes(env)).json()).likes, {});
});

test('concurrent votes keep deduplication and the daily limit atomic', async t => {
  const names = Array.from({ length: 102 }, (_, i) => `plugin-${i}`);
  const { env, sqlite } = likeEnvironment(t, names);
  const duplicate = await Promise.all(Array.from({ length: 8 }, () => sendLike(env, names[0])));
  const bodies = await Promise.all(duplicate.map(response => response.json()));
  assert.equal(bodies.filter(body => body.counted).length, 1);
  const votes = await Promise.all(names.slice(1).map(name => sendLike(env, name)));
  assert.equal(votes.filter(response => response.status === 200).length, 99);
  assert.equal(votes.filter(response => response.status === 429).length, 2);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM like_votes').get().count, 100);
  assert.equal(sqlite.prepare('SELECT SUM(count) AS count FROM likes').get().count, 100);
});

test('OPTIONS allows cross-origin POST with content-type, and unsupported methods have CORS', async t => {
  const { env, requests } = likeEnvironment(t);
  const response = await worker.fetch(new Request('https://dshopen.org/api/like', {
    method: 'OPTIONS',
    headers: { origin: 'https://example.org', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' }
  }), env, {});
  assert.equal(response.status, 204);
  assertCors(response);
  assert.equal(response.headers.get('access-control-allow-methods'), 'POST');
  assert.equal(response.headers.get('access-control-allow-headers'), 'content-type');
  assert.equal(await response.text(), '');
  assert.equal(requests.length, 0);
  const unsupported = await worker.fetch(new Request('https://dshopen.org/api/like'), env, {});
  assert.equal(unsupported.status, 405);
  assertCors(unsupported);
});

test('index and database errors return JSON with CORS, and failed indexes can be retried', async t => {
  const { env, sqlite } = likeEnvironment(t);
  t.mock.method(env.ASSETS, 'fetch', async () => new Response('unavailable', { status: 503 }));
  const unavailable = await sendLike(env);
  assert.equal(unavailable.status, 500);
  assertCors(unavailable);
  assert.deepEqual(await unavailable.json(), { error: 'internal-error' });
  env.ASSETS.fetch.mock.restore();
  assert.equal((await sendLike(env)).status, 200);
  sqlite.exec('DROP TABLE likes');
  const brokenRead = await readLikes(env);
  assert.equal(brokenRead.status, 500);
  assertCors(brokenRead);
  const brokenWrite = await sendLike(env, '@scope/name');
  assert.equal(brokenWrite.status, 500);
  assertCors(brokenWrite);
  assert.deepEqual(await brokenWrite.json(), { error: 'internal-error' });
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM like_votes').get().count, 1, 'the failed batch rolls back its vote');
});

test('old deduplication hashes are occasionally pruned without changing totals', async t => {
  const { env, sqlite } = likeEnvironment(t);
  await sendLike(env);
  t.mock.timers.setTime(Date.parse('2026-10-25T00:00:00Z'));
  Math.random.mock.mockImplementation(() => 0);
  assert.deepEqual(await (await sendLike(env)).json(), { name: 'dsh-pet', likes: 2, counted: true });
  assert.deepEqual(sqlite.prepare('SELECT day FROM like_votes').all().map(row => row.day), ['2026-10-25']);
});

function readBadge(env, path = 'dsh-pet.json') {
  return worker.fetch(new Request(`https://dshopen.org/badge/${path}`), env, {});
}

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42"><image width="42" height="42" href="data:image/png;base64,${Buffer.from(LOGO_BYTES).toString('base64')}"/></svg>`;

async function assertBadge(response, message, { english = false, color = '2563eb', cacheSeconds = 1800, logo = true } = {}) {
  assert.equal(response.status, 200);
  assertCors(response);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=1800');
  assert.deepEqual(await response.json(), {
    schemaVersion: 1, label: english ? 'Open Plugin Market' : '开放插件市场', message, color, cacheSeconds, ...(logo ? { logoSvg: LOGO_SVG } : {})
  });
}

test('badges show the listing with effective likes and the face logo, without changing stored likes or counting reads', async t => {
  const { env, sqlite, requests } = likeEnvironment(t, ['dsh-pet']);
  sqlite.exec("INSERT INTO likes VALUES ('dsh-pet', 14, '2026-10-17')");
  await assertBadge(await readBadge(env), '已收录 · ♥ 12');
  await assertBadge(await readBadge(env, 'dsh-pet.json?lang=en'), 'listed · ♥ 12', { english: true });
  assert.equal(sqlite.prepare('SELECT count FROM likes').get().count, 14);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM reads').get().count, 0);
  assert.deepEqual(requests.map(request => request.url).sort(), ['https://dshopen.org/assets/badge-logo.png', 'https://dshopen.org/index.json']);
});

test('listed plugins without likes, or with fully decayed likes, show zero', async t => {
  const { env, sqlite } = likeEnvironment(t, ['fresh', 'faded']);
  sqlite.exec("INSERT INTO likes VALUES ('faded', 1, '2026-10-14')");
  for (const name of ['fresh', 'faded']) {
    await assertBadge(await readBadge(env, `${name}.json`), '已收录 · ♥ 0');
    await assertBadge(await readBadge(env, `${name}.json?lang=en`), 'listed · ♥ 0', { english: true });
  }
});

test('badges accept scoped package names with literal or encoded @', async t => {
  const { env, sqlite } = likeEnvironment(t, ['@a9i5k4/dsh-auto-memory']);
  sqlite.exec("INSERT INTO likes VALUES ('@a9i5k4/dsh-auto-memory', 3, '2026-10-24')");
  for (const scope of ['@a9i5k4', '%40a9i5k4']) {
    await assertBadge(await readBadge(env, `${scope}/dsh-auto-memory.json`), '已收录 · ♥ 3');
  }
});

test('unlisted and malformed badge names return grey badges and skip unnecessary reads', async t => {
  const { env, requests } = likeEnvironment(t);
  t.mock.method(env.DB, 'prepare', () => { throw new Error('should not query D1'); });
  for (const path of ['unknown.json', '.json', '@scope.json', 'DSH-PET.json', 'x'.repeat(215) + '.json', '%ZZ.json', '%2E%2E%2Fdsh-pet.json', 'dsh-pet.json/extra', 'dsh-pet']) {
    await assertBadge(await readBadge(env, path), '未收录', { color: 'lightgrey' });
    await assertBadge(await readBadge(env, `${path}?lang=en`), 'not listed', { color: 'lightgrey', english: true });
  }
  assert.deepEqual(requests.map(request => request.url).sort(), ['https://dshopen.org/assets/badge-logo.png', 'https://dshopen.org/index.json']);
});

test('badge like counts use Chinese and English units at their boundaries', async t => {
  const cases = [
    [999, '999', '999'],
    [1000, '1000', '1k'],
    [9999, '9999', '10k'],
    [10000, '1万', '10k'],
    [14871, '1.5万', '14.9k'],
    [100000, '10万', '100k'],
    [1000000, '100万', '1M'],
    [1500000, '150万', '1.5M']
  ];
  const { env, sqlite } = likeEnvironment(t, cases.map(([value]) => `plugin-${value}`));
  for (const [value, chinese, english] of cases) {
    const name = `plugin-${value}`;
    sqlite.prepare('INSERT INTO likes VALUES (?, ?, ?)').run(name, value, '2026-10-24');
    await assertBadge(await readBadge(env, `${name}.json`), `已收录 · ♥ ${chinese}`);
    await assertBadge(await readBadge(env, `${name}.json?lang=en`), `listed · ♥ ${english}`, { english: true });
  }
});

test('concurrent badges share the asset caches and the plugin list refreshes after five minutes', async t => {
  const { env, names, requests } = likeEnvironment(t, ['dsh-pet']);
  await Promise.all(Array.from({ length: 4 }, async () => assertBadge(await readBadge(env), '已收录 · ♥ 0')));
  assert.equal(requests.length, 2);
  names.push('new-plugin');
  t.mock.timers.tick(5 * 60_000 - 1);
  await assertBadge(await readBadge(env, 'new-plugin.json'), '未收录', { color: 'lightgrey' });
  t.mock.timers.tick(1);
  await assertBadge(await readBadge(env, 'new-plugin.json'), '已收录 · ♥ 0');
  assert.equal(requests.filter(request => request.url.endsWith('/badge-logo.png')).length, 1);
});

test('badges without the logo asset still answer, and fetch the logo again later', async t => {
  const { env } = likeEnvironment(t);
  const originalFetch = env.ASSETS.fetch;
  t.mock.method(env.ASSETS, 'fetch', async request => new URL(request.url).pathname === '/assets/badge-logo.png' ? new Response('missing', { status: 404 }) : originalFetch(request));
  await assertBadge(await readBadge(env), '已收录 · ♥ 0', { logo: false });
  env.ASSETS.fetch.mock.restore();
  await assertBadge(await readBadge(env), '已收录 · ♥ 0');
});

test('badge index failures return unavailable and allow retry', async t => {
  const { env } = likeEnvironment(t);
  const originalFetch = env.ASSETS.fetch;
  for (const failure of [() => new Response('unavailable', { status: 503 }), () => new Response('invalid json'), () => Response.json({})]) {
    t.mock.method(env.ASSETS, 'fetch', async request => new URL(request.url).pathname === '/index.json' ? failure() : originalFetch(request));
    await assertBadge(await readBadge(env), '暂不可用', { color: 'lightgrey', cacheSeconds: 300 });
    await assertBadge(await readBadge(env, 'dsh-pet.json?lang=en'), 'unavailable', { english: true, color: 'lightgrey', cacheSeconds: 300 });
    env.ASSETS.fetch.mock.restore();
  }
  await assertBadge(await readBadge(env), '已收录 · ♥ 0');
});

test('badge database errors return unavailable with HTTP 200 in both languages', async t => {
  const { env, sqlite } = likeEnvironment(t);
  sqlite.exec('DROP TABLE likes');
  await assertBadge(await readBadge(env), '暂不可用', { color: 'lightgrey', cacheSeconds: 300 });
  await assertBadge(await readBadge(env, 'dsh-pet.json?lang=en'), 'unavailable', { english: true, color: 'lightgrey', cacheSeconds: 300 });
});
