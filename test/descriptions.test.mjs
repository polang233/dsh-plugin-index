import test from 'node:test';
import assert from 'node:assert/strict';
import {stripStarPrefix, cleanDescription} from '../scripts/descriptions.mjs';
import {buildIndex} from '../scripts/lib.mjs';
import {applyMarketDisplay} from '../scripts/market-display.mjs';
import {applyCatalogCopy} from '../scripts/catalog-copy.mjs';
import {checkMarketDisplay} from '../scripts/check-published.mjs';

const name = 'demo-plugin';
const plugin = {name, repository: {url: 'https://github.com/owner/plugin'}, versions: [{version: '1.0.0', publishTimestamp: 1, source: {type: 'npm'}}]};
const index = {format: 1, title: 'Catalog', plugins: [plugin]};
const github = stars => ({schema: 1, repositories: {'owner/plugin': {status: 'ok', stars}}});
const NOW = Date.parse('2026-11-09T00:00:00Z');

test('remove repeated generated metric prefixes without removing authored star text', () => {
  for (const value of ['★ 5,899 │ ★ 5,884 │ Text', '★ 5,899 | ★ 5,884 ｜ Text', '  ★ 5\u202f899 │ Text']) {
    assert.equal(stripStarPrefix(value), 'Text');
  }
  assert.equal(stripStarPrefix('★ 0'), '');
  for (const value of ['★ Five useful tools', '★ 5 ways to work', 'Text ★ 123 │ quoted text']) assert.equal(stripStarPrefix(value), value);
  const source = {en: '★ 3 │ Text', zh: '★ 2 │ 介绍'};
  assert.deepEqual(cleanDescription(source), {en: 'Text', zh: '介绍'});
  assert.equal(source.en, '★ 3 │ Text');
});

test('repeated download failures retain one current metric and clean website copy', async () => {
  let previous = {base: 'https://example.org/', index: {...index, plugins: [{...plugin, description: {en: '★ 5,899 │ ★ 5,884 │ Text', zh: '★ 5,899 │ ★ 5,884 │ 介绍'}}]}, evidence: {packages: [{name, version: '1.0.0'}]}};
  for (const stars of [5899, 5901, 5902]) {
    const built = await buildIndex({title: 'Catalog', description: {en: 'Plugins'}, packages: [{name}]}, {previous, now: NOW, retryDelayMs: 0, fetchImpl: async () => {throw new Error('fetch failed');}});
    assert.deepEqual(built.index.plugins[0].description, {en: 'Text', zh: '介绍'});
    const displayed = applyMarketDisplay(built.index, {github: github(stars), now: NOW});
    assert.equal(displayed.index.plugins[0].description.zh, `★ ${stars.toLocaleString('en-US')} │ 介绍`);
    assert.deepEqual(displayed.display.plugins[name].description, {en: 'Text', zh: '介绍'});
    previous = {...previous, index: displayed.index, evidence: built.evidence};
  }
});

test('copy refresh recovers older polluted display snapshots and is idempotent', () => {
  const original = {...index, plugins: [{...plugin, description: {en: '★ 999 │ Text', zh: '★ 999 │ 介绍'}}]};
  let display = {schema: 1, plugins: {[name]: {description: {en: '★ 999 │ ★ 998 │ Text', zh: '★ 999 │ ★ 998 │ 介绍'}}}};
  let current = original;
  for (let n = 0; n < 3; n++) {
    const result = applyCatalogCopy(current, display, {packages: [{name}]}, github(1000));
    assert.deepEqual(result.display.plugins[name].description, {en: 'Text', zh: '介绍'});
    assert.equal(result.index.plugins[0].description.zh, '★ 1,000 │ 介绍');
    current = result.index; display = result.display;
  }
});

test('a missing star reading removes obsolete metrics, while zero is still measured', () => {
  const original = {...index, plugins: [{...plugin, description: {en: '★ 9 │ Text', zh: '★ 9 │ 介绍'}}]};
  assert.equal(applyMarketDisplay(original, {now: NOW}).index.plugins[0].description.zh, '介绍');
  assert.equal(applyMarketDisplay(original, {github: github(0), now: NOW}).index.plugins[0].description.zh, '★ 0 │ 介绍');
  const starOnly = {...index, plugins: [{...plugin, description: '★ 9'}]};
  assert.equal(applyMarketDisplay(starOnly, {now: NOW}).index.plugins[0].description, undefined);
  assert.equal(applyMarketDisplay(starOnly, {github: github(0), now: NOW}).index.plugins[0].description.zh, '★ 0');
});

test('publication validation rejects metrics hidden in raw presentation copy', () => {
  const result = applyMarketDisplay({...index, plugins: [{...plugin, description: {en: 'Text', zh: '介绍'}}]}, {github: github(10), now: NOW});
  result.display.plugins[name].description.zh = '★ 9 │ 介绍';
  result.index.plugins[0].description.zh = '★ 10 │ ★ 9 │ 介绍';
  assert.throws(() => checkMarketDisplay(result.index, github(10), {schema: 1}, result.display), /Metrics leaked into editorial copy/);
});
