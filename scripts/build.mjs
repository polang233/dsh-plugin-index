import {validateBrandNames} from './catalog-copy.mjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { collectGitHub, collectStarHistory, publishedSnapshot } from './github.mjs';
import { collectDownloads } from './downloads.mjs';
import { applyMarketDisplay } from './market-display.mjs';
import { writeSite } from './site.mjs';
import { buildIndex, releasesOf } from './lib.mjs';
import { collectEndorsements } from './endorsements.mjs';
import { assertNotWithdrawn, readWithdrawn } from './withdrawn.mjs';
import { trackAdded } from './added.mjs';

async function readJson(url) {
  try { return JSON.parse(await readFile(url, 'utf8')); } catch { return undefined; }
}

async function readSnapshot(url) {
  try {
    const value = JSON.parse(await readFile(url, 'utf8'));
    return value.schema === 1 && value.repositories ? value : undefined;
  } catch { return undefined; }
}

const config = JSON.parse(await readFile(new URL('../data/sources.json', import.meta.url), 'utf8'));
validateBrandNames(config, JSON.parse(await readFile(new URL('../data/brand-names.json', import.meta.url), 'utf8')));
assertNotWithdrawn(config.packages.map(entry => entry.name), await readWithdrawn());
const output = new URL('../public/', import.meta.url);
// The last published catalog lets a package that fails today keep its last good release instead of blocking everyone.
const PUBLISHED = 'https://polang233.github.io/dsh-plugin-index/';
const previousIndex = await publishedSnapshot('index.json', { base: PUBLISHED }) ?? await readJson(new URL('index.json', output));
const previousEvidence = await publishedSnapshot('status.json', { base: PUBLISHED }) ?? await readJson(new URL('status.json', output));
const built = await buildIndex(config, { previous: { index: previousIndex, evidence: previousEvidence, base: PUBLISHED } });
for (const failure of built.evidence.failures) {
  console.warn(`::warning title=Package check failed::${failure.name} ${failure.retained ? `kept at ${failure.version}` : 'left out'} since ${failure.since}: ${failure.error}`);
}
const cache = new URL('../.cache/', import.meta.url);
const previous = await readSnapshot(new URL('github.json', cache)) ?? await publishedSnapshot('github.json') ?? await readSnapshot(new URL('github.json', output));
const github = await collectGitHub(built.index, { previous });
let previousDownloads;
for (const root of [cache, output]) {
  try { previousDownloads = JSON.parse(await readFile(new URL('downloads.json', root), 'utf8')); break; } catch { /* Next source. */ }
}
const downloads = await collectDownloads(built.index, { previous: previousDownloads });
const endorsements = await collectEndorsements({ previous: await readJson(new URL('endorsements.json', cache)) ?? await publishedSnapshot('endorsements.json') ?? await readJson(new URL('endorsements.json', output)) });
const publishers = JSON.parse(await readFile(new URL('../data/publishers.json', import.meta.url), 'utf8'));
const maintainerReviews = JSON.parse(await readFile(new URL('../data/maintainer-reviews.json', import.meta.url), 'utf8'));
const previousRecommendations = await publishedSnapshot('recommendations.json') ?? await readJson(new URL('recommendations.json', output));
const added = trackAdded(built.index.plugins.map(plugin => plugin.name), await publishedSnapshot('added.json') ?? await readJson(new URL('added.json', output)));
const { index, display, recommendations } = applyMarketDisplay(built.index, { github, downloads, releases: releasesOf(built.evidence), endorsements, publishers, maintainerReviews, packageEvidence: built.evidence, previousRecommendations, added, now: Date.parse(downloads.generatedAt) });
const states = Object.values(github.repositories);
const evidence = {
  ...built.evidence,
  market: { generatedAt: display.generatedAt, downloads: 'downloads.json', display: 'display.json', recommendations: 'recommendations.json', publisherEvidence: 'https://github.com/polang233/dsh-plugin-index/blob/main/data/publishers.json', reviewEvidence: 'https://github.com/polang233/dsh-plugin-index/blob/main/data/maintainer-reviews.json' },
  github: {
    snapshot: 'github.json',
    fetched: states.filter(repo => repo.status === 'ok').length,
    cached: states.filter(repo => repo.status === 'stale').length,
    unavailable: states.filter(repo => repo.status === 'unavailable').length
  }
};
// All package downloads and validation finish before touching the last successful output.
await mkdir(output, { recursive: true });
await mkdir(cache, { recursive: true });
await mkdir(new URL('icons/', output), { recursive: true });
for (const asset of new Map(built.assets.map(asset => [asset.path, asset])).values()) {
  await writeFile(new URL(asset.path, output), asset.bytes);
}
await writeFile(new URL('index.json', output), `${JSON.stringify(index, null, 2)}\n`);
await writeFile(new URL('status.json', output), `${JSON.stringify(evidence, null, 2)}\n`);
await writeFile(new URL('github.json', output), `${JSON.stringify(github, null, 2)}\n`);
await writeFile(new URL('github.json', cache), `${JSON.stringify(github, null, 2)}\n`);
await writeFile(new URL('downloads.json', output), `${JSON.stringify(downloads, null, 2)}\n`);
await writeFile(new URL('downloads.json', cache), `${JSON.stringify(downloads, null, 2)}\n`);
await writeFile(new URL('endorsements.json', output), `${JSON.stringify(endorsements, null, 2)}\n`);
await writeFile(new URL('endorsements.json', cache), `${JSON.stringify(endorsements, null, 2)}\n`);
await writeFile(new URL('display.json', output), `${JSON.stringify(display, null, 2)}\n`);
await writeFile(new URL('recommendations.json', output), `${JSON.stringify(recommendations, null, 2)}\n`);
await writeFile(new URL('added.json', output), `${JSON.stringify(added, null, 2)}\n`);
// The project's own stars over time, for the stats page; an offline or failed run keeps the published history.
// data/star-history.json seeds the history from before builds could read it.
const stars = await collectStarHistory('polang233/dsh-plugin-index', { previous: await publishedSnapshot('stars.json') ?? await readJson(new URL('stars.json', output)) ?? await readJson(new URL('../data/star-history.json', import.meta.url)) });
if (stars) await writeFile(new URL('stars.json', output), `${JSON.stringify(stars)}\n`);
await writeSite(index, evidence, github, downloads, display);
console.log(`Generated format-1 index: ${index.plugins.length} plugins; official validator ${evidence.validator.version}; ${built.evidence.failures.length} failing packages.`);
console.log(`GitHub metadata: ${evidence.github.fetched} fetched, ${evidence.github.cached} cached, ${evidence.github.unavailable} unavailable.`);
