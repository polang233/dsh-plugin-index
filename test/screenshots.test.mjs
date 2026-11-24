import test from 'node:test';
import assert from 'node:assert/strict';
import {validateScreenshots, applyPluginPreviews, collectRepositoryPreviews, packagePreviews, PACKAGE_SCREENSHOTS, websiteScreenshots} from '../scripts/screenshots.mjs';
import {applyMarketDisplay} from '../scripts/market-display.mjs';

test('author screenshots reach the display catalog without changing the official index', () => {
  const screenshots = validateScreenshots([{url: 'https://raw.githubusercontent.com/a/b/abc/docs/screenshot.png', alt: 'Task list'}]);
  const plugin = {name: 'demo', versions: [{version: '1.0.0', publishTimestamp: 1, source: {type: 'npm'}}]};
  const market = applyMarketDisplay({format: 1, title: 'Market', plugins: [plugin]});
  const before = JSON.stringify(market.index);
  const display = applyPluginPreviews(market.display, {schema: 1, plugins: {demo: {screenshots}}});
  assert.deepEqual(display.plugins.demo.screenshots, screenshots);
  assert.equal(market.index.plugins[0].screenshots, undefined);
  assert.equal(JSON.stringify(market.index), before);
  assert.equal(market.display.plugins.demo.screenshots, undefined);
  assert.deepEqual(validateScreenshots([]), []);
  assert.equal(validateScreenshots(undefined), undefined);
});

test('preview overrides can disable README guesses and do not invent absent catalog entries', () => {
  const source = {schema: 1, plugins: {demo: {description: {en: 'Description'}}}};
  const result = applyPluginPreviews(source, {schema: 1, plugins: {demo: {screenshots: []}, absent: {screenshots: []}}});
  assert.deepEqual(result.plugins.demo.screenshots, []);
  assert.equal(result.plugins.absent, undefined);
  assert.equal(source.plugins.demo.screenshots, undefined);
  for (const value of [{schema: 2, plugins: {}}, {schema: 1, plugins: []}, {schema: 1, plugins: {demo: {}}}, {schema: 1, plugins: {demo: {screenshots: [], description: 'invalid'}}}]) {
    assert.throws(() => applyPluginPreviews(source, value), /Invalid plugin preview/);
  }
});

test('submitted screenshots reject credentials, non-GitHub hosts, active files and excessive counts', () => {
  for (const url of ['http://github.com/a.png', 'https://user:secret@github.com/a.png', 'https://tracker.example/a.png', 'https://github.com/a.svg', 'javascript:alert(1)']) {
    assert.throws(() => validateScreenshots([{url, alt: 'Preview'}]));
  }
  assert.throws(() => validateScreenshots(Array(7).fill({url: 'https://github.com/a.png', alt: 'Preview'})));
  assert.throws(() => validateScreenshots([{url: 'https://github.com/a.png', alt: ''}]));
});

test('removing a preview override clears previously published screenshots', () => {
  const screenshots = [{url: 'https://github.com/a/b/raw/abc/screenshot.png', alt: 'Old preview'}];
  const source = {schema: 1, plugins: {demo: {description: {en: 'Description'}, screenshots}}};
  const result = applyPluginPreviews(source, {schema: 1, plugins: {}});
  assert.equal(result.plugins.demo.screenshots, undefined);
  assert.deepEqual(result.plugins.demo.description, source.plugins.demo.description);
  assert.deepEqual(source.plugins.demo.screenshots, screenshots);
});

test('repository preview lookup preserves the Git ref, package directory, overrides and cache', async () => {
  const commit = 'a'.repeat(40);
  const root = `https://raw.githubusercontent.com/owner/project/${commit}/`;
  const base = root + 'packages/tools/';
  const git = {type: 'git', url: 'https://github.com/owner/project', commit, path: 'packages/tools'};
  const plugin = {name: 'demo', versions: [{source: git}]};
  const index = {plugins: [plugin, {...plugin, name: 'another'}, {...plugin, name: 'curated'}, {...plugin, name: 'from-package'}]};
  const evidence = {packages: [{name: 'from-package', display: {screenshots: [{url: base + 'a.png', alt: ''}]}}]};
  const curated = {plugins: {curated: {screenshots: []}}};
  const now = Date.parse('2026-11-24T00:00:00Z');
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push([options.method ?? 'GET', url]);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers, undefined);
    if (options.method === 'HEAD') return new Response(null, {status: url.endsWith('gone.png') ? 404 : 200});
    return url.endsWith('README.md')
      ? new Response('## 界面预览\n![First](./a.png)\n<img src="/b.webp" alt="Second">\n![Duplicate](./a.png)\n![Logo](./logo.png)\n<img src="./small.png" width="75">\n<!-- ![Hidden](./comment.png) -->\n![Gone](./gone.png)\n![Outside](../../../outside.png)')
      : new Response(null, {status: 404});
  };
  const {previews, failed} = await collectRepositoryPreviews(index, evidence, curated, {}, {now, fetchImpl});
  assert.equal(failed, 0);
  assert.deepEqual(calls, [
    ['GET', base + 'screenshots.json'], ['GET', base + 'README.md'],
    ['HEAD', base + 'a.png'], ['HEAD', root + 'b.webp'], ['HEAD', base + 'gone.png']
  ]);
  assert.deepEqual(previews.demo.screenshots, [{url: base + 'a.png', alt: 'First'}, {url: root + 'b.webp', alt: 'Second'}]);
  assert.deepEqual(previews.demo, previews.another);
  assert.equal(previews.curated, undefined);
  assert.equal(previews['from-package'], undefined);
  const cached = await collectRepositoryPreviews(index, evidence, curated, previews, {now: now + 60_000, fetchImpl: async () => assert.fail('Fresh metadata needs no request')});
  assert.deepEqual(cached, {previews, failed: 0});
  const stale = await collectRepositoryPreviews(index, evidence, curated, previews, {now: now + 90_000_000, fetchImpl: async () => new Response(null, {status: 503})});
  assert.deepEqual(stale, {previews, failed: 1});
  const packageImages = packagePreviews(new Map([[PACKAGE_SCREENSHOTS, Buffer.from('["./docs/a.png"]')]]), new Set(['package/docs/a.png']), 'demo', '1.0.0', git);
  assert.deepEqual(packageImages, {screenshots: [{url: base + 'docs/a.png', alt: ''}]});
});

test('a source screenshot list takes precedence over README discovery and renders site-only', async () => {
  const url = 'https://raw.githubusercontent.com/owner/project/HEAD/screenshots.json';
  const index = {plugins: [{name: 'demo', repository: {url: 'https://github.com/owner/project'}, versions: [{source: {type: 'npm'}}]}]};
  const display = {plugins: {demo: {}}};
  const result = await collectRepositoryPreviews(index, {}, display, {}, {fetchImpl: async (request, options) => {
    if (options.method === 'HEAD') {
      assert.equal(request, new URL('docs/first.png', url).href);
      return new Response(null, {status: 200});
    }
    assert.equal(request, url);
    return Response.json(['docs/first.png', {url: 'https://github.com/user-attachments/assets/example', alt: 'Panel'}, 'data:image/png;base64,x']);
  }});
  const evidence = {repositoryPreviews: result.previews};
  assert.deepEqual(websiteScreenshots(evidence, display)('demo'), [
    {url: new URL('docs/first.png', url).href, alt: ''},
    {url: 'https://github.com/user-attachments/assets/example', alt: 'Panel'}
  ]);
  assert.equal(display.plugins.demo.screenshots, undefined);
  assert.deepEqual(websiteScreenshots(evidence, {plugins: {demo: {screenshots: []}}})('demo'), []);
});

test('the published README supplies packaged images when the repository has no preview', () => {
  const readme = 'package/README.md';
  const contents = new Map([
    [readme, Buffer.from('## Screenshots\n![Packaged panel][Panel image]\n![Missing panel](./docs/missing.png)\n\n[panel image]:\n  ./docs/a.png "Screenshot"')],
    [PACKAGE_SCREENSHOTS, Buffer.from('[]')]
  ]);
  const display = packagePreviews(contents, new Set(['package/docs/a.png']), 'demo', '1.0.0', {type: 'npm'}, readme);
  const evidence = {packages: [{name: 'demo', display}], repositoryPreviews: {demo: {screenshots: []}}};
  assert.deepEqual(websiteScreenshots(evidence, {})('demo'), [
    {url: 'https://cdn.jsdelivr.net/npm/demo@1.0.0/docs/a.png', alt: 'Packaged panel'}
  ]);
});

test('a repository root README cannot supply screenshots owned by a sibling plugin', async () => {
  const root = 'https://raw.githubusercontent.com/owner/project/HEAD/';
  const demoImage = 'https://raw.githubusercontent.com/owner/project/main/plugins/demo/preview.png';
  const index = {plugins: [{
    name: 'demo', repository: {url: 'https://github.com/owner/project', directory: 'plugins/demo'}, versions: [{source: {type: 'npm'}}]
  }]};
  const {previews} = await collectRepositoryPreviews(index, {}, {plugins: {}}, {}, {fetchImpl: async (url, options) => {
    if (options.method === 'HEAD') {
      assert.equal(url, demoImage);
      return new Response(null);
    }
    if (url === root + 'README.md') return new Response('## Screenshots\n![Other plugin](plugins/other/preview.png)');
    if (url === root + 'docs/README.md') return new Response('## Screenshots\n![Demo panel](https://github.com/owner/project/blob/main/plugins/demo/preview.png)');
    return new Response(null, {status: 404});
  }});
  assert.deepEqual(previews.demo.screenshots, [{url: demoImage, alt: 'Demo panel'}]);
});
