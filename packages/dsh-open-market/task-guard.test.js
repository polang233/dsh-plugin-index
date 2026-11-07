import test from 'node:test';
import assert from 'node:assert/strict';
import {createTaskGuard} from './task-guard.js';

const deferred = () => { let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve}; };

function fixture() {
  const agents = [], listeners = new Set(), activities = new Map(), jobs = [];
  const events = {
    on(name, listener) { assert.equal(name, 'agent/created'); listeners.add(listener); return () => listeners.delete(listener); },
    async waterfall(_name, {sessionId}, fallback) { return activities.get(sessionId) ?? fallback(); },
    async created(agent) { for (const listener of listeners) await listener({agent}); },
  };
  function agent(id, status = 'idle') {
    let maintenance;
    const abort = new AbortController();
    const value = {id, session: {id}, status, inbox: [], turns: [],
      get maintained() { return !!maintenance; },
      cancel(reason) { abort.abort(reason); },
      send(input) { (maintenance ? value.inbox : value.turns).push(input); },
      runMaintenance(task) {
        if (value.status !== 'idle' || maintenance) throw Error('Not idle');
        maintenance = true;
        return task(abort.signal).finally(() => {maintenance = false; value.turns.push(...value.inbox.splice(0));});
      },
    };
    agents.push(value); return value;
  }
  const services = {agents: {list: () => agents}, workspaceRegistry: {list: () => [{sessionIds: ['stored']}]}, jobs: {list: () => jobs}};
  return {agent, services, events, activities, jobs, listeners, guard: createTaskGuard({get: key => services[key], events})};
}

test('turns, approval waits, stored-session work and unowned jobs all prevent mutations', async t => {
  const f = fixture(); t.after(() => f.guard.dispose());
  const agent = f.agent('live', 'running'); let writes = 0;
  const operation = () => {writes++; return {ok: true};};
  assert.equal((await f.guard.run(operation)).code, 'tasks-active');
  agent.status = 'idle';
  for (const [session, activity] of [['live', {kind: 'approval'}], ['stored', {kind: 'job'}], ['stored', {kind: 'subagent'}]]) {
    f.activities.set(session, [activity]);
    assert.equal((await f.guard.run(operation)).code, 'tasks-active');
    assert.equal(agent.maintained, false, 'Rejected windows release existing Agents');
    f.activities.clear();
  }
  f.jobs.push({status: 'stopping'});
  assert.equal((await f.guard.run(operation)).code, 'tasks-active');
  f.jobs[0].status = 'succeeded';
  assert.equal((await f.guard.run(operation)).ok, true);
  assert.equal(writes, 1);
});

test('maintenance queues waking input and reserves new Agents without deadlocking creation', async t => {
  const f = fixture(); t.after(() => f.guard.dispose());
  const first = f.agent('first'), entered = deferred(), finish = deferred();
  const update = f.guard.run(async () => {entered.resolve(); await finish.promise; return {ok: true};});
  await entered.promise;
  first.send('next turn');
  assert.deepEqual(first.turns, []);
  const second = f.agent('new');
  await f.events.created(second);
  second.send('first turn');
  assert.equal(second.maintained, true);
  assert.deepEqual(second.turns, []);
  assert.equal((await f.guard.run(() => assert.fail('overlap'))).code, 'management-busy');
  first.cancel({kind: 'user'});
  await Promise.resolve();
  assert.equal(first.maintained, true, 'A stop request must not release queued input during replacement');
  finish.resolve();
  assert.equal((await update).ok, true);
  assert.deepEqual(first.turns, ['next turn']);
  assert.deepEqual(second.turns, ['first turn']);
});

test('disposed Agents can retire during reconciliation while the other leases stay held', async t => {
  const f = fixture(); t.after(() => f.guard.dispose());
  const disposed = f.agent('disposed'), remaining = f.agent('remaining');
  await f.guard.run(async () => {
    disposed.cancel({kind: 'disposed'});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(disposed.maintained, false);
    assert.equal(remaining.maintained, true);
    return {ok: true};
  });
  assert.equal(remaining.maintained, false);
});

test('unknown monitoring capabilities fail closed, and operation failures retain their identity', async t => {
  const f = fixture(); t.after(() => f.guard.dispose());
  const agent = f.agent('demo');
  const failure = Error('download failed');
  await assert.rejects(f.guard.run(() => {throw failure;}), error => error === failure);
  assert.equal(agent.maintained, false);
  f.services.workspaceRegistry = undefined;
  assert.equal((await f.guard.activity()).available, false);
  assert.equal((await f.guard.run(() => assert.fail('Unsafe mutation'))).code, 'task-monitor-unavailable');
  f.guard.dispose();
  assert.equal(f.listeners.size, 0);
});

test('another maintenance owner and malformed activity do not become idle windows', async t => {
  const f = fixture(); t.after(() => f.guard.dispose());
  const agent = f.agent('demo');
  agent.runMaintenance = () => {throw Error('Already maintained');};
  assert.equal((await f.guard.run(() => assert.fail('Unsafe mutation'))).code, 'task-monitor-unavailable');
  agent.runMaintenance = async () => {throw Error('Unsupported asynchronous contract');};
  assert.equal((await f.guard.run(() => assert.fail('Unsafe mutation'))).code, 'task-monitor-unavailable');
  f.activities.set('stored', {});
  assert.equal((await f.guard.activity()).available, false);
});

test('a stalled activity provider times out and releases the reserved Agents without writing', async t => {
  const f = fixture(); t.after(() => f.guard.dispose());
  const agent = f.agent('demo');
  f.events.waterfall = () => new Promise(() => {});
  const result = await f.guard.run(() => assert.fail('Unsafe mutation'));
  assert.equal(result.code, 'task-monitor-unavailable');
  assert.equal(agent.maintained, false);
});
