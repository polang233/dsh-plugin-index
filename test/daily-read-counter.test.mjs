import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { DailyReadCounter } from '../cloudflare/daily-read-counter.js';

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const storage = {
    sql: {
      exec(query, ...values) {
        const statement = db.prepare(query);
        if (statement.columns().length) {
          const rows = statement.all(...values).map(row => ({ ...row }));
          return { toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error('Expected one row'); return rows[0]; } };
        }
        return { rowsWritten: Number(statement.run(...values).changes) };
      },
    },
    transactionSync(fn) {
      db.exec('BEGIN IMMEDIATE');
      try { const result = fn(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  return { db, storage, counter: new DailyReadCounter(storage, '2026-10-29') };
}

const event = (n, visitor = '0123456789abcdef01234567', country = 'CN') => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, day: '2026-10-29', visitor, country,
});

test('replays count each read once and keep daily readers unique across country changes', t => {
  const { counter } = fixture(t);
  assert.equal(counter.ingest(event(1)), true);
  assert.equal(counter.ingest(event(1)), false);
  assert.equal(counter.ingest(event(2, undefined, 'JP')), true);
  assert.equal(counter.ingest(event(3, 'fedcba9876543210fedcba98')), true);
  assert.deepEqual(counter.snapshot(), {
    day: '2026-10-29', reads: 3, readers: 2,
    countries: [{ country: 'CN', reads: 2, readers: 2 }, { country: 'JP', reads: 1, readers: 0 }],
  });
  assert.throws(() => counter.ingest(event(1, undefined, 'JP')), /conflicts/);
  assert.equal(counter.snapshot().reads, 3);
});

test('a failed transaction rolls back both deduplication and totals', t => {
  const { counter, storage, db } = fixture(t);
  const exec = storage.sql.exec;
  storage.sql.exec = (query, ...values) => {
    if (query.startsWith('INSERT INTO countries')) throw new Error('synthetic failure');
    return exec(query, ...values);
  };
  assert.throws(() => counter.ingest(event(1)), /synthetic failure/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM read_events').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM visitors').get().count, 0);
  storage.sql.exec = exec;
  assert.equal(counter.ingest(event(1)), true);
  assert.equal(counter.snapshot().reads, 1);
});

test('a reader present in the legacy table remains deduplicated after migration', t => {
  const { counter } = fixture(t);
  counter.ingest(event(1), true);
  counter.ingest(event(2));
  assert.equal(counter.snapshot().reads, 2);
  assert.equal(counter.snapshot().readers, 0);
});

test('rejects wrong-day events and refuses raw client fields', t => {
  const { counter, db } = fixture(t);
  assert.throws(() => counter.ingest({ ...event(1), day: '2026-10-30' }), /another day/);
  assert.throws(() => counter.ingest({ ...event(1), ip: '192.0.2.1' }), /Unexpected read event fields/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM read_events').get().count, 0);
});
