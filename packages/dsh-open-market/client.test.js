import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

async function client({indexedDB, stored = new Map(), fetchImpl = async (url, options) => ({
  ok: true, json: async () => ({name: JSON.parse(options.body).name, likes: 1, counted: true})
}), clock = Date, react = {createElement() {}}, windowOverrides = {}, profileState = {schema: 1}, profileFetch} = {}) {
  let plugin;
  const window = {
    indexedDB,
    localStorage: {getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value)},
    setTimeout: () => 0, clearTimeout() {},
    __ModuleLoader__: {load: module => {
      plugin = module.factory(name => {
        if (name === 'react') return react;
        throw new Error('Optional module unavailable: ' + name);
      });
    }},
    ...windowOverrides
  };
  runInNewContext(await readFile(new URL('./client.js', import.meta.url), 'utf8'), {
    window, URL, crypto, AbortSignal, AbortController, TextDecoder, atob, fetch: async (url, options) => {
      if (url !== '/dsh-open-market/state') return fetchImpl(url, options);
      if (profileFetch) return profileFetch(url, options);
      const {patch, initialize} = JSON.parse(options.body);
      for (const [key, value] of Object.entries(patch)) if (!initialize || !Object.hasOwn(profileState, key)) profileState[key] = value;
      return {ok: true, json: async () => ({ok: true, state: JSON.parse(JSON.stringify(profileState))})};
    }, Date: clock,
    document: {createElement: () => ({remove() {}}), head: {appendChild() {}}}
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

test('first launch and footer support share a daily vote, with a persistent first-launch marker', async () => {
  const stored = new Map(), votes = [];
  const fetchImpl = async (url, options) => {
    const vote = JSON.parse(options.body); votes.push(vote);
    return {ok: true, json: async () => ({name: vote.name, likes: votes.length, counted: true})};
  };
  const {internals: first} = await client({stored, fetchImpl});
  await first.hydrateProfile();
  first.countSelfInstall(); first.countSelfInstall(); first.supportMarket();
  await tick();
  assert.deepEqual(votes, [{name: 'dsh-open-market', source: 'install'}]);
  assert.equal(stored.get('dsh-open-market:install-counted'), '1');
  const tomorrow = Date.now() + 86400000;
  class Tomorrow extends Date { constructor(...args) { super(...(args.length ? args : [tomorrow])); } }
  const {internals: next} = await client({stored, fetchImpl, clock: Tomorrow});
  await next.hydrateProfile();
  next.countSelfInstall(); await tick();
  assert.equal(votes.length, 1, 'Restart on a later day must not count another installation');
  next.supportMarket(); next.supportMarket(); await tick();
  assert.deepEqual(votes[1], {name: 'dsh-open-market', source: 'like'});
  assert.equal(votes.length, 2, 'Footer supports once on the next UTC day');
});

test('disabled likes suppress both self-install and footer support; failed requests can retry', async () => {
  const stored = new Map([['dsh-open-market:settings', JSON.stringify({likes: false})]]);
  let requests = 0, succeeds = false;
  const {internals} = await client({stored, fetchImpl: async () => {
    requests++;
    if (!succeeds) throw new Error('offline');
    return {ok: true, json: async () => ({name: 'dsh-open-market', likes: 3, counted: false})};
  }});
  await internals.hydrateProfile();
  internals.countSelfInstall(); internals.supportMarket(); await tick();
  assert.equal(requests, 0);
  internals.updateSettings('likes', true); internals.countSelfInstall(); await tick();
  assert.notEqual(stored.get('dsh-open-market:install-counted'), '1');
  assert.equal(internals.getLikes().names.has('dsh-open-market'), false);
  succeeds = true;
  internals.countSelfInstall(); await tick();
  assert.equal(requests, 2);
  assert.equal(stored.get('dsh-open-market:install-counted'), '1', 'An already-counted server vote still completes first launch');
});

test('footer reopens opposite the last visible message and rotates every ten seconds without changing a focused link', async () => {
  const stored = new Map(), timers = new Map();
  let states = [], effects = [], cursor = 0, pending = [], timerId = 0;
  const react = {
    createElement: (type, props, ...children) => ({type, props, children}),
    useState(initial) {
      const id = cursor++;
      if (!(id in states)) {
        states[id] = typeof initial === 'function' ? initial() : initial;
        if (typeof initial === 'function') assert.equal(initial(), states[id], 'Initializer replay must not consume another message');
      }
      return [states[id], value => { states[id] = typeof value === 'function' ? value(states[id]) : value; }];
    },
    useEffect(setup, deps) {
      const id = cursor++, old = effects[id];
      if (!old || deps.some((dep, index) => dep !== old.deps[index])) pending.push(() => {
        old?.dispose?.(); effects[id] = {deps, dispose: setup()};
      });
    }
  };
  const {internals: {FooterInvite}} = await client({stored, react, windowOverrides: {
    setInterval: (callback, ms) => { const id = ++timerId; timers.set(id, {callback, ms}); return id; },
    clearInterval: id => timers.delete(id)
  }});
  const render = () => {
    cursor = 0; pending = [];
    const result = FooterInvite({t: key => key === 'contributingUrl' ? 'https://example.org/contribute' : key, stars: 5});
    pending.forEach(run => run());
    return result;
  };
  const unmount = () => { effects.forEach(effect => effect?.dispose?.()); states = []; effects = []; };
  let link = render();
  assert.equal(link.props.href, 'https://github.com/polang233/dsh-plugin-index');
  assert.equal([...timers.values()][0].ms, 10000);
  [...timers.values()][0].callback();
  link = render();
  assert.equal(link.props.href, 'https://example.org/contribute');
  unmount();
  link = render();
  assert.equal(link.props.href, 'https://github.com/polang233/dsh-plugin-index', 'Reopen must differ from the timed message last shown');
  link.props.onMouseEnter(); link = render();
  assert.equal(timers.size, 0);
  link.props.onFocus(); link = render();
  link.props.onMouseLeave(); link = render();
  assert.equal(timers.size, 0, 'Leaving with the pointer must preserve keyboard focus');
  link.props.onBlur(); link = render();
  assert.equal(timers.size, 1);
  unmount();
  assert.equal(timers.size, 0);
  assert.equal(render().props.href, 'https://example.org/contribute');
  unmount();
  const reopened = await client({stored, react});
  cursor = 0; pending = [];
  assert.equal(reopened.internals.FooterInvite({t: key => key, stars: 5}).props.href,
    'https://github.com/polang233/dsh-plugin-index', 'Last displayed message survives a new client instance');
});

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

test('changing an installed version is handed to the Host while new installs use the normal dialog', async () => {
  const {internals: {installVersion}} = await client();
  const entry = {name: 'demo', installation: {status: 'installed', installedVersion: '2.0.0'}};
  const version = {version: '1.0.0-beta.2', source: {type: 'npm', registry: 'https://registry.npmjs.org/'}};
  const actions = [], phases = [];
  const options = {t: key => key, title: 'Demo', install: async target => {actions.push(target); return {ok: true};},
    update: async target => {actions.push(target); return {ok: true};}, onPhase: phase => phases.push(phase)};
  await installVersion(entry, version, options);
  assert.equal(actions[0].name, 'demo');
  assert.equal(actions[0].spec, 'demo@1.0.0-beta.2');
  assert.deepEqual(phases, ['updating']);
  const answer = await installVersion(entry, version, {...options, update: async () => ({ok: false, error: 'updateRestart'})});
  assert.equal(answer.error, 'updateRestart');
  assert.equal(actions.length, 1, 'The Client must not fall back to removing a package itself');
  const provided = await installVersion({...entry, installation: {status: 'provided'}}, version, options);
  assert.equal(provided.error, 'providedVersion');
  await installVersion({...entry, installation: {status: 'not-installed'}}, version, {...options, manager: () => {throw Error('unexpected removal');}});
  assert.equal(actions.length, 2);
  assert.equal(actions[1].title, 'Demo');
});

test('profile data replaces an empty browser cache and preserves explicit preferences across origins', async () => {
  const profileState = {schema: 1, settings: {likes: false, autoRotate: false},
    favorites: {schema: 1, groups: [{id: 'default', name: '', names: ['demo']}]}, installCounted: true, footerTurn: 1};
  const first = await client({profileState});
  await first.internals.hydrateProfile();
  assert.equal(first.internals.getSettings().likes, false);
  assert.equal(first.internals.getSettings().autoRotate, false);
  assert.deepEqual(plain(first.internals.getFavorites().groups[0].names), ['demo']);
  first.internals.updateSettings('showInstalled', false);
  first.internals.writeFavorites({schema: 1, groups: [{id: 'default', name: '', names: ['demo', 'another']}]});
  await tick();
  const next = await client({profileState, stored: new Map()});
  await next.internals.hydrateProfile();
  assert.equal(next.internals.getSettings().showInstalled, false);
  assert.equal(next.internals.getSettings().likes, false);
  assert.deepEqual(plain(next.internals.getFavorites().groups[0].names), ['demo', 'another']);
});

test('offline profile loading keeps cached preferences and does not send a first-launch vote', async () => {
  let votes = 0;
  const stored = new Map([['dsh-open-market:settings', JSON.stringify({likes: false})]]);
  const plugin = await client({stored, profileFetch: async () => {throw Error('offline');}, fetchImpl: async () => {votes++;}});
  assert.equal(await plugin.internals.hydrateProfile(), false);
  plugin.internals.countSelfInstall(); plugin.internals.supportMarket(); await tick();
  assert.equal(votes, 0);
  assert.equal(plugin.internals.getSettings().likes, false);
  assert.equal(plugin.internals.getProfileStatus(), 'error');
});

test('local edits made while the profile loads are saved rather than overwritten by late state', async () => {
  let release;
  const waiting = new Promise(resolve => {release = resolve;});
  const writes = [];
  const plugin = await client({profileFetch: async (_url, options) => {
    const request = JSON.parse(options.body); writes.push(request);
    if (request.initialize) await waiting;
    return {ok: true, json: async () => ({ok: true, state: {schema: 1, settings: {likes: false, autoRotate: true}, installCounted: true}})};
  }});
  const load = plugin.internals.hydrateProfile();
  plugin.internals.updateSettings('autoRotate', false);
  release(); await load; await tick();
  assert.equal(plugin.internals.getSettings().autoRotate, false);
  assert.equal(plugin.internals.getSettings().likes, false, 'An unrelated local edit must not override the profile opt-out');
  assert(writes.some(x => !x.initialize && x.patch.settings?.autoRotate === false));
});

test('favorites added during hydration merge with the existing profile instead of erasing it', async () => {
  let resume;
  const wait = new Promise(resolve => {resume = resolve;});
  const writes = [];
  const plugin = await client({profileFetch: async (_url, options) => {
    const request = JSON.parse(options.body); writes.push(request);
    if (request.initialize) await wait;
    return {ok: true, json: async () => ({ok: true, state: {schema: 1, installCounted: true,
      settings: {likes: false}, favorites: {schema: 1, groups: [{id: 'default', name: '', names: ['existing']}]}}})};
  }});
  const loading = plugin.internals.hydrateProfile();
  plugin.internals.writeFavorites({schema: 1, groups: [{id: 'default', name: '', names: ['new']}]});
  resume(); await loading; await tick();
  assert.deepEqual(plain(plugin.internals.getFavorites().groups[0].names), ['existing', 'new']);
  assert.deepEqual(writes.find(x => !x.initialize).patch.favorites.groups[0].names, ['existing', 'new']);
});

test('local synonyms broaden search while exact matches rank first and category remains a constraint', async () => {
  const {internals: {filterCatalog}} = await client();
  const entries = [entry('notes', 'not-installed', {title: '笔记', description: 'Markdown notes', metadata: {category: 'tools'}}),
    entry('notepad', 'not-installed', {title: '记事本', description: '简单记录', metadata: {category: 'tools'}}),
    entry('memory', 'not-installed', {description: '笔记记忆', metadata: {category: 'memory'}})];
  const resolve = value => typeof value === 'string' ? value : value?.zh || '';
  assert.deepEqual(plain(filterCatalog(entries, '记事本', 'tools', resolve).map(x => x.name)), ['notepad', 'notes']);
  assert.deepEqual(plain(filterCatalog(entries, '', 'memory', resolve).map(x => x.name)), ['memory']);
  assert.deepEqual(plain(filterCatalog(entries, '记事本 markdown', 'tools', resolve).map(x => x.name)), ['notes']);
  assert.deepEqual(plain(filterCatalog(entries, 'does-not-exist', '', resolve)), []);
});

test('search respects the real host locale contract when optional title and description are absent', async () => {
  const {internals: {filterCatalog}} = await client();
  // DSH resolveText reads text.en for every non-string input.
  const resolve = text => typeof text === 'string' ? text : text.zh ?? text.en;
  const entries = [entry('untitled', 'not-installed'), entry('translated', 'not-installed', {title: {en: 'Notes', zh: '笔记'}, description: null})];
  assert.deepEqual(plain(filterCatalog(entries, 'untitled', '', resolve).map(x => x.name)), ['untitled']);
  assert.deepEqual(plain(filterCatalog(entries, '笔记', '', resolve).map(x => x.name)), ['translated']);
});

test('screenshots are extracted as safe GitHub image URLs without rendering README HTML', async () => {
  const {internals: {extractScreenshots}} = await client();
  const readme = '![预览](docs/screen.png)\n<img src="https://github.com/a/b/blob/main/demo.webp" alt="Screenshot">\n'
    + '![logo](logo.png) ![bad](javascript:alert(1)) ![tracker](https://tracker.example/a.png) ![svg](image.svg)';
  const images = plain(extractScreenshots(readme, 'https://raw.githubusercontent.com/a/b/main/README.md'));
  assert.deepEqual(images.map(x => x.url), ['https://raw.githubusercontent.com/a/b/main/docs/screen.png', 'https://raw.githubusercontent.com/a/b/main/demo.webp']);
});

test('README extraction requires preview context and rejects decorative or tiny images and code samples', async () => {
  const {internals: {extractScreenshots}} = await client();
  const readme = '![Unrelated](art.png)\n# 界面预览\n![Main view](docs/main.png)\n![边框](docs/line.png)\n'
    + '<img src="tiny-preview.png" width="32" height="32">\n![Preview banner](banner.png)\n'
    + '```md\n![Preview](example.png)\n```\n<!-- ![Preview](hidden.png) -->';
  assert.deepEqual(plain(extractScreenshots(readme, 'https://raw.githubusercontent.com/a/b/main/README.md').map(x => x.url)),
    ['https://raw.githubusercontent.com/a/b/main/docs/main.png']);
});

test('curated screenshots override README guesses, including an explicit empty selection', async () => {
  for (const images of [[], [{url: 'https://github.com/user-attachments/assets/preview-id', alt: 'Task panel'}]]) {
    const requests = [];
    const {internals} = await client({fetchImpl: async (url, options) => {
      requests.push(url); assert.equal(options.credentials, 'omit');
      return Response.json({schema: 1, plugins: {demo: {screenshots: images}}});
    }});
    const e = entry('demo', 'installed', {repository: {url: 'https://github.com/a/b'}});
    const actual = plain(await internals.loadScreenshots(e));
    assert.equal(actual.length, images.length);
    if (actual.length) assert.equal(actual[0].origin, 'author');
    await internals.loadScreenshots(e);
    assert.equal(requests.length, 1, 'Author selection bypasses GitHub and is cached');
  }
});

test('Raw README works without consuming GitHub API quota and honors package directories', async () => {
  const requests = [];
  const {internals} = await client({fetchImpl: async url => {
    requests.push(url);
    if (url.endsWith('/display.json')) return Response.json({schema: 1, plugins: {}});
    assert.equal(url, 'https://raw.githubusercontent.com/a/b/HEAD/plugins/demo/README.md');
    return new Response('![界面预览](screen.png)');
  }});
  const e = entry('demo', 'installed', {repository: {url: 'https://github.com/a/b', directory: 'plugins/demo'}});
  assert.equal((await internals.loadScreenshots(e))[0].url, 'https://raw.githubusercontent.com/a/b/HEAD/plugins/demo/screen.png');
  assert.equal(requests.length, 2);
});

test('release notes recognize our published package-v tag and isolate CHANGELOG versions on API rate limits', async () => {
  const e = entry('dsh-open-market', 'installed', {repository: {url: 'https://github.com/polang233/dsh-plugin-index', directory: 'packages/dsh-open-market'}});
  const version = {version: '0.3.0', source: {type: 'npm'}};
  const {internals: tagged} = await client({fetchImpl: async url => url.endsWith('/dsh-open-market-v0.3.0')
    ? Response.json({tag_name: 'dsh-open-market-v0.3.0', body: 'Our release'}) : new Response('', {status: 404})});
  assert.equal((await tagged.loadReleaseNotes(e, version)).body, 'Our release');
  const {internals: limited} = await client({fetchImpl: async url => url.includes('api.github.com') ? new Response('', {status: 403})
    : new Response('# Changelog\n## 0.3.1\nNewer changes\n## [0.3.0] - 2026-11-03\n### Fixed\nSelected changes\n## 0.2.7\nOlder changes')});
  const notes = await limited.loadReleaseNotes(e, version);
  assert.equal(notes.body, '### Fixed\nSelected changes');
  assert.match(notes.url, /packages\/dsh-open-market\/CHANGELOG.md$/);
  assert.equal(limited.extractVersionNotes('## 1.0.0-beta.1\nBeta\n## 1.0.0\nStable', '1.0.0'), 'Stable');
});

test('detail streams stop at the size limit', async () => {
  const {internals} = await client({fetchImpl: async url => url.endsWith('/display.json') ? new Response('', {status: 404})
    : url.includes('api.github.com') ? new Response('x'.repeat(2 * 1024 * 1024 + 1)) : new Response('', {status: 404})});
  await assert.rejects(internals.loadScreenshots(entry('demo', 'installed', {repository: {url: 'https://github.com/a/b'}})), /too large/);
});

test('details requests are lazy, cached and release notes match only the selected exact version', async () => {
  const requests = [];
  const plugin = await client({fetchImpl: async url => {
    requests.push(url);
    if (url.endsWith('/display.json')) return {ok: true, text: async () => JSON.stringify({schema: 1, plugins: {}})};
    if (url.startsWith('https://raw.githubusercontent.com/')) return {ok: false, status: 404};
    const value = url.endsWith('/readme') ? {encoding: 'base64', content: Buffer.from('![预览](screen.png)').toString('base64'), download_url: 'https://raw.githubusercontent.com/a/b/main/README.md'}
      : url.includes('/v1.0.0') ? null : {tag_name: '1.0.0', body: 'Version one changes'};
    return {ok: value !== null, status: value === null ? 404 : 200, text: async () => JSON.stringify(value)};
  }});
  assert.equal(requests.length, 0);
  const e = entry('demo', 'installed', {repository: {url: 'https://github.com/a/b'}, versions: [{version: '1.0.0', source: {type: 'npm'}}]});
  const images = await plugin.internals.loadScreenshots(e);
  assert.equal(images.length, 1);
  await plugin.internals.loadScreenshots(e);
  assert.equal(requests.length, 3, 'Repeated details reuse the successful preview catalog and README fetch');
  const release = await plugin.internals.loadReleaseNotes(e, e.versions[0]);
  assert.equal(release.body, 'Version one changes');
  assert.equal(requests.length, 5);
  assert(!requests.some(url => url.includes('/latest')));
  assert.equal(await plugin.internals.loadReleaseNotes({...e, repository: {url: 'https://example.com/a/b'}}, e.versions[0]), null);
});

test('failed detail requests can retry and update failures display restoration status', async () => {
  let attempts = 0;
  const {internals} = await client({fetchImpl: async () => {attempts++; throw Error('rate limited');}});
  const e = entry('demo', 'installed', {repository: {url: 'https://github.com/a/b'}});
  await assert.rejects(internals.loadScreenshots(e));
  await assert.rejects(internals.loadScreenshots(e));
  assert.equal(attempts, 6, 'Each retry checks the catalog, Raw README and GitHub API');
  const result = await internals.requestBundleUpdate({name: 'demo', spec: 'demo@2.0.0'}, key => key, {fetchImpl: async (_url, options) => {
    assert.equal(options.credentials, 'same-origin');
    assert.equal(JSON.parse(options.body).name, 'demo');
    return {ok: true, json: async () => ({ok: false, error: 'download failed', restored: true})};
  }});
  assert.match(result.error, /updateRestored/);
});

test('the release disclosure fetches nothing until opened and renders remote markup as text', async () => {
  const states = [], effects = [];
  let cursor = 0, pending = [], requests = 0;
  const react = {
    createElement: (type, props, ...children) => ({type, props, children}),
    useState(initial) {const id = cursor++; if (!(id in states)) states[id] = initial; return [states[id], value => {states[id] = typeof value === 'function' ? value(states[id]) : value;}];},
    useEffect(setup, deps) {
      const id = cursor++, old = effects[id];
      if (!old || deps.some((value, index) => value !== old.deps[index])) pending.push(() => {old?.dispose?.(); effects[id] = {deps, dispose: setup()};});
    }
  };
  const plugin = await client({react, fetchImpl: async () => {
    requests++;
    return {ok: true, text: async () => JSON.stringify({tag_name: 'v1.0.0', body: '<script>untrusted()</script>\nUpdate details'})};
  }});
  const props = {entry: entry('demo', 'installed', {repository: {url: 'https://github.com/a/b'}}), version: {version: '1.0.0', source: {type: 'npm'}}, t: key => key};
  const render = () => {cursor = 0; pending = []; const tree = plugin.internals.ReleaseNotes(props); pending.forEach(run => run()); return tree;};
  let tree = render();
  assert.equal(requests, 0);
  tree.props.onToggle({currentTarget: {open: true}});
  render(); await tick(); tree = render();
  assert.equal(requests, 1);
  const types = node => typeof node === 'object' && node ? [node.type, ...(node.children || []).flatMap(types)] : [];
  assert(!types(tree).includes('script'));
  assert(JSON.stringify(tree).includes('untrusted()'));
  effects.forEach(effect => effect?.dispose?.());
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
    assert.equal(url, '/dsh-open-market/self-update');
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

test('management uses the complete native inventory and keeps disabled, broken and outside-market details accessible', async () => {
  const {internals: {managementRows, filterManaged}} = await client();
  const bundles = [
    {name: 'demo', version: '1.0.0', installed: true, enabled: false, source: 'demo@^1.0.0', updatable: true, rows: [{rowId: 'component', entryId: 'live'}]},
    {name: 'local-only', installed: true, enabled: true, source: 'file:/plugins/local', rows: [], meta: {title: 'Local plugin'}},
    {name: 'shipped', availability: 'installation', installed: false, enabled: true, readOnlyReason: 'system-plugin', rows: []},
    {name: 'not-installed', availability: 'missing', installed: false, rows: []},
  ];
  const catalog = [entry('demo', 'incompatible', {title: 'Demo', defaultVersion: '2.0.0', versions: [{version: '2.0.0', install: {spec: 'demo@2.0.0'}}]})];
  const checks = {demo: {status: 'listed', installed: '1.0.0', registry: 'https://registry.example/', versions: [
    {version: '3.0.0', bundle: true, incompatible: true}, {version: '2.1.0-beta.1', bundle: true, prerelease: true},
    {version: '2.0.0', bundle: true}, {version: '1.0.0', bundle: true},
  ]}};
  const rows = managementRows(bundles, catalog, checks, [{entryId: 'live', fiberPhase: 'failed', diagnostic: 'Bad configuration'}], value => typeof value === 'string' ? value : value.en);
  assert.deepEqual(plain(rows.map(row => row.bundle.name)), ['demo', 'local-only', 'shipped']);
  assert.equal(rows[0].problem, true);
  assert.equal(rows[0].target.spec, 'demo@2.0.0');
  assert.deepEqual(plain(filterManaged(rows, {query: 'LOCAL'}).map(row => row.bundle.name)), ['local-only']);
  assert.deepEqual(plain(filterManaged(rows, {filter: 'disabled'}).map(row => row.bundle.name)), ['demo']);
  assert.deepEqual(plain(filterManaged(rows, {filter: 'problems'}).map(row => row.bundle.name)), ['demo']);
  assert.deepEqual(plain(filterManaged(rows, {filter: 'external', names: ['shipped']}).map(row => row.bundle.name)), ['shipped']);
  const current = managementRows([bundles[0]], [], {demo: {...checks.demo, versions: [{version: '1.0.0', bundle: true}]}}, [], value => value);
  assert.equal(current[0].target, null, 'Checking versions must not offer the installed version as an update');
});

test('native detail navigation waits for the Plugins page to mount and reports unsupported hosts', async () => {
  const {internals: {openNativePackage}} = await client();
  const opened = []; let navigation, selected = 0;
  const result = await openNativePackage('outside-market', {get: () => navigation, select: () => {selected++;},
    wait: async () => {navigation = {openBundle: name => opened.push(name)};}});
  assert.equal(result.ok, true); assert.equal(selected, 1);
  assert.deepEqual(opened, ['outside-market']);
  selected = 0;
  await openNativePackage('demo', {get: () => navigation, select: () => {selected++;}});
  assert.equal(selected, 0);
  assert.equal((await openNativePackage('demo', {get: () => undefined, select() {}, wait: async () => {}})).ok, false);
});

test('switching any installed version can queue an exact target without starting an immediate update', async () => {
  const {internals: {installVersion}} = await client();
  for (const name of ['demo', 'dsh-open-market']) {
    const calls = [];
    const answer = await installVersion({name, installation: {status: 'installed', installedVersion: '2.0.0'}},
      {version: '1.0.0', source: {type: 'npm', registry: 'https://registry.example/'}}, {when: 'idle', t: key => key,
        install: () => assert.fail('Unexpected install'), update: () => assert.fail('Unexpected immediate update'),
        selfUpdate: () => assert.fail('Unexpected immediate self-update'), management: async request => {calls.push(request); return {ok: true, queued: true};}});
    assert.equal(answer.queued, true);
    assert.equal(calls[0].spec, name + '@1.0.0');
    assert.equal(calls[0].registry, 'https://registry.example/');
    assert.equal(calls[0].when, 'idle');
  }
});

function managementView() {
  const values = [], effects = [];
  let cursor = 0, setups = [];
  const react = {
    createElement: (type, props, ...children) => ({type, props: props || {}, children}),
    useState(initial) {const id = cursor++; if (!(id in values)) values[id] = typeof initial === 'function' ? initial() : initial;
      return [values[id], value => {values[id] = typeof value === 'function' ? value(values[id]) : value;}];},
    useRef(initial) {return react.useState(() => ({current: initial}))[0];},
    useId() {return react.useState(() => 'id-' + cursor)[0];},
    useMemo: compute => compute(), useCallback: value => value,
    useSyncExternalStore: (_subscribe, read) => read(),
    useEffect(setup, deps) {const id = cursor++, old = effects[id];
      if (!old || deps.some((value, index) => value !== old.deps[index])) setups.push(() => {old?.dispose?.(); effects[id] = {deps, dispose: setup()};});},
  };
  return {react, render(component, props) {cursor = 0; setups = []; const tree = component(props); setups.forEach(run => run()); return tree;},
    close() {effects.forEach(effect => effect?.dispose?.());}};
}
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.children)] : [];
const nodeText = tree => Array.isArray(tree) ? tree.map(nodeText).join(' ') : tree && typeof tree === 'object' ? nodeText(tree.children) : String(tree ?? '');

test('management details separate settings, protected changes and typed uninstall confirmation', async t => {
  const view = managementView(); t.after(() => view.close());
  const requests = [], opened = []; let closed = 0, eventListener;
  const inventory = [{name: 'outside', version: '1.0.0', installed: true, availability: 'profile', source: 'outside@^1.0.0', enabled: true, removable: true,
    rows: [{rowId: 'off', entryId: 'off', moduleName: 'outside/disabled'}]}];
  const plugin = await client({react: view.react, windowOverrides: {setInterval: () => 0, clearInterval() {}}, fetchImpl: async (_url, options) => {
    if (options.method === 'POST') {requests.push(JSON.parse(options.body)); return Response.json({ok: true});}
    return Response.json({ok: true, jobs: [], activity: {available: true, busy: false, running: 0, activities: 0}});
  }});
  const service = {listBundles: async () => ({ok: true, value: inventory}), listPlugins: async () => ({ok: true, value: [{entryId: 'off', enabled: false}]}),
    readBundleDetail: async (name, _language, options) => {
      assert.equal(name, 'outside'); assert.deepEqual(plain(options), {npmFileSources: []});
      return {ok: true, value: {status: 'found', markdown: '<script>remote()</script>'}};
    }};
  const props = {entries: [], t: key => plugin.internals.en[key] || key, resolve: value => value, manager: () => service,
    remote: {$on: (_name, listener) => {eventListener = listener; return () => {eventListener = undefined;};}},
    openPackage: name => {opened.push(name); return {ok: true};}, onClose: () => {closed++;}, restoreFocus() {}};
  const render = () => view.render(plugin.internals.InstalledPanel, props);
  render(); await tick(); let tree = render();
  const button = (text, current = tree) => nodes(current).find(node => node.type === 'button' && nodeText(node) === text);
  const label = key => plugin.internals.en[key];
  assert.equal(nodes(tree).filter(node => node.props.className === 'opm-manage-open').length, 1, nodeText(tree));
  assert.equal(typeof eventListener, 'function');
  assert.equal(requests.length, 0, 'Selecting a detail must not mutate the package');
  const components = nodes(tree).find(node => node.props.className === 'opm-components');
  assert(nodeText(components).includes(label('disabled')), 'A disabled component must not inherit its enabled bundle status');
  await button(label('disable')).props.onClick();
  assert.deepEqual(requests[0], {action: 'toggle', name: 'outside', enabled: false});
  tree = render();
  button(label('manageUninstall')).props.onClick(); tree = render();
  const confirmation = nodes(tree).find(node => node.type === 'input' && node.props.autoComplete === 'off');
  const remove = () => nodes(tree).filter(node => node.type === 'button' && nodeText(node) === label('manageUninstall')).at(-1);
  assert.equal(remove().props.disabled, true);
  confirmation.props.onChange({target: {value: 'outside'}}); tree = render();
  assert.equal(remove().props.disabled, false);
  await remove().props.onClick();
  assert.deepEqual(requests[1], {action: 'remove', name: 'outside', confirmation: 'outside'});
  tree = render(); await button(label('manageLoadDocument')).props.onClick(); tree = render();
  assert.equal(nodes(tree).find(node => node.type === 'pre').children[0], '<script>remote()</script>');
  assert.equal(nodes(tree).some(node => node.type === 'script'), false);
  await button(label('manageSettings')).props.onClick();
  assert.deepEqual(opened, ['outside']); assert.equal(closed, 1);
  view.close(); assert.equal(eventListener, undefined);
});

test('management keeps local details accessible while tasks run and offers idle updates independently', async t => {
  const view = managementView(); t.after(() => view.close()); const mutations = [];
  const plugin = await client({react: view.react, windowOverrides: {setInterval: () => 0, clearInterval() {}}, fetchImpl: async (_url, options) => {
    if (options.method === 'POST') {mutations.push(JSON.parse(options.body)); return Response.json({ok: true, queued: true});}
    return Response.json({ok: true, jobs: [], activity: {available: true, busy: true, running: 1, activities: 1}});
  }});
  const props = {t: key => plugin.internals.en[key] || key, resolve: value => value, onClose() {},
    entries: [entry('demo', 'update-available', {defaultVersion: '2.0.0', versions: [{version: '2.0.0', install: {spec: 'demo@2.0.0'}}]})],
    manager: () => ({listBundles: async () => ({ok: true, value: [{name: 'demo', version: '1.0.0', source: 'demo@^1.0.0', installed: true, enabled: true, removable: true}]}), listPlugins: async () => ({ok: true, value: []})})};
  const render = () => view.render(plugin.internals.InstalledPanel, props);
  render(); await tick(); const tree = render();
  const button = key => nodes(tree).find(node => node.type === 'button' && nodeText(node) === plugin.internals.en[key]);
  assert(button('manageNow'), nodeText(tree));
  assert.equal(button('manageNow').props.disabled, true);
  assert.equal(button('disable').props.disabled, true);
  assert.equal(button('manageSettings').props.disabled, false);
  assert.equal(button('manageIdle').props.disabled, false);
  await button('manageIdle').props.onClick();
  assert.equal(mutations[0].when, 'idle'); assert.equal(mutations[0].spec, 'demo@2.0.0');
});

test('system plugins start collapsed while custom plugins stay visible and status has its own badge', async t => {
  const view = managementView(); t.after(() => view.close());
  const plugin = await client({react: view.react, windowOverrides: {setInterval: () => 0, clearInterval() {}}, fetchImpl: async () => Response.json({ok: true,
    jobs: [], activity: {available: true, busy: false}, inventory: {plugins: [], bundles: [
      {name: 'system', official: true, availability: 'installation', enabled: true, rows: []},
      {name: 'custom', installed: true, enabled: false, rows: []},
    ]}})});
  const props = {entries: [], t: key => plugin.internals.en[key] || key, resolve: value => value, manager: () => ({}), onClose() {}};
  const render = () => view.render(plugin.internals.InstalledPanel, props);
  render(); await tick(); const tree = render();
  const system = nodes(tree).find(node => node.props.className === 'opm-manage-group opm-system-group');
  assert.equal(system.props.open, false);
  assert(nodeText(nodes(tree).find(node => node.props.className === 'opm-manage-detail')).includes('custom'));
  assert(nodes(tree).some(node => node.props.bundle?.name === 'custom' && node.props.bundle.enabled === false));
});

test('load-order editing requires an explicit save and carries the profile revision', async t => {
  const view = managementView(); t.after(() => view.close()); const actions = [];
  const {internals} = await client({react: view.react});
  const props = {diagnostics: {available: true, revision: 'a'.repeat(64), customOrder: ['alpha', 'beta'], environment: {runtimeVersion: '0.2.2-rc.1'}},
    t: key => internals.en[key] || key, action: request => actions.push(request), safe: true, busy: false, rows: []};
  const render = () => view.render(internals.RuntimeOverview, props);
  render(); let tree = render();
  nodes(tree).find(node => node.props['aria-label'] === 'Move beta earlier').props.onClick(); tree = render();
  assert.equal(actions.length, 0);
  const save = nodes(tree).find(node => node.type === 'button' && nodeText(node) === internals.en.manageOrderSaved);
  save.props.onClick();
  assert.deepEqual(plain(actions[0]), {action: 'reorder', order: ['beta', 'alpha'], revision: 'a'.repeat(64)});
  props.safe = false; tree = render();
  assert.equal(nodes(tree).find(node => node.type === 'button' && nodeText(node) === internals.en.manageOrderSaved).props.disabled, true);
});

test('horizontal mouse dragging scrolls from a button without activating it and preserves clicks, typing and vertical gestures', async () => {
  const {internals: {attachHorizontalDrag}} = await client();
  const handlers = new Map(), documentHandlers = new Map();
  const doc = {addEventListener: (name, fn) => documentHandlers.set(name, fn), removeEventListener: name => documentHandlers.delete(name)};
  const root = {ownerDocument: doc, contains: () => true, addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: name => handlers.delete(name)};
  const rail = {scrollWidth: 900, clientWidth: 300, scrollLeft: 250, dataset: {}, contains: () => true, setPointerCapture() {}, hasPointerCapture: () => false};
  const target = {closest: selector => selector.includes('.opm-rail') ? rail : null};
  const event = extra => ({target, pointerType: 'mouse', button: 0, pointerId: 1, clientX: 100, clientY: 100, timeStamp: 1000,
    preventDefault() {this.prevented = true;}, stopImmediatePropagation() {this.stopped = true;}, ...extra});
  const cleanup = attachHorizontalDrag(root);
  handlers.get('pointerdown')(event());
  documentHandlers.get('pointermove')(event({clientX: 60}));
  assert.equal(rail.scrollLeft, 290); assert.equal(rail.dataset.dragging, 'true');
  documentHandlers.get('pointerup')(event({timeStamp: 1050}));
  const click = event({detail: 1, timeStamp: 1051}); handlers.get('click')(click);
  assert.equal(click.stopped, true); assert.equal(rail.dataset.dragging, undefined);
  handlers.get('pointerdown')(event({timeStamp: 2000}));
  documentHandlers.get('pointermove')(event({clientX: 103, timeStamp: 2010}));
  documentHandlers.get('pointerup')(event({timeStamp: 2020}));
  const normal = event({detail: 1, timeStamp: 2021}); handlers.get('click')(normal);
  assert.equal(normal.stopped, undefined);
  handlers.get('pointerdown')(event()); documentHandlers.get('pointermove')(event({clientY: 120}));
  documentHandlers.get('pointermove')(event({clientX: 50})); assert.equal(rail.scrollLeft, 290);
  const input = {closest: selector => selector.includes('input') ? {} : rail};
  handlers.get('pointerdown')(event({target: input})); documentHandlers.get('pointermove')(event({clientX: 40}));
  assert.equal(rail.scrollLeft, 290);
  cleanup(); assert.equal(handlers.size, 0); assert.equal(documentHandlers.size, 0);
});

test('native settings launchers and sparse catalog labels never pass undefined to the Host locale resolver', async () => {
  const {internals: {Tags}} = await client({react: {createElement: (type, props, ...children) => ({type, props, children})}});
  const resolve = value => typeof value === 'string' ? value : value.en;
  const entry = {name: 'demo', metadata: {labels: ['verified', 'unknown-label']}};
  const tree = Tags({entry, resolve, t: key => key});
  assert(nodeText(tree).includes('verified')); assert(nodeText(tree).includes('unknown-label'));
  const translated = Tags({entry, resolve, t: key => key, metadata: {labels: {verified: {title: {en: 'Reviewed'}}}}});
  assert(nodeText(translated).includes('Reviewed'));
});
