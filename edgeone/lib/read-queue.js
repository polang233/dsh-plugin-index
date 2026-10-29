import { checkedReadEvent } from '../../shared/read-event.js';

const PREFIX = 'reads/';

function eventKey(event) {
  return `${PREFIX}${event.day}/${event.id}.json`;
}

/**
 * `deliver` must resolve only after an idempotent destination has committed the event.
 * A lost acknowledgement can queue an event that the destination has already committed.
 */
export async function recordRead(event, { deliver, store }) {
  const safe = checkedReadEvent(event);
  try {
    await deliver(safe);
    return { state: 'delivered' };
  } catch {
    await store.setJSON(eventKey(safe), safe);
    return { state: 'queued' };
  }
}

/**
 * Replay a bounded number of queued events. Concurrent replays are safe only when
 * the destination deduplicates by event ID before acknowledging the event.
 */
export async function replayQueuedReads({ store, deliver, limit = 25, continuation = null }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid replay limit');
  if (continuation !== null && (typeof continuation !== 'object' || Array.isArray(continuation))) throw new Error('Invalid replay continuation');
  const cursor = continuation?.cursor;
  const after = continuation?.after;
  if (cursor !== undefined && typeof cursor !== 'string') throw new Error('Invalid replay cursor');
  if (after !== undefined && (typeof after !== 'string' || !after.startsWith(PREFIX))) throw new Error('Invalid replay position');
  const page = await store.list({ prefix: PREFIX, consistency: 'strong', paginate: false, ...(cursor ? { cursor } : {}) });
  if (!Array.isArray(page?.blobs)) throw new Error('Invalid queue listing');
  const keys = page.blobs.map(blob => blob.key).filter(key => typeof key === 'string' && key.startsWith(PREFIX) && (!after || key > after)).sort();
  const selected = keys.slice(0, limit);
  let delivered = 0;
  let failed = 0;
  const replay = async key => {
    try {
      const value = await store.get(key, { type: 'json', consistency: 'strong' });
      // A concurrent replay may already have removed this object.
      if (value === null) return;
      const event = checkedReadEvent(value);
      if (eventKey(event) !== key) throw new Error('Queue key does not match event');
      await deliver(event);
      await store.delete(key);
      delivered++;
    } catch {
      // Keep the object for a future retry, including when deletion fails after delivery.
      failed++;
    }
  };
  // Bound parallelism so a provider outage cannot consume the edge invocation's
  // entire lifetime while waiting on each individual delivery timeout.
  for (let offset = 0; offset < selected.length; offset += 5) {
    await Promise.all(selected.slice(offset, offset + 5).map(replay));
  }
  const next = keys.length > selected.length
    ? { ...(cursor ? { cursor } : {}), after: selected.at(-1) }
    : page.cursor ? { cursor: page.cursor } : null;
  return { attempted: selected.length, delivered, failed, continuation: next };
}
