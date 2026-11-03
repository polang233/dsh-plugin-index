import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {bundleUpdateTarget, originalTarget, runBundleUpdate, createBundleUpdateHandler} from './bundle-update.js';

const input = {name: 'demo', spec: 'demo@2.0.0', registry: 'https://registry.npmjs.org/'};
function manager(extra = {}) {
  return {
    installed: true, version: '1.0.0', enabled: false, source: 'demo@^1.0.0', calls: [],
    async listBundles() {return [{name: 'demo', installed: this.installed, version: this.version, source: this.source, enabled: this.enabled}];},
    async inspect(spec, options) {
      this.calls.push(['inspect', spec, options]);
      return this.installed ? {status: 'refused', problem: 'already-installed'}
        : {status: 'accepted', name: 'demo', version: spec.startsWith('demo@') ? spec.slice(5) : undefined, registry: options.registry};
    },
    async removeBundle(name) {this.calls.push(['remove', name]); this.installed = false; return {application: 'applied'};},
    async installBundle(spec, options) {
      this.calls.push(['install', spec, options]);
      if (spec === input.spec) return {application: 'failed', error: {code: 'operation-error', message: 'download failed'}};
      this.installed = true; this.version = '1.0.0'; this.enabled = options.enabled; this.source = spec;
      return {application: 'applied', bundle: 'demo'};
    },
    ...extra
  };
}

test('a failed replacement restores the exact original version and disabled selection', async () => {
  const host = manager();
  const result = await runBundleUpdate(host, input);
  assert.equal(result.ok, false);
  assert.equal(result.restored, true);
  assert.equal(host.installed, true);
  assert.equal(host.version, '1.0.0');
  assert.equal(host.enabled, false);
  const installs = host.calls.filter(x => x[0] === 'install');
  assert.deepEqual(installs.map(x => x[1]), ['demo@2.0.0', 'demo@1.0.0']);
  assert(installs.every(x => x[2].approvedBuilds === undefined));
});

test('successful replacements verify the installed version and keep the original selection', async () => {
  const host = manager({installBundle: async function(spec, options) {
    this.installed = true; this.version = spec.slice(5); this.source = spec; this.enabled = options.enabled;
    return {application: 'restart-required', bundle: 'demo'};
  }});
  assert.deepEqual(await runBundleUpdate(host, input), {ok: true, restart: true});
  assert.equal(host.version, '2.0.0');
  assert.equal(host.enabled, false);
});

test('a target that installed but failed to activate is removed before restoring the original', async () => {
  const host = manager(), install = host.installBundle;
  host.installBundle = async function(spec, options) {
    if (spec === input.spec) {this.installed = true; this.version = '2.0.0'; return {application: 'failed', bundle: 'demo', error: {code: 'operation-error'}};}
    return install.call(this, spec, options);
  };
  const answer = await runBundleUpdate(host, input);
  assert.equal(answer.restored, true);
  assert.equal(host.calls.filter(x => x[0] === 'remove').length, 2);
  assert.equal(host.version, '1.0.0');
});

test('preflight refusal and unknown original sources preserve the current package', async () => {
  const host = manager({inspect: async () => ({status: 'refused', problem: 'network', reason: 'offline'})});
  assert.equal((await runBundleUpdate(host, input)).error, 'offline');
  assert.equal(host.installed, true);
  assert.equal(host.calls.length, 0);
  for (const source of [undefined, 'demo@file:/private/project', 'demo@npm:another@1.0.0', 'https://example.com/latest.tgz', 'git+https://github.com/a/b.git#main']) {
    const unknown = manager({source});
    assert.equal((await runBundleUpdate(unknown, input)).code, 'restore-unavailable');
    assert.equal(unknown.installed, true);
    assert.equal(unknown.calls.length, 0);
  }
});

test('native update restoration is used when the Host supports it', async () => {
  const host = manager();
  host.listBundles = async () => [{name: 'demo', installed: true, version: '1.0.0', source: 'demo@1.0.0', enabled: false, updatable: true}];
  host.updateBundle = async (name, version, options) => {
    assert.equal(name, 'demo'); assert.equal(version, '2.0.0'); assert.equal(options.registry, input.registry);
    return {result: {application: 'failed', error: {code: 'operation-error'}}, restore: {application: 'restart-required'}};
  };
  const answer = await runBundleUpdate(host, input);
  assert.equal(answer.restored, true);
  assert.equal(answer.restoreRestart, true);
  assert.equal(host.calls.length, 0);
});

test('fixed Git restoration retains the original commit and directory', async () => {
  const source = 'git+https://github.com/a/demo.git#' + 'a'.repeat(40) + '&path:/plugin';
  const target = 'git+https://github.com/a/demo.git#' + 'b'.repeat(40) + '&path:/plugin';
  const host = manager({source});
  const install = host.installBundle;
  host.installBundle = async function(spec, options) {
    if (spec === target) {this.calls.push(['install', spec, options]); throw Error('cancelled');}
    return install.call(this, spec, options);
  };
  assert.equal((await runBundleUpdate(host, {name: 'demo', spec: target})).restored, true);
  assert.equal(host.calls.filter(x => x[0] === 'install').at(-1)[1], source);
});

test('approval requirements and failed restoration are reported without granting scripts', async () => {
  const host = manager({installBundle: async function(spec, options) {
    assert.equal(options.approvedBuilds, undefined);
    return spec === input.spec ? {application: 'failed', pendingBuilds: ['dependency']} : {application: 'failed', error: {code: 'operation-error'}};
  }});
  const result = await runBundleUpdate(host, input);
  assert.equal(result.code, 'install-needs-dialog');
  assert.equal(result.restored, false);
  assert.equal(result.restoreSpec, 'demo@1.0.0');
});

test('updates serialize on the Host and the lock is released after recovery', async () => {
  let resume, entered;
  const pause = new Promise(resolve => {resume = resolve;});
  const ready = new Promise(resolve => {entered = resolve;});
  const host = manager(), install = host.installBundle;
  host.installBundle = async function(spec, options) {if (spec === input.spec) {entered(); await pause;} return install.call(this, spec, options);};
  const first = runBundleUpdate(host, input);
  await ready;
  assert.equal((await runBundleUpdate(host, input)).code, 'update-busy');
  resume();
  assert.equal((await first).restored, true);
  assert.equal((await runBundleUpdate(host, input)).restored, true);
});

test('targets cannot select tags, aliases, arbitrary paths or credential URLs', () => {
  assert.equal(bundleUpdateTarget(input).version, '2.0.0');
  for (const spec of ['demo@latest', 'demo@^2.0.0', 'other@2.0.0', '/tmp/project', 'https://example.com/a.tgz', 'git+https://github.com/a/b.git#' + 'a'.repeat(40) + '&path:/../other']) assert.throws(() => bundleUpdateTarget({...input, spec}));
  assert.throws(() => bundleUpdateTarget({...input, registry: 'https://user:secret@example.com/'}));
  assert.equal(originalTarget({name: 'demo', version: '1.0.0', source: 'demo@latest'}).spec, 'demo@1.0.0');
});

test('the update HTTP boundary rejects unauthenticated and invalid requests before touching the manager', async t => {
  const host = manager();
  let connection = {requestRejection: req => req.headers.cookie === 'owner=yes' ? undefined : 401};
  const server = createServer((req, res) => createBundleUpdateHandler(host, connection)(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {server.close(resolve); server.closeAllConnections();}));
  const url = 'http://127.0.0.1:' + server.address().port;
  const post = (body, headers = {}) => fetch(url, {method: 'POST', headers: {'content-type': 'application/json', cookie: 'owner=yes', ...headers}, body: JSON.stringify(body)});
  assert.equal((await fetch(url)).status, 405);
  assert.equal((await post(input, {cookie: ''})).status, 401);
  assert.equal((await post(input, {'content-type': 'text/plain'})).status, 415);
  assert.equal((await post({...input, spec: 'demo@latest'})).status, 400);
  assert.equal((await post({...input, pad: 'x'.repeat(5000)})).status, 413);
  connection = {};
  assert.equal((await post(input)).status, 503);
  assert.equal(host.calls.length, 0);
});
