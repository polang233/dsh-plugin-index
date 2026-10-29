import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { selectCatalog } from '../edgeone/lib/catalog-routing.js';

const body = new TextEncoder().encode('{"plugins":[{"name":"example"}]}');
const hash = createHash('sha256').update(body).digest('hex');
const sources = { cloudflare: 'https://cf.example/index.json', github: 'https://gh.example/index.json' };
const snapshot = 'https://edge.example/release.json';

function createFetch(plan) {
  const calls = [];
  const aborted = [];
  async function fetchMock(url, options) {
    const host = new URL(url).hostname;
    calls.push(host);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers['user-agent'], 'dshopen-check');
    const entry = plan[host];
    assert.ok(entry, `Unexpected source ${host}`);
    if (entry.wait) {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          aborted.push(host);
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      });
    }
    return new Response(entry.body ?? body, { status: entry.status ?? 200, headers: entry.headers });
  }
  return { fetchMock, calls, aborted };
}

const options = { sources, snapshot, expectedHash: hash, timeoutMs: 200, hedgeDelayMs: 20 };

test('uses the preferred source without requesting the other when it is healthy', async () => {
  const fake = createFetch({ 'gh.example': {} });
  const result = await selectCatalog({ ...options, country: 'CN', fetch: fake.fetchMock });
  assert.equal(result.source, 'github');
  assert.deepEqual(result.bytes, body);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(fake.calls, ['gh.example']);
});

test('hedges a stalled source and cancels it after the other succeeds', async () => {
  const fake = createFetch({ 'gh.example': { wait: true }, 'cf.example': {} });
  const result = await selectCatalog({ ...options, country: 'CN', fetch: fake.fetchMock });
  assert.equal(result.source, 'cloudflare');
  assert.deepEqual(fake.calls, ['gh.example', 'cf.example']);
  assert.deepEqual(fake.aborted, ['gh.example']);
});

test('rejects a stale index and immediately tries the other source', async () => {
  const fake = createFetch({ 'gh.example': { body: 'old index' }, 'cf.example': {} });
  const result = await Promise.race([
    selectCatalog({ ...options, country: 'CN', hedgeDelayMs: 2_000, fetch: fake.fetchMock }),
    new Promise((resolve, reject) => setTimeout(() => reject(new Error('Fallback started too late')), 500)),
  ]);
  assert.equal(result.source, 'cloudflare');
  assert.deepEqual(fake.calls, ['gh.example', 'cf.example']);
});

test('uses the validated release snapshot when both sources fail', async () => {
  const fake = createFetch({
    'cf.example': { status: 503 },
    'gh.example': { status: 302 },
    'edge.example': {},
  });
  const result = await selectCatalog({ ...options, country: 'US', fetch: fake.fetchMock });
  assert.equal(result.source, 'snapshot');
  assert.deepEqual(result.bytes, body);
});

test('times out two stalled sources and still serves the release snapshot', async () => {
  const fake = createFetch({ 'cf.example': { wait: true }, 'gh.example': { wait: true }, 'edge.example': {} });
  const result = await selectCatalog({ ...options, country: 'US', timeoutMs: 30, hedgeDelayMs: 5, fetch: fake.fetchMock });
  assert.equal(result.source, 'snapshot');
  assert.deepEqual(new Set(fake.aborted), new Set(['cf.example', 'gh.example']));
});

test('fails closed when no source matches the release and rejects oversized responses', async () => {
  const stale = createFetch({ 'cf.example': { body: 'stale' }, 'gh.example': { body: 'stale' }, 'edge.example': { body: 'stale' } });
  await assert.rejects(selectCatalog({ ...options, country: 'US', fetch: stale.fetchMock }), /does not match this release/);
  const large = createFetch({ 'cf.example': { headers: { 'content-length': '999' } }, 'gh.example': {}, 'edge.example': {} });
  const result = await selectCatalog({ ...options, country: 'US', maxBytes: body.byteLength, fetch: large.fetchMock });
  assert.equal(result.source, 'github');
  await assert.rejects(selectCatalog({ ...options, expectedHash: 'bad', fetch: large.fetchMock }), /Invalid release hash/);
});
