import assert from 'node:assert/strict';
import test from 'node:test';
import { recordRead, replayQueuedReads } from '../edgeone/lib/read-queue.js';

function event(n, overrides = {}) {
  return { id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, day: '2026-10-29', visitor: '0123456789abcdef01234567', country: 'CN', ...overrides };
}

function memoryStore(pageSize = 100) {
  const objects = new Map();
  return {
    objects,
    async setJSON(key, value) { objects.set(key, structuredClone(value)); },
    async get(key, options) {
      assert.deepEqual(options, { type: 'json', consistency: 'strong' });
      return objects.has(key) ? structuredClone(objects.get(key)) : null;
    },
    async delete(key) { objects.delete(key); },
    async list({ prefix, cursor, consistency, paginate }) {
      assert.equal(consistency, 'strong');
      assert.equal(paginate, false);
      const keys = [...objects.keys()].filter(key => key.startsWith(prefix) && (!cursor || key > cursor)).sort();
      const page = keys.slice(0, pageSize);
      return { blobs: page.map(key => ({ key })), ...(keys.length > pageSize ? { cursor: page.at(-1) } : {}) };
    },
  };
}

test('a committed read is sent directly without creating a queued copy', async () => {
  const store = memoryStore();
  const sent = [];
  assert.deepEqual(await recordRead(event(1), { store, deliver: async value => sent.push(value) }), { state: 'delivered' });
  assert.deepEqual(sent, [event(1)]);
  assert.equal(store.objects.size, 0);
});

test('a lost acknowledgement queues the event and replay does not duplicate an idempotent commit', async () => {
  const store = memoryStore();
  const committed = new Map();
  const first = async value => { committed.set(value.id, value); throw new Error('acknowledgement lost'); };
  assert.deepEqual(await recordRead(event(1), { store, deliver: first }), { state: 'queued' });
  const result = await replayQueuedReads({ store, deliver: async value => committed.set(value.id, value) });
  assert.deepEqual(result, { attempted: 1, delivered: 1, failed: 0, continuation: null });
  assert.equal(committed.size, 1);
  assert.equal(store.objects.size, 0);
});

test('failed delivery and failed cleanup keep an event available for another replay', async () => {
  const store = memoryStore();
  await recordRead(event(1), { store, deliver: async () => { throw new Error('offline'); } });
  let result = await replayQueuedReads({ store, deliver: async () => { throw new Error('still offline'); } });
  assert.equal(result.failed, 1);
  assert.equal(store.objects.size, 1);
  const originalDelete = store.delete;
  store.delete = async () => { throw new Error('storage unavailable'); };
  result = await replayQueuedReads({ store, deliver: async () => {} });
  assert.equal(result.failed, 1);
  assert.equal(store.objects.size, 1);
  store.delete = originalDelete;
  result = await replayQueuedReads({ store, deliver: async () => {} });
  assert.equal(result.delivered, 1);
  assert.equal(store.objects.size, 0);
});

test('bounded replay advances past a failed event and revisits it on the next scan', async () => {
  const store = memoryStore(2);
  for (let n = 1; n <= 4; n++) await recordRead(event(n), { store, deliver: async () => { throw new Error('offline'); } });
  const received = new Set();
  let continuation = null;
  do {
    const result = await replayQueuedReads({ store, limit: 1, continuation, deliver: async value => {
      if (value.id === event(1).id) throw new Error('temporarily unavailable');
      received.add(value.id);
    } });
    continuation = result.continuation;
  } while (continuation);
  assert.equal(received.size, 3);
  assert.equal(store.objects.size, 1);
  const retry = await replayQueuedReads({ store, deliver: async value => received.add(value.id) });
  assert.equal(retry.delivered, 1);
  assert.equal(received.size, 4);
});

test('never queues raw client data or silently accepts a failed queue write', async () => {
  const store = memoryStore();
  await assert.rejects(recordRead({ ...event(1), ip: '192.0.2.1' }, { store, deliver: async () => {} }), /Unexpected read event fields/);
  await assert.rejects(recordRead(event(1, { day: '2026-02-30' }), { store, deliver: async () => {} }), /Invalid read event day/);
  store.setJSON = async () => { throw new Error('storage unavailable'); };
  await assert.rejects(recordRead(event(1), { store, deliver: async () => { throw new Error('offline'); } }), /storage unavailable/);
});
