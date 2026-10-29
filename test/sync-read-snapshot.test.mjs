import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { syncReadSnapshot } from '../cloudflare/sync-read-snapshot.js';

function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../cloudflare/schema.sql', import.meta.url), 'utf8'));
  t.after(() => sqlite.close());
  const prepare = (sql, values = []) => ({ sql, values, bind(...args) { return prepare(sql, args); } });
  const db = { prepare, async batch(statements) {
    sqlite.exec('BEGIN IMMEDIATE');
    try { for (const item of statements) sqlite.prepare(item.sql).run(...item.values); sqlite.exec('COMMIT'); }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
  return { sqlite, db };
}

const snapshot = (reads, readers, countries) => ({ day: '2026-10-29', reads, readers, countries });

test('new snapshots update existing reports without changing historical days', async t => {
  const { db, sqlite } = fixture(t);
  sqlite.prepare('INSERT INTO reads VALUES (?, ?, ?)').run('2026-10-28', 50, 20);
  await syncReadSnapshot(db, snapshot(4, 2, [
    { country: 'CN', reads: 3, readers: 2 }, { country: 'JP', reads: 1, readers: 0 },
  ]), '2026-10-29');
  assert.deepEqual({ ...sqlite.prepare('SELECT * FROM reads WHERE day = ?').get('2026-10-28') }, { day: '2026-10-28', reads: 50, readers: 20 });
  assert.deepEqual({ ...sqlite.prepare('SELECT * FROM reads WHERE day = ?').get('2026-10-29') }, { day: '2026-10-29', reads: 4, readers: 2 });
  assert.deepEqual(sqlite.prepare('SELECT country, reads, readers FROM countries ORDER BY country').all().map(row => ({ ...row })), [
    { country: 'CN', reads: 3, readers: 2 }, { country: 'JP', reads: 1, readers: 0 },
  ]);
});

test('out-of-order retries cannot reduce committed daily totals', async t => {
  const { db, sqlite } = fixture(t);
  const latest = snapshot(5, 3, [{ country: 'CN', reads: 4, readers: 3 }, { country: 'JP', reads: 1, readers: 0 }]);
  const older = snapshot(2, 1, [{ country: 'CN', reads: 2, readers: 1 }]);
  await syncReadSnapshot(db, latest, '2026-10-29');
  await syncReadSnapshot(db, older, '2026-10-29');
  assert.deepEqual({ ...sqlite.prepare('SELECT reads, readers FROM reads WHERE day = ?').get('2026-10-29') }, { reads: 5, readers: 3 });
  assert.deepEqual(sqlite.prepare('SELECT country, reads, readers FROM countries ORDER BY country').all().map(row => ({ ...row })), latest.countries);
});

test('a mid-day migration adds deltas to legacy reports exactly once', async t => {
  const { db, sqlite } = fixture(t);
  sqlite.prepare('INSERT INTO reads VALUES (?, ?, ?)').run('2026-10-29', 100, 50);
  sqlite.prepare('INSERT INTO countries VALUES (?, ?, ?, ?)').run('2026-10-29', 'CN', 100, 50);
  const value = snapshot(3, 1, [{ country: 'CN', reads: 3, readers: 1 }]);
  await syncReadSnapshot(db, value, '2026-10-29');
  await syncReadSnapshot(db, value, '2026-10-29');
  assert.deepEqual({ ...sqlite.prepare('SELECT reads, readers FROM reads').get() }, { reads: 103, readers: 51 });
  assert.deepEqual({ ...sqlite.prepare('SELECT reads, readers FROM countries').get() }, { reads: 103, readers: 51 });
});

test('invalid, inconsistent or legacy-day snapshots never write', async t => {
  const { db, sqlite } = fixture(t);
  await assert.rejects(syncReadSnapshot(db, { ...snapshot(1, 1, [{ country: 'CN', reads: 1, readers: 1 }]), day: '2026-10-28' }, '2026-10-29'), /Invalid snapshot day/);
  await assert.rejects(syncReadSnapshot(db, snapshot(5, 1, [{ country: 'CN', reads: 1, readers: 1 }]), '2026-10-29'), /totals/);
  await assert.rejects(syncReadSnapshot(db, snapshot(2, 2, [{ country: 'CN', reads: 1, readers: 1 }, { country: 'CN', reads: 1, readers: 1 }]), '2026-10-29'), /country/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM reads').get().count, 0);
});
