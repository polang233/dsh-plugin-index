import test from 'node:test';
import assert from 'node:assert/strict';
import { changedUrls, submit, INDEXNOW_KEY, INDEXNOW_HOST } from '../scripts/indexnow.mjs';

test('submits new, changed and always-changing pages only', () => {
  const current = { pages: { 'https://dshopen.org/': null, 'https://dshopen.org/plugins/a/': '1', 'https://dshopen.org/plugins/b/': '2', 'https://dshopen.org/plugins/c/': '3' } };
  const previous = { pages: { 'https://dshopen.org/': null, 'https://dshopen.org/plugins/a/': '1', 'https://dshopen.org/plugins/b/': 'old' } };
  assert.deepEqual(changedUrls(current, previous), ['https://dshopen.org/', 'https://dshopen.org/plugins/b/', 'https://dshopen.org/plugins/c/']);
});

test('submits everything without a previous manifest', () => {
  assert.equal(changedUrls({ pages: { a: '1', b: null } }, {}).length, 2);
});

test('posts the key, its location and the URLs, and rejects refusals', async () => {
  const calls = [];
  const ok = async (url, init) => { calls.push([url, JSON.parse(init.body)]); return new Response(null, { status: 202 }); };
  assert.equal(await submit(['https://dshopen.org/'], ok), 1);
  assert.deepEqual(calls[0][1], { host: INDEXNOW_HOST, key: INDEXNOW_KEY, keyLocation: `https://dshopen.org/${INDEXNOW_KEY}.txt`, urlList: ['https://dshopen.org/'] });
  await assert.rejects(submit(['https://dshopen.org/'], async () => new Response('bad key', { status: 403 })), /HTTP 403/);
});
