import test from 'node:test';
import assert from 'node:assert/strict';
import {validateScreenshots} from '../scripts/screenshots.mjs';
import {applyMarketDisplay} from '../scripts/market-display.mjs';

test('author screenshots reach the display catalog without changing the official index', () => {
  const screenshots = validateScreenshots([{url: 'https://raw.githubusercontent.com/a/b/abc/docs/screenshot.png', alt: 'Task list'}]);
  const plugin = {name: 'demo', versions: [{version: '1.0.0', publishTimestamp: 1, source: {type: 'npm'}}]};
  const {index, display} = applyMarketDisplay({format: 1, title: 'Market', plugins: [plugin]}, {packageEvidence: {packages: [{name: 'demo', display: {screenshots}}]}});
  assert.deepEqual(display.plugins.demo.screenshots, screenshots);
  assert.equal(index.plugins[0].screenshots, undefined);
  assert.deepEqual(validateScreenshots([]), []);
  assert.equal(validateScreenshots(undefined), undefined);
});

test('submitted screenshots reject credentials, non-GitHub hosts, active files and excessive counts', () => {
  for (const url of ['http://github.com/a.png', 'https://user:secret@github.com/a.png', 'https://tracker.example/a.png', 'https://github.com/a.svg', 'javascript:alert(1)']) {
    assert.throws(() => validateScreenshots([{url, alt: 'Preview'}]));
  }
  assert.throws(() => validateScreenshots(Array(7).fill({url: 'https://github.com/a.png', alt: 'Preview'})));
  assert.throws(() => validateScreenshots([{url: 'https://github.com/a.png', alt: ''}]));
});
