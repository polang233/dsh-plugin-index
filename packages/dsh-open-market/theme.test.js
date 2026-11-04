import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createServer} from 'node:http';
import {createThemeAssetsHandler, THEME_FILES, THEME_PATH} from './theme-assets.js';
import {profilePatch} from './profile-state.js';

const source = await readFile(new URL('./client.js', import.meta.url), 'utf8');
const SETTINGS_KEY = 'dsh-open-market:settings';

/** Just enough DOM for the theme: a body with attributes and a head that holds the stylesheet link. */
function fakeDocument() {
  const nodes = new Map();
  const head = {
    children: [],
    appendChild(node) { this.children.push(node); node.parent = this; if (node.id) nodes.set(node.id, node); return node; }
  };
  const create = tag => ({
    tagName: tag.toUpperCase(), id: '', rel: '', href: '',
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); nodes.delete(this.id); this.parent = undefined; }
  });
  const attributes = new Map();
  return {
    baseURI: 'http://127.0.0.1:4100/',
    head,
    body: {
      setAttribute: (name, value) => attributes.set(name, String(value)),
      removeAttribute: name => attributes.delete(name),
      hasAttribute: name => attributes.has(name)
    },
    createElement: create,
    getElementById: id => nodes.get(id) ?? null
  };
}

async function client({stored = new Map(), profileState = {schema: 1}, document = fakeDocument()} = {}) {
  let plugin;
  const requests = [];
  const window = {
    localStorage: {getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value)},
    setTimeout: () => 0, clearTimeout() {},
    __ModuleLoader__: {load: module => { plugin = module.factory(name => {
      if (name === 'react') return {createElement() {}};
      throw new Error('Optional module unavailable: ' + name);
    }); }}
  };
  runInNewContext(source, {
    window, document, URL, crypto, AbortSignal, AbortController, TextDecoder, atob, Date,
    fetch: async (url, options) => {
      if (url !== '/dsh-open-market/state') return {ok: false, json: async () => ({})};
      const {patch, initialize} = JSON.parse(options.body);
      requests.push(patch);
      for (const [key, value] of Object.entries(patch)) {
        if (initialize && Object.hasOwn(profileState, key)) continue;
        profileState[key] = key === 'settings' ? {...profileState.settings, ...value} : value;
      }
      return {ok: true, json: async () => ({ok: true, state: JSON.parse(JSON.stringify(profileState))})};
    }
  });
  return {plugin, document, stored, requests, profileState};
}

/** Runs apply() with a context that records effects, so the test can unload the plugin like DSH does. */
function start(plugin) {
  const disposers = [];
  plugin.apply({
    remote: {},
    locale: {register: () => () => {}, bind: () => key => key, resolveText: text => text},
    effect: setup => { const dispose = setup(); if (typeof dispose === 'function') disposers.push(dispose); },
    inject() {},
    slots: {inject() {}, register: () => () => {}}
  });
  return () => disposers.reverse().forEach(dispose => dispose());
}

const themed = document => document.body.hasAttribute('data-opm-theme');
const link = document => document.getElementById('dsh-open-market-theme');
const links = document => document.head.children.filter(node => node.tagName === 'LINK').length;

test('the theme is off by default and adds nothing to the page', async () => {
  const {plugin, document} = await client();
  assert.equal(plugin.internals.getSettings().theme, false);
  start(plugin);
  assert.equal(themed(document), false);
  assert.equal(link(document), null);
  assert.equal(links(document), 0);
});

test('switching the theme on and off applies and removes it without a reload', async () => {
  const {plugin, document, stored} = await client();
  start(plugin);
  const {updateSettings} = plugin.internals;
  updateSettings('theme', true);
  assert.equal(themed(document), true);
  assert.equal(link(document).rel, 'stylesheet');
  assert.equal(link(document).href, 'http://127.0.0.1:4100/dsh-open-market/theme/theme.css');
  assert.equal(JSON.parse(stored.get(SETTINGS_KEY)).theme, true);
  updateSettings('theme', true);
  assert.equal(links(document), 1, 'Switching on twice links the stylesheet once');
  updateSettings('theme', false);
  assert.equal(themed(document), false);
  assert.equal(link(document), null);
  assert.equal(links(document), 0);
  assert.equal(JSON.parse(stored.get(SETTINGS_KEY)).theme, false);
});

test('the theme setting persists in the browser cache and the DSH profile', async () => {
  const first = await client();
  start(first.plugin);
  await first.plugin.internals.hydrateProfile();
  first.plugin.internals.updateSettings('theme', true);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(first.profileState.settings.theme, true, 'Saved to the profile');
  assert.ok(first.requests.some(patch => patch.settings?.theme === true));

  // The next start reads the browser cache and applies the theme before the profile answers.
  const next = await client({stored: first.stored, profileState: first.profileState});
  start(next.plugin);
  assert.equal(themed(next.document), true);
  assert.ok(link(next.document));

  // Another browser without a cache follows the profile once it loads.
  const other = await client({profileState: first.profileState});
  start(other.plugin);
  assert.equal(themed(other.document), false);
  await other.plugin.internals.hydrateProfile();
  assert.equal(themed(other.document), true);
});

test('unloading the plugin removes the theme', async () => {
  const stored = new Map([[SETTINGS_KEY, JSON.stringify({theme: true})]]);
  const {plugin, document} = await client({stored});
  const unload = start(plugin);
  assert.equal(themed(document), true);
  unload();
  assert.equal(themed(document), false);
  assert.equal(link(document), null);
  plugin.internals.updateSettings('theme', false);
  plugin.internals.updateSettings('theme', true);
  assert.equal(themed(document), false, 'An unloaded plugin no longer follows the setting');
});

test('a malformed theme value falls back to off', async () => {
  const stored = new Map([[SETTINGS_KEY, JSON.stringify({theme: 'yes'})]]);
  const {plugin, document} = await client({stored});
  start(plugin);
  assert.equal(plugin.internals.getSettings().theme, false);
  assert.equal(themed(document), false);
});

test('profile preferences accept only a boolean theme', () => {
  assert.deepEqual(profilePatch({settings: {theme: true}}), {settings: {theme: true}});
  assert.throws(() => profilePatch({settings: {theme: 'on'}}));
});

test('the Host serves only the shipped theme files', async () => {
  const server = createServer(createThemeAssetsHandler());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}${THEME_PATH}/`;
  try {
    const css = await fetch(base + 'theme.css');
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /^text\/css/);
    assert.equal(css.headers.get('x-content-type-options'), 'nosniff');
    assert.match(await css.text(), /body\[data-opm-theme\]/);
    const art = await fetch(base + 'whale-maid-wave.webp');
    assert.equal(art.headers.get('content-type'), 'image/webp');
    assert.equal(Buffer.from(await art.arrayBuffer()).subarray(8, 12).toString(), 'WEBP');
    for (const path of ['originals/whale-maid-wave.png', '..%2Ftheme-assets.js', '%2e%2e/index.js', 'missing.webp', ''])
      assert.equal((await fetch(base + path)).status, 404, path);
    assert.equal((await fetch(base + 'theme.css', {method: 'POST'})).status, 405);
    assert.equal((await fetch(base + 'theme.css', {method: 'HEAD'})).status, 200);
  } finally { server.close(); }
});

test('every theme rule is scoped to the theme attribute and its artwork ships with the package', async () => {
  const css = (await readFile(new URL('./theme/theme.css', import.meta.url), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [];
  // Collect selectors of style rules, stepping into @media blocks.
  for (const match of css.matchAll(/([^{}]+)\{/g)) {
    const prelude = match[1].trim();
    if (prelude.startsWith('@')) continue;
    // Split on commas outside :is() and :has().
    let depth = 0, current = '';
    for (const char of prelude) {
      if (char === ',' && !depth) { selectors.push(current.trim()); current = ''; continue; }
      depth += char === '(' ? 1 : char === ')' ? -1 : 0;
      current += char;
    }
    selectors.push(current.trim());
  }
  assert.ok(selectors.length > 40);
  for (const selector of selectors) assert.match(selector, /^body\[data-opm-theme\]/, selector);
  assert.doesNotMatch(css, /!important/, 'The theme never overrides user or DSH accessibility styles by force');
  assert.doesNotMatch(css, /@import|https?:\/\//, 'The theme loads nothing from the network');

  const urls = [...css.matchAll(/url\("([^"]+)"\)/g)].map(match => match[1]);
  assert.ok(urls.length >= 3);
  for (const file of urls) assert.ok(THEME_FILES.includes(file), file + ' is served');
  for (const file of THEME_FILES) await access(new URL('./theme/' + file, import.meta.url));

  const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
  for (const entry of ['theme-assets.js', 'theme/theme.css', 'theme/*.webp']) assert.ok(pkg.files.includes(entry), entry);
});
