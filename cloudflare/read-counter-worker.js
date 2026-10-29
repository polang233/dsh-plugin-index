import { DurableObject } from 'cloudflare:workers';
import { DailyReadCounter } from './daily-read-counter.js';
import { receiveRead } from './receive-read.js';
import { syncReadSnapshot } from './sync-read-snapshot.js';
import { isReadDay } from '../shared/read-event.js';

export class DailyReadStats extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.counter = new DailyReadCounter(ctx.storage, ctx.id.name);
  }

  async ingest(event) {
    // Reuse the original salt and legacy hashes during the cutover day.
    let known = false;
    if (event.day === this.env.LEGACY_READ_DAY) {
      const row = await this.env.DB.prepare('SELECT 1 AS known FROM visitors WHERE day = ? AND hash = ?').bind(event.day, event.visitor).first();
      known = !!row;
    }
    const inserted = this.counter.ingest(event, known);
    const alarm = await this.ctx.storage.getAlarm();
    const next = Date.now() + 300_000;
    if (alarm === null || alarm > next) await this.ctx.storage.setAlarm(next);
    return inserted;
  }
  async snapshot() { return this.counter.snapshot(); }

  async alarm() {
    try { await syncReadSnapshot(this.env.DB, this.counter.snapshot(), this.env.COUNTER_FROM_DAY); }
    catch {
      await this.ctx.storage.setAlarm(Date.now() + 300_000);
      console.error('Read report synchronization deferred');
      return;
    }
    const expires = Date.parse(this.counter.day + 'T00:00:00Z') + 32 * 86_400_000;
    if (Date.now() >= expires) await this.ctx.storage.deleteAll();
    else await this.ctx.storage.setAlarm(expires);
  }
}

export default {
  async fetch(request, env) { return receiveRead(request, env); },
  async scheduled(controller, env) {
    if (!isReadDay(env.COUNTER_FROM_DAY)) throw new Error('Counter start day is not configured');
    const today = Date.parse(new Date(controller.scheduledTime).toISOString().slice(0, 10) + 'T00:00:00.000Z');
    for (const offset of [0, 1]) {
      const day = new Date(today - offset * 86_400_000).toISOString().slice(0, 10);
      if (day < env.COUNTER_FROM_DAY) continue;
      const snapshot = await env.READ_COUNTER.getByName(day).snapshot();
      await syncReadSnapshot(env.DB, snapshot, env.COUNTER_FROM_DAY);
    }
  },
};
