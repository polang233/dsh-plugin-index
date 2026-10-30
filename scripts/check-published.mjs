import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {withRetries} from './retry.mjs';
import {LABELS} from './labels.mjs';
import {checkRecommendationSnapshot} from './recommendation-state.mjs';
import {REVIEW_SOURCE, maintainerReviewFor, validateMaintainerReviews} from './maintainer-reviews.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Verify the text DSH actually renders against independent source snapshots. */
export function checkMarketDisplay(index, github, downloads, display, publishers, {maintainerReviews, packageEvidence} = {}) {
  if (display.schema !== 1 || downloads.schema !== 1 || !Number.isFinite(Date.parse(display.generatedAt))) throw new Error('Missing market snapshots');
  const counts = { stars: 0, downloads: 0, identities: 0 };
  if (maintainerReviews) validateMaintainerReviews(maintainerReviews);
  const checked = new Map((packageEvidence?.packages ?? []).map(record => [record.name, record]));
  if (index.metadata?.sortKeys?.recommended) {
    const ranks = index.plugins.map(plugin => plugin.metadata?.sortKeys?.recommended).sort((a, b) => a - b);
    if (ranks.some((rank, position) => rank !== position + 1)) throw new Error('Recommendations must contain one rank per plugin');
  }
  if (index.metadata?.sortKeys?.['random-resources']) {
    const ranks = index.plugins.map(plugin => plugin.metadata?.sortKeys?.['random-resources']).sort((a,b)=>a-b);
    if (ranks.some((rank, position) => rank !== position + 1)) throw new Error('Random resources must contain one rank per plugin');
  }
  for (const plugin of index.plugins) {
    const presentation = display.plugins?.[plugin.name];
    if (!presentation) throw new Error('Missing DSH row evidence: ' + plugin.name);
    if (maintainerReviews) {
      const review = maintainerReviewFor(plugin, maintainerReviews, checked, Date.parse(display.generatedAt));
      if (JSON.stringify(review) !== JSON.stringify(presentation.signals?.maintainerReview)
        || Boolean(review) !== Boolean(presentation.signals?.verifiedBy?.includes(REVIEW_SOURCE))) {
        throw new Error('Maintainer review evidence mismatch: ' + plugin.name);
      }
    }
    const repoKey = plugin.repository?.url?.replace(/^https?:\/\/(?:www\.)?github\.com\//, '').replace(/\.git\/?$/, '').replace(/\/$/, '').toLowerCase();
    const repo = github.repositories?.[repoKey], npm = downloads.packages?.[plugin.name];
    const hasStars = repo && ['ok', 'stale'].includes(repo.status) && Number.isSafeInteger(repo.stars) && repo.stars >= 0;
    const hasDownloads = npm && ['ok', 'stale'].includes(npm.status) && Number.isSafeInteger(npm.downloads) && npm.downloads >= 0;
    if (plugin.metadata?.sortKeys?.['github-stars'] !== (hasStars ? repo.stars : undefined)) throw new Error('Published star mismatch: ' + plugin.name);
    const expectedLabels = presentation.labels ?? [];
    const ownLabels = (plugin.metadata?.labels ?? []).filter(id => id in LABELS);
    if (JSON.stringify(ownLabels) !== JSON.stringify(expectedLabels) || ownLabels.some(id => JSON.stringify(index.metadata?.labels?.[id]?.title) !== JSON.stringify(LABELS[id]))) throw new Error('Missing visible DSH labels: ' + plugin.name);
    for (const language of ['en', 'zh']) {
      const original = presentation.description?.[language];
      const star = hasStars ? '★ ' + new Intl.NumberFormat(language === 'zh' ? 'zh-CN' : 'en-US').format(repo.stars) : undefined;
      const expected = star ? star + (original ? ' │ ' + original : '') : original;
      if (plugin.description?.[language] !== expected) throw new Error('Missing visible DSH metrics: ' + plugin.name);
    }
    const publisher = publishers?.entries.find(entry => entry.packages.includes(plugin.name) && entry.repository.toLowerCase() === plugin.repository?.url?.toLowerCase());
    const identities = (plugin.metadata?.labels ?? []).filter(id => id.startsWith('publisher-'));
    if (publishers && JSON.stringify(identities) !== JSON.stringify(publisher ? ['publisher-' + publisher.id] : [])) throw new Error('Publisher identity mismatch: ' + plugin.name);
    if (publisher && JSON.stringify(index.metadata.labels['publisher-' + publisher.id]?.title) !== JSON.stringify(publisher.title)) throw new Error('Publisher title mismatch: ' + plugin.name);
    counts.stars += Number(Boolean(hasStars));
    counts.downloads += Number(Boolean(hasDownloads));
    counts.identities += identities.length;
  }
  return counts;
}

async function readUrl(url, fetchImpl, maxBytes = 8 * 1024 * 1024) {
  // The dshopen.org Worker skips this user agent when counting index reads.
  const response = await fetchImpl(url, {redirect: 'error', headers: {'user-agent': 'dshopen-check'}, signal: AbortSignal.timeout(30000)});
  if (!response.ok || !response.body) throw new Error('HTTP ' + response.status + ': ' + url);
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > maxBytes) throw new Error('Response exceeds byte limit: ' + url);
    chunks.push(chunk);
  }
  return {bytes: Buffer.concat(chunks), type: response.headers.get('content-type') ?? ''};
}

/** Check the deployed catalog and every referenced author icon, without redirects. */
export async function checkPublished(indexUrl, {expectedNames, expectedTitle, verifyMarket = false, publishers, maintainerReviews, fetchImpl = fetch, brandAssets = []} = {}) {
  const raw = await readUrl(indexUrl, fetchImpl);
  if (!/application\/json/i.test(raw.type)) throw new Error('Index is not served as JSON');
  const index = JSON.parse(raw.bytes);
  if (index.format !== 1 || !Array.isArray(index.plugins) || !index.plugins.length) throw new Error('Missing format-1 plugins');
  const names = index.plugins.map(plugin => plugin.name);
  if (new Set(names).size !== names.length) throw new Error('Published package names are duplicated');
  if (expectedNames && JSON.stringify([...names].sort()) !== JSON.stringify([...expectedNames].sort())) throw new Error('Published catalog differs from the source allowlist');
  if (expectedTitle && JSON.stringify(index.title) !== JSON.stringify(expectedTitle)) throw new Error('Published market title differs from this release');
  let market;
  const status = JSON.parse((await readUrl(new URL('status.json', indexUrl), fetchImpl)).bytes);
  if (verifyMarket) {
    const snapshots = await Promise.all(['github.json', 'downloads.json', 'display.json'].map(async path => JSON.parse((await readUrl(new URL(path, indexUrl), fetchImpl)).bytes)));
    market = checkMarketDisplay(index, ...snapshots, publishers, {maintainerReviews, packageEvidence: status});
  }
  if (status.market?.recommendations) {
    const recommendations = JSON.parse((await readUrl(new URL('recommendations.json', indexUrl), fetchImpl)).bytes);
    checkRecommendationSnapshot(index, recommendations);
  }
  for (const plugin of index.plugins) {
    const record = status.packages?.find(item => item.name === plugin.name);
    if (!record || record.version !== plugin.versions?.[0]?.version || !record.checks?.includes('sha512-integrity') || !record.checks.includes('bundle-patch-present')) throw new Error('Missing package evidence: ' + plugin.name);
    const source = plugin.versions[0].source;
    if (source.type === 'git' && (!record.checks.includes('git-commit-pinned') || record.source?.url !== source.url || record.source?.commit !== source.commit || record.source?.path !== source.path)) throw new Error('Git source evidence mismatch: ' + plugin.name);
  }
  const icons = [...new Set(index.plugins.map(plugin => plugin.icon).filter(Boolean))];
  let next = 0;
  await Promise.all(Array.from({length: Math.min(8, icons.length)}, async () => {
    while (next < icons.length) {
      const icon = icons[next++];
      const match = /^icons\/([a-f0-9]{64})\.(svg|png|jpg|webp)$/.exec(icon);
      if (!match) throw new Error('Unexpected icon path: ' + icon);
      const result = await readUrl(new URL(icon, indexUrl), fetchImpl, 256 * 1024);
      const type = {svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp'}[match[2]];
      if (!result.type.toLowerCase().startsWith(type)) throw new Error('Unexpected icon content type: ' + icon);
      if (digest(result.bytes) !== match[1]) throw new Error('Icon hash mismatch: ' + icon);
    }
  }));
  // Every site language: the directory lists the whole index, the first cards in the page and the rest in the catalog
  // file it names, and the first plugin has its own page.
  const cards = html => (html.match(/\bdata-plugin(?=[\s>])/g) ?? []).length;
  for (const language of ['', 'zh/', 'zh-tw/']) {
    const pageUrl = new URL(language || './', indexUrl);
    const page = (await readUrl(pageUrl, fetchImpl)).bytes.toString('utf8');
    const rest = /\bdata-rest="([^"]+)"/.exec(page)?.[1]?.replaceAll('&amp;', '&');
    const restCards = rest ? cards(JSON.parse((await readUrl(new URL(rest, pageUrl), fetchImpl, 16 * 1024 * 1024)).bytes.toString('utf8')).html) : 0;
    if (cards(page) + restCards !== index.plugins.length || !page.includes('assets/mark-256.png')) throw new Error('Website does not match published index: ' + language);
    const first = index.plugins[0]?.name;
    if (first) {
      const packagePath = first.split('/').map(encodeURIComponent).join('/');
      const pluginPage = (await readUrl(new URL(`${language}plugins/${packagePath}/`, indexUrl), fetchImpl)).bytes.toString('utf8');
      if (!pluginPage.includes(`data-get="${first}"`)) throw new Error('Plugin page does not match published index: ' + language + first);
    }
  }
  for (const asset of brandAssets) {
    const published = await readUrl(new URL('assets/' + asset.name, indexUrl), fetchImpl, 2 * 1024 * 1024);
    if (digest(published.bytes) !== digest(asset.bytes)) throw new Error('Brand asset differs from this release: ' + asset.name);
  }
  return {plugins: index.plugins.length, pluginsWithIcons: index.plugins.filter(plugin => plugin.icon).length, uniqueIcons: icons.length, brandAssets: brandAssets.length, ...(market ? {market} : {}), indexUrl: String(indexUrl), redirectedRequests: false};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = JSON.parse(await readFile(new URL('../data/sources.json', import.meta.url), 'utf8'));
  const brandAssets = await Promise.all(['logo.webp', 'logo-256.png', 'mark-256.png', 'badge-logo.png', 'favicon.png', 'apple-touch-icon.png', 'social.png', 'social-zh.png', 'social-tw.png'].map(async name => ({name, bytes: await readFile(new URL('../site/' + name, import.meta.url))})));
  const publishers = JSON.parse(await readFile(new URL('../data/publishers.json', import.meta.url), 'utf8'));
  const maintainerReviews = JSON.parse(await readFile(new URL('../data/maintainer-reviews.json', import.meta.url), 'utf8'));
  await withRetries(async ([indexUrl = 'https://polang233.github.io/dsh-plugin-index/index.json']) => {
    // Packages the build had to leave out are listed in status.json; every other source must be published.
    const status = await fetch(new URL('status.json', indexUrl), {redirect: 'error', signal: AbortSignal.timeout(30_000)}).then(response => response.ok ? response.json() : {}).catch(() => ({}));
    const leftOut = new Set((status.failures ?? []).filter(failure => !failure.retained).map(failure => failure.name));
    const result = await checkPublished(indexUrl, {expectedNames: config.packages.map(input => input.name).filter(name => !leftOut.has(name)), expectedTitle: config.title, verifyMarket: true, publishers, maintainerReviews, brandAssets});
    console.log(JSON.stringify(result));
  });
}
