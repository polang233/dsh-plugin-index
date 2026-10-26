import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ensureIndex, ensureMarketBundle, forgetIfTurnedOff, openMarket, outsideReload, INDEX_URL, MARKET_BUNDLE } from './index.js';

function market(urls = []) {
  return {
    urls,
    listIndexes() { return this.urls.map(url => ({ url })); },
    async setIndexes(next) { this.urls = next; }
  };
}

function manager(enabled = false, availability = 'installation', application = 'applied') {
  return {
    calls: [],
    async listBundles() { return [{ name: MARKET_BUNDLE, enabled, availability }]; },
    async setBundleEnabled(name, on) { this.calls.push([name, on]); enabled = on; return { application }; }
  };
}

const services = map => ({ get: name => map[name] });

test('adds the index after existing sources and records the profile marker', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opm-'));
  const fake = market(['https://example.org/index.json']);
  assert.equal(await ensureIndex(fake, { dir }), 'added');
  assert.deepEqual(fake.urls, ['https://example.org/index.json', INDEX_URL]);
  assert.deepEqual(JSON.parse(await readFile(join(dir, '.dsh-open-market.json'), 'utf8')).added, [INDEX_URL]);
});

test('respects a source the user removed after the first setup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opm-'));
  const fake = market();
  await ensureIndex(fake, { dir });
  fake.urls = [];
  assert.equal(await ensureIndex(fake, { dir }), 'skipped');
  assert.deepEqual(fake.urls, []);
});

test('does not duplicate an index that is already configured', async () => {
  const fake = market([INDEX_URL]);
  fake.setIndexes = () => assert.fail('should not rewrite sources');
  assert.equal(await ensureIndex(fake, {}), 'present');
});

test('treats the earlier github.io address as the same index', async () => {
  const fake = market(['https://polang233.github.io/dsh-plugin-index/index.json']);
  fake.setIndexes = () => assert.fail('should not add a second copy');
  assert.equal(await ensureIndex(fake, {}), 'present');
});

test('switches on Custom plugin markets once, then leaves the choice to the user', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opm-'));
  const fake = manager(false);
  assert.equal(await ensureMarketBundle(fake, { dir }), 'enabled');
  assert.deepEqual(fake.calls, [[MARKET_BUNDLE, true]]);
  assert.equal(await ensureMarketBundle(manager(false), { dir }), 'skipped');
});

test('leaves an enabled market bundle alone and records it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opm-'));
  const fake = manager(true);
  assert.equal(await ensureMarketBundle(fake, { dir }), 'on');
  assert.deepEqual(fake.calls, []);
  assert.equal(JSON.parse(await readFile(join(dir, '.dsh-open-market.json'), 'utf8')).marketBundle, true);
});

test('reports a DSH without the market bundle', async () => {
  assert.equal(await ensureMarketBundle(manager(false, 'missing'), {}), 'unavailable');
});

test('/open-market puts back a source the user removed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opm-'));
  const fake = market();
  await ensureIndex(fake, { dir });
  fake.urls = [];
  const result = await openMarket(services({ pluginMarket: fake }), { url: INDEX_URL, dir });
  assert.equal(result.kind, 'success');
  assert.deepEqual(fake.urls, [INDEX_URL]);
});

test('/open-market switches the market bundle back on and clears the removed marker', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opm-'));
  await ensureIndex(market(), { dir });
  await ensureMarketBundle(manager(true), { dir });
  const fake = manager(false);
  const result = await openMarket(services({ pluginManager: fake }), { url: INDEX_URL, dir });
  assert.equal(result.kind, 'success');
  assert.deepEqual(fake.calls, [[MARKET_BUNDLE, true]]);
  assert.equal(await ensureIndex(market(), { dir }), 'added');
});

test('/open-market explains when the bundle is not available', async () => {
  const result = await openMarket(services({ pluginManager: manager(false, 'missing') }), { url: INDEX_URL });
  assert.equal(result.kind, 'error');
});

test('reports a market bundle that takes effect at the next start', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opm-'));
  assert.equal(await ensureMarketBundle(manager(false, 'installation', 'restart-required'), { dir }), 'restart');
  const result = await openMarket(services({ pluginManager: manager(false, 'installation', 'restart-required') }), { url: INDEX_URL, dir });
  assert.match(result.text, /重启 DSH/);
});

function plugins({ rowEnabled = true, bundleEnabled = true } = {}) {
  return {
    async listBundles() { return [{ name: 'dsh-open-market', enabled: bundleEnabled }]; },
    async listPlugins() { return [{ patchId: 'open-market', enabled: rowEnabled }]; }
  };
}

test('switching the plugin off and on again adds a removed index back', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opm-'));
  const fake = market();
  await ensureIndex(fake, { dir });
  fake.urls = [];
  assert.equal(await forgetIfTurnedOff(plugins({ rowEnabled: false }), dir), true);
  assert.equal(await ensureIndex(fake, { dir }), 'added');
  assert.equal(await ensureMarketBundle(manager(true), { dir }), 'on');
});

test('removing the plugin bundle also counts as switching it off', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opm-'));
  await ensureIndex(market(), { dir });
  assert.equal(await forgetIfTurnedOff(plugins({ bundleEnabled: false }), dir), true);
});

test('an unrelated plugin change keeps a removed index removed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opm-'));
  const fake = market();
  await ensureIndex(fake, { dir });
  fake.urls = [];
  assert.equal(await forgetIfTurnedOff(plugins(), dir), false);
  assert.equal(await ensureIndex(fake, { dir }), 'skipped');
});

test('profile writes leave the HMR transaction that loads the plugin', async () => {
  const executing = new AsyncLocalStorage();
  const ctx = services({ hmr: { executing } });
  const inside = await executing.run(true, () => outsideReload(ctx, async () => executing.getStore()));
  assert.equal(inside, undefined);
});

test('profile writes run directly without HMR', async () => {
  assert.equal(await outsideReload(services({}), async () => 'ran'), 'ran');
});

test('only brand-new top-level conversations count as new for Auto review', async () => {
  const { isNewConversation } = await import('./auto-review/index.js');
  const session = (header, firstLiveSeq = 0) => ({ header: { id: 's', isSeeded: false, ...header }, firstLiveSeq });
  assert.equal(isNewConversation(session({})), true);
  assert.equal(isNewConversation(session({}, 12)), false, 'restored from disk');
  assert.equal(isNewConversation(session({ isSeeded: true })), false, 'forked or seeded');
  assert.equal(isNewConversation(session({ origin: 'subagent' })), false, 'delegated child');
  assert.equal(isNewConversation(session({ parentSession: 'p' })), false, 'child of another session');
  assert.equal(isNewConversation(undefined), false);
});

test('Auto review is switched on only when it is shipped and off', async () => {
  const { ensureAutoReviewBundle, AUTO_REVIEW_BUNDLE } = await import('./auto-review/index.js');
  const manager = (bundle, application = 'applied') => {
    const calls = [];
    return { calls, listBundles: async () => bundle ? [bundle] : [], setBundleEnabled: async (...args) => { calls.push(args); return { application }; } };
  };
  const off = manager({ name: AUTO_REVIEW_BUNDLE, enabled: false });
  assert.equal(await ensureAutoReviewBundle(off), 'enabled');
  assert.deepEqual(off.calls, [[AUTO_REVIEW_BUNDLE, true]]);
  assert.equal(await ensureAutoReviewBundle(manager({ name: AUTO_REVIEW_BUNDLE, enabled: false }, 'restart-required')), 'restart');
  const on = manager({ name: AUTO_REVIEW_BUNDLE, enabled: true });
  assert.equal(await ensureAutoReviewBundle(on), 'on');
  assert.deepEqual(on.calls, []);
  assert.equal(await ensureAutoReviewBundle(manager(undefined)), 'unavailable');
  assert.equal(await ensureAutoReviewBundle(manager({ name: AUTO_REVIEW_BUNDLE, availability: 'missing' })), 'unavailable');
});

test('a new conversation switches to Auto review; others keep their preset', async () => {
  const { apply } = await import('./auto-review/index.js');
  const listeners = [];
  const sets = [];
  const ctx = {
    logger: () => ({ warn() {}, info() {} }),
    inject(names, callback) {
      if (names[0] === 'permissionPresets') callback({ ...ctx, permissionPresets: { set: (session, name) => sets.push([session.header.id, name]) } });
    },
    on(event, listener) { if (event === 'session/created') listeners.push(listener); }
  };
  apply(ctx);
  listeners[0]({ header: { id: 'new', isSeeded: false }, firstLiveSeq: 0 });
  listeners[0]({ header: { id: 'old', isSeeded: false }, firstLiveSeq: 5 });
  listeners[0]({ header: { id: 'child', isSeeded: false, origin: 'subagent' }, firstLiveSeq: 0 });
  assert.deepEqual(sets, [['new', 'auto']]);
});
