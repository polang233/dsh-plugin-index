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
