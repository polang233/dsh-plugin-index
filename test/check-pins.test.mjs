import test from 'node:test';
import assert from 'node:assert/strict';
import { report, staleEntries } from '../scripts/check-pins.mjs';

test('the maintenance report flags long failures and lists stale pins', () => {
  const now = Date.parse('2026-10-21T00:00:00Z');
  const body = report({
    now,
    failures: [
      { name: 'kept', retained: true, version: '1.0.0', since: '2026-10-20T00:00:00Z', error: 'timeout' },
      { name: 'gone', retained: false, since: '2026-10-10T00:00:00Z', error: 'HTTP 404' }
    ],
    stale: [{ name: 'pinned', kind: 'npm', pinned: '1.0.0', latest: '1.1.0', reviews: ['archiveReview'] }]
  });
  assert.match(body, /`kept` kept at 1\.0\.0, failing for 1 day/);
  assert.match(body, /\*\*\[long\]\*\* `gone` left out, failing for 11 day/);
  assert.match(body, /`pinned` \(npm, archiveReview\): pinned 1\.0\.0, upstream 1\.1\.0/);
  assert.equal(report({ now, failures: [], stale: [] }), '');
});

test('a Git package in a subdirectory checks that directory for upstream updates', async () => {
  const urls = [];
  const entries = [{name: 'plugin', version: '1.0.0', source: {type: 'git', url: 'https://github.com/owner/repo', path: 'packages/plugin'}}];
  const stale = await staleEntries(entries, {fetchImpl: async url => {
    urls.push(url);
    return Response.json({content: Buffer.from(JSON.stringify({version: '1.1.0'})).toString('base64')});
  }});
  assert.deepEqual(urls, ['https://api.github.com/repos/owner/repo/contents/packages/plugin/package.json']);
  assert.equal(stale[0].latest, '1.1.0');
  assert.deepEqual(await staleEntries([{...entries[0], source: {...entries[0].source, path: '../outside'}}], {fetchImpl: () => assert.fail('unsafe path must not fetch')}), []);
});
