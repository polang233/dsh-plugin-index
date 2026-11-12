// Browser half: an "Open Market" tab on the Plugins page, next to Installed and Discover.
// Hand-written in the shape DSH's module loader expects, so the package still needs no build step.
window.__ModuleLoader__.load({
  id: 'dsh-open-market',
  factory: require => {
    const React = require('react');
    const h = React.createElement;
    let createPortal;
    try { createPortal = require('react-dom').createPortal; } catch { /* Older hosts render overlays in place. */ }
    let Switch;
    try { Switch = require('@deepseek-ai/dsh-client-ui-primitives').Switch; } catch { /* Older hosts use the checkbox fallback. */ }

    const SETTINGS_KEY = 'dsh-open-market:settings';
    const DEFAULT_SETTINGS = { autoRotate: true, showInstalled: true, showCheckup: true, likes: true, registry: 'index', customRegistry: '', sidebarMarket: 'on', theme: false, themeAppearance: 'auto' };
    const REGISTRY_CHOICES = ['index', 'dsh', 'npmmirror', 'custom'];
    function normalizeSettings(saved) {
      const result = Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) =>
        [key, typeof saved?.[key] === typeof fallback ? saved[key] : fallback]));
      // 0.2.5 stored the opposite switch, and it covered the rails only.
      if (typeof saved?.showInstalled !== 'boolean' && typeof saved?.hideInstalled === 'boolean') result.showInstalled = !saved.hideInstalled;
      if (!REGISTRY_CHOICES.includes(result.registry)) result.registry = DEFAULT_SETTINGS.registry;
      // Before 0.4 the page showed only where the Plugins tab could not; it is now on unless switched off.
      if (result.sidebarMarket !== 'off') result.sidebarMarket = 'on';
      if (!['auto', 'light', 'dark'].includes(result.themeAppearance)) result.themeAppearance = DEFAULT_SETTINGS.themeAppearance;
      // Likes are no longer a switch: the market counts anonymous likes for everyone.
      result.likes = true;
      return result;
    }
    function readSettings() {
      try { return normalizeSettings(JSON.parse(window.localStorage.getItem(SETTINGS_KEY))); } catch { return { ...DEFAULT_SETTINGS }; }
    }
    let settings = readSettings();
    const settingsDirty = new Set();
    const settingsListeners = new Set();
    const getSettings = () => settings;
    function subscribeSettings(listener) {
      settingsListeners.add(listener);
      return () => settingsListeners.delete(listener);
    }
    function updateSettings(key, value) {
      if (typeof value !== typeof DEFAULT_SETTINGS[key] || settings[key] === value) return;
      settings = { ...settings, [key]: value };
      settingsDirty.add(key);
      try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Keep this session usable without storage. */ }
      persistProfile('settings');
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

    // Named groups of package names, saved in the Host profile with a browser cache.
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
      persistProfile('favorites');
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

    const detailCache = new Map();
    function githubRepository(entry) {
      try {
        const url = new URL(repositoryOf(entry));
        const match = /^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.pathname);
        return url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password && match ? match[1] + '/' + match[2] : null;
      } catch { return null; }
    }
    async function detailText(response, limit) {
      if (+response.headers?.get('content-length') > limit) { await response.body?.cancel(); throw Error('Project details too large'); }
      if (!response.body?.getReader) {
        const text = await response.text();
        if (text.length > limit) throw Error('Project details too large');
        return text;
      }
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let bytes = 0, text = '';
      try {
        while (true) {
          const {done, value} = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > limit) throw Error('Project details too large');
          text += decoder.decode(value, {stream: true});
        }
        return text + decoder.decode();
      } finally { await reader.cancel(); reader.releaseLock(); }
    }
    async function githubJson(path) {
      const response = await fetch('https://api.github.com/repos/' + path, {
        headers: {accept: 'application/vnd.github+json'}, credentials: 'omit', signal: AbortSignal.timeout(15000)
      });
      if (response.status === 404) return null;
      if (!response.ok) throw Object.assign(Error('Project details unavailable'), {status: response.status});
      const text = await detailText(response, 2 * 1024 * 1024);
      return JSON.parse(text);
    }
    function cachedDetail(key, load) {
      const old = detailCache.get(key);
      if (old && Date.now() - old.time < VERSION_CACHE_TTL) return old.promise;
      const record = {time: Date.now(), promise: null};
      record.promise = load().catch(error => { if (detailCache.get(key) === record) detailCache.delete(key); throw error; });
      detailCache.set(key, record);
      return record.promise;
    }
    function screenshotUrl(value, base) {
      try {
        let url = new URL(value, base);
        if (url.protocol !== 'https:' || url.username || url.password) return null;
        if (url.hostname === 'github.com' && /\/blob\//.test(url.pathname)) url = new URL('https://raw.githubusercontent.com' + url.pathname.replace('/blob/', '/'));
        if (!['raw.githubusercontent.com', 'github.com', 'user-images.githubusercontent.com', 'private-user-images.githubusercontent.com'].includes(url.hostname)) return null;
        if (/badge|shields|logo|(?:^|[\/_.-])icon[\/_.-]|avatar|banner|divider|separator|border|spacer|footer|header|\.svg(?:$|\?)/i.test(url.href)) return null;
        if (!/\.(?:png|jpe?g|webp|gif)(?:$|\?)/i.test(url.href) && !(url.hostname === 'github.com' && url.pathname.includes('/user-attachments/assets/'))) return null;
        return url.href;
      } catch { return null; }
    }
    function extractScreenshots(markdown, base) {
      const pictures = [];
      // Code examples and comments often contain image snippets rather than actual previews.
      markdown = markdown.replace(/```[^\n]*\n[\s\S]*?```|<!--[\s\S]*?-->/g, value => value.replace(/[^\n]/g, ' '));
      const preview = /screenshot|screen[-_ ]?shot|preview|demo|界面|截图|效果|预览|演示/i;
      const decoration = /badge|logo|icon|avatar|banner|border|divider|separator|spacer|sponsor|star[-_ ]?history|徽章|标志|边框|分隔|赞助|二维码/i;
      const add = (value, alt, position, tag = '') => {
        const url = screenshotUrl(value, base);
        const heading = [...markdown.slice(0, position).matchAll(/^#{1,6}\s+(.+)$/gm)].at(-1)?.[1] || '';
        const width = /\bwidth\s*=\s*["']?(\d+)/i.exec(tag)?.[1], height = /\bheight\s*=\s*["']?(\d+)/i.exec(tag)?.[1];
        if ((width && +width < 180) || (height && +height < 100) || (width && height && +width / +height > 5)) return;
        if (url && !decoration.test(alt + ' ' + value) && preview.test(alt + ' ' + value + ' ' + heading)
          && !pictures.some(item => item.url === url)) pictures.push({url, alt: alt.slice(0, 200), position});
      };
      for (const match of markdown.matchAll(/!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^)]*)?\s*\)/g)) add(match[2] || match[3], match[1], match.index);
      for (const match of markdown.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)) add(match[1], /\balt\s*=\s*["']([^"']*)["']/i.exec(match[0])?.[1] || '', match.index, match[0]);
      return pictures.sort((a, b) => a.position - b.position).slice(0, 6).map(({url, alt}) => ({url, alt}));
    }
    async function rawProjectFile(repo, file, ref = 'HEAD') {
      const url = 'https://raw.githubusercontent.com/' + repo + '/' + encodeURIComponent(ref) + '/' + file.split('/').map(encodeURIComponent).join('/');
      const response = await fetch(url, {credentials: 'omit', signal: AbortSignal.timeout(10000)});
      if (response.status === 404) return null;
      if (!response.ok) throw Object.assign(Error('Project file unavailable'), {status: response.status});
      const text = await detailText(response, 1024 * 1024);
      return {text, url};
    }
    function projectDirectory(entry, source) {
      const directory = source?.path || entry.repository?.directory;
      return typeof directory === 'string' && directory.split('/').every(part => part && part !== '.' && part !== '..') ? directory + '/' : '';
    }
    function curatedScreenshots(entry) {
      return cachedDetail('curated-screenshots', async () => {
        const response = await fetch(new URL('display.json', INDEX_URL).href, {credentials: 'omit', signal: AbortSignal.timeout(8000)});
        if (!response.ok) throw Error('Preview catalog unavailable');
        const text = await detailText(response, 2 * 1024 * 1024);
        const catalog = JSON.parse(text);
        if (catalog.schema !== 1 || !catalog.plugins) throw Error('Invalid preview catalog');
        return catalog.plugins;
      }).then(plugins => {
        const images = plugins[entry.name]?.screenshots;
        if (!Array.isArray(images)) return undefined;
        return images.slice(0, 6).flatMap(image => {
          const url = screenshotUrl(image?.url);
          return url ? [{url, alt: typeof image.alt === 'string' ? image.alt.slice(0, 200) : '', origin: 'author'}] : [];
        });
      }, () => undefined);
    }
    async function loadScreenshots(entry) {
      const curated = await curatedScreenshots(entry);
      if (curated !== undefined) return curated;
      const repo = githubRepository(entry);
      if (!repo) return [];
      const source = defaultVersionOf(entry)?.source ?? entry.versions?.[0]?.source;
      const ref = source?.type === 'git' ? source.commit : null;
      const relative = projectDirectory(entry, source);
      return cachedDetail('screens:' + repo + ':' + relative + ':' + (ref || 'default'), async () => {
        let failure;
        // Raw files do not consume the unauthenticated GitHub API quota.
        for (const file of [...new Set([relative + 'README.md', 'README.md'])]) {
          try {
            const readme = await rawProjectFile(repo, file, ref || 'HEAD');
            if (readme) return extractScreenshots(readme.text, readme.url).map(image => ({...image, origin: 'readme'}));
          } catch (error) { failure = error; }
        }
        const query = ref ? '?ref=' + encodeURIComponent(ref) : '';
        let readme = relative ? await githubJson(repo + '/contents/' + relative.split('/').filter(Boolean).map(encodeURIComponent).join('/') + '/README.md' + query) : null;
        if (!readme) readme = await githubJson(repo + '/readme' + query);
        if (!readme) { if (failure) throw failure; return []; }
        if (readme.encoding !== 'base64' || typeof readme.content !== 'string' || readme.content.length > 1400000) throw Error('Invalid project readme');
        const markdown = new TextDecoder().decode(Uint8Array.from(atob(readme.content.replace(/\s/g, '')), char => char.charCodeAt(0)));
        return extractScreenshots(markdown, readme.download_url || 'https://raw.githubusercontent.com/' + repo + '/' + (ref || 'HEAD') + '/' + relative + 'README.md').map(image => ({...image, origin: 'readme'}));
      });
    }
    function extractVersionNotes(markdown, version) {
      const headings = [...markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)];
      const at = headings.findIndex(heading => /(?:^|[\s\[@/]|-v)v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?=$|[\s\]])/.exec(heading[2])?.[1] === version);
      if (at < 0) return null;
      const heading = headings[at], end = headings.slice(at + 1).find(next => next[1].length <= heading[1].length)?.index ?? markdown.length;
      return markdown.slice(heading.index + heading[0].length, end).trim().slice(0, 60000) || null;
    }
    function loadReleaseNotes(entry, version) {
      const repo = githubRepository(entry);
      if (!repo || !EXACT_VERSION.test(version.version)) return Promise.resolve(null);
      return cachedDetail('release:' + repo + ':' + entry.name + ':' + version.version + ':' + (version.source?.commit || '') + ':' + (entry.installation?.source || ''), async () => {
        const short = entry.name.split('/').at(-1);
        const tags = [...new Set(['v' + version.version, version.version, entry.name + '-v' + version.version, short + '-v' + version.version, entry.name + '@' + version.version, short + '@' + version.version])];
        let failure;
        for (const tag of tags) {
          try {
            const release = await githubJson(repo + '/releases/tags/' + encodeURIComponent(tag));
            if (typeof release?.body === 'string' && release.body.trim() && release.tag_name === tag) return {body: release.body.slice(0, 60000), url: 'https://github.com/' + repo + '/releases/tag/' + encodeURIComponent(tag)};
          } catch (error) { failure = error; break; }
        }
        const relative = projectDirectory(entry, version.source), ref = version.source?.type === 'git' ? version.source.commit : 'HEAD';
        for (const file of [...new Set([relative + 'CHANGELOG.md', 'CHANGELOG.md', relative + 'changelog.md'])]) {
          try {
            const changelog = await rawProjectFile(repo, file, ref);
            const body = changelog && extractVersionNotes(changelog.text, version.version);
            if (body) return {body, url: changelog.url};
          } catch (error) { failure ??= error; }
        }
        const previous = entry.installation?.source;
        const sha = version.source?.type === 'git' && version.source.commit;
        const old = typeof previous === 'string' && /#([a-f0-9]{40})(?:&|$)/.exec(previous)?.[1];
        if (sha && old && previous.split('#', 1)[0].replace(/^git\+/, '').replace(/\.git$/, '') === 'https://github.com/' + repo && old !== sha) {
          const comparison = await githubJson(repo + '/compare/' + old + '...' + sha);
          if (comparison?.commits?.length) return {body: comparison.commits.slice(0, 30).map(item => '• ' + item.commit.message.split('\n')[0]).join('\n'), url: 'https://github.com/' + repo + '/compare/' + old + '...' + sha};
        }
        if (failure) throw failure;
        return null;
      });
    }

    async function requestSelfUpdate(target, t, { fetchImpl = fetch } = {}) {
      // Resolve locale text before the request can unload the context that supplied t.
      const unavailable = t('selfUpdateUnavailable'), unauthorized = t('selfUpdateUnauthorized'), lost = t('selfUpdateConnectionLost');
      const restart = t('updateRestart'), scripts = t('installNeedsDialog');
      const outcomeText = updateTexts(t);
      try {
        const response = await fetchImpl('/dsh-open-market/self-update', {
          method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(target)
        });
        if (response.status === 401 || response.status === 403) return { ok: false, error: unauthorized };
        if (!response.ok) return { ok: false, error: unavailable };
        const answer = await response.json();
        if (typeof answer?.ok !== 'boolean') return { ok: false, error: lost };
        if (answer.code === 'stop-profile') return { ...answer, error: restart };
        if (answer.code === 'install-needs-dialog') return updateOutcome({...answer, error: scripts}, outcomeText);
        return updateOutcome(answer, outcomeText);
      } catch { return { ok: false, error: lost }; }
    }

    function updateTexts(t) {
      const keys = ['restoreUnavailable', 'updateBusy', 'updateRestoredRestart', 'updateRestored', 'unknownError', 'updateRestoreFailed', 'updateUnavailable',
        'manageBusy', 'manageMonitor', 'manageUpdating', 'manageUnavailable', 'manageChanged'];
      const messages = Object.fromEntries(keys.map(key => [key, t(key)]));
      return key => messages[key];
    }
    function updateOutcome(answer, t) {
      let error = answer.error;
      if (answer.code === 'restore-unavailable') error = t('restoreUnavailable');
      else if (answer.code === 'update-busy') error = t('updateBusy');
      else if (answer.code === 'update-unavailable') error = t('updateUnavailable');
      else {
        const key = {'tasks-active': 'manageBusy', 'task-monitor-unavailable': 'manageMonitor', 'management-busy': 'manageUpdating',
          'management-unavailable': 'manageUnavailable', 'installation-changed': 'manageChanged'}[answer.code];
        if (key) error = t(key);
      }
      if (answer.restored === true) error = errorText(error, t('unknownError')) + ' · ' + t(answer.restoreRestart ? 'updateRestoredRestart' : 'updateRestored');
      else if (answer.restored === false) error = errorText(error, t('unknownError')) + ' · ' + t('updateRestoreFailed') + (answer.restoreSpec ? ' ' + answer.restoreSpec : '');
      return {...answer, ...(error ? {error} : {})};
    }
    async function requestBundleUpdate(target, t, {fetchImpl = fetch} = {}) {
      const outcomeText = updateTexts(t);
      try {
        const response = await fetchImpl('/dsh-open-market/update', {method: 'POST', credentials: 'same-origin',
          headers: {'content-type': 'application/json'}, body: JSON.stringify(target)});
        if (response.status === 401 || response.status === 403) return {ok: false, error: t('selfUpdateUnauthorized')};
        if (!response.ok) return {ok: false, error: t('updateUnavailable')};
        const answer = await response.json();
        if (typeof answer?.ok !== 'boolean') return {ok: false, error: t('updateConnectionLost')};
        if (answer.code === 'stop-profile') return {...answer, error: t('updateRestart')};
        if (answer.code === 'install-needs-dialog') answer.error = t('installNeedsDialog');
        return updateOutcome(answer, outcomeText);
      } catch { return {ok: false, error: t('updateConnectionLost')}; }
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
        text.textContent = answer.ok ? answer.restart ? messages.restart : messages.done : messages.failed + ': ' + errorText(answer.error, messages.failed) + (answer.restored === false ? ' ' + messages.recovery : '');
        return answer;
      });
    }

    async function installVersion(entry, version, { install, t, title = entry.name, onPhase = () => {}, busyLabel = 'busy', selfUpdate = updateSelf, update = requestBundleUpdate,
      when = 'now', management = requestManagement }) {
      if (entry.installation.status === 'provided') return { ok: false, error: t('providedVersion') };
      if (when === 'idle' && entry.installation.status !== 'not-installed') {
        onPhase('manageQueuing');
        const answer = await management({action: 'update', name: entry.name, ...installTarget(versionInstall(entry, version), getSettings()), when, requestId: crypto.randomUUID()});
        return answer.ok ? answer : {...answer, error: managementMessage(answer, t)};
      }
      if (entry.name === 'dsh-open-market' && entry.installation.status !== 'not-installed') {
        onPhase('selfUpdating');
        const answer = await selfUpdate(installTarget({ ...versionInstall(entry, version), title, version: version.version }, getSettings()), t);
        return { ...answer, selfUpdate: true };
      }
      if (entry.installation.status !== 'not-installed') {
        onPhase('updating');
        return update({name: entry.name, ...installTarget(versionInstall(entry, version), getSettings())}, t);
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
        const bundle = byName.get(entry.name);
        const installation = {...installationOf(entry, bundle), ...(bundle?.source ? {source: bundle.source} : {})};
        if (installation.status === entry.installation?.status && installation.installedVersion === entry.installation?.installedVersion && installation.source === entry.installation?.source) return entry;
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
    const SELF_INSTALL_KEY = 'dsh-open-market:install-counted';
    let selfInstallCounted = false;
    try { selfInstallCounted = window.localStorage.getItem(SELF_INSTALL_KEY) === '1'; } catch { /* Keep a session marker without storage. */ }
    function markSelfInstallCounted() {
      selfInstallCounted = true;
      try { window.localStorage.setItem(SELF_INSTALL_KEY, '1'); } catch { /* Keep the session marker. */ }
      persistProfile('installCounted');
    }
    function countSelfInstall() {
      if (!profileReady || selfInstallCounted || !settings.likes) return;
      resetLikedDay();
      if (likesState.names.has('dsh-open-market') && !pendingLikes.has('dsh-open-market')) markSelfInstallCounted();
      else void sendLike('dsh-open-market', 'install');
    }
    function supportMarket() { void sendLike('dsh-open-market', 'like'); }
    let profileReady = false, profileLoading;
    let profileStatus = 'loading', profileWrites = Promise.resolve();
    const profileListeners = new Set(), profileDirty = new Set();
    const getProfileStatus = () => profileStatus;
    function setProfileStatus(value) { profileStatus = value; profileListeners.forEach(listener => listener()); }
    function profileValues() { return {settings, favorites, installCounted: selfInstallCounted, footerTurn}; }
    async function profileRequest(patch, initialize = false) {
      const response = await fetch('/dsh-open-market/state', {
        method: 'POST', credentials: 'same-origin', headers: {'content-type': 'application/json'},
        body: JSON.stringify({patch, initialize}), signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) throw Error('Preferences unavailable');
      const data = await response.json();
      if (!data?.ok || data.state?.schema !== 1) throw Error('Invalid preferences');
      return data.state;
    }
    function persistProfile(field) {
      if (field) profileDirty.add(field);
      if (!profileReady) return profileWrites;
      setProfileStatus('saving');
      profileWrites = profileWrites.then(async () => {
        const values = profileValues(), patch = Object.fromEntries([...profileDirty].map(key => [key, values[key]]));
        if (Object.keys(patch).length) {
          await profileRequest(patch);
          const current = profileValues();
          for (const key of Object.keys(patch)) if (current[key] === patch[key]) {
            profileDirty.delete(key);
            if (key === 'settings') settingsDirty.clear();
          }
        }
        setProfileStatus(profileDirty.size ? 'saving' : 'ready');
      }).catch(() => setProfileStatus('error'));
      return profileWrites;
    }
    function hydrateProfile() {
      if (profileLoading) return profileLoading;
      setProfileStatus('loading');
      const initialFavorites = favorites;
      profileLoading = (async () => {
        try {
          // The Host initializes missing fields only, so another browser's saved choices win over this cache.
          const saved = await profileRequest(profileValues(), true);
          if (saved.settings) {
            const local = settings;
            settings = normalizeSettings(saved.settings);
            for (const key of settingsDirty) settings[key] = local[key];
          }
          if (saved.favorites) favorites = profileDirty.has('favorites')
            ? mergeFavoriteChanges(normalizeFavorites(saved.favorites), initialFavorites, favorites) : normalizeFavorites(saved.favorites);
          if (!profileDirty.has('installCounted')) selfInstallCounted = saved.installCounted === true;
          if (!profileDirty.has('footerTurn') && (saved.footerTurn === 0 || saved.footerTurn === 1)) footerTurn = saved.footerTurn;
          try {
            window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
            window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
            window.localStorage.setItem(SELF_INSTALL_KEY, selfInstallCounted ? '1' : '0');
            window.localStorage.setItem(FOOTER_KEY, String(footerTurn));
          } catch { /* The Host copy remains authoritative without browser storage. */ }
          profileReady = true;
          setProfileStatus('ready');
          settingsListeners.forEach(listener => listener());
          favoritesListeners.forEach(listener => listener());
          if (profileDirty.size) void persistProfile();
          countSelfInstall();
          return true;
        } catch { setProfileStatus('error'); return false; }
        finally { profileLoading = undefined; }
      })();
      return profileLoading;
    }
    function mergeFavoriteChanges(remote, before, after) {
      const groups = remote.groups.map(group => ({...group, names: [...group.names]}));
      for (const previous of before.groups) {
        if (previous.id !== DEFAULT_GROUP && !after.groups.some(group => group.id === previous.id)) {
          const index = groups.findIndex(group => group.id === previous.id);
          if (index >= 0) groups.splice(index, 1);
        }
      }
      for (const local of after.groups) {
        const previous = before.groups.find(group => group.id === local.id);
        let group = groups.find(group => group.id === local.id);
        if (!previous) { if (!group) groups.push({...local, names: [...local.names]}); continue; }
        const removed = previous.names.filter(name => !local.names.includes(name));
        const added = local.names.filter(name => !previous.names.includes(name));
        if (!group && (added.length || local.name !== previous.name)) groups.push(group = {...local, names: []});
        if (group) {
          if (local.name !== previous.name) group.name = local.name;
          group.names = [...new Set([...group.names.filter(name => !removed.includes(name)), ...added])];
        }
      }
      return normalizeFavorites({schema: 1, groups});
    }
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
        if (!profileReady && !await hydrateProfile()) return;
        if (!settings.likes) return;
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
      if (!profileReady && !await hydrateProfile()) return;
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
        if (name === 'dsh-open-market') markSelfInstallCounted();
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
    const managementLocale = {
      zh: {
        manageSearch: '搜索名称、包名或来源', manageAll: '全部', manageEnabled: '已启用', manageDisabled: '已停用', manageUpdates: '有更新',
        manageProblems: '有问题', manageExternal: '市场外', manageGroup: '收藏分组', manageAllGroups: '所有分组',
        manageTotal: '{total} 个插件', manageCount: '{shown} / {total} 个插件', manageDetails: '详情', manageSettings: '打开设置', manageUninstall: '卸载',
        manageSelect: '选择 {name}', manageSelectAll: '全选', manageClear: '取消全选', manageSelected: '已选择 {count} 个',
        manageCheck: '检查更新', manageChecking: '正在检查…', manageChecked: '更新检查已完成', manageOffered: '可用版本',
        manageNow: '立即更新', manageIdle: '空闲后更新', manageQueueSelected: '所选插件空闲后更新',
        manageQueue: '更新队列', manageQueueEmpty: '没有更新任务', manageQueued: '已加入空闲更新队列', manageCancel: '取消排队',
        manageRetry: '重新排队', manageDismiss: '移除记录', manageReport: '复制管理报告', manageReportCopied: '报告已复制',
        manageStateQueued: '已排队', manageStateWaiting: '等待空闲', manageStateRunning: '正在更新', manageStateSucceeded: '已完成',
        manageStateFailed: '失败', manageStateCancelled: '已取消', manageStateInterrupted: '等待重新确认',
        manageIdleHelp: '等到没有任务运行时再更新；更新期间新的输入会排队。',
        manageBusy: '有任务在运行，操作没有执行。更新可以选「空闲后更新」。',
        manageMonitor: 'DSH 无法确认任务是否空闲，修改操作暂不可用。',
        manageUpdating: '另一个管理操作正在执行，请稍后重试。', manageRestarted: 'Host 已重启，请重新确认后排队。',
        manageUnavailable: '管理服务暂不可用，请稍后再试。', manageRunning: '有 {count} 个运行中的任务',
        manageReady: '任务空闲', manageMonitoring: '无法确认任务状态', manageReadonly: '由 DSH 管理，不能在这里修改',
        manageSelf: '开放市场自己请在官方插件页停用或卸载。', manageRestart: '已保存，重启 DSH 后生效',
        manageDone: '操作已完成', manageSource: '安装来源', manageRows: '组件', manageNoRows: '没有独立组件',
        manageNative: '打开官方详情', manageNativeUnavailable: '已打开插件页；此版本不支持定位详情。', manageTarget: '固定 Git 提交',
        manageRemoveTitle: '确认卸载', manageRemoveHelp: '插件自己保存的数据可能会保留。',
        manageConfirmName: '输入完整包名确认', manageCancelRemove: '保留插件', manageNoMarket: '未在开放市场收录。',
        manageDocument: '插件说明', manageLoadDocument: '读取本机说明', manageNoDocument: '此插件没有提供说明文档。',
        manageNoResults: '没有符合筛选条件的插件', manageNoSelection: '选择左侧插件查看详情', manageQueuedCount: '队列 {count}',
        manageCheckUnavailable: '当前宿主不支持此来源的版本检查',
        manageChanged: '安装版本、来源或启用状态已改变，请刷新列表后重新选择更新。', manageFilter: '插件筛选',
        manageMissing: '插件已不在本机安装列表中。', manageQueueFull: '更新队列已满，请先处理现有任务。',
        manageQueuing: '正在排队…',
        manageRowUnknown: '未加载或状态未知',
        manageCustom: '自定义插件', manageSystem: '系统插件',
        manageOverview: '启动顺序与运行环境', manageDiagnostics: '诊断与目录', manageLoaded: '已加载',
        manageErrorCount: '加载异常', manageRiskCount: '风险提示', manageRiskHelp: '只检查兼容范围、依赖和安装脚本，不是安全审计。',
        manageDirectories: '加载与配置位置', manageHome: 'DSH 数据目录', manageInstallation: 'DSH 加载目录', manageProfile: '当前配置目录',
        managePackage: '插件加载目录', manageConfiguration: 'DSH 插件配置目录',
        manageOpenDirectory: '打开目录', manageArchived: '归档内，打开所在目录', manageDirectoryUnavailable: '此目录暂不可用',
        manageDiagnosticUnavailable: '当前 DSH 不支持扩展诊断', manageCompatibility: 'DSH 版本兼容性',
        manageCompatible: '兼容', manageIncompatible: '不兼容', manageUndeclared: '未声明范围', manageExempted: '已豁免版本限制', manageUnknown: '未知',
        manageDependencies: '依赖关系', manageDependents: '被这些插件依赖', manageNoDependencies: '没有声明运行依赖',
        manageDependencySatisfied: '满足', manageDependencyMissing: '缺失', manageDependencyMismatch: '版本不符',
        manageDependencyOptional: '可选，未安装', manageDependencyUnverified: '特殊来源，未核对范围', manageDependencyUnknown: '无法核对',
        manageOrder: '配置层顺序', manageRuntimeOrder: '运行实例顺序', manageOrderHelp: '依赖要排在使用它的插件前面。',
        manageOrderSaved: '保存启动顺序', manageOrderReset: '放弃调整', manageOrderUp: '前移 {name}', manageOrderDown: '后移 {name}',
        manageOrderEmpty: '没有已启用的自定义插件可调整', manageOrderFailed: '加载顺序未能应用，已尝试恢复原配置。',
        manageDependencyOrder: '{name} 依赖 {dependency}，请把 {dependency} 排在它前面。', manageInstallScripts: '声明了安装脚本', manageDependencyRisk: '依赖需要处理',
        manageCompatibilityRisk: '版本兼容性需要确认', manageNoRisks: '没有风险提示', manageNotSelected: '未加入启动配置',
        manageActive: '运行中', manageLoading: '正在加载', managePending: '等待加载', manageUnloading: '正在卸载', manageFailed: '加载失败',
      },
      en: {
        manageSearch: 'Search names, packages or sources', manageAll: 'All', manageEnabled: 'Enabled', manageDisabled: 'Disabled', manageUpdates: 'Updates',
        manageProblems: 'Problems', manageExternal: 'Not in market', manageGroup: 'Favorite group', manageAllGroups: 'All groups',
        manageTotal: '{total} plugins', manageCount: '{shown} / {total} plugins', manageDetails: 'Details', manageSettings: 'Open settings', manageUninstall: 'Uninstall',
        manageSelect: 'Select {name}', manageSelectAll: 'Select all', manageClear: 'Clear', manageSelected: '{count} selected',
        manageCheck: 'Check updates', manageChecking: 'Checking…', manageChecked: 'Update check complete', manageOffered: 'Available version',
        manageNow: 'Update now', manageIdle: 'Update when idle', manageQueueSelected: 'Update selected when idle',
        manageQueue: 'Update queue', manageQueueEmpty: 'No update tasks', manageQueued: 'Added to the idle update queue', manageCancel: 'Cancel queued update',
        manageRetry: 'Queue again', manageDismiss: 'Remove record', manageReport: 'Copy management report', manageReportCopied: 'Report copied',
        manageStateQueued: 'Queued', manageStateWaiting: 'Waiting for idle', manageStateRunning: 'Updating', manageStateSucceeded: 'Completed',
        manageStateFailed: 'Failed', manageStateCancelled: 'Cancelled', manageStateInterrupted: 'Needs confirmation',
        manageIdleHelp: 'Waits until no task is running; new input waits during the update.',
        manageBusy: 'A task is running, so nothing changed. Updates can use Update when idle.',
        manageMonitor: "DSH can't tell whether tasks are idle, so changes are unavailable.",
        manageUpdating: 'Another management operation is running. Try again shortly.', manageRestarted: 'The Host restarted. Confirm the update before queuing it again.',
        manageUnavailable: 'Plugin management is unavailable. Try again shortly.', manageRunning: '{count} tasks running',
        manageReady: 'Tasks idle', manageMonitoring: 'Task state unavailable', manageReadonly: 'Managed by DSH; it cannot be changed here',
        manageSelf: "Disable or uninstall Open Market itself from DSH's Plugins page.", manageRestart: 'Saved; restart DSH to apply',
        manageDone: 'Operation completed', manageSource: 'Installation source', manageRows: 'Components', manageNoRows: 'No separate components',
        manageNative: 'Open native details', manageNativeUnavailable: 'Opened Plugins; this version cannot navigate to a detail page.', manageTarget: 'Pinned Git commit',
        manageRemoveTitle: 'Confirm uninstall', manageRemoveHelp: 'Data the plugin saved on its own may stay behind.',
        manageConfirmName: 'Type the full package name to confirm', manageCancelRemove: 'Keep plugin', manageNoMarket: 'Not listed in Open Market.',
        manageDocument: 'Plugin notes', manageLoadDocument: 'Read local documentation', manageNoDocument: 'This plugin provides no documentation.',
        manageNoResults: 'No plugins match these filters', manageNoSelection: 'Pick a plugin to see its details', manageQueuedCount: 'Queue {count}',
        manageCheckUnavailable: 'This Host cannot check versions for this source',
        manageChanged: 'The installed version, source or selection changed. Refresh the list and choose the update again.', manageFilter: 'Plugin filters',
        manageMissing: 'This plugin is no longer installed.', manageQueueFull: 'The update queue is full. Finish or cancel existing tasks first.',
        manageQueuing: 'Queuing…',
        manageRowUnknown: 'Not loaded or state unknown',
        manageCustom: 'Custom plugins', manageSystem: 'System plugins',
        manageOverview: 'Load order and environment', manageDiagnostics: 'Diagnostics and directories', manageLoaded: 'Loaded',
        manageErrorCount: 'Load problems', manageRiskCount: 'Risk indicators', manageRiskHelp: 'Checks the compatibility range, dependencies and install scripts only; not a security audit.',
        manageDirectories: 'Loading and configuration locations', manageHome: 'DSH data directory', manageInstallation: 'DSH installation directory', manageProfile: 'Current profile directory',
        managePackage: 'Plugin directory', manageConfiguration: 'DSH plugin configuration directory',
        manageOpenDirectory: 'Open directory', manageArchived: 'Inside an archive; open its parent directory', manageDirectoryUnavailable: 'This directory is unavailable',
        manageDiagnosticUnavailable: "This DSH doesn't provide extended diagnostics", manageCompatibility: 'DSH version compatibility',
        manageCompatible: 'Compatible', manageIncompatible: 'Incompatible', manageUndeclared: 'No range declared', manageExempted: 'Version exemption active', manageUnknown: 'Unknown',
        manageDependencies: 'Dependencies', manageDependents: 'Required by', manageNoDependencies: 'No runtime dependencies declared',
        manageDependencySatisfied: 'Satisfied', manageDependencyMissing: 'Missing', manageDependencyMismatch: 'Version mismatch',
        manageDependencyOptional: 'Optional, not installed', manageDependencyUnverified: 'Special source; range unverified', manageDependencyUnknown: 'Unable to verify',
        manageOrder: 'Bundle layer order', manageRuntimeOrder: 'Runtime entry order', manageOrderHelp: 'Put dependencies before the plugins that use them.',
        manageOrderSaved: 'Save load order', manageOrderReset: 'Discard changes', manageOrderUp: 'Move {name} earlier', manageOrderDown: 'Move {name} later',
        manageOrderEmpty: 'No enabled custom plugins to reorder', manageOrderFailed: 'Could not apply load order; restoration was attempted.',
        manageDependencyOrder: '{name} requires {dependency}; move {dependency} above it.', manageInstallScripts: 'Install scripts declared', manageDependencyRisk: 'Dependency needs attention',
        manageCompatibilityRisk: 'Compatibility needs confirmation', manageNoRisks: 'No risk indicators', manageNotSelected: 'Not selected for startup',
        manageActive: 'Running', manageLoading: 'Loading', managePending: 'Waiting to load', manageUnloading: 'Unloading', manageFailed: 'Load failed',
      },
    };
    const zh = {
      ...managementLocale.zh,
      category: '分类', allCategories: '全部分类',
      profileSaved: '收藏和设置已保存在当前 DSH 配置中', profileSaving: '正在保存收藏和设置…',
      profileFailed: '收藏和设置暂存本机，尚未保存到当前 DSH 配置。',
      screenshots: '界面预览', screenshotsEmpty: '作者暂无可展示的截图', detailLoading: '正在加载…',
      detailFailed: '项目内容读取失败，可重试或打开原文。', detailRateLimited: 'GitHub 请求额度已用完，请稍后重试或打开原文。', releaseNotes: '更新说明',
      screenshotsAuthor: '作者提供的实际效果', screenshotsReadme: '从项目 README 识别的预览', screenshotsUnavailable: '预览图片无法显示，请打开项目页面查看。',
      releaseEmpty: '未找到这个版本的更新说明', releaseSource: '查看原始说明',
      restoreUnavailable: '无法确认原安装来源，已保留当前版本。请从「插件」页管理此插件。',
      updateBusy: '另一个插件正在更新，请稍后重试', updateRestored: '原版本已恢复',
      updateRestoredRestart: '原版本已恢复，重启 DSH 后生效', updateRestoreFailed: '原版本恢复失败，请从「插件」页重新安装：',
      updateConnectionLost: '连接中断，宿主可能仍在更新或恢复。请在「插件 → 已安装」检查版本。',
      title: '开放市场', loading: '正在读取开放插件市场…',
      searchPlaceholder: '搜索插件名称、作者或描述',
      resultCount: '{count} 个插件', noResults: '没有找到匹配的插件', showMore: '显示更多', clearSearch: '清除', failed: '读取失败', retry: '重试',
      missingTitle: '开放插件市场不在索引源中', missingBody: '它可能在「发现」里被删掉了。添加后这里和「发现」都能看到。', addSource: '添加索引源',
      today: '今日推荐', recommended: '智能推荐', popular: '最受欢迎', trending: '增长最快',
      newest: '最新发布', health: '插件管理',
      todayHint: '每天更新，按点赞和推荐加权', recommendedHint: '近期活跃，也留位置给新收录的插件', popularHint: '按近期点赞',
      rankings: '排行榜', rankingsHint: '点赞和星数，各看前几名', rankingsMore: '展开前 {count} 名', rankingsLess: '收起', starred: '星数最多', starredHint: 'GitHub star 总数',
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
      incompatible: '不兼容', busy: '正在打开…', updating: '正在检查并更新…', actionFailed: '无法完成插件操作',
      updateHint: '先检查目标版本，替换失败时恢复原版本', updateRestart: '这个插件正在运行，DSH 重启后才能更新，请重启后再试',
      updateUnavailable: '当前无法使用带恢复的更新，请先从「插件」页更新开放市场；原插件已保留。',
      unknownError: '未知错误', invalidPage: '市场返回了无效的分页数据', unknownVersion: '版本未知',
      noDescription: '暂无描述', sectionEmpty: '暂无符合条件的插件',
      previous: '向左浏览 {section}', next: '向右浏览 {section}',
      source: '数据来自开放插件市场', sourceLink: 'dshopen.org', newWindow: '在新窗口打开',
      recommendationPosition: '查看第 {number} 组推荐', settings: '设置', about: '关于',
      autoRotate: '今日推荐自动轮播', showInstalled: '在推荐和全部插件中显示已安装的插件', showCheckup: '显示插件管理的更新数量', installing: '正在安装…', sidebarMarket: '在侧边栏显示开放市场', theme: '鲸鱼女仆主题', themeHelp: '把 DSH 换成 dshopen.org 的样子：粗墨线、硬阴影、马卡龙配色，空白处还有鲸鱼女仆。整个界面都会换，关掉立即恢复。', themeAppearance: '主题外观', appearanceAuto: '跟随 DSH', appearanceLight: '浅色', appearanceDark: '深色', sidebarMarketHelp: '全宽页面，从这里安装不弹安装窗口；需要确认安装脚本的插件请到「插件」页安装。', installNeedsDialog: '这个插件需要确认安装脚本，请到「插件」页安装', installedRestart: '已安装，重启 DSH 后生效',
      settingsDisplay: '显示', settingsTheme: '主题', settingsData: '数据与同步', settingsDownload: '下载', settingsTools: '小工具',
      syncData: '市场数据', syncNow: '同步最新数据', syncing: '正在同步…', syncedAt: '上次同步：{time}', neverSynced: '还没有同步过',
      syncFailed: '同步失败，继续显示已有数据', syncUnavailable: '打开「自定义插件市场」后才能同步', syncHelp: '打开市场时先显示本机保存的数据，每 6 小时在后台更新一次，不影响正常浏览。',
      registryLabel: '从哪个源下载', registryIndex: 'npm 官方源', registryDsh: '跟随 DSH 的安装源', registryNpmmirror: '中国大陆镜像源', registryCustom: '自定义地址',
      registryPlaceholder: 'https://npm.example.com/', registryInvalid: '请输入以 http:// 或 https:// 开头、不含账号密码的地址',
      registryHelp: '在开放市场里安装和更新 npm 插件时先问这个源，连不上或还没同步到这个包时，DSH 通常会改问另一个可信的源。Git 来源的插件直接从 GitHub 下载；DSH 自己的「发现」页不受这里影响。',
      registryCustomHelp: '自定义地址只问这一个源，不会回退到其他源。需要登录的源，请把凭据放在本机的 ~/.npmrc 里。',
      autoReview: '新对话默认「自动审查」', autoReviewHelp: '新对话直接用 DSH 的实验性「自动审查」权限，不用每次手动切换。由当前模型判断每次工具调用，可能误判，也会多用一些 token；首次打开可能需要重启 DSH。', autoReviewRestart: '已保存，重启 DSH 后生效', autoReviewFailed: '切换失败：{reason}',
      likesHelp: '点赞、安装和首次打开会向 dshopen.org 发送匿名计数，用于推荐排序；每人每天每个插件最多计一次。',
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
      ...managementLocale.en,
      category: 'Category', allCategories: 'All categories',
      profileSaved: 'Favorites and settings are saved in this DSH profile', profileSaving: 'Saving favorites and settings…',
      profileFailed: 'Favorites and settings are cached here, but have not been saved to this DSH profile.',
      screenshots: 'Screenshots', screenshotsEmpty: 'No screenshots provided yet', detailLoading: 'Loading…',
      detailFailed: 'Could not read project content. Retry or open the source.', detailRateLimited: 'GitHub request limit reached. Retry later or open the source.', releaseNotes: 'Release notes',
      screenshotsAuthor: 'Previews provided by the author', screenshotsReadme: 'Previews identified in the project README', screenshotsUnavailable: 'Preview images could not be displayed. Open the project page to view them.',
      releaseEmpty: 'No release notes found for this version', releaseSource: 'View original notes',
      restoreUnavailable: 'The original source could not be confirmed. The current version was kept. Manage this plugin from Plugins.',
      updateBusy: 'Another plugin is updating. Try again shortly.', updateRestored: 'The original version was restored',
      updateRestoredRestart: 'The original version was restored; restart DSH to use it', updateRestoreFailed: 'Restoration failed. Reinstall from Plugins:',
      updateConnectionLost: 'Connection lost. The Host may still be updating or restoring. Check the version under Plugins → Installed.',
      title: 'Open Market', loading: 'Loading Open Plugin Market…',
      searchPlaceholder: 'Search plugins by name, author or description',
      resultCount: '{count} plugins', noResults: 'No matching plugins', showMore: 'Show more', clearSearch: 'Clear', failed: 'Could not load the market', retry: 'Retry',
      missingTitle: 'Open Plugin Market is not an index source', missingBody: 'It may have been removed in Discover. Add it back to see it here and in Discover.', addSource: 'Add index source',
      today: 'Today’s picks', recommended: 'Recommended', popular: 'Most popular', trending: 'Fastest growing',
      newest: 'Newly published', health: 'Manage plugins',
      todayHint: 'Daily, weighted by likes and recommendations', recommendedHint: 'Active plugins, with room for new listings', popularHint: 'By recent likes',
      rankings: 'Leaderboards', rankingsHint: 'The leaders by likes and stars', rankingsMore: 'Show top {count}', rankingsLess: 'Show fewer', starred: 'Most stars', starredHint: 'Total GitHub stars',
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
      incompatible: 'Incompatible', busy: 'Opening…', updating: 'Checking and updating…', actionFailed: 'Could not complete the plugin action',
      updateHint: 'Checks the target and restores the original version if replacement fails', updateRestart: 'This plugin is running; restart DSH, then update it',
      updateUnavailable: 'Update with recovery is unavailable. Update Open Market from Plugins first; the current plugin was kept.',
      unknownError: 'Unknown error', invalidPage: 'The market returned invalid pagination data', unknownVersion: 'Unknown version',
      noDescription: 'No description available',
      sectionEmpty: 'No matching plugins yet', previous: 'Browse {section} left', next: 'Browse {section} right',
      source: 'Data from Open Plugin Market', sourceLink: 'dshopen.org', newWindow: 'Opens in a new window',
      recommendationPosition: 'Show recommendation group {number}', settings: 'Settings', about: 'About',
      autoRotate: 'Auto-rotate today’s picks', showInstalled: 'Show installed plugins in recommendations and All plugins', showCheckup: 'Show the update count on Manage plugins', installing: 'Installing…', sidebarMarket: 'Show Open Market in the sidebar', theme: 'Whale Maid theme', themeHelp: 'Dresses DSH like dshopen.org: ink outlines, hard shadows, macaron colours and the whale maid in empty spaces. Covers the whole interface and goes away as soon as you switch it off.', themeAppearance: 'Theme appearance', appearanceAuto: 'Same as DSH', appearanceLight: 'Light', appearanceDark: 'Dark', sidebarMarketHelp: 'A full-width page. Installs from it skip the install dialog; a plugin whose install scripts need approval has to be installed from Plugins.', installNeedsDialog: 'This plugin needs its install scripts approved. Install it from Plugins.', installedRestart: 'Installed. Restart DSH to use it.',
      settingsDisplay: 'Display', settingsTheme: 'Theme', settingsData: 'Data and sync', settingsDownload: 'Downloads', settingsTools: 'Small tools',
      syncData: 'Market data', syncNow: 'Sync latest data', syncing: 'Syncing…', syncedAt: 'Last synced: {time}', neverSynced: 'Not synced yet',
      syncFailed: 'Sync failed; showing the data already here', syncUnavailable: 'Turn on Custom plugin markets to sync', syncHelp: 'The market opens with the data saved on this computer and updates in the background every six hours, so browsing is never held up.',
      registryLabel: 'Download from', registryIndex: 'Official npm registry', registryDsh: 'Same as DSH', registryNpmmirror: 'Mainland China mirror', registryCustom: 'Custom address',
      registryPlaceholder: 'https://npm.example.com/', registryInvalid: 'Enter an http:// or https:// address without a username or password',
      registryHelp: 'Installs and updates of npm plugins from Open Market ask this registry first. When it is unreachable or has no copy of the package yet, DSH usually asks another trusted one. Git plugins download straight from GitHub, and DSH’s own Discover tab is not affected.',
      registryCustomHelp: 'A custom address is asked alone, with no fallback. If it requires a login, keep the credentials in ~/.npmrc on this computer.',
      autoReview: 'Auto review for new conversations', autoReviewHelp: "New conversations start in DSH's experimental Auto review permission, so you don't switch it each time. The current model judges each tool call, so it can misjudge and uses some extra tokens; the first time may need a DSH restart.", autoReviewRestart: 'Saved; restart DSH for it to take effect', autoReviewFailed: 'Could not switch: {reason}',
      likesHelp: 'Likes, installs and the first launch send anonymous counts to dshopen.org for recommendation ranking, at most once per plugin per person per day.',
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
      .opm-heading-copy { display: flex; align-items: center; gap: 6px; min-width: 0; }
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
      .opm-like { gap: 4px; font-variant-numeric: tabular-nums; }
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
      /* Arrows sit in the gutter, so in a narrow window they stay clear of the card's text. */
      .opm-arrow-previous { left: calc(-1 * var(--opm-bleed)); }
      .opm-arrow-next { right: calc(-1 * var(--opm-bleed)); }
      .opm-section:hover .opm-arrow:not(:disabled), .opm-section:focus-within .opm-arrow:not(:disabled),
      .opm-carousel:hover .opm-arrow:not(:disabled), .opm-carousel:focus-within .opm-arrow:not(:disabled) { opacity: 1; pointer-events: auto; transform: translateY(-50%); }
      .opm-arrow:hover:not(:disabled) { border-color: var(--dsw-alias-border-l3); transform: translateY(-50%) scale(1.08) !important; }
      .opm-arrow:active:not(:disabled) { transform: translateY(-50%) scale(.96) !important; }
      .opm-rail, .opm-carousel-viewport { display: flex; align-items: stretch; gap: 10px; overflow-x: auto; overscroll-behavior-x: contain;
        scrollbar-width: none; padding: 24px var(--opm-bleed); margin: -24px calc(-1 * var(--opm-bleed)); scroll-padding-inline: var(--opm-bleed); }
      /* Today's picks snap card by card; each rests on the content edge, clear of the gutter fade. */
      .opm-carousel-viewport { scroll-snap-type: x proximity; }
      .opm-rail::-webkit-scrollbar, .opm-carousel-viewport::-webkit-scrollbar { display: none; }
      .opm-rail, .opm-carousel-viewport { user-select: none; -webkit-user-select: none; }
      .opm-rail img, .opm-carousel-viewport img { -webkit-user-drag: none; }
      :is(.opm-rail, .opm-carousel-viewport)[data-dragging="true"] { scroll-snap-type: none; scroll-behavior: auto; }
      :is(.opm-rail, .opm-carousel-viewport)[data-dragging="true"], :is(.opm-rail, .opm-carousel-viewport)[data-dragging="true"] * { cursor: grabbing !important; }
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
      /* Card tags keep a fixed number of 18px rows: a tag that does not fit wraps onto a hidden row whole, instead of
         being cut mid-pill or stretching the card. Rail cards take one row, today's picks two. */
      .opm-card .opm-tags { --opm-tag-rows: 1; flex-wrap: wrap; overflow: hidden; max-height: calc(var(--opm-tag-rows) * 18px + (var(--opm-tag-rows) - 1) * 4px); }
      .opm-card .opm-tag { white-space: nowrap; flex-shrink: 0; line-height: 16px; }
      .opm-carousel { min-width: 0; margin-top: 12px; }
      /* The row fades and blurs into whichever gutter still has cards beyond it; the fade stays inside the gutter. */
      @property --opm-fade-start { syntax: '<length>'; inherits: true; initial-value: 0px; }
      @property --opm-fade-end { syntax: '<length>'; inherits: true; initial-value: 0px; }
      .opm-list-fade { --opm-fade-start: 0px; --opm-fade-end: 0px; transition: --opm-fade-start 200ms ease-out, --opm-fade-end 200ms ease-out; }
      .opm-list-fade[data-fade-start] { --opm-fade-start: var(--opm-bleed); }
      .opm-list-fade[data-fade-end] { --opm-fade-end: var(--opm-bleed); }
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
      /* Leaderboards: ranked lists side by side, stacked when the page is narrow. */
      .opm-boards-section { margin-top: 20px; }
      .opm-boards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; align-items: start; }
      .opm-board { min-width: 0; padding: 12px 8px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md);
        background: var(--dsw-alias-bg-module-platform); }
      .opm-board-title { display: flex; align-items: center; gap: 6px; min-width: 0; margin: 0 6px 6px !important; }
      .opm-board-title small { min-width: 0; margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 11px; font-weight: 400;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .opm-board-list { list-style: none; margin: 0; padding: 0; }
      .opm-board-row { font: inherit; display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; padding: 5px 6px; border: 0;
        border-radius: var(--dsw-radius-sm); background: transparent; color: inherit; text-align: left; cursor: pointer;
        transition: background-color 150ms ease-out; }
      .opm-board-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .opm-board-row .opm-icon { width: 30px; height: 30px; font-size: 16px; border-radius: var(--dsw-radius-sm);
        background: color-mix(in srgb, hsl(var(--opm-hue, 220) 72% 58%) 14%, var(--dsw-alias-bg-layer-1)); }
      .opm-rank { flex: 0 0 20px; color: var(--dsw-alias-label-tertiary); font-size: 12px; font-weight: 600; text-align: center;
        font-variant-numeric: tabular-nums; }
      .opm-rank[data-rank="1"] { color: #e59a00; }
      .opm-rank[data-rank="2"] { color: #7a8699; }
      .opm-rank[data-rank="3"] { color: #c2703a; }
      .opm-board-copy { display: flex; flex: 1; flex-direction: column; min-width: 0; }
      .opm-board-copy strong, .opm-board-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .opm-board-copy strong { font-size: 13px; font-weight: 600; line-height: 18px; }
      .opm-board-copy small { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 15px; }
      .opm-board-value { flex-shrink: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
      /* Icons are drawn, not typed, so they look the same whatever fonts the system has. */
      .opm-svg { flex-shrink: 0; width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      :is(.opm-like:disabled, .opm-favorite-main[aria-pressed="true"]) > .opm-svg { fill: currentColor; }
      .opm-installed-button small { color: var(--dsw-alias-state-warn-primary); font-size: 11px; font-weight: 600; }
      .opm-footer a { color: var(--dsw-alias-label-secondary); text-underline-offset: 3px; }
      .opm-footer a:hover { color: var(--dsw-alias-label-primary); }
      .opm-skeleton { background: var(--dsw-alias-bg-skeleton); border-radius: var(--dsw-radius-sm); }
      .opm-skeleton-title { height: 22px; width: 160px; margin-bottom: 8px; }
      .opm-skeleton-search { height: 32px; max-width: 360px; border-radius: var(--dsw-radius-md); }
      .opm-skeleton-pick { height: 168px; }
      .opm-skeleton-board { height: 232px; }
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
        padding: 0; }
      /* Keep the mask filter off the dialog's ancestors, like DSH's native Modal. */
      .opm-overlay::before { content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none;
        background: var(--dsw-alias-bg-mask-1); backdrop-filter: var(--dsw-mask-blur, none); }
      .opm-panel { position: relative; width: min(560px, calc(100% - 32px)); max-height: calc(100vh - 64px); overflow-y: auto;
        padding: 24px; border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1));
        box-shadow: var(--dsw-elevation-prominent); overscroll-behavior: contain; scrollbar-color: var(--dsw-alias-border-l3) var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1)); }
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
      .opm-version-row > .opm-release { flex-basis: 100%; min-width: 0; margin: 0; border: 0; padding-top: 4px; }
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
      .opm-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; max-width: 820px; }
      .opm-icon-button { width: 32px; padding: 0; }
      .opm-icon-button svg { width: 16px; height: 16px; }
      .opm-toolbar .opm-search { flex: 1 1 220px; min-width: min(100%, 180px); }
      .opm-category-wrap { position: relative; display: inline-flex; max-width: 180px; min-width: 116px; }
      .opm-root select.opm-category { appearance: none; -webkit-appearance: none; width: 100%; height: 32px; padding: 0 30px 0 11px;
        border: 1px solid var(--dsw-alias-border-l2, #737780); border-radius: var(--dsw-radius-sm, 8px);
        background: var(--dsw-alias-button-elevated-fill, Canvas); color: var(--dsw-alias-label-primary, CanvasText);
        font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; text-overflow: ellipsis; }
      .opm-root select.opm-category:hover { background: var(--dsw-alias-interactive-bg-hover, ButtonFace); }
      .opm-category option { background: var(--dsw-alias-bg-layer-1, Canvas); color: var(--dsw-alias-label-primary, CanvasText); }
      .opm-category-wrap > svg { position: absolute; right: 10px; top: 10px; width: 12px; height: 12px;
        color: var(--dsw-alias-label-secondary, CanvasText); pointer-events: none; }
      .opm-screenshots { display: flex; gap: 10px; overflow-x: auto; padding: 4px 0 10px; scroll-snap-type: x proximity; }
      .opm-screenshots a { flex: 0 0 auto; max-width: 100%; scroll-snap-align: start; }
      .opm-screenshots img { display: block; max-width: 100%; width: auto; height: 190px; object-fit: contain;
        border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); }
      .opm-detail-section { margin: 16px 0; }
      .opm-detail-section > a, .opm-release > a { display: inline-block; margin-top: 6px; color: var(--dsw-alias-label-secondary); font-size: 13px; text-underline-offset: 3px; }
      .opm-detail-section > a:hover, .opm-release > a:hover { color: var(--dsw-alias-label-primary); }
      .opm-detail-section h3, .opm-release summary { font-size: 13px; font-weight: 600; margin: 0 0 8px; }
      .opm-release { border-top: 1px solid var(--dsw-alias-border-l2); padding-top: 12px; margin: 12px 0; }
      .opm-release summary { cursor: pointer; }
      .opm-release-text { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 320px; overflow-y: auto; line-height: 1.65; }
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
      /* Plugin management: one rhythm throughout. Rows are small market cards, every section title is 13px/600,
         filters are the same pills as favorites, and the plugin's actions share one row. */
      .opm-panel-management { width: min(1120px, calc(100vw - 32px)); height: min(860px, calc(100dvh - 48px));
        max-height: calc(100dvh - 48px); display: flex; flex-direction: column; gap: 12px; overflow: hidden; padding: 22px 24px 14px; }
      .opm-manage-head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; padding-right: 36px; }
      .opm-manage-head h2 { font-size: 18px; font-weight: 600; margin-right: 6px; }
      .opm-manage-pill { display: inline-flex; align-items: center; gap: 5px; min-height: 22px; padding: 0 9px;
        border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary);
        font-size: 12px; line-height: 1; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .opm-manage-pill-ok::before, .opm-manage-pill-busy::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #3aa66a; }
      .opm-manage-pill-busy::before { background: #e0a020; }
      .opm-manage-pill-warn { color: var(--dsw-alias-state-warn-primary, #a6620c); }
      .opm-manage-pill-risk { cursor: help; }
      .opm-manage-controls, .opm-manage-actions, .opm-manage-bulk { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
      .opm-manage-controls .opm-button { height: 32px; }
      .opm-manage-search { flex: 1 1 240px; min-width: 180px; height: 32px; padding: 0 12px; border: 1px solid var(--dsw-alias-border-l2);
        border-radius: var(--dsw-radius-md); background-color: var(--dsw-alias-bg-module-platform); color: inherit; font: inherit; font-size: 13px; outline: none;
        transition: border-color 150ms ease-out, box-shadow 150ms ease-out; }
      .opm-manage-controls .opm-manage-search { padding-left: 32px; background-repeat: no-repeat; background-position: 11px center; background-size: 15px;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%237a8699' stroke-width='2' stroke-linecap='round'%3E%3Ccircle cx='8.5' cy='8.5' r='5.5'/%3E%3Cpath d='m13 13 4 4'/%3E%3C/svg%3E"); }
      .opm-manage-search::placeholder { color: var(--dsw-alias-label-tertiary); }
      .opm-manage-search:focus { border-color: var(--dsw-alias-border-l3); box-shadow: 0 0 0 3px color-mix(in srgb, #4f7cff 22%, transparent); }
      .opm-manage-controls select { appearance: none; -webkit-appearance: none; max-width: 200px; height: 32px; padding: 0 30px 0 11px;
        border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-button-elevated-fill) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%237a8699' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m2 4.5 4 4 4-4'/%3E%3C/svg%3E") no-repeat right 10px center;
        font: inherit; font-size: 13px; font-weight: 500; cursor: pointer; text-overflow: ellipsis; }
      .opm-manage-controls select option { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
      .opm-manage-tabs { display: flex; flex-wrap: wrap; gap: 6px; }
      .opm-manage-tabs .opm-button { min-height: 26px; padding: 0 12px; border-radius: 999px; font-size: 12px;
        background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); }
      .opm-manage-tabs .opm-button:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }
      .opm-manage-tabs .opm-button[aria-pressed="true"] { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); box-shadow: none; }
      .opm-manage-status { margin-top: -4px !important; color: var(--dsw-alias-label-secondary); font-size: 12px; white-space: pre-wrap; }
      /* Every disclosure in the dialog uses the same title and chevron. */
      :is(.opm-manage-overview, .opm-plugin-diagnostics, .opm-components, .opm-manage-queue, .opm-system-group) > summary {
        display: flex; align-items: center; gap: 8px; min-height: 34px; cursor: pointer; list-style: none;
        color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 600; }
      :is(.opm-manage-overview, .opm-plugin-diagnostics, .opm-components, .opm-manage-queue, .opm-system-group) > summary::-webkit-details-marker { display: none; }
      :is(.opm-manage-overview, .opm-plugin-diagnostics, .opm-components, .opm-manage-queue, .opm-system-group) > summary::before {
        content: ''; flex: none; width: 6px; height: 6px; margin: 0 2px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor;
        opacity: .55; transform: rotate(-45deg); transition: transform 150ms ease-out; }
      :is(.opm-manage-overview, .opm-plugin-diagnostics, .opm-components, .opm-manage-queue, .opm-system-group)[open] > summary::before { transform: rotate(45deg); }
      .opm-manage-overview { margin-top: 12px; font-size: 12px; }
      .opm-manage-overview h4 { margin: 10px 2px 4px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
      .opm-manage-overview > p.opm-muted { padding: 0 2px; font-size: 12px; overflow-wrap: anywhere; }
      .opm-directory { display: grid; grid-template-columns: 112px minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 6px 0; font-size: 12px; }
      .opm-directory + .opm-directory { border-top: 1px solid var(--dsw-alias-border-l1); }
      .opm-directory > span { font-size: 12px; }
      .opm-directory code { overflow-wrap: anywhere; user-select: text; font-family: inherit; font-size: 12px; color: var(--dsw-alias-label-primary); }
      .opm-directory .opm-button { white-space: nowrap; }
      .opm-load-order { list-style: none; margin: 6px 0 8px; padding: 0; counter-reset: opm-order; display: flex; flex-direction: column; gap: 4px; }
      .opm-load-order li { counter-increment: opm-order; display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 4px 6px 4px 8px;
        border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-sm); background: var(--dsw-alias-bg-layer-1); font-size: 13px; }
      .opm-load-order li::before { content: counter(opm-order); min-width: 18px; color: var(--dsw-alias-label-tertiary); font-size: 11px; font-variant-numeric: tabular-nums; text-align: center; }
      .opm-load-order code { flex: 1; min-width: 0; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; font-size: 11px; }
      .opm-load-order .opm-button { width: 28px; padding: 0; }
      .opm-manage-body { display: grid; grid-template-columns: minmax(300px, .9fr) minmax(340px, 1.25fr); gap: 20px; min-height: 0; flex: 1; }
      .opm-manage-column { min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
      .opm-manage-bulk { padding: 6px 8px 6px 12px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-interactive-bg-hover); font-size: 12px; }
      .opm-manage-bulk > span { margin-right: auto; font-weight: 600; }
      .opm-manage-list { overflow: auto; overscroll-behavior: contain; list-style: none; margin: 0 -6px; padding: 2px 6px 8px; flex: 1; }
      .opm-manage-group > ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
      .opm-manage-group-title { display: flex; align-items: center; gap: 6px; margin: 0; padding: 4px 2px 8px; font-size: 12px; font-weight: 600;
        color: var(--dsw-alias-label-secondary); }
      .opm-manage-group-title > span { min-width: 20px; padding: 0 6px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover);
        font-weight: 500; font-size: 11px; line-height: 18px; text-align: center; font-variant-numeric: tabular-nums; }
      .opm-manage-select-all { margin-left: auto; padding: 2px 6px; border: 0; border-radius: var(--dsw-radius-sm); background: none;
        color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12px; font-weight: 500; cursor: pointer; }
      .opm-manage-select-all:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
      .opm-system-group { margin-top: 12px; }
      :is(.opm-system-group, .opm-manage-overview) > summary.opm-manage-group-title { min-height: 30px; padding: 0 2px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .opm-system-group[open] > summary { margin-bottom: 6px; }
      .opm-status { display: inline-flex; align-items: center; gap: 4px; padding: 0 7px; border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 999px; font-size: 11px; line-height: 16px; white-space: nowrap; font-weight: 500; }
      .opm-status-on { color: #22643f; background: #e8f5ee; border-color: #b7d8c4; }
      .opm-status-off { color: var(--dsw-alias-label-secondary); background: transparent; border-style: dashed; }
      body[data-ds-dark-theme] .opm-status-on { color: #8bd8ad; background: #223a2d; border-color: #3a614b; }
      .opm-manage-row { display: flex; align-items: center; gap: 8px; }
      .opm-manage-row > input { flex: none; width: 16px; height: 16px; margin: 0; accent-color: var(--dsw-alias-button-primary-fill); }
      /* A row is a compact market card: tinted icon, title, package and state pills. */
      .opm-manage-open { --opm-accent: hsl(var(--opm-hue, 220) 72% 58%); display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0;
        padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md);
        background: var(--dsw-alias-bg-module-platform); color: inherit; cursor: pointer; text-align: left; font: inherit;
        transition: border-color 150ms ease-out, box-shadow 150ms ease-out, background-color 150ms ease-out; }
      .opm-manage-open:hover { border-color: color-mix(in srgb, var(--opm-accent) 45%, var(--dsw-alias-border-l2)); }
      .opm-manage-open[aria-current="true"] { border-color: color-mix(in srgb, var(--opm-accent) 70%, var(--dsw-alias-border-l2)); box-shadow: var(--dsw-elevation-soft);
        background: linear-gradient(160deg, color-mix(in srgb, var(--opm-accent) 12%, transparent), transparent 60%), var(--dsw-alias-bg-module-platform); }
      :is(.opm-manage-open, .opm-manage-detail-head) .opm-icon { flex: none; background: color-mix(in srgb, var(--opm-accent) 14%, var(--dsw-alias-bg-layer-1));
        color: color-mix(in srgb, var(--opm-accent) 70%, var(--dsw-alias-label-primary)); }
      .opm-manage-open .opm-icon { width: 36px; height: 36px; font-size: 18px; }
      .opm-manage-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 1px; }
      .opm-manage-copy strong { font-size: 14px; font-weight: 600; }
      .opm-manage-copy strong, .opm-manage-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .opm-manage-copy small { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
      .opm-manage-badges { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
      .opm-manage-badges .opm-tag { border-radius: 999px; padding: 0 7px; }
      .opm-manage-detail { min-width: 0; overflow: auto; padding: 2px 6px 12px 2px; overscroll-behavior: contain; font-size: 13px; }
      .opm-manage-detail-head { --opm-accent: hsl(var(--opm-hue, 220) 72% 58%); display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
      .opm-manage-detail-head > .opm-status { margin-left: auto; align-self: flex-start; margin-top: 4px; }
      .opm-manage-detail-title { min-width: 0; flex: 1; }
      .opm-manage-source { margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-tertiary);
        font-size: 11px; user-select: text; }
      .opm-manage-detail h3 { font-size: 18px; font-weight: 600; line-height: 1.35; margin: 0 0 2px; overflow-wrap: anywhere; }
      .opm-manage-detail-title .opm-muted { font-size: 12px; overflow-wrap: anywhere; }
      .opm-manage-detail h4 { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; font-size: 13px; font-weight: 600; margin: 0 0 8px; }
      .opm-manage-update { margin-top: 14px; padding: 12px 14px; border-radius: var(--dsw-radius-md);
        background: color-mix(in srgb, #2f6bff 9%, var(--dsw-alias-bg-layer-1)); }
      .opm-manage-update .opm-version { font-weight: 500; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; }
      .opm-manage-more { margin-top: 16px; border-top: 1px solid var(--dsw-alias-border-l2); }
      .opm-manage-more > details { border-bottom: 1px solid var(--dsw-alias-border-l1); }
      .opm-manage-more > details > summary { min-height: 38px; }
      .opm-manage-more > details[open] { padding-bottom: 12px; }
      .opm-manage-readme > summary { display: flex; align-items: center; gap: 8px; min-height: 38px; cursor: pointer; list-style: none; font-size: 13px; font-weight: 600; }
      .opm-manage-readme > summary::-webkit-details-marker { display: none; }
      .opm-manage-readme > summary::before { content: ''; flex: none; width: 6px; height: 6px; margin: 0 2px; border-right: 1.5px solid currentColor;
        border-bottom: 1.5px solid currentColor; opacity: .55; transform: rotate(-45deg); transition: transform 150ms ease-out; }
      .opm-manage-readme[open] > summary::before { transform: rotate(45deg); }
      .opm-manage-count { min-width: 20px; padding: 0 6px; border-radius: 999px; background: var(--dsw-alias-interactive-bg-hover);
        font-weight: 500; font-size: 11px; line-height: 18px; text-align: center; color: var(--dsw-alias-label-secondary); }
      .opm-manage-detail p { overflow-wrap: anywhere; }
      .opm-manage-detail dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 7px 14px; margin: 14px 0; padding: 10px 12px;
        font-size: 12px; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-module-platform); }
      .opm-manage-detail dt { color: var(--dsw-alias-label-secondary); }
      .opm-manage-detail dd { margin: 0; overflow-wrap: anywhere; user-select: text; }
      .opm-manage-native { margin-left: auto; }
      .opm-manage-danger { color: var(--dsw-alias-state-danger-primary, #b54242); }
      .opm-manage-detail > :is(.opm-note, .opm-error, .opm-muted) { margin-top: 10px !important; font-size: 12px; }
      .opm-manage-detail > section:not(.opm-manage-update) { margin-top: 16px; }
      .opm-manage-detail section .opm-manage-actions, .opm-manage-detail section .opm-tags { margin-top: 10px; }
      .opm-plugin-diagnostics h4 { margin: 16px 0 6px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .opm-plugin-diagnostics ul:not(.opm-dependencies) { margin: 0; padding-left: 18px; font-size: 12px; }
      .opm-manage-remove { padding: 12px 14px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-danger-primary, #b54242) 45%, var(--dsw-alias-border-l2));
        border-radius: var(--dsw-radius-md); margin-top: 12px; }
      .opm-manage-remove label { display: flex; flex-direction: column; gap: 8px; margin: 10px 0; font-size: 12px; }
      .opm-manage-document { margin: 10px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .opm-manage-detail .opm-favorite-list li { padding: 6px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
      .opm-dependencies { list-style: none; margin: 0; padding: 0; max-height: 300px; overflow: auto; }
      .opm-dependencies li { display: flex; flex-direction: column; gap: 2px; padding: 7px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); font-size: 12px; overflow-wrap: anywhere; }
      .opm-manage-footer { flex-shrink: 0; display: flex; align-items: flex-start; gap: 12px; margin: 0 -24px -14px; padding: 2px 24px 6px;
        border-top: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-module-platform); }
      .opm-manage-queue { flex: 1; min-width: 0; max-height: 180px; overflow: auto; }
      .opm-manage-report { flex: none; margin-top: 7px; padding: 2px 6px; border: 0; border-radius: var(--dsw-radius-sm); background: none;
        color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12px; cursor: pointer; }
      .opm-manage-report:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
      .opm-manage-queue ul { list-style: none; padding: 0; margin: 4px 0 8px; }
      .opm-manage-job { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 7px 0; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 13px; }
      .opm-manage-job > span:first-child { flex: 1; min-width: 160px; overflow-wrap: anywhere; }
      .opm-manage-job p { width: 100%; }
      @media (max-width: 760px) {
        .opm-panel-management { width: calc(100vw - 16px); padding: 16px; height: auto; max-height: calc(100dvh - 24px); display: block; overflow-y: auto; }
        .opm-panel-management > * + * { margin-top: 12px; }
        .opm-manage-body { grid-template-columns: 1fr; grid-template-rows: minmax(180px, 35dvh) auto; gap: 12px; }
        .opm-manage-detail { border-top: 1px solid var(--dsw-alias-border-l2); padding-top: 12px; overflow: visible; }
        .opm-manage-footer { margin: 12px -16px -16px; padding-inline: 16px; }
        .opm-manage-queue { max-height: 130px; }
        .opm-directory { grid-template-columns: minmax(0, 1fr) auto; }
        .opm-directory > span { grid-column: 1 / -1; }
      }
      @media (max-height: 600px) and (min-width: 761px) {
        .opm-panel-management { overflow-y: auto; }
        .opm-manage-body { flex: none; height: 320px; }
      }
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
        border-radius: 6px; color: var(--opm-glyph); background: color-mix(in srgb, var(--opm-glyph) 16%, transparent); }
      .opm-glyph .opm-svg { width: 13px; height: 13px; }
      .opm-glyph-today { --opm-glyph: #e59a00; }
      .opm-glyph-recommended { --opm-glyph: #4f7cff; }
      .opm-glyph-popular { --opm-glyph: #f0507a; }
      .opm-glyph-rankings, .opm-glyph-starred { --opm-glyph: #e59a00; }
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
      .opm-card-footer .opm-tags { --opm-tag-rows: 2; flex: 1; align-self: center; }
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
      return resolve(entry.title ?? '') || entry.name;
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

    // Icon paths on a 24px grid, kept two units inside it so a 2px stroke is never cut at the edge.
    const ICON_PATHS = {
      today: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.5v2M12 19.5v2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M2.5 12h2M19.5 12h2M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4',
      popular: 'M12 20s-7-4.3-8.6-8.8C2.3 7.9 4.3 4.8 7.6 4.8c1.9 0 3.4 1 4.4 2.5 1-1.5 2.5-2.5 4.4-2.5 3.3 0 5.3 3.1 4.2 6.4C19 15.7 12 20 12 20z',
      starred: 'm12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.5 9.7l5.9-.9z',
      trending: 'M3 17l6-6 4 4 8-8M15 7h6v6',
      recommended: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
      newest: 'M12 5v14M5 12h14',
      rankings: 'M4 20v-6h5v6M9.5 20V7h5v13M15 20v-9h5v9M3 20h18',
      all: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'
    };
    function Glyph({ name }) {
      return h('svg', { className: 'opm-svg', viewBox: '0 0 24 24', 'aria-hidden': true, focusable: 'false' }, h('path', { d: ICON_PATHS[name] || ICON_PATHS.all }));
    }

    function descriptionOf(entry, resolve, t) {
      const text = resolve(entry.description ?? '') || '';
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

    // A number in [0, 1) fixed for one key on one local day: positions drawn with it change daily, not on every visit.
    function dailyRandom(key, day = localDay()) {
      let hash = 2166136261;
      for (const char of day + ':' + key) hash = Math.imul(hash ^ char.codePointAt(0), 16777619) >>> 0;
      hash = Math.imul(hash ^ (hash >>> 15), 2246822507) >>> 0;
      return ((hash ^ (hash >>> 13)) >>> 0) / 4294967296;
    }

    function localDay() {
      const date = new Date();
      return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    }

    function featuredPool(entries, likes, day) {
      const ranked = [...entries].sort(recommendedOrder);
      const scores = new Map(ranked.map((entry, rank) => [entry.name,
        (Number(likes[entry.name]) || 0) * 10 + (ranked.length <= 1 ? 100 : 100 * (1 - rank / (ranked.length - 1)))]));
      const pool = ranked.filter(entry => entry.installation.status === 'not-installed' && !isPluginMarket(entry))
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

    // Plugins whose main purpose is to browse, install or manage other DSH plugins, this one included. Inside a market
    // the recommendation places go to plugins that add a function: these are left out of today's picks and follow the
    // rest in the recommended order. Search, the leaderboards and every other order treat them like any plugin.
    const PLUGIN_MARKETS = new Set(['dsh-open-market', 'dshmarket', 'dsh-plugin', '@linxin666/dsh-client-ui-market',
      '@noob-stupid/dsh-plugin-console', '@stolyarovmn/dsh-ui-registry-aggregator', '@vibedev-si/dsh-ecosystem']);
    const isPluginMarket = entry => PLUGIN_MARKETS.has(entry.name);

    const marketsLast = (a, b) => Number(isPluginMarket(a)) - Number(isPluginMarket(b)) || recommendedOrder(a, b);

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
        }, resolve(metadata?.labels?.[id]?.title ?? '') || id)));
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
          // The Host owns replacement and restoration even if the Client closes.
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
      }, h(Glyph, { name: 'popular' }), count > 0 ? String(count) : null);
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
          } }, h(Glyph, { name: 'starred' })),
        groups.length > 1 && h('button', { type: 'button', className: 'opm-button opm-button-small opm-favorite-more', 'aria-haspopup': 'menu',
          'aria-expanded': !!menu, title: t('chooseGroup'), 'aria-label': t('chooseGroup') + ' · ' + title, onClick: openMenu }, '▾'),
        list && (createPortal ? createPortal(list, document.body) : list));
    }

    // A modal panel: Escape closes it, Tab stays inside, and the page behind does not scroll.
    function Dialog({ labelledBy, closeLabel, onClose, restoreFocus, wide, panelClass = '', children }) {
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
            const controls = [...node.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled):not(.opm-file), select:not(:disabled), [tabindex="0"]')]
              .filter(control => control.getClientRects().length > 0);
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
          restoreFocus?.();
        };
      }, [onClose, restoreFocus]);
      const overlay = h('div', { className: 'opm-root opm-overlay', onClick: event => { if (event.target === event.currentTarget) onClose(); } },
        h('section', { className: 'opm-panel' + (wide ? ' opm-panel-wide' : '') + (panelClass ? ' ' + panelClass : ''), role: 'dialog', 'aria-modal': true, 'aria-labelledby': labelledBy, tabIndex: -1, ref: panel },
          h('button', { type: 'button', className: 'opm-button opm-button-small opm-panel-close', onClick: onClose, 'aria-label': closeLabel }, '×'),
          children));
      // Page-scoped theme tokens can make every layer transparent; dialogs inherit the body popup tokens instead.
      return createPortal ? createPortal(overlay, document.body) : overlay;
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
      async function choose(version, when = 'now') {
        if (busy.version || disabled) return;
        setBusy({ version: version.version, phase: busyLabel });
        onBusyChange?.(true);
        setActionError(null);
        onError('');
        try {
          const answer = await installVersion(entry, version, { install, manager, t, title: titleOf(entry, resolve), busyLabel, when,
            onPhase: phase => setBusy({ version: version.version, phase }) });
          if (answer?.selfUpdate) return;
          if (answer?.ok === false) setActionError({ version: version.version, text: errorText(answer.error, t('unknownError')) });
          else if (answer?.queued) onNotice?.(t('manageQueued'));
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
                  'aria-label': t('versionAction').replace('{action}', action).replace('{version}', version.version), onClick: () => choose(version) }, action),
                switching && !provided && !current && !blocked && h('button', {type: 'button', className: 'opm-button opm-button-small', disabled: !!busy.version || disabled,
                  'aria-label': t('versionAction').replace('{action}', t('manageIdle')).replace('{version}', version.version), onClick: () => choose(version, 'idle')}, t('manageIdle'))),
              actionError?.version === version.version && h('p', { className: 'opm-error opm-version-error', role: 'alert' }, actionError.text),
              h(ReleaseNotes, {entry, version, t}));
          })),
          registry && currentState.status === 'ready' && choices.length === entry.versions.length && h('p', { className: 'opm-versions-note' }, t('noOtherVersions')),
          choices.length > limit && h('button', { type: 'button', className: 'opm-button opm-button-small opm-more', onClick: () => setLimit(value => value + 20) }, t('moreVersions'))));
    }

    function Screenshots({entry, t}) {
      const [state, setState] = React.useState({status: 'loading'});
      const [attempt, setAttempt] = React.useState(0);
      const [broken, setBroken] = React.useState(() => new Set());
      const source = defaultVersionOf(entry)?.source ?? entry.versions?.[0]?.source;
      React.useEffect(() => {
        let live = true;
        setState({status: 'loading'});
        setBroken(new Set());
        loadScreenshots(entry).then(images => { if (live) setState({status: 'ready', images}); }, error => { if (live) setState({status: 'error', error}); });
        return () => { live = false; };
      }, [entry.name, source?.commit, attempt]);
      const images = state.images?.filter(image => !broken.has(image.url)) || [];
      const rejectImage = url => setBroken(previous => new Set([...previous, url]));
      const project = githubRepository(entry);
      return h('section', {className: 'opm-detail-section', 'aria-label': t('screenshots')}, h('h3', null, t('screenshots')),
        state.status === 'loading' ? h('p', {className: 'opm-muted', role: 'status'}, t('detailLoading'))
          : state.status === 'error' ? h('div', null, h('p', {className: 'opm-muted'}, t([403, 429].includes(state.error?.status) ? 'detailRateLimited' : 'detailFailed')),
            h('button', {type: 'button', className: 'opm-button opm-button-small', onClick: () => setAttempt(value => value + 1)}, t('retry')))
            : images.length ? h('div', null, h('p', {className: 'opm-muted'}, t(images[0].origin === 'author' ? 'screenshotsAuthor' : 'screenshotsReadme')),
              h('div', {className: 'opm-screenshots'}, images.map((image, index) =>
              h('a', {key: image.url, href: image.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': (image.alt || t('screenshots') + ' ' + (index + 1)) + ' · ' + t('newWindow')},
                h('img', {src: image.url, alt: image.alt || t('screenshots') + ' ' + (index + 1), loading: 'lazy', referrerPolicy: 'no-referrer',
                  onError: () => rejectImage(image.url), onLoad: event => {
                    const node = event.currentTarget;
                    if (image.origin !== 'author' && (node.naturalWidth < 180 || node.naturalHeight < 100 || node.naturalWidth / node.naturalHeight > 5)) rejectImage(image.url);
                  }})))))
              : h('p', {className: 'opm-muted'}, t(broken.size ? 'screenshotsUnavailable' : 'screenshotsEmpty')),
        project && h('a', {href: 'https://github.com/' + project, target: '_blank', rel: 'noopener noreferrer'}, t('releaseSource')));
    }
    function ReleaseNotes({entry, version, t}) {
      const [open, setOpen] = React.useState(false), [attempt, setAttempt] = React.useState(0);
      const [state, setState] = React.useState({status: 'loading'});
      React.useEffect(() => {
        if (!open) return;
        let live = true;
        setState({status: 'loading'});
        loadReleaseNotes(entry, version).then(notes => { if (live) setState({status: 'ready', notes}); }, error => { if (live) setState({status: 'error', error}); });
        return () => { live = false; };
      }, [open, entry.name, version.version, version.source?.commit, attempt]);
      if (!githubRepository(entry)) return null;
      return h('details', {className: 'opm-release', open, onToggle: event => setOpen(event.currentTarget.open)},
        h('summary', null, t('releaseNotes') + ' · ' + version.version),
        open && (state.status === 'loading' ? h('p', {className: 'opm-muted', role: 'status'}, t('detailLoading'))
          : state.status === 'error' ? h('div', null, h('p', {className: 'opm-muted'}, t([403, 429].includes(state.error?.status) ? 'detailRateLimited' : 'detailFailed')),
            h('button', {type: 'button', className: 'opm-button opm-button-small', onClick: () => setAttempt(value => value + 1)}, t('retry')))
            : state.notes ? h('div', null, h('div', {className: 'opm-release-text'}, state.notes.body.replace(/^#{1,6}\s+/gm, '').replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')),
              h('a', {href: state.notes.url, target: '_blank', rel: 'noopener noreferrer'}, t('releaseSource')))
              : h('p', {className: 'opm-muted'}, t('releaseEmpty'))),
        open && !state.notes && h('a', {href: 'https://github.com/' + githubRepository(entry) + '/releases', target: '_blank', rel: 'noopener noreferrer'}, t('releaseSource')));
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
          h('div', { className: 'opm-panel-heading', style: { '--opm-hue': hueOf(entry.name) } }, h(PluginIcon, { entry, title, large: true }),
            h('div', { className: 'opm-card-copy' }, h('h2', { id: headingId }, title),
              entry.author && h('p', { className: 'opm-author' }, entry.author),
              h('p', { className: 'opm-version' }, [version, published].filter(Boolean).join(' · ')))),
          h(Tags, { entry, metadata, resolve, t }),
          h('p', { className: 'opm-description opm-panel-description' }, descriptionOf(entry, resolve, t)),
          h(Screenshots, {key: entry.name, entry, t}),
          latest && h(ReleaseNotes, {key: entry.name + ':' + version, entry, version: defaultVersionOf(entry) || latest, t}),
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
        h('div', { className: 'opm-heading-copy' }, h('span', { className: 'opm-glyph opm-glyph-' + section, 'aria-hidden': true }, h(Glyph, { name: section })), h('h2', null, t(section)),
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
      return current => current.start === next.start && current.end === next.end ? current : next;
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

    function attachHorizontalDrag(root) {
      let gesture, suppress;
      function down(event) {
        if (event.pointerType !== 'mouse' || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
        const rail = event.target.closest('.opm-rail, .opm-carousel-viewport');
        if (!rail || !root.contains(rail) || rail.scrollWidth <= rail.clientWidth + 1) return;
        gesture = {rail, id: event.pointerId, x: event.clientX, y: event.clientY, left: rail.scrollLeft, dragging: false};
      }
      function move(event) {
        if (!gesture || event.pointerId !== gesture.id) return;
        const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
        if (!gesture.dragging) {
          if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) {gesture = undefined; return;}
          if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
          gesture.dragging = true;
          gesture.rail.dataset.dragging = 'true';
          gesture.rail.setPointerCapture?.(event.pointerId);
        }
        event.preventDefault();
        gesture.rail.scrollLeft = gesture.left - dx;
      }
      function finish(event) {
        if (!gesture || event.pointerId !== gesture.id) return;
        if (gesture.dragging) {
          suppress = {rail: gesture.rail, until: event.timeStamp + 100};
          delete gesture.rail.dataset.dragging;
          if (gesture.rail.hasPointerCapture?.(event.pointerId)) gesture.rail.releasePointerCapture(event.pointerId);
        }
        gesture = undefined;
      }
      function click(event) {
        if (!suppress || event.detail === 0) return;
        if (event.timeStamp <= suppress.until && suppress.rail.contains(event.target)) {
          event.preventDefault(); event.stopImmediatePropagation();
        }
        suppress = undefined;
      }
      function nativeDrag(event) { if (event.target.closest('.opm-rail, .opm-carousel-viewport')) event.preventDefault(); }
      const doc = root.ownerDocument;
      root.addEventListener('pointerdown', down, true);
      root.addEventListener('click', click, true);
      root.addEventListener('dragstart', nativeDrag);
      doc.addEventListener('pointermove', move, {capture: true, passive: false});
      doc.addEventListener('pointerup', finish, true);
      doc.addEventListener('pointercancel', finish, true);
      return () => {
        if (gesture) delete gesture.rail.dataset.dragging;
        root.removeEventListener('pointerdown', down, true); root.removeEventListener('click', click, true);
        root.removeEventListener('dragstart', nativeDrag); doc.removeEventListener('pointermove', move, true);
        doc.removeEventListener('pointerup', finish, true); doc.removeEventListener('pointercancel', finish, true);
      };
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
      const [edges, setEdges] = React.useState({ start: true, end: true });
      const [hovered, setHovered] = React.useState(false);
      const [focused, setFocused] = React.useState(false);
      const reduced = useReducedMotion();
      const count = Math.min(visible, entries.length || 1);
      const last = Math.max(0, entries.length - count);
      const position = Math.min(index, last);
      function measureScroll() {
        const node = viewport.current;
        if (!node) return;
        const width = node.firstElementChild?.getBoundingClientRect().width;
        if (width) setIndex(Math.max(0, Math.min(last, Math.round(node.scrollLeft / (width + 10)))));
        setEdges(sameEdges(edgesOf(node)));
      }
      function goTo(number, behavior = reduced ? 'auto' : 'smooth') {
        const node = viewport.current;
        const slide = node?.firstElementChild;
        if (slide) node.scrollTo({ left: number * (slide.getBoundingClientRect().width + 10), behavior });
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
      // The picks open on a slide drawn per day, so each day leads with a different plugin. A new line-up draws again;
      // a resize that changes how many fit keeps the current slide.
      const lineup = entries.map(entry => entry.name).join('\n');
      const shownLineup = React.useRef(null);
      React.useEffect(() => {
        const start = shownLineup.current === lineup ? position : Math.floor(dailyRandom('today:' + lineup) * (last + 1));
        shownLineup.current = lineup;
        goTo(start, 'auto'); setIndex(start); measureScroll();
      }, [lineup, count]);
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
          h(FloatingArrows, { title, t: props.t, start: edges.start, end: edges.end,
            move: direction => goTo(Math.max(0, Math.min(last, position + direction))) })));
    }

    // Rails open part-way along so the rows under today's picks never line up: a whole number of cards, drawn per day,
    // plus a fraction from a band of each rail's own, so two rails can never share the same stagger. The offsets hold for
    // the whole local day and change the next. A rail too short to scroll that far stops at its end.
    const RAIL_BANDS = { recommended: [0.2, 0.4], trending: [0.45, 0.6], newest: [0.65, 0.8] };
    function railOffset(section, cards, visible, day = localDay()) {
      const room = cards - visible;
      if (room <= 0) return 0;
      const [low, high] = RAIL_BANDS[section] ?? [0.3, 0.7];
      const offset = Math.floor(dailyRandom(section + ':cards', day) * 3) + low + dailyRandom(section + ':fraction', day) * (high - low);
      return Math.min(room, offset);
    }

    function PluginRail({ section, entries, ...props }) {
      const rail = React.useRef(null);
      const placed = React.useRef(false);
      const [edges, setEdges] = React.useState({ start: true, end: true });
      const reduced = useReducedMotion();
      React.useLayoutEffect(() => {
        const node = rail.current;
        const card = node?.firstElementChild;
        if (placed.current || !card) return;
        placed.current = true;
        const step = card.getBoundingClientRect().width + 10;
        const padding = parseFloat(window.getComputedStyle(node).paddingLeft) * 2;
        const visible = Math.max(1, Math.floor((node.clientWidth - padding + 10) / step));
        node.scrollLeft = railOffset(section, entries.length, visible) * step;
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
        // Whole pages from the nearest card, so a press after a free scroll still leaves a clean edge.
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

    // Leaderboards: most liked and most starred, each a ranked list read top to bottom, five rows at first and twenty on request.
    const BOARD_ROWS = 5;
    const BOARD_LIMIT = 20;
    const BOARD_HINTS = { popular: 'popularHint', starred: 'starredHint' };
    const compactNumber = (value, locale) => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
    // What each board shows beside a plugin: its likes or its stars.
    function boardValue(id, entry, { counts, t }) {
      return compactNumber(id === 'popular' ? likeCount(counts, entry.name) : entry.metadata?.sortKeys?.['github-stars'], t('dateLocale'));
    }

    function Leaderboards({ boards, t, resolve, metadata, counts, onOpen }) {
      const [expanded, setExpanded] = React.useState(false);
      if (!boards.length) return null;
      const longest = Math.max(...boards.map(([, entries]) => entries.length));
      const rows = expanded ? BOARD_LIMIT : BOARD_ROWS;
      return h('section', { className: 'opm-section opm-boards-section', 'aria-label': t('rankings') },
        h(SectionHeading, { section: 'rankings', t },
          longest > BOARD_ROWS && h('button', { type: 'button', className: 'opm-button opm-button-small', 'aria-expanded': expanded,
            onClick: () => setExpanded(value => !value) }, expanded ? t('rankingsLess') : t('rankingsMore').replace('{count}', Math.min(longest, BOARD_LIMIT)))),
        h('div', { className: 'opm-boards' }, boards.map(([id, entries]) =>
          h('div', { key: id, className: 'opm-board opm-board-' + id },
            h('h3', { className: 'opm-board-title' }, h('span', { className: 'opm-glyph opm-glyph-' + id, 'aria-hidden': true }, h(Glyph, { name: id })),
              t(id), h('small', { title: t(BOARD_HINTS[id]) }, t(BOARD_HINTS[id]))),
            h('ol', { className: 'opm-board-list' }, entries.slice(0, rows).map((entry, at) => {
              const title = titleOf(entry, resolve);
              const value = boardValue(id, entry, { counts, metadata, resolve, t });
              return h('li', { key: entry.name },
                h('button', { type: 'button', className: 'opm-board-row', 'aria-haspopup': 'dialog', 'data-plugin-name': entry.name,
                  style: { '--opm-hue': hueOf(entry.name) }, 'aria-label': (at + 1) + ' · ' + title + (value ? ' · ' + value : ''),
                  onClick: event => onOpen(entry, event.currentTarget) },
                  h('span', { className: 'opm-rank', 'data-rank': at + 1, 'aria-hidden': true }, at + 1),
                  h(PluginIcon, { entry, title }),
                  h('span', { className: 'opm-board-copy' }, h('strong', { title }, title), entry.author ? h('small', null, entry.author) : null),
                  value ? h('span', { className: 'opm-board-value' }, value) : null));
            }))))));
    }

    async function openNativePackage(name, {get, select, wait = () => new Promise(resolve => window.setTimeout(resolve, 50))}) {
      let navigation = get();
      if (typeof navigation?.openBundle !== 'function') {
        select();
        // Opening Plugins can mount the native navigation service on the next render.
        for (let attempt = 0; attempt < 20; attempt++) {
          navigation = get();
          if (typeof navigation?.openBundle === 'function') break;
          await wait();
        }
      }
      if (typeof navigation?.openBundle !== 'function') return {ok: false};
      await navigation.openBundle(name);
      return {ok: true};
    }

    function ManagementLauncher(props) {
      const [open, setOpen] = React.useState(false);
      const button = React.useRef(null);
      const state = useMarket();
      return h(React.Fragment, null,
        h('button', {type: 'button', className: 'opm-button', ref: button, 'aria-haspopup': 'dialog', onClick: () => setOpen(true)}, props.t('health')),
        open && h(InstalledPanel, {...props, metadata: state.metadata, entries: state.entries || [], onClose: () => setOpen(false), restoreFocus: () => button.current?.focus()}));
    }

    function managementMessage(answer, t) {
      const key = {
        'tasks-active': 'manageBusy', 'task-monitor-unavailable': 'manageMonitor', 'management-busy': 'manageUpdating',
        'management-unavailable': 'manageUnavailable', 'host-restarted': 'manageRestarted', 'self-management': 'manageSelf',
        'read-only': 'manageReadonly', 'restore-unavailable': 'restoreUnavailable', 'update-busy': 'manageUpdating',
        'installation-changed': 'manageChanged', 'package-missing': 'manageMissing', 'queue-full': 'manageQueueFull',
        'directory-unavailable': 'manageDirectoryUnavailable', 'diagnostics-unavailable': 'manageDiagnosticUnavailable',
        'load-order-failed': 'manageOrderFailed', 'invalid-load-order': 'manageChanged',
      }[answer?.code];
      if (answer?.code === 'dependency-order') return t('manageDependencyOrder').replaceAll('{name}', answer.error).replaceAll('{dependency}', answer.dependency ?? '?');
      if (answer?.code === 'load-order-failed') return t('manageOrderFailed') + (answer.error ? ' ' + errorText(answer.error, '') : '');
      if (answer?.restored !== undefined) return updateOutcome(answer, t).error;
      return key ? t(key) : errorText(answer?.error || answer?.code, t('unknownError'));
    }

    async function requestManagement(request, {fetchImpl = fetch, signal} = {}) {
      const response = await fetchImpl('/dsh-open-market/manage', request === undefined ? {credentials: 'same-origin', signal}
        : {method: 'POST', credentials: 'same-origin', headers: {'content-type': 'application/json'}, body: JSON.stringify(request), signal});
      if (!response.ok) return {ok: false, code: 'management-unavailable'};
      const result = await response.json();
      return typeof result?.ok === 'boolean' ? result : {ok: false, code: 'management-unavailable'};
    }

    function catalogUpdate(bundle, entry) {
      const version = entry && defaultVersionOf(entry);
      if (!bundle.installed || !bundle.version || !version || !olderVersion(bundle.version, version.version)) return null;
      const spec = version.install.spec;
      if (spec.startsWith(bundle.name + '@') && bundle.source?.startsWith(bundle.name + '@')
        && /^[a-zA-Z0-9~^<>=*| ._+-]+$/.test(bundle.source.slice(bundle.name.length + 1))) return version.install;
      const gitIdentity = value => /^(git\+https:\/\/github\.com\/[^#]+)#([a-f0-9]{40})(&path:\/[^?#&]+)?$/.exec(value || '');
      const before = gitIdentity(bundle.source), after = gitIdentity(spec);
      return before && after && before[1].replace(/\.git$/, '') === after[1].replace(/\.git$/, '') && before[3] === after[3] ? version.install : null;
    }

    function managementComponentState(row, bundle, t) {
      if (row.live?.diagnostic) return row.live.diagnostic;
      if (row.live?.enabled === false || !bundle.enabled) return t('disabled');
      const phase = {active: 'manageActive', loading: 'manageLoading', pending: 'managePending', failed: 'manageFailed', unloading: 'manageUnloading'}[row.live?.fiberPhase];
      return phase ? t(phase) : t(row.live?.enabled ? 'enabled' : 'manageRowUnknown');
    }

    function ManagedStatus({bundle, t}) {
      return h('span', {className: 'opm-status ' + (bundle.enabled ? 'opm-status-on' : 'opm-status-off')},
        h('span', {'aria-hidden': true}, bundle.enabled ? '●' : '○'), t(bundle.enabled ? 'enabled' : 'disabled'));
    }

    function DirectoryLine({label, value, t, action, busy}) {
      if (!value) return null;
      return h('div', {className: 'opm-directory'}, h('span', {className: 'opm-muted'}, label),
        h('code', null, value.path), h('button', {type: 'button', className: 'opm-button opm-button-small', disabled: busy,
          title: value.archived ? t('manageArchived') : value.path,
          onClick: () => action({action: 'open-directory', location: value.id})}, t('manageOpenDirectory')));
    }

    function RuntimeOverview({diagnostics, t, action, safe, busy, rows}) {
      const [draft, setDraft] = React.useState([]);
      React.useEffect(() => {setDraft(diagnostics?.customOrder ?? []);}, [diagnostics?.revision]);
      if (!diagnostics?.available) return h('p', {className: 'opm-muted'}, t('manageDiagnosticUnavailable'));
      const {environment} = diagnostics;
      const changed = draft.join('\n') !== diagnostics.customOrder.join('\n');
      const move = (index, delta) => setDraft(current => {const next = [...current]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; return next;});
      const order = h('ol', {className: 'opm-load-order'}, draft.map((name, index) => {
        const title = rows.find(row => row.bundle.name === name)?.title ?? name;
        return h('li', {key: name}, h('span', null, title), h('code', null, name),
          h('button', {type: 'button', className: 'opm-button opm-button-small', disabled: busy || index === 0,
            'aria-label': t('manageOrderUp').replace('{name}', title), onClick: () => move(index, -1)}, '↑'),
          h('button', {type: 'button', className: 'opm-button opm-button-small', disabled: busy || index === draft.length - 1,
            'aria-label': t('manageOrderDown').replace('{name}', title), onClick: () => move(index, 1)}, '↓'));
      }));
      return h('details', {className: 'opm-manage-group opm-manage-overview'},
        h('summary', {className: 'opm-manage-group-title'}, t('manageOverview')),
        h('h4', null, t('manageOrder')), h('p', {className: 'opm-muted'}, t('manageOrderHelp')),
        draft.length ? order : h('p', {className: 'opm-muted'}, t('manageOrderEmpty')),
        changed && h('div', {className: 'opm-manage-actions'},
          h('button', {type: 'button', className: 'opm-button opm-button-primary', disabled: busy || !safe,
            onClick: () => action({action: 'reorder', order: draft, revision: diagnostics.revision})}, t('manageOrderSaved')),
          h('button', {type: 'button', className: 'opm-button', disabled: busy, onClick: () => setDraft(diagnostics.customOrder)}, t('manageOrderReset'))),
        h('h4', null, 'DSH ' + environment.runtimeVersion),
        [['manageInstallation', 'installation'], ['manageHome', 'home'], ['manageProfile', 'profile']].map(([label, key]) =>
          h(DirectoryLine, {key, label: t(label), value: environment[key], t, action, busy})));
    }

    function PluginDiagnostics({item, t, action, busy}) {
      if (!item) return null;
      const compatibility = {compatible: 'manageCompatible', incompatible: 'manageIncompatible', undeclared: 'manageUndeclared', exempted: 'manageExempted', unknown: 'manageUnknown'};
      const dependencyStatus = {satisfied: 'manageDependencySatisfied', missing: 'manageDependencyMissing', mismatch: 'manageDependencyMismatch',
        'optional-missing': 'manageDependencyOptional', unverified: 'manageDependencyUnverified', unknown: 'manageDependencyUnknown'};
      const dependencies = h('ul', {className: 'opm-dependencies'}, item.dependencies.map(dep => h('li', {key: dep.name},
        h('strong', null, dep.name), h('span', {className: 'opm-muted'}, dep.requested + ' · ' + (dep.version || t('manageUnknown'))),
        h('span', {className: ['missing', 'mismatch'].includes(dep.status) ? 'opm-error' : 'opm-muted'}, t(dependencyStatus[dep.status] || 'manageUnknown')))));
      return h('details', {className: 'opm-plugin-diagnostics'}, h('summary', null, t('manageDiagnostics')),
        h(DirectoryLine, {label: t('managePackage'), value: item.directory, t, action, busy}),
        h(DirectoryLine, {label: t('manageConfiguration'), value: item.configuration, t, action, busy}),
        h('dl', null, h('dt', null, t('manageOrder')), h('dd', null, item.order ?? t('manageNotSelected')),
          h('dt', null, t('manageRuntimeOrder')), h('dd', null, item.runtimeOrder.join(', ') || t('manageRowUnknown')),
          h('dt', null, t('manageCompatibility')), h('dd', null, t(compatibility[item.compatibility?.status] || 'manageUnknown'))),
        item.compatibility?.requirements && h('pre', {className: 'opm-manage-document'}, JSON.stringify(item.compatibility.requirements, null, 2)),
        item.error && h('p', {className: 'opm-error'}, item.error),
        h('h4', null, t('manageDependencies')), item.dependencies.length ? dependencies : h('p', {className: 'opm-muted'}, t('manageNoDependencies')),
        item.dependents.length > 0 && h('p', null, t('manageDependents') + ': ' + item.dependents.join(', ')),
        h('h4', null, t('manageRiskCount')), h('p', {className: 'opm-muted'}, t('manageRiskHelp')),
        item.risks.length ? h('ul', null, item.risks.map((risk, index) => h('li', {key: index},
          t({'install-scripts': 'manageInstallScripts', dependency: 'manageDependencyRisk', compatibility: 'manageCompatibilityRisk'}[risk.code] || 'manageUnknown') + ': ' + risk.detail)))
          : h('p', {className: 'opm-muted'}, t('manageNoRisks')));
    }

    function managementRows(bundles, entries, checks, plugins, resolve) {
      const catalog = new Map(entries.map(entry => [entry.name, entry]));
      const live = new Map(plugins.map(plugin => [plugin.entryId, plugin]));
      return bundles.filter(bundle => bundle.installed || bundle.availability === 'installation').map(bundle => {
        const entry = catalog.get(bundle.name);
        const rows = (bundle.rows || []).map(row => ({...row, live: live.get(row.entryId)}));
        const check = checks[bundle.name];
        const offered = bundle.updatable && check?.status === 'listed' && check.installed === bundle.version
          ? check.versions.find(version => version.bundle && !version.deprecated && !version.incompatible
            && olderVersion(bundle.version, version.version) && (!version.prerelease || bundle.version?.includes('-'))) : null;
        const target = offered ? {spec: bundle.name + '@' + offered.version, registry: check.registry} : catalogUpdate(bundle, entry);
        return {bundle, entry, rows, target, system: !!(bundle.official || bundle.availability === 'installation'), title: entry ? titleOf(entry, resolve) : resolve(bundle.meta?.title ?? '') || bundle.name,
          problem: !!(bundle.error || bundle.meta?.error || rows.some(row => row.live?.diagnostic || row.live?.fiberPhase === 'failed'))};
      }).sort((a, b) => +a.system - +b.system || a.title.localeCompare(b.title));
    }

    function filterManaged(rows, {query = '', filter = 'all', names} = {}) {
      const needle = searchText(query).trim();
      return rows.filter(row => (!names || names.includes(row.bundle.name))
        && (!needle || searchText([row.title, row.bundle.name, row.bundle.source].filter(Boolean).join(' ')).includes(needle))
        && (filter === 'all' || filter === 'enabled' && row.bundle.enabled || filter === 'disabled' && !row.bundle.enabled
          || filter === 'updates' && row.target || filter === 'problems' && row.problem || filter === 'external' && !row.entry));
    }

    function InstalledPanel({ entries = [], onClose, restoreFocus, remote, ...props }) {
      const {t, resolve, manager, openPackage} = props;
      const headingId = React.useId(), detailId = React.useId();
      const {groups} = useFavorites();
      const [inventory, setInventory] = React.useState({status: 'loading', bundles: [], plugins: [], management: null});
      const [query, setQuery] = React.useState(''), [filter, setFilter] = React.useState('all'), [group, setGroup] = React.useState('');
      const [selected, setSelected] = React.useState(''), [checked, setChecked] = React.useState([]), [checks, setChecks] = React.useState({});
      const [busy, setBusy] = React.useState(false), [checking, setChecking] = React.useState(false), [note, setNote] = React.useState('');
      const [removing, setRemoving] = React.useState(''), [confirmation, setConfirmation] = React.useState('');
      const [documentState, setDocumentState] = React.useState(null);
      const [systemOpen, setSystemOpen] = React.useState(false);
      const alive = React.useRef(true), read = React.useRef(null), documentRequest = React.useRef(0);
      React.useEffect(() => {
        alive.current = true;
        let reading = false;
        const abort = new AbortController();
        read.current = async () => {
          if (reading) return;
          reading = true;
          try {
            const service = manager();
            const management = await requestManagement(undefined, {signal: abort.signal}).catch(() => null);
            const [bundles, plugins] = management?.ok && management.inventory
              ? [{ok: true, value: management.inventory.bundles}, {ok: true, value: management.inventory.plugins}]
              : await Promise.all([service?.listBundles?.(), service?.listPlugins?.()]);
            if (!bundles?.ok) throw Error(errorText(bundles?.error, t('manageUnavailable')));
            if (alive.current) setInventory({status: 'ready', bundles: bundles.value, plugins: plugins?.ok ? plugins.value : [], management});
          } catch (error) {
            if (alive.current) setInventory(current => ({...current, status: current.bundles.length ? 'ready' : 'error', error: errorText(error, t('manageUnavailable'))}));
          } finally { reading = false; }
        };
        void read.current();
        const timer = window.setInterval(() => { void read.current?.(); }, 3000);
        const off = remote?.$on?.('plugin-manager/changed', () => { void read.current?.(); });
        return () => { alive.current = false; documentRequest.current++; abort.abort(); window.clearInterval(timer); off?.(); read.current = null; };
      }, [manager, remote, t]);
      const rows = React.useMemo(() => managementRows(inventory.bundles, entries, checks, inventory.plugins, resolve), [inventory.bundles, entries, checks, inventory.plugins, resolve]);
      const shown = filterManaged(rows, {query, filter, names: groups.find(item => item.id === group)?.names});
      const current = shown.find(row => row.bundle.name === selected) ?? shown.find(row => !row.system) ?? shown[0];
      const diagnostics = inventory.management?.diagnostics;
      const activity = inventory.management?.activity;
      const available = inventory.management?.ok && activity?.available;
      const safe = available && !activity.busy;
      const jobs = inventory.management?.jobs ?? [];
      const pendingNames = new Set(jobs.filter(job => ['queued', 'waiting', 'running'].includes(job.state)).map(job => job.request.name));
      React.useEffect(() => {
        documentRequest.current++; setDocumentState(null); setRemoving(''); setConfirmation('');
      }, [current?.bundle.name]);
      React.useEffect(() => {
        setChecked(names => names.filter(name => inventory.bundles.some(bundle => bundle.name === name)));
      }, [inventory.bundles]);
      React.useEffect(() => {if (query.trim() || filter !== 'all' || group) setSystemOpen(true);}, [query, filter, group]);

      const button = (label, onClick, disabled = false, className = '') => h('button', {type: 'button', className: 'opm-button opm-button-small ' + className, onClick, disabled}, label);
      async function action(request) {
        setBusy(true); setNote('');
        try {
          const answer = await requestManagement(request);
          if (alive.current) setNote(answer.ok ? t(answer.queued ? 'manageQueued' : answer.restart ? 'manageRestart' : 'manageDone') : managementMessage(answer, t));
          await read.current?.();
          return answer;
        } catch (error) { if (alive.current) setNote(errorText(error, t('manageUnavailable'))); return {ok: false}; }
        finally { if (alive.current) setBusy(false); }
      }
      async function update(row, when) {
        if (!row.target) return;
        return action({action: 'update', name: row.bundle.name, ...installTarget(row.target, getSettings()), when, requestId: crypto.randomUUID()});
      }
      async function batch(kind) {
        const targets = rows.filter(row => checked.includes(row.bundle.name));
        setBusy(true); setNote('');
        const results = [];
        for (const row of targets) {
          if (!alive.current) break;
          if (kind === 'update' && !row.target) continue;
          if (kind !== 'update' && (row.bundle.name === 'dsh-open-market' || row.bundle.readOnlyReason)) continue;
          try {
            const answer = await requestManagement(kind === 'update'
              ? {action: 'update', name: row.bundle.name, ...installTarget(row.target, getSettings()), when: 'idle', requestId: crypto.randomUUID()}
              : {action: 'toggle', name: row.bundle.name, enabled: kind === 'enable'});
            results.push(row.title + ': ' + (answer.ok ? t(answer.queued ? 'manageQueued' : answer.restart ? 'manageRestart' : 'manageDone') : managementMessage(answer, t)));
            if (!answer.ok && ['tasks-active', 'task-monitor-unavailable'].includes(answer.code)) break;
          } catch (error) { results.push(row.title + ': ' + errorText(error, t('unknownError'))); }
        }
        if (alive.current) { setBusy(false); setNote(results.join('\n') || t('nothingToChange')); }
        await read.current?.();
      }
      async function checkUpdates() {
        setChecking(true); setNote('');
        const service = manager(), targets = rows.filter(row => (!checked.length || checked.includes(row.bundle.name)) && row.bundle.installed);
        const next = {};
        for (let offset = 0; offset < targets.length; offset += 3) {
          await Promise.all(targets.slice(offset, offset + 3).map(async row => {
            try {
              const answer = await service?.listVersions?.(row.bundle.name, {});
              next[row.bundle.name] = answer?.ok ? answer.value : {status: 'refused', reason: errorText(answer?.error, t('manageCheckUnavailable'))};
            } catch (error) { next[row.bundle.name] = {status: 'refused', reason: errorText(error, t('manageCheckUnavailable'))}; }
          }));
          if (!alive.current) return;
        }
        setChecks(current => ({...current, ...next})); setChecking(false); setNote(t('manageChecked'));
      }
      async function openNative(name) {
        onClose();
        try {
          const answer = await openPackage(name);
          if (answer?.ok === false) props.onNotice?.(t('manageNativeUnavailable'));
        } catch { props.onNotice?.(t('manageNativeUnavailable')); }
      }
      async function loadDocument(name) {
        const request = ++documentRequest.current;
        setDocumentState({status: 'loading'});
        try {
          const answer = await manager()?.readBundleDetail?.(name, t('dateLocale'), {npmFileSources: []});
          if (!alive.current || request !== documentRequest.current) return;
          if (!answer?.ok) throw Error(errorText(answer?.error, t('manageUnavailable')));
          setDocumentState(answer.value.status === 'found' ? {status: 'ready', markdown: answer.value.markdown} : {status: 'none'});
        } catch (error) { if (alive.current && request === documentRequest.current) setDocumentState({status: 'error', error: errorText(error, t('manageUnavailable'))}); }
      }
      async function copyReport() {
        const report = {generatedAt: new Date().toISOString(), plugins: rows.filter(row => !checked.length || checked.includes(row.bundle.name)).map(row => ({
          name: row.bundle.name, version: row.bundle.version, enabled: row.bundle.enabled, source: row.bundle.source,
          problem: row.bundle.error, components: row.rows.map(item => ({name: item.moduleName, state: item.live?.fiberPhase, diagnostic: item.live?.diagnostic})),
        })), diagnostics, queue: jobs};
        try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); setNote(t('manageReportCopied')); }
        catch (error) { setNote(errorText(error, t('unknownError'))); }
      }
      const detail = current && (() => {
        const {bundle, entry, rows: components, target} = current;
        const locked = busy || !safe || !!bundle.readOnlyReason || pendingNames.has(bundle.name);
        return h('div', {className: 'opm-manage-detail', id: detailId, role: 'region', 'aria-label': t('manageDetails')},
          h('div', {className: 'opm-manage-detail-head', style: {'--opm-hue': hueOf(bundle.name)}},
            h(PluginIcon, {entry: entry || {name: bundle.name, icon: bundle.meta?.icon}, title: current.title, large: true}),
            h('div', {className: 'opm-manage-detail-title'}, h('h3', null, current.title),
              h('p', {className: 'opm-muted'}, (current.title === bundle.name ? '' : bundle.name + ' · ') + (bundle.version || t('unknownVersion'))),
              h('p', {className: 'opm-manage-source', title: t('manageSource')}, bundle.source || t(bundle.official ? 'providedVersion' : 'unknownVersion'))),
            h(ManagedStatus, {bundle, t})),
          h('div', {className: 'opm-manage-actions'},
            button(t(bundle.enabled ? 'disable' : 'enable'), () => action({action: 'toggle', name: bundle.name, enabled: !bundle.enabled}), locked || bundle.name === 'dsh-open-market'),
            button(t('manageUninstall'), () => { setRemoving(bundle.name); setConfirmation(''); }, locked || !bundle.removable || bundle.name === 'dsh-open-market', 'opm-manage-danger'),
            h(FavoriteButton, {name: bundle.name, title: current.title, t}),
            button(t('manageSettings'), () => openNative(bundle.name), false, 'opm-manage-native')),
          bundle.readOnlyReason && h('p', {className: 'opm-note'}, t('manageReadonly')),
          bundle.name === 'dsh-open-market' && h('p', {className: 'opm-note'}, t('manageSelf')),
          bundle.error && h('p', {className: 'opm-error', role: 'status'}, errorText(bundle.error, t('unknownError'))),
          removing === bundle.name && h('div', {className: 'opm-manage-remove', role: 'group', 'aria-label': t('manageRemoveTitle')},
            h('strong', null, t('manageRemoveTitle')), h('p', null, t('manageRemoveHelp')),
            h('label', null, t('manageConfirmName'), h('input', {className: 'opm-manage-search', value: confirmation, autoComplete: 'off', spellCheck: false, onChange: event => setConfirmation(event.target.value)})),
            h('div', {className: 'opm-manage-actions'}, button(t('manageCancelRemove'), () => { setRemoving(''); setConfirmation(''); }),
              button(t('manageUninstall'), async () => { const answer = await action({action: 'remove', name: bundle.name, confirmation}); if (answer?.ok) {setRemoving(''); setConfirmation('');} }, locked || confirmation !== bundle.name, 'opm-manage-danger'))),
          target && h('section', {className: 'opm-manage-update'}, h('h4', null, t('updateAvailable'),
              h('span', {className: 'opm-version'}, bundle.version + ' → ' + (target.spec.startsWith(bundle.name + '@') ? target.spec.slice(bundle.name.length + 1) : entry?.defaultVersion || t('manageTarget')))),
            h('div', {className: 'opm-manage-actions'}, button(t('manageNow'), () => update(current, 'now'), locked),
              h('button', {type: 'button', className: 'opm-button opm-button-small opm-button-primary', title: t('manageIdleHelp'), onClick: () => update(current, 'idle'),
                disabled: busy || !available || !!bundle.readOnlyReason || pendingNames.has(bundle.name)}, t('manageIdle')))),
          !target && checks[bundle.name]?.status === 'refused' && h('p', {className: 'opm-muted'}, checks[bundle.name].reason),
          h('section', null,
            entry ? h(React.Fragment, null, h('p', null, descriptionOf(entry, resolve, t)), h(Tags, {entry, metadata: props.metadata, resolve, t}),
              h('div', {className: 'opm-manage-actions'},
                h('a', {className: 'opm-button opm-button-small', href: marketPageOf(entry, t), target: '_blank', rel: 'noopener noreferrer'}, t('marketPage'))))
              : h(React.Fragment, null, bundle.description && h('p', null, bundle.description), h('p', {className: 'opm-muted'}, t('manageNoMarket')))),
          h('div', {className: 'opm-manage-more'},
            h(PluginDiagnostics, {item: diagnostics?.bundles?.find(item => item.name === bundle.name), t, action, busy}),
            h('details', {className: 'opm-components'}, h('summary', null, t('manageRows'), h('span', {className: 'opm-manage-count'}, components.length)),
              components.length ? h('ul', {className: 'opm-favorite-list'}, components.map(row => h('li', {key: row.rowId},
                h('p', null, resolve(row.meta?.title ?? '') || row.moduleName),
                h('p', {className: row.live?.diagnostic ? 'opm-error' : 'opm-muted'}, managementComponentState(row, bundle, t)))))
                : h('p', {className: 'opm-muted'}, t('manageNoRows'))),
            h('details', {className: 'opm-manage-readme', onToggle: event => { if (event.currentTarget.open && !documentState) void loadDocument(bundle.name); }},
              h('summary', null, t('manageDocument')),
              !documentState ? button(t('manageLoadDocument'), () => loadDocument(bundle.name))
                : documentState.status === 'ready' ? h('pre', {className: 'opm-manage-document'}, documentState.markdown)
                : h('p', {className: 'opm-muted', role: 'status'}, documentState.status === 'loading' ? t('detailLoading') : documentState.error || t('manageNoDocument')))));
      })();
      const renderRow = row => {
        const name = row.bundle.name;
        const badges = h('span', {className: 'opm-manage-badges'},
          h(ManagedStatus, {bundle: row.bundle, t}),
          row.target && h('span', {className: 'opm-tag'}, t('updateAvailable')),
          row.problem && h('span', {className: 'opm-tag'}, t('manageProblems')),
          pendingNames.has(name) && h('span', {className: 'opm-tag'}, t('manageStateQueued')));
        const copy = h('span', {className: 'opm-manage-copy'}, h('strong', null, row.title),
          h('small', {title: name + ' · ' + (row.bundle.version || t('unknownVersion'))}, name + ' · ' + (row.bundle.version || t('unknownVersion'))), badges);
        return h('li', {key: name, className: 'opm-manage-row'},
          h('input', {type: 'checkbox', checked: checked.includes(name), 'aria-label': t('manageSelect').replace('{name}', row.title),
            onChange: event => setChecked(names => event.target.checked ? [...new Set([...names, name])] : names.filter(item => item !== name))}),
          h('button', {type: 'button', className: 'opm-manage-open', style: {'--opm-hue': hueOf(name)}, 'aria-current': current?.bundle.name === name, 'aria-controls': detailId, onClick: () => setSelected(name)},
            h(PluginIcon, {entry: row.entry || {name, icon: row.bundle.meta?.icon}, title: row.title}), copy));
      };
      const customRows = shown.filter(row => !row.system), systemRows = shown.filter(row => row.system);
      const list = h('div', {className: 'opm-manage-list'},
        h('section', {className: 'opm-manage-group', 'aria-label': t('manageCustom')},
          h('h3', {className: 'opm-manage-group-title'}, t('manageCustom'), h('span', null, customRows.length),
            shown.length > 0 && h('button', {type: 'button', className: 'opm-manage-select-all',
              onClick: () => setChecked(checked.length ? [] : shown.map(row => row.bundle.name))}, t(checked.length ? 'manageClear' : 'manageSelectAll'))),
          h('ul', null, customRows.map(renderRow))),
        systemRows.length > 0 && h('details', {className: 'opm-manage-group opm-system-group', open: systemOpen,
          onToggle: event => {if (event.target === event.currentTarget) setSystemOpen(event.currentTarget.open);}},
          h('summary', {className: 'opm-manage-group-title'}, t('manageSystem'), h('span', null, systemRows.length)),
          h('ul', null, systemRows.map(renderRow))),
        h(RuntimeOverview, {diagnostics, t, action, safe, busy, rows}));
      const queue = h('details', {className: 'opm-manage-queue', open: jobs.some(job => ['queued', 'waiting', 'running'].includes(job.state))},
        h('summary', null, t('manageQueuedCount').replace('{count}', jobs.filter(job => ['queued', 'waiting', 'running'].includes(job.state)).length)),
        !jobs.length ? h('p', {className: 'opm-muted'}, t('manageQueueEmpty')) : h('ul', null, [...jobs].reverse().map(job => {
          let control;
          if (['queued', 'waiting'].includes(job.state)) control = button(t('manageCancel'), () => action({action: 'cancel', id: job.id}), busy);
          else if (['failed', 'interrupted'].includes(job.state)) control = h(React.Fragment, null,
            button(t('manageRetry'), () => action({action: 'retry', id: job.id}), busy || job.result?.code === 'installation-changed'),
            button(t('manageDismiss'), () => action({action: 'dismiss', id: job.id}), busy));
          else if (job.state !== 'running') control = button(t('manageDismiss'), () => action({action: 'dismiss', id: job.id}), busy);
          return h('li', {key: job.id, className: 'opm-manage-job'},
            h('span', null, job.request.name + (job.request.version ? ' ' + job.request.version : '')),
            h('span', {className: 'opm-muted'}, t('manageState' + job.state[0].toUpperCase() + job.state.slice(1))), control,
            job.result && (!job.result.ok || job.result.restart) && h('p', {className: 'opm-muted'}, job.result.ok ? t('manageRestart') : managementMessage(job.result, t)));
        })));
      const summary = diagnostics?.available ? diagnostics.summary : null;
      const filtered = shown.length !== rows.length;
      const status = note || inventory.error || (inventory.status === 'ready' && !available ? t('manageMonitor') : '');
      return h(Dialog, {labelledBy: headingId, closeLabel: t('close'), onClose, restoreFocus, panelClass: 'opm-panel-management'},
        h('div', {className: 'opm-manage-head'}, h('h2', {id: headingId}, t('health')),
          h('span', {className: 'opm-manage-pill'}, filtered ? t('manageCount').replace('{shown}', shown.length).replace('{total}', rows.length) : t('manageTotal').replace('{total}', rows.length)),
          h('span', {className: 'opm-manage-pill ' + (!available || activity.busy ? 'opm-manage-pill-busy' : 'opm-manage-pill-ok'), role: 'status'},
            !available ? t('manageMonitoring') : activity.busy ? t('manageRunning').replace('{count}', Math.max(activity.running, activity.activities)) : t('manageReady')),
          summary && summary.loadedCustom < summary.custom && h('span', {className: 'opm-manage-pill opm-manage-pill-warn'}, t('manageLoaded') + ' ' + summary.loadedCustom + ' / ' + summary.custom),
          summary?.errors > 0 && h('span', {className: 'opm-manage-pill opm-manage-pill-warn'}, t('manageErrorCount') + ' ' + summary.errors),
          summary?.risks > 0 && h('span', {className: 'opm-manage-pill opm-manage-pill-risk', title: t('manageRiskHelp')}, t('manageRiskCount') + ' ' + summary.risks)),
        h('div', {className: 'opm-manage-controls'}, h('input', {type: 'search', className: 'opm-manage-search', value: query, placeholder: t('manageSearch'), 'aria-label': t('manageSearch'), onChange: event => setQuery(event.target.value)}),
          groups.length > 1 && h('select', {value: group, 'aria-label': t('manageGroup'), onChange: event => setGroup(event.target.value)}, h('option', {value: ''}, t('manageAllGroups')),
            groups.map(item => h('option', {key: item.id, value: item.id}, groupLabel(item, t)))),
          h('button', {type: 'button', className: 'opm-button opm-button-primary', onClick: checkUpdates, disabled: checking || inventory.status !== 'ready'}, t(checking ? 'manageChecking' : 'manageCheck'))),
        h('div', {className: 'opm-manage-tabs', role: 'group', 'aria-label': t('manageFilter')},
          [['all', 'manageAll'], ['enabled', 'manageEnabled'], ['disabled', 'manageDisabled'], ['updates', 'manageUpdates'], ['problems', 'manageProblems'], ['external', 'manageExternal']]
            .map(([value, label]) => h('button', {key: value, type: 'button', className: 'opm-button opm-button-small', 'aria-pressed': filter === value, onClick: () => setFilter(value)}, t(label)))),
        status && h('p', {className: 'opm-manage-status', role: 'status', 'aria-live': 'polite'}, status),
        h('div', {className: 'opm-manage-body'},
          h('div', {className: 'opm-manage-column'},
            checked.length > 0 && h('div', {className: 'opm-manage-bulk'},
              h('span', null, t('manageSelected').replace('{count}', checked.length)),
              button(t('enableAll'), () => batch('enable'), busy || !safe), button(t('disableAll'), () => batch('disable'), busy || !safe),
              button(t('manageQueueSelected'), () => batch('update'), busy || !available)),
            inventory.status === 'loading' ? h('p', {role: 'status'}, t('detailLoading')) : list,
            inventory.status !== 'loading' && !shown.length && h('p', {className: 'opm-muted'}, t('manageNoResults'))),
          detail || h('p', {className: 'opm-muted'}, t('manageNoSelection'))),
        h('div', {className: 'opm-manage-footer'}, queue,
          h('button', {type: 'button', className: 'opm-manage-report', onClick: copyReport, disabled: inventory.status !== 'ready'}, t('manageReport'))));
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
      return [...entries].sort(order ? (a, b) => order(a, b) || recommendedOrder(a, b) : marketsLast);
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
          h('div', { className: 'opm-heading-copy' }, h('span', { className: 'opm-glyph opm-glyph-all', 'aria-hidden': true }, h(Glyph, { name: 'all' })),
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

    const SEARCH_ALIASES = [
      ['笔记', '记事本', '便笺', '便签', 'note', 'notes', 'notepad'],
      ['待办', '任务清单', 'todo', 'to-do', 'task'], ['截图', '截屏', 'screenshot', 'capture'],
      ['翻译', '翻譯', 'translate', 'translation'], ['记忆', '記憶', 'memory'],
      ['主题', '主題', '皮肤', '外观', 'theme', 'skin', 'appearance'],
      ['语音', '語音', '朗读', 'tts', 'speech', 'voice'], ['听写', '听写输入', 'dictation', 'stt'],
      ['图片', '图像', '生图', 'image', 'images'], ['视频', '影片', 'video'],
      ['搜索', '搜寻', '搜尋', 'search'], ['备份', '備份', 'backup'],
      ['恢复', '還原', 'restore', 'recovery'], ['工作流', 'workflow'],
      ['浏览器', '瀏覽器', 'browser'], ['文件', '檔案', 'file', 'files'],
      ['终端', '終端', 'terminal'], ['费用', '費用', '成本', 'cost', 'billing'],
      ['用量', 'usage'], ['技能', 'skill', 'skills'], ['收藏', 'favorite', 'bookmark']
    ];
    const searchText = value => String(value ?? '').normalize('NFKC').toLowerCase();
    function filterCatalog(entries, query, category, resolve) {
      const terms = searchText(query).trim().split(/\s+/).filter(Boolean);
      const groups = terms.map(term => SEARCH_ALIASES.find(group => group.includes(term)) ?? [term]);
      return entries.filter(entry => !category || entry.metadata?.category === category).map(entry => {
        const text = searchText([entry.name, titleOf(entry, resolve), entry.author, resolve(entry.description ?? ''),
          ...(entry.description && typeof entry.description === 'object' ? Object.values(entry.description) : []), ...(entry.metadata?.keywords || [])].join(' '));
        return {entry, exact: terms.filter(term => text.includes(term)).length,
          matches: groups.every(group => group.some(term => text.includes(term)))};
      }).filter(item => item.matches).sort((a, b) => b.exact - a.exact || recommendedOrder(a.entry, b.entry)).map(item => item.entry);
    }

    function Toolbar({ t, query, setQuery, category, setCategory, categories, resolve, onPanel, updates }) {
      const { groups } = useFavorites();
      const count = new Set(groups.flatMap(group => group.names)).size;
      return h('div', { className: 'opm-toolbar' }, h(SearchBar, { t, query, setQuery }),
        h('span', {className: 'opm-category-wrap'}, h('select', {className: 'opm-category', value: category, 'aria-label': t('category'), onChange: event => setCategory(event.target.value)},
          h('option', {value: ''}, t('allCategories')),
          Object.entries(categories).map(([id, info]) => h('option', {key: id, value: id}, resolve(info.title ?? '') || id))),
          h('svg', {viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true}, h('path', {d: 'm4 6 4 4 4-4'}))),
        h('button', { type: 'button', className: 'opm-button opm-favorites-button', 'aria-haspopup': 'dialog', onClick: event => onPanel('favorites', event) },
          h(Glyph, { name: 'starred' }), t('favorites'), count > 0 && h('small', null, count)),
        h('button', { type: 'button', className: 'opm-button opm-favorites-button opm-installed-button', 'aria-haspopup': 'dialog',
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
          : h('p', { className: 'opm-muted opm-search-empty' }, props.t('noResults')),
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
            const answer = await requestManagement({action: 'toggle', name, enabled});
            if (!answer.ok) {
              failures.push(name + ': ' + managementMessage(answer, t));
              if (['tasks-active', 'task-monitor-unavailable'].includes(answer.code)) break;
              continue;
            }
            changed++;
            if (answer.restart) restart = true;
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
    const FOOTER_INTERVAL = 10000;
    let footerTurn = 0;
    function nextFooterTurn() {
      let previous = footerTurn;
      try {
        const saved = window.localStorage.getItem(FOOTER_KEY);
        if (saved === '0' || saved === '1') previous = Number(saved);
      } catch { /* Use the last message from this session. */ }
      return (previous + 1) % 2;
    }
    function rememberFooterTurn(turn) {
      footerTurn = turn;
      try { window.localStorage.setItem(FOOTER_KEY, String(turn)); } catch { /* Keep the session's last message. */ }
      persistProfile('footerTurn');
    }

    function FooterInvite({ t, stars }) {
      const [inviting, setInviting] = React.useState(() => nextFooterTurn() === 0);
      const [hovered, setHovered] = React.useState(false);
      const [focused, setFocused] = React.useState(false);
      React.useEffect(() => {
        rememberFooterTurn(inviting ? 0 : 1);
      }, [inviting]);
      React.useEffect(() => {
        if (hovered || focused) return;
        const timer = window.setInterval(() => setInviting(value => !value), FOOTER_INTERVAL);
        return () => window.clearInterval(timer);
      }, [hovered, focused]);
      const on = value => ({ 'data-on': value ? '' : undefined });
      return h('a', { className: 'opm-footer-link', href: inviting ? t('contributingUrl') : REPOSITORY_URL, target: '_blank', rel: 'noopener noreferrer',
        onClick: supportMarket,
        onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false),
        onFocus: () => setFocused(true), onBlur: () => setFocused(false),
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
    const APPEARANCE_LABELS = { auto: 'appearanceAuto', light: 'appearanceLight', dark: 'appearanceDark' };

    function ChoiceChips({ t, label, setting, choices }) {
      const preferences = useSettings();
      const labelId = React.useId();
      return h('div', { className: 'opm-setting-block' },
        h('span', { className: 'opm-setting-label', id: labelId }, t(label)),
        h('div', { className: 'opm-chips', role: 'group', 'aria-labelledby': labelId },
          Object.entries(choices).map(([choice, key]) => h('button', { type: 'button', key: choice, className: 'opm-chip',
            'aria-pressed': preferences[setting] === choice, onClick: () => updateSettings(setting, choice) }, t(key)))));
    }

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
    // Whether the host has a sidebar to hold the page.
    let sidebarHost = { supported: false };
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
    const sidebarWanted = preference => preference !== 'off';

    function SidebarSwitch({ t }) {
      const host = React.useSyncExternalStore(subscribeSidebarHost, getSidebarHost, getSidebarHost);
      const preferences = useSettings();
      if (!host.supported) return null;
      return h(React.Fragment, null,
        h(SettingSwitch, { label: t('sidebarMarket'), checked: sidebarWanted(preferences.sidebarMarket),
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
        group('settingsTheme', toggle('theme'), h('p', { className: 'opm-setting-help' }, t('themeHelp')),
          preferences.theme && h(ChoiceChips, { t, label: 'themeAppearance', setting: 'themeAppearance', choices: APPEARANCE_LABELS })),
        autoReview.status === 'ready' && group('settingsTools',
          h(SettingSwitch, { label: t('autoReview'), checked: autoReview.enabled, disabled: !!autoReview.busy, onChange: setAutoReview }),
          h('p', { className: 'opm-setting-help' }, t('autoReviewHelp')),
          autoReview.note && h('p', { className: 'opm-setting-help', role: 'status' }, autoReview.note)),
        group('settingsData', h(ProfileStatus, {t}), h(SyncRow, { t }), h('p', { className: 'opm-setting-help' }, t('syncHelp')),
          h('p', { className: 'opm-setting-help' }, t('likesHelp'))),
        group('settingsDownload', h(RegistryChoice, { t })),
        group('about',
          link('website', t('websiteUrl')),
          link('repository', REPOSITORY_URL),
          link('contributing', t('contributingUrl')),
          link('submitPlugin', REPOSITORY_URL + '/issues/new?template=plugin-add.yml'),
          h('p', { className: 'opm-index-address' }, t('indexAddress'), h('code', null, INDEX_URL))));
    }

    function ProfileStatus({t}) {
      const status = React.useSyncExternalStore(listener => { profileListeners.add(listener); return () => profileListeners.delete(listener); }, getProfileStatus, getProfileStatus);
      return h('div', {className: 'opm-setting-copy', role: 'status'},
        h('p', {className: 'opm-setting-help'}, t(status === 'error' ? 'profileFailed' : status === 'ready' ? 'profileSaved' : 'profileSaving')),
        status === 'error' && h('button', {type: 'button', className: 'opm-button opm-button-small', onClick: () => void hydrateProfile()}, t('retry')));
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
          // The same shape as the page that follows: a row of picks, then the boards.
          [['opm-skeleton-pick', 2], ['opm-skeleton-board', 2]].map(([shape, count]) => h('div', { key: shape, className: 'opm-section' },
            h('div', { className: 'opm-skeleton opm-skeleton-title' }),
            h('div', { className: 'opm-boards' }, Array.from({ length: count }, (_, card) => h('div', {
              key: card, className: 'opm-skeleton ' + shape
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
      React.useEffect(() => root.current ? attachHorizontalDrag(root.current) : undefined, [root]);
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
      const [category, setCategory] = React.useState('');
      React.useEffect(() => { void enterMarket(manager); }, [remote, manager]);

      const sections = React.useMemo(() => {
        if (state.status !== 'ready') return null;
        // Today's picks, the search and the panels keep their own rules; this only thins the browsing lists.
        const entries = preferences.showInstalled
          ? state.entries : state.entries.filter(entry => entry.installation.status === 'not-installed');
        const top = list => list.slice(0, BOARD_LIMIT);
        // Plugin markets get no recommendation weight here, this one included: they come after every other plugin.
        const ranked = [...entries].sort(marketsLast);
        // Recommended, Fastest growing and Newly published never repeat a plugin; each takes the next unseen ones.
        const seen = new Set();
        const take = list => {
          const picked = list.filter(entry => !seen.has(entry.name)).slice(0, 20);
          picked.forEach(entry => seen.add(entry.name));
          return picked;
        };
        return {
          daily: featuredPool(state.entries, counts, day),
          // Ranked lists read top to bottom; the rails below stay for browsing.
          boards: [
            ['popular', top(entries.filter(entry => likeCount(counts, entry.name) > 0)
              .sort((a, b) => counts[b.name] - counts[a.name] || recommendedOrder(a, b)))],
            ['starred', top(sortCatalog(entries.filter(entry => sortValue(entry, 'github-stars') > 0), 'stars', counts))]
          ].filter(([, list]) => list.length),
          rails: [
            ['recommended', take(ranked)],
            ['trending', take(ranked.filter(rising))],
            ['newest', take([...entries].sort((a, b) => latestPublication(b) - latestPublication(a) || recommendedOrder(a, b)))]
          ].filter(([, list]) => list.length),
          all: ranked,
          updates: state.entries.filter(entry => entry.defaultVersion && entry.installation.status === 'update-available').length,
          stars: state.entries.find(entry => entry.name === 'dsh-open-market')?.metadata?.sortKeys?.['github-stars']
        };
      }, [state, day, preferences.showInstalled, counts]);

      const results = React.useMemo(() => {
        if (state.status !== 'ready' || (!query.trim() && !category)) return null;
        return filterCatalog(state.entries, query, category, resolve);
      }, [state, query, category, resolve]);

      async function addSource() {
        const listed = await remote.pluginMarket.listIndexes();
        const urls = listed.ok ? listed.value.map(source => source.url) : [];
        const added = urls.includes(INDEX_URL) ? { ok: true } : await remote.pluginMarket.setIndexes([...urls, INDEX_URL]);
        if (added.ok) void syncMarket();
        else updateMarket({ status: 'error', error: added.error, invalidPage: false });
      }

      const installWith = React.useCallback(target => install(installTarget(target, getSettings())), [install]);
      const props = { t, resolve, remote, install: installWith, openPackage, manager, metadata: state.metadata, onError: setActionError, onNotice: setActionNotice, busyLabel,
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
          h(Toolbar, { t, query, setQuery, category, setCategory, categories: state.metadata?.categories || {}, resolve,
            updates: preferences.showCheckup ? sections.updates : null,
            onPanel: (kind, event) => setPanel({ kind, from: event.currentTarget }) }),
          results ? h(SearchResults, { ...props, entries: results }) : h(React.Fragment, null,
            h(FeaturedCarousel, { ...props, entries: sections.daily, autoRotate: preferences.autoRotate && !selected && !panel }),
            h(Leaderboards, { ...props, boards: sections.boards, counts }),
            sections.rails.map(([section, entries]) => h(PluginRail, { ...props, key: section, section, entries })),
            h(AllPlugins, { ...props, entries: sections.all, counts })),
          actionNotice && h('p', { className: 'opm-note opm-action-error', role: 'status' }, actionNotice),
          actionError && h('p', { className: 'opm-error opm-action-error', role: 'alert' }, t('actionFailed') + ': ' + actionError));
      }
      const detailEntry = selected && (state.entries?.find(entry => entry.name === selected.entry.name) || selected.entry);
      return h('div', { className: 'opm-root opm-market', ref: root, tabIndex: -1 },
        h('div', { inert: selected || panel ? '' : undefined }, content,
        state.status !== 'ready' && h('button', {type: 'button', className: 'opm-button opm-installed-button', 'aria-haspopup': 'dialog',
          onClick: event => setPanel({kind: 'installed', from: event.currentTarget})}, t('health')),
        h('div', { className: 'opm-footer' },
          h('a', { className: 'opm-footer-link', href: t('websiteUrl'), target: '_blank', rel: 'noopener noreferrer',
            onClick: supportMarket,
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

    // Optional Whale Maid theme. theme/theme.css scopes every rule under this body attribute, so removing the attribute
    // is enough to switch it off without a reload; the Host serves the stylesheet and artwork (theme-assets.js).
    // Its light or dark palette follows DSH's own dark attribute unless the user picks one.
    const THEME_ATTRIBUTE = 'data-opm-theme';
    const APPEARANCE_ATTRIBUTE = 'data-opm-appearance';
    const DSH_DARK_ATTRIBUTE = 'data-ds-dark-theme';
    const THEME_LINK_ID = 'dsh-open-market-theme';
    const themeHref = () => new URL('dsh-open-market/theme/theme.css', document.baseURI).href;
    function syncTheme() {
      const body = document.body;
      if (!body) return;
      const on = getSettings().theme === true;
      let link = document.getElementById(THEME_LINK_ID);
      if (on && !link) {
        link = document.createElement('link');
        link.id = THEME_LINK_ID;
        link.rel = 'stylesheet';
        link.href = themeHref();
        document.head.appendChild(link);
      } else if (!on && link) link.remove();
      if (on) {
        const choice = getSettings().themeAppearance;
        const dark = choice === 'auto' ? body.hasAttribute(DSH_DARK_ATTRIBUTE) : choice === 'dark';
        body.setAttribute(THEME_ATTRIBUTE, '');
        body.setAttribute(APPEARANCE_ATTRIBUTE, dark ? 'dark' : 'light');
      } else {
        body.removeAttribute(THEME_ATTRIBUTE);
        body.removeAttribute(APPEARANCE_ATTRIBUTE);
      }
    }
    // Follows DSH switching between light and dark while the theme is set to follow it.
    function watchDshAppearance() {
      if (typeof MutationObserver !== 'function' || !document.body) return () => {};
      const observer = new MutationObserver(syncTheme);
      observer.observe(document.body, { attributes: true, attributeFilter: [DSH_DARK_ATTRIBUTE] });
      return () => observer.disconnect();
    }
    function removeTheme() {
      document.getElementById?.(THEME_LINK_ID)?.remove();
      document.body?.removeAttribute(THEME_ATTRIBUTE);
      document.body?.removeAttribute(APPEARANCE_ATTRIBUTE);
    }

    const SIDEBAR_PANEL = 'open-market';
    const inject = ['slots', 'locale', 'remote'];

    function apply(ctx) {
      ctx.effect(() => {
        void hydrateProfile();
        return subscribeSettings(countSelfInstall);
      }, 'open-market: count first launch');
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'open-market: dictionaries');
      ctx.effect(() => {
        const style = document.createElement('style');
        style.textContent = STYLES;
        document.head.appendChild(style);
        return () => style.remove();
      }, 'open-market: styles');
      // Follows the setting live, including a value that arrives later from the profile; unloading the plugin removes it.
      ctx.effect(() => {
        syncTheme();
        const off = subscribeSettings(syncTheme);
        const unwatch = watchDshAppearance();
        return () => { off(); unwatch(); removeTheme(); };
      }, 'open-market: theme');
      const t = ctx.locale.bind(NS);
      const getManager = () => pluginManager;
      const resolve = text => ctx.locale.resolveText(text);
      let layout;
      ctx.inject(['layout'], ctx => {
        layout = ctx.layout;
        ctx.effect(() => () => { layout = undefined; }, 'open-market: layout');
      });
      const openPackage = name => openNativePackage(name, {get: () => ctx.get('pluginNavigation'), select: () => layout?.selectPanel('plugins')});
      function SidebarPage() {
        return h('div', { className: 'opm-page' }, h('div', { className: 'opm-page-inner' },
          h('header', { className: 'opm-page-head', 'data-window-drag': true }, h('h1', null, t('title'))),
          h(OpenMarketTab, { t, remote: ctx.remote, manager: getManager, resolve, openPackage, busyLabel: 'installing',
            install: target => installDirectly(getManager, target, t) })));
      }
      function SidebarIcon({ size = 16 }) {
        return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7,
            strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
          h('path', { d: 'M7.5 8C4.5 8.5 2.5 11 3 14c.6 4 4.1 6 8.2 5.5 2.4-.2 4.1-1.4 5.8-3.7L21 18v-8l-4 2.2c-.4-1.9-1.5-3.1-3.3-3.8M9 2.5V5m4-2.5V5M8 5h6v2a3 3 0 0 1-6 0zM10 15c.9 1.1 2.2 1.5 3.5 1.3' }),
          h('circle', {cx: 6.4, cy: 12.4, r: .8, fill: 'currentColor', stroke: 'none'}));
      }
      let removeSidebar;
      function syncSidebar() {
        const preference = getSettings().sidebarMarket;
        const wanted = sidebarHost.supported && sidebarWanted(preference);
        if (wanted && !removeSidebar) {
          readsIndexFile = true;
          const offPanel = ctx.slots.register({ name: 'main', key: SIDEBAR_PANEL, locale: NS }, SidebarPage);
          const offRow = ctx.slots.register({ name: 'sidebar.panellist', id: SIDEBAR_PANEL, order: 1, label: () => t('title'), locale: NS }, SidebarIcon);
          removeSidebar = () => {
            if (layout?.panelInfo.getSnapshot().activePanelId === SIDEBAR_PANEL) layout.selectPanel(null);
            offRow?.();
            offPanel?.();
          };
        } else if (!wanted && removeSidebar) {
          readsIndexFile = false;
          removeSidebar();
          removeSidebar = undefined;
        }
      }
      ctx.effect(() => subscribeSettings(syncSidebar), 'open-market: sidebar setting');
      ctx.effect(() => subscribeSidebarHost(syncSidebar), 'open-market: sidebar host');
      ctx.slots.inject('sidebar.panellist', () => { updateSidebarHost({ supported: true }); });
      ctx.effect(() => {
        return () => {
          removeSidebar?.();
          removeSidebar = undefined;
          readsIndexFile = false;
          sidebarHost = { supported: false };
        };
      }, 'open-market: sidebar page');
      function SettingsSection({ view }) {
        if (view !== 'page') return null;
        return h('div', { className: 'opm-root' }, h(ManagementLauncher, {t, manager: getManager, remote: ctx.remote, resolve, openPackage}),
          h(SettingsGroups, { t, manager: getManager }));
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
      PluginDetails, OtherVersions, countSelfInstall, supportMarket, updateSettings, getLikes, FooterInvite,
      InstalledPanel, ManagementLauncher, Toolbar, managementRows, filterManaged, requestManagement, managementMessage, openNativePackage,
      attachHorizontalDrag, RuntimeOverview, PluginDiagnostics, Tags, featuredPool, railOffset, dailyRandom, Leaderboards, AllPlugins, boardValue,
      hydrateProfile, getProfileStatus, getSettings, getFavorites, writeFavorites, filterCatalog, requestBundleUpdate,
      extractScreenshots, extractVersionNotes, loadScreenshots, loadReleaseNotes, ReleaseNotes, Screenshots, zh, en, styles: STYLES,
      syncTheme, THEME_ATTRIBUTE, THEME_LINK_ID };
    return { apply, inject, internals };
  }
});
