import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

async function client({indexedDB} = {}) {
  let plugin;
  const window = {
    indexedDB,
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
    window, URL, crypto, AbortSignal, document: {createElement: () => ({remove() {}}), head: {appendChild() {}}}
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

function fakeIndexedDB(saved = new Map(), onWrite = () => {}) {
  const later = callback => setTimeout(callback, 0);
  const database = {
    createObjectStore() {},
    close() {},
    transaction() {
      const transaction = {
        objectStore: () => ({
          get(key) { const request = {result: saved.get(key)}; later(() => transaction.oncomplete?.()); return request; },
          put(value, key) { saved.set(key, value); onWrite(); later(() => transaction.oncomplete?.()); return {}; }
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
  return Object.assign(plugin, { activateService: (name, remote) => injections.get(name)(context({ remote })) });
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

test('cached update status follows prerelease ordering and ignores build metadata', async () => {
  const {internals: {withInstallation}} = await client();
  for (const [installed, offered, update] of [
    ['0.2.7-preview.1', '0.2.7', true], ['0.2.7', '0.2.7-preview.1', false],
    ['0.2.7-alpha.9', '0.2.7-alpha.10', true], ['0.2.7-alpha', '0.2.7-alpha.1', true],
    ['0.2.7-1', '0.2.7-alpha', true], ['0.2.7-beta', '0.2.7-alpha', false],
    ['0.2.7+build.1', '0.2.7+build.2', false], ['0.2.7+build.9', '0.2.8', true],
    ['0.2.7-alpha.9007199254740992', '0.2.7-alpha.9007199254740993', true],
    ['not-semver', '0.2.7', false]
  ]) {
    const [result] = withInstallation([{name: 'demo', defaultVersion: offered, installation: {status: 'not-installed'}}], [{name: 'demo', installed: true, version: installed}]);
    assert.equal(result.installation.status === 'update-available', update, `${installed} → ${offered}`);
  }
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

test('a manager that arrives after cached data updates installation without reopening the tab', async () => {
  const indexedDB = fakeIndexedDB();
  const plugin = await marketClient({indexedDB});
  indexedDB.saved.set('market', snapshot(plugin.internals));
  await plugin.internals.enterMarket(noManager);
  assert.equal(plugin.internals.getMarket().entries[0].installation.status, 'not-installed');
  plugin.activateService('remote.pluginManager', {pluginManager: {
    listBundles: async () => ({ok: true, value: [{name: 'a', installed: true, version: '1.1.0'}]})
  }});
  await tick();
  assert.equal(plugin.internals.getMarket().entries[0].installation.status, 'update-available');
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

const npmRelease = (version, extra = {}) => ({name: '@demo/plugin', version, dsh: {bundle: {patch: './cordis.patch.yml'}}, ...extra});
const history = () => ({name: '@demo/plugin', versions: {
  '1.0.0': npmRelease('1.0.0', {engines: {dsh: '>=0.1.7 <0.2.0'}}),
  '2.0.0-beta.1': npmRelease('2.0.0-beta.1', {peerDependencies: {'@deepseek-ai/dsh-tools': '^0.2.1-rc.5', '@deepseek-ai/dsh-client': '^0.2.1-rc.5'}})
}, time: {'1.0.0': '2026-01-01T00:00:00Z', '2.0.0-beta.1': '2026-02-01T00:00:00Z'}});

test('other versions use publisher metadata without inheriting the listed version or review', async () => {
  const {internals: {npmVersions, versionChoices, listingOf}} = await client();
  const manifest = history();
  Object.assign(manifest.versions, {
    latest: npmRelease('latest'),
    '3.0.0': npmRelease('3.0.0', {deprecated: 'removed'}),
    '4.0.0': npmRelease('4.0.0', {dsh: {}}),
    '5.0.0': npmRelease('5.0.0', {name: 'someone-else'}),
    '6.0.0': npmRelease('wrong-version')
  });
  const versions = npmVersions('@demo/plugin', manifest);
  assert.deepEqual(plain(versions.map(x => [x.version, x.requirements])), [
    ['2.0.0-beta.1', ['^0.2.1-rc.5']], ['1.0.0', ['>=0.1.7 <0.2.0']]
  ]);
  assert.throws(() => npmVersions('another-package', manifest), /Invalid npm/);
  const indexed = listingOf({name: '@demo/plugin', metadata: {labels: ['verified']}, versions: [
    {version: '1.0.0', source: {type: 'npm', registry: 'https://registry.npmjs.org/'}, engines: {dsh: 'index-range'}}]});
  indexed.versions[0].compatibility = {compatible: false};
  const before = JSON.stringify(indexed);
  const choices = versionChoices(indexed, versions, 'https://registry.npmjs.org/');
  assert.equal(choices.length, 2, 'The listed release is not duplicated');
  assert.equal(choices[0].requirements[0], 'index-range', 'Registry data does not override the verified index entry');
  assert.equal(choices[0].compatibility.compatible, false);
  assert.equal(choices[1].listed, false);
  assert.equal(choices[1].metadata, undefined, 'The package badge is not assigned to a registry version');
  assert.equal(choices[1].compatibility, undefined, 'No invented compatibility verdict');
  assert.equal(choices[1].install.spec, '@demo/plugin@2.0.0-beta.1');
  assert.equal(JSON.stringify(indexed), before);
});

test('version lookups respect the download source and never reinterpret a Git package as npm', async () => {
  const {internals: {npmVersionRegistry, normalizeSettings, versionCommand}} = await client();
  const entry = {name: '@demo/plugin', versions: [{version: '1.2.0', source: {type: 'npm', registry: 'https://registry.npmjs.org/'}}]};
  assert.equal(npmVersionRegistry(entry, normalizeSettings({registry: 'npmmirror'})), 'https://registry.npmmirror.com/');
  assert.equal(npmVersionRegistry(entry, normalizeSettings({registry: 'custom', customRegistry: 'https://packages.example.com/npm'})), 'https://packages.example.com/npm/');
  assert.equal(npmVersionRegistry(entry, normalizeSettings({registry: 'dsh'})), 'https://registry.npmjs.org/');
  assert.equal(versionCommand(entry, entry.versions[0]), 'dsh plugin --profile desktop add @demo/plugin@1.2.0');
  const git = {version: '1.0.0', source: {type: 'git', url: 'https://github.com/owner/repo', commit: 'abc', path: 'plugins/a'}};
  assert.equal(npmVersionRegistry({versions: [git]}, normalizeSettings({})), null);
  assert.equal(versionCommand(entry, git), 'dsh plugin --profile desktop add "git+https://github.com/owner/repo.git#abc&path:/plugins/a"');
});

test('version metadata loads only when called, deduplicates in-flight reads, and persists projected data', async () => {
  let started, saved;
  const fetchStarted = new Promise(resolve => { started = resolve; });
  const persisted = new Promise(resolve => { saved = resolve; });
  const indexedDB = fakeIndexedDB(new Map(), () => saved());
  const {internals: {loadNpmVersions, VERSION_CACHE_TTL}} = await client({indexedDB});
  let reads = 0, release;
  const fetchImpl = async (url, options) => {
    reads++;
    assert.equal(url, 'https://registry.npmjs.org/%40demo%2Fplugin');
    assert.equal(options.credentials, 'omit');
    started();
    await new Promise(resolve => { release = resolve; });
    return {ok: true, json: async () => history()};
  };
  assert.equal(reads, 0);
  const options = {fetchImpl, now: 100000};
  const first = loadNpmVersions('@demo/plugin', 'https://registry.npmjs.org/', options);
  const second = loadNpmVersions('@demo/plugin', 'https://registry.npmjs.org/', options);
  await fetchStarted;
  assert.equal(reads, 1);
  release();
  assert.deepEqual(plain(await first), plain(await second));
  await persisted;
  await loadNpmVersions('@demo/plugin', 'https://registry.npmjs.org/', options);
  assert.equal(reads, 1, 'The in-memory cache is reused');
  const record = [...indexedDB.saved.values()][0];
  assert.equal(record.versions[0].version, '2.0.0-beta.1');
  assert.equal(record.versions[0].dsh, undefined, 'Only the projected version fields are stored');
  const reopened = await client({indexedDB});
  await reopened.internals.loadNpmVersions('@demo/plugin', 'https://registry.npmjs.org/', {now: 100001, fetchImpl: () => {throw Error('cache missed');}});
  const expired = loadNpmVersions('@demo/plugin', 'https://registry.npmjs.org/', {now: 100000 + VERSION_CACHE_TTL, fetchImpl: async () => {
    reads++; return {ok: true, json: async () => history()};
  }});
  await expired;
  assert.equal(reads, 2, 'Expired data is read again');
});

test('a failed version request can retry, and distinct registries do not share cached data', async () => {
  const {internals: {loadNpmVersions}} = await client();
  await assert.rejects(loadNpmVersions('@demo/plugin', 'https://registry.npmjs.org/', {
    fetchImpl: async () => ({ok: false, status: 503})
  }), /HTTP 503/);
  await assert.rejects(loadNpmVersions('@demo/plugin', 'https://registry.npmjs.org/', {
    fetchImpl: async () => ({ok: true, json: async () => ({name: 'different', versions: {}})})
  }), /Invalid npm/);
  const fetchImpl = async () => ({ok: true, json: async () => history()});
  assert.equal((await loadNpmVersions('@demo/plugin', 'https://registry.npmjs.org/', {fetchImpl})).length, 2);
  let mirrorRead = false;
  await loadNpmVersions('@demo/plugin', 'https://mirror.example/', {fetchImpl: async () => {mirrorRead = true; return fetchImpl();}});
  assert.equal(mirrorRead, true);
  await assert.rejects(loadNpmVersions('../private', 'https://registry.npmjs.org/', {fetchImpl}), /Invalid npm package source/);
});

test('choosing another version installs its exact target, and a failed removal keeps the current installation', async () => {
  const {internals: {installVersion}} = await client();
  const entry = {name: 'demo', installation: {status: 'installed', installedVersion: '2.0.0'}};
  const version = {version: '1.0.0-beta.2', source: {type: 'npm', registry: 'https://registry.npmjs.org/'}};
  const actions = [], phases = [];
  const options = {t: key => key, title: 'Demo', install: async target => {actions.push(target); return {ok: true};},
    manager: () => ({removeBundle: async name => {actions.push(name); return {ok: true, value: {}};}}), onPhase: phase => phases.push(phase)};
  await installVersion(entry, version, options);
  assert.equal(actions[0], 'demo');
  assert.equal(actions[1].spec, 'demo@1.0.0-beta.2');
  assert.equal(actions[1].version, '1.0.0-beta.2');
  assert.equal(actions[1].title, 'Demo');
  assert.deepEqual(phases, ['updating', 'busy']);
  const answer = await installVersion(entry, version, {...options, manager: () => ({removeBundle: async () => ({ok: true, value: {error: {code: 'stop-profile'}}})})});
  assert.equal(answer.error, 'updateRestart');
  assert.equal(actions.length, 2, 'No install follows a refusal to remove');
  const provided = await installVersion({...entry, installation: {status: 'provided'}}, version, options);
  assert.equal(provided.error, 'providedVersion');
  await installVersion({...entry, installation: {status: 'not-installed'}}, version, {...options, manager: () => {throw Error('unexpected removal');}});
  assert.equal(actions.length, 3);
});

test('self-update is handed to the Host before removing the client that started it', async () => {
  const {internals: {installVersion, installDirectly}} = await client();
  const calls = [];
  let service = {removeBundle: async () => {calls.push('client-remove'); service = undefined; return {ok: true, value: {}};}};
  const entry = {name: 'dsh-open-market', installation: {status: 'installed', installedVersion: '0.2.6'}};
  const version = {version: '0.2.7', source: {type: 'npm', registry: 'https://registry.npmjs.org/'}};
  const answer = await installVersion(entry, version, {
    t: key => key, manager: () => service, install: target => installDirectly(() => service, target, key => key),
    selfUpdate: async target => {calls.push(target.spec); return {ok: true, restart: true};}
  });
  assert.equal(answer.ok, true);
  assert.deepEqual(calls, ['dsh-open-market@0.2.7'], 'The client must never uninstall its own execution context');
});

test('self-update uses the authenticated local endpoint and reports unavailable, rejected and lost requests', async () => {
  const {internals: {requestSelfUpdate}} = await client();
  const t = key => key;
  const target = {spec: 'dsh-open-market@0.2.7', version: '0.2.7', registry: 'https://mirror.example/'};
  const success = await requestSelfUpdate(target, t, {fetchImpl: async (url, options) => {
    assert.equal(url, 'dsh-open-market/self-update');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), target);
    assert.equal(options.signal, undefined, 'The update must not be tied to the tab lifecycle');
    return {ok: true, json: async () => ({ok: true, restart: true})};
  }});
  assert.equal(success.restart, true);
  for (const status of [404, 503]) assert.equal((await requestSelfUpdate(target, t, {fetchImpl: async () => ({ok: false, status})})).error, 'selfUpdateUnavailable');
  for (const status of [401, 403]) assert.equal((await requestSelfUpdate(target, t, {fetchImpl: async () => ({ok: false, status})})).error, 'selfUpdateUnauthorized');
  assert.equal((await requestSelfUpdate(target, t, {fetchImpl: async () => {throw Error('connection lost');}})).error, 'selfUpdateConnectionLost');
  assert.equal((await requestSelfUpdate(target, t, {fetchImpl: async () => ({ok: true, json: async () => ({})})})).error, 'selfUpdateConnectionLost');
  assert.equal((await requestSelfUpdate(target, t, {fetchImpl: async () => ({ok: true, json: async () => ({ok: false, code: 'stop-profile', error: 'Stop the profile'})})})).error, 'updateRestart');
});
