import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile, readFile, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import semver from 'semver';
import {createDiagnostics} from './diagnostics.js';

async function fixture(t, hmr) {
  const scratch = fileURLToPath(new URL('../../.local/', import.meta.url));
  await mkdir(scratch, {recursive: true});
  const dir = await mkdtemp(join(scratch, 'diagnostics-test-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const order = ['core', 'beta', 'web', 'alpha', 'gamma'];
  const profile = {dir, home: dir, name: 'preview', installAnchor: join(dir, 'package.json')};
  const manifest = {private: true, dsh: {profile: {bundles: order}}, dependencies: {alpha: 'file:alpha', beta: 'file:beta', gamma: 'file:gamma'}, custom: 'preserve'};
  await writeFile(join(dir, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(join(dir, '.env'), 'API_KEY=PRIVATE_TEST_VALUE');
  const packages = {
    core: {name: 'core', version: '0.2.2-rc.1'}, web: {name: 'web', version: '0.2.2-rc.1'},
    beta: {name: 'beta', version: '1.0.0', engines: {dsh: '^0.2.0'}},
    alpha: {name: 'alpha', version: '1.1.0', dependencies: {beta: '^1.0.0', absent: '^1.0.0'}, scripts: {postinstall: 'example'}, engines: {dsh: '^0.1.0'}},
    gamma: {name: 'gamma', version: '1.0.0'},
  };
  for (const [name, pkg] of Object.entries(packages)) {
    const root = join(dir, 'node_modules', name); await mkdir(root, {recursive: true});
    await writeFile(join(root, 'package.json'), JSON.stringify(pkg));
  }
  const bundles = order.map(name => ({name, version: packages[name].version, enabled: true,
    installed: !['core', 'web'].includes(name), official: ['core', 'web'].includes(name),
    availability: ['core', 'web'].includes(name) ? 'installation' : 'profile', rows: [{entryId: name}]}));
  const plugins = order.map(entryId => ({entryId, enabled: true, fiberPhase: entryId === 'alpha' ? 'failed' : 'active'}));
  let locks = 0;
  const runtime = {resolveBundleDir: (_bin, name) => join(dir, 'node_modules', name), getDshRuntimeVersion: () => '0.2.2-rc.1',
    readProfileVersionExemptions: () => [], satisfies: semver.satisfies,
    evaluatePluginCompatibility: pkg => pkg.name === 'alpha' ? {exempted: false, requirements: {'engines.dsh': pkg.engines.dsh}} : undefined,
    withFileLock: async (_path, operation) => {locks++; return operation();},
    writeFileAtomic: writeFile, composeEntries: () => [], readProfilePatches: () => [],
  };
  const opened = [];
  const diagnostics = createDiagnostics({profile, get: key => key === 'hmr' ? hmr : undefined, runtime, opener: path => {opened.push(path);}});
  return {dir, profile, bundles, plugins, diagnostics, opened, get locks() {return locks;}};
}

test('reports local paths, actual load state, direct dependencies and declared compatibility without reading credentials', async t => {
  const f = await fixture(t);
  f.bundles.push({name: 'offered-only', installed: false, availability: 'missing', error: {code: 'not-bundle'}, rows: []});
  const report = await f.diagnostics.snapshot(f.bundles, f.plugins);
  assert.equal(report.available, true);
  assert.deepEqual(report.customOrder, ['beta', 'alpha', 'gamma']);
  assert.equal(report.summary.custom, 3); assert.equal(report.summary.loadedCustom, 2);
  assert.equal(report.summary.errors, 1); assert.equal(report.summary.risks, 1);
  assert.equal(report.bundles.some(item => item.name === 'offered-only'), false, 'Uninstalled catalog offers are not loaded plugins');
  const alpha = report.bundles.find(item => item.name === 'alpha');
  assert.equal(alpha.order, 4); assert.deepEqual(alpha.runtimeOrder, [4]);
  assert.equal(alpha.compatibility.status, 'incompatible');
  assert.equal(report.bundles.find(item => item.name === 'beta').compatibility.status, 'compatible');
  assert.equal(report.bundles.find(item => item.name === 'gamma').compatibility.status, 'undeclared');
  assert.equal(alpha.dependencies.find(dep => dep.name === 'beta').status, 'satisfied');
  assert.equal(alpha.dependencies.find(dep => dep.name === 'absent').status, 'missing');
  assert(report.bundles.find(item => item.name === 'beta').dependents.includes('alpha'));
  assert.equal(alpha.configuration.path, f.dir);
  assert.equal(JSON.stringify(report).includes('PRIVATE_TEST_VALUE'), false);
});

test('directory shortcuts only open locations derived from current installed metadata', async t => {
  const f = await fixture(t);
  assert.equal((await f.diagnostics.open('C:/arbitrary', f.bundles, f.plugins)).code, 'directory-unavailable');
  assert.equal((await f.diagnostics.open('profile', f.bundles, f.plugins)).ok, true);
  assert.deepEqual(f.opened, [f.dir]);
});

test('an installed import-only dependency with a private manifest is not reported missing', async t => {
  const f = await fixture(t);
  const file = join(f.dir, 'node_modules', 'beta', 'package.json');
  const pkg = JSON.parse(await readFile(file, 'utf8'));
  pkg.exports = {import: './index.js'};
  await writeFile(file, JSON.stringify(pkg));
  const report = await f.diagnostics.snapshot(f.bundles, f.plugins);
  const dependency = report.bundles.find(item => item.name === 'alpha').dependencies.find(dep => dep.name === 'beta');
  assert.equal(dependency.status, 'satisfied'); assert.equal(dependency.version, '1.0.0');
  assert.equal(dependency.directory.path, join(f.dir, 'node_modules', 'beta'));
});

test('reorders only custom slots under the native file lock and preserves unrelated profile metadata', async t => {
  const f = await fixture(t);
  const before = await f.diagnostics.snapshot(f.bundles, f.plugins);
  const answer = await f.diagnostics.reorder({order: ['beta', 'gamma', 'alpha'], revision: before.revision}, f.bundles, f.plugins);
  assert.equal(answer.ok, true); assert.equal(answer.restart, true); assert.equal(f.locks, 1);
  const manifest = JSON.parse(await readFile(join(f.dir, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dsh.profile.bundles, ['core', 'beta', 'web', 'gamma', 'alpha']);
  assert.equal(manifest.custom, 'preserve');
  assert.equal((await f.diagnostics.reorder({order: ['beta', 'alpha', 'gamma'], revision: before.revision}, f.bundles, f.plugins)).code, 'installation-changed');
});

test('system moves, omitted plugins and inverted dependency order are refused before writing', async t => {
  const f = await fixture(t), before = await f.diagnostics.snapshot(f.bundles, f.plugins);
  assert.deepEqual(await f.diagnostics.reorder({order: ['alpha', 'beta', 'gamma'], revision: before.revision}, f.bundles, f.plugins),
    {ok: false, code: 'dependency-order', error: 'alpha', dependency: 'beta'});
  assert.equal((await f.diagnostics.reorder({order: ['core', 'alpha', 'gamma'], revision: before.revision}, f.bundles, f.plugins)).code, 'invalid-load-order');
  assert.equal(f.locks, 0);
});

test('a failed native reconciliation restores the exact previous profile and reconciles its original order', async t => {
  let calls = 0, exclusive = false;
  const f = await fixture(t, {runExclusive: async task => {exclusive = true; try {return await task();} finally {exclusive = false;}},
    reconcileProfile: async () => {assert.equal(exclusive, true, 'Reconciliation must be inside the native HMR transaction');
      if (++calls === 1) throw Error('Bad composition'); return {warnings: [], pending: []};}});
  const original = await readFile(join(f.dir, 'package.json'), 'utf8');
  const report = await f.diagnostics.snapshot(f.bundles, f.plugins);
  const answer = await f.diagnostics.reorder({order: ['beta', 'gamma', 'alpha'], revision: report.revision}, f.bundles, f.plugins);
  assert.equal(answer.code, 'load-order-failed'); assert.equal(answer.restored, true);
  assert.equal(calls, 2); assert.equal(await readFile(join(f.dir, 'package.json'), 'utf8'), original);
});
