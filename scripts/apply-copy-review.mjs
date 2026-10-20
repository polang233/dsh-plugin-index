import {readFile, writeFile} from 'node:fs/promises';

const path = process.argv[2];
if (!path) throw new Error('Usage: node scripts/apply-copy-review.mjs <review.json>');
const review = JSON.parse(await readFile(path, 'utf8'));
if (review.schema !== 1 || !Array.isArray(review.changes)) throw new Error('Invalid copy review');
const target = new URL('../data/sources.json', import.meta.url);
const config = JSON.parse(await readFile(target, 'utf8'));
const byName = new Map(config.packages.map(plugin => [plugin.name, plugin]));
let changed = 0;
for (const entry of review.changes) {
  const plugin = byName.get(entry.name);
  if (!plugin) throw new Error('Review requires a missing source: ' + entry.name);
  for (const [field, patch] of Object.entries(entry.fields)) {
    if (!['title', 'description'].includes(field)) throw new Error('Unsupported copy field: ' + field);
    if (JSON.stringify(plugin[field] ?? null) === JSON.stringify(patch.after)) continue;
    if (JSON.stringify(plugin[field] ?? null) !== JSON.stringify(patch.before)) throw new Error('Copy changed since review: ' + entry.name + '.' + field);
    plugin[field] = patch.after;
    changed++;
  }
}
await writeFile(target, JSON.stringify(config, null, 2) + '\n');
console.log(JSON.stringify({reviewed: review.reviewedCount, changedFields: changed}));
