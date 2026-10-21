import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { reviewedIcon, reviewedIconSource } from '../scripts/reviewed-icon.mjs';
import { collectPackage, download, resolveRepository } from '../scripts/lib.mjs';
import { MAX_ICON_BYTES } from '../scripts/package-display.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sha512 = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h16v16H0z"/></svg>');
const binding = { version: '1.2.3', integrity: sha512('archive'), repository: { url: 'https://github.com/example/plugin' } };
const inputFor = (bytes = svg, overrides = {}) => ({ version: '1.2.3', iconReview: { version: '1.2.3', integrity: binding.integrity, commit: 'a'.repeat(40), path: 'artwork/logo.svg', sha256: sha256(bytes), ...overrides } });
const fetchBytes = bytes => async (_url, options) => {
  assert.equal(options.redirect, 'error');
  assert.equal(options.headers.authorization, undefined);
  assert.equal(options.headers.cookie, undefined);
  return new Response(bytes);
};

test('reviewed artwork is fetched only from the declared repository at an immutable commit', async () => {
  const input = inputFor();
  const expected = `https://raw.githubusercontent.com/example/plugin/${'a'.repeat(40)}/artwork/logo.svg`;
  const result = await reviewedIcon(input, { ...binding, fetchImpl: async (url, options) => {
    assert.equal(url, expected);
    return fetchBytes(svg)(url, options);
  } });
  assert.equal(result.evidence.source, 'reviewed-repository');
  assert.equal(result.evidence.sourceUrl, expected);
  assert.equal(result.evidence.originalSha256, sha256(svg));
  assert.equal(result.evidence.sha256, sha256(svg));
  assert.equal(result.icon, `icons/${sha256(svg)}.svg`);
  assert.deepEqual(result.asset.bytes, svg);
  assert.equal(reviewedIconSource({}, binding), undefined);
});

test('review requires the exact pinned version and npm SHA-512 before any artwork request', async () => {
  for (const input of [
    { ...inputFor(), version: undefined },
    inputFor(svg, { version: '1.2.4' }),
    inputFor(svg, { integrity: sha512('different archive') }),
    inputFor(svg, { integrity: 'sha256-wrong-algorithm' })
  ]) await assert.rejects(reviewedIcon(input, { ...binding, fetchImpl: () => assert.fail('must not fetch') }), /pinned package version and SHA-512/);
  assert.throws(() => reviewedIconSource(inputFor(), { ...binding, integrity: 'sha512-not-a-hash' }), /SHA-512/);
});

test('a review without version and integrity follows the latest release and still pins the artwork', async () => {
  const { version, integrity, ...artwork } = inputFor().iconReview;
  const latest = { ...binding, version: '1.4.0', integrity: sha512('newer archive') };
  const result = await reviewedIcon({ iconReview: artwork }, { ...latest, fetchImpl: fetchBytes(svg) });
  assert.equal(result.evidence.review.version, '1.4.0');
  assert.equal(result.evidence.review.integrity, latest.integrity);
  await assert.rejects(reviewedIcon({ iconReview: artwork }, { ...latest, fetchImpl: fetchBytes(Buffer.from('<svg/>')) }), /SHA-256 does not match/);
  await assert.rejects(reviewedIcon({ iconReview: { ...artwork, version: '1.2.3' } }, { ...latest, fetchImpl: () => assert.fail('must not fetch') }), /pinned package version/);
});

test('review cannot introduce another repository or an arbitrary source URL', async () => {
  for (const repository of [undefined, { url: 'https://example.org/example/plugin' }, { url: 'http://github.com/example/plugin' }, { url: 'https://github.com/example/plugin/tree/main' }, { url: 'https://github.com/example/plugin?download=1' }, { url: 'https://github.com/example/plugin#artwork' }, { url: 'https://user@github.com/example/plugin' }]) {
    await assert.rejects(reviewedIcon(inputFor(), { ...binding, repository, fetchImpl: () => assert.fail('must not fetch') }), /published GitHub repository/);
  }
  for (const extra of [{ url: 'https://example.org/icon.svg' }, { repository: 'other/project' }]) {
    await assert.rejects(reviewedIcon(inputFor(svg, extra), { ...binding, fetchImpl: () => assert.fail('must not fetch') }), /unsupported fields/);
  }
  assert.throws(() => resolveRepository({ repository: 'https://github.com/example/plugin' }, { version: '1.2.3', repositoryReview: { version: '1.2.3', integrity: binding.integrity, commit: 'a'.repeat(40), url: 'https://github.com/other/project' } }, '1.2.3', binding.integrity), /conflicts/);
});

test('mutable commits, path traversal and ambiguous encoded paths are rejected before fetch', async () => {
  for (const change of [
    { commit: 'main' }, { commit: 'a'.repeat(39) },
    ...['/logo.svg', '../logo.svg', 'art/../logo.svg', 'art//logo.svg', './logo.svg', 'art\\logo.svg', 'art/%2e%2e/logo.svg', 'logo.svg?raw=1', 'logo.svg#x', 'https://example.org/logo.svg', 'logo\n.svg'].map(path => ({ path }))
  ]) await assert.rejects(reviewedIcon(inputFor(svg, change), { ...binding, fetchImpl: () => assert.fail('must not fetch') }), /immutable|relative repository/);
});

test('redirect responses and unexpected final URLs cannot cross the raw GitHub boundary', async () => {
  await assert.rejects(reviewedIcon(inputFor(), { ...binding, fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://example.org/icon.svg' } }) }), /failed or redirected/);
  await assert.rejects(reviewedIcon(inputFor(), { ...binding, fetchImpl: async () => {
    const response = new Response(svg);
    Object.defineProperty(response, 'redirected', { value: true });
    return response;
  } }), /failed or redirected/);
  await assert.rejects(reviewedIcon(inputFor(), { ...binding, fetchImpl: async () => {
    const response = new Response(svg);
    Object.defineProperty(response, 'url', { value: 'https://raw.githubusercontent.com/other/repo/main/icon.svg' });
    return response;
  } }), /failed or redirected/);
});

test('original artwork hash is checked before validation or comment normalization', async () => {
  await assert.rejects(reviewedIcon(inputFor(), { ...binding, fetchImpl: fetchBytes(Buffer.from('<svg/>')) }), /original SHA-256/);
  const original = Buffer.from(`<!-- source comment -->${svg}`);
  await assert.rejects(reviewedIcon(inputFor(svg, { normalization: 'remove-xml-comments' }), { ...binding, fetchImpl: fetchBytes(original) }), /original SHA-256/);
});

test('image size is bounded for declared and streamed bodies', async () => {
  const oversized = Buffer.alloc(MAX_ICON_BYTES + 1, 32);
  for (const response of [new Response(oversized), new Response(svg, { headers: { 'content-length': String(MAX_ICON_BYTES + 1) } }), new Response(Buffer.alloc(0))]) {
    await assert.rejects(reviewedIcon(inputFor(), { ...binding, fetchImpl: async () => response }), /between 1 byte and 256 KiB/);
  }
});

test('package image validation rejects active SVG, external references and mismatched raster signatures', async () => {
  for (const text of [
    '<svg><script>alert(1)</script></svg>',
    '<svg><use href="https://example.org/image.svg#x"/></svg>',
    '<svg><use href=https://example.org/image.svg#x /></svg>',
    '<svg><path fill="url(https://example.org/x)"/></svg>',
    '<svg onload="alert(1)"/>',
    '<svg><image href="data:image/png;base64,eA=="/></svg>'
  ]) {
    const bytes = Buffer.from(text);
    await assert.rejects(reviewedIcon(inputFor(bytes), { ...binding, fetchImpl: fetchBytes(bytes) }), /invalid|references/);
  }
  await assert.rejects(reviewedIcon(inputFor(svg, { path: 'logo.png' }), { ...binding, fetchImpl: fetchBytes(svg) }), /PNG signature/);
});

test('XML comments are preserved unless the review explicitly permits their removal', async () => {
  const original = Buffer.from(`<!-- contains <script> but is inactive -->${svg}<!-- tail -->`);
  const preserved = await reviewedIcon(inputFor(original), { ...binding, fetchImpl: fetchBytes(original) });
  assert.deepEqual(preserved.asset.bytes, original);
  const normalized = await reviewedIcon(inputFor(original, { normalization: 'remove-xml-comments' }), { ...binding, fetchImpl: fetchBytes(original) });
  assert.deepEqual(normalized.asset.bytes, svg);
  assert.equal(normalized.evidence.originalSha256, sha256(original));
  assert.equal(normalized.evidence.sha256, sha256(svg));
  assert.equal(normalized.evidence.review.normalization, 'remove-xml-comments');
  await assert.rejects(reviewedIcon(inputFor(svg, { normalization: 'sanitize-svg' }), { ...binding, fetchImpl: () => assert.fail('must not fetch') }), /Unsupported.*normalization/);
  await assert.rejects(reviewedIcon(inputFor(svg, { path: 'logo.png', normalization: 'remove-xml-comments' }), { ...binding, fetchImpl: () => assert.fail('must not fetch') }), /requires SVG/);
});

function tar(entries) {
  const chunks = [];
  for (const [name, value] of entries) {
    const bytes = Buffer.from(value); const header = Buffer.alloc(512);
    header.write(name, 0, 100); header.write('0000644\0', 100, 8); header.write('0000000\0', 108, 8); header.write('0000000\0', 116, 8);
    header.write(`${bytes.length.toString(8).padStart(11, '0')}\0`, 124, 12); header.write('00000000000\0', 136, 12); header.fill(32, 148, 156);
    header.write('0', 156); header.write('ustar\0', 257, 6); header.write('00', 263, 2);
    header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0')}\0 `, 148, 8);
    chunks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  return Buffer.concat([...chunks, Buffer.alloc(1024)]);
}

test('collectPackage gives explicit review precedence and preserves original package icon evidence', async () => {
  const manifest = { name: 'fixture-plugin', version: '1.2.3', repository: 'https://github.com/example/plugin', icon: 'icon.svg', dsh: { bundle: { patch: 'cordis.patch.yml' } } };
  const packageSvg = '<svg><circle r="2"/></svg>';
  const archive = tar([['package/package.json', JSON.stringify(manifest)], ['package/cordis.patch.yml', '- id: fixture'], ['package/icon.svg', packageSvg]]);
  const integrity = sha512(archive);
  const input = inputFor(); input.name = manifest.name; input.iconReview.integrity = integrity;
  const metadata = { 'dist-tags': { latest: '1.2.3' }, time: { '1.2.3': '2026-01-01T00:00:00Z' }, versions: { '1.2.3': { ...manifest, dist: { integrity, tarball: 'https://registry.npmjs.org/fixture-plugin.tgz' } } } };
  let rawRequests = 0;
  const fetchImpl = async (url, options) => {
    assert.equal(options.redirect, 'error');
    if (url.startsWith('https://raw.githubusercontent.com/')) { rawRequests++; return new Response(svg); }
    return new Response(url.endsWith('.tgz') ? archive : JSON.stringify(metadata));
  };
  const result = await collectPackage(input, { fetchImpl });
  assert.equal(rawRequests, 1);
  assert.equal(result.entry.icon, `icons/${sha256(svg)}.svg`);
  assert.equal(result.evidence.display.icon.source, 'reviewed-repository');
  assert.equal(result.evidence.display.icon.selection, 'explicit-review-preferred');
  assert.equal(result.evidence.display.publishedIcon.source, 'published-package');
  assert.equal(result.evidence.display.publishedIcon.sha256, sha256(packageSvg));
  assert.equal(result.assets.length, 1);
  input.iconReview.sha256 = '0'.repeat(64);
  await assert.rejects(collectPackage(input, { fetchImpl }), /original SHA-256/);
});

test('the npm download allowlist never accepts repository artwork URLs', async () => {
  await assert.rejects(download(`https://raw.githubusercontent.com/example/plugin/${'a'.repeat(40)}/icon.svg`, { fetchImpl: () => assert.fail('must not fetch') }), /public npm registry/);
});
