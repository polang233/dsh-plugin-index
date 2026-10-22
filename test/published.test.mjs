import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {checkPublished} from '../scripts/check-published.mjs';

function fixture({wrongIcon = false, pageRows = 1, pluginPage = true} = {}) {
  const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
  const hash = createHash('sha256').update(bytes).digest('hex');
  return async (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers['user-agent'], 'dshopen-check');
    const path = new URL(url).pathname;
    if (path.endsWith('index.json')) return Response.json({format: 1, plugins: [{name: 'example', icon: 'icons/' + hash + '.svg', versions: [{version: '1.0.0', source: {type: 'npm'}}]}]});
    if (path.endsWith('status.json')) return Response.json({packages: [{name: 'example', version: '1.0.0', checks: ['sha512-integrity', 'bundle-patch-present']}]});
    if (path.includes('/icons/')) return new Response(wrongIcon ? 'changed' : bytes, {headers: {'content-type': 'image/svg+xml'}});
    if (path.includes('/plugins/')) return pluginPage ? new Response('<button data-get="example">', {headers: {'content-type': 'text/html'}}) : new Response('Not found', {status: 404});
    return new Response('<img src="assets/logo-256.png">' + '<li data-plugin>'.repeat(pageRows), {headers: {'content-type': 'text/html'}});
  };
}
test('publication check reads the actual icon bytes, every language page and a plugin page', async () => {
  const result = await checkPublished('https://example.org/catalog/index.json', {expectedNames: ['example'], fetchImpl: fixture()});
  assert.equal(result.plugins, 1);
  assert.equal(result.uniqueIcons, 1);
});
test('publication check rejects a stale allowlist or mismatched icon', async () => {
  await assert.rejects(checkPublished('https://example.org/index.json', {expectedNames: ['missing'], fetchImpl: fixture()}), /allowlist/);
  await assert.rejects(checkPublished('https://example.org/index.json', {fetchImpl: fixture({wrongIcon: true})}), /hash mismatch/);
  await assert.rejects(checkPublished('https://example.org/index.json', {fetchImpl: fixture({pageRows: 0})}), /Website/);
  await assert.rejects(checkPublished('https://example.org/index.json', {fetchImpl: fixture({pluginPage: false})}));
});
