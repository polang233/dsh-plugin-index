import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {validateBrandNames} from './catalog-copy.mjs';
import {buildIndex} from './lib.mjs';
import {assertNotWithdrawn, readWithdrawn} from './withdrawn.mjs';

// Inspect only the accepted submissions. Never install plugins or overwrite public/.
const reviewPath = process.argv[2];
if (!reviewPath) throw new Error('Usage: node scripts/preview-submissions.mjs <review.json>');
const review = JSON.parse(await readFile(reviewPath, 'utf8'));
if (review.schema !== 1 || !Array.isArray(review.entries) || !review.entries.length
  || review.entries.some(entry => !Number.isSafeInteger(entry.issue) || entry.issue < 1
    || typeof entry.name !== 'string' || !entry.name
    || typeof entry.reply !== 'string' || !entry.reply.trim())) {
  throw new Error('Review must contain issue numbers, package names and reply drafts');
}
const config = JSON.parse(await readFile(new URL('../data/sources.json', import.meta.url), 'utf8'));
assertNotWithdrawn(review.entries.map(({name}) => name), await readWithdrawn());
const byName = new Map(config.packages.map(entry => [entry.name, entry]));
const packages = review.entries.map(({name}) => {
  const entry = byName.get(name);
  if (!entry) throw new Error('Submission is missing from sources: ' + name);
  return entry;
});
const selected = {...config, packages};
validateBrandNames(selected, JSON.parse(await readFile(new URL('../data/brand-names.json', import.meta.url), 'utf8')));
const built = await buildIndex(selected);
const output = new URL('../.local/submission-preview/', import.meta.url);
await mkdir(new URL('icons/', output), {recursive: true});
for (const asset of built.assets) await writeFile(new URL(asset.path, output), asset.bytes);
const summary = {
  catalogSizeAfterCommit: config.packages.length,
  generatedAt: built.evidence.generatedAt,
  submissions: built.index.plugins.map(plugin => ({
    name: plugin.name, title: plugin.title, description: plugin.description,
    ...plugin.versions[0],
    license: built.evidence.packages.find(entry => entry.name === plugin.name).license
  })),
  replies: review.entries.map(({issue, name, replyLanguage, reply, postedComment, issueState}) => ({issue, name, replyLanguage, reply, postedComment, issueState}))
};
for (const [name, value] of Object.entries({'index.json': built.index, 'status.json': built.evidence, 'summary.json': summary})) {
  await writeFile(new URL(name, output), JSON.stringify(value, null, 2) + '\n');
}
console.log(JSON.stringify({output: output.pathname, catalogSizeAfterCommit: summary.catalogSizeAfterCommit,
  checked: summary.submissions.map(({name, version, source, engines, license}) => ({name, version, source: source.type, engines, license}))}, null, 2));
