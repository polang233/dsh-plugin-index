import test from 'node:test';
import assert from 'node:assert/strict';
import { addedTimestamp, trackAdded } from '../scripts/added.mjs';

test('added dates carry forward and new packages get today', () => {
  const now = Date.parse('2026-10-21T08:00:00Z');
  const added = trackAdded(['kept', 'fresh'], { schema: 1, packages: { kept: '2026-10-19', gone: '2026-10-18' } }, now);
  assert.deepEqual(added, { schema: 1, packages: { fresh: '2026-10-21', kept: '2026-10-19' } });
  assert.equal(addedTimestamp(added, 'kept'), Date.parse('2026-10-19T00:00:00Z') / 1000);
  assert.equal(addedTimestamp(added, 'missing'), undefined);
});

test('a missing or malformed snapshot starts from today', () => {
  const now = Date.parse('2026-10-21T08:00:00Z');
  assert.deepEqual(trackAdded(['a'], undefined, now).packages, { a: '2026-10-21' });
  assert.deepEqual(trackAdded(['a'], { schema: 1, packages: { a: 'yesterday' } }, now).packages, { a: '2026-10-21' });
});
