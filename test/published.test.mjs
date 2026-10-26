import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cp, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {checkPublished} from '../scripts/check-published.mjs';

test('deployment verification starts from a checkout without installed dependencies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-published-'));
  try {
    await cp(new URL('../scripts/', import.meta.url), join(directory, 'scripts'), {recursive: true});
    const checker = pathToFileURL(join(directory, 'scripts/check-published.mjs')).href;
    execFileSync(process.execPath, ['--input-type=module', '--eval', `await import(${JSON.stringify(checker)})`], {stdio: 'pipe'});
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

function fixture({wrongIcon = false, pageRows = 1, restRows, pluginPage = true, name = 'example'} = {}) {
  const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
  const hash = createHash('sha256').update(bytes).digest('hex');
  return async (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['user-agent'], 'dshopen-check');
    const path = new URL(url).pathname;
    if (path.endsWith('index.json')) return Response.json({format: 1, plugins: [{name, icon: 'icons/' + hash + '.svg', versions: [{version: '1.0.0', source: {type: 'npm'}}]}]});
    if (path.endsWith('status.json')) return Response.json({packages: [{name, version: '1.0.0', checks: ['sha512-integrity', 'bundle-patch-present']}]});
    if (path.includes('/icons/')) return new Response(wrongIcon ? 'changed' : bytes, {headers: {'content-type': 'image/svg+xml'}});
    if (path.endsWith('/catalog.json')) return Response.json({html: '<li data-plugin>'.repeat(restRows ?? 0)});
    if (path.includes('/plugins/')) return pluginPage ? new Response(`<button data-get="${name}">`, {headers: {'content-type': 'text/html'}}) : new Response('Not found', {status: 404});
    const rest = restRows === undefined ? '' : '<ul data-rest="catalog.json?v=1&amp;x=2">';
    return new Response('<img src="assets/mark-256.png">' + rest + '<li data-plugin>'.repeat(pageRows), {headers: {'content-type': 'text/html'}});
  };
}
test('publication check reads the actual icon bytes, every language page and a plugin page', async () => {
  const result = await checkPublished('https://example.org/catalog/index.json', {expectedNames: ['example'], fetchImpl: fixture()});
  assert.equal(result.plugins, 1);
  assert.equal(result.uniqueIcons, 1);
});
test('scoped plugin pages use the encoded Cloudflare URL in every language', async () => {
  const fetchPage = fixture({name: '@scope/example'});
  const paths = [];
  await checkPublished('https://example.org/catalog/index.json', {fetchImpl: async (url, options) => {
    const path = new URL(url).pathname;
    if (path.includes('/plugins/')) {
      // Cloudflare redirects literal @ to %40, which redirect: error rejects.
      assert.ok(!path.includes('@'), 'Scoped page URL would redirect');
      paths.push(path);
    }
    return fetchPage(url, options);
  }});
  assert.deepEqual(paths, [
    '/catalog/plugins/%40scope/example/',
    '/catalog/zh/plugins/%40scope/example/',
    '/catalog/zh-tw/plugins/%40scope/example/'
  ]);
});
test('publication check rejects a stale allowlist or mismatched icon', async () => {
  await assert.rejects(checkPublished('https://example.org/index.json', {expectedNames: ['missing'], fetchImpl: fixture()}), /allowlist/);
  await assert.rejects(checkPublished('https://example.org/index.json', {fetchImpl: fixture({wrongIcon: true})}), /hash mismatch/);
  await assert.rejects(checkPublished('https://example.org/index.json', {fetchImpl: fixture({pageRows: 0})}), /Website/);
  await assert.rejects(checkPublished('https://example.org/index.json', {fetchImpl: fixture({pluginPage: false})}));
});
test('the directory may keep later cards in the catalog file the page names', async () => {
  const result = await checkPublished('https://example.org/index.json', {fetchImpl: fixture({pageRows: 0, restRows: 1})});
  assert.equal(result.plugins, 1);
  await assert.rejects(checkPublished('https://example.org/index.json', {fetchImpl: fixture({pageRows: 1, restRows: 1})}), /Website/);
});
