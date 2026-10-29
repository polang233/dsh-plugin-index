import { isReadDay } from '../shared/read-event.js';

/**
 * Add only previously unsynced increments to the existing D1 reports. The
 * watermark and report updates commit in one transaction, preserving legacy
 * counts and making retries and out-of-order snapshots harmless.
 */
export async function syncReadSnapshot(db, snapshot, counterFromDay) {
  if (!isReadDay(counterFromDay) || !isReadDay(snapshot?.day) || snapshot.day < counterFromDay || !Array.isArray(snapshot.countries)) throw new Error('Invalid snapshot day');
  if (!Number.isSafeInteger(snapshot.reads) || !Number.isSafeInteger(snapshot.readers) || snapshot.reads < 0 || snapshot.readers < 0 || snapshot.readers > snapshot.reads) throw new Error('Invalid snapshot totals');
  const countries = new Set();
  let reads = 0;
  let readers = 0;
  for (const row of snapshot.countries) {
    if (!/^[A-Z]{2}$/.test(row?.country ?? '') || countries.has(row.country) || !Number.isSafeInteger(row.reads) || !Number.isSafeInteger(row.readers) || row.reads < 0 || row.readers < 0 || row.readers > row.reads) throw new Error('Invalid snapshot country');
    countries.add(row.country);
    reads += row.reads;
    readers += row.readers;
  }
  if (reads !== snapshot.reads || readers !== snapshot.readers) throw new Error('Snapshot totals do not match countries');
  const day = snapshot.day;
  const statements = [db.prepare(`CREATE TABLE IF NOT EXISTS read_counter_sync
    (day TEXT NOT NULL, country TEXT NOT NULL, reads INTEGER NOT NULL, readers INTEGER NOT NULL, PRIMARY KEY(day, country))`)];
  const delta = column => `MAX(0, ? - COALESCE((SELECT ${column} FROM read_counter_sync WHERE day = ? AND country = ?), 0))`;
  const watermark = (country, count, people) => db.prepare(`INSERT INTO read_counter_sync VALUES (?, ?, ?, ?)
    ON CONFLICT(day, country) DO UPDATE SET reads = MAX(reads, excluded.reads), readers = MAX(readers, excluded.readers)
    WHERE excluded.reads > reads OR excluded.readers > readers`)
    .bind(day, country, count, people);
  statements.push(db.prepare(`INSERT INTO reads (day, reads, readers) VALUES (?, ${delta('reads')}, ${delta('readers')})
    ON CONFLICT(day) DO UPDATE SET reads = reads + excluded.reads, readers = readers + excluded.readers
    WHERE excluded.reads > 0 OR excluded.readers > 0`).bind(day, reads, day, '*', readers, day, '*'));
  statements.push(watermark('*', reads, readers));
  for (const row of snapshot.countries) {
    statements.push(db.prepare(`INSERT INTO countries (day, country, reads, readers) VALUES (?, ?, ${delta('reads')}, ${delta('readers')})
      ON CONFLICT(day, country) DO UPDATE SET reads = reads + excluded.reads, readers = readers + excluded.readers
      WHERE excluded.reads > 0 OR excluded.readers > 0`)
      .bind(day, row.country, row.reads, day, row.country, row.readers, day, row.country));
    statements.push(watermark(row.country, row.reads, row.readers));
  }
  await db.batch(statements);
}
