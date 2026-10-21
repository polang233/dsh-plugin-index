import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { ArchiveGuard } from './archive-guard.mjs';
import { Parser } from 'tar';
import semver from 'semver';
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index';
import { archiveBudget, DEFAULT_ARCHIVE_BYTES, MAX_ARCHIVE_BYTES, DEFAULT_DOWNLOAD_TIMEOUT, MAX_DOWNLOAD_TIMEOUT } from './limits.mjs';
import { displayFiles, packageDisplay, MAX_DISPLAY_FILE_BYTES } from './package-display.mjs';
import { reviewedIcon } from './reviewed-icon.mjs';

export const REGISTRY = 'https://registry.npmjs.org/';
export const VALIDATOR_VERSION = '0.2.1-rc.2';
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;

export async function download(url, { fetchImpl = fetch, maxBytes = 64 * 1024 * 1024, retryDelayMs = 500, timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT } = {}) {
  const parsed = new URL(url);
  if (parsed.origin !== new URL(REGISTRY).origin || parsed.username || parsed.password) {
    throw new Error(`Only the public npm registry is supported: ${url}`);
  }
  return downloadArchive(url, {fetchImpl, maxBytes, retryDelayMs, timeoutMs});
}

async function downloadArchive(url, { fetchImpl = fetch, maxBytes = 64 * 1024 * 1024, retryDelayMs = 500, timeoutMs = DEFAULT_DOWNLOAD_TIMEOUT } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_DOWNLOAD_TIMEOUT) throw new Error('Download timeout must be between 1 and 120000 ms');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchImpl(url, {
        redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': 'dsh-plugin-index/0.1 (+https://github.com/polang233/dsh-plugin-index)' }
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        const error = new Error(`HTTP ${response.status}: ${url}`);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          const error = new Error(`Response exceeds ${maxBytes} bytes: ${url}`);
          error.retryable = false;
          throw error;
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    } catch (error) {
      if (error.retryable === false || attempt === 2) throw error;
      await delay(retryDelayMs * 2 ** attempt);
    }
  }
}

export function verifyIntegrity(bytes, integrity) {
  const hashes = typeof integrity === 'string' ? integrity.split(/\s+/).filter(x => x.startsWith('sha512-')) : [];
  const actual = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  if (!hashes.includes(actual)) throw new Error('Published tarball has no matching SHA-512 integrity');
}

export async function inspectArchive(bytes, { maxUnpackedBytes = DEFAULT_ARCHIVE_BYTES, readFiles = [], archiveRoot = 'package' } = {}) {
  if (!Number.isSafeInteger(maxUnpackedBytes) || maxUnpackedBytes < 1 || maxUnpackedBytes > MAX_ARCHIVE_BYTES) throw new Error('Archive budget must be between 1 byte and 256 MiB');
  const files = new Set();
  const requested = new Set(readFiles);
  const contents = new Map();
  let manifest;
  const guard = new ArchiveGuard(maxUnpackedBytes);
  const parser = new Parser({ strict: true, maxMetaEntrySize: 1024 * 1024, onReadEntry(entry) {
    try {
    if (entry.type !== 'File' && entry.type !== 'OldFile') { entry.resume(); return; }
    if (!entry.path.startsWith(archiveRoot + '/') || entry.path.includes('\\') || entry.path.split('/').includes('..')) {
      throw new Error(`Unexpected archive path: ${entry.path}`);
    }
    const path = 'package/' + entry.path.slice(archiveRoot.length + 1);
    if (files.has(path)) throw new Error(`Duplicate archive entry: ${entry.path}`);
    files.add(path);
    if (path === 'package/package.json') {
      if (entry.size > 1024 * 1024) throw new Error('Package manifest is too large');
      const chunks = [];
      let manifestBytes = 0;
      entry.on('data', chunk => {
        manifestBytes += chunk.length;
        if (manifestBytes > 1024 * 1024) { parser.abort(new Error('Package manifest is too large')); return; }
        chunks.push(chunk);
      });
      entry.on('end', () => { manifest = Buffer.concat(chunks).toString('utf8'); });
    } else if (requested.has(path) && entry.size <= MAX_DISPLAY_FILE_BYTES) {
      const chunks = [];
      let length = 0;
      entry.on('data', chunk => {
        length += chunk.length;
        if (length > MAX_DISPLAY_FILE_BYTES) { parser.abort(new Error('Display file is too large')); return; }
        chunks.push(chunk);
      });
      entry.on('end', () => { contents.set(path, Buffer.concat(chunks)); });
    } else entry.resume();
    } catch (error) { parser.abort(error); }
  } });
  const source = Readable.from([bytes]);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) await pipeline(source, createGunzip(), guard, parser);
  else await pipeline(source, guard, parser);
  if (!manifest) throw new Error('Published archive has no package/package.json');
  return { manifest: JSON.parse(manifest), files, contents, unpackedBytes: guard.payloadBytes, decodedBytes: guard.decodedBytes, entryCount: guard.entries };
}

function packageFile(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Bundle patch must name a file');
  const path = value.replace(/^\.\//, '');
  if (path.startsWith('/') || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error(`Invalid package file: ${value}`);
  }
  return `package/${path}`;
}

export function checkBundle(manifest, files, expectedName, expectedVersion) {
  if (manifest.name !== expectedName || manifest.version !== expectedVersion) throw new Error('Published archive identity differs from registry metadata');
  const declared = manifest.dsh?.bundle?.patch;
  const patches = (Array.isArray(declared) ? declared : [declared]).map(packageFile);
  if (!patches.length) throw new Error('Bundle must declare at least one patch');
  for (const patch of patches) if (!files.has(patch)) throw new Error(`Bundle patch is missing from published archive: ${patch}`);
  if (typeof manifest.main === 'string' && !files.has(packageFile(manifest.main))) throw new Error('Declared main file is missing from published archive');
  return patches;
}

function minimalRanges(ranges) {
  const unique = [...new Set(ranges)];
  const options = {includePrerelease: true};
  return unique.filter((range, position) => !unique.some((other, index) => index !== position
    && semver.subset(range, other, options)
    && (index < position || !semver.subset(other, range, options))));
}

export function dshEngines(manifest) {
  const explicit = manifest.engines && Object.hasOwn(manifest.engines, 'dsh');
  if (explicit) {
    const range = typeof manifest.engines.dsh === 'string' ? manifest.engines.dsh.trim() : '';
    if (!range || !semver.validRange(range) || semver.minVersion(new semver.Range(range, { includePrerelease: true })) === null) throw new Error('Invalid DSH compatibility range');
    return range === '*' ? {} : { dsh: range };
  }
  const peers = Object.entries(manifest.peerDependencies ?? {}).filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'));
  const ranges = peers.map(([, value]) => value).filter(value => !['workspace:*', 'workspace:^', 'workspace:~'].includes(value));
  const used = [...new Set(ranges.map(value => typeof value === 'string' ? value.trim() : value))].filter(value => value !== '*');
  let combinations = [''];
  for (const value of used) {
    if (typeof value !== 'string' || !value || !semver.validRange(value)) throw new Error('Invalid DSH compatibility range');
    const sets = minimalRanges(new semver.Range(value, { includePrerelease: true }).set.map(set => set.map(comparator => comparator.value).filter(Boolean).join(' ')));
    if (combinations.length * sets.length > 256) throw new Error('DSH compatibility range is too complex');
    combinations = minimalRanges(combinations.flatMap(left => sets.map(right => [...new Set(`${left} ${right}`.trim().split(/\s+/))].join(' ')))
      .filter(range => semver.minVersion(new semver.Range(range, { includePrerelease: true })) !== null));
  }
  if (!combinations.length) throw new Error('DSH peer compatibility ranges have no intersection');
  if (!used.length) return {};
  return { dsh: used.length === 1 ? used[0] : [...new Set(combinations)].join(' || ') };
}

export function repositoryFrom(manifest) {
  const raw = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  if (typeof raw !== 'string') return undefined;
  let value = raw.replace(/^git\+/, '');
  if (/^(?:github:)?[\w.-]+\/[\w.-]+$/.test(value)) value = `https://github.com/${value.replace(/^github:/, '')}`;
  value = value.replace(/^git:\/\/github.com\//, 'https://github.com/').replace(/^git@github.com:/, 'https://github.com/');
  if (!URL.canParse(value)) return undefined;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) return undefined;
  url.username = ''; url.password = ''; url.search = ''; url.hash = '';
  url.pathname = url.pathname.replace(/\.git$/, '');
  const directory = manifest.repository?.directory;
  const validDirectory = typeof directory === 'string' && directory.split('/').every(part => /^[A-Za-z0-9._@+-]+$/.test(part) && part !== '.' && part !== '..');
  return { url: url.href, ...(validDirectory ? { directory } : {}) };
}

export function resolveRepository(manifest, input, version, integrity) {
  const declared = repositoryFrom(manifest);
  const review = input.repositoryReview;
  if (review === undefined) return { repository: declared, provenance: declared ? 'package' : null };
  if (input.version !== version || review.version !== version || review.integrity !== integrity) {
    throw new Error('Repository review must match the pinned package version and integrity');
  }
  if (typeof review.commit !== 'string' || !/^[0-9a-f]{40}$/.test(review.commit)) throw new Error('Repository review requires an immutable commit');
  if (typeof review.url !== 'string' || !URL.canParse(review.url)) throw new Error('Repository review requires a canonical GitHub repository URL');
  const url = new URL(review.url);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.search || url.hash || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(url.pathname) || url.href !== review.url) {
    throw new Error('Repository review requires a canonical GitHub repository URL');
  }
  if (declared && declared.url.toLowerCase() !== review.url.toLowerCase()) throw new Error('Repository review conflicts with the published manifest');
  return {
    repository: declared ?? { url: review.url },
    provenance: declared ? 'package' : 'review',
    review: { version, integrity, commit: review.commit, url: review.url, evidence: `${review.url}/blob/${review.commit}/package.json` }
  };
}

/** Release cadence from the registry's publish times; feeds the "new" and "active" signals. */
export function releaseActivity(metadata, now) {
  const times = Object.entries(metadata.time ?? {})
    .filter(([version]) => metadata.versions?.[version])
    .map(([, value]) => Date.parse(value))
    .filter(time => Number.isFinite(time) && time <= now);
  if (!times.length) return undefined;
  const within = days => times.filter(time => now - time <= days * 86_400_000).length;
  return { firstPublished: new Date(Math.min(...times)).toISOString(), last30Days: within(30), last90Days: within(90) };
}

export const releasesOf = evidence => Object.fromEntries((evidence?.packages ?? []).filter(record => record.releases).map(record => [record.name, record.releases]));

async function packageRelease(input, {fetchImpl, now}) {
  if (input.source !== undefined) {
    const source = input.source;
    if (!source || typeof source !== 'object' || Object.keys(source).some(key => !['type', 'url', 'commit', 'integrity', 'publishedAt'].includes(key))) throw new Error('Unsupported Git source fields');
    const match = typeof source.url === 'string' && /^https:\/\/github\.com\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_.-]+)$/.exec(source.url);
    if (source.type !== 'git' || !match || !/^[0-9a-f]{40}$/.test(source.commit)) throw new Error('Git source requires a canonical GitHub URL and immutable commit');
    if (!semver.valid(input.version) || semver.valid(input.version) !== input.version || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(source.integrity)) throw new Error('Git source requires an exact version and SHA-512 integrity');
    const time = Date.parse(source.publishedAt);
    if (!Number.isFinite(time) || time < 0 || time > now) throw new Error('Invalid Git release publication date');
    const tarball = `https://codeload.github.com/${match[1]}/${match[2]}/tar.gz/${source.commit}`;
    const budget = {...archiveBudget(input, input.version, source.integrity), archiveRoot: `${match[2]}-${source.commit}`};
    const bytes = await downloadArchive(tarball, {fetchImpl, timeoutMs: budget.timeoutMs});
    verifyIntegrity(bytes, source.integrity);
    return {version: input.version, time, budget, bytes, published: {dist: {tarball, integrity: source.integrity}, gitHead: source.commit}, source: {type: 'git', url: source.url, commit: source.commit}};
  }
  const metadataUrl = `${REGISTRY}${encodeURIComponent(input.name)}`;
  const metadata = JSON.parse((await download(metadataUrl, { fetchImpl })).toString('utf8'));
  const version = input.version ?? metadata['dist-tags']?.latest;
  if (typeof version !== 'string' || !semver.valid(version) || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('No exact valid release version');
  const published = metadata.versions?.[version];
  if (!published || published.deprecated) throw new Error('Requested version is missing or deprecated');
  const time = Date.parse(metadata.time?.[version]);
  if (!Number.isFinite(time) || time < 0 || time > now) throw new Error('Missing or invalid publication date');
  const budget = archiveBudget(input, version, published.dist?.integrity);
  const bytes = await download(published.dist?.tarball, { fetchImpl, timeoutMs: budget.timeoutMs });
  verifyIntegrity(bytes, published.dist?.integrity);
  return {version, time, budget, bytes, published, metadataUrl, releases: releaseActivity(metadata, now), source: {type: 'npm', registry: REGISTRY}};
}

export async function collectPackage(input, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (!PACKAGE.test(input.name) || input.name.length > 214) throw new Error('Invalid npm package name');
  const {version, time, budget, bytes, published, metadataUrl, releases, source} = await packageRelease(input, {fetchImpl, now});
  const { manifest, files, unpackedBytes, decodedBytes, entryCount } = await inspectArchive(bytes, budget);
  const patch = checkBundle(manifest, files, input.name, version);
  const resolved = displayFiles(manifest, files);
  const readFiles = [resolved.icon, ...Object.values(resolved.locales)].filter(path => path && files.has(path));
  const contents = readFiles.length ? (await inspectArchive(bytes, {...budget, readFiles})).contents : new Map();
  const display = packageDisplay(manifest, resolved, contents);
  const repositoryInfo = resolveRepository(manifest, input, version, published.dist.integrity);
  const repository = repositoryInfo.repository;
  if (source.type === 'git' && repository?.url !== source.url) throw new Error('Git source differs from declared repository');
  const reviewed = await reviewedIcon(input, { version, integrity: published.dist.integrity, repository: repositoryFrom(manifest), fetchImpl });
  if (reviewed) {
    display.evidence.publishedIcon = display.evidence.icon;
    display.evidence.icon = { ...reviewed.evidence, selection: 'explicit-review-preferred' };
    display.icon = reviewed.icon;
    display.asset = reviewed.asset;
  }
  const author = typeof manifest.author === 'string' ? manifest.author.replace(/\s*<[^>]*>/g, '').replace(/\s*\([^)]*\)/g, '').trim() : manifest.author?.name;
  const description = input.description ?? display.description ?? manifest.description;
  const title = input.title ?? display.title;
  const entry = {
    name: manifest.name,
    ...(title ? { title } : {}),
    ...(display.icon ? { icon: display.icon } : {}),
    ...(description && (typeof description !== 'string' || description.trim()) ? { description } : {}),
    ...(typeof author === 'string' && author.trim() ? { author } : {}),
    ...(repository ? { repository } : {}),
    ...(typeof manifest.homepage === 'string' && URL.canParse(manifest.homepage) && ['https:', 'http:'].includes(new URL(manifest.homepage).protocol) ? { homepage: manifest.homepage } : {}),
    metadata: {
      ...(input.category ? { category: input.category } : {}),
      keywords: Array.isArray(manifest.keywords) ? manifest.keywords.filter(x => typeof x === 'string') : []
    },
    versions: [{ version, publishTimestamp: Math.floor(time / 1000), source, engines: dshEngines(manifest) }]
  };
  const lifecycleScripts = Object.keys(manifest.scripts ?? {}).filter(key => ['preinstall', 'install', 'postinstall'].includes(key));
  return {
    entry,
    assets: display.asset ? [display.asset] : [],
    evidence: {
      name: manifest.name, version,
      license: typeof manifest.license === 'string' ? manifest.license : null,
      repository: repository?.url ?? null, repositorySource: repositoryInfo.provenance,
      ...(repositoryInfo.review ? {repositoryReview: repositoryInfo.review} : {}),
      ...(typeof published.gitHead === 'string' && /^[0-9a-f]{40}$/.test(published.gitHead) ? {sourceCommit: published.gitHead} : {}),
      ...(metadataUrl ? {metadataUrl} : {source}), tarball: published.dist.tarball, integrity: published.dist.integrity,
      patch, filesChecked: files.size, display: display.evidence,
      archive: {compressedBytes: bytes.length, unpackedBytes, decodedBytes, entries: entryCount, maxUnpackedBytes: budget.maxUnpackedBytes, downloadTimeoutMs: budget.timeoutMs, reviewedBudget: input.archiveReview !== undefined},
      lifecycleScripts,
      ...(releases ? {releases} : {}),
      checks: [source.type === 'git' ? 'git-commit-pinned' : 'registry-identity', 'sha512-integrity', 'archive-manifest-identity', 'bundle-patch-present', ...(manifest.main ? ['main-file-present'] : [])],
      limitations: ['No runtime installation test', 'No code audit', 'Patch references and transitive dependencies are not validated']
    }
  };
}

export async function buildIndex(config, options = {}) {
  if (!Array.isArray(config.packages) || config.packages.length === 0) throw new Error('An explicit nonempty package allowlist is required');
  const names = config.packages.map(input => input.name);
  if (new Set(names).size !== names.length) throw new Error('Source list duplicates a package name');
  const concurrency = options.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('Concurrency must be between 1 and 8');
  const results = [];
  const errors = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, config.packages.length) }, async () => {
    while (next < config.packages.length) {
      const input = config.packages[next++];
      try {
        const result = await collectPackage(input, options);
        if (config.requireSourceMetadata && (!result.evidence.repository || !result.evidence.license?.trim() || result.evidence.license === 'UNLICENSED')) {
          throw new Error('A public source repository and declared license are required');
        }
        results.push(result);
      }
      catch (error) { errors.push({ name: input.name, message: error.message }); }
    }
  }));
  const failures = options.previous ? await settleFailures(errors, config.packages.length, options) : [];
  if (!options.previous && errors.length) throw new Error(`Cannot publish index: ${errors.map(error => `${error.name}: ${error.message}`).join('; ')}`);
  results.push(...failures.filter(failure => failure.result).map(failure => failure.result));
  results.sort((a, b) => a.entry.name.localeCompare(b.entry.name, 'en'));
  const index = {
    format: 1, title: config.title, description: config.description,
    ...(config.metadata ? { metadata: config.metadata } : {}), plugins: results.map(x => x.entry)
  };
  parseMarketIndex(index, 'https://polang233.github.io/dsh-plugin-index/index.json');
  return {
    index,
    assets: results.flatMap(result => result.assets),
    evidence: {
      generatedAt: new Date(options.now ?? Date.now()).toISOString(),
      validator: { name: '@deepseek-ai/dsh-plugin-market-index', version: VALIDATOR_VERSION },
      packages: results.map(x => x.evidence),
      ...(options.previous ? { failures: failures.map(({ result, ...record }) => record) } : {})
    }
  };
}

// Transient trouble keeps the last published release; a vanished, deprecated or mismatched package is dropped.
const RETAINABLE = /timeout|aborted|fetch failed|socket|ECONN|ENOTFOUND|EAI_AGAIN|HTTP (?:429|5\d\d)|exceeds|inspection limits/i;

/**
 * With the previous published snapshot, one broken package no longer blocks the whole catalog.
 * Each failure is recorded with the time it started failing; too many at once still stops the build.
 */
async function settleFailures(errors, total, { previous, now = Date.now(), fetchImpl = fetch, maxFailures = Math.max(10, Math.ceil(total * 0.05)) }) {
  if (errors.length > maxFailures) {
    throw new Error(`Cannot publish index: ${errors.length} packages failed, more than ${maxFailures}: ${errors.map(error => `${error.name}: ${error.message}`).join('; ')}`);
  }
  const plugins = new Map((previous.index?.plugins ?? []).map(plugin => [plugin.name, plugin]));
  const records = new Map((previous.evidence?.packages ?? []).map(record => [record.name, record]));
  const since = new Map((previous.evidence?.failures ?? []).map(failure => [failure.name, failure.since]));
  const failures = [];
  for (const { name, message } of errors) {
    const failure = { name, error: message, since: since.get(name) ?? new Date(now).toISOString(), retained: false };
    const entry = plugins.get(name), record = records.get(name);
    if (RETAINABLE.test(message) && entry && record) {
      const assets = [];
      let kept = entry;
      if (entry.icon) {
        const icon = await previousIcon(entry.icon, previous.base, fetchImpl);
        if (icon) assets.push(icon);
        else { const { icon: missing, ...rest } = entry; kept = rest; }
      }
      failure.retained = true;
      failure.version = record.version;
      failure.result = { entry: kept, evidence: { ...record, retained: { since: failure.since, error: message } }, assets };
    }
    failures.push(failure);
  }
  return failures.sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

/** Icons are named by their SHA-256, so a fetched copy is accepted only when its bytes still match the name. */
async function previousIcon(path, base, fetchImpl) {
  const match = typeof path === 'string' && path.match(/^icons\/([a-f0-9]{64})\.(?:svg|png|jpg|webp)$/);
  if (!match || !base) return undefined;
  try {
    const response = await fetchImpl(new URL(path, base), { redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) return undefined;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length <= 256 * 1024 && createHash('sha256').update(bytes).digest('hex') === match[1] ? { path, bytes } : undefined;
  } catch { return undefined; }
}
