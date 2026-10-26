import {validateBrandNames} from './catalog-copy.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index';
import { collectGitHub, publishedSnapshot } from './github.mjs';
import { collectDownloads } from './downloads.mjs';
import { applyMarketDisplay } from './market-display.mjs';
import { writeSite } from './site.mjs';
import { releasesOf } from './lib.mjs';
import { collectEndorsements } from './endorsements.mjs';

const read = async path => JSON.parse(await readFile(new URL('../' + path, import.meta.url), 'utf8'));
const optional = async path => { try { return await read(path); } catch { return undefined; } };
const config = await read('data/sources.json');
validateBrandNames(config, await read('data/brand-names.json'));
const current = await read('public/index.json');
const evidence = await read('public/status.json');
const oldDisplay = await optional('public/display.json');
const byName = new Map(config.packages.map(source => [source.name, source]));
if (byName.size !== config.packages.length || current.plugins.length !== byName.size) throw new Error('Package allowlist changed; run pnpm build');
const plugins = current.plugins.map(plugin => {
  const source = byName.get(plugin.name);
  const checked = evidence.packages.find(record => record.name === plugin.name);
  if (!source || (source.version && source.version !== plugin.versions[0].version) || checked?.version !== plugin.versions[0].version || !checked.checks?.includes('sha512-integrity')) throw new Error('Unvalidated package version; run pnpm build: ' + plugin.name);
  const installed = plugin.versions[0].source;
  const changedSource = source.source
    ? installed.type !== 'git' || installed.url !== source.source.url || installed.commit !== source.source.commit || checked.integrity !== source.source.integrity || Date.parse(source.source.publishedAt) !== plugin.versions[0].publishTimestamp * 1000
    : installed.type !== 'npm';
  if (changedSource) throw new Error('Package source changed; run pnpm build: ' + plugin.name);
  return { ...plugin, ...(source.title ? { title: source.title } : {}), description: source.description ?? oldDisplay?.plugins?.[plugin.name]?.description ?? plugin.description };
});
const base = { ...current, title: config.title, description: config.description, plugins };
parseMarketIndex(base, 'https://polang233.github.io/dsh-plugin-index/index.json');
const github = await collectGitHub(base, { previous: await optional('.cache/github.json') ?? await publishedSnapshot('github.json') ?? await optional('public/github.json') });
const downloads = await collectDownloads(base, { previous: await optional('.cache/downloads.json') ?? await optional('public/downloads.json') });
const endorsements = await collectEndorsements({ previous: await optional('.cache/endorsements.json') ?? await publishedSnapshot('endorsements.json') ?? await optional('public/endorsements.json') });
const previousRecommendations = await publishedSnapshot('recommendations.json') ?? await optional('public/recommendations.json');
const { index, display, recommendations } = applyMarketDisplay(base, { github, downloads, endorsements, releases: releasesOf(evidence), publishers: await read('data/publishers.json'), maintainerReviews: await read('data/maintainer-reviews.json'), packageEvidence: evidence, previousRecommendations, now: Date.parse(downloads.generatedAt) });
// Package validation timestamps remain unchanged during a metrics-only refresh.
evidence.market = { generatedAt: display.generatedAt, downloads: 'downloads.json', display: 'display.json', recommendations: 'recommendations.json', publisherEvidence: 'https://github.com/polang233/dsh-plugin-index/blob/main/data/publishers.json', reviewEvidence: 'https://github.com/polang233/dsh-plugin-index/blob/main/data/maintainer-reviews.json' };
const counts = Object.values(github.repositories);
evidence.github = { snapshot: 'github.json', fetched: counts.filter(record => record.status === 'ok').length, cached: counts.filter(record => record.status === 'stale').length, unavailable: counts.filter(record => record.status === 'unavailable').length };
await mkdir(new URL('../.cache/', import.meta.url), { recursive: true });
for (const [file, value] of Object.entries({ 'index.json': index, 'status.json': evidence, 'github.json': github, 'downloads.json': downloads, 'display.json': display, 'endorsements.json': endorsements, 'recommendations.json': recommendations })) await writeFile(new URL('../public/' + file, import.meta.url), JSON.stringify(value, null, 2) + '\n');
for (const [file, value] of Object.entries({ 'github.json': github, 'downloads.json': downloads, 'endorsements.json': endorsements })) await writeFile(new URL('../.cache/' + file, import.meta.url), JSON.stringify(value, null, 2) + '\n');
await writeSite(index, evidence, github, downloads, display);
console.log(JSON.stringify({ plugins: index.plugins.length, downloads: Object.values(downloads.packages).reduce((counts, record) => ({ ...counts, [record.status]: (counts[record.status] ?? 0) + 1 }), {}) }));
