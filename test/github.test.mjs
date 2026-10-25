import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index';
import { collectGitHub, githubRepository, applyGitHubStars, collectStarHistory } from '../scripts/github.mjs';

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
    assert.equal(options.redirect, 'error');
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
test('rate limits preserve a dated cached value without refreshing its date', async () => {
  const fetchedAt = '2026-10-17T00:00:00.000Z';
  const snapshot = await collectGitHub(index, { now: NOW, previous: cached(fetchedAt), fetchImpl: async () => new Response('limited', { status: 403 }) });
  const repo = snapshot.repositories['owner/plugin'];
  assert.equal(repo.status, 'stale');
  assert.equal(repo.stars, 123);
  assert.equal(repo.fetchedAt, fetchedAt);
  assert.equal(repo.attemptedAt, new Date(NOW).toISOString());
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
  assert.equal(await collectStarHistory('owner/repo', { token: '', previous }), previous);
});
