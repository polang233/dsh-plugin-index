import { readFile } from 'node:fs/promises';

// Pinned npm entries (repository or archive reviews) never follow `latest`. List the ones a newer release has passed.
const config = JSON.parse(await readFile(new URL('../data/sources.json', import.meta.url), 'utf8'));
const pinned = config.packages.filter(entry => entry.version && entry.source?.type !== 'git');
const behind = [];
for (const entry of pinned) {
  const response = await fetch(`https://registry.npmjs.org/${entry.name.replace('/', '%2F')}`, { headers: { accept: 'application/vnd.npm.install-v1+json' }, signal: AbortSignal.timeout(30_000) });
  const latest = response.ok ? (await response.json())['dist-tags']?.latest : undefined;
  if (latest && latest !== entry.version) {
    behind.push({ name: entry.name, pinned: entry.version, latest, reviews: ['iconReview', 'repositoryReview', 'archiveReview'].filter(key => entry[key]) });
  }
}
console.log(`${pinned.length} pinned npm entries; ${behind.length} behind latest.`);
for (const item of behind) console.log(JSON.stringify(item));
