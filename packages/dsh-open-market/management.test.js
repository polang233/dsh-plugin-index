import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createManagementController, createManagementHandler, managementRequest, sharedManagement} from './management.js';

const deferred = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
const target = {action: 'update', name: 'demo', spec: 'demo@2.0.0', when: 'idle'};
function native() {
  const calls = [], bundles = ['demo', 'other'].map(name => ({name, version: '1.0.0', source: name + '@^1.0.0',
    availability: 'profile', installed: true, enabled: true, removable: true, updatable: true}));
  const manager = {
    async listBundles() {return structuredClone(bundles);},
    async inspect() {assert.fail('Native update should be preferred');},
    async installBundle() {assert.fail('Unexpected install');},
    async updateBundle(name, version) {calls.push(['update', name, version]); bundles.find(item => item.name === name).version = version; return {result: {application: 'applied'}};},
    async removeBundle(name) {calls.push(['remove', name]); bundles.splice(bundles.findIndex(item => item.name === name), 1); return {application: 'applied'};},
    async setBundleEnabled(name, enabled) {calls.push(['toggle', name, enabled]); bundles.find(item => item.name === name).enabled = enabled; return {application: 'applied'};},
  };
  return {manager, calls, bundles};
}
function create(t, options = {}) {
  const f = native();
  const state = {busy: false, available: true, disposed: 0};
  const guard = {activity: async () => ({available: state.available, busy: state.busy, running: +state.busy, activities: 0}),
    run: async operation => !state.available ? {ok: false, code: 'task-monitor-unavailable'} : state.busy ? {ok: false, code: 'tasks-active'} : operation(),
    dispose: () => {state.disposed++;}};
  const controller = createManagementController({...f, guard, interval: 60_000, ...options});
  t.after(() => controller.close());
  return {...f, controller, state, guard};
}

test('immediate mutations refuse active tasks; idle updates wait, deduplicate and can be cancelled', async t => {
  const f = create(t); f.state.busy = true;
  for (const request of [{...target, when: 'now'}, {action: 'toggle', name: 'demo', enabled: false}, {action: 'remove', name: 'demo', confirmation: 'demo'}]) {
    assert.equal((await f.controller.submit(request)).code, 'tasks-active');
  }
  const queued = await f.controller.submit(target);
  assert.equal(queued.queued, true);
  await f.controller.pump();
  assert.equal((await f.controller.snapshot()).jobs.at(-1).state, 'waiting');
  assert.equal((await f.controller.submit(target)).job.id, queued.job.id);
  assert.equal((await f.controller.submit({...target, spec: 'demo@3.0.0'})).code, 'management-busy');
  assert.equal((await f.controller.submit({action: 'toggle', name: 'demo', enabled: false})).code, 'management-busy');
  await f.controller.submit({action: 'cancel', id: queued.job.id});
  f.state.busy = false;
  await f.controller.pump();
  assert.deepEqual(f.calls, []);
  assert.equal((await f.controller.snapshot()).jobs.at(-1).state, 'cancelled');
});

test('idle updates revalidate the original version, source and enabled selection', async t => {
  for (const change of [{version: '1.1.0'}, {source: 'file:/different'}, {enabled: false}]) {
    const f = create(t);
    const queued = await f.controller.submit(target);
    Object.assign(f.bundles[0], change);
    await f.controller.pump();
    const job = (await f.controller.snapshot()).jobs[0];
    assert.equal(job.state, 'failed');
    assert.equal(job.result.code, 'installation-changed');
    assert.equal((await f.controller.submit({action: 'retry', id: queued.job.id})).code, 'installation-changed');
    assert.deepEqual(f.calls, []);
  }
});

test('an immediate update reserves execution before persistence, and request ids do not replay mutations', async t => {
  const f = create(t), entered = deferred(), release = deferred();
  const original = f.manager.updateBundle;
  f.manager.updateBundle = async (...args) => {entered.resolve(); await release.promise; return original(...args);};
  const request = {...target, when: 'now', requestId: 'one-update'};
  const running = f.controller.submit(request);
  await entered.promise;
  await f.controller.pump();
  assert.equal((await f.controller.submit({...target, name: 'other', spec: 'other@2.0.0', when: 'now'})).code, 'management-busy');
  assert.equal((await f.controller.submit({action: 'cancel', id: request.requestId})).code, 'operation-running');
  const duplicate = await f.controller.submit(request);
  assert.equal(duplicate.queued, true);
  release.resolve();
  assert.equal((await running).ok, true);
  assert.equal((await f.controller.submit(request)).ok, true);
  assert.deepEqual(f.calls, [['update', 'demo', '2.0.0']]);
  await assert.rejects(f.controller.submit({...request, spec: 'demo@3.0.0'}), /already used/);
});

test('concurrent admissions produce a single queue record, and different sources do not merge', async t => {
  const f = create(t);
  const answers = await Promise.all([f.controller.submit(target), f.controller.submit(target)]);
  assert.equal(answers[0].job.id, answers[1].job.id);
  assert.equal((await f.controller.snapshot()).jobs.length, 1);
  assert.equal((await f.controller.submit({...target, registry: 'https://another.example/'})).code, 'management-busy');
});

test('disable and uninstall use native controls and preserve native restart and read-only results', async t => {
  const f = create(t);
  f.bundles[0].readOnlyReason = 'profile-read-only';
  assert.equal((await f.controller.submit({action: 'toggle', name: 'demo', enabled: false})).code, 'read-only');
  delete f.bundles[0].readOnlyReason;
  const set = f.manager.setBundleEnabled;
  f.manager.setBundleEnabled = async (...args) => {await set(...args); return {application: 'restart-required', restartReason: 'hmr-unavailable'};};
  const toggled = await f.controller.submit({action: 'toggle', name: 'demo', enabled: false});
  assert.equal(toggled.restart, true);
  assert.equal(toggled.restartReason, 'hmr-unavailable');
  assert.equal((await f.controller.submit({action: 'remove', name: 'demo', confirmation: 'demo'})).ok, true);
  assert.deepEqual(f.calls, [['toggle', 'demo', false], ['remove', 'demo']]);
  assert.throws(() => managementRequest({action: 'remove', name: 'other', confirmation: 'wrong'}), /Invalid management/);
});

test('closing during a native mutation keeps the guard until completion and can reopen after self-reload', async t => {
  const f = create(t), entered = deferred(), release = deferred();
  const original = f.manager.setBundleEnabled;
  f.manager.setBundleEnabled = async (...args) => {entered.resolve(); await release.promise; return original(...args);};
  const mutation = f.controller.submit({action: 'toggle', name: 'demo', enabled: false});
  await entered.promise;
  f.controller.close();
  assert.equal(f.controller.running, true);
  assert.equal(f.state.disposed, 0);
  f.controller.reopen();
  release.resolve();
  assert.equal((await mutation).ok, true);
  assert.equal(f.state.disposed, 0);
  f.controller.close();
  assert.equal(f.state.disposed, 1);
  f.controller.close();
  assert.equal(f.state.disposed, 1);
});

test('a restarted Host requires explicit confirmation and does not replay queued updates', async t => {
  const scratch = fileURLToPath(new URL('../../.local/', import.meta.url));
  await mkdir(scratch, {recursive: true});
  const dir = await mkdtemp(join(scratch, 'management-test-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const f = create(t, {dir});
  const queued = await f.controller.submit({...target, requestId: 'persisted-update'});
  f.controller.close();
  const next = create(t, {dir, manager: f.manager});
  await next.controller.pump();
  assert.equal((await next.controller.snapshot()).jobs[0].state, 'interrupted');
  assert.deepEqual(f.calls, []);
  await next.controller.submit({action: 'retry', id: queued.job.id});
  await next.controller.pump();
  assert.deepEqual(f.calls, [['update', 'demo', '2.0.0']]);
  const disk = JSON.parse(await readFile(join(dir, '.dsh-open-market-management.json'), 'utf8'));
  assert.equal(disk.jobs[0].state, 'succeeded');
});

test('missing task monitoring never changes a bundle or silently executes a queued update', async t => {
  const f = create(t); f.state.available = false;
  assert.equal((await f.controller.submit({...target, when: 'now'})).code, 'task-monitor-unavailable');
  await f.controller.submit(target); await f.controller.pump();
  assert.deepEqual(f.calls, []);
  assert.equal((await f.controller.snapshot()).jobs.at(-1).state, 'waiting');
});

test('invalid persisted state reports unavailable without replaying or crashing startup', async t => {
  const scratch = fileURLToPath(new URL('../../.local/', import.meta.url));
  await mkdir(scratch, {recursive: true});
  const dir = await mkdtemp(join(scratch, 'management-test-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  await writeFile(join(dir, '.dsh-open-market-management.json'), '{');
  const f = create(t, {dir});
  await assert.rejects(f.controller.ready, SyntaxError);
  const handler = createManagementHandler(f.controller, {requestRejection: () => undefined});
  assert.equal((await http(handler, {method: 'GET'})).status, 503);
  assert.equal((await http(handler)).status, 503);
  assert.deepEqual(f.calls, []);
});

test('the shared queue outlives a plugin context and recreates event subscriptions after an idle reload', async t => {
  const {manager} = native(); const listeners = new Set();
  const options = {manager, interval: 60_000, get: key => ({agents: {list: () => []}, workspaceRegistry: {list: () => []}})[key],
    events: {on: (_name, listener) => {listeners.add(listener); return () => listeners.delete(listener);}, waterfall() {return [];}}};
  const first = sharedManagement(options); t.after(() => first.close());
  const queued = await first.submit(target);
  first.close(); assert.equal(listeners.size, 0);
  const next = sharedManagement({...options, manager: {[Symbol.for('cordis.original')]: manager}});
  assert.equal(next, first); assert.equal(listeners.size, 1);
  assert.equal((await next.snapshot()).jobs[0].id, queued.job.id);
  await next.pump();
  assert.equal((await next.snapshot()).jobs[0].state, 'succeeded');
});

async function http(handler, {method = 'POST', body = target, type = 'application/json'} = {}) {
  const req = Readable.from([JSON.stringify(body)]);
  Object.assign(req, {method, headers: {'content-type': type}});
  const result = {};
  const res = {writeHead: status => {result.status = status;}, end: data => {result.body = JSON.parse(data);}};
  await handler(req, res); return result;
}
test('management authentication runs before reading activity, inventory or request bodies', async () => {
  let reads = 0;
  const controller = {snapshot: () => {reads++;}, submit: () => {reads++;}};
  for (const method of ['GET', 'POST']) {
    const rejected = await http(createManagementHandler(controller, {requestRejection: () => 401}), {method});
    assert.equal(rejected.status, 401);
  }
  assert.equal(reads, 0);
  assert.equal((await http(createManagementHandler(controller, {}))).status, 503);
});
test('the local API accepts bounded typed JSON and leaves invalid requests untouched', async t => {
  const f = create(t), handler = createManagementHandler(f.controller, {requestRejection: () => undefined});
  assert.equal((await http(handler, {type: 'text/plain'})).status, 415);
  assert.equal((await http(handler, {body: {...target, name: '../private'}})).status, 400);
  assert.equal((await http(handler, {body: {...target, requestId: '../id'}})).status, 400);
  assert.equal((await http(handler, {body: {...target, extra: 'x'.repeat(8192)}})).status, 413);
  assert.equal((await http(handler, {method: 'DELETE'})).status, 405);
  assert.equal((await http(handler)).body.queued, true);
  assert.equal((await http(handler, {method: 'GET'})).body.jobs.length, 1);
});

test('load order shares task and queue protection while directory shortcuts remain available', async t => {
  const calls = [];
  const diagnostics = {snapshot: async () => ({available: true}),
    open: async id => {calls.push(['open', id]); return {ok: true};},
    reorder: async request => {calls.push(['order', request.order]); return {ok: true};}};
  const f = create(t, {diagnostics});
  const reorder = {action: 'reorder', order: ['demo', 'other'], revision: 'a'.repeat(64)};
  f.state.busy = true;
  assert.equal((await f.controller.submit(reorder)).code, 'tasks-active');
  assert.equal((await f.controller.submit({action: 'open-directory', location: 'profile'})).ok, true);
  f.state.busy = false;
  assert.equal((await f.controller.submit(reorder)).ok, true);
  await f.controller.submit(target);
  assert.equal((await f.controller.submit(reorder)).code, 'management-busy');
  assert.deepEqual(calls, [['open', 'profile'], ['order', ['demo', 'other']]]);
  assert.throws(() => managementRequest({...reorder, order: ['demo', 'demo']}), /Invalid load order/);
  assert.throws(() => managementRequest({...reorder, revision: 'stale'}), /Invalid load order/);
});
