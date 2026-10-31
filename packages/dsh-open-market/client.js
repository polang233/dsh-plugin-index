// Browser half: an "Open Market" tab on the Plugins page, next to Installed and Discover.
// Hand-written in the shape DSH's module loader expects, so the package still needs no build step.
window.__ModuleLoader__.load({
  id: 'dsh-open-market',
  factory: require => {
    const React = require('react');
    const h = React.createElement;
    let createPortal;
    try { createPortal = require('react-dom').createPortal; } catch { /* Without a portal the group menu renders in place. */ }
    let Switch;
    try { Switch = require('@deepseek-ai/dsh-client-ui-primitives').Switch; } catch { /* Older hosts use the checkbox fallback. */ }

    const SETTINGS_KEY = 'dsh-open-market:settings';
    const DEFAULT_SETTINGS = { autoRotate: true, showInstalled: true, showCheckup: true, likes: true, registry: 'index', customRegistry: '', sidebarMarket: 'auto' };
    const REGISTRY_CHOICES = ['index', 'dsh', 'npmmirror', 'custom'];
    function normalizeSettings(saved) {
      const result = Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) =>
        [key, typeof saved?.[key] === typeof fallback ? saved[key] : fallback]));
      // 0.2.5 stored the opposite switch, and it covered the rails only.
      if (typeof saved?.showInstalled !== 'boolean' && typeof saved?.hideInstalled === 'boolean') result.showInstalled = !saved.hideInstalled;
      if (!REGISTRY_CHOICES.includes(result.registry)) result.registry = DEFAULT_SETTINGS.registry;
      if (!['auto', 'on', 'off'].includes(result.sidebarMarket)) result.sidebarMarket = DEFAULT_SETTINGS.sidebarMarket;
      return result;
    }
    function readSettings() {
      try { return normalizeSettings(JSON.parse(window.localStorage.getItem(SETTINGS_KEY))); } catch { return { ...DEFAULT_SETTINGS }; }
    }
    let settings = readSettings();
    const settingsListeners = new Set();
    const getSettings = () => settings;
    function subscribeSettings(listener) {
      settingsListeners.add(listener);
      return () => settingsListeners.delete(listener);
    }
    function updateSettings(key, value) {
      if (typeof value !== typeof DEFAULT_SETTINGS[key] || settings[key] === value) return;
      settings = { ...settings, [key]: value };
      try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Keep this session usable without storage. */ }
      settingsListeners.forEach(listener => listener());
    }
    function useSettings() {
      return React.useSyncExternalStore(subscribeSettings, getSettings, getSettings);
    }

    const NPMMIRROR_REGISTRY = 'https://registry.npmmirror.com/';
    // pnpm compares registries with a trailing slash; a URL with credentials would leak them into DSH's install log.
    function registryUrl(value) {
      try {
        const url = new URL(String(value).trim());
        if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || url.search || url.hash) return null;
        if (!url.pathname.endsWith('/')) url.pathname += '/';
        return url.href;
      } catch { return null; }
    }
    // DSH asks the registry named here first and falls back to the others it trusts. Only npm versions name one:
    // a Git spec is fetched from its own host, whichever registry is chosen. Leaving it out uses DSH's own choice.
    function installTarget(target, { registry: choice, customRegistry }) {
      if (target.registry === undefined || choice === 'index') return target;
      const { registry, ...rest } = target;
      if (choice === 'dsh') return rest;
      const chosen = choice === 'npmmirror' ? NPMMIRROR_REGISTRY : registryUrl(customRegistry);
      return { ...rest, registry: chosen || registry };
    }

    // Favorites live in this browser profile: named groups of npm package names, any package, not only this index's.
    const FAVORITES_KEY = 'dsh-open-market:favorites';
    const DEFAULT_GROUP = 'default';
    const PACKAGE_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
    const validPackage = name => typeof name === 'string' && name.length <= 214 && PACKAGE_NAME.test(name);
    function normalizeFavorites(value) {
      const groups = [];
      for (const group of Array.isArray(value?.groups) ? value.groups : []) {
        if (typeof group?.id !== 'string' || !group.id || groups.some(item => item.id === group.id)) continue;
        groups.push({ id: group.id, name: typeof group.name === 'string' ? group.name.trim().slice(0, 40) : '',
          names: [...new Set(Array.isArray(group.names) ? group.names.filter(validPackage) : [])] });
      }
      const fallback = groups.find(group => group.id === DEFAULT_GROUP) || { id: DEFAULT_GROUP, name: '', names: [] };
      return { schema: 1, groups: [fallback, ...groups.filter(group => group !== fallback)] };
    }
    function readFavorites() {
      try { return normalizeFavorites(JSON.parse(window.localStorage.getItem(FAVORITES_KEY))); } catch { return normalizeFavorites(null); }
    }
    let favorites = readFavorites();
    const favoritesListeners = new Set();
    const getFavorites = () => favorites;
    function subscribeFavorites(listener) {
      favoritesListeners.add(listener);
      return () => favoritesListeners.delete(listener);
    }
    function writeFavorites(next) {
      favorites = normalizeFavorites(next);
      try { window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites)); } catch { /* Keep this session usable without storage. */ }
      favoritesListeners.forEach(listener => listener());
    }
    function useFavorites() {
      return React.useSyncExternalStore(subscribeFavorites, getFavorites, getFavorites);
    }
    const newGroupId = () => 'g-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    function updateGroup(id, change) {
      writeFavorites({ ...favorites, groups: favorites.groups.map(group => group.id === id ? { ...group, ...change(group) } : group) });
    }
    function setFavorite(id, name, saved) {
      updateGroup(id, group => ({ names: saved ? [...new Set([...group.names, name])] : group.names.filter(item => item !== name) }));
    }
    function createGroup(name) {
      const id = newGroupId();
      writeFavorites({ ...favorites, groups: [...favorites.groups, { id, name, names: [] }] });
      return id;
    }
    function deleteGroup(id) {
      if (id !== DEFAULT_GROUP) writeFavorites({ ...favorites, groups: favorites.groups.filter(group => group.id !== id) });
    }
    // An import merges into the group with the same id or name, so importing the same file twice adds nothing.
    // A bare array of package names goes to the default group.
    function importFavorites(value) {
      const incoming = Array.isArray(value) ? { groups: [{ id: DEFAULT_GROUP, names: value }] } : value;
      if (!Array.isArray(incoming?.groups)) throw new Error('format');
      const groups = favorites.groups.map(group => ({ ...group, names: [...group.names] }));
      let added = 0;
      for (const group of normalizeFavorites(incoming).groups) {
        let target = groups.find(item => item.id === group.id || (group.name && item.name === group.name));
        if (!target) groups.push(target = { id: newGroupId(), name: group.name, names: [] });
        for (const name of group.names) if (!target.names.includes(name)) { target.names.push(name); added++; }
      }
      writeFavorites({ ...favorites, groups });
      return added;
    }
    const groupLabel = (group, t) => group.name || t('defaultGroup');

    const INDEX_URL = 'https://dshopen.org/index.json';
    const REPOSITORY = 'polang233/dsh-plugin-index';
    const REPOSITORY_URL = 'https://github.com/' + REPOSITORY;
    const GITHUB_MARK = 'M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z';
    const LIKES_ORIGIN = 'https://dshopen.org';
    const CONTRIBUTING_URL = REPOSITORY_URL + '/blob/main/.github/CONTRIBUTING.md';

    // The catalog runs to megabytes and localStorage is synchronous and shared with favorites, so it lives in IndexedDB.
    // Everything here is best effort: without storage the tab reads the market as it did before there was a cache.
    const CACHE_DB = 'dsh-open-market';
    const CACHE_STORE = 'cache';
    const CACHE_SCHEMA = 1;
    const CACHE_WAIT = 1500;
    // The index rebuilds every six hours, so reading it more often returns the same document.
    const REFRESH_INTERVAL = 6 * 60 * 60 * 1000;
    const RETRY_INTERVAL = 15 * 60 * 1000;

    function openCache() {
      return new Promise((resolve, reject) => {
        const request = window.indexedDB.open(CACHE_DB, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(CACHE_STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('blocked'));
      });
    }

    async function withCache(mode, run) {
      const database = await openCache();
      try {
        return await new Promise((resolve, reject) => {
          const transaction = database.transaction(CACHE_STORE, mode);
          const request = run(transaction.objectStore(CACHE_STORE));
          transaction.oncomplete = () => resolve(request.result);
          transaction.onerror = transaction.onabort = () => reject(transaction.error);
        });
      } finally {
        database.close();
      }
    }

    async function readCache(key) {
      try { return await withCache('readonly', store => store.get(key)); } catch { return undefined; }
    }

    async function writeCache(key, value) {
      try { await withCache('readwrite', store => store.put(value, key)); } catch { /* The next open reads the market again. */ }
    }

    // A storage that never answers must not hold up the market behind it.
    function waitForCache(key) {
      return Promise.race([readCache(key), new Promise(resolve => window.setTimeout(resolve, CACHE_WAIT))]);
    }

    const VERSION_CACHE_TTL = 60 * 60 * 1000;
    const versionCache = new Map();
    const versionRequests = new Map();
    const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

    function npmVersionRegistry(entry, preferences) {
      const version = entry.versions?.find(item => item.version === entry.defaultVersion) ?? entry.versions?.[0];
      if (version?.source?.type !== 'npm') return null;
      const registry = registryUrl(version.source.registry ?? 'https://registry.npmjs.org/');
      if (!registry) return null;
      return installTarget({ registry }, preferences).registry ?? registry;
    }

    function declaredDshRanges(manifest) {
      if (typeof manifest.engines?.dsh === 'string') return [manifest.engines.dsh];
      return [...new Set(Object.entries(manifest.peerDependencies ?? {})
        .filter(([name, range]) => (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))
          && typeof range === 'string' && !range.startsWith('workspace:') && range !== '*')
        .map(([, range]) => range))];
    }

    // Registry metadata is a version list, not a review or proof that the archive installs. DSH inspects the chosen package.
    function npmVersions(name, metadata) {
      if (metadata?.name !== name || !metadata.versions || typeof metadata.versions !== 'object' || Array.isArray(metadata.versions)) {
        throw new Error('Invalid npm package metadata');
      }
      return Object.entries(metadata.versions).flatMap(([version, manifest]) => {
        if (!EXACT_VERSION.test(version) || !manifest || manifest.name !== name || manifest.version !== version || manifest.deprecated) return [];
        const patch = manifest.dsh?.bundle?.patch;
        const patches = Array.isArray(patch) ? patch : [patch];
        if (!patches.length || patches.some(file => typeof file !== 'string' || !file.trim())) return [];
        const time = Date.parse(metadata.time?.[version]);
        return [{ version, ...(Number.isFinite(time) ? { publishTimestamp: Math.floor(time / 1000) } : {}), requirements: declaredDshRanges(manifest) }];
      }).sort((a, b) => (b.publishTimestamp ?? 0) - (a.publishTimestamp ?? 0) || b.version.localeCompare(a.version, 'en', { numeric: true }));
    }

    // No registry requests at startup or when opening a detail. Only an expanded version list calls this loader.
    async function loadNpmVersions(name, registry, { fetchImpl = fetch, now = Date.now() } = {}) {
      if (!validPackage(name) || registryUrl(registry) !== registry) throw new Error('Invalid npm package source');
      const key = 'versions:' + registry + encodeURIComponent(name);
      if (versionRequests.has(key)) return versionRequests.get(key);
      const fresh = record => record?.schema === 1 && record.name === name && record.registry === registry
        && Number.isFinite(record.loadedAt) && record.loadedAt <= now && now - record.loadedAt < VERSION_CACHE_TTL && Array.isArray(record.versions);
      const request = (async () => {
        let saved = versionCache.get(key);
        if (!fresh(saved)) saved = await waitForCache(key);
        if (fresh(saved)) { versionCache.set(key, saved); return saved.versions; }
        const response = await fetchImpl(registry + encodeURIComponent(name), {
          headers: { accept: 'application/json' }, credentials: 'omit', signal: AbortSignal.timeout(20000)
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const versions = npmVersions(name, await response.json());
        const record = { schema: 1, name, registry, loadedAt: now, versions };
        versionCache.set(key, record);
        void writeCache(key, record);
        return versions;
      })();
      versionRequests.set(key, request);
      try { return await request; } finally { versionRequests.delete(key); }
    }

    function versionInstall(entry, version) {
      if (version.install) return version.install;
      const source = version.source;
      return source.type === 'npm'
        ? { spec: `${entry.name}@${version.version}`, ...(source.registry ? { registry: source.registry } : {}) }
        : { spec: `git+${source.url.replace(/\.git$/, '')}.git#${source.commit}${source.path === undefined ? '' : `&path:/${source.path}`}` };
    }

    function versionChoices(entry, versions = [], registry) {
      const listed = entry.versions.map(version => ({ ...version, listed: true, requirements: version.engines?.dsh ? [version.engines.dsh] : [] }));
      const known = new Set(listed.map(version => version.version));
      return [...listed, ...versions.filter(version => !known.has(version.version)).map(version => ({ ...version,
        listed: false, source: { type: 'npm', registry }, install: { spec: `${entry.name}@${version.version}`, registry }
      }))];
    }

    function versionCommand(entry, version) {
      const spec = versionInstall(entry, version).spec;
      return 'dsh plugin --profile desktop add ' + (spec.includes('&') ? '"' + spec + '"' : spec);
    }

    async function requestSelfUpdate(target, t, { fetchImpl = fetch } = {}) {
      // Resolve locale text before the request can unload the context that supplied t.
      const unavailable = t('selfUpdateUnavailable'), unauthorized = t('selfUpdateUnauthorized'), lost = t('selfUpdateConnectionLost');
      const restart = t('updateRestart'), scripts = t('installNeedsDialog');
      try {
        const response = await fetchImpl('dsh-open-market/self-update', {
          method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(target)
        });
        if (response.status === 401 || response.status === 403) return { ok: false, error: unauthorized };
        if (!response.ok) return { ok: false, error: unavailable };
        const answer = await response.json();
        if (typeof answer?.ok !== 'boolean') return { ok: false, error: lost };
        if (answer.code === 'stop-profile') return { ...answer, error: restart };
        if (answer.code === 'install-needs-dialog') return { ...answer, error: scripts };
        return answer;
      } catch { return { ok: false, error: lost }; }
    }

    function updateSelf(target, t) {
      const messages = { working: t('selfUpdating'), done: t('selfUpdated'), restart: t('selfUpdatedRestart'), failed: t('selfUpdateFailed'), recovery: t('selfUpdateRecovery'), close: t('close') };
      // The notice belongs to this operation, not to the tab or plugin effects disposed by removal.
      const node = document.createElement('div'), text = document.createElement('span'), close = document.createElement('button');
      node.dataset.opmSelfUpdate = '';
      node.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2000;display:flex;align-items:start;gap:12px;max-width:calc(100vw - 32px);width:420px;box-sizing:border-box;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#202124);box-shadow:0 8px 32px #0002;font:13px/1.6 sans-serif;';
      text.style.cssText = 'flex:1;min-width:0;overflow-wrap:anywhere';
      text.setAttribute('role', 'status'); text.setAttribute('aria-live', 'polite');
      text.textContent = messages.working + ' ' + target.version;
      close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', messages.close);
      close.style.cssText = 'border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;padding:0 3px';
      close.onclick = () => node.remove();
      node.append(text, close); document.body.appendChild(node);
      return requestSelfUpdate(target, t).then(answer => {
        text.textContent = answer.ok ? answer.restart ? messages.restart : messages.done : messages.failed + ': ' + errorText(answer.error, messages.failed) + ' ' + messages.recovery;
        return answer;
      });
    }

    async function installVersion(entry, version, { install, manager, t, title = entry.name, onPhase = () => {}, busyLabel = 'busy', selfUpdate = updateSelf }) {
      if (entry.installation.status === 'provided') return { ok: false, error: t('providedVersion') };
      if (entry.name === 'dsh-open-market' && entry.installation.status !== 'not-installed') {
        onPhase('selfUpdating');
        const answer = await selfUpdate(installTarget({ ...versionInstall(entry, version), title, version: version.version }, getSettings()), t);
        return { ...answer, selfUpdate: true };
      }
      if (entry.installation.status !== 'not-installed') {
        const service = manager?.();
        if (!service?.removeBundle) return { ok: false, error: t('updateUnavailable') };
        onPhase('updating');
        const removed = await service.removeBundle(entry.name);
        if (!removed?.ok) return removed ?? { ok: false, error: t('unknownError') };
        const failure = removed.value?.error;
        if (failure) return { ok: false, error: failure.code === 'stop-profile' ? t('updateRestart') : failure };
        if (removed.value?.application === 'failed') return { ok: false, error: t('unknownError') };
        onPhase(busyLabel);
      }
      return install({ ...versionInstall(entry, version), title, version: version.version });
    }

    function validCatalog(record) {
      return record?.schema === CACHE_SCHEMA && record.index === INDEX_URL && Array.isArray(record.entries) && record.entries.length > 0
        && Number.isFinite(record.syncedAt);
    }

    function needsRefresh({ syncedAt, attemptedAt }, now) {
      return now - syncedAt >= REFRESH_INTERVAL && now - attemptedAt >= RETRY_INTERVAL;
    }

    function olderVersion(version, than) {
      const [a, b] = [EXACT_VERSION.exec(version), EXACT_VERSION.exec(than)];
      if (!a || !b) return false;
      for (let i = 1; i <= 3; i++) if (a[i] !== b[i]) return BigInt(a[i]) < BigInt(b[i]);
      if (!a[4] || !b[4]) return !!a[4] && !b[4];
      const left = a[4].split('.'), right = b[4].split('.');
      for (let i = 0; i < Math.max(left.length, right.length); i++) {
        if (left[i] === right[i]) continue;
        if (left[i] === undefined || right[i] === undefined) return left[i] === undefined;
        const numericLeft = /^\d+$/.test(left[i]), numericRight = /^\d+$/.test(right[i]);
        if (numericLeft !== numericRight) return numericLeft;
        return numericLeft ? BigInt(left[i]) < BigInt(right[i]) : left[i] < right[i];
      }
      return false;
    }

    // A cached snapshot can be hours old, while installs happen anywhere in DSH. Reading the bundles needs no network,
    // so a restored catalog gets the same status the market service would give it.
    function installationOf(entry, bundle) {
      if (!bundle || (!bundle.installed && bundle.availability !== 'installation')) return { status: 'not-installed' };
      const installedVersion = bundle.version;
      const version = installedVersion === undefined ? {} : { installedVersion };
      if (!bundle.installed) return { status: 'provided', ...version };
      if (installedVersion === undefined) return { status: 'different-version' };
      const offered = entry.defaultVersion ?? entry.versions?.[0]?.version;
      if (installedVersion === offered) return { status: 'installed', ...version };
      return { status: olderVersion(installedVersion, offered) ? 'update-available' : 'different-version', ...version };
    }

    function withInstallation(entries, bundles) {
      const byName = new Map(bundles.map(bundle => [bundle.name, bundle]));
      let changed = false;
      const result = entries.map(entry => {
        const installation = installationOf(entry, byName.get(entry.name));
        if (installation.status === entry.installation?.status && installation.installedVersion === entry.installation?.installedVersion) return entry;
        changed = true;
        return { ...entry, installation };
      });
      return changed ? result : entries;
    }

    // One catalog for the tab and both settings surfaces. It outlives the tab, so coming back shows it at once.
    let market = { status: 'loading', syncing: false, syncFailed: false, syncedAt: 0, attemptedAt: 0 };
    const marketListeners = new Set();
    const getMarket = () => market;
    function subscribeMarket(listener) {
      marketListeners.add(listener);
      return () => marketListeners.delete(listener);
    }
    function updateMarket(patch) {
      market = { ...market, ...patch };
      marketListeners.forEach(listener => listener());
    }
    function useMarket() {
      return React.useSyncExternalStore(subscribeMarket, getMarket, getMarket);
    }

    // Only the host reads the index. Each page is an explicit Remote result envelope.
    async function readCatalog(remote, refresh) {
      const entries = new Map();
      let offset = 0;
      let metadata;
      let fetchedAt;
      try {
        for (;;) {
          // Later pages name the first page's document, so a forced read fetches once and the pages stay consistent.
          const position = offset ? { fetchedAt } : refresh ? { refresh: true } : {};
          const answer = await remote.pluginMarket.search(INDEX_URL, {
            sort: { kind: 'key', id: 'recommended', direction: 'desc' }, offset, limit: 100, ...position
          });
          if (!answer.ok) {
            // The user removed our source from Discover; offer to add it back instead of an error.
            const missing = /unknown-index/.test(String(answer.error?.code ?? '')) || /not a configured index/i.test(String(answer.error?.message ?? ''));
            return missing ? { status: 'missing' } : { status: 'error', error: answer.error };
          }
          const page = answer.value;
          if (!Array.isArray(page?.entries) || (page.nextOffset !== null &&
              (!Number.isInteger(page.nextOffset) || page.nextOffset <= offset))) return { status: 'error', invalidPage: true };
          if (offset === 0) { metadata = page.metadata; fetchedAt = page.fetchedAt; }
          page.entries.forEach(entry => entries.set(entry.name, entry));
          if (page.nextOffset === null) {
            return { status: 'ready', entries: [...entries.values()], metadata, syncedAt: Number.isFinite(fetchedAt) ? fetchedAt : Date.now() };
          }
          offset = page.nextOffset;
        }
      } catch (error) {
        return { status: 'error', error };
      }
    }

    // The form DSH's market service gives each plugin, for hosts without that service. It cannot read engines.dsh here,
    // so every version counts as compatible and pluginManager.inspect refuses the wrong ones when installing.
    function listingOf(plugin) {
      const versions = plugin.versions.map(version => {
        const { source } = version;
        const install = source.type === 'npm'
          ? { spec: `${plugin.name}@${version.version}`, ...(source.registry === undefined ? {} : { registry: source.registry }) }
          : { spec: `git+${source.url.endsWith('.git') ? source.url : source.url + '.git'}#${source.commit}${source.path === undefined ? '' : `&path:/${source.path}`}` };
        return { ...version, install, compatibility: { compatible: true } };
      });
      const release = versions.find(version => !version.version.includes('-')) ?? versions[0];
      return { ...plugin, versions, ...(release ? { defaultVersion: release.version } : {}), installation: { status: 'not-installed' } };
    }

    async function readIndexFile() {
      try {
        const response = await fetch(INDEX_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
        if (!response.ok) return { status: 'error', error: 'HTTP ' + response.status };
        const index = await response.json();
        if (!Array.isArray(index?.plugins)) return { status: 'error', invalidPage: true };
        return { status: 'ready', entries: index.plugins.map(listingOf), metadata: index.metadata, syncedAt: Date.now() };
      } catch (error) {
        return { status: 'error', error };
      }
    }

    // Outside the Plugins page there is no install dialog to open, so the steps it runs happen here, without its prompts.
    async function installDirectly(manager, target, t) {
      const service = manager();
      if (!service?.inspect || !service.installBundle) return { ok: false, error: t('updateUnavailable') };
      const inspected = await service.inspect(target.spec, { registry: target.registry });
      if (!inspected?.ok) return inspected;
      if (inspected.value.status === 'refused') return { ok: false, error: inspected.value.reason };
      const { registry, selection, saveExact } = inspected.value;
      const result = await service.installBundle(target.spec, { enabled: selection ?? true, requestId: crypto.randomUUID(), registry,
        ...(saveExact === undefined ? {} : { saveExact }) });
      if (!result?.ok) return result;
      const { application, error, pendingBuilds } = result.value;
      if (application === 'failed') return { ok: false, error: pendingBuilds?.length ? t('installNeedsDialog') : error ?? t('unknownError') };
      return { ok: application !== 'cancelled', restart: application === 'restart-required', error: t('unknownError') };
    }

    let marketRemote;
    let marketManager;
    // True once the sidebar page exists; only then may the index be read without the market service.
    let readsIndexFile = false;
    let marketSync = null;
    let marketSyncQueued = false;
    // Never blocks the screen: with a catalog on screen a failed read only leaves it there.
    function syncMarket({ refresh = false, again = false } = {}) {
      if (marketSync) {
        // Installation status may have changed after this read started.
        if (again) marketSyncQueued = true;
        return marketSync;
      }
      const remote = marketRemote;
      if (!remote && !readsIndexFile) return Promise.resolve();
      updateMarket({ syncing: true, syncFailed: false, attemptedAt: Date.now(), ...(market.entries ? {} : { status: 'loading' }) });
      marketSync = (async () => {
        const result = remote ? await readCatalog(remote, refresh) : await readIndexFile();
        if (result.status === 'ready') {
          const { entries, metadata, syncedAt } = result;
          updateMarket({ status: 'ready', entries, metadata, syncedAt, syncing: false, error: undefined, invalidPage: false });
          if (!remote) void refreshInstallation(marketManager);
          void writeCache('market', { schema: CACHE_SCHEMA, index: INDEX_URL, entries, metadata, syncedAt });
        } else if (result.status === 'missing') updateMarket({ status: 'missing', syncing: false });
        else if (market.entries) updateMarket({ status: 'ready', syncing: false, syncFailed: true });
        else updateMarket({ ...result, syncing: false, syncFailed: true });
      })().finally(() => {
        marketSync = null;
        if (marketSyncQueued) {
          marketSyncQueued = false;
          void syncMarket();
        }
      });
      return marketSync;
    }

    let marketRestored = null;
    function restoreMarket() {
      marketRestored ??= waitForCache('market').then(saved => {
        if (!market.entries && validCatalog(saved)) {
          updateMarket({ status: 'ready', entries: saved.entries, metadata: saved.metadata, syncedAt: saved.syncedAt });
        }
      });
      return marketRestored;
    }

    async function refreshInstallation(manager) {
      try {
        const answer = await manager()?.listBundles?.();
        if (!answer?.ok) return;
        if (market.entries) {
          const entries = withInstallation(market.entries, answer.value);
          if (entries !== market.entries) updateMarket({ entries });
        }
        return answer.value;
      } catch { /* The next market read brings the same status. */ }
    }

    async function enterMarket(manager) {
      marketManager = manager;
      await restoreMarket();
      if (market.status === 'ready') {
        void refreshInstallation(manager);
        if (needsRefresh(market, Date.now())) void syncMarket();
      } else void syncMarket();
    }
    const LIKED_KEY = 'dsh-open-market:liked';
    const EMPTY_LIKES = {};

    function likesOrigin() {
      try {
        const url = new URL(window.localStorage.getItem('dsh-open-market:likes-origin'));
        if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin;
      } catch { /* Invalid overrides and unavailable storage use the public origin. */ }
      return LIKES_ORIGIN;
    }

    function utcDay() { return new Date().toISOString().slice(0, 10); }

    function saveLiked(day, names) {
      try { window.localStorage.setItem(LIKED_KEY, JSON.stringify({ day, names: [...names] })); } catch { /* Keep the in-memory state. */ }
    }

    function readLiked() {
      const day = utcDay();
      try {
        const saved = JSON.parse(window.localStorage.getItem(LIKED_KEY));
        if (saved?.day === day && Array.isArray(saved.names)) {
          return { day, names: new Set(saved.names.filter(name => typeof name === 'string')) };
        }
      } catch { /* Start a new UTC day when storage is unavailable or malformed. */ }
      saveLiked(day, []);
      return { day, names: new Set() };
    }

    // One immutable snapshot feeds every carousel/rail card through useSyncExternalStore.
    let likesState = { counts: EMPTY_LIKES, ...readLiked(), errors: {} };
    const likesListeners = new Set();
    const likesRevisions = new Map();
    const pendingLikes = new Map();
    const getLikes = () => likesState;
    function subscribeLikes(listener) {
      likesListeners.add(listener);
      return () => likesListeners.delete(listener);
    }
    function updateLikes(patch) {
      likesState = { ...likesState, ...patch };
      likesListeners.forEach(listener => listener());
    }
    function resetLikedDay() {
      const day = utcDay();
      if (likesState.day === day) return;
      pendingLikes.clear();
      saveLiked(day, []);
      updateLikes({ day, names: new Set(), errors: {} });
    }
    function setLikeCount(name, count, patch = {}) {
      likesRevisions.set(name, (likesRevisions.get(name) || 0) + 1);
      updateLikes({ ...patch, counts: { ...likesState.counts, [name]: count } });
    }
    function likeCount(counts, name) {
      return Number.isSafeInteger(counts[name]) && counts[name] > 0 ? counts[name] : 0;
    }

    function validLikes(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      return Object.fromEntries(Object.entries(value).filter(([, count]) => Number.isSafeInteger(count) && count > 0));
    }

    // One attempt; a cold server can take several seconds, so the caller tries twice.
    async function fetchLikeCounts(signal) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort);
      const timer = window.setTimeout(abort, 10000);
      try {
        const response = await fetch(likesOrigin() + '/likes.json', { signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (data?.schema !== 1) throw new Error();
        const counts = validLikes(data.likes);
        if (!counts) throw new Error();
        return counts;
      } finally {
        window.clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      }
    }

    function loadLikes() {
      const controller = new AbortController();
      const revisions = new Map(likesRevisions);
      let live = true;
      async function load() {
        let counts = null;
        for (let attempt = 0; attempt < 2 && live; attempt++) {
          try {
            counts = await fetchLikeCounts(controller.signal);
            break;
          } catch { /* Likes are optional; the rest of the market must always remain usable. */ }
        }
        // Without an answer the last counts stay on screen.
        if (!live || !counts) return;
        // A cached GET must not overwrite an optimistic vote or a newer POST response.
        for (const [name, revision] of likesRevisions) {
          if (revision !== revisions.get(name) || pendingLikes.has(name)) counts[name] = likeCount(likesState.counts, name);
        }
        updateLikes({ counts });
        void writeCache('likes', { schema: CACHE_SCHEMA, counts });
      }
      void restoreLikes().then(load);
      return () => { live = false; controller.abort(); };
    }

    async function sendLike(name, source) {
      if (!settings.likes) return;
      resetLikedDay();
      if (likesState.names.has(name)) return;
      const previous = likeCount(likesState.counts, name);
      const request = {};
      pendingLikes.set(name, request);
      const names = new Set(likesState.names).add(name);
      saveLiked(likesState.day, names);
      setLikeCount(name, previous + 1, { names, errors: { ...likesState.errors, [name]: undefined } });
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 5000);
      let failure = 'likeFailed';
      try {
        const response = await fetch(likesOrigin() + '/api/like', {
          method: 'POST', signal: controller.signal,
          headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ name, source })
        });
        if (response.status === 429) failure = 'likeLimit';
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (data?.name !== name || !Number.isSafeInteger(data.likes) || data.likes < 0 || typeof data.counted !== 'boolean') throw new Error();
        resetLikedDay();
        if (pendingLikes.get(name) === request) setLikeCount(name, data.likes);
      } catch {
        resetLikedDay();
        if (pendingLikes.get(name) === request) {
          const names = new Set(likesState.names);
          names.delete(name);
          saveLiked(likesState.day, names);
          setLikeCount(name, previous, { names,
            errors: { ...likesState.errors, [name]: source === 'like' ? failure : undefined } });
        }
      } finally {
        if (pendingLikes.get(name) === request) pendingLikes.delete(name);
        window.clearTimeout(timer);
      }
    }

    let likesRestored = null;
    function restoreLikes() {
      likesRestored ??= waitForCache('likes').then(saved => {
        const counts = saved?.schema === CACHE_SCHEMA ? validLikes(saved.counts) : null;
        if (counts && likesState.counts === EMPTY_LIKES) updateLikes({ counts });
      });
      return likesRestored;
    }

    function useLikes(enabled) {
      const snapshot = React.useSyncExternalStore(subscribeLikes, getLikes, getLikes);
      React.useEffect(() => {
        resetLikedDay();
        const timer = window.setInterval(resetLikedDay, 60000);
        window.addEventListener('focus', resetLikedDay);
        return () => { window.clearInterval(timer); window.removeEventListener('focus', resetLikedDay); };
      }, []);
      React.useEffect(() => {
        if (enabled) return loadLikes();
      }, [enabled, snapshot.day]);
      return snapshot;
    }

    const NS = 'openMarket';
    const zh = {
      title: '开放市场', loading: '正在读取开放插件市场…',
      searchPlaceholder: '搜索插件名称、作者或描述',
      resultCount: '{count} 个插件', noResults: '没有找到匹配的插件', showMore: '显示更多', clearSearch: '清除', failed: '读取失败', retry: '重试',
      missingTitle: '开放插件市场不在索引源中', missingBody: '它可能在「发现」里被删掉了。添加后这里和「发现」都能看到。', addSource: '添加索引源',
      today: '今日推荐', recommended: '智能推荐', popular: '最受欢迎', trending: '增长最快',
      newest: '最新发布', health: '我已安装',
      todayHint: '每天更新，按点赞和推荐加权', recommendedHint: '近期活跃，也留位置给新收录的插件', popularHint: '按近期点赞',
      trendingHint: '近 7 天下载增长', newestHint: '按发布时间', stars: 'GitHub star {count}',
      close: '关闭', homepage: '主页', sourceCode: '源码', marketPage: '在开放插件市场网站查看',
      copy: '复制', copied: '已复制', installCommand: '安装命令', likeCount: '点赞 {count}',
      otherVersions: '其他版本', versionsLoading: '正在读取版本…', versionsFailed: '版本列表读取失败',
      versionsHelp: '其他 npm 版本未经过本站审查；兼容范围由作者声明，安装时由 DSH 检查。',
      gitVersionsHelp: 'Git 来源只列出索引已确认的固定提交，不自动读取标签。',
      noOtherVersions: '没有其他可安装的版本', listedVersion: '当前收录', prereleaseVersion: '预发布',
      unreviewedVersion: '本站未审查', dshRangeUnknown: '未声明 DSH 范围', switchVersion: '切换到此版本',
      versionAction: '{action} {version}', moreVersions: '显示更多版本', copyVersion: '复制 {version} 的安装命令',
      providedVersion: '随 DSH 提供',
      selfUpdating: '正在更新开放市场…', selfUpdated: '开放市场已更新，可重新打开市场。', selfUpdatedRestart: '开放市场已更新，重启 DSH 后生效。',
      selfUpdateFailed: '开放市场更新未完成', selfUpdateUnavailable: '自更新服务不可用，请从「插件」页或使用安装命令更新。',
      selfUpdateRecovery: '若已卸载，请从「插件」页重新安装开放市场。',
      selfUpdateUnauthorized: '请先登录当前 DSH，再更新开放市场。', selfUpdateConnectionLost: '连接中断，宿主可能仍在更新；请到「插件 → 已安装」确认结果。',
      selfUpdateHint: '开放市场由宿主继续完成自更新，期间市场页面可能暂时关闭。',
      noCompatibleVersion: '这个插件没有兼容当前 DSH 的版本', dateLocale: 'zh-CN',
      updates: '可更新', incompatibleGroup: '不兼容当前 DSH',
      upToDate: '已安装的插件都是最新的',
      install: '安装', notInstalled: '未安装', installed: '已安装', updateAvailable: '有更新', update: '更新',
      incompatible: '不兼容', busy: '正在打开…', updating: '正在卸载旧版本…', actionFailed: '无法打开插件操作',
      updateHint: '先卸载当前版本，再打开新版本的安装', updateRestart: '这个插件正在运行，DSH 重启后才能更新，请重启后再试',
      updateUnavailable: '当前 DSH 不支持在这里更新，请到「已安装」里卸载后重新安装',
      unknownError: '未知错误', invalidPage: '市场返回了无效的分页数据', unknownVersion: '版本未知',
      noDescription: '暂无描述', sectionEmpty: '暂无符合条件的插件',
      previous: '向左浏览 {section}', next: '向右浏览 {section}',
      source: '数据来自开放插件市场', sourceLink: 'dshopen.org', newWindow: '在新窗口打开',
      recommendationPosition: '查看第 {number} 组推荐', settings: '设置', about: '关于',
      autoRotate: '今日推荐自动轮播', showInstalled: '在推荐和全部插件中显示已安装的插件', showCheckup: '显示「我已安装」按钮', installing: '正在安装…', sidebarMarket: '在侧边栏显示开放市场', sidebarMarketHelp: '单独的全宽页面，适合「插件」页没有开放市场标签的旧版 DSH。从这里安装时不弹安装窗口；需要确认安装脚本的插件请到「插件」页安装。', installNeedsDialog: '这个插件需要确认安装脚本，请到「插件」页安装', installedRestart: '已安装，重启 DSH 后生效',
      settingsDisplay: '显示', settingsData: '数据与同步', settingsDownload: '下载', settingsConversation: '对话',
      syncData: '市场数据', syncNow: '同步最新数据', syncing: '正在同步…', syncedAt: '上次同步：{time}', neverSynced: '还没有同步过',
      syncFailed: '同步失败，继续显示已有数据', syncUnavailable: '打开「自定义插件市场」后才能同步', syncHelp: '打开市场时先显示本机保存的数据，每 6 小时在后台更新一次，不影响正常浏览。',
      registryLabel: '从哪个源下载', registryIndex: 'npm 官方源', registryDsh: '跟随 DSH 的安装源', registryNpmmirror: '中国大陆镜像源', registryCustom: '自定义地址',
      registryPlaceholder: 'https://npm.example.com/', registryInvalid: '请输入以 http:// 或 https:// 开头、不含账号密码的地址',
      registryHelp: '在开放市场里安装和更新 npm 插件时先问这个源，连不上或还没同步到这个包时，DSH 通常会改问另一个可信的源。Git 来源的插件直接从 GitHub 下载；DSH 自己的「发现」页不受这里影响。',
      registryCustomHelp: '自定义地址只问这一个源，不会回退到其他源。需要登录的源，请把凭据放在本机的 ~/.npmrc 里。',
      autoReview: '新对话自动使用「自动审查」', autoReviewHelp: '打开后，每个新对话都直接使用 DSH 的实验性「自动审查」权限，不用每次手动选择、确认两次；DSH 没开「自动审查」时会一并打开，可能需要重启 DSH 生效。自动审查由当前模型判断每次工具调用，可能误放行或误拒绝，并消耗额外 token。', autoReviewRestart: '已保存，重启 DSH 后生效', autoReviewFailed: '切换失败：{reason}',
      likes: '参与点赞', likesHelp: '点赞和安装会向 dshopen.org 发送匿名请求，用于推荐排序；每人每天每个插件计一次，点赞每 3 天减少 1。',
      like: '点赞', likedToday: '今天已经点过赞了', likeLimit: '今天点赞次数已达上限', likeFailed: '点赞失败，请稍后再试',
      browseAll: '翻阅全部 {count} 个插件', allPlugins: '全部插件', allHint: '{count} 个插件', sortBy: '排序', sortStars: '星数最多', collapse: '收起',
      upToDateGroup: '状态正常', noneInstalled: '还没有安装开放市场里的插件',
      starCta: '有帮助到你吗？支持我们只需要点 star 哦', starLink: '在 GitHub 上给 {repo} 点 star',
      contributeCta: '你也有好的插件想要收录给我们？欢迎加入！', contributeEnd: '贡献指南', contributing: '贡献指南', contributingUrl: CONTRIBUTING_URL,
      favorites: '收藏夹', favorite: '收藏', unfavorite: '取消收藏', chooseGroup: '选择收藏夹', defaultGroup: '默认收藏夹',
      newGroup: '新建收藏夹', groupName: '收藏夹名称', save: '保存', cancel: '取消', rename: '重命名', deleteGroup: '删除收藏夹',
      deleteConfirm: '删除收藏夹「{name}」？里面的插件不会被卸载。', enableAll: '全部启用', disableAll: '全部停用',
      enable: '启用', disable: '停用', enabled: '已启用', disabled: '已停用', remove: '移出收藏夹',
      addPackage: '添加', packagePlaceholder: '添加任意插件的 npm 包名，如 dsh-context', invalidPackage: '不是有效的 npm 包名',
      alreadySaved: '这个插件已经在当前收藏夹里了', emptyGroup: '这个收藏夹还没有插件。在卡片上点 ☆，或在上面输入包名添加。',
      importFavorites: '导入', exportFavorites: '导出', imported: '已导入 {count} 个插件', exported: '已导出收藏夹',
      importFailed: '导入失败：文件不是收藏夹格式', enabledCount: '已启用 {count} 个插件', disabledCount: '已停用 {count} 个插件',
      nothingToChange: '没有需要切换的已安装插件', restartNeeded: '，部分插件重启 DSH 后生效',
      toggleUnavailable: '当前 DSH 不支持在这里启用或停用插件', selfSkipped: '开放市场本身不会被停用',
      website: '官网', websiteUrl: 'https://dshopen.org/zh/', repository: 'GitHub 仓库', submitPlugin: '提交插件', indexAddress: '索引地址'
    };
    const en = {
      title: 'Open Market', loading: 'Loading Open Plugin Market…',
      searchPlaceholder: 'Search plugins by name, author or description',
      resultCount: '{count} plugins', noResults: 'No matching plugins', showMore: 'Show more', clearSearch: 'Clear', failed: 'Could not load the market', retry: 'Retry',
      missingTitle: 'Open Plugin Market is not an index source', missingBody: 'It may have been removed in Discover. Add it back to see it here and in Discover.', addSource: 'Add index source',
      today: 'Today’s picks', recommended: 'Recommended', popular: 'Most popular', trending: 'Fastest growing',
      newest: 'Newly published', health: 'Installed',
      todayHint: 'Daily, weighted by likes and recommendations', recommendedHint: 'Active plugins, with room for new listings', popularHint: 'By recent likes',
      trendingHint: '7-day download growth', newestHint: 'By publication date', stars: '{count} GitHub stars',
      close: 'Close', homepage: 'Homepage', sourceCode: 'Source code', marketPage: 'View on Open Plugin Market',
      copy: 'Copy', copied: 'Copied', installCommand: 'Install command', likeCount: '{count} likes',
      otherVersions: 'Other versions', versionsLoading: 'Loading versions…', versionsFailed: 'Could not load versions',
      versionsHelp: 'Other npm versions have not been reviewed here. Compatibility ranges are publisher declarations; DSH checks the package when installing.',
      gitVersionsHelp: 'Git sources list only the fixed commits in this index. Tags are not loaded automatically.',
      noOtherVersions: 'No other installable versions', listedVersion: 'Listed version', prereleaseVersion: 'Prerelease',
      unreviewedVersion: 'Not reviewed here', dshRangeUnknown: 'No DSH range declared', switchVersion: 'Switch to this version',
      versionAction: '{action} {version}', moreVersions: 'Show more versions', copyVersion: 'Copy the install command for {version}',
      providedVersion: 'Provided by DSH',
      selfUpdating: 'Updating Open Market…', selfUpdated: 'Open Market updated. You can reopen the market.', selfUpdatedRestart: 'Open Market updated. Restart DSH to use it.',
      selfUpdateFailed: 'Open Market update did not finish', selfUpdateUnavailable: 'Self-update is unavailable. Update from Plugins or with the install command.',
      selfUpdateRecovery: 'If Open Market was removed, reinstall it from Plugins.',
      selfUpdateUnauthorized: 'Sign in to this DSH before updating Open Market.', selfUpdateConnectionLost: 'Connection lost. The Host may still be updating; check the version under Plugins → Installed.',
      selfUpdateHint: 'DSH completes Open Market’s self-update even if the market page closes temporarily.',
      noCompatibleVersion: 'This plugin has no version compatible with your DSH', dateLocale: 'en',
      updates: 'Updates available', incompatibleGroup: 'Incompatible with this DSH version',
      upToDate: 'Installed plugins are all up to date',
      install: 'Install', notInstalled: 'Not installed', installed: 'Installed', updateAvailable: 'Update available', update: 'Update',
      incompatible: 'Incompatible', busy: 'Opening…', updating: 'Removing the old version…', actionFailed: 'Could not open the plugin action',
      updateHint: 'Removes the current version, then opens the install for the new one', updateRestart: 'This plugin is running; restart DSH, then update it',
      updateUnavailable: 'This DSH cannot update plugins from here; uninstall it under Installed and install it again',
      unknownError: 'Unknown error', invalidPage: 'The market returned invalid pagination data', unknownVersion: 'Unknown version',
      noDescription: 'No description available',
      sectionEmpty: 'No matching plugins yet', previous: 'Browse {section} left', next: 'Browse {section} right',
      source: 'Data from Open Plugin Market', sourceLink: 'dshopen.org', newWindow: 'Opens in a new window',
      recommendationPosition: 'Show recommendation group {number}', settings: 'Settings', about: 'About',
      autoRotate: 'Auto-rotate today’s picks', showInstalled: 'Show installed plugins in recommendations and All plugins', showCheckup: 'Show the Installed button', installing: 'Installing…', sidebarMarket: 'Show Open Market in the sidebar', sidebarMarketHelp: 'A separate full-width page, for older DSH versions without the Open Market tab on the Plugins page. Installs from it skip the install dialog; a plugin whose install scripts need approval has to be installed from Plugins.', installNeedsDialog: 'This plugin needs its install scripts approved. Install it from Plugins.', installedRestart: 'Installed. Restart DSH to use it.',
      settingsDisplay: 'Display', settingsData: 'Data and sync', settingsDownload: 'Downloads', settingsConversation: 'Conversations',
      syncData: 'Market data', syncNow: 'Sync latest data', syncing: 'Syncing…', syncedAt: 'Last synced: {time}', neverSynced: 'Not synced yet',
      syncFailed: 'Sync failed; showing the data already here', syncUnavailable: 'Turn on Custom plugin markets to sync', syncHelp: 'The market opens with the data saved on this computer and updates in the background every six hours, so browsing is never held up.',
      registryLabel: 'Download from', registryIndex: 'Official npm registry', registryDsh: 'Same as DSH', registryNpmmirror: 'Mainland China mirror', registryCustom: 'Custom address',
      registryPlaceholder: 'https://npm.example.com/', registryInvalid: 'Enter an http:// or https:// address without a username or password',
      registryHelp: 'Installs and updates of npm plugins from Open Market ask this registry first. When it is unreachable or has no copy of the package yet, DSH usually asks another trusted one. Git plugins download straight from GitHub, and DSH’s own Discover tab is not affected.',
      registryCustomHelp: 'A custom address is asked alone, with no fallback. If it requires a login, keep the credentials in ~/.npmrc on this computer.',
      autoReview: 'Start new conversations in Auto review', autoReviewHelp: "Every new conversation uses DSH's experimental Auto review permission, so you no longer pick and confirm it each time. If Auto review is off in DSH it is switched on too, which may need a restart. Auto review asks the current model about each tool call; it can wrongly allow or refuse actions and uses extra tokens.", autoReviewRestart: 'Saved; restart DSH for it to take effect', autoReviewFailed: 'Could not switch: {reason}',
      likes: 'Join likes', likesHelp: 'Likes and installs send anonymous requests to dshopen.org for recommendation ranking; each person counts once per plugin per UTC day, and likes decrease by 1 every 3 days.',
      like: 'Like', likedToday: 'Already liked today', likeLimit: 'Daily like limit reached', likeFailed: 'Could not like this plugin. Please try again later',
      browseAll: 'Browse all {count} plugins', allPlugins: 'All plugins', allHint: '{count} plugins', sortBy: 'Sort', sortStars: 'Most stars', collapse: 'Collapse',
      upToDateGroup: 'Up to date', noneInstalled: 'No plugins from Open Market are installed yet',
      starCta: 'Did this help you? A star is all it takes to support us', starLink: 'Star {repo} on GitHub',
      contributeCta: 'Have a great plugin of your own? Come and join us!', contributeEnd: 'Contribute', contributing: 'Contributing guide', contributingUrl: CONTRIBUTING_URL,
      favorites: 'Favorites', favorite: 'Save to favorites', unfavorite: 'Remove from favorites', chooseGroup: 'Choose a group', defaultGroup: 'Default',
      newGroup: 'New group', groupName: 'Group name', save: 'Save', cancel: 'Cancel', rename: 'Rename', deleteGroup: 'Delete group',
      deleteConfirm: 'Delete the group “{name}”? Its plugins stay installed.', enableAll: 'Enable all', disableAll: 'Disable all',
      enable: 'Enable', disable: 'Disable', enabled: 'Enabled', disabled: 'Disabled', remove: 'Remove from group',
      addPackage: 'Add', packagePlaceholder: 'Add any plugin by npm package name, e.g. dsh-context', invalidPackage: 'Not a valid npm package name',
      alreadySaved: 'This plugin is already in this group', emptyGroup: 'No plugins here yet. Click ☆ on a card, or add a package name above.',
      importFavorites: 'Import', exportFavorites: 'Export', imported: 'Imported {count} plugins', exported: 'Favorites exported',
      importFailed: 'Could not import: not a favorites file', enabledCount: 'Enabled {count} plugins', disabledCount: 'Disabled {count} plugins',
      nothingToChange: 'No installed plugins to switch', restartNeeded: '; some take effect after restarting DSH',
      toggleUnavailable: 'This DSH cannot enable or disable plugins from here', selfSkipped: 'Open Market itself is never disabled',
      website: 'Website', websiteUrl: 'https://dshopen.org/', repository: 'GitHub repository', submitPlugin: 'Submit a plugin', indexAddress: 'Index address'
    };

    // In the light theme every DSH layer is white, so cards sit on the grey module fill to stand apart from the page.
    const STYLES = `
      .opm-root { min-width: 0; width: 100%; padding: 0 0 12px; box-sizing: border-box;
        color: var(--dsw-alias-label-primary); line-height: 1.5; }
      /* DSH puts a fixed 32px gap between the tab bar and the tab panel; pull the search halfway into it. */
      /* Rows bleed into the page gutter, so the edges fade there and leave the cards their full width. useRowBleed sizes it. */
      .opm-market { margin-top: -16px; --opm-bleed: 8px; }
      .opm-root *, .opm-root *::before, .opm-root *::after { box-sizing: border-box; }
      .opm-root h2, .opm-root h3, .opm-root p { margin: 0; }
      .opm-root h2, .opm-root h3 { font-size: 14px; font-weight: 600; }
      .opm-root button, .opm-root a, .opm-root summary { -webkit-tap-highlight-color: var(--dsw-alias-interactive-bg-active); }
      .opm-root :focus-visible { outline: 2px solid var(--dsw-alias-label-primary); outline-offset: 3px; }
      .opm-root ::selection { background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); }
      .opm-section { margin-top: 12px; min-width: 0; }
      .opm-page { height: 100%; min-height: 0; overflow: hidden auto; }
      .opm-page-inner { width: 100%; max-width: 1120px; margin: 0 auto; padding: 32px 48px 24px; box-sizing: border-box; }
      .opm-page-head h1 { margin: 0 0 16px; font-size: 20px; font-weight: 600; color: var(--dsw-alias-label-primary); }
      .opm-page .opm-market { margin-top: 0; }
      .opm-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 22px; margin-bottom: 6px; }
      .opm-heading-copy { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
      .opm-heading-copy h2 { flex-shrink: 0; }
      .opm-heading-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary); overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap; }
      .opm-button { font: inherit; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
        min-height: 32px; padding: 6px 12px; border: 0; border-radius: var(--dsw-radius-sm);
        background: var(--dsw-alias-button-elevated-fill); color: var(--dsw-alias-label-primary);
        cursor: pointer; font-size: 13px; font-weight: 500; line-height: 1.4; }
      /* In the light theme buttons and cards are both white, so outline the plain buttons. */
      .opm-button:not(.opm-button-primary) { box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2); }
      .opm-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
      .opm-button:active:not(:disabled) { background: var(--dsw-alias-interactive-bg-active); }
      .opm-button-primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
      .opm-button-primary:hover:not(:disabled), .opm-button-primary:active:not(:disabled) { opacity: .85; background: var(--dsw-alias-button-primary-fill); }
      .opm-button:disabled { cursor: default; color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-interactive-bg-hover); }
      .opm-button-small { min-height: 28px; padding: 4px 9px; font-size: 12px; }
      .opm-like { gap: 3px; font-variant-numeric: tabular-nums; }
      .opm-like:disabled { color: var(--dsw-alias-state-warn-primary); background: var(--dsw-alias-button-elevated-fill); }
      .opm-author { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 16px; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap; }
      .opm-description { color: var(--dsw-alias-label-secondary); font-size: 13px; overflow-wrap: anywhere; }
      .opm-icon { width: 36px; height: 36px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
        overflow: hidden; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-interactive-bg-hover);
        color: var(--dsw-alias-label-secondary); font-size: 22px; font-weight: 600; }
      .opm-icon-large { width: 56px; height: 56px; font-size: 28px; }
      .opm-icon img { display: block; width: 100%; height: 100%; object-fit: contain; }
      .opm-tags { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
      .opm-tag { max-width: 100%; padding: 0 6px; border: 1px solid var(--dsw-alias-border-l2);
        border-radius: var(--dsw-radius-sm); font-size: 11px; line-height: 16px;
        color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .opm-tag-verified { color: var(--dsw-alias-state-success-primary); }
      .opm-tag-trending { color: var(--dsw-alias-state-warn-primary); }
      .opm-tag-active { color: var(--dsw-alias-button-info-fill); }
      .opm-tag-stars { color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
      .opm-list { position: relative; display: flow-root; min-width: 0; }
      .opm-arrow { position: absolute; z-index: 2; top: 50%; display: inline-flex; align-items: center; justify-content: center;
        width: 32px; height: 32px; padding: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 50%;
        background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 82%, transparent); box-shadow: var(--dsw-elevation-soft);
        -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); color: var(--dsw-alias-label-primary);
        cursor: pointer; opacity: 0; pointer-events: none; transform: translateY(-50%) scale(.92);
        transition: opacity 150ms ease-out, transform 150ms ease-out, border-color 150ms ease-out; }
      .opm-arrow svg { width: 16px; height: 16px; }
      .opm-arrow-previous { left: calc(-1 * var(--opm-bleed) + 4px); }
      .opm-arrow-next { right: calc(-1 * var(--opm-bleed) + 4px); }
      .opm-section:hover .opm-arrow:not(:disabled), .opm-section:focus-within .opm-arrow:not(:disabled),
      .opm-carousel:hover .opm-arrow:not(:disabled), .opm-carousel:focus-within .opm-arrow:not(:disabled) { opacity: 1; pointer-events: auto; transform: translateY(-50%); }
      .opm-arrow:hover:not(:disabled) { border-color: var(--dsw-alias-border-l3); transform: translateY(-50%) scale(1.08) !important; }
      .opm-arrow:active:not(:disabled) { transform: translateY(-50%) scale(.96) !important; }
      .opm-rail, .opm-carousel-viewport { display: flex; align-items: stretch; gap: 10px; overflow-x: auto; overscroll-behavior-x: contain;
        scrollbar-width: none; padding: 24px var(--opm-bleed); margin: -24px calc(-1 * var(--opm-bleed)); scroll-padding-inline: var(--opm-bleed); }
      /* Rails start at staggered offsets, so only today's picks snap, one gutter along (see restingOffset). */
      .opm-carousel-viewport { scroll-snap-type: x proximity; scroll-padding-left: 0; }
      .opm-rail::-webkit-scrollbar, .opm-carousel-viewport::-webkit-scrollbar { display: none; }
      .opm-card { flex: 0 0 220px; width: 220px; min-width: 0; scroll-snap-align: start; padding: 12px;
        display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--dsw-alias-border-l2);
        border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-module-platform); cursor: pointer;
        transition: transform 150ms ease-out, box-shadow 150ms ease-out, border-color 150ms ease-out; }
      @media (hover: hover) {
        .opm-card:hover { transform: translateY(-2px) scale(1.02); box-shadow: var(--dsw-elevation-soft); border-color: var(--dsw-alias-border-l3); }
      }
      .opm-card-heading { display: flex; gap: 8px; align-items: center; min-width: 0; }
      .opm-card-copy { min-width: 0; flex: 1; }
      .opm-card .opm-title { line-height: 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .opm-card .opm-description { display: -webkit-box; -webkit-line-clamp: 2;
        -webkit-box-orient: vertical; overflow: hidden; }
      .opm-card-action { display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin-top: auto; }
      .opm-card .opm-tags { flex-wrap: nowrap; overflow: hidden; }
      .opm-card .opm-tag { white-space: nowrap; flex-shrink: 0; }
      .opm-carousel { min-width: 0; margin-top: 12px; }
      /* Rails fade and blur into whichever edge still has cards beyond it. */
      @property --opm-fade-start { syntax: '<length>'; inherits: true; initial-value: 0px; }
      @property --opm-fade-end { syntax: '<length>'; inherits: true; initial-value: 0px; }
      .opm-list-fade { --opm-fade-start: 0px; --opm-fade-end: 0px; transition: --opm-fade-start 200ms ease-out, --opm-fade-end 200ms ease-out; }
      .opm-list-fade[data-fade-start] { --opm-fade-start: calc(var(--opm-bleed) + 12px); }
      .opm-list-fade[data-fade-end] { --opm-fade-end: calc(var(--opm-bleed) + 12px); }
      .opm-list-fade > .opm-rail, .opm-list-fade > .opm-carousel-viewport {
        -webkit-mask-image: linear-gradient(to right, transparent, #000 var(--opm-fade-start), #000 calc(100% - var(--opm-fade-end)), transparent);
        mask-image: linear-gradient(to right, transparent, #000 var(--opm-fade-start), #000 calc(100% - var(--opm-fade-end)), transparent); }
      .opm-list-fade::before, .opm-list-fade::after { content: ''; position: absolute; z-index: 1; top: 0; bottom: 0; width: var(--opm-bleed);
        pointer-events: none; opacity: 0; transition: opacity 200ms ease-out;
        -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); }
      .opm-list-fade::before { left: calc(-1 * var(--opm-bleed)); -webkit-mask-image: linear-gradient(to right, #000, transparent); mask-image: linear-gradient(to right, #000, transparent); }
      .opm-list-fade::after { right: calc(-1 * var(--opm-bleed)); -webkit-mask-image: linear-gradient(to left, #000, transparent); mask-image: linear-gradient(to left, #000, transparent); }
      .opm-list-fade[data-fade-start]::before, .opm-list-fade[data-fade-end]::after { opacity: 1; }
      .opm-featured-slide { min-width: 0; flex-shrink: 0; display: flex; scroll-snap-align: start; }
      .opm-featured-card { width: 100%; flex: 1 1 auto; }
      .opm-dots { display: flex; align-items: center; flex-shrink: 0; }
      .opm-dot { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 22px;
        padding: 0; border: 0; background: none; cursor: pointer; border-radius: var(--dsw-radius-sm); }
      .opm-dot::after { content: ''; width: 6px; height: 6px; border-radius: var(--dsw-radius-sm);
        background: var(--dsw-alias-border-l3); }
      .opm-dot[aria-current="true"]::after { width: 14px; background: var(--dsw-alias-label-primary); }
      .opm-dot:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .opm-health-group { margin-top: 6px; }
      .opm-health-group > h3 { margin-bottom: 4px; }
      .opm-health-list { list-style: none; margin: 0; padding: 0; }
      .opm-health-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 5px 0; }
      .opm-health-row + .opm-health-row { border-top: 1px solid var(--dsw-alias-border-l2); }
      .opm-health-copy { flex: 1; min-width: 0; }
      .opm-health-title { font-size: 14px; overflow-wrap: anywhere; }
      .opm-version { font-size: 12px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
      .opm-muted { color: var(--dsw-alias-label-secondary); font-size: 13px; }
      .opm-state { padding: 18px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg);
        background: var(--dsw-alias-bg-module-platform); }
      .opm-state .opm-button { margin-top: 10px; }
      .opm-error { color: var(--dsw-alias-state-warn-primary); font-size: 13px; overflow-wrap: anywhere; }
      .opm-error-detail { margin-top: 8px !important; white-space: pre-wrap; }
      .opm-action-error { margin-top: 12px !important; }
      .opm-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px;
        margin-top: 16px; font-size: 12px; }
      /* Both footer links share one pill: a round mark, the text, then a highlighted end. */
      .opm-footer-link { display: inline-flex; align-items: center; gap: 8px; min-height: 32px; padding: 4px 4px 4px 4px; text-decoration: none;
        border: 1px solid var(--dsw-alias-border-l2); border-radius: 999px; background: var(--dsw-alias-bg-module-platform);
        color: var(--dsw-alias-label-secondary); transition: border-color 150ms ease-out, color 150ms ease-out; }
      .opm-footer-link:hover { color: var(--dsw-alias-label-primary); border-color: var(--dsw-alias-border-l3); }
      .opm-footer-mark { width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0; object-fit: cover; background: var(--dsw-alias-interactive-bg-hover); }
      .opm-footer-end { display: inline-flex; align-items: center; gap: 4px; padding: 2px 9px; border-radius: 999px;
        background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); font-weight: 600; font-variant-numeric: tabular-nums; }
      .opm-footer-end svg { width: 13px; height: 13px; flex-shrink: 0; }
      .opm-footer-end .opm-footer-star { color: #e59a00; }
      /* Both messages share one grid cell, so the pill keeps its width while they cross-fade. */
      .opm-swap { display: inline-grid; align-items: center; }
      .opm-swap > span { grid-area: 1 / 1; display: inline-flex; align-items: center; gap: 4px; opacity: 0; visibility: hidden;
        transition: opacity 400ms ease-out, visibility 400ms; }
      .opm-swap > span[data-on] { opacity: 1; visibility: visible; }
      .opm-browse { display: flex; justify-content: center; margin-top: 16px; }
      /* The open catalog takes the page gutters too; its arrows ride along the screen while the grid scrolls. */
      .opm-all-heading { flex-wrap: wrap; }
      .opm-all-controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; min-width: 0; margin-left: auto; }
      .opm-all-body { position: relative; margin-inline: calc(-1 * var(--opm-bleed)); }
      .opm-all-arrows { position: sticky; z-index: 2; top: 45%; height: 0; }
      .opm-all-arrows .opm-arrow-previous { left: 4px; }
      .opm-all-arrows .opm-arrow-next { right: 4px; }
      .opm-installed-button small { color: var(--dsw-alias-state-warn-primary); font-size: 11px; font-weight: 600; }
      .opm-footer a { color: var(--dsw-alias-label-secondary); text-underline-offset: 3px; }
      .opm-footer a:hover { color: var(--dsw-alias-label-primary); }
      .opm-skeleton { background: var(--dsw-alias-bg-skeleton); border-radius: var(--dsw-radius-sm); }
      .opm-skeleton-title { height: 22px; width: 45%; margin-bottom: 8px; }
      .opm-skeleton-search { height: 32px; max-width: 360px; border-radius: var(--dsw-radius-md); }
      .opm-skeleton-card { height: 148px; border: 0; background: var(--dsw-alias-bg-skeleton); }
      .opm-settings { display: flex; flex-direction: column; gap: 12px; max-width: 620px; padding: 0; font-size: 13px; }
      .opm-settings-group { padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md);
        background: var(--dsw-alias-bg-module-platform); }
      .opm-settings h2 { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-secondary); margin-bottom: 2px; }
      .opm-setting-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 32px; padding: 4px 0; }
      .opm-setting-row + .opm-setting-row { border-top: 1px solid var(--dsw-alias-border-l2); }
      .opm-setting-copy { display: flex; flex-direction: column; min-width: 0; }
      .opm-setting-label { color: var(--dsw-alias-label-primary); }
      .opm-setting-value { color: var(--dsw-alias-label-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }
      .opm-setting-value-error { color: var(--dsw-alias-state-warn-primary); }
      .opm-setting-help { margin-top: 2px !important; color: var(--dsw-alias-label-caption); font-size: 12px; }
      .opm-setting-block { padding: 4px 0; }
      .opm-setting-block .opm-chips { margin-top: 6px; }
      .opm-setting-block .opm-input { width: 100%; height: 30px; margin-top: 8px; }
      .opm-setting-block .opm-error { margin-top: 2px !important; font-size: 12px; }
      .opm-checkbox { display: flex; align-items: center; gap: 8px; cursor: pointer; }
      .opm-checkbox input { margin: 0; accent-color: var(--dsw-alias-button-primary-fill); }
      .opm-about-link { display: block; width: fit-content; padding: 4px 0;
        color: var(--dsw-alias-label-secondary); text-underline-offset: 3px; }
      .opm-about-link:hover { color: var(--dsw-alias-label-primary); }
      .opm-index-address { margin-top: 6px !important; color: var(--dsw-alias-label-secondary); }
      .opm-index-address code { display: block; user-select: text; overflow-wrap: anywhere; font-size: 12px; }
      .opm-overlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center;
        background: var(--dsw-alias-bg-mask-1); }
      .opm-panel { position: relative; width: min(560px, calc(100% - 32px)); max-height: calc(100vh - 64px); overflow-y: auto;
        padding: 24px; border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-1);
        box-shadow: var(--dsw-elevation-prominent); overscroll-behavior: contain; scrollbar-color: var(--dsw-alias-border-l3) var(--dsw-alias-bg-layer-1); }
      .opm-panel-close { position: absolute; top: 12px; right: 12px; padding: 0; width: 28px; }
      .opm-panel-heading { display: flex; align-items: center; gap: 12px; padding-right: 28px; margin-bottom: 16px; }
      .opm-panel-heading h2 { font-size: 18px; overflow-wrap: anywhere; }
      .opm-panel .opm-author { white-space: normal; overflow-wrap: anywhere; }
      .opm-panel > .opm-tags, .opm-panel-description, .opm-panel-info, .opm-panel-links, .opm-command, .opm-panel-actions { margin-top: 16px !important; }
      .opm-panel-description { white-space: pre-wrap; }
      .opm-panel-info, .opm-panel-links { display: flex; flex-wrap: wrap; gap: 6px 12px; }
      .opm-panel-links a { color: var(--dsw-alias-label-secondary); font-size: 13px; text-underline-offset: 3px; overflow-wrap: anywhere; }
      .opm-command { display: flex; align-items: center; gap: 8px; padding: 10px; background: var(--dsw-alias-bg-module-platform);
        border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); }
      .opm-command code { flex: 1; min-width: 0; font-family: monospace; font-size: 12px; overflow-wrap: anywhere; user-select: text; }
      .opm-panel-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
      .opm-panel-actions .opm-like, .opm-panel-actions .opm-favorite .opm-button { min-height: 32px; }
      .opm-compatibility { margin-top: 16px !important; }
      .opm-versions { margin-top: 20px; border-top: 1px solid var(--dsw-alias-border-l2); padding-top: 12px; }
      .opm-versions-toggle { display: flex; align-items: center; gap: 8px; width: 100%; border: 0; padding: 6px 0;
        background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; text-align: left; }
      .opm-versions-toggle > span:last-child { margin-left: auto; color: var(--dsw-alias-label-secondary); }
      .opm-versions-note { margin: 6px 0 10px !important; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.6; }
      .opm-version-list { list-style: none; margin: 0; padding: 0; }
      .opm-version-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; padding: 12px 0; border-bottom: 1px solid var(--dsw-alias-border-l2); }
      .opm-version-copy { flex: 1; min-width: min(190px, 100%); overflow-wrap: anywhere; }
      .opm-version-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; margin-bottom: 4px; }
      .opm-version-heading strong { margin-right: 3px; font-size: 13px; font-weight: 600; }
      .opm-version-meta { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.6; }
      .opm-version-actions { display: flex; gap: 6px; margin-left: auto; }
      .opm-version-error { flex-basis: 100%; font-size: 12px; }
      .opm-versions-status { display: flex; align-items: center; gap: 10px; font-size: 12px; margin: 10px 0 !important; }
      /* A plain search over the whole catalog sits at the top. */
      .opm-search { position: relative; display: flex; align-items: center; max-width: 360px; }
      .opm-search-icon { position: absolute; left: 11px; width: 15px; height: 15px; color: var(--dsw-alias-label-tertiary); pointer-events: none; }
      .opm-search input { width: 100%; height: 32px; padding: 0 32px 0 32px; border: 1px solid var(--dsw-alias-border-l2);
        border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary);
        font: inherit; font-size: 13px; outline: none; transition: border-color 150ms ease-out, box-shadow 150ms ease-out; }
      .opm-search input::placeholder { color: var(--dsw-alias-label-tertiary); }
      .opm-search input:focus { border-color: var(--dsw-alias-border-l3); box-shadow: 0 0 0 3px color-mix(in srgb, #4f7cff 22%, transparent); }
      .opm-search input::-webkit-search-cancel-button { display: none; }
      .opm-search-clear { position: absolute; right: 6px; width: 24px; height: 24px; padding: 0; border: 0; border-radius: var(--dsw-radius-sm);
        background: none; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 16px; cursor: pointer; }
      .opm-search-clear:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .opm-result-count { margin-bottom: 8px !important; }
      .opm-toolbar { display: flex; align-items: center; gap: 8px; max-width: 620px; }
      .opm-icon-button { width: 32px; padding: 0; }
      .opm-icon-button svg { width: 16px; height: 16px; }
      .opm-toolbar .opm-search { flex: 1; min-width: 0; }
      .opm-favorites-button { gap: 5px; }
      .opm-favorites-button small { color: var(--dsw-alias-label-tertiary); font-size: 11px; font-variant-numeric: tabular-nums; }
      /* Favorite: a star toggle, plus a group picker once there is more than one group. */
      .opm-favorite { display: inline-flex; }
      .opm-favorite-main[aria-pressed="true"] { color: #e59a00; }
      .opm-favorite-main:not(:last-child) { border-top-right-radius: 0; border-bottom-right-radius: 0; }
      .opm-favorite-more { padding: 4px 5px; border-top-left-radius: 0; border-bottom-left-radius: 0; margin-left: -1px; font-size: 10px; }
      .opm-menu { position: fixed; z-index: 1100; min-width: 168px; max-width: 260px; padding: 4px; box-sizing: border-box;
        border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1);
        box-shadow: var(--dsw-elevation-prominent); color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 1.5; }
      .opm-menu-item { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 8px; border: 0; border-radius: var(--dsw-radius-sm);
        background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
      .opm-menu-item:hover, .opm-menu-item:focus-visible { background: var(--dsw-alias-interactive-bg-hover); outline: none; }
      .opm-menu-item span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .opm-menu-check { flex: 0 0 14px; color: #e59a00; }
      .opm-panel-wide { width: min(680px, calc(100% - 32px)); }
      .opm-favorites-head { display: flex; align-items: center; gap: 6px; padding-right: 32px; margin-bottom: 12px; }
      .opm-favorites-head h2 { flex: 1; font-size: 18px; }
      .opm-chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .opm-chip { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 999px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; }
      .opm-chip small { color: var(--dsw-alias-label-tertiary); font-size: 11px; font-variant-numeric: tabular-nums; }
      .opm-chip:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
      .opm-chip[aria-pressed="true"] { border-color: transparent; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
      .opm-chip[aria-pressed="true"] small { color: inherit; opacity: .7; }
      .opm-group-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 14px; }
      .opm-group-title { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
      .opm-inline-form { display: flex; gap: 6px; margin-top: 10px; }
      .opm-input { flex: 1; min-width: 0; height: 28px; padding: 0 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm);
        background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; outline: none; }
      .opm-input:focus { border-color: var(--dsw-alias-border-l3); }
      .opm-favorite-list { list-style: none; margin: 10px 0 0; padding: 0; }
      .opm-favorite-list .opm-version { overflow-wrap: anywhere; }
      .opm-note { margin-top: 10px !important; white-space: pre-wrap; color: var(--dsw-alias-label-secondary); font-size: 12px; }
      .opm-file { display: none; }
      .opm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
      .opm-grid .opm-card { width: auto; }
      .opm-more { display: flex; margin: 12px auto 0; }
      /* Section headings carry a small tinted glyph. */
      .opm-glyph { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 20px; height: 20px; align-self: center;
        border-radius: 6px; font-size: 12px; line-height: 1; color: var(--opm-glyph); background: color-mix(in srgb, var(--opm-glyph) 16%, transparent); }
      .opm-glyph-today { --opm-glyph: #e59a00; }
      .opm-glyph-recommended { --opm-glyph: #4f7cff; }
      .opm-glyph-popular { --opm-glyph: #f0507a; }
      .opm-glyph-trending { --opm-glyph: #f06a2c; }
      .opm-glyph-newest { --opm-glyph: #19a974; }
      .opm-glyph-all { --opm-glyph: #7a8699; }
      /* Cards: a soft wash of the plugin's own hue, an icon that glows in it, and a featured size for today's picks. */
      .opm-card { --opm-accent: hsl(var(--opm-hue, 220) 72% 58%);
        background: linear-gradient(160deg, color-mix(in srgb, var(--opm-accent) 9%, transparent), transparent 55%), var(--dsw-alias-bg-module-platform); }
      .opm-card .opm-icon { background: color-mix(in srgb, var(--opm-accent) 14%, var(--dsw-alias-bg-layer-1));
        box-shadow: 0 6px 14px -8px var(--opm-accent); }
      @media (hover: hover) {
        .opm-card:hover { border-color: color-mix(in srgb, var(--opm-accent) 45%, var(--dsw-alias-border-l2)); }
      }
      .opm-featured-card { gap: 10px; padding: 16px; min-height: 168px;
        background: radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, var(--opm-accent) 20%, transparent), transparent 60%), var(--dsw-alias-bg-module-platform); }
      .opm-featured-card .opm-title { font-size: 20px; line-height: 26px; font-weight: 700; }
      /* Wide featured cards keep every label on the same line as the buttons. */
      .opm-card-footer { display: flex; align-items: flex-end; gap: 8px; margin-top: auto; min-width: 0; }
      .opm-card-footer .opm-tags { flex: 1; flex-wrap: wrap; }
      .opm-card-footer .opm-card-action { margin-top: 0; }
      .opm-featured-card .opm-description { -webkit-line-clamp: 3; }
      .opm-featured-card .opm-icon { box-shadow: 0 10px 22px -10px var(--opm-accent); }
      @media (hover: none) { .opm-arrow { display: none; } }
      @media (prefers-reduced-motion: reduce) {
        .opm-card, .opm-arrow, .opm-list-fade, .opm-list-fade::before, .opm-list-fade::after, .opm-swap > span { transition: none; }
        .opm-card:hover { transform: none; border-color: var(--dsw-alias-border-l3); }
      }
    `;

    function errorText(error, fallback) {
      return String(error?.message || error?.code || (typeof error === 'string' && error) || fallback);
    }

    function titleOf(entry, resolve) {
      return resolve(entry.title) || entry.name;
    }

    // Each plugin gets a stable hue from its name, for the soft tint behind its card and icon.
    function hueOf(name) {
      let hash = 0;
      for (const char of name) hash = (hash * 31 + char.codePointAt(0)) % 360;
      return hash;
    }

    function iconSource(entry) {
      try { return entry.icon ? new URL(entry.icon, INDEX_URL).href : null; } catch { return null; }
    }

    // A card takes its wash from the logo's dominant colour: hues are bucketed by saturation-weighted pixel count and
    // the strongest neighbourhood wins. Logos without colour get a neutral wash; unreadable ones keep the name hue.
    function accentOf(data) {
      const buckets = Array.from({ length: 36 }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
      let opaque = 0;
      let colourful = 0;
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3] / 255;
        if (alpha < 0.5) continue;
        const [r, g, b] = [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const lightness = (max + min) / 2;
        opaque += alpha;
        if (lightness < 0.08 || lightness > 0.96 || max === min) continue;
        const saturation = (max - min) / (1 - Math.abs(2 * lightness - 1));
        if (saturation < 0.25) continue;
        const hue = max === r ? ((g - b) / (max - min) + 6) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
        const bucket = buckets[Math.floor(hue * 6) % 36];
        const weight = saturation * alpha;
        bucket.weight += weight; bucket.r += r * weight; bucket.g += g * weight; bucket.b += b * weight;
        colourful += alpha;
      }
      if (!opaque) return null;
      if (colourful < opaque * 0.06) return 'hsl(220 8% 60%)';
      let best = 0;
      let bestWeight = -1;
      const around = i => [35, 0, 1].map(offset => buckets[(i + offset) % 36]);
      buckets.forEach((_, i) => {
        const weight = around(i).reduce((sum, bucket) => sum + bucket.weight, 0);
        if (weight > bestWeight) { best = i; bestWeight = weight; }
      });
      const sum = around(best).reduce((total, bucket) =>
        ({ r: total.r + bucket.r, g: total.g + bucket.g, b: total.b + bucket.b }), { r: 0, g: 0, b: 0 });
      const [r, g, b] = [sum.r / bestWeight, sum.g / bestWeight, sum.b / bestWeight];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const hue = Math.round(60 * (max === r ? ((g - b) / (max - min) + 6) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4));
      const saturation = (max - min) / (1 - Math.abs(max + min - 1));
      return `hsl(${hue} ${Math.round(Math.min(85, Math.max(45, saturation * 100)))}% 58%)`;
    }

    const accents = new Map();
    function sampleAccent(source) {
      if (!accents.has(source)) accents.set(source, new Promise(resolve => {
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.referrerPolicy = 'no-referrer';
        image.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 32;
            const context = canvas.getContext('2d', { willReadFrequently: true });
            context.drawImage(image, 0, 0, 32, 32);
            resolve(accentOf(context.getImageData(0, 0, 32, 32).data));
          } catch { resolve(null); }
        };
        image.onerror = () => resolve(null);
        // A separate URL keeps a copy cached before the icons sent CORS headers from tainting the canvas.
        const url = new URL(source);
        url.searchParams.set('accent', '1');
        image.src = url.href;
      }));
      return accents.get(source);
    }

    function useAccent(source) {
      const [accent, setAccent] = React.useState(null);
      React.useEffect(() => {
        let live = true;
        setAccent(null);
        if (source) sampleAccent(source).then(value => { if (live) setAccent(value); });
        return () => { live = false; };
      }, [source]);
      return accent;
    }

    const SECTION_GLYPHS = { today: '☀', recommended: '⊙', popular: '♥', trending: '↗', newest: '✚', all: '▦' };

    function descriptionOf(entry, resolve, t) {
      const text = resolve(entry.description) || '';
      return text.replace(/^\s*★\s*[\d,.]+\s*│\s*/, '').trim() || t('noDescription');
    }

    function marketPageOf(entry, t) {
      return t('websiteUrl') + 'plugins/' + entry.name.split('/').map(encodeURIComponent).join('/') + '/';
    }

    function repositoryOf(entry) {
      return (entry.repository?.url || '').replace(/^git\+/, '').replace(/\.git(?=[?#]|$)/, '');
    }

    function externalUrl(value) {
      try {
        const url = new URL(value);
        if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
      } catch { /* An absent or malformed link is omitted. */ }
      return null;
    }

    function defaultVersionOf(entry) {
      return entry.defaultVersion ? entry.versions.find(version => version.version === entry.defaultVersion) : undefined;
    }

    function localDay() {
      const date = new Date();
      return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    }

    function featuredPool(entries, likes, day) {
      const ranked = [...entries].sort(recommendedOrder);
      const scores = new Map(ranked.map((entry, rank) => [entry.name,
        (Number(likes[entry.name]) || 0) * 10 + (ranked.length <= 1 ? 100 : 100 * (1 - rank / (ranked.length - 1)))]));
      const pool = ranked.filter(entry => entry.installation.status === 'not-installed')
        .sort((a, b) => scores.get(b.name) - scores.get(a.name) || recommendedOrder(a, b)).slice(0, 30);
      // Stable input ordering plus a date-seeded Fisher–Yates shuffle is independent of locale and input order.
      let seed = 2166136261;
      for (let i = 0; i < day.length; i++) seed = Math.imul(seed ^ day.charCodeAt(i), 16777619) >>> 0;
      function random() {
        seed = (seed + 0x6D2B79F5) >>> 0;
        let value = Math.imul(seed ^ (seed >>> 15), seed | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
      }
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return pool.slice(0, 9);
    }

    function recommendedOrder(a, b) {
      const difference = (b.metadata?.sortKeys?.recommended ?? 0) - (a.metadata?.sortKeys?.recommended ?? 0);
      // A language-independent tie break keeps the daily pick identical for the same index and local date.
      return difference || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    }

    function latestPublication(entry) {
      return entry.versions.reduce((latest, version) => Math.max(latest, version.publishTimestamp || 0), 0);
    }

    function PluginIcon({ entry, title, large }) {
      const [failedSource, setFailedSource] = React.useState(null);
      const source = iconSource(entry);
      return h('span', { className: 'opm-icon' + (large ? ' opm-icon-large' : ''), 'aria-hidden': true },
        source && source !== failedSource
          ? h('img', { src: source, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onError: () => setFailedSource(source) })
          : Array.from(title.trim())[0]);
    }

    function Tags({ entry, metadata, resolve, t, limit }) {
      const rank = id => id === 'verified' ? 0 : id === 'trending' ? 1 : id === 'active' ? 2
        : id.startsWith('downloads-') ? 3 : id.startsWith('updated-') ? 4 : 5;
      const ids = [...new Set(entry.metadata?.labels || [])];
      const hasPriority = ids.some(id => rank(id) < 4);
      const selected = ids.filter(id => limit == null || !hasPriority || !id.startsWith('updated-'))
        .sort((a, b) => rank(a) - rank(b)).slice(0, limit);
      const stars = entry.metadata?.sortKeys?.['github-stars'];
      return h('div', { className: 'opm-tags' },
        Number.isSafeInteger(stars) && stars > 0 && h('span', { className: 'opm-tag opm-tag-stars', title: t('stars').replace('{count}', stars.toLocaleString(t('dateLocale'))) },
          '★ ' + new Intl.NumberFormat(t('dateLocale'), { notation: 'compact', maximumFractionDigits: 1 }).format(stars)),
        selected.map(id => h('span', {
          key: id, className: 'opm-tag' + (['verified', 'trending', 'active'].includes(id) ? ' opm-tag-' + id : '')
        }, resolve(metadata?.labels?.[id]?.title) || id)));
    }

    function InstallButton({ entry, t, resolve, install, openPackage, manager, onError, onNotice, small, update, busyLabel = 'busy', disabled = false, onBusyChange }) {
      const [busy, setBusy] = React.useState(false);
      const [phase, setPhase] = React.useState(busyLabel);
      const version = defaultVersionOf(entry);
      const status = entry.installation.status;
      const installed = status !== 'not-installed' && status !== 'update-available';
      const label = !version ? 'incompatible' : installed ? 'installed' : status === 'update-available'
        ? (update ? 'update' : 'updateAvailable') : 'install';
      async function act() {
        if (busy || disabled || !version) return;
        setBusy(true);
        onBusyChange?.(true);
        onError('');
        try {
          function startInstall() {
            const answer = install({ ...version.install, title: titleOf(entry, resolve), version: version.version });
            void sendLike(entry.name, 'install');
            return answer;
          }
          // DSH's install refuses a package that is already there, so an update removes it first, as DSH's own
          // Update for official plugins does; the install dialog then installs the new version.
          async function startUpdate() {
            return installVersion(entry, version, { install, manager, t, title: titleOf(entry, resolve), onPhase: setPhase, busyLabel });
          }
          const answer = installed
            ? await openPackage(entry.name)
            : status === 'update-available' ? await startUpdate() : await startInstall();
          if (answer?.selfUpdate) return;
          if (answer?.ok === false) onError(errorText(answer.error, t('unknownError')));
          else if (answer?.restart) onNotice?.(t('installedRestart'));
        } catch (error) {
          onError(errorText(error, t('unknownError')));
        } finally {
          setBusy(false);
          onBusyChange?.(false);
          setPhase(busyLabel);
        }
      }
      const updating = status === 'update-available' && version;
      return h('button', {
        type: 'button', className: 'opm-button' + (version && !installed ? ' opm-button-primary' : '') + (small ? ' opm-button-small' : ''),
        disabled: !version || busy || disabled, onClick: event => { event.stopPropagation(); return act(); }, 'aria-busy': busy,
        title: updating && !busy ? t(entry.name === 'dsh-open-market' ? 'selfUpdateHint' : 'updateHint') : undefined,
        'aria-label': t(busy ? phase : label) + ' · ' + titleOf(entry, resolve)
      }, t(busy ? phase : label));
    }

    function LikeButton({ entry, t, resolve, likes }) {
      const liked = likes.names.has(entry.name);
      const count = likeCount(likes.counts, entry.name);
      const title = t(liked ? 'likedToday' : Object.hasOwn(likes.errors, entry.name) && likes.errors[entry.name] || 'like');
      return h('button', { type: 'button', className: 'opm-button opm-button-small opm-like', disabled: liked, title,
        'aria-pressed': liked, 'aria-label': title + ' · ' + titleOf(entry, resolve) + (count ? ' · ' + count : ''),
        onClick: event => { event.stopPropagation(); void sendLike(entry.name, 'like'); }
      }, h('span', { 'aria-hidden': true }, '♥'), count > 0 ? String(count) : null);
    }

    // The star saves to the default group, or removes the plugin from every group it is in; the arrow picks groups.
    function FavoriteButton({ name, title, t }) {
      const { groups } = useFavorites();
      const [menu, setMenu] = React.useState(null);
      const wrapper = React.useRef(null);
      const menuNode = React.useRef(null);
      const saved = groups.filter(group => group.names.includes(name));
      const label = t(saved.length ? 'unfavorite' : 'favorite');
      React.useEffect(() => {
        if (!menu) return;
        menuNode.current?.querySelector('button')?.focus({ preventScroll: true });
        const outside = event => { if (!wrapper.current?.contains(event.target) && !menuNode.current?.contains(event.target)) setMenu(null); };
        const scroll = event => { if (!menuNode.current?.contains(event.target)) setMenu(null); };
        const key = event => {
          if (event.key !== 'Escape') return;
          event.preventDefault(); event.stopPropagation();
          setMenu(null);
          wrapper.current?.querySelector('.opm-favorite-more')?.focus();
        };
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('keydown', key, true);
        window.addEventListener('scroll', scroll, true);
        window.addEventListener('resize', scroll);
        return () => {
          document.removeEventListener('pointerdown', outside, true);
          document.removeEventListener('keydown', key, true);
          window.removeEventListener('scroll', scroll, true);
          window.removeEventListener('resize', scroll);
        };
      }, [menu]);
      function openMenu(event) {
        event.stopPropagation();
        if (menu) return setMenu(null);
        const rect = event.currentTarget.getBoundingClientRect();
        const below = rect.bottom + 40 + groups.length * 34 < window.innerHeight;
        setMenu({ right: Math.max(8, window.innerWidth - rect.right), [below ? 'top' : 'bottom']: below ? rect.bottom + 4 : window.innerHeight - rect.top + 4 });
      }
      const list = menu && h('div', { className: 'opm-menu', role: 'menu', ref: menuNode, 'aria-label': t('chooseGroup'), style: menu,
        onClick: event => event.stopPropagation(), onKeyDown: event => event.stopPropagation() },
        groups.map(group => {
          const checked = group.names.includes(name);
          return h('button', { key: group.id, type: 'button', role: 'menuitemcheckbox', 'aria-checked': checked, className: 'opm-menu-item',
            onClick: () => setFavorite(group.id, name, !checked) },
            h('span', { className: 'opm-menu-check', 'aria-hidden': true }, checked ? '★' : ''), h('span', null, groupLabel(group, t)));
        }));
      return h('span', { className: 'opm-favorite', ref: wrapper },
        h('button', { type: 'button', className: 'opm-button opm-button-small opm-favorite-main', 'aria-pressed': saved.length > 0,
          title: label, 'aria-label': label + ' · ' + title, onClick: event => {
            event.stopPropagation();
            if (saved.length) saved.forEach(group => setFavorite(group.id, name, false));
            else setFavorite(DEFAULT_GROUP, name, true);
          } }, saved.length ? '★' : '☆'),
        groups.length > 1 && h('button', { type: 'button', className: 'opm-button opm-button-small opm-favorite-more', 'aria-haspopup': 'menu',
          'aria-expanded': !!menu, title: t('chooseGroup'), 'aria-label': t('chooseGroup') + ' · ' + title, onClick: openMenu }, '▾'),
        list && (createPortal ? createPortal(list, document.body) : list));
    }

    // A modal panel: Escape closes it, Tab stays inside, and the page behind does not scroll.
    function Dialog({ labelledBy, closeLabel, onClose, restoreFocus, wide, children }) {
      const panel = React.useRef(null);
      React.useEffect(() => {
        const node = panel.current;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        node.focus({ preventScroll: true });
        function keydown(event) {
          // The group menu and inline name fields close themselves first.
          if (event.key === 'Escape' && event.target.closest?.('[data-opm-escape], .opm-menu')) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          } else if (event.key === 'Tab') {
            const controls = [...node.querySelectorAll('button:not(:disabled), a[href], input:not(.opm-file), [tabindex="0"]')];
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (!first) { event.preventDefault(); node.focus(); }
            else if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
              event.preventDefault(); last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === node)) {
              event.preventDefault(); first.focus();
            }
          }
        }
        document.addEventListener('keydown', keydown, true);
        return () => {
          document.removeEventListener('keydown', keydown, true);
          document.body.style.overflow = previousOverflow;
          restoreFocus();
        };
      }, [onClose, restoreFocus]);
      return h('div', { className: 'opm-overlay', onClick: event => { if (event.target === event.currentTarget) onClose(); } },
        h('section', { className: 'opm-panel' + (wide ? ' opm-panel-wide' : ''), role: 'dialog', 'aria-modal': true, 'aria-labelledby': labelledBy, tabIndex: -1, ref: panel },
          h('button', { type: 'button', className: 'opm-button opm-button-small opm-panel-close', onClick: onClose, 'aria-label': closeLabel }, '×'),
          children));
    }

    function PluginCard(props) {
      const { entry, t, resolve, metadata, featured } = props;
      const title = titleOf(entry, resolve);
      const accent = useAccent(iconSource(entry));
      const actions = h('div', { className: 'opm-card-action' },
        props.likesEnabled ? h(LikeButton, props) : null,
        h(FavoriteButton, { name: entry.name, title, t }),
        h(InstallButton, { ...props, small: true }));
      return h('article', { className: 'opm-card' + (featured ? ' opm-featured-card' : ''),
        style: { '--opm-hue': hueOf(entry.name), ...(accent && { '--opm-accent': accent }) },
        tabIndex: 0, role: 'button', 'aria-label': title, 'aria-haspopup': 'dialog', 'data-plugin-name': entry.name,
        onClick: event => {
          // Disabled buttons do not run their own click handler, so guard their descendants here too.
          if (!event.target.closest('button, a')) props.onOpen(entry, event.currentTarget);
        },
        onKeyDown: event => {
          if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            props.onOpen(entry, event.currentTarget);
          }
        } },
        h('div', { className: 'opm-card-heading' },
          h(PluginIcon, { entry, title, large: featured }),
          h('div', { className: 'opm-card-copy' }, h('h3', { className: 'opm-title', title }, title),
            entry.author ? h('p', { className: 'opm-author', title: entry.author }, entry.author) : null)),
        h('p', { className: 'opm-description' }, descriptionOf(entry, resolve, t)),
        // Narrow cards give tags their own line, since beside the buttons they wrapped; featured cards fit both.
        featured ? h('div', { className: 'opm-card-footer' }, h(Tags, { entry, metadata, resolve, t }), actions)
          : h(React.Fragment, null, h(Tags, { entry, metadata, resolve, t, limit: 2 }), actions));
    }

    function OtherVersions({ entry, t, resolve, install, manager, onError, onNotice, busyLabel = 'busy', disabled = false, onBusyChange }) {
      const preferences = useSettings();
      const registry = npmVersionRegistry(entry, preferences);
      const key = entry.name + '\0' + registry;
      const listId = React.useId();
      const [expanded, setExpanded] = React.useState(false);
      const [state, setState] = React.useState({ key, status: 'idle', versions: [] });
      const [limit, setLimit] = React.useState(20);
      const [busy, setBusy] = React.useState({ version: null, phase: busyLabel });
      const [copied, setCopied] = React.useState(null);
      const [attempt, setAttempt] = React.useState(0);
      const [actionError, setActionError] = React.useState(null);
      React.useEffect(() => {
        if (!expanded || !registry) return;
        let cancelled = false;
        setState({ key, status: 'loading', versions: [] });
        setLimit(20);
        loadNpmVersions(entry.name, registry).then(
          versions => { if (!cancelled) setState({ key, status: 'ready', versions }); },
          () => { if (!cancelled) setState({ key, status: 'error', versions: [] }); }
        );
        return () => { cancelled = true; };
      }, [expanded, entry.name, registry, attempt]);
      React.useEffect(() => {
        if (!copied) return;
        const timer = window.setTimeout(() => setCopied(null), 1800);
        return () => window.clearTimeout(timer);
      }, [copied]);
      const currentState = state.key === key ? state : { status: 'loading', versions: [] };
      const choices = versionChoices(entry, registry && currentState.status === 'ready' ? currentState.versions : [], registry);
      async function choose(version) {
        if (busy.version || disabled) return;
        setBusy({ version: version.version, phase: busyLabel });
        onBusyChange?.(true);
        setActionError(null);
        onError('');
        try {
          const answer = await installVersion(entry, version, { install, manager, t, title: titleOf(entry, resolve), busyLabel,
            onPhase: phase => setBusy({ version: version.version, phase }) });
          if (answer?.selfUpdate) return;
          if (answer?.ok === false) setActionError({ version: version.version, text: errorText(answer.error, t('unknownError')) });
          else { void sendLike(entry.name, 'install'); if (answer?.restart) onNotice?.(t('installedRestart')); }
        } catch (error) { setActionError({ version: version.version, text: errorText(error, t('unknownError')) }); }
        finally { setBusy({ version: null, phase: busyLabel }); onBusyChange?.(false); }
      }
      async function copy(version) {
        try { await navigator.clipboard.writeText(versionCommand(entry, version)); setCopied(version.version); } catch { /* Clipboard access is optional. */ }
      }
      return h('section', { className: 'opm-versions' },
        h('button', { type: 'button', className: 'opm-versions-toggle', 'aria-expanded': expanded, 'aria-controls': listId,
          onClick: () => setExpanded(value => !value) }, t('otherVersions'), h('span', { 'aria-hidden': true }, expanded ? '−' : '+')),
        expanded && h('div', { id: listId },
          h('p', { className: 'opm-versions-note' }, t(registry ? 'versionsHelp' : 'gitVersionsHelp')),
          !['not-installed', 'provided'].includes(entry.installation.status) && h('p', { className: 'opm-versions-note' }, t(entry.name === 'dsh-open-market' ? 'selfUpdateHint' : 'updateHint')),
          registry && currentState.status === 'loading' && h('p', { className: 'opm-versions-status', role: 'status' }, t('versionsLoading')),
          registry && currentState.status === 'error' && h('div', { className: 'opm-versions-status', role: 'alert' },
            t('versionsFailed'), h('button', { type: 'button', className: 'opm-button opm-button-small', onClick: () => setAttempt(value => value + 1) }, t('retry'))),
          h('ul', { className: 'opm-version-list', 'aria-label': t('otherVersions') }, choices.slice(0, limit).map(version => {
            const current = entry.installation.installedVersion === version.version;
            const provided = entry.installation.status === 'provided';
            const blocked = version.compatibility?.compatible === false && !version.compatibility.exempted;
            const switching = entry.installation.status !== 'not-installed';
            const label = provided ? 'providedVersion' : current ? 'installed' : blocked ? 'incompatible' : switching ? 'switchVersion' : 'install';
            const active = busy.version === version.version;
            const action = t(active ? busy.phase : label);
            const date = Number.isFinite(version.publishTimestamp) ? new Date(version.publishTimestamp * 1000).toLocaleDateString(t('dateLocale')) : '';
            return h('li', { key: version.version, className: 'opm-version-row', 'data-version': version.version },
              h('div', { className: 'opm-version-copy' },
                h('div', { className: 'opm-version-heading' }, h('strong', null, version.version),
                  h('span', { className: 'opm-tag' }, t(version.listed ? 'listedVersion' : 'unreviewedVersion')),
                  version.version.split('+')[0].includes('-') && h('span', { className: 'opm-tag' }, t('prereleaseVersion')),
                  current && h('span', { className: 'opm-tag' }, t('installed'))),
                h('p', { className: 'opm-version-meta' }, [date, version.requirements.length ? 'DSH: ' + version.requirements.join(' ∩ ') : t('dshRangeUnknown')].filter(Boolean).join(' · '))),
              h('div', { className: 'opm-version-actions' },
                h('button', { type: 'button', className: 'opm-button opm-button-small', onClick: () => copy(version),
                  'aria-label': t('copyVersion').replace('{version}', version.version) }, t(copied === version.version ? 'copied' : 'copy')),
                h('button', { type: 'button', className: 'opm-button opm-button-small', disabled: provided || current || blocked || !!busy.version || disabled,
                  title: switching && !current && !provided ? t(entry.name === 'dsh-open-market' ? 'selfUpdateHint' : 'updateHint') : undefined, 'aria-busy': active,
                  'aria-label': t('versionAction').replace('{action}', action).replace('{version}', version.version), onClick: () => choose(version) }, action)),
              actionError?.version === version.version && h('p', { className: 'opm-error opm-version-error', role: 'alert' }, actionError.text));
          })),
          registry && currentState.status === 'ready' && choices.length === entry.versions.length && h('p', { className: 'opm-versions-note' }, t('noOtherVersions')),
          choices.length > limit && h('button', { type: 'button', className: 'opm-button opm-button-small opm-more', onClick: () => setLimit(value => value + 20) }, t('moreVersions'))));
    }

    function PluginDetails({ entry, returnTarget, marketRoot, onClose, ...props }) {
      const { t, resolve, metadata, likes } = props;
      const headingId = React.useId();
      const [copied, setCopied] = React.useState(false);
      const [actionError, setActionError] = React.useState('');
      const [installing, setInstalling] = React.useState(false);
      const title = titleOf(entry, resolve);
      const latest = entry.versions?.[0];
      const version = entry.defaultVersion || latest?.version;
      const date = Number.isFinite(latest?.publishTimestamp) ? new Date(latest.publishTimestamp * 1000) : null;
      const published = date && Number.isFinite(date.getTime()) ? date.toLocaleDateString(t('dateLocale')) : '';
      const category = entry.metadata?.category;
      const status = entry.installation.status;
      const installation = status === 'not-installed' ? t('notInstalled') : status === 'update-available'
        ? t('updateAvailable') : t('installed') + (entry.installation.installedVersion ? ' ' + entry.installation.installedVersion : '');
      const command = latest ? versionCommand(entry, defaultVersionOf(entry) ?? latest) : 'dsh plugin --profile desktop add ' + entry.name;
      // A like can reorder a rail or today's picks while this dialog is open.
      const restoreFocus = React.useCallback(() => {
        const available = node => node?.isConnected && !node.closest('[inert]');
        const fallback = [...(marketRoot.current?.querySelectorAll('[data-plugin-name]') || [])]
          .find(node => node.dataset.pluginName === entry.name && available(node));
        const target = available(returnTarget) ? returnTarget : fallback || marketRoot.current;
        target?.focus();
      }, [entry.name, returnTarget, marketRoot]);
      React.useEffect(() => {
        if (!copied) return;
        const timer = window.setTimeout(() => setCopied(false), 1800);
        return () => window.clearTimeout(timer);
      }, [copied]);
      async function copy() {
        try { await navigator.clipboard.writeText(command); setCopied(true); } catch { /* Clipboard access is optional. */ }
      }
      const links = [['homepage', externalUrl(entry.homepage)], ['sourceCode', externalUrl(repositoryOf(entry))],
        ['marketPage', marketPageOf(entry, t)]];
      return h(Dialog, { labelledBy: headingId, closeLabel: t('close'), onClose, restoreFocus },
          h('div', { className: 'opm-panel-heading' }, h(PluginIcon, { entry, title, large: true }),
            h('div', { className: 'opm-card-copy' }, h('h2', { id: headingId }, title),
              entry.author && h('p', { className: 'opm-author' }, entry.author),
              h('p', { className: 'opm-version' }, [version, published].filter(Boolean).join(' · ')))),
          h(Tags, { entry, metadata, resolve, t }),
          h('p', { className: 'opm-description opm-panel-description' }, descriptionOf(entry, resolve, t)),
          h('div', { className: 'opm-muted opm-panel-info' },
            category && h('span', null, resolve(metadata?.categories?.[category]?.title) || category),
            h('span', null, t('likeCount').replace('{count}', likeCount(likes.counts, entry.name))),
            h('span', null, installation)),
          h('div', { className: 'opm-panel-links' }, links.filter(([, href]) => href).map(([key, href]) =>
            h('a', { key, href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': t(key) + ' · ' + t('newWindow') }, t(key)))),
          h('div', { className: 'opm-command', role: 'group', 'aria-label': t('installCommand') }, h('code', null, command),
            h('button', { type: 'button', className: 'opm-button opm-button-small', onClick: copy, 'aria-live': 'polite' }, t(copied ? 'copied' : 'copy'))),
          !entry.defaultVersion && h('p', { className: 'opm-error opm-compatibility' }, t('noCompatibleVersion')),
          h('div', { className: 'opm-panel-actions' },
            props.likesEnabled && h(LikeButton, { ...props, entry }),
            h(FavoriteButton, { name: entry.name, title, t }),
            h(InstallButton, { ...props, entry, update: true, onError: setActionError, disabled: installing, onBusyChange: setInstalling })),
          actionError && h('p', { className: 'opm-error', role: 'alert' }, t('actionFailed') + ': ' + actionError),
          h(OtherVersions, { ...props, key: entry.name, entry, onError: setActionError, disabled: installing, onBusyChange: setInstalling }));
    }

    function SectionHeading({ section, t, children }) {
      return h('div', { className: 'opm-heading' },
        h('div', { className: 'opm-heading-copy' }, h('span', { className: 'opm-glyph opm-glyph-' + section, 'aria-hidden': true }, SECTION_GLYPHS[section] || '•'), h('h2', null, t(section)),
          h('span', { className: 'opm-heading-hint', title: t(section + 'Hint') }, '· ' + t(section + 'Hint'))), children);
    }

    function Chevron({ d }) {
      return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d }));
    }

    function FloatingArrows({ title, t, start, end, move }) {
      return h(React.Fragment, null,
        h('button', { type: 'button', className: 'opm-arrow opm-arrow-previous', disabled: start,
          'aria-label': t('previous').replace('{section}', title), onClick: () => move(-1) }, h(Chevron, { d: 'm15 6-6 6 6 6' })),
        h('button', { type: 'button', className: 'opm-arrow opm-arrow-next', disabled: end,
          'aria-label': t('next').replace('{section}', title), onClick: () => move(1) }, h(Chevron, { d: 'm9 6 6 6-6 6' })));
    }

    function edgesOf(node) {
      return { start: node.scrollLeft <= 1, end: node.scrollLeft + node.clientWidth >= node.scrollWidth - 1 };
    }

    // Scrolling reports every frame; an unchanged edge must not re-render the row's cards each time.
    function sameEdges(next) {
      return current => current.start === next.start && current.end === next.end && current.home === next.home ? current : next;
    }

    // DSH narrows its page gutter with the window, and a row wider than the gutter would scroll the whole page sideways.
    const MAX_BLEED = 40;
    function bleedFor(gutterLeft, gutterRight) {
      return Math.max(8, Math.min(MAX_BLEED, Math.floor(Math.min(gutterLeft, gutterRight))));
    }

    function useRowBleed(root) {
      React.useLayoutEffect(() => {
        const node = root.current;
        let page = node?.parentElement;
        while (page && !/auto|scroll|hidden/.test(window.getComputedStyle(page).overflowX)) page = page.parentElement;
        if (!node || !page) return;
        function measure() {
          const inner = node.getBoundingClientRect();
          const outer = page.getBoundingClientRect();
          node.style.setProperty('--opm-bleed', bleedFor(inner.left - outer.left, outer.left + page.clientWidth - inner.right) + 'px');
        }
        measure();
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
        observer?.observe(node);
        observer?.observe(page);
        return () => observer?.disconnect();
      }, [root]);
    }

    function useReducedMotion() {
      const [reduced, setReduced] = React.useState(() => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
      React.useEffect(() => {
        const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        if (!media) return;
        const update = () => setReduced(media.matches);
        update();
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
      }, []);
      return reduced;
    }

    function FeaturedCarousel({ entries, autoRotate, ...props }) {
      const viewport = React.useRef(null);
      const [visible, setVisible] = React.useState(1);
      const [index, setIndex] = React.useState(0);
      const [edges, setEdges] = React.useState({ start: true, end: true, home: true });
      const [hovered, setHovered] = React.useState(false);
      const [focused, setFocused] = React.useState(false);
      const reduced = useReducedMotion();
      const count = Math.min(visible, entries.length || 1);
      const last = Math.max(0, entries.length - count);
      const position = Math.min(index, last);
      // Slides rest one gutter along, so the leading card always sits under the fade instead of against the margin.
      const restingOffset = node => parseFloat(window.getComputedStyle(node).paddingLeft);
      function measureScroll() {
        const node = viewport.current;
        if (!node) return;
        const resting = restingOffset(node);
        const width = node.firstElementChild?.getBoundingClientRect().width;
        if (width) setIndex(Math.max(0, Math.min(last, Math.round((node.scrollLeft - resting) / (width + 10)))));
        setEdges(sameEdges({ ...edgesOf(node), home: node.scrollLeft <= resting + 1 }));
      }
      function goTo(number, behavior = reduced ? 'auto' : 'smooth') {
        const node = viewport.current;
        const slide = node?.firstElementChild;
        if (slide) node.scrollTo({ left: restingOffset(node) + number * (slide.getBoundingClientRect().width + 10), behavior });
      }
      React.useEffect(() => {
        const node = viewport.current;
        if (!node) return;
        function measure() {
          // The gutters hold hover shadows and the edge fade without changing the card area's width.
          const style = window.getComputedStyle(node);
          const width = node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
          setVisible(width >= 900 ? 3 : width >= 560 ? 2 : 1);
        }
        measure();
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
        observer?.observe(node);
        window.addEventListener('resize', measure);
        return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
      }, []);
      // A background refresh can replace the entries; only a different line-up goes back to the start.
      const lineup = entries.map(entry => entry.name).join('\n');
      React.useEffect(() => { goTo(0, 'auto'); setIndex(0); measureScroll(); }, [lineup, count]);
      React.useEffect(() => {
        if (!autoRotate || reduced || hovered || focused || !last) return;
        const timer = window.setInterval(() => goTo(position >= last ? 0 : position + 1), 5000);
        return () => window.clearInterval(timer);
      }, [autoRotate, reduced, hovered, focused, last, position, entries, count]);
      const title = props.t('today');
      return h('section', { className: 'opm-carousel', 'aria-label': title,
        onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false),
        onFocusCapture: () => setFocused(true),
        onBlurCapture: event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); } },
        h(SectionHeading, { section: 'today', t: props.t },
          entries.length > 0 && h('div', { className: 'opm-dots' }, Array.from({ length: last + 1 }, (_, number) =>
            h('button', { type: 'button', className: 'opm-dot', key: number, 'aria-current': number === position ? 'true' : undefined,
              'aria-label': props.t('recommendationPosition').replace('{number}', number + 1), onClick: () => goTo(number) })))),
        h('div', { className: 'opm-list opm-list-fade', 'data-fade-start': edges.start ? undefined : '', 'data-fade-end': edges.end ? undefined : '' },
          h('div', { className: 'opm-carousel-viewport', ref: viewport, onScroll: measureScroll }, entries.length ? entries.map(entry =>
            h('div', { key: entry.name, className: 'opm-featured-slide', style: { flexBasis: `calc((100% - ${(count - 1) * 10}px) / ${count})` } },
              h(PluginCard, { ...props, entry, featured: true })))
            : h('p', { className: 'opm-muted' }, props.t('sectionEmpty'))),
          h(FloatingArrows, { title, t: props.t, start: edges.home, end: edges.end,
            move: direction => goTo(Math.max(0, Math.min(last, position + direction))) })));
    }

    // Rails open part-way along, each at its own card offset, so the rows below today's picks do not line up.
    // Offsets follow the section, since Most popular appears above the others only once likes arrive.
    const RAIL_OFFSETS = { popular: 0.55, recommended: 1.6, trending: 1.1, newest: 2.15 };

    function PluginRail({ section, entries, ...props }) {
      const rail = React.useRef(null);
      const staggered = React.useRef(false);
      const [edges, setEdges] = React.useState({ start: true, end: true });
      const reduced = useReducedMotion();
      React.useLayoutEffect(() => {
        const node = rail.current;
        const card = node?.firstElementChild;
        if (staggered.current || !card) return;
        staggered.current = true;
        node.scrollLeft = (RAIL_OFFSETS[section] ?? 1) * (card.getBoundingClientRect().width + 10);
      }, [entries, section]);
      function measure() {
        const node = rail.current;
        if (node) setEdges(sameEdges(edgesOf(node)));
      }
      React.useEffect(() => {
        measure();
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
        if (rail.current) observer?.observe(rail.current);
        window.addEventListener('resize', measure);
        return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
      }, [entries]);
      function scroll(direction) {
        const node = rail.current;
        const card = node?.firstElementChild;
        if (!card) return;
        // Whole pages from the nearest card, so a press from a staggered offset leaves a clean edge.
        const step = card.getBoundingClientRect().width + 10;
        const padding = parseFloat(window.getComputedStyle(node).paddingLeft) * 2;
        const page = Math.max(1, Math.floor((node.clientWidth - padding + 10) / step));
        const from = node.scrollLeft / step;
        const start = direction > 0 ? Math.floor(from + 0.01) : Math.ceil(from - 0.01);
        node.scrollTo({ left: (start + direction * page) * step, behavior: reduced ? 'auto' : 'smooth' });
      }
      const title = props.t(section);
      return h('section', { className: 'opm-section', 'aria-label': title },
        h(SectionHeading, { section, t: props.t }),
        h('div', { className: 'opm-list opm-list-fade', 'data-fade-start': edges.start ? undefined : '', 'data-fade-end': edges.end ? undefined : '' },
          entries.length ? h('div', { className: 'opm-rail', ref: rail, tabIndex: 0, role: 'region', 'aria-label': title, onScroll: measure },
            entries.map(entry => h(PluginCard, { ...props, key: entry.name, entry })))
            : h('p', { className: 'opm-muted' }, props.t('sectionEmpty')),
          h(FloatingArrows, { title, t: props.t, start: edges.start, end: edges.end, move: scroll })));
    }

    function HealthRow({ entry, update, ...props }) {
      const title = titleOf(entry, props.resolve);
      const current = entry.installation.installedVersion || props.t('unknownVersion');
      return h('li', { className: 'opm-health-row' },
        h(PluginIcon, { entry, title }),
        h('div', { className: 'opm-health-copy' },
          h('p', { className: 'opm-health-title' }, title),
          h('p', { className: 'opm-version' }, update ? current + ' → ' + entry.defaultVersion : current)),
        h(InstallButton, { ...props, entry, update, small: true }));
    }

    // Installed plugins from this index: updates first, then versions this DSH cannot run, then the rest.
    function InstalledPanel({ entries, onClose, restoreFocus, ...props }) {
      const { t } = props;
      const headingId = React.useId();
      const [actionError, setActionError] = React.useState('');
      const installed = entries.filter(entry => entry.installation.status !== 'not-installed')
        .sort((a, b) => titleOf(a, props.resolve).localeCompare(titleOf(b, props.resolve), t('dateLocale')));
      const incompatible = installed.filter(entry => !entry.defaultVersion);
      const updates = installed.filter(entry => entry.defaultVersion && entry.installation.status === 'update-available');
      const healthy = installed.filter(entry => entry.defaultVersion && entry.installation.status !== 'update-available');
      function group(key, items, update) {
        return items.length > 0 && h('div', { className: 'opm-health-group' },
          h('h3', null, t(key) + ' · ' + items.length), h('ul', { className: 'opm-health-list' },
            items.map(entry => h(HealthRow, { ...props, key: entry.name, entry, update, onError: setActionError }))));
      }
      return h(Dialog, { labelledBy: headingId, closeLabel: t('close'), onClose, restoreFocus, wide: true },
        h('div', { className: 'opm-favorites-head' }, h('h2', { id: headingId }, t('health'))),
        group('updates', updates, true), group('incompatibleGroup', incompatible, false), group('upToDateGroup', healthy, false),
        installed.length === 0 && h('p', { className: 'opm-muted' }, t('noneInstalled')),
        installed.length > 0 && !updates.length && h('p', { className: 'opm-note' }, t('upToDate')),
        actionError && h('p', { className: 'opm-error opm-action-error', role: 'alert' }, t('actionFailed') + ': ' + actionError));
    }

    const CATALOG_SORTS = { recommended: 'recommended', popular: 'popular', trending: 'trending', stars: 'sortStars', newest: 'newest' };
    const sortValue = (entry, key) => entry.metadata?.sortKeys?.[key] ?? -1;
    const rising = entry => (entry.metadata?.labels?.includes('trending') ? 1 : 0);

    // Every order falls back on the recommended one, so plugins with no reading stay in a stable place.
    function sortCatalog(entries, sort, counts) {
      const order = {
        popular: (a, b) => likeCount(counts, b.name) - likeCount(counts, a.name),
        trending: (a, b) => rising(b) - rising(a) || sortValue(b, 'stars-week') - sortValue(a, 'stars-week'),
        stars: (a, b) => sortValue(b, 'github-stars') - sortValue(a, 'github-stars'),
        newest: (a, b) => latestPublication(b) - latestPublication(a)
      }[sort];
      return [...entries].sort((a, b) => order?.(a, b) || recommendedOrder(a, b));
    }

    // Under the rails: one button that opens the whole catalog as a grid. Its side arrows turn to the next order.
    function AllPlugins({ entries, counts, ...props }) {
      const { t } = props;
      const [open, setOpen] = React.useState(false);
      const [sort, setSort] = React.useState('recommended');
      const heading = React.useRef(null);
      const section = React.useRef(null);
      const body = React.useRef(null);
      const sheet = React.useRef(null);
      const turning = React.useRef(0);
      const reduced = useReducedMotion();
      const sorts = Object.keys(CATALOG_SORTS).filter(id => id !== 'popular' || props.likesEnabled);
      const at = Math.max(0, sorts.indexOf(sort));
      const sorted = React.useMemo(() => sortCatalog(entries, sorts[at], counts), [entries, sorts[at], counts]);
      function turnTo(next) {
        if (next === at || next < 0 || next >= sorts.length) return;
        turning.current = next > at ? 1 : -1;
        setSort(sorts[next]);
      }
      React.useEffect(() => { if (open) heading.current?.focus({ preventScroll: true }); }, [open]);
      React.useLayoutEffect(() => {
        const direction = turning.current;
        turning.current = 0;
        if (!direction || !section.current) return;
        // A new order starts from its top, even when the arrows were pressed far down the grid.
        if (section.current.getBoundingClientRect().top < 0) section.current.scrollIntoView({ block: 'start' });
        if (reduced || !sheet.current?.animate) return;
        // The sheet slides in from the side it was turned towards; the clip keeps that out of the page's width.
        body.current.style.overflowX = 'clip';
        sheet.current.animate([{ opacity: 0, transform: `translateX(${direction * 28}px)` }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' })
          .onfinish = () => { if (body.current) body.current.style.overflowX = ''; };
      }, [at]);
      if (!open) return h('div', { className: 'opm-browse' },
        h('button', { type: 'button', className: 'opm-button', onClick: () => setOpen(true) }, t('browseAll').replace('{count}', entries.length)));
      return h('section', { className: 'opm-section', 'aria-label': t('allPlugins'), ref: section },
        h('div', { className: 'opm-heading opm-all-heading' },
          h('div', { className: 'opm-heading-copy' }, h('span', { className: 'opm-glyph opm-glyph-all', 'aria-hidden': true }, SECTION_GLYPHS.all),
            h('h2', { ref: heading, tabIndex: -1 }, t('allPlugins')),
            h('span', { className: 'opm-heading-hint' }, '· ' + t('allHint').replace('{count}', entries.length))),
          h('div', { className: 'opm-all-controls' },
            h('div', { className: 'opm-chips', role: 'group', 'aria-label': t('sortBy') }, sorts.map((id, number) =>
              h('button', { type: 'button', key: id, className: 'opm-chip', 'aria-pressed': number === at, onClick: () => turnTo(number) }, t(CATALOG_SORTS[id])))),
            h('button', { type: 'button', className: 'opm-button opm-button-small', 'aria-expanded': true, onClick: () => setOpen(false) }, t('collapse')))),
        h('div', { className: 'opm-all-body', ref: body },
          h('div', { className: 'opm-all-arrows' }, h(FloatingArrows, { title: t('allPlugins'), t, start: at === 0, end: at === sorts.length - 1,
            move: direction => turnTo(at + direction) })),
          h('div', { ref: sheet }, h(CardGrid, { ...props, entries: sorted }))));
    }

    // A plain search over the whole catalog at the top of the tab.
    function Toolbar({ t, query, setQuery, onPanel, updates }) {
      const { groups } = useFavorites();
      const count = new Set(groups.flatMap(group => group.names)).size;
      return h('div', { className: 'opm-toolbar' }, h(SearchBar, { t, query, setQuery }),
        h('button', { type: 'button', className: 'opm-button opm-favorites-button', 'aria-haspopup': 'dialog', onClick: event => onPanel('favorites', event) },
          h('span', { 'aria-hidden': true }, '☆'), t('favorites'), count > 0 && h('small', null, count)),
        updates != null && h('button', { type: 'button', className: 'opm-button opm-favorites-button opm-installed-button', 'aria-haspopup': 'dialog',
          title: updates ? t('updates') + ' · ' + updates : undefined, onClick: event => onPanel('installed', event) },
          t('health'), updates > 0 && h('small', null, '↑' + updates)),
        h('button', { type: 'button', className: 'opm-button opm-icon-button', 'aria-haspopup': 'dialog', title: t('settings'), 'aria-label': t('settings'),
          onClick: event => onPanel('settings', event) },
          h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
            h('path', { d: 'M4 7h10M18 7h2M4 17h2M10 17h10' }), h('circle', { cx: 16, cy: 7, r: 2 }), h('circle', { cx: 8, cy: 17, r: 2 }))));
    }

    function SearchBar({ t, query, setQuery }) {
      return h('label', { className: 'opm-search' },
        h('svg', { className: 'opm-search-icon', viewBox: '0 0 24 24', 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' },
          h('circle', { cx: 11, cy: 11, r: 7 }), h('path', { d: 'm20 20-3.5-3.5' })),
        h('input', { type: 'search', value: query, placeholder: t('searchPlaceholder'), 'aria-label': t('searchPlaceholder'),
          onChange: event => setQuery(event.target.value) }),
        query && h('button', { type: 'button', className: 'opm-search-clear', onClick: () => setQuery(''), 'aria-label': t('clearSearch') }, '×'));
    }

    // A grid of cards, 24 at a time.
    function CardGrid({ entries, ...props }) {
      const [limit, setLimit] = React.useState(24);
      const lineup = entries.map(entry => entry.name).join('\n');
      React.useEffect(() => setLimit(24), [lineup]);
      return h(React.Fragment, null,
        entries.length ? h('div', { className: 'opm-grid' }, entries.slice(0, limit).map(entry => h(PluginCard, { ...props, key: entry.name, entry })))
          : h('p', { className: 'opm-muted' }, props.t('noResults')),
        entries.length > limit && h('button', { type: 'button', className: 'opm-button opm-more', onClick: () => setLimit(value => value + 24) }, props.t('showMore')));
    }

    // Search results replace the rows with one grid of cards.
    function SearchResults({ entries, ...props }) {
      return h('section', { className: 'opm-section', 'aria-label': props.t('resultCount').replace('{count}', entries.length) },
        h('p', { className: 'opm-muted opm-result-count', role: 'status' }, props.t('resultCount').replace('{count}', entries.length)),
        h(CardGrid, { ...props, entries }));
    }

    // Favorites: groups of package names. Market plugins install through their index entry; any other package
    // installs by name from npm. Enable and disable act on installed bundles through DSH's plugin manager.
    function FavoritesPanel({ entries, remote, onClose, restoreFocus, ...props }) {
      const { t, resolve, manager, install } = props;
      const { groups } = useFavorites();
      const headingId = React.useId();
      const fileInput = React.useRef(null);
      const [current, setCurrent] = React.useState(DEFAULT_GROUP);
      const [bundles, setBundles] = React.useState(() => new Map());
      const [busy, setBusy] = React.useState(false);
      const [note, setNote] = React.useState('');
      const [draft, setDraft] = React.useState('');
      const [naming, setNaming] = React.useState(null);
      const group = groups.find(item => item.id === current) || groups[0];
      const byName = React.useMemo(() => new Map(entries.map(entry => [entry.name, entry])), [entries]);
      const readBundles = React.useCallback(async () => {
        const answer = await manager()?.listBundles?.();
        if (answer?.ok) setBundles(new Map(answer.value.filter(bundle => bundle.installed).map(bundle => [bundle.name, bundle])));
      }, [manager]);
      React.useEffect(() => {
        readBundles().catch(() => {});
        if (typeof remote.$on !== 'function') return;
        const off = remote.$on('plugin-manager/changed', () => readBundles().catch(() => {}));
        return () => { if (typeof off === 'function') off(); };
      }, [readBundles, remote]);

      async function setEnabled(names, enabled) {
        const service = manager();
        if (!service?.setBundleEnabled) return setNote(t('toggleUnavailable'));
        const targets = names.filter(name => name !== 'dsh-open-market' && bundles.has(name) && bundles.get(name).enabled !== enabled);
        const skipped = !enabled && names.includes('dsh-open-market') && bundles.has('dsh-open-market');
        if (!targets.length) return setNote(t(skipped ? 'selfSkipped' : 'nothingToChange'));
        setBusy(true);
        setNote('');
        let changed = 0;
        let restart = false;
        const failures = [];
        for (const name of targets) {
          try {
            const answer = await service.setBundleEnabled(name, enabled);
            const application = answer?.ok ? answer.value?.application : undefined;
            if (!answer?.ok || application === 'failed') throw new Error(errorText(answer?.ok ? answer.value?.error : answer?.error, t('unknownError')));
            changed++;
            if (application === 'restart-required') restart = true;
          } catch (error) {
            failures.push(name + ': ' + errorText(error, t('unknownError')));
          }
        }
        await readBundles().catch(() => {});
        setBusy(false);
        setNote([t(enabled ? 'enabledCount' : 'disabledCount').replace('{count}', changed) + (restart ? t('restartNeeded') : ''),
          ...(skipped ? [t('selfSkipped')] : []), ...failures].join('\n'));
      }

      function addPackage(event) {
        event.preventDefault();
        const name = draft.trim();
        if (!validPackage(name)) return setNote(t('invalidPackage'));
        if (group.names.includes(name)) return setNote(t('alreadySaved'));
        setFavorite(group.id, name, true);
        setDraft('');
        setNote('');
      }

      function saveName(event) {
        event.preventDefault();
        const name = naming.value.trim().slice(0, 40);
        if (!name) return;
        if (naming.mode === 'new') setCurrent(createGroup(name));
        else updateGroup(group.id, () => ({ name }));
        setNaming(null);
      }

      function removeGroup() {
        if (!window.confirm(t('deleteConfirm').replace('{name}', groupLabel(group, t)))) return;
        deleteGroup(group.id);
        setCurrent(DEFAULT_GROUP);
      }

      function exportFile() {
        const url = URL.createObjectURL(new Blob([JSON.stringify(favorites, null, 2) + '\n'], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'dsh-favorites.json';
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setNote(t('exported'));
      }

      async function importFile(event) {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        try { setNote(t('imported').replace('{count}', importFavorites(JSON.parse(await file.text())))); }
        catch { setNote(t('importFailed')); }
      }

      async function installPackage(name) {
        setNote('');
        try {
          const answer = await install({ spec: name, registry: 'https://registry.npmjs.org/', title: name });
          if (answer?.ok === false) setNote(t('actionFailed') + ': ' + errorText(answer.error, t('unknownError')));
        } catch (error) {
          setNote(t('actionFailed') + ': ' + errorText(error, t('unknownError')));
        }
      }

      function row(name) {
        const entry = byName.get(name);
        const bundle = bundles.get(name);
        // DSH's resolveText throws on undefined, so only resolve a title that exists.
        const title = entry ? titleOf(entry, resolve) : (bundle?.meta?.title && resolve(bundle.meta.title)) || name;
        const state = bundle ? t(bundle.enabled ? 'enabled' : 'disabled') : t('notInstalled');
        let action;
        if (bundle && name !== 'dsh-open-market') action = h('button', { type: 'button', className: 'opm-button opm-button-small', disabled: busy,
          onClick: () => setEnabled([name], !bundle.enabled), 'aria-label': t(bundle.enabled ? 'disable' : 'enable') + ' · ' + title },
          t(bundle.enabled ? 'disable' : 'enable'));
        else if (!bundle && entry) action = h(InstallButton, { ...props, entry, small: true, onError: error => setNote(error && t('actionFailed') + ': ' + error) });
        else if (!bundle) action = h('button', { type: 'button', className: 'opm-button opm-button-small opm-button-primary',
          onClick: () => installPackage(name), 'aria-label': t('install') + ' · ' + name }, t('install'));
        return h('li', { key: name, className: 'opm-health-row' },
          h(PluginIcon, { entry: entry || { name, icon: bundle?.meta?.icon }, title }),
          h('div', { className: 'opm-health-copy' }, h('p', { className: 'opm-health-title' }, title),
            h('p', { className: 'opm-version' }, (title !== name ? name + ' · ' : '') + state)),
          action,
          h('button', { type: 'button', className: 'opm-button opm-button-small', title: t('remove'), 'aria-label': t('remove') + ' · ' + title,
            onClick: () => setFavorite(group.id, name, false) }, '×'));
      }

      return h(Dialog, { labelledBy: headingId, closeLabel: t('close'), onClose, restoreFocus, wide: true },
        h('div', { className: 'opm-favorites-head' },
          h('h2', { id: headingId }, t('favorites')),
          h('button', { type: 'button', className: 'opm-button opm-button-small', onClick: () => fileInput.current?.click() }, t('importFavorites')),
          h('button', { type: 'button', className: 'opm-button opm-button-small', onClick: exportFile }, t('exportFavorites')),
          h('input', { type: 'file', accept: 'application/json,.json', className: 'opm-file', ref: fileInput, tabIndex: -1, onChange: importFile })),
        h('div', { className: 'opm-chips', role: 'group', 'aria-label': t('favorites') },
          groups.map(item => h('button', { type: 'button', key: item.id, className: 'opm-chip', 'aria-pressed': item.id === group.id,
            onClick: () => { setCurrent(item.id); setNaming(null); setNote(''); } }, groupLabel(item, t), h('small', null, item.names.length))),
          h('button', { type: 'button', className: 'opm-chip', onClick: () => setNaming({ mode: 'new', value: '' }) }, '+ ' + t('newGroup'))),
        naming ? h('form', { className: 'opm-inline-form', onSubmit: saveName },
          h('input', { className: 'opm-input', autoFocus: true, maxLength: 40, 'data-opm-escape': '', value: naming.value, placeholder: t('groupName'), 'aria-label': t('groupName'),
            onChange: event => setNaming({ ...naming, value: event.target.value }),
            onKeyDown: event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setNaming(null); } } }),
          h('button', { type: 'submit', className: 'opm-button opm-button-small opm-button-primary', disabled: !naming.value.trim() }, t('save')),
          h('button', { type: 'button', className: 'opm-button opm-button-small', onClick: () => setNaming(null) }, t('cancel')))
          : h('div', { className: 'opm-group-bar' },
            h('h3', { className: 'opm-group-title' }, groupLabel(group, t)),
            h('button', { type: 'button', className: 'opm-button opm-button-small', disabled: busy, onClick: () => setEnabled(group.names, true) }, t('enableAll')),
            h('button', { type: 'button', className: 'opm-button opm-button-small', disabled: busy, onClick: () => setEnabled(group.names, false) }, t('disableAll')),
            group.id !== DEFAULT_GROUP && h('button', { type: 'button', className: 'opm-button opm-button-small',
              onClick: () => setNaming({ mode: 'rename', value: group.name }) }, t('rename')),
            group.id !== DEFAULT_GROUP && h('button', { type: 'button', className: 'opm-button opm-button-small', onClick: removeGroup }, t('deleteGroup'))),
        h('form', { className: 'opm-inline-form', onSubmit: addPackage },
          h('input', { className: 'opm-input', value: draft, placeholder: t('packagePlaceholder'), 'aria-label': t('packagePlaceholder'),
            spellCheck: false, autoCapitalize: 'off', onChange: event => setDraft(event.target.value) }),
          h('button', { type: 'submit', className: 'opm-button opm-button-small', disabled: !draft.trim() }, t('addPackage'))),
        note && h('p', { className: 'opm-note', role: 'status' }, note),
        group.names.length ? h('ul', { className: 'opm-favorite-list' }, group.names.map(row))
          : h('p', { className: 'opm-muted opm-note' }, t('emptyGroup')));
    }

    // Each opening of the tab shows the other message first, and an open tab keeps taking turns.
    const FOOTER_KEY = 'dsh-open-market:footer-turn';
    let footerTurn;
    function nextFooterTurn() {
      if (footerTurn === undefined) {
        try { footerTurn = Number(window.localStorage.getItem(FOOTER_KEY)) || 0; } catch { footerTurn = 0; }
      }
      footerTurn = (footerTurn + 1) % 2;
      try { window.localStorage.setItem(FOOTER_KEY, String(footerTurn)); } catch { /* Turns simply restart next time. */ }
      return footerTurn;
    }

    function FooterInvite({ t, stars }) {
      const [inviting, setInviting] = React.useState(() => nextFooterTurn() === 0);
      React.useEffect(() => {
        const timer = window.setInterval(() => setInviting(value => !value), 30000);
        return () => window.clearInterval(timer);
      }, []);
      const on = value => ({ 'data-on': value ? '' : undefined });
      return h('a', { className: 'opm-footer-link', href: inviting ? t('contributingUrl') : REPOSITORY_URL, target: '_blank', rel: 'noopener noreferrer',
        'aria-label': (inviting ? t('contributeCta') : t('starLink').replace('{repo}', REPOSITORY)) + ' · ' + t('newWindow') },
        h('img', { className: 'opm-footer-mark', src: 'https://github.com/' + REPOSITORY.split('/')[0] + '.png?size=64', alt: '',
          loading: 'lazy', referrerPolicy: 'no-referrer' }),
        h('span', { className: 'opm-swap' }, h('span', on(!inviting), t('starCta')), h('span', on(inviting), t('contributeCta'))),
        h('span', { className: 'opm-footer-end opm-swap', 'aria-hidden': true },
          // The GitHub mark says whose star this is.
          h('span', on(!inviting),
            h('svg', { viewBox: '0 0 16 16', fill: 'currentColor' }, h('path', { d: GITHUB_MARK })),
            h('span', { className: 'opm-footer-star' }, '★'),
            Number.isSafeInteger(stars) && stars > 0 ? String(stars) : 'Star'),
          h('span', on(inviting), t('contributeEnd'))));
    }

    function SettingSwitch({ label, checked, disabled, onChange }) {
      // DSH's Switch uses its label for screen readers only, so the visible text sits beside it.
      return h('div', { className: 'opm-setting-row' },
        Switch ? h(React.Fragment, null, h('span', { className: 'opm-setting-label' }, label),
          h(Switch, { checked, disabled, label, onChange }))
          : h('label', { className: 'opm-checkbox' },
            h('input', { type: 'checkbox', checked, disabled, onChange: event => onChange(event.target.checked) }),
            h('span', null, label)));
    }

    function SyncRow({ t }) {
      const { syncing, syncFailed, syncedAt } = useMarket();
      React.useEffect(() => { void restoreMarket(); }, []);
      const value = !marketRemote ? t('syncUnavailable') : syncing ? t('syncing') : syncFailed ? t('syncFailed')
        : syncedAt ? t('syncedAt').replace('{time}', new Date(syncedAt).toLocaleString(t('dateLocale'))) : t('neverSynced');
      function sync() {
        void syncMarket({ refresh: true });
        if (settings.likes) loadLikes();
      }
      return h('div', { className: 'opm-setting-row' },
        h('div', { className: 'opm-setting-copy' }, h('span', { className: 'opm-setting-label' }, t('syncData')),
          h('span', { className: 'opm-setting-value' + (syncFailed && !syncing ? ' opm-setting-value-error' : ''), role: 'status' }, value)),
        h('button', { type: 'button', className: 'opm-button opm-button-small', disabled: syncing || !marketRemote, 'aria-busy': syncing, onClick: sync },
          t(syncing ? 'syncing' : 'syncNow')));
    }

    function RegistryChoice({ t }) {
      const preferences = useSettings();
      const labelId = React.useId();
      const [draft, setDraft] = React.useState(preferences.customRegistry);
      const invalid = preferences.registry === 'custom' && !!draft.trim() && !registryUrl(draft);
      function edit(value) {
        setDraft(value);
        const url = registryUrl(value);
        // Only an address that works is kept; until then installs stay on the index's registry.
        updateSettings('customRegistry', url || '');
      }
      return h('div', { className: 'opm-setting-block' },
        h('span', { className: 'opm-setting-label', id: labelId }, t('registryLabel')),
        h('div', { className: 'opm-chips', role: 'group', 'aria-labelledby': labelId },
          REGISTRY_CHOICES.map(choice => h('button', { type: 'button', key: choice, className: 'opm-chip', 'aria-pressed': preferences.registry === choice,
            onClick: () => updateSettings('registry', choice) }, t(REGISTRY_LABELS[choice])))),
        preferences.registry === 'custom' && h('input', { className: 'opm-input', type: 'url', value: draft, placeholder: t('registryPlaceholder'),
          'aria-label': t('registryCustom'), 'aria-invalid': invalid, spellCheck: false, autoCapitalize: 'off', onChange: event => edit(event.target.value) }),
        invalid && h('p', { className: 'opm-error', role: 'alert' }, t('registryInvalid')),
        h('p', { className: 'opm-setting-help' }, t('registryHelp')),
        preferences.registry === 'custom' && h('p', { className: 'opm-setting-help' }, t('registryCustomHelp')));
    }
    const REGISTRY_LABELS = { index: 'registryIndex', dsh: 'registryDsh', npmmirror: 'registryNpmmirror', custom: 'registryCustom' };

    // The Auto review switch is this package's second row; the plugin manager reads and saves it like any row.
    const AUTO_REVIEW_ROW = 'open-market-auto-review';
    function useAutoReviewRow(t, manager) {
      const [row, setRow] = React.useState({ status: 'loading' });
      const read = React.useCallback(async () => {
        const service = manager();
        if (!service) return setRow({ status: 'unavailable' });
        const answer = await service.listPlugins();
        const entry = answer?.ok ? answer.value.find(item => item.patchId === AUTO_REVIEW_ROW) : undefined;
        setRow(entry ? { status: 'ready', entryId: entry.entryId, enabled: !!entry.enabled } : { status: 'unavailable' });
      }, [manager]);
      React.useEffect(() => { read().catch(() => setRow({ status: 'unavailable' })); }, [read]);
      async function set(enabled) {
        if (row.status !== 'ready') return;
        setRow({ ...row, enabled, busy: true, note: '' });
        try {
          const answer = await manager().setPluginEnabled(row.entryId, enabled);
          const application = answer?.ok ? answer.value?.application : undefined;
          if (!answer?.ok || application === 'failed') throw new Error(errorText(answer?.ok ? answer.value?.error : answer?.error, t('unknownError')));
          await read();
          if (application === 'restart-required') setRow(current => ({ ...current, note: t('autoReviewRestart') }));
        } catch (error) {
          await read().catch(() => {});
          setRow(current => ({ ...current, note: t('autoReviewFailed').replace('{reason}', errorText(error, t('unknownError'))) }));
        }
      }
      return [row, set];
    }

    // One set of groups for the Open Market tab's settings panel and the plugin's own page under Installed.
    // Whether the host has a sidebar, and whether our tab found a place on its Plugins page.
    let sidebarHost = { supported: false, tab: false, settled: false };
    const sidebarListeners = new Set();
    const getSidebarHost = () => sidebarHost;
    function updateSidebarHost(patch) {
      sidebarHost = { ...sidebarHost, ...patch };
      sidebarListeners.forEach(listener => listener());
    }
    function subscribeSidebarHost(listener) {
      sidebarListeners.add(listener);
      return () => sidebarListeners.delete(listener);
    }
    // Left alone, the page appears only where the tab cannot.
    const sidebarWanted = (preference, host) => preference === 'auto' ? !host.tab : preference === 'on';

    function SidebarSwitch({ t }) {
      const host = React.useSyncExternalStore(subscribeSidebarHost, getSidebarHost, getSidebarHost);
      const preferences = useSettings();
      if (!host.supported) return null;
      return h(React.Fragment, null,
        h(SettingSwitch, { label: t('sidebarMarket'), checked: sidebarWanted(preferences.sidebarMarket, host),
          onChange: value => updateSettings('sidebarMarket', value ? 'on' : 'off') }),
        h('p', { className: 'opm-setting-help' }, t('sidebarMarketHelp')));
    }

    function SettingsGroups({ t, manager }) {
      const preferences = useSettings();
      const [autoReview, setAutoReview] = useAutoReviewRow(t, manager);
      const toggle = key => h(SettingSwitch, { key, label: t(key), checked: preferences[key], onChange: value => updateSettings(key, value) });
      function link(key, href) {
        return h('a', { key, className: 'opm-about-link', href, target: '_blank', rel: 'noopener noreferrer',
          'aria-label': t(key) + ' · ' + t('newWindow') }, t(key));
      }
      function group(key, ...children) {
        return h('section', { className: 'opm-settings-group', 'aria-label': t(key) }, h('h2', null, t(key)), ...children);
      }
      return h('div', { className: 'opm-settings' },
        group('settingsDisplay', toggle('autoRotate'), toggle('showInstalled'), toggle('showCheckup'), h(SidebarSwitch, { t })),
        group('settingsData', h(SyncRow, { t }), h('p', { className: 'opm-setting-help' }, t('syncHelp')),
          toggle('likes'), h('p', { className: 'opm-setting-help' }, t('likesHelp'))),
        group('settingsDownload', h(RegistryChoice, { t })),
        autoReview.status === 'ready' && group('settingsConversation',
          h(SettingSwitch, { label: t('autoReview'), checked: autoReview.enabled, disabled: !!autoReview.busy, onChange: setAutoReview }),
          h('p', { className: 'opm-setting-help' }, t('autoReviewHelp')),
          autoReview.note && h('p', { className: 'opm-setting-help', role: 'status' }, autoReview.note)),
        group('about',
          link('website', t('websiteUrl')),
          link('repository', REPOSITORY_URL),
          link('contributing', t('contributingUrl')),
          link('submitPlugin', REPOSITORY_URL + '/issues/new?template=plugin-add.yml'),
          h('p', { className: 'opm-index-address' }, t('indexAddress'), h('code', null, INDEX_URL))));
    }

    function SettingsPanel({ t, manager, onClose, restoreFocus }) {
      const headingId = React.useId();
      return h(Dialog, { labelledBy: headingId, closeLabel: t('close'), onClose, restoreFocus, wide: true },
        h('div', { className: 'opm-favorites-head' }, h('h2', { id: headingId }, t('settings'))),
        h(SettingsGroups, { t, manager }));
    }

    function Loading({ t }) {
      return h('div', { role: 'status', 'aria-label': t('loading'), 'aria-busy': true },
        h('div', { 'aria-hidden': true },
          h('div', { className: 'opm-skeleton opm-skeleton-search' }),
          [0, 1].map(row => h('div', { key: row, className: 'opm-section' },
            h('div', { className: 'opm-skeleton opm-skeleton-title' }),
            h('div', { className: 'opm-rail' }, [0, 1, 2, 3].map(card => h('div', {
              key: card, className: 'opm-card opm-skeleton-card'
            })))))));
    }

    function OpenMarketTab({ t, remote, manager, resolve, install, openPackage, busyLabel }) {
      const root = React.useRef(null);
      const [selected, setSelected] = React.useState(null);
      const closeDetails = React.useCallback(() => setSelected(null), []);
      // The favorites or installed panel, and the toolbar button that opened it.
      const [panel, setPanel] = React.useState(null);
      const closePanel = React.useCallback(() => setPanel(null), []);
      const restorePanel = React.useCallback(() => {
        (panel?.from?.isConnected ? panel.from : root.current)?.focus();
      }, [panel]);
      const state = useMarket();
      useRowBleed(root);
      const [day, setDay] = React.useState(localDay);
      const preferences = useSettings();
      React.useEffect(() => {
        if (typeof remote.$on !== 'function') return;
        let timer;
        const off = remote.$on('plugin-manager/changed', () => {
          window.clearTimeout(timer);
          timer = window.setTimeout(() => { void syncMarket({ again: true }); }, 400);
        });
        return () => { window.clearTimeout(timer); if (typeof off === 'function') off(); };
      }, [remote]);
      const likes = useLikes(preferences.likes);
      const counts = preferences.likes ? likes.counts : EMPTY_LIKES;
      React.useEffect(() => {
        const timer = window.setInterval(() => {
          setDay(localDay());
          if (market.status === 'ready' && needsRefresh(market, Date.now())) void syncMarket();
        }, 60000);
        return () => window.clearInterval(timer);
      }, []);
      const [actionError, setActionError] = React.useState('');
      const [actionNotice, setActionNotice] = React.useState('');
      const [query, setQuery] = React.useState('');
      React.useEffect(() => { void enterMarket(manager); }, [remote, manager]);

      const sections = React.useMemo(() => {
        if (state.status !== 'ready') return null;
        // Today's picks, the search and the panels keep their own rules; this only thins the browsing lists.
        const entries = preferences.showInstalled
          ? state.entries : state.entries.filter(entry => entry.installation.status === 'not-installed');
        const ranked = [...entries].sort(recommendedOrder);
        // Recommended, Fastest growing and Newly published never repeat a plugin; each takes the next unseen ones.
        const seen = new Set();
        const take = list => {
          const picked = list.filter(entry => !seen.has(entry.name)).slice(0, 20);
          picked.forEach(entry => seen.add(entry.name));
          return picked;
        };
        const popular = entries.filter(entry => likeCount(counts, entry.name) > 0)
          .sort((a, b) => counts[b.name] - counts[a.name] || recommendedOrder(a, b)).slice(0, 20);
        return {
          daily: featuredPool(state.entries, counts, day),
          rails: [
            ['popular', popular], ['recommended', take(ranked)],
            ['trending', take(ranked.filter(entry => entry.metadata?.labels?.includes('trending')))],
            ['newest', take([...entries].sort((a, b) => latestPublication(b) - latestPublication(a) || recommendedOrder(a, b)))]
          ].filter(([, list]) => list.length),
          all: [...entries].sort(recommendedOrder),
          updates: state.entries.filter(entry => entry.defaultVersion && entry.installation.status === 'update-available').length,
          stars: state.entries.find(entry => entry.name === 'dsh-open-market')?.metadata?.sortKeys?.['github-stars']
        };
      }, [state, day, preferences.showInstalled, counts]);

      const results = React.useMemo(() => {
        if (state.status !== 'ready' || !query.trim()) return null;
        const terms = query.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
        return [...state.entries].sort(recommendedOrder).filter(entry => {
          const haystack = [entry.name, titleOf(entry, resolve), entry.author, resolve(entry.description), ...(entry.metadata?.keywords || [])]
            .join(' ').normalize('NFKC').toLowerCase();
          return terms.every(term => haystack.includes(term));
        });
      }, [state, query, resolve]);

      async function addSource() {
        const listed = await remote.pluginMarket.listIndexes();
        const urls = listed.ok ? listed.value.map(source => source.url) : [];
        const added = urls.includes(INDEX_URL) ? { ok: true } : await remote.pluginMarket.setIndexes([...urls, INDEX_URL]);
        if (added.ok) void syncMarket();
        else updateMarket({ status: 'error', error: added.error, invalidPage: false });
      }

      const installWith = React.useCallback(target => install(installTarget(target, getSettings())), [install]);
      const props = { t, resolve, install: installWith, openPackage, manager, metadata: state.metadata, onError: setActionError, onNotice: setActionNotice, busyLabel,
        likesEnabled: preferences.likes, likes, onOpen: (entry, returnTarget) => setSelected({ entry, returnTarget }) };
      let content;
      if (state.status === 'loading') content = h(Loading, { t });
      else if (state.status === 'missing') content = h('div', { className: 'opm-state' },
        h('div', null, h('h2', null, t('missingTitle')), h('p', { className: 'opm-muted' }, t('missingBody'))),
        h('button', { type: 'button', className: 'opm-button opm-button-primary', onClick: addSource }, t('addSource')));
      else if (state.status === 'error') content = h('div', { className: 'opm-state' },
        h('div', { role: 'alert' }, h('h2', null, t('failed')),
          h('p', { className: 'opm-muted opm-error-detail' }, state.invalidPage ? t('invalidPage') : errorText(state.error, t('unknownError')))),
        h('button', { type: 'button', className: 'opm-button', onClick: () => void syncMarket() }, t('retry')));
      else {
        content = h(React.Fragment, null,
          h(Toolbar, { t, query, setQuery, updates: preferences.showCheckup ? sections.updates : null,
            onPanel: (kind, event) => setPanel({ kind, from: event.currentTarget }) }),
          results ? h(SearchResults, { ...props, entries: results }) : h(React.Fragment, null,
            h(FeaturedCarousel, { ...props, entries: sections.daily, autoRotate: preferences.autoRotate && !selected && !panel }),
            sections.rails.map(([section, entries]) => h(PluginRail, { ...props, key: section, section, entries })),
            h(AllPlugins, { ...props, entries: sections.all, counts })),
          actionNotice && h('p', { className: 'opm-note opm-action-error', role: 'status' }, actionNotice),
          actionError && h('p', { className: 'opm-error opm-action-error', role: 'alert' }, t('actionFailed') + ': ' + actionError));
      }
      const detailEntry = selected && (state.entries?.find(entry => entry.name === selected.entry.name) || selected.entry);
      return h('div', { className: 'opm-root opm-market', ref: root, tabIndex: -1 },
        h('div', { inert: selected || panel ? '' : undefined }, content,
        h('div', { className: 'opm-footer' },
          h('a', { className: 'opm-footer-link', href: t('websiteUrl'), target: '_blank', rel: 'noopener noreferrer',
            'aria-label': t('source') + ' ' + t('sourceLink') + ' · ' + t('newWindow') },
            h('img', { className: 'opm-footer-mark', src: new URL('/assets/apple-touch-icon.png', INDEX_URL).href, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' }),
            h('span', null, t('source')),
            h('span', { className: 'opm-footer-end' }, t('sourceLink'))),
          h(FooterInvite, { t, stars: sections?.stars }))),
        selected && h(PluginDetails, { ...props, entry: detailEntry, returnTarget: selected.returnTarget,
          marketRoot: root, onClose: closeDetails }),
        panel?.kind === 'favorites' && !selected && h(FavoritesPanel, { ...props, remote, entries: state.entries || [],
          onClose: closePanel, restoreFocus: restorePanel }),
        panel?.kind === 'installed' && !selected && h(InstalledPanel, { ...props, entries: state.entries || [],
          onClose: closePanel, restoreFocus: restorePanel }),
        panel?.kind === 'settings' && !selected && h(SettingsPanel, { t, manager, onClose: closePanel, restoreFocus: restorePanel }));
    }

    const SIDEBAR_PANEL = 'open-market';
    const SIDEBAR_SETTLE = 3000;
    const inject = ['slots', 'locale', 'remote'];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'open-market: dictionaries');
      ctx.effect(() => {
        const style = document.createElement('style');
        style.textContent = STYLES;
        document.head.appendChild(style);
        return () => style.remove();
      }, 'open-market: styles');
      const t = ctx.locale.bind(NS);
      const getManager = () => pluginManager;
      const resolve = text => ctx.locale.resolveText(text);
      let layout;
      ctx.inject(['layout'], ctx => {
        layout = ctx.layout;
        ctx.effect(() => () => { layout = undefined; }, 'open-market: layout');
      });
      const openPackage = name => {
        const navigation = ctx.get('pluginNavigation');
        if (navigation) navigation.openBundle(name);
        else layout?.selectPanel('plugins');
      };
      function SidebarPage() {
        return h('div', { className: 'opm-page' }, h('div', { className: 'opm-page-inner' },
          h('header', { className: 'opm-page-head', 'data-window-drag': true }, h('h1', null, t('title'))),
          h(OpenMarketTab, { t, remote: ctx.remote, manager: getManager, resolve, openPackage, busyLabel: 'installing',
            install: target => installDirectly(getManager, target, t) })));
      }
      function SidebarIcon({ size = 16 }) {
        return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
          strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
          h('path', { d: 'M4 10h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 10l1.5-5h13L20 10M9 14h6' }));
      }
      let removeSidebar;
      function syncSidebar() {
        const preference = getSettings().sidebarMarket;
        const decided = preference !== 'auto' || sidebarHost.settled;
        const wanted = sidebarHost.supported && decided && sidebarWanted(preference, sidebarHost);
        if (wanted && !removeSidebar) {
          readsIndexFile = true;
          const offPanel = ctx.slots.register({ name: 'main', key: SIDEBAR_PANEL, locale: NS }, SidebarPage);
          const offRow = ctx.slots.register({ name: 'sidebar.panellist', id: SIDEBAR_PANEL, order: 1, label: () => t('title'), locale: NS }, SidebarIcon);
          removeSidebar = () => {
            if (layout?.panelInfo.getSnapshot().activePanelId === SIDEBAR_PANEL) layout.selectPanel(null);
            offRow?.();
            offPanel?.();
          };
        } else if (!wanted && decided && removeSidebar) {
          readsIndexFile = false;
          removeSidebar();
          removeSidebar = undefined;
        }
      }
      ctx.effect(() => subscribeSettings(syncSidebar), 'open-market: sidebar setting');
      ctx.effect(() => subscribeSidebarHost(syncSidebar), 'open-market: sidebar host');
      ctx.slots.inject('sidebar.panellist', () => { updateSidebarHost({ supported: true }); });
      // The market service can arrive after the sidebar, so the automatic choice waits a moment to avoid a passing row.
      ctx.effect(() => {
        const timer = window.setTimeout(() => updateSidebarHost({ settled: true }), SIDEBAR_SETTLE);
        return () => {
          window.clearTimeout(timer);
          removeSidebar?.();
          removeSidebar = undefined;
          readsIndexFile = false;
          sidebarHost = { supported: false, tab: false, settled: false };
        };
      }, 'open-market: sidebar page');
      function SettingsSection({ view }) {
        if (view !== 'page') return null;
        return h('div', { className: 'opm-root' }, h(SettingsGroups, { t, manager: getManager }));
      }
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
        { name: 'plugins.bundle.config', key: 'dsh-open-market' }, SettingsSection));
      // Installs from DSH's own Discover never reach dshopen.org. While likes are on, each bundle that appears after an
      // install counts as an install like; sendLike skips plugins liked today and the server ignores unlisted names.
      // The plugin manager is optional: without it the tab still browses and installs, only Update is unavailable.
      let pluginManager;
      ctx.inject(['remote.pluginManager'], ctx => {
        pluginManager = ctx.remote.pluginManager;
        ctx.effect(() => () => { pluginManager = undefined; }, 'open-market: plugin manager');
        let known;
        const installed = async () => {
          const bundles = await refreshInstallation(() => ctx.remote.pluginManager);
          return bundles ? new Set(bundles.filter(bundle => bundle.installed).map(bundle => bundle.name)) : undefined;
        };
        installed().then(names => { known ??= names; }, () => {});
        ctx.effect(() => ctx.remote.$on('plugin-manager/changed', change => {
          if (change?.reason !== 'install') return;
          installed().then(names => {
            if (!names) return;
            if (known) for (const name of names) if (!known.has(name)) void sendLike(name, 'install');
            known = names;
          }, () => {});
        }), 'open-market: count installs');
      });
      // Custom markets may be off, unavailable, or still starting. Only the browsing tab needs this service.
      ctx.inject(['remote.pluginMarket'], ctx => {
        marketRemote = ctx.remote;
        ctx.effect(() => () => { if (marketRemote === ctx.remote) marketRemote = undefined; }, 'open-market: market service');
        const face = { remote: ctx.remote, manager: () => pluginManager, resolve };
        ctx.slots.inject('plugins.tab', () => { updateSidebarHost({ tab: true }); });
        ctx.slots.inject('plugins.tab', () => ctx.slots.register({
          name: 'plugins.tab',
          id: 'open-market',
          // Installed and Discover share order 0 and then follow load order; 1 keeps this tab after both.
          order: 1,
          label: () => t('title'),
          locale: NS,
          inject: () => face
        }, OpenMarketTab));
      });
    }

    // Test seams; DSH reads only apply and inject.
    const internals = { sortCatalog, listingOf, installDirectly, sidebarWanted, normalizeSettings, registryUrl, installTarget, bleedFor, needsRefresh, validCatalog, withInstallation, getMarket, syncMarket, enterMarket, REFRESH_INTERVAL, CACHE_SCHEMA, INDEX_URL,
      npmVersionRegistry, declaredDshRanges, npmVersions, loadNpmVersions, versionChoices, versionInstall, versionCommand, installVersion, requestSelfUpdate, VERSION_CACHE_TTL,
      PluginDetails, OtherVersions, zh, en, styles: STYLES };
    return { apply, inject, internals };
  }
});
