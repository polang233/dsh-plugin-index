// Turns the full-size originals in site/originals and docs/images/originals into the
// smaller lossless WebP files the site and README load. Originals stay in the repo.
// Usage: node scripts/optimize-images.mjs  (needs `sharp`; e.g. `npm i --no-save sharp`)
import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let sharp;
try { ({ default: sharp } = await import(process.env.SHARP_PATH ?? 'sharp')); }
catch { console.error('sharp is not installed. Run `npm i --no-save sharp` or set SHARP_PATH.'); process.exit(1); }

const root = fileURLToPath(new URL('..', import.meta.url));
// Display width at 2x density; anything already smaller keeps its size.
const widths = [
  [/^guide-/, 900],
  [/^dsh-discover-.*narrow/, 800],
  [/^dsh-discover-/, 1600],
  [/^placeholder-whale/, 192],
  [/^logo$/, 720],
  [/^home-/, 1440],
  [/^add-index/, 1120],
  [/^catalog-/, 1440],
];

for (const [from, to] of [['site/originals', 'site'], ['docs/images/originals', 'docs/images']]) {
  for (const file of await readdir(join(root, from))) {
    if (!/\.(png|webp|jpe?g)$/i.test(file)) continue;
    const name = basename(file, extname(file));
    const width = widths.find(([pattern]) => pattern.test(name))?.[1];
    const output = join(root, to, `${name}.webp`);
    await sharp(join(root, from, file))
      .resize(width ? { width, withoutEnlargement: true } : undefined)
      .webp({ lossless: true, effort: 6 })
      .toFile(output);
    const [before, after] = await Promise.all([stat(join(root, from, file)), stat(output)]);
    console.log(`${to}/${name}.webp  ${Math.round(before.size / 1024)} KB -> ${Math.round(after.size / 1024)} KB`);
  }
}
