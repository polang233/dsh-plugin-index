import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync, gunzipSync } from 'node:zlib';
import { Pax } from 'tar';
import { createHash } from 'node:crypto';
import { buildIndex, checkBundle, collectPackage, download, dshEngines, inspectArchive, repositoryFrom, resolveRepository, verifyIntegrity } from '../scripts/lib.mjs';
import { marketInstallTarget, parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index';
import { archiveBudget, DEFAULT_ARCHIVE_BYTES, MAX_ARCHIVE_BYTES } from '../scripts/limits.mjs';

function archive(entries) {
  const chunks = [];
  for (const [name, value, type = '0'] of entries) {
    const data = Buffer.from(value);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write('0000644\0', 100, 8);
    header.write('0000000\0', 108, 8);
    header.write('0000000\0', 116, 8);
    header.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 12);
    header.write('00000000000\0', 136, 12);
    header.fill(32, 148, 156);
    header.write(type, 156);
    header.write('ustar\0', 257, 6);
    header.write('00', 263, 2);
    const checksum = header.reduce((sum, value) => sum + value, 0);
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
    chunks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
function fixture({ patch = true, integrity = true, version = '1.2.3', manifestFields = {}, extraFiles = [] } = {}) {
  const manifest = { name: '@example/dsh-plugin', version, dsh: { bundle: { patch: './cordis.patch.yml' } }, main: 'lib/index.js', peerDependencies: { '@deepseek-ai/dsh': '>=0.2.0 <0.3.0' }, ...manifestFields };
  const entries = [['package/package.json', JSON.stringify(manifest)], ['package/lib/index.js', 'throw new Error("This must never execute");']];
  if (patch) entries.push(['package/cordis.patch.yml', '- id: example']);
  entries.push(...extraFiles.map(([path, value]) => ['package/' + path, value]));
  const bytes = archive(entries);
  const metadata = { 'dist-tags': { latest: manifest.version }, time: { [version]: '2026-01-01T00:00:00Z' }, versions: { [version]: { ...manifest, dist: { tarball: 'https://registry.npmjs.org/@example/plugin.tgz', integrity: integrity ? `sha512-${createHash('sha512').update(bytes).digest('base64')}` : 'sha512-invalid' } } } };
  return { manifest, fetchImpl: async (url, opts) => {
    assert.equal(opts.redirect, 'error');
    return new Response(url.endsWith('.tgz') ? bytes : JSON.stringify(metadata), { status: 200 });
  } };
}
const config = { title: { en: 'Test', zh: '测试' }, description: 'Fixture index', packages: [{ name: '@example/dsh-plugin' }] };

test('real archive shape produces an official-format index and exact install target', async () => {
  const result = await buildIndex(config, { ...fixture(), now: Date.parse('2026-02-01') });
  const parsed = parseMarketIndex(result.index, 'https://example.org/index.json');
  assert.equal(parsed.plugins[0].versions[0].publishTimestamp, 1767225600);
  assert.equal(marketInstallTarget(parsed.plugins[0].name, parsed.plugins[0].versions[0]).spec, '@example/dsh-plugin@1.2.3');
  assert.equal(result.evidence.packages[0].checks.includes('bundle-patch-present'), true);
  assert.ok(parsed.plugins[0].versions[0].engines.dsh);
});
test('rejects a tampered tarball', async () => {
  await assert.rejects(collectPackage(config.packages[0], fixture({ integrity: false })), /integrity/);
  assert.throws(() => verifyIntegrity(Buffer.from('x'), undefined), /integrity/);
});
test('missing bundle patch prevents publication', async () => {
  await assert.rejects(buildIndex(config, fixture({ patch: false })), /Cannot publish index.*missing/);
});
test('duplicate names and empty sources cannot publish', async () => {
  await assert.rejects(buildIndex({ ...config, packages: [] }), /nonempty/);
  await assert.rejects(buildIndex({ ...config, packages: [...config.packages, ...config.packages] }, fixture()), /duplicates/);
});
test('external tarball URLs are rejected before a request', async () => {
  await assert.rejects(download('https://example.org/plugin.tgz', { fetchImpl: () => assert.fail('must not fetch') }), /public npm registry/);
});
test('compatibility preserves OR intersections and rejects incompatible peers', () => {
  assert.equal(dshEngines({ engines: { dsh: '*' } }).dsh, undefined);
  assert.equal(dshEngines({ peerDependencies: { '@deepseek-ai/dsh': 'workspace:^' } }).dsh, undefined);
  const result = dshEngines({ peerDependencies: { '@deepseek-ai/dsh': '^0.2.0 || ^0.3.0', '@deepseek-ai/dsh-core': '>=0.3.2 <0.4.0' } });
  assert.match(result.dsh, />=0.3.2/);
  assert.throws(() => dshEngines({ peerDependencies: { '@deepseek-ai/dsh': '<0.2.0', '@deepseek-ai/dsh-core': '>=0.3.0' } }), /intersection/);
  assert.throws(() => dshEngines({ engines: { dsh: 'workspace:*' } }), /Invalid/);
});
test('multiple patch files are checked and archive identity cannot drift', () => {
  const manifest = { name: 'test', version: '1.0.0', dsh: { bundle: { patch: ['a.yml', 'b.yml'] } } };
  assert.equal(checkBundle(manifest, new Set(['package/a.yml', 'package/b.yml']), 'test', '1.0.0').length, 2);
  assert.throws(() => checkBundle(manifest, new Set(['package/a.yml']), 'test', '1.0.0'), /missing/);
  assert.throws(() => checkBundle(manifest, new Set(), 'other', '1.0.0'), /identity/);
});

test('a missing client build prevents publication even when the host and patch are present', async () => {
  const client = fixture({ manifestFields: {
    exports: { '.': './lib/index.js', './client': './lib/client.js' },
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } }
  } });
  await assert.rejects(buildIndex(config, client), /Client entry.*lib\/client\.js.*missing/);
});

test('client runtime exports support conditions and patterns without requiring declaration files', async () => {
  for (const exports of [
    { './client': { types: './lib/client.d.ts', import: './lib/client.js', default: './lib/client.js' } },
    { './*': './lib/*.js' }
  ]) {
    const result = await collectPackage(config.packages[0], fixture({
      manifestFields: { exports, dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } } },
      extraFiles: [['lib/client.js', 'throw new Error("Client code must never execute");']]
    }));
    assert.deepEqual(result.evidence.clientEntries, ['package/lib/client.js']);
    assert.ok(result.evidence.checks.includes('client-entry-present'));
  }
});

test('client checks reject missing conditional files, blocked exports and unsafe paths', () => {
  const manifest = { name: 'test', version: '1.0.0', dsh: { bundle: { patch: 'patch.yml' }, client: { platform: 'web' } } };
  const files = new Set(['package/patch.yml', 'package/client.js']);
  for (const target of [
    { import: './client.js', require: './missing.cjs' },
    { types: './client.d.ts' },
    null,
    '../client.js',
    './x/../../client.js'
  ]) assert.throws(() => checkBundle({ ...manifest, exports: { './client': target } }, files, 'test', '1.0.0'), /Client entry|Invalid package file/);
  // An explicit null export is allowed when no browser half is declared.
  assert.doesNotThrow(() => checkBundle({ ...manifest, dsh: { bundle: { patch: 'patch.yml' } }, exports: { './client': null } }, files, 'test', '1.0.0'));
});

test('legacy client subpaths are checked only when the manifest declares a client', () => {
  const manifest = { name: 'test', version: '1.0.0', dsh: { bundle: { patch: 'patch.yml' }, client: { platform: 'web' } } };
  const files = new Set(['package/patch.yml']);
  assert.throws(() => checkBundle(manifest, files, 'test', '1.0.0'), /Client entry.*missing/);
  files.add('package/client.js');
  assert.doesNotThrow(() => checkBundle(manifest, files, 'test', '1.0.0'));
  assert.throws(() => checkBundle({ ...manifest, exports: { '.': './host.js' } }, files, 'test', '1.0.0'), /Client entry.*export/);
  assert.doesNotThrow(() => checkBundle({ ...manifest, dsh: { bundle: { patch: 'patch.yml' } } }, new Set(['package/patch.yml']), 'test', '1.0.0'));
  assert.doesNotThrow(() => checkBundle({ ...manifest, dsh: { bundle: { patch: 'patch.yml' } }, exports: { './*': './lib/*.js' } }, new Set(['package/patch.yml']), 'test', '1.0.0'));
});
test('unsafe and duplicate archive paths reject cleanly', async () => {
  await assert.rejects(inspectArchive(archive([['package/../bad', 'x']])), /Unexpected|abort/);
  await assert.rejects(inspectArchive(archive([['package/package.json', '{}'], ['package/package.json', '{}']])), /Duplicate|abort/);
});
test('build metadata remains an exact installable version; prefixes are rejected', async () => {
  const { index } = await buildIndex(config, fixture({ version: '1.2.3+build.4' }));
  assert.equal(index.plugins[0].versions[0].version, '1.2.3+build.4');
  await assert.rejects(buildIndex(config, fixture({ version: 'v1.2.3' })), /exact valid/);
});
test('explicit DSH range retains wildcard and prerelease semantics', () => {
  assert.deepEqual(dshEngines({ engines: { dsh: ' 0.2.x ' } }), { dsh: '0.2.x' });
});
test('bilingual editorial descriptions and categories survive official validation', async () => {
  const catalog = { ...config, metadata: { categories: { tools: { title: { en: 'Tools', zh: '工具' } } } }, packages: [{ ...config.packages[0], title: { en: 'Example', zh: '示例' }, description: { en: 'A useful tool.', zh: '一个工具。' }, category: 'tools' }] };
  const { index } = await buildIndex(catalog, fixture());
  const entry = parseMarketIndex(index, 'https://example.org/index.json').plugins[0];
  assert.equal(entry.title.zh, '示例');
  assert.equal(entry.metadata.category, 'tools');
  await assert.rejects(buildIndex({ ...catalog, metadata: {} }, fixture()), /undeclared/);
});
test('temporary HTTP failures retry but missing packages fail immediately', async () => {
  let calls = 0;
  const bytes = await download('https://registry.npmjs.org/test', { retryDelayMs: 0, fetchImpl: async () => ++calls < 3 ? new Response('busy', { status: 503 }) : new Response('ok') });
  assert.equal(bytes.toString(), 'ok');
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(download('https://registry.npmjs.org/test', { retryDelayMs: 0, fetchImpl: async () => { calls++; return new Response('missing', { status: 404 }); } }), /404/);
  assert.equal(calls, 1);
});
test('with a previous snapshot, a transient failure keeps the last release and a vanished package is left out', async () => {
  const good = fixture();
  const iconBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
  const icon = `icons/${createHash('sha256').update(iconBytes).digest('hex')}.svg`;
  const flaky = { name: '@example/flaky', icon, versions: [{ version: '0.9.0', publishTimestamp: 1767225600, source: { type: 'npm' } }] };
  const previous = {
    base: 'https://example.org/catalog/',
    index: { plugins: [flaky] },
    evidence: { packages: [{ name: '@example/flaky', version: '0.9.0' }], failures: [{ name: '@example/flaky', since: '2026-01-01T00:00:00.000Z' }] }
  };
  const fetchImpl = async (url, options) => {
    if (String(url) === previous.base + icon) return new Response(iconBytes);
    if (String(url).includes('flaky')) throw new Error('The operation was aborted due to timeout');
    if (String(url).includes('gone')) return new Response('missing', { status: 404 });
    return good.fetchImpl(url, options);
  };
  const catalog = { ...config, packages: [{ name: '@example/dsh-plugin' }, { name: '@example/flaky' }, { name: '@example/gone' }] };
  const { index, evidence, assets } = await buildIndex(catalog, { fetchImpl, retryDelayMs: 0, previous, now: Date.parse('2026-02-01') });
  assert.deepEqual(index.plugins.map(plugin => plugin.name), ['@example/dsh-plugin', '@example/flaky']);
  assert.deepEqual(index.plugins[1], flaky);
  assert.ok(assets.some(asset => asset.path === icon));
  assert.deepEqual(evidence.failures.map(({ name, retained, since }) => ({ name, retained, since })), [
    { name: '@example/flaky', retained: true, since: '2026-01-01T00:00:00.000Z' },
    { name: '@example/gone', retained: false, since: '2026-02-01T00:00:00.000Z' }
  ]);
  await assert.rejects(buildIndex(catalog, { fetchImpl, retryDelayMs: 0, previous, maxFailures: 1 }), /2 packages failed, more than 1/);
  await assert.rejects(buildIndex(catalog, { fetchImpl, retryDelayMs: 0 }), /Cannot publish index/);
});
test('source policy prevents a package without repository and license from publishing', async () => {
  await assert.rejects(buildIndex({ ...config, requireSourceMetadata: true }, fixture()), /repository and declared license/);
});
test('repository metadata preserves package directories and strips git transport details', () => {
  assert.deepEqual(repositoryFrom({ repository: { url: 'git+https://github.com/example/plugin.git#main', directory: 'packages/plugin' } }), { url: 'https://github.com/example/plugin', directory: 'packages/plugin' });
  assert.equal(repositoryFrom({ repository: 'github:example/plugin' }).url, 'https://github.com/example/plugin');
  assert.equal(repositoryFrom({ repository: 'file:///private/path' }), undefined);
});
test('single peer ranges retain wildcard and prerelease semantics', () => {
  assert.deepEqual(dshEngines({ peerDependencies: { '@deepseek-ai/dsh': '0.2.x' } }), { dsh: '0.2.x' });
  assert.doesNotThrow(() => dshEngines({ peerDependencies: { '@deepseek-ai/dsh': '0.2.x', '@deepseek-ai/dsh-core': '>=0.2.0-rc.1 <0.2.0' } }));
});
test('reviewed repositories are tied to an exact release, integrity and source commit', () => {
  const review = { version: '1.2.3', url: 'https://github.com/example/plugin', commit: 'a'.repeat(40), integrity: 'sha512-fixture' };
  const input = { version: '1.2.3', repositoryReview: review };
  const result = resolveRepository({}, input, '1.2.3', 'sha512-fixture');
  assert.equal(result.provenance, 'review');
  assert.equal(result.repository.url, review.url);
  assert.equal(result.review.evidence, `${review.url}/blob/${review.commit}/package.json`);
  assert.throws(() => resolveRepository({}, { repositoryReview: review }, '1.2.3', 'sha512-fixture'), /pinned/);
  assert.throws(() => resolveRepository({}, input, '1.2.4', 'sha512-fixture'), /pinned/);
  assert.throws(() => resolveRepository({}, input, '1.2.3', 'sha512-changed'), /integrity/);
  assert.throws(() => resolveRepository({ repository: 'https://github.com/other/plugin' }, input, '1.2.3', 'sha512-fixture'), /conflicts/);
  for (const url of ['http://github.com/example/plugin', 'https://secret@github.com/example/plugin', 'https://github.com/example/plugin?x=1', 'https://evil.example/example/plugin']) {
    assert.throws(() => resolveRepository({}, { ...input, repositoryReview: { ...review, url } }, '1.2.3', 'sha512-fixture'), /canonical/);
  }
  assert.throws(() => resolveRepository({}, { ...input, repositoryReview: { ...review, commit: 'main' } }, '1.2.3', 'sha512-fixture'), /immutable/);
});
test('source reviews are disclosed by collectPackage after archive verification', async () => {
  const source = fixture();
  const metadata = await (await source.fetchImpl('https://registry.npmjs.org/example', { redirect: 'error' })).json();
  const input = { ...config.packages[0], version: '1.2.3', repositoryReview: { version: '1.2.3', url: 'https://github.com/example/plugin', commit: 'a'.repeat(40), integrity: metadata.versions['1.2.3'].dist.integrity } };
  const result = await collectPackage(input, source);
  assert.equal(result.entry.repository.url, input.repositoryReview.url);
  assert.equal(result.evidence.repositorySource, 'review');
  assert.equal(result.evidence.repositoryReview.commit, 'a'.repeat(40));
});
test('large archive budgets require a pinned version and matching integrity', () => {
  const review = { version: '1.2.3', integrity: 'sha512-fixture', maxUnpackedBytes: MAX_ARCHIVE_BYTES, timeoutMs: 120000 };
  const input = { version: '1.2.3', archiveReview: review };
  assert.equal(archiveBudget({}, '1.2.3', 'sha512-fixture').maxUnpackedBytes, DEFAULT_ARCHIVE_BYTES);
  assert.equal(archiveBudget(input, '1.2.3', 'sha512-fixture').maxUnpackedBytes, MAX_ARCHIVE_BYTES);
  assert.throws(() => archiveBudget({ archiveReview: review }, '1.2.3', 'sha512-fixture'), /pinned/);
  assert.throws(() => archiveBudget(input, '1.2.4', 'sha512-fixture'), /pinned/);
  assert.throws(() => archiveBudget(input, '1.2.3', 'sha512-changed'), /integrity/);
  assert.throws(() => archiveBudget({ ...input, archiveReview: { ...review, maxUnpackedBytes: MAX_ARCHIVE_BYTES + 1 } }, '1.2.3', 'sha512-fixture'), /256 MiB/);
  assert.throws(() => archiveBudget({ ...input, archiveReview: { ...review, timeoutMs: 120001 } }, '1.2.3', 'sha512-fixture'), /120000/);
});
test('archive scanning enforces the reviewed byte budget and retains only metadata', async () => {
  const bytes = archive([['package/package.json', '{}'], ['package/content.bin', 'x'.repeat(2000)]]);
  await assert.rejects(inspectArchive(bytes, { maxUnpackedBytes: 1000 }), /limits/);
  const result = await inspectArchive(bytes, { maxUnpackedBytes: 8192 });
  assert.equal(result.unpackedBytes, 2002);
  assert.equal(result.decodedBytes, gunzipSync(bytes).length);
  assert.equal(result.entryCount, 2);
  assert.equal(result.files.size, 2);
  assert.deepEqual(result.manifest, {});
  await assert.rejects(inspectArchive(bytes, { maxUnpackedBytes: Infinity }), /256 MiB/);
});
test('manifest size cap still applies when a larger archive budget is approved', async () => {
  const bytes = archive([['package/package.json', 'x'.repeat(1024 * 1024 + 1)]]);
  await assert.rejects(inspectArchive(bytes, { maxUnpackedBytes: MAX_ARCHIVE_BYTES }), /manifest is too large/);
});
test('download deadlines cannot be made unlimited', async () => {
  for (const timeoutMs of [0, -1, Infinity, 120001]) {
    await assert.rejects(download('https://registry.npmjs.org/test', { timeoutMs, fetchImpl: () => assert.fail('must not fetch') }), /timeout/);
  }
});
test('collectPackage applies and reports a reviewed archive budget', async () => {
  const source = fixture();
  const metadata = await (await source.fetchImpl('https://registry.npmjs.org/example', { redirect: 'error' })).json();
  const input = { ...config.packages[0], version: '1.2.3', archiveReview: { version: '1.2.3', integrity: metadata.versions['1.2.3'].dist.integrity, maxUnpackedBytes: 1024 * 1024, timeoutMs: 60000 } };
  const result = await collectPackage(input, source);
  assert.equal(result.evidence.archive.reviewedBudget, true);
  assert.equal(result.evidence.archive.downloadTimeoutMs, 60000);
  assert.equal(result.evidence.archive.maxUnpackedBytes, 1024 * 1024);
  assert.ok(result.evidence.archive.unpackedBytes > 0);
  await assert.rejects(collectPackage({ ...input, archiveReview: { ...input.archiveReview, maxUnpackedBytes: 1 } }, source), /limits/);
  const bad = { ...input, archiveReview: { ...input.archiveReview, integrity: 'sha512-changed' } };
  await assert.rejects(collectPackage(bad, { fetchImpl: async (url, options) => {
    assert.ok(!url.endsWith('.tgz'), 'reject the review before downloading the archive');
    return source.fetchImpl(url, options);
  } }), /integrity/);
});
test('PAX metadata and tar padding count toward the full decoded byte budget', async () => {
  const pax = new Pax({ comment: 'x'.repeat(4096) }).encode();
  const payload = gunzipSync(archive([['package/package.json', '{}']]));
  const raw = Buffer.concat([pax, payload]);
  for (const bytes of [raw, gzipSync(raw)]) {
    await assert.rejects(inspectArchive(bytes, { maxUnpackedBytes: 2048 }), /limits/);
    const result = await inspectArchive(bytes, { maxUnpackedBytes: raw.length });
    assert.equal(result.decodedBytes, raw.length);
    assert.equal(result.entryCount, 2);
    assert.ok(result.unpackedBytes > 4096);
  }
});
test('zero-length metadata cannot bypass the 20000-entry cap', async () => {
  const entries = Array.from({ length: 20_001 }, (_, i) => [`PaxHeader/${i}`, '', 'x']);
  entries.push(['package/package.json', '{}']);
  await assert.rejects(inspectArchive(archive(entries)), /limits: entries/);
});
test('oversized PAX metadata is rejected rather than silently ignored', async () => {
  const bytes = archive([['PaxHeader/large', 'x'.repeat(1024 * 1024 + 1), 'x'], ['package/package.json', '{}']]);
  await assert.rejects(inspectArchive(bytes), /metadata is too large/);
});
test('legitimate PAX and GNU long-path records retain parsing behavior', async () => {
  const pax = new Pax({ path: 'package/package.json', size: 2 }).encode();
  const raw = Buffer.concat([pax, gunzipSync(archive([['placeholder', '{}']]))]);
  const first = await inspectArchive(gzipSync(raw));
  assert.deepEqual(first.manifest, {});
  assert.equal(first.entryCount, 2);
  const gnu = await inspectArchive(archive([['long-name', 'package/package.json\0', 'L'], ['placeholder', '{}']]));
  assert.deepEqual(gnu.manifest, {});
  assert.equal(gnu.entryCount, 2);
});
test('PAX size precedence cannot hide an oversized manifest body', async () => {
  const size = 1024 * 1024 + 1;
  const global = new Pax({ size: 1 }, true).encode();
  const local = new Pax({ path: 'package/package.json', size }).encode();
  const body = gunzipSync(archive([['package/package.json', '{}'.padEnd(size, ' ')]]));
  await assert.rejects(inspectArchive(gzipSync(Buffer.concat([global, local, body]))), /manifest is too large/);
});
test('publication time comes from registry rather than generation time', async () => {
  await assert.rejects(collectPackage(config.packages[0], { ...fixture(), now: 0 }), /publication date/);
});

test('published icons and bilingual package locales survive official parsing', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M0 0h16v16H0z" fill="#2458c6"/></svg>';
  const source = fixture({
    manifestFields: {exports: {'./icon': {import: './assets/mark.svg'}, './locale/*': './locale/*'}},
    extraFiles: [
      ['assets/mark.svg', svg],
      ['locale/en.json', JSON.stringify({meta: {title: 'Author title', description: 'Author description.'}})],
      ['locale/zh.json', JSON.stringify({meta: {title: '作者名称', description: '作者介绍。'}})]
    ]
  });
  const result = await collectPackage(config.packages[0], source);
  assert.deepEqual(result.entry.title, {en: 'Author title', zh: '作者名称'});
  assert.deepEqual(result.entry.description, {en: 'Author description.', zh: '作者介绍。'});
  assert.match(result.entry.icon, /^icons\/[a-f0-9]{64}\.svg$/);
  assert.equal(result.assets[0].bytes.toString(), svg);
  assert.equal(result.evidence.display.icon.status, 'included');
  const parsed = parseMarketIndex({...config, format: 1, plugins: [result.entry]}, 'https://example.org/catalog/index.json');
  assert.equal(parsed.plugins[0].icon, 'https://example.org/catalog/' + result.entry.icon);
  const edited = await collectPackage({...config.packages[0], title: {en: 'Reviewed title'}, description: {en: 'Reviewed description.'}}, source);
  assert.equal(edited.entry.title.en, 'Reviewed title');
  assert.equal(edited.entry.description.en, 'Reviewed description.');
});

test('missing, oversized and active icons do not replace a usable package entry', async () => {
  for (const [path, content] of [
    ['missing.svg', undefined],
    ['icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ['icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://example.org/icon.svg#x"/></svg>'],
    ['icon.png', 'x'.repeat(256 * 1024 + 1)],
    ['../outside.svg', '<svg/>']
  ]) {
    const extraFiles = content !== undefined && !path.startsWith('..') ? [[path, content]] : [];
    const result = await collectPackage(config.packages[0], fixture({manifestFields: {icon: './' + path}, extraFiles}));
    assert.equal(result.entry.icon, undefined);
    assert.equal(result.assets.length, 0);
    assert.equal(result.evidence.display.icon.status, 'omitted');
    assert.ok(result.evidence.display.warnings.length);
  }
});
