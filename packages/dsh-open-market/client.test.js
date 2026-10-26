import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

async function client() {
  let plugin;
  const window = {
    localStorage: {getItem: () => null, setItem() {}},
    __ModuleLoader__: {load: module => {
      plugin = module.factory(name => {
        if (name === 'react') return {createElement() {}};
        throw new Error('Optional module unavailable: ' + name);
      });
    }}
  };
  runInNewContext(await readFile(new URL('./client.js', import.meta.url), 'utf8'), {
    window, URL, document: {createElement: () => ({remove() {}}), head: {appendChild() {}}}
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
