import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index';
import { applyMarketDisplay, labelsFor, marketSignals, releaseAge, LABELS } from '../scripts/market-display.mjs';
import { collectDownloads } from '../scripts/downloads.mjs';
import { checkMarketDisplay } from '../scripts/check-published.mjs';
import { releaseActivity } from '../scripts/lib.mjs';
import { starHistory, starsGained } from '../scripts/github.mjs';
import { parseAwesome, parseShop, endorsementsFor } from '../scripts/endorsements.mjs';

const NOW = Date.parse('2026-10-18T12:00:00Z');
const plugin = { name: '@owner/plugin', description: { en: 'Real description.', zh: '实际介绍。' }, repository: { url: 'https://github.com/owner/plugin' }, versions: [{ version: '1.0.0', publishTimestamp: Date.parse('2026-10-15T12:00:00Z') / 1000, source: { type: 'npm' } }] };
const index = { format: 1, title: 'Market', plugins: [plugin] };
/** npm range response: 23 quiet days followed by a 7-day week. */
const range = (name = plugin.name, quiet = 10, recent = 100) => ({
  package: name, start: '2026-09-18', end: '2026-10-17',
  downloads: Array.from({ length: 30 }, (_, day) => ({ day: new Date(Date.parse('2026-09-18') + day * 86_400_000).toISOString().slice(0, 10), downloads: day < 23 ? quiet : recent }))
});
const record = (name = plugin.name, downloads = 1234, week = 300) => ({ package: name, downloads, week, start: '2026-09-18', end: '2026-10-17' });
const github = { repositories: { 'owner/plugin': { status: 'ok', stars: 2345, fetchedAt: '2026-10-18T12:00:00Z' } } };

test('DSH rows show stars before descriptions and a few fixed native labels', async () => {
  const downloads = await collectDownloads(index, { now: NOW, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.npmjs.org/downloads/range/last-month/%40owner/plugin');
    assert.equal(options.redirect, 'error');
    return Response.json(range());
  } });
  assert.equal(downloads.packages[plugin.name].downloads, 23 * 10 + 7 * 100);
  assert.equal(downloads.packages[plugin.name].week, 700);
  const releases = { [plugin.name]: { firstPublished: '2026-10-10T00:00:00Z', last30Days: 16, last90Days: 16 } };
  const result = applyMarketDisplay(index, { github, downloads, releases, now: NOW });
  const parsed = parseMarketIndex(result.index, 'https://example.org/index.json');
  assert.deepEqual(parsed.plugins[0].description, { en: '★ 2,345 │ Real description.', zh: '★ 2,345 │ 实际介绍。' });
  assert.deepEqual(parsed.plugins[0].metadata.labels, ['trending', 'active', 'updated-recent', 'downloads-500']);
  assert.deepEqual(parsed.metadata.labels.trending.title, LABELS.trending);
  assert.equal(result.display.plugins[plugin.name].signals.downloads, 930);
  assert.deepEqual(Object.keys(parsed.metadata.sortKeys).sort(), ['github-stars', 'random-resources', 'recommended']);
  assert.deepEqual(result.display.plugins[plugin.name].description, plugin.description);
  assert.deepEqual(checkMarketDisplay(result.index, github, downloads, result.display), { stars: 1, downloads: 1, identities: 0 });
  const invisible = structuredClone(result.index);
  invisible.plugins[0].metadata.labels = [];
  assert.throws(() => checkMarketDisplay(invisible, github, downloads, result.display), /visible DSH labels/);
  const wrongStar = structuredClone(result.index);
  wrongStar.plugins[0].description.zh = '★ 999 │ 实际介绍。';
  assert.throws(() => checkMarketDisplay(wrongStar, github, downloads, result.display), /visible DSH metrics/);
});

test('label ids never multiply with readings', () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ ...plugin, name: 'p' + i, versions: [{ ...plugin.versions[0], publishTimestamp: (NOW - i * 3 * 86_400_000) / 1000 }] }));
  const downloads = { schema: 1, packages: Object.fromEntries(many.map((item, i) => [item.name, { ...record(item.name, i * 997, i * 50), status: 'ok' }])) };
  const result = applyMarketDisplay({ ...index, plugins: many }, { downloads, now: NOW }).index;
  assert.ok(Object.keys(result.metadata.labels).length <= Object.keys(LABELS).length);
  assert.ok(Object.keys(result.metadata.labels).every(id => id in LABELS));
});

test('labels carry no cache dates when npm falls back to an older reading', async () => {
  const previous = { packages: { [plugin.name]: { ...record(), status: 'ok', fetchedAt: '2026-10-17T12:00:00Z' } } };
  const downloads = await collectDownloads(index, { now: NOW, previous, fetchImpl: async () => new Response('', { status: 404 }) });
  assert.equal(downloads.packages[plugin.name].status, 'stale');
  const result = applyMarketDisplay(index, { downloads, now: NOW }).index;
  const titles = Object.values(result.metadata.labels).flatMap(label => Object.values(label.title));
  assert.ok(titles.every(title => !/缓存|cached|\d{4}-\d{2}-\d{2}/.test(title)));
  assert.ok(result.plugins[0].metadata.labels.includes('downloads-1k'));
});

test('signals: growth needs volume, cadence and newness come from registry times', () => {
  const quiet = marketSignals(plugin, { npm: { ...record(plugin.name, 40, 20), status: 'ok' }, now: NOW });
  assert.equal(quiet.growth, undefined);
  const steady = marketSignals(plugin, { npm: { ...record(plugin.name, 3000, 700), status: 'ok' }, now: NOW });
  assert.ok(steady.growth < 1.5 && !labelsFor(steady).includes('trending'));
  const activity = releaseActivity({ versions: { '1.0.0': {}, '1.1.0': {}, '1.2.0': {} }, time: { created: '2025-01-01T00:00:00Z', '1.0.0': '2025-01-01T00:00:00Z', '1.1.0': '2026-10-10T00:00:00Z', '1.2.0': '2026-10-17T00:00:00Z' } }, NOW);
  assert.deepEqual(activity, { firstPublished: '2025-01-01T00:00:00.000Z', last30Days: 2, last90Days: 2 });
  const labels = labelsFor(marketSignals(plugin, { releases: activity, now: NOW }));
  assert.deepEqual(labels, ['updated-recent']);
});

test('invalid identities, dates and negative counts do not become zero', async () => {
  for (const response of [{ ...range(), package: 'other' }, { ...range(), downloads: [{ day: '2026-10-17', downloads: -1 }] }, { ...range(), end: '2027-01-01' }, { ...range(), start: '2026-09-01' }, { error: 'not found' }]) {
    const snapshot = await collectDownloads(index, { now: NOW, previous: { packages: { [plugin.name]: { ...record(), status: 'ok', fetchedAt: '2026-10-01T12:00:00Z' } } }, fetchImpl: async () => Response.json(response) });
    assert.equal(snapshot.packages[plugin.name].status, 'unavailable');
    const result = applyMarketDisplay(index, { downloads: snapshot, now: NOW });
    assert.ok(result.index.plugins[0].metadata.labels.every(id => !id.startsWith('downloads-')));
    assert.equal(result.index.metadata.sortKeys['npm-downloads-month'], undefined);
  }
});

test('bulk npm queries keep scoped packages separate and accept measured zero', async () => {
  const input = { plugins: [plugin, ...['one', 'two'].map(name => ({ ...plugin, name }))] };
  const calls = [];
  const snapshot = await collectDownloads(input, { now: NOW, fetchImpl: async url => {
    calls.push(url);
    return Response.json(url.endsWith('one,two') ? { one: range('one', 0, 0), two: range('two', 0, 1) } : range());
  } });
  assert.equal(calls.length, 2);
  assert.equal(snapshot.packages.one.downloads, 0);
  assert.equal(snapshot.packages.two.week, 7);
});

test('identity badge requires both the exact reviewed package and repository', () => {
  const publishers = { schema: 1, entries: [{ id: 'owner', kind: 'company', title: { en: 'Owner · Official', zh: 'Owner · 官方' }, packages: [plugin.name], repository: plugin.repository.url, reviewedAt: '2026-10-18', evidence: ['https://github.com/owner'] }] };
  const result = applyMarketDisplay(index, { publishers, now: NOW }).index;
  assert.deepEqual(result.plugins[0].metadata.labels.filter(id => id.startsWith('publisher-')), ['publisher-owner']);
  const otherRepo = applyMarketDisplay({ ...index, plugins: [{ ...plugin, repository: { url: 'https://github.com/other/plugin' } }] }, { publishers, now: NOW }).index;
  assert.deepEqual(otherRepo.plugins[0].metadata.labels.filter(id => id.startsWith('publisher-')), []);
});

test('measured zero and unavailable stars remain distinct in default descriptions', () => {
  const zero = { repositories: { 'owner/plugin': { ...github.repositories['owner/plugin'], stars: 0 } } };
  assert.equal(applyMarketDisplay(index, { github: zero, now: NOW }).index.plugins[0].description.zh, '★ 0 │ 实际介绍。');
  assert.equal(applyMarketDisplay(index, { now: NOW }).index.plugins[0].description.zh, '实际介绍。');
});

test('release age never invents an age for future values', () => {
  assert.equal(releaseAge(NOW / 1000, NOW, 'zh'), '今天更新');
  assert.equal(releaseAge(NOW / 1000 - 86_400, NOW, 'en'), 'Updated 1 day ago');
  assert.equal(releaseAge(NOW / 1000 + 1, NOW, 'zh'), undefined);
  assert.equal(releaseAge(NaN, NOW, 'en'), undefined);
});

test('recent successful download readings are reused without another API call', async () => {
  const previous = { packages: { [plugin.name]: { ...record(), status: 'ok', fetchedAt: '2026-10-18T11:00:00Z' } } };
  const snapshot = await collectDownloads(index, { now: NOW, previous, fetchImpl: () => assert.fail('Recent reading should be reused') });
  assert.equal(snapshot.packages[plugin.name].fetchedAt, '2026-10-18T11:00:00Z');
  assert.equal(snapshot.packages[plugin.name].week, 300);
});

test('a recent monthly total is refreshed before using it as weekly growth evidence', async () => {
  const monthlyOnly = { ...record(), status: 'ok', fetchedAt: '2026-10-18T11:00:00Z' };
  delete monthlyOnly.week;
  const previous = { packages: { [plugin.name]: monthlyOnly } };
  const snapshot = await collectDownloads(index, { now: NOW, previous, fetchImpl: async () => Response.json(range()) });
  const measured = snapshot.packages[plugin.name];
  assert.equal(measured.downloads, 930);
  assert.equal(measured.week, 700);
  assert.equal(measured.fetchedAt, new Date(NOW).toISOString());
  const signals = marketSignals(plugin, { npm: measured, now: NOW });
  assert.ok(signals.growth > 1.5);
});

test('download and update tiers are moderate, not one label per reading', () => {
  const tier = downloads => labelsFor({ downloads }).find(id => id.startsWith('downloads-'));
  assert.deepEqual([50, 150, 600, 2000, 7000, 20_000, 60_000, 200_000].map(tier), [undefined, 'downloads-100', 'downloads-500', 'downloads-1k', 'downloads-5k', 'downloads-10k', 'downloads-50k', 'downloads-100k']);
  const age = updatedDays => labelsFor({ updatedDays }).find(id => id.startsWith('updated-'));
  assert.deepEqual([0, 5, 20, 60, 200].map(age), ['updated-recent', 'updated-week', 'updated-month', 'updated-quarter', undefined]);
});

test('star growth comes from the daily history and can mark a plugin as rising', () => {
  const history = starHistory([['2026-10-11', 40], ['2026-09-01', 1]], { status: 'ok', stars: 52 }, NOW);
  assert.deepEqual(history, [['2026-10-11', 40], ['2026-10-18', 52]]);
  assert.equal(starsGained({ stars: 52, history }, NOW), 12);
  assert.equal(starsGained({ stars: 52, history: [['2026-10-16', 50]] }, NOW), undefined);
  const repo = { status: 'ok', stars: 52, history };
  const signals = marketSignals(plugin, { repo, now: NOW });
  assert.equal(signals.starsWeek, 12);
  assert.ok(labelsFor(signals).includes('trending'));
  const github = { repositories: { 'owner/plugin': repo } };
  const result = applyMarketDisplay(index, { github, now: NOW }).index;
  assert.equal(result.plugins[0].metadata.sortKeys['stars-week'], 12);
  assert.equal(result.metadata.sortKeys['stars-week'].title.zh, '近 7 天新增 star');
});

test('verification from other markets binds to the repository or the exact version', () => {
  const awesome = parseAwesome('## Plugins\n- [Plugin](https://github.com/Owner/Plugin/tree/main) - does things\n* [x](https://example.org)\n');
  assert.deepEqual(awesome.repos, ['owner/plugin']);
  const shop = parseShop('# comment\n- name: "@owner/plugin"   # npm entry\n  reviewedVersion: 1.0.0\n- name: other\n  repo: someone/other\n');
  assert.deepEqual(shop.reviews, [{ name: '@owner/plugin', version: '1.0.0' }, { name: 'other', repo: 'someone/other' }]);
  const snapshot = { sources: { 'awesome-dsh': { status: 'ok', ...awesome }, 'dsh-plugin-shop': { status: 'ok', ...shop } } };
  assert.deepEqual(endorsementsFor(plugin, snapshot), ['awesome-dsh', 'dsh-plugin-shop']);
  const otherVersion = { ...plugin, repository: { url: 'https://github.com/fork/plugin' }, versions: [{ ...plugin.versions[0], version: '2.0.0' }] };
  assert.deepEqual(endorsementsFor(otherVersion, snapshot), []);
  const result = applyMarketDisplay(index, { endorsements: snapshot, now: NOW }).index;
  assert.equal(result.plugins[0].metadata.labels[0], 'verified');
  assert.deepEqual(result.metadata.labels.verified.title, LABELS.verified);
});

test('only verifying sources earn the label; a large list only lifts the order', () => {
  const snapshot = { sources: { 'awesome-dsh-plugin': { status: 'ok', repos: ['owner/plugin'] } } };
  assert.deepEqual(endorsementsFor(plugin, snapshot, { strict: true }), []);
  assert.deepEqual(endorsementsFor(plugin, snapshot, { strict: false }), ['awesome-dsh-plugin']);
  const result = applyMarketDisplay(index, { endorsements: snapshot, now: NOW });
  assert.ok(!result.index.plugins[0].metadata.labels.includes('verified'));
  assert.deepEqual(result.display.plugins[plugin.name].signals.listedBy, ['awesome-dsh-plugin']);
  assert.equal(LABELS.verified.zh, '✅ 已审查');
});
