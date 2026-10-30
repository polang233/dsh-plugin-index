import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILD_CRON, REPLAY_CRON, replayReads, requestBuild, runScheduled } from '../cloudflare/scheduled-tasks.js';

const json = body => new Response(JSON.stringify(body));

test('replay follows the continuation and stops when the queue is empty', async () => {
  const bodies = [];
  const answers = [{ delivered: 2, failed: 0, continuation: 'next' }, { delivered: 1, failed: 0, continuation: null }];
  const delivered = await replayReads({ GATEWAY_AUTH_SECRET: 's' }, async (url, init) => { bodies.push(JSON.parse(init.body)); return json(answers.shift()); });
  assert.equal(delivered, 3);
  assert.deepEqual(bodies, [{ continuation: null }, { continuation: 'next' }]);
});

test('replay uses a redirect mode Workers accept and treats a redirect as a failure', async () => {
  let mode;
  await assert.rejects(replayReads({}, async (url, init) => { mode = init.redirect; return new Response(null, { status: 302 }); }), /HTTP 302/);
  assert.equal(mode, 'manual');
});

test('replay reports events it had to keep, and stops after a bounded number of rounds', async () => {
  await assert.rejects(replayReads({}, async () => json({ delivered: 0, failed: 3 })), /3 events retained/);
  let calls = 0;
  await replayReads({}, async () => { calls++; return json({ delivered: 1, failed: 0, continuation: 'more' }); });
  assert.equal(calls, 8);
});

test('a build request names main and fails loudly without its token or on refusal', async () => {
  let request;
  await requestBuild({ GITHUB_DISPATCH_TOKEN: 't' }, async (url, init) => { request = { url, init }; return new Response(null, { status: 204 }); });
  assert.match(request.url, /workflows\/publish\.yml\/dispatches$/);
  assert.equal(request.init.headers.authorization, 'Bearer t');
  assert.deepEqual(JSON.parse(request.init.body), { ref: 'main' });
  await assert.rejects(requestBuild({}), /not configured/);
  await assert.rejects(requestBuild({ GITHUB_DISPATCH_TOKEN: 't' }, async () => new Response('no', { status: 401 })), /HTTP 401/);
});

test('each cron runs its own job and an unknown one is an error', async () => {
  const urls = [];
  const fetchImpl = async url => { urls.push(url); return url.includes('replay') ? json({ delivered: 0, failed: 0, continuation: null }) : new Response(null, { status: 204 }); };
  const env = { GATEWAY_AUTH_SECRET: 's', GITHUB_DISPATCH_TOKEN: 't', COUNTER_FROM_DAY: '2099-01-01' };
  await runScheduled({ cron: REPLAY_CRON, scheduledTime: Date.now() }, env, fetchImpl);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /replay-reads/);
  await runScheduled({ cron: BUILD_CRON, scheduledTime: Date.now() }, env, fetchImpl);
  assert.match(urls[1], /dispatches/);
  await assert.rejects(runScheduled({ cron: '* * * * *' }, env, fetchImpl), /Unknown schedule/);
});
