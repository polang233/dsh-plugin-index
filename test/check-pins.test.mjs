import test from 'node:test';
import assert from 'node:assert/strict';
import { report } from '../scripts/check-pins.mjs';

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
