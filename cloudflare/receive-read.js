import { verifySignedRead } from '../shared/signed-read.js';
import { isReadDay } from '../shared/read-event.js';

function reply(body, status) {
  return new Response(JSON.stringify(body), { status, headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  } });
}

/** Accept a read only after an authenticated, idempotent counter commits it. */
export async function receiveRead(request, env, now = Date.now()) {
  let event;
  try { event = await verifySignedRead(request, { secret: env.GATEWAY_AUTH_SECRET, now }); }
  catch { return reply({ error: 'unavailable' }, 503); }
  if (!event) return reply({ error: 'unauthorized' }, 401);
  const today = new Date(now).toISOString().slice(0, 10);
  if (event.day > today) return reply({ error: 'invalid-day' }, 400);
  if (Date.parse(today) - Date.parse(event.day) > 30 * 86_400_000) return reply({ error: 'expired-day' }, 400);
  if (!isReadDay(env.COUNTER_FROM_DAY)) return reply({ error: 'unavailable' }, 503);
  if (event.day < env.COUNTER_FROM_DAY) return reply({ error: 'invalid-day' }, 400);
  try {
    const counter = env.READ_COUNTER.getByName(event.day);
    const inserted = await counter.ingest(event);
    // ingest() commits both the event and a durable synchronization alarm.
    // Replaying yesterday's backlog must not rewrite every country per event.
    return reply({ accepted: true, duplicate: !inserted }, 200);
  } catch {
    // The sender retains the event for retry after an uncertain acknowledgement.
    return reply({ error: 'unavailable' }, 503);
  }
}
