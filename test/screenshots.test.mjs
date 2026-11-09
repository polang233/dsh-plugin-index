import test from 'node:test';
import assert from 'node:assert/strict';
import {validateScreenshots, applyPluginPreviews} from '../scripts/screenshots.mjs';
import {applyMarketDisplay} from '../scripts/market-display.mjs';

test('author screenshots reach the display catalog without changing the official index', () => {
  const screenshots = validateScreenshots([{url: 'https://raw.githubusercontent.com/a/b/abc/docs/screenshot.png', alt: 'Task list'}]);
  const plugin = {name: 'demo', versions: [{version: '1.0.0', publishTimestamp: 1, source: {type: 'npm'}}]};
  const market = applyMarketDisplay({format: 1, title: 'Market', plugins: [plugin]});
  const before = JSON.stringify(market.index);
  const display = applyPluginPreviews(market.display, {schema: 1, plugins: {demo: {screenshots}}});
  assert.deepEqual(display.plugins.demo.screenshots, screenshots);
  assert.equal(market.index.plugins[0].screenshots, undefined);
  assert.equal(JSON.stringify(market.index), before);
  assert.equal(market.display.plugins.demo.screenshots, undefined);
  assert.deepEqual(validateScreenshots([]), []);
  assert.equal(validateScreenshots(undefined), undefined);
});

test('preview overrides can disable README guesses and do not invent absent catalog entries', () => {
  const source = {schema: 1, plugins: {demo: {description: {en: 'Description'}}}};
  const result = applyPluginPreviews(source, {schema: 1, plugins: {demo: {screenshots: []}, absent: {screenshots: []}}});
  assert.deepEqual(result.plugins.demo.screenshots, []);
  assert.equal(result.plugins.absent, undefined);
  assert.equal(source.plugins.demo.screenshots, undefined);
  for (const value of [{schema: 2, plugins: {}}, {schema: 1, plugins: []}, {schema: 1, plugins: {demo: {}}}, {schema: 1, plugins: {demo: {screenshots: [], description: 'invalid'}}}]) {
    assert.throws(() => applyPluginPreviews(source, value), /Invalid plugin preview/);
  }
});

test('submitted screenshots reject credentials, non-GitHub hosts, active files and excessive counts', () => {
  for (const url of ['http://github.com/a.png', 'https://user:secret@github.com/a.png', 'https://tracker.example/a.png', 'https://github.com/a.svg', 'javascript:alert(1)']) {
    assert.throws(() => validateScreenshots([{url, alt: 'Preview'}]));
  }
  assert.throws(() => validateScreenshots(Array(7).fill({url: 'https://github.com/a.png', alt: 'Preview'})));
  assert.throws(() => validateScreenshots([{url: 'https://github.com/a.png', alt: ''}]));
});

test('removing a preview override clears previously published screenshots', () => {
  const screenshots = [{url: 'https://github.com/a/b/raw/abc/screenshot.png', alt: 'Old preview'}];
  const source = {schema: 1, plugins: {demo: {description: {en: 'Description'}, screenshots}}};
  const result = applyPluginPreviews(source, {schema: 1, plugins: {}});
  assert.equal(result.plugins.demo.screenshots, undefined);
  assert.deepEqual(result.plugins.demo.description, source.plugins.demo.description);
  assert.deepEqual(source.plugins.demo.screenshots, screenshots);
});
