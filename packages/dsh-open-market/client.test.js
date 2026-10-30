import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

async function client() {
  let plugin;
  const window = {
    localStorage: {getItem: () => null, setItem() {}},
    setTimeout: () => 0, clearTimeout() {},
    __ModuleLoader__: {load: module => {
      plugin = module.factory(name => {
        if (name === 'react') return {createElement() {}};
        throw new Error('Optional module unavailable: ' + name);
      });
    }}
  };
  runInNewContext(await readFile(new URL('./client.js', import.meta.url), 'utf8'), {
    window, URL, crypto, document: {createElement: () => ({remove() {}}), head: {appendChild() {}}}
  });
  return plugin;
}

test('client starts without the optional market service and registers its tab when it arrives', async () => {
  const plugin = await client();
  const tabs = new Set();
  const injections = new Map();
  function context(disposers = []) {
    return {
      remote: {},
      locale: {register: () => () => {}, bind: () => key => key, resolveText: text => text},
      effect: setup => { const dispose = setup(); if (typeof dispose === 'function') disposers.push(dispose); },
      inject: (names, callback) => injections.set(names.join(','), callback),
      slots: {
        inject: (name, setup) => { const dispose = setup(); if (typeof dispose === 'function') disposers.push(dispose); },
        register: registration => {
          const key = registration.id ?? registration.key;
          tabs.add(key);
          return () => tabs.delete(key);
        }
      }
    };
  }
  const ctx = context();
  for (const service of plugin.inject) assert.ok(service in ctx, 'Startup must not wait for ' + service);
  plugin.apply(ctx);
  assert.ok(tabs.has('dsh-open-market'), 'Plugin settings remain available');
  assert.ok(!tabs.has('open-market'), 'No browsing tab calls an absent service');
  const activate = injections.get('remote.pluginMarket');
  assert.equal(typeof activate, 'function');
  const disposers = [];
  const scoped = context(disposers);
  scoped.remote.pluginMarket = {};
  activate(scoped);
  assert.ok(tabs.has('open-market'));
  disposers.reverse().forEach(dispose => dispose());
  assert.ok(!tabs.has('open-market'), 'The browsing tab follows the service lifecycle');
  assert.ok(tabs.has('dsh-open-market'), 'Settings survive market service removal');
});

const plain = value => JSON.parse(JSON.stringify(value));
const tick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));

function fakeIndexedDB(saved = new Map()) {
  const later = callback => setTimeout(callback, 0);
  const database = {
    createObjectStore() {},
    close() {},
    transaction() {
      const transaction = {
        objectStore: () => ({
          get(key) { const request = {result: saved.get(key)}; later(() => transaction.oncomplete?.()); return request; },
          put(value, key) { saved.set(key, value); later(() => transaction.oncomplete?.()); return {}; }
        })
      };
      return transaction;
    }
  };
  return {saved, open() { const request = {result: database}; later(() => request.onsuccess?.()); return request; }};
}

async function marketClient({indexedDB, search, storage = {}} = {}) {
  let plugin;
  const stored = new Map(Object.entries(storage));
  const window = {
    indexedDB,
    setTimeout: (callback, ms) => { const timer = setTimeout(callback, ms); timer.unref?.(); return timer; },
    localStorage: {getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value)},
    __ModuleLoader__: {load: module => {
      plugin = module.factory(name => {
        if (name === 'react') return {createElement() {}};
        throw new Error('Optional module unavailable: ' + name);
      });
    }}
  };
  runInNewContext(await readFile(new URL('./client.js', import.meta.url), 'utf8'), {
    window, URL, crypto, document: {createElement: () => ({remove() {}}), head: {appendChild() {}}}
  });
  const injections = new Map();
  const context = extra => ({
    remote: {}, locale: {register: () => () => {}, bind: () => key => key, resolveText: text => text},
    effect() {}, inject: (names, callback) => injections.set(names.join(','), callback),
    slots: {inject: (name, setup) => setup(), register: () => () => {}}, ...extra
  });
  plugin.apply(context());
  if (search) injections.get('remote.pluginMarket')(context({remote: {pluginMarket: {search}}}));
  return plugin;
}

const entry = (name, status = 'not-installed', extra = {}) => ({name, defaultVersion: '1.2.0', versions: [{version: '1.2.0'}], installation: {status}, ...extra});
const snapshot = (internals, extra = {}) => ({schema: internals.CACHE_SCHEMA, index: internals.INDEX_URL, entries: [entry('a')], metadata: {}, syncedAt: Date.now(), ...extra});
const page = (entries, nextOffset = null, fetchedAt = 1000) => ({ok: true, value: {entries, metadata: {title: 'x'}, nextOffset, fetchedAt}});
const noManager = () => undefined;

test('settings keep the old switch and refuse values of the wrong kind', async () => {
  const {internals: {normalizeSettings}} = await client();
  assert.equal(normalizeSettings({hideInstalled: true}).showInstalled, false);
  assert.equal(normalizeSettings({hideInstalled: true, showInstalled: true}).showInstalled, true);
  assert.equal(normalizeSettings({}).showInstalled, true);
  assert.equal(normalizeSettings({registry: 'nope'}).registry, 'index');
  assert.equal(normalizeSettings({likes: 'yes'}).likes, true);
  assert.equal(normalizeSettings({customRegistry: 7}).customRegistry, '');
});

test('a registry address is an http(s) URL without credentials, in pnpm form', async () => {
  const {internals: {registryUrl}} = await client();
  assert.equal(registryUrl(' https://npm.example.com '), 'https://npm.example.com/');
  assert.equal(registryUrl('http://10.0.0.1:4873/npm'), 'http://10.0.0.1:4873/npm/');
  for (const value of ['', 'ftp://x.test/', 'https://u:p@x.test/', 'https://x.test/?a=1', 'not a url']) assert.equal(registryUrl(value), null);
});

test('the download choice changes npm installs and leaves Git specs alone', async () => {
  const {internals: {installTarget}} = await client();
  const npm = {spec: 'a@1.0.0', registry: 'https://registry.npmjs.org/', title: 'A'};
  const git = {spec: 'git+https://github.com/a/b.git#abc', title: 'B'};
  const choose = (registry, customRegistry = '') => ({registry, customRegistry});
  assert.equal(installTarget(npm, choose('index')).registry, npm.registry);
  assert.equal(plain(installTarget(npm, choose('npmmirror'))).registry, 'https://registry.npmmirror.com/');
  assert.equal('registry' in installTarget(npm, choose('dsh')), false);
  assert.equal(installTarget(npm, choose('custom', 'https://npm.example.com')).registry, 'https://npm.example.com/');
  assert.equal(installTarget(npm, choose('custom', 'bad')).registry, npm.registry);
  for (const choice of ['index', 'dsh', 'npmmirror', 'custom']) assert.deepEqual(plain(installTarget(git, choose(choice, 'https://npm.example.com'))), git);
});

test('refreshes wait for the interval and back off after a failed attempt', async () => {
  const {internals: {needsRefresh, REFRESH_INTERVAL}} = await client();
  const now = 10 * REFRESH_INTERVAL;
  assert.equal(needsRefresh({syncedAt: now - 1000, attemptedAt: 0}, now), false);
  assert.equal(needsRefresh({syncedAt: now - REFRESH_INTERVAL, attemptedAt: 0}, now), true);
  assert.equal(needsRefresh({syncedAt: now - REFRESH_INTERVAL, attemptedAt: now - 1000}, now), false);
});

test('a restored catalog takes its installation status from the bundles', async () => {
  const {internals: {withInstallation}} = await client();
  const entries = [entry('a'), entry('b', 'installed', {installation: {status: 'installed', installedVersion: '1.2.0'}}), entry('c'), entry('d'), entry('e')];
  const result = withInstallation(entries, [
    {name: 'a', installed: true, version: '1.2.0'},
    {name: 'c', installed: true, version: '1.1.0'},
    {name: 'd', installed: true, version: '9.0.0'}
  ]);
  assert.deepEqual(plain(result.map(item => item.installation)), [
    {status: 'installed', installedVersion: '1.2.0'}, {status: 'not-installed'},
    {status: 'update-available', installedVersion: '1.1.0'}, {status: 'different-version', installedVersion: '9.0.0'}, {status: 'not-installed'}
  ]);
  const same = [entry('a')];
  assert.equal(withInstallation(same, []), same, 'No change keeps the array, so nothing re-renders');
});

test('a fresh cache opens without asking the market', async () => {
  const indexedDB = fakeIndexedDB();
  let searches = 0;
  const plugin = await marketClient({indexedDB, search: async () => { searches++; return page([entry('new')]); }});
  const {internals} = plugin;
  indexedDB.saved.set('market', snapshot(internals));
  const bundles = {listBundles: async () => ({ok: true, value: [{name: 'a', installed: true, version: '1.2.0'}]})};
  await internals.enterMarket(() => bundles);
  await tick();
  assert.equal(searches, 0);
  assert.equal(internals.getMarket().status, 'ready');
  assert.equal(internals.getMarket().entries[0].installation.status, 'installed');
});

test('a stale cache shows first and refreshes behind it', async () => {
  const indexedDB = fakeIndexedDB();
  let answer;
  const plugin = await marketClient({indexedDB, search: () => new Promise(resolve => { answer = resolve; })});
  const {internals} = plugin;
  indexedDB.saved.set('market', snapshot(internals, {syncedAt: Date.now() - internals.REFRESH_INTERVAL - 1}));
  await internals.enterMarket(noManager);
  assert.equal(internals.getMarket().status, 'ready', 'The cached catalog is up before the read returns');
  assert.equal(internals.getMarket().syncing, true);
  assert.equal(internals.getMarket().entries[0].name, 'a');
  answer(page([entry('b')], null, Date.now()));
  await tick();
  assert.equal(internals.getMarket().entries[0].name, 'b');
  assert.equal(internals.getMarket().syncing, false);
  assert.equal(indexedDB.saved.get('market').entries[0].name, 'b');
});

test('a failed refresh keeps the catalog on screen', async () => {
  const indexedDB = fakeIndexedDB();
  const plugin = await marketClient({indexedDB, search: async () => ({ok: false, error: {code: 'plugin-market/fetch-failed'}})});
  const {internals} = plugin;
  const stale = snapshot(internals, {syncedAt: Date.now() - internals.REFRESH_INTERVAL - 1});
  indexedDB.saved.set('market', stale);
  await internals.enterMarket(noManager);
  await tick();
  assert.equal(internals.getMarket().status, 'ready');
  assert.equal(internals.getMarket().syncFailed, true);
  assert.equal(internals.getMarket().entries[0].name, 'a');
  assert.equal(indexedDB.saved.get('market'), stale, 'The saved copy stays too');
});

test('a throwing market service never loses cached data', async () => {
  const indexedDB = fakeIndexedDB();
  const plugin = await marketClient({indexedDB, search: async () => { throw new Error('gone'); }});
  const {internals} = plugin;
  indexedDB.saved.set('market', snapshot(internals, {syncedAt: 0}));
  await internals.enterMarket(noManager);
  await tick();
  assert.equal(internals.getMarket().entries.length, 1);
  assert.equal(internals.getMarket().status, 'ready');
});

test('without a usable cache the market loads as before, and a missing source is reported', async () => {
  for (const saved of [undefined, {schema: 0, entries: [entry('a')]}, {schema: 1, index: 'https://other.test/', entries: [entry('a')], syncedAt: 1}]) {
    const indexedDB = fakeIndexedDB();
    const plugin = await marketClient({indexedDB, search: async () => page([entry('fresh')])});
    if (saved) indexedDB.saved.set('market', saved);
    await plugin.internals.enterMarket(noManager);
    await tick();
    assert.equal(plugin.internals.getMarket().entries[0].name, 'fresh');
  }
  const plugin = await marketClient({search: async () => ({ok: false, error: {code: 'plugin-market/unknown-index'}})});
  await plugin.internals.enterMarket(noManager);
  await tick();
  assert.equal(plugin.internals.getMarket().status, 'missing', 'Also without IndexedDB');
});

test('a manual sync forces one read and later pages stay on that document', async () => {
  const queries = [];
  const plugin = await marketClient({indexedDB: fakeIndexedDB(), search: async (url, query) => {
    queries.push(plain(query));
    return query.offset === 0 ? page([entry('a')], 100, 777) : page([entry('b')], null, 777);
  }});
  await plugin.internals.syncMarket({refresh: true});
  assert.equal(queries[0].refresh, true);
  assert.equal(queries[1].refresh, undefined);
  assert.equal(queries[1].fetchedAt, 777);
  assert.equal(plugin.internals.getMarket().syncedAt, 777);
  assert.equal(plugin.internals.getMarket().entries.length, 2);
});

test('a change during a read queues one more read', async () => {
  let searches = 0;
  const plugin = await marketClient({indexedDB: fakeIndexedDB(), search: async () => { searches++; await tick(); return page([entry('a')]); }});
  const {syncMarket} = plugin.internals;
  const first = syncMarket();
  syncMarket({again: true});
  syncMarket({again: true});
  await first;
  await tick(20);
  assert.equal(searches, 2);
});

test('rows bleed no further than the narrower page gutter', async () => {
  const {internals: {bleedFor}} = await client();
  assert.equal(bleedFor(48, 48), 40);
  assert.equal(bleedFor(28.8, 28.8), 28);
  assert.equal(bleedFor(48, 12), 12);
  assert.equal(bleedFor(0, 0), 8);
});

test('the catalog sorts differ, and each falls back on the recommended order', async () => {
  const {internals: {sortCatalog}} = await client();
  const plugin = (name, recommended, extra = {}, labels = []) => ({name, versions: [], metadata: {labels, sortKeys: {recommended, ...extra}}});
  const entries = [plugin('a', 3), plugin('b', 2, {'github-stars': 50, 'stars-week': 2}), plugin('c', 1, {'github-stars': 90, 'stars-week': 1}, ['trending'])];
  const names = (sort, counts = {}) => Array.from(sortCatalog(entries, sort, counts), entry => entry.name);
  assert.deepEqual(names('recommended'), ['a', 'b', 'c']);
  assert.deepEqual(names('stars'), ['c', 'b', 'a']);
  assert.deepEqual(names('trending'), ['c', 'b', 'a']);
  assert.deepEqual(names('popular', {c: 4}), ['c', 'a', 'b']);
  assert.deepEqual(names('newest'), ['a', 'b', 'c']);
  assert.equal(entries[0].name, 'a');
});

test('the sidebar page appears on its own only where the tab cannot', async () => {
  const {internals: {sidebarWanted, normalizeSettings}} = await client();
  assert.equal(sidebarWanted('auto', {tab: false}), true);
  assert.equal(sidebarWanted('auto', {tab: true}), false);
  assert.equal(sidebarWanted('on', {tab: true}), true);
  assert.equal(sidebarWanted('off', {tab: false}), false);
  assert.equal(normalizeSettings({sidebarMarket: 'sideways'}).sidebarMarket, 'auto');
  assert.equal(normalizeSettings({sidebarMarket: 'on'}).sidebarMarket, 'on');
});

test('an index plugin gets the install targets and default version DSH would give it', async () => {
  const {internals: {listingOf}} = await client();
  const npm = listingOf({name: 'a', versions: [
    {version: '2.0.0-rc.1', source: {type: 'npm', registry: 'https://registry.npmjs.org/'}},
    {version: '1.0.0', source: {type: 'npm', registry: 'https://registry.npmjs.org/'}}]});
  assert.equal(npm.defaultVersion, '1.0.0');
  assert.equal(npm.versions[1].install.spec, 'a@1.0.0');
  assert.equal(npm.versions[1].install.registry, 'https://registry.npmjs.org/');
  const git = listingOf({name: 'b', versions: [{version: '1.0.0', source: {type: 'git', url: 'https://github.com/x/y', commit: 'abc', path: 'pkg'}}]});
  assert.equal(git.versions[0].install.spec, 'git+https://github.com/x/y.git#abc&path:/pkg');
  assert.equal(git.installation.status, 'not-installed');
});

test('a sidebar install passes on refusals, pending scripts and restarts', async () => {
  const {internals: {installDirectly}} = await client();
  const t = key => key;
  const service = (inspect, install) => () => ({inspect: async () => inspect, installBundle: async (spec, options) => ({...install, seen: {spec, options}})});
  const accepted = {ok: true, value: {status: 'ok', registry: 'https://r/'}};
  const refused = await installDirectly(service({ok: true, value: {status: 'refused', reason: 'no'}}, {}), {spec: 'a@1'}, t);
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'no');
  const scripts = await installDirectly(service(accepted, {ok: true, value: {application: 'failed', pendingBuilds: ['x']}}), {spec: 'a@1'}, t);
  assert.equal(scripts.error, 'installNeedsDialog');
  const restart = await installDirectly(service(accepted, {ok: true, value: {application: 'restart-required'}}), {spec: 'a@1'}, t);
  assert.equal(restart.ok, true);
  assert.equal(restart.restart, true);
  assert.equal((await installDirectly(() => undefined, {spec: 'a@1'}, t)).error, 'updateUnavailable');
});
