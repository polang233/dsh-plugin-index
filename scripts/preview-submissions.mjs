import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {validateBrandNames} from './catalog-copy.mjs';
import {buildIndex} from './lib.mjs';
import {catalogSizeAfterAdding, normalizeEntries} from './submission-entries.mjs';
import {assertNotWithdrawn, readWithdrawn} from './withdrawn.mjs';

// Inspect only the accepted submissions. Never install plugins or overwrite public/.
// An entry without an issue number is a discovered candidate: it is checked against the
// index, but it is not in data/sources.json yet and gets no reply draft.
const reviewPath = process.argv[2];
if (!reviewPath) throw new Error('Usage: node scripts/preview-submissions.mjs <review.json>');
const review = JSON.parse(await readFile(reviewPath, 'utf8'));
const config = JSON.parse(await readFile(new URL('../data/sources.json', import.meta.url), 'utf8'));
const byName = new Map(config.packages.map(entry => [entry.name, entry]));
const entries = normalizeEntries(review, byName);
assertNotWithdrawn(entries.map(({name}) => name), await readWithdrawn());
const selected = {...config, packages: entries.map(({packageEntry}) => packageEntry)};
validateBrandNames(selected, JSON.parse(await readFile(new URL('../data/brand-names.json', import.meta.url), 'utf8')));
const built = await buildIndex(selected);
const output = new URL('../.local/submission-preview/', import.meta.url);
await mkdir(new URL('icons/', output), {recursive: true});
for (const asset of built.assets) await writeFile(new URL(asset.path, output), asset.bytes);
const summary = {
  catalogSizeAfterCommit: catalogSizeAfterAdding(config.packages.length, entries),
  generatedAt: built.evidence.generatedAt,
  submissions: built.index.plugins.map(plugin => ({
    name: plugin.name, title: plugin.title, description: plugin.description,
    ...plugin.versions[0],
    license: built.evidence.packages.find(entry => entry.name === plugin.name).license
  })),
  replies: entries.filter(entry => !entry.discovery)
    .map(({issue, name, replyLanguage, reply, postedComment, issueState}) => ({issue, name, replyLanguage, reply, postedComment, issueState})),
  discovered: entries.filter(entry => entry.discovery).map(({name}) => name)
};
for (const [name, value] of Object.entries({'index.json': built.index, 'status.json': built.evidence, 'summary.json': summary})) {
  await writeFile(new URL(name, output), JSON.stringify(value, null, 2) + '\n');
}
const checked = summary.submissions.map(({name, version, source, engines, license}) => ({name, version, source: source.type, engines, license}));
console.log(JSON.stringify({
  output: output.pathname,
  catalogSizeAfterCommit: summary.catalogSizeAfterCommit,
  checked,
  ...(summary.discovered.length ? {discovered: summary.discovered, validate: 'node scripts/validate.mjs .local/submission-preview/index.json'} : {})
}, null, 2));
