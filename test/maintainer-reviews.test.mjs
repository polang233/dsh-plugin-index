import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {applyMarketDisplay} from '../scripts/market-display.mjs';
import {checkMarketDisplay} from '../scripts/check-published.mjs';
import {validateMaintainerReviews} from '../scripts/maintainer-reviews.mjs';
import {reviewSummary} from '../scripts/site.mjs';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const integrity = 'sha512-' + Buffer.alloc(64, 1).toString('base64');
const plugin = {name: '@owner/plugin', repository: {url: 'https://github.com/owner/plugin'}, versions: [{version: '1.0.0', publishTimestamp: NOW / 1000 - 86400, source: {type: 'npm'}}]};
const registry = {schema: 1, entries: [{name: plugin.name, version: '1.0.0', repository: plugin.repository.url, integrity, source: {type: 'npm'}, reviewedAt: '2026-10-26T00:00:00Z', scope: 'static-security', record: 'docs/reviews/review-policy.md'}]};
const evidence = {packages: [{name: plugin.name, version: '1.0.0', repository: plugin.repository.url, integrity, checks: ['sha512-integrity']}]};
const display = (p = plugin, reviews = registry, checked = evidence, extra = {}) => applyMarketDisplay({format: 1, title: 'Test', metadata: {labels: {verified: {title: 'Old label'}}}, plugins: [p]}, {maintainerReviews: reviews, packageEvidence: checked, now: NOW, ...extra});

test('a maintainer review labels the exact checked release and retains its scope and record', () => {
  const result = display(), signals = result.display.plugins[plugin.name].signals;
  assert.deepEqual(signals.verifiedBy, ['open-plugin-market']);
  assert(result.index.plugins[0].metadata.labels.includes('verified'));
  assert.equal(result.index.metadata.labels.verified.title.zh, '✅ 已审查');
  assert.equal(signals.maintainerReview.version, '1.0.0');
  assert.equal(signals.maintainerReview.record, 'https://github.com/polang233/dsh-plugin-index/blob/main/docs/reviews/review-policy.md');
  assert.match(reviewSummary(signals, 'zh'), /开放插件市场 · 静态安全审查 · v1\.0\.0 · 2026-10-26/);
  assert.match(reviewSummary({...signals, maintainerReview: {...signals.maintainerReview, scope: 'package'}}, 'en'), /Package checks/);
  assert.deepEqual(checkMarketDisplay(result.index, {repositories: {}}, {schema: 1, packages: {}}, result.display, undefined, {maintainerReviews: registry, packageEvidence: evidence}), {stars: 0, downloads: 0, identities: 0});
});

test('changed versions, repositories, archive bytes and absent proof lose the local label', () => {
  const cases = [
    [{...plugin, name: '@other/plugin'}, evidence],
    [{...plugin, versions: [{...plugin.versions[0], version: '1.0.1'}]}, evidence],
    [{...plugin, repository: {url: 'https://github.com/other/plugin'}}, evidence],
    [plugin, {packages: [{...evidence.packages[0], integrity: 'sha512-' + Buffer.alloc(64, 2).toString('base64')}]}],
    [plugin, {packages: [{...evidence.packages[0], checks: []}]}],
    [plugin, {}]
  ];
  for (const [p, checked] of cases) {
    const result = display({...p, metadata: {labels: ['verified']}}, registry, checked);
    assert(!result.index.plugins[0].metadata.labels.includes('verified'));
    assert.equal(result.display.plugins[p.name].signals.maintainerReview, undefined);
  }
  const future = structuredClone(registry);future.entries[0].reviewedAt = '2026-10-27';
  assert(!display(plugin, future).index.plugins[0].metadata.labels.includes('verified'));
});

test('Git reviews bind the installed and checked source commit and cannot transfer to npm', () => {
  const commit = 'a'.repeat(40), source = {type: 'git', url: plugin.repository.url, commit};
  const p = {...plugin, versions: [{...plugin.versions[0], source}]};
  const reviews = structuredClone(registry);reviews.entries[0].source = {type: 'git', commit};
  const checked = {packages: [{...evidence.packages[0], source}]};
  assert(display(p, reviews, checked).index.plugins[0].metadata.labels.includes('verified'));
  assert(!display({...p, versions: [{...p.versions[0], source: {...source, commit: 'b'.repeat(40)}}]}, reviews, checked).index.plugins[0].metadata.labels.includes('verified'));
  assert(!display({...p, versions: [{...p.versions[0], source: {...source, url: 'https://github.com/fork/plugin'}}]}, reviews, checked).index.plugins[0].metadata.labels.includes('verified'));
  assert(!display(plugin, reviews, evidence).index.plugins[0].metadata.labels.includes('verified'));
});

test('local checks coexist with external reviews without relabeling external work as our own', () => {
  const endorsements = {sources: {'awesome-dsh': {status: 'ok', repos: ['owner/plugin']}}};
  const result = display(plugin, registry, evidence, {endorsements});
  assert.deepEqual(result.display.plugins[plugin.name].signals.verifiedBy, ['awesome-dsh', 'open-plugin-market']);
  const external = display(plugin, registry, {}, {endorsements});
  assert(external.index.plugins[0].metadata.labels.includes('verified'));
  assert.equal(external.display.plugins[plugin.name].signals.maintainerReview, undefined);
  assert.equal(reviewSummary(external.display.plugins[plugin.name].signals), 'awesome-deepseek-harness-plugins');
});

test('publish checks reject review signals carried over to different archive bytes', () => {
  const result = display(), changed = structuredClone(evidence);changed.packages[0].integrity = 'sha512-' + Buffer.alloc(64, 3).toString('base64');
  assert.throws(() => checkMarketDisplay(result.index, {repositories: {}}, {schema: 1, packages: {}}, result.display, undefined, {maintainerReviews: registry, packageEvidence: changed}), /review evidence mismatch/);
});

test('invalid, duplicate and untraceable local review records are rejected', () => {
  for (const patch of [{integrity: 'sha512-no'}, {record: '../secret.json'}, {scope: 'safe'}, {source: {type: 'git', commit: 'main'}}, {reviewedAt: 'unknown'}]) {
    const bad = structuredClone(registry);Object.assign(bad.entries[0], patch);assert.throws(() => validateMaintainerReviews(bad), /Invalid maintainer review/);
  }
  const duplicate = structuredClone(registry);duplicate.entries.push(duplicate.entries[0]);assert.throws(() => validateMaintainerReviews(duplicate), /Invalid maintainer review/);
});

test('committed review ledger links to existing evidence and excludes held release bytes', async () => {
  const reviews = JSON.parse(await readFile(new URL('../data/maintainer-reviews.json', import.meta.url), 'utf8'));
  validateMaintainerReviews(reviews);
  for (const record of new Set(reviews.entries.map(r => r.record))) await readFile(new URL('../' + record, import.meta.url));
  const held = [
    ['@lifenrir/dsh-video-preview', '0.1.1', 'sha512-5vGUNEI+OdgJAxFCE+lBNGwXPYyJD0if5+mW6uP6hWBXY4pVnMbaB4T+O0MSNgNxnAyiQoB/GAzH4H+GGPM/Uw=='],
    ['@gulagala001/dsh-persona-plugin', '0.2.0-dsh.0.2.1-rc.3', 'sha512-TXWj04DsQ42LNslI5/rHqsmKke7uXP/FCvdYi4wktHD82yMX7hlaEveop4PBGQLM6VUE6DomgkN0pSKW5UOJ7w=='],
    ['@gulagala001/dsh-theme-plugin', '0.2.6-dsh.0.2.1-rc.3', 'sha512-9kCwDNdm3BgAb+I2HVKmXCyA/O1U3l6HvwfIec75HpyYp2UIZ3xeIPUacMPM5Gllt/ARV2Rr3S9GD9iqce3tow=='],
    ['dsh-decision-engine', '0.7.0', 'sha512-+d73yTp7p/tVneHpLxP9IMKjluEdq2J1UYHRX2kQvOZA9Bx1wNJBtrvWh7LFV/Qcr4RzxTV/N95bY2tqoqR/BQ=='],
    ['dsh-qq-gateway', '1.0.1', 'sha512-3zBd6xFdXu+VG8zDolYDA1lRmzflZlH+TMb+op9h+i09zY2hEMH+uylxwfMk5/AkT8feHQYaoQwV72Dnl1cTQA=='],
    ['dsh-subagent-dsh', '0.1.0', 'sha512-raeVWFohhup9yBCiJGgxOpq3QLIRHP9rZHPmES94khn7GzGGoUuRG6w7gIbWgM+TvVYLNIvMg7pmgOTyWYFCZQ=='],
    ['dsh-bili-mini', '0.2.0', 'sha512-BfCS0C+Ctubm/lAHsRyZ0KhrSpHT+5zx24Jgf8qS2ELOarmulYMeBGxN2pXVVpJaGIjP+vLxs2BVsMn6/5g+3A=='],
  ];
  for (const [name, version, digest] of held) assert(!reviews.entries.some(r => r.name === name && r.version === version && r.integrity === digest));
});
