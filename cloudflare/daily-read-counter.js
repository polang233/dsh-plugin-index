import { checkedReadEvent, isReadDay } from '../shared/read-event.js';

/**
 * A single day's idempotent read counter. The storage must be a SQLite-backed
 * Durable Object storage interface; one object owns one UTC day.
 */
export class DailyReadCounter {
  constructor(storage, day) {
    if (!isReadDay(day)) throw new Error('Invalid counter day');
    this.storage = storage;
    this.day = day;
    storage.sql.exec('CREATE TABLE IF NOT EXISTS read_events (id TEXT PRIMARY KEY, visitor TEXT NOT NULL, country TEXT NOT NULL) WITHOUT ROWID');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS visitors (hash TEXT PRIMARY KEY) WITHOUT ROWID');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS countries (country TEXT PRIMARY KEY, reads INTEGER NOT NULL, readers INTEGER NOT NULL) WITHOUT ROWID');
  }

  ingest(input, knownVisitor = false) {
    const event = checkedReadEvent(input);
    if (event.day !== this.day) throw new Error('Read event belongs to another day');
    return this.storage.transactionSync(() => {
      const sql = this.storage.sql;
      const inserted = sql.exec('INSERT OR IGNORE INTO read_events (id, visitor, country) VALUES (?, ?, ?)', event.id, event.visitor, event.country).rowsWritten > 0;
      if (!inserted) {
        const existing = sql.exec('SELECT visitor, country FROM read_events WHERE id = ?', event.id).one();
        if (existing.visitor !== event.visitor || existing.country !== event.country) throw new Error('Read event ID conflicts with an existing event');
        return false;
      }
      const insertedVisitor = sql.exec('INSERT OR IGNORE INTO visitors (hash) VALUES (?)', event.visitor).rowsWritten > 0;
      const unique = insertedVisitor && !knownVisitor ? 1 : 0;
      sql.exec(`INSERT INTO countries (country, reads, readers) VALUES (?, 1, ?)
        ON CONFLICT(country) DO UPDATE SET reads = reads + 1, readers = readers + excluded.readers`, event.country, unique);
      return true;
    });
  }

  snapshot() {
    const countries = this.storage.sql.exec('SELECT country, reads, readers FROM countries ORDER BY country').toArray();
    return {
      day: this.day,
      reads: countries.reduce((sum, row) => sum + row.reads, 0),
      readers: countries.reduce((sum, row) => sum + row.readers, 0),
      countries,
    };
  }
}
