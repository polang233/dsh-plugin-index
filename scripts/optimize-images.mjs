// Turns the full-size originals in site/originals and docs/images/originals into the
// smaller lossless WebP files the site and README load. Originals stay in the repo.
// Usage: node scripts/optimize-images.mjs [logo home-en home-zh ...]
// Needs `sharp`; e.g. `npm i --no-save sharp`, or set SHARP_PATH.
import { copyFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let sharp;
try { ({ default: sharp } = await import(process.env.SHARP_PATH ?? 'sharp')); }
catch { console.error('sharp is not installed. Run `npm i --no-save sharp` or set SHARP_PATH.'); process.exit(1); }

const root = fileURLToPath(new URL('..', import.meta.url));
const selected = new Set(process.argv.slice(2));
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
    if (/-old$/i.test(name) || (selected.size && !selected.has(name))) continue;
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

// Every small brand asset comes from the same master, including the DSH package icon.
if (!selected.size || selected.has('logo')) {
  const master = join(root, 'site/originals/logo.png');
  const icon = size => sharp(master)
    .resize({ width: size, height: size, fit: 'contain', background: '#00000000', withoutEnlargement: true })
    .png({ compressionLevel: 9, adaptiveFiltering: true });
  // Bing only shows favicons whose size is a multiple of 48.
  for (const [name, size] of [['logo-256.png', 256], ['apple-touch-icon.png', 180], ['favicon.png', 96]]) {
    const output = join(root, 'site', name);
    await icon(size).toFile(output);
    console.log(`site/${name}  ${size}x${size}  ${Math.round((await stat(output)).size / 1024)} KB`);
  }
  // Crawlers that ignore <link rel="icon"> fetch /favicon.ico; PNG frames inside an ICO are widely supported.
  const frames = await Promise.all([16, 32, 48].map(async size => ({ size, png: await icon(size).toBuffer() })));
  const header = Buffer.alloc(6 + 16 * frames.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach(({ size, png }, i) => {
    const at = 6 + 16 * i;
    header.writeUInt8(size, at);
    header.writeUInt8(size, at + 1);
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(png.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  await writeFile(join(root, 'site/favicon.ico'), Buffer.concat([header, ...frames.map(frame => frame.png)]));
  console.log(`site/favicon.ico  16/32/48  ${Math.round(offset / 1024)} KB`);
  await copyFile(join(root, 'site/logo-256.png'), join(root, 'packages/dsh-open-market/icon.png'));
  console.log('packages/dsh-open-market/icon.png  copied from site/logo-256.png');
  // Keep the directory's fallback portrait in the same character design as the logo.
  const { width, height } = await sharp(master).metadata();
  const portrait = sharp(master).extract({
    left: Math.round(width * .075), top: Math.round(height * .055),
    width: Math.round(width * .68), height: Math.round(height * .68),
  });
  await portrait.clone().webp({ lossless: true, effort: 6 })
    .toFile(join(root, 'site/originals/placeholder-whale.webp'));
  await portrait.resize({ width: 192 }).webp({ lossless: true, effort: 6 })
    .toFile(join(root, 'site/placeholder-whale.webp'));
  console.log('site/placeholder-whale.webp  192px portrait from the logo master');
}
