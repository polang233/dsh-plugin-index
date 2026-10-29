import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { DailyReadCounter } from '../cloudflare/daily-read-counter.js';
import { receiveRead } from '../cloudflare/receive-read.js';
import { signedReadRequest } from '../shared/signed-read.js';

const secret = 'synthetic-gateway-secret-with-at-least-32-characters';
const now = Date.parse('2026-10-29T01:00:00Z');
const event = { id: '00000000-0000-4000-8000-000000000001', day: '2026-10-29', visitor: '0123456789abcdef01234567', country: 'CN' };
const endpoint = 'https://counter.example/internal/read';

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const storage = {
    sql: { exec(query, ...values) {
      const statement = db.prepare(query);
      if (statement.columns().length) {
        const rows = statement.all(...values).map(row => ({ ...row }));
        return { toArray: () => rows, one: () => { if (rows.length !== 1) throw new Error('Expected one row'); return rows[0]; } };
      }
      return { rowsWritten: Number(statement.run(...values).changes) };
    } },
    transactionSync(fn) {
      db.exec('BEGIN IMMEDIATE');
      try { const result = fn(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
  const counter = new DailyReadCounter(storage, event.day);
  return { counter, env: { GATEWAY_AUTH_SECRET: secret, COUNTER_FROM_DAY: event.day, READ_COUNTER: { getByName(day) {
    assert.equal(day, event.day);
    return { async ingest(value) { return counter.ingest(value); }, async snapshot() { return counter.snapshot(); } };
  } } } };
}

test('signed retries are acknowledged without incrementing the read count twice', async t => {
  const { env, counter } = fixture(t);
  const request = await signedReadRequest(event, { endpoint, secret, now });
  const first = await receiveRead(request.clone(), env, now);
  const second = await receiveRead(request.clone(), env, now);
  assert.deepEqual(await first.json(), { accepted: true, duplicate: false });
  assert.deepEqual(await second.json(), { accepted: true, duplicate: true });
  assert.equal(counter.snapshot().reads, 1);
});

test('unauthorized and future reads cannot write to the counter', async t => {
  const { env, counter } = fixture(t);
  const missing = await receiveRead(new Request(endpoint, { method: 'POST', body: JSON.stringify(event) }), env, now);
  assert.equal(missing.status, 401);
  const future = await signedReadRequest({ ...event, day: '2026-10-30' }, { endpoint, secret, now });
  assert.equal((await receiveRead(future, env, now)).status, 400);
  assert.equal(counter.snapshot().reads, 0);
});

test('storage failures are not acknowledged, so the gateway can retain the event', async () => {
  const request = await signedReadRequest(event, { endpoint, secret, now });
  const env = { GATEWAY_AUTH_SECRET: secret, COUNTER_FROM_DAY: event.day, READ_COUNTER: { getByName: () => ({ async ingest() { throw new Error('offline'); } }) } };
  const response = await receiveRead(request, env, now);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('late events commit to the durable counter without rewriting D1 for every replay', async t => {
  const { env, counter } = fixture(t);
  let batches = 0;
  env.DB = {
    prepare(sql) { return { bind(...values) { return { sql, values }; } }; },
    async batch() { batches++; throw new Error('synthetic D1 outage'); },
  };
  const tomorrow = now + 86_400_000;
  const request = await signedReadRequest(event, { endpoint, secret, now: tomorrow });
  assert.equal((await receiveRead(request.clone(), env, tomorrow)).status, 200);
  assert.equal(counter.snapshot().reads, 1);
  const retried = await receiveRead(request.clone(), env, tomorrow);
  assert.deepEqual(await retried.json(), { accepted: true, duplicate: true });
  assert.equal(counter.snapshot().reads, 1);
  assert.equal(batches, 0);
});
