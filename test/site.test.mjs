import test from 'node:test';
import assert from 'node:assert/strict';
import { HEADERS, renderStars } from '../scripts/site.mjs';

const plugin = { repository: { url: 'https://github.com/owner/plugin' } };
const snapshot = (stars, status = 'ok') => ({ repositories: { 'owner/plugin': { url: 'https://github.com/owner/plugin', stars, status, fetchedAt: '2026-10-18T05:26:39.262Z' } } });

test('star link preserves the exact count, source and fetch timestamp', () => {
  const html = renderStars(plugin, snapshot(1234), 'en');
  assert.match(html, /data-stars="1234"/);
  assert.match(html, /1,234/);
  assert.match(html, /https:\/\/github.com\/owner\/plugin\/stargazers/);
  assert.match(html, /2026-10-18 05:26:39 UTC/);
});
test('measured zero and unavailable counts have different visible states', () => {
  assert.match(renderStars(plugin, snapshot(0), 'en'), /data-stars="0"/);
  assert.match(renderStars(plugin, {}, 'zh'), /暂不可用/);
  assert.doesNotMatch(renderStars(plugin, {}, 'en'), /data-stars=/);
});
test('a fallback count shows the number without cache wording', () => {
  assert.match(renderStars(plugin, snapshot(345, 'stale'), 'en'), /data-stars="345"/);
  assert.doesNotMatch(renderStars(plugin, snapshot(345, 'stale'), 'zh'), /缓存/);
});
test('non-GitHub repositories do not display a fabricated count', () => {
  assert.equal(renderStars({ repository: { url: 'https://gitee.com/owner/plugin' } }, {}, 'zh'), '');
});

test('hashed plugin icons are served as immutable', () => {
  assert.match(HEADERS, /^\/icons\/\*\n  Cache-Control: public, max-age=31536000, immutable\n  Access-Control-Allow-Origin: \*\n  X-Content-Type-Options: nosniff\n  Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:\n$/);
});
