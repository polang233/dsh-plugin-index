import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {selfUpdateTarget, runSelfUpdate, createSelfUpdateHandler, SELF_PACKAGE, SELF_UPDATE_PATH} from './self-update.js';

const target = {spec: 'dsh-open-market@0.2.7', registry: 'https://registry.npmjs.org/'};
const gate = () => {let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve};};
function nativeManager(extra = {}) {
  return {
    installed: true, calls: [],
    async listBundles() {this.calls.push('list'); return [{name: SELF_PACKAGE, installed: this.installed, enabled: true, removable: true}];},
    async inspect(spec, options) {
      this.calls.push(['inspect', spec, options]);
      return this.installed ? {status: 'refused', problem: 'already-installed', reason: 'already installed'}
        : {status: 'accepted', name: SELF_PACKAGE, version: '0.2.7', registry: options.registry, saveExact: true};
    },
    async removeBundle(name) {this.calls.push(['remove', name]); this.installed = false; await this.onRemove?.(); return {application: 'applied'};},
    async installBundle(spec, options) {this.calls.push(['install', spec, options]); this.installed = true; return {application: 'restart-required'};},
    ...extra
  };
}

test('a Host-owned self-update completes after the plugin context is disposed', async () => {
  const manager = nativeManager();
  let current = {pluginManager: manager};
  manager.onRemove = () => {current = undefined;};
  const result = await runSelfUpdate(current.pluginManager, target);
  assert.equal(current, undefined);
  assert.deepEqual(result, {ok: true, restart: true});
  assert.deepEqual(manager.calls.map(call => Array.isArray(call) ? call[0] : call), ['list', 'inspect', 'remove', 'inspect', 'install']);
  const last = manager.calls.at(-1);
  assert.equal(last[1], target.spec);
  assert.equal(last[2].enabled, true);
  assert.equal(last[2].saveExact, true);
  assert.equal(last[2].registry, target.registry);
  assert.match(last[2].requestId, /^[0-9a-f-]{36}$/);
});

test('preflight failures and refused removals preserve the existing package', async () => {
  const unreachable = nativeManager({inspect: async () => ({status: 'refused', problem: 'network', reason: 'offline'})});
  assert.deepEqual(await runSelfUpdate(unreachable, target), {ok: false, error: 'offline'});
  assert.equal(unreachable.installed, true);
  const wrong = nativeManager({inspect: async () => ({status: 'accepted', name: 'someone-else', version: '0.2.7'})});
  assert.equal((await runSelfUpdate(wrong, target)).ok, false);
  assert.equal(wrong.installed, true);
  const stopped = nativeManager({removeBundle: async () => ({application: 'failed', error: {code: 'stop-profile', message: 'Stop the profile'}})});
  assert.deepEqual(await runSelfUpdate(stopped, target), {ok: false, code: 'stop-profile', error: 'Stop the profile'});
  assert.equal(stopped.installed, true);
  assert.equal(stopped.calls.some(call => call[0] === 'install'), false);
  const missing = nativeManager({installBundle: undefined});
  assert.equal((await runSelfUpdate(missing, target)).ok, false);
  assert.deepEqual(missing.calls, []);
});

test('self-update does not grant pending lifecycle scripts permission', async () => {
  const manager = nativeManager({installBundle: async (_spec, options) => {
    assert.equal(options.approvedBuilds, undefined);
    return {application: 'failed', pendingBuilds: ['dependency']};
  }});
  assert.equal((await runSelfUpdate(manager, target)).code, 'install-needs-dialog');
});

test('only one self-update can run on a manager at a time, and the lock is released', async () => {
  const entered = gate(), proceed = gate();
  const manager = nativeManager({onRemove: async () => {entered.resolve(); await proceed.promise;}});
  const first = runSelfUpdate(manager, target);
  await entered.promise;
  assert.match((await runSelfUpdate(manager, target)).error, /already running/);
  proceed.resolve();
  assert.equal((await first).ok, true);
  assert.equal((await runSelfUpdate(manager, target)).ok, true);
});

test('the update target cannot install another package, a tag, or arbitrary source code', () => {
  assert.deepEqual(selfUpdateTarget(target), {...target, version: '0.2.7'});
  const spec = 'git+https://github.com/polang233/dsh-plugin-index.git#' + 'a'.repeat(40) + '&path:/packages/dsh-open-market';
  assert.equal(selfUpdateTarget({spec}).spec, spec);
  for (const spec of ['evil@1.0.0', 'dsh-open-market@latest', 'dsh-open-market@^0.2.7', '/tmp/plugin', 'https://example.com/plugin.tgz', 'git+https://github.com/other/repo.git#' + 'a'.repeat(40)]) {
    assert.throws(() => selfUpdateTarget({spec}), /exact dsh-open-market/);
  }
  for (const registry of ['https://user:secret@registry.example/', 'https://registry.example/?token=x', 'file:///tmp/registry']) assert.throws(() => selfUpdateTarget({...target, registry}));
});

async function serve(t, manager, connection) {
  let route = createSelfUpdateHandler(manager, connection);
  const server = createServer((req, res) => {
    if (!route || req.url !== SELF_UPDATE_PATH) {res.writeHead(404); res.end(); return;}
    route(req, res).catch(error => {res.statusCode = 500; res.end(error.message);});
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {server.close(resolve); server.closeAllConnections();}));
  return {url: 'http://127.0.0.1:' + server.address().port + SELF_UPDATE_PATH, unregister() {route = undefined;}};
}
const admitted = {requestRejection: req => req.headers.cookie === 'session=test' ? undefined : 401};
const post = (url, body = target, extra = {}) => fetch(url, {method: 'POST', headers: {'content-type': 'application/json', cookie: 'session=test', ...extra}, body: JSON.stringify(body)});

test('the HTTP boundary requires Host admission, JSON and a bounded self-update target', async t => {
  const manager = nativeManager();
  const {url} = await serve(t, manager, admitted);
  assert.equal((await fetch(url)).status, 405);
  assert.equal((await post(url, target, {cookie: ''})).status, 401);
  assert.equal((await post(url, target, {'content-type': 'text/plain'})).status, 415);
  assert.equal((await post(url, target, {'content-type': 'application/jsonp'})).status, 415);
  assert.equal((await post(url, {spec: 'another-plugin@1.0.0'})).status, 400);
  assert.equal((await post(url, {...target, padding: 'x'.repeat(5000)})).status, 413);
  assert.deepEqual(manager.calls, []);
  assert.equal((await post(url)).status, 200);
  assert.equal(manager.installed, true);
  const missing = await serve(t, manager, {});
  assert.equal((await post(missing.url)).status, 503);
  const failed = await serve(t, manager, {requestRejection() {throw Error('unavailable');}});
  assert.equal((await post(failed.url)).status, 503);
  const forbidden = await serve(t, manager, {requestRejection: () => 403});
  assert.equal((await post(forbidden.url)).status, 403);
});

test('unregistering the plugin route and disconnecting its browser do not cancel the Host installation', async t => {
  const removed = gate(), proceed = gate(), installed = gate();
  const manager = nativeManager();
  const endpoint = await serve(t, manager, admitted);
  manager.onRemove = async () => {endpoint.unregister(); removed.resolve(); await proceed.promise;};
  const originalInstall = manager.installBundle;
  manager.installBundle = async function(...args) {const result = await originalInstall.apply(this, args); installed.resolve(); return result;};
  const controller = new AbortController();
  const request = fetch(endpoint.url, {method: 'POST', headers: {'content-type': 'application/json', cookie: 'session=test'}, body: JSON.stringify(target), signal: controller.signal}).catch(() => null);
  await removed.promise;
  controller.abort(); await request;
  assert.equal((await post(endpoint.url)).status, 404);
  proceed.resolve(); await installed.promise;
  assert.equal(manager.installed, true);
});
