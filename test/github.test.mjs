import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index';
import { collectGitHub, applyGitHubStars, collectStarHistory } from '../scripts/github.mjs';
import { githubRepository } from '../scripts/github-repository.mjs';

const NOW = Date.parse('2026-10-18T00:00:00Z');
const index = {
  format: 1, title: 'Test index', plugins: [
    { name: 'plugin-a', repository: { url: 'https://github.com/Owner/Plugin' }, versions: [{ version: '1.0.0', publishTimestamp: 1, source: { type: 'npm' } }] },
    { name: 'plugin-b', repository: { url: 'https://gitee.com/owner/plugin' }, versions: [{ version: '1.0.0', publishTimestamp: 1, source: { type: 'npm' } }] }
  ]
};
const response = (stars = 345) => new Response(JSON.stringify({ full_name: 'Owner/Plugin', html_url: 'https://github.com/Owner/Plugin', stargazers_count: stars, pushed_at: '2026-10-17T12:00:00Z', archived: false }));
const cached = (fetchedAt, stars = 123) => ({ schema: 1, repositories: { 'owner/plugin': { url: 'https://github.com/Owner/Plugin', stars, fetchedAt, status: 'ok' } } });

test('GitHub URL parsing is restricted to a repository, not arbitrary hosts or subpaths', () => {
  assert.deepEqual(githubRepository('https://github.com/Owner/Plugin.git/'), { key: 'owner/plugin', url: 'https://github.com/Owner/Plugin' });
  assert.equal(githubRepository('https://github.com.evil.example/owner/plugin'), undefined);
  assert.equal(githubRepository('https://github.com/owner/plugin/tree/main'), undefined);
  assert.equal(githubRepository('https://secret@github.com/owner/plugin'), undefined);
  assert.equal(githubRepository('file:///owner/plugin'), undefined);
});
test('one API request per repository; only the GitHub API receives the token', async () => {
  let calls = 0;
  const duplicate = { ...index, plugins: [...index.plugins, { ...index.plugins[0], name: 'plugin-c' }] };
  const snapshot = await collectGitHub(duplicate, { now: NOW, token: 'test-token', fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.github.com/repos/owner/plugin');
    assert.equal(options.headers.authorization, 'Bearer test-token');
    assert.equal(options.redirect, 'manual');
    return response();
  } });
  assert.equal(calls, 1);
  assert.equal(snapshot.repositories['owner/plugin'].stars, 345);
  assert.equal(snapshot.repositories['owner/plugin'].fetchedAt, new Date(NOW).toISOString());
  assert.equal(JSON.stringify(snapshot).includes('test-token'), false);
});
test('zero stars remains a measured zero in the official sort key', async () => {
  const snapshot = await collectGitHub(index, { now: NOW, fetchImpl: async () => response(0) });
  const result = applyGitHubStars(index, snapshot);
  parseMarketIndex(result, 'https://example.org/index.json');
  assert.equal(result.plugins[0].metadata.sortKeys['github-stars'], 0);
  assert.equal(result.plugins[1].metadata.sortKeys['github-stars'], undefined);
  assert.equal(result.metadata.sortKeys['github-stars'].order, 'desc');
});
test('large catalogs batch GitHub repository metadata and retry missing GraphQL records through REST', async () => {
  const plugins = Array.from({length: 51}, (_, i) => {
    const name = 'plugin-' + String(i).padStart(2, '0');
    return {name, repository: {url: 'https://github.com/owner/' + name}};
  });
  const calls = [];
  const snapshot = await collectGitHub({...index, plugins}, {token: 'test-token', now: NOW, fetchImpl: async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.authorization, 'Bearer test-token');
    if (url.endsWith('/graphql')) {
      const {query} = JSON.parse(options.body);
      const rows = [...query.matchAll(/r(\d+): repository\(owner: "owner", name: "([^"]+)"\)/g)];
      return Response.json({data: Object.fromEntries(rows.map(([, i, name]) => [
        'r' + i, name === 'plugin-50' ? null : {
          nameWithOwner: 'owner/' + name, url: 'https://github.com/owner/' + name, stargazerCount: 3, homepageUrl: 'https://' + name + '.example/'
        }
      ]))});
    }
    return Response.json({full_name: 'owner/plugin-50', html_url: 'https://github.com/owner/plugin-50', stargazers_count: 7, homepage: 'https://rest.example/'});
  }});
  assert.deepEqual(calls, ['https://api.github.com/graphql', 'https://api.github.com/graphql', 'https://api.github.com/repos/owner/plugin-50']);
  assert.equal(Object.keys(snapshot.repositories).length, 51);
  assert.equal(snapshot.repositories['owner/plugin-49'].homepage, 'https://plugin-49.example/');
  assert.equal(snapshot.repositories['owner/plugin-50'].homepage, 'https://rest.example/');
});
test('rate limits preserve a dated cached value without refreshing its date', async () => {
  const fetchedAt = '2026-10-17T00:00:00.000Z';
  const snapshot = await collectGitHub(index, { now: NOW, previous: cached(fetchedAt), fetchImpl: async () => new Response('limited', { status: 403 }) });
  const repo = snapshot.repositories['owner/plugin'];
  assert.equal(repo.status, 'stale');
  assert.equal(repo.stars, 123);
  assert.equal(repo.fetchedAt, fetchedAt);
  assert.equal(repo.attemptedAt, new Date(NOW).toISOString());
});
test('GitHub About homepages survive a stale snapshot and invalid URLs are ignored', async () => {
  const homepage = 'https://plugin.example/docs';
  const data = await response().json();
  const saved = await collectGitHub(index, {now: NOW, fetchImpl: async () => Response.json({...data, homepage})});
  assert.equal(saved.repositories['owner/plugin'].homepage, homepage);
  const stale = await collectGitHub(index, {now: NOW + 60_000, previous: saved, fetchImpl: async () => new Response(null, {status: 429})});
  assert.equal(stale.repositories['owner/plugin'].homepage, homepage);
  const updated = await collectGitHub(index, {now: NOW + 60_000, previous: saved, fetchImpl: async () => Response.json({...data, homepage: 'https://user:secret@plugin.example/'})});
  assert.equal(updated.repositories['owner/plugin'].homepage, undefined);
});
test('a verified public GitHub repository rename retains its homepage under the catalog key', async () => {
  const urls = [];
  const snapshot = await collectGitHub(index, {now: NOW, token: 'test-token', fetchImpl: async (url, options) => {
    urls.push(url);
    if (urls.length === 1) return new Response(null, {status: 301, headers: {location: 'https://api.github.com/repositories/123'}});
    assert.equal(options.redirect, 'error');
    return Response.json({full_name: 'Owner/New', html_url: 'https://github.com/Owner/New', stargazers_count: 2, private: false, homepage: 'https://new.example/'});
  }});
  assert.deepEqual(urls, ['https://api.github.com/repos/owner/plugin', 'https://api.github.com/repositories/123']);
  assert.equal(snapshot.repositories['owner/plugin'].homepage, 'https://new.example/');
  assert.equal(snapshot.repositories['owner/plugin'].canonicalUrl, 'https://github.com/Owner/New');
  const refused = await collectGitHub(index, {now: NOW, token: 'test-token', fetchImpl: async url => {
    assert.equal(url, urls[0]);
    return new Response(null, {status: 301, headers: {location: 'https://elsewhere.example/repositories/123'}});
  }});
  assert.equal(refused.repositories['owner/plugin'].status, 'unavailable');
});
test('expired or future cache entries become unavailable, never zero', async () => {
  for (const fetchedAt of ['2026-10-01T00:00:00Z', '2027-01-01T00:00:00Z']) {
    const snapshot = await collectGitHub(index, { now: NOW, previous: cached(fetchedAt), fetchImpl: async () => { throw new Error('network'); } });
    const repo = snapshot.repositories['owner/plugin'];
    assert.equal(repo.status, 'unavailable');
    assert.equal(repo.stars, undefined);
  }
});
test('a failed refresh removes old numeric values and keeps the index valid', async () => {
  const initial = applyGitHubStars(index, await collectGitHub(index, { now: NOW, fetchImpl: async () => response() }));
  const failed = await collectGitHub(index, { now: NOW, fetchImpl: async () => new Response('', { status: 404 }) });
  const result = applyGitHubStars(initial, failed);
  parseMarketIndex(result, 'https://example.org/index.json');
  assert.equal(result.plugins[0].metadata.sortKeys['github-stars'], undefined);
  assert.equal(result.metadata.sortKeys['github-stars'], undefined);
});
test('unexpected repository identities or star values are not published', async () => {
  for (const data of [
    { full_name: 'wrong/repo', html_url: 'https://github.com/wrong/repo', stargazers_count: 100 },
    { full_name: 'Owner/Plugin', html_url: 'https://github.com/Owner/Plugin', stargazers_count: -1 },
    { full_name: 'Owner/Plugin', html_url: 'https://github.com/Owner/Plugin', stargazers_count: '100' }
  ]) {
    const snapshot = await collectGitHub(index, { now: NOW, fetchImpl: async () => new Response(JSON.stringify(data)) });
    assert.equal(snapshot.repositories['owner/plugin'].status, 'unavailable');
  }
});
test('removed repositories are not carried forward from a snapshot', async () => {
  const snapshot = await collectGitHub({ ...index, plugins: [] }, { now: NOW, previous: cached('2026-10-17T00:00:00Z'), fetchImpl: () => assert.fail('no requests') });
  assert.deepEqual(snapshot.repositories, {});
});

test('star history counts stars by the end of each day and keeps the previous history on failure', async () => {
  const pages = [
    { edges: Array.from({ length: 100 }, (_, at) => ({ starredAt: at < 60 ? '2026-10-19T01:00:00Z' : '2026-10-20T01:00:00Z' })), pageInfo: { hasNextPage: true, endCursor: 'c1' } },
    { edges: [{ starredAt: '2026-10-22T05:00:00Z' }], pageInfo: { hasNextPage: false, endCursor: 'c2' } }
  ];
  const requests = [];
  const fetchImpl = async (url, init) => { requests.push(JSON.parse(init.body).variables); return Response.json({ data: { repository: { stargazers: pages[requests.length - 1] } } }); };
  const result = await collectStarHistory('owner/repo', { fetchImpl, token: 'secret' });
  assert.deepEqual(result.history, [['2026-10-19', 60], ['2026-10-20', 100], ['2026-10-22', 101]]);
  assert.deepEqual(requests, [{ owner: 'owner', name: 'repo', after: null }, { owner: 'owner', name: 'repo', after: 'c1' }]);
  const previous = { schema: 1, history: [['2026-10-19', 1]] };
  assert.equal(await collectStarHistory('owner/repo', { fetchImpl: async () => Response.json({ errors: [{ message: 'forbidden' }] }), token: 'secret', previous }), previous);
  // Without star dates, today's count joins the previous history.
  const counted = await collectStarHistory('owner/repo', { token: 'secret', previous, fetchImpl: async url => String(url).endsWith('/graphql') ? Response.json({ errors: [{ message: 'Resource not accessible by integration' }] }) : Response.json({ stargazers_count: 7 }) });
  assert.deepEqual(counted.history.slice(0, 1), [['2026-10-19', 1]]);
  assert.equal(counted.history.at(-1)[1], 7);
  assert.equal(await collectStarHistory('owner/repo', { token: '', previous }), previous);
});
