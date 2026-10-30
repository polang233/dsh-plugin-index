import { isReadDay } from '../shared/read-event.js';
import { syncReadSnapshot } from './sync-read-snapshot.js';

// GitHub delays or drops frequent schedules, so Cloudflare keeps the clock for both jobs.
export const REPLAY_CRON = '7,22,37,52 * * * *';
export const BUILD_CRON = '17 4,10,16,22 * * *';
const REPLAY_URL = 'https://network-probe.dshopen.org/api/replay-reads';
const DISPATCH_URL = 'https://api.github.com/repos/polang233/dsh-plugin-index/actions/workflows/publish.yml/dispatches';
const MAX_ROUNDS = 8;

/** Drain the gateway's retry queue; anything it could not deliver stays there for the next run. */
export async function replayReads(env, fetchImpl = fetch) {
  let continuation = null;
  let delivered = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await fetchImpl(REPLAY_URL, { method: 'POST', redirect: 'manual', headers: { authorization: `Bearer ${env.GATEWAY_AUTH_SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify({ continuation }) });
    if (!response.ok) throw new Error(`Queue replay failed: HTTP ${response.status}`);
    const result = await response.json();
    delivered += result.delivered;
    if (result.failed) throw new Error(`Queue delivery is unavailable; ${result.failed} events retained for retry`);
    continuation = result.continuation;
    if (!continuation) break;
  }
  return delivered;
}

/** One build per recommendation round. Only workflow_dispatch needs the token. */
export async function requestBuild(env, fetchImpl = fetch) {
  if (!env.GITHUB_DISPATCH_TOKEN) throw new Error('GITHUB_DISPATCH_TOKEN is not configured');
  const response = await fetchImpl(DISPATCH_URL, { method: 'POST', headers: { authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`, accept: 'application/vnd.github+json', 'user-agent': 'dshopen-scheduler', 'content-type': 'application/json' }, body: JSON.stringify({ ref: 'main' }) });
  if (response.status !== 204) throw new Error(`Build request failed: HTTP ${response.status}`);
}

/** Alarms normally keep the reports current; this repairs today and yesterday if one was lost. */
export async function syncRecentReports(env, scheduledTime) {
  if (!isReadDay(env.COUNTER_FROM_DAY)) throw new Error('Counter start day is not configured');
  const today = Date.parse(new Date(scheduledTime).toISOString().slice(0, 10) + 'T00:00:00.000Z');
  for (const offset of [0, 1]) {
    const day = new Date(today - offset * 86_400_000).toISOString().slice(0, 10);
    if (day < env.COUNTER_FROM_DAY) continue;
    const snapshot = await env.READ_COUNTER.getByName(day).snapshot();
    await syncReadSnapshot(env.DB, snapshot, env.COUNTER_FROM_DAY);
  }
}

export async function runScheduled(controller, env, fetchImpl = fetch) {
  if (controller.cron === REPLAY_CRON) return void await replayReads(env, fetchImpl);
  if (controller.cron !== BUILD_CRON) throw new Error('Unknown schedule: ' + controller.cron);
  await Promise.all([requestBuild(env, fetchImpl), syncRecentReports(env, controller.scheduledTime)]);
}
