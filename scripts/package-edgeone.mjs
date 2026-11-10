import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';

if (process.argv.length !== 4) throw new Error('Usage: node scripts/package-edgeone.mjs VALIDATED_ARTIFACT NEW_OUTPUT_DIRECTORY');
const [artifact, output] = process.argv.slice(2).map(value => resolve(value));
if (artifact === output) throw new Error('Output must differ from the validated artifact');
try { await access(output); throw new Error('Output directory must not exist'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const bytes = await readFile(join(artifact, 'index.json'));
if (!Array.isArray(JSON.parse(bytes).plugins)) throw new Error('Invalid validated catalog');
const expectedHash = createHash('sha256').update(bytes).digest('hex');
await mkdir(output, { recursive: true });
await cp(artifact, output, { recursive: true, filter: path => !['index.json', '_headers'].includes(path.slice(artifact.length + 1)) });
const snapshotPath = `/_catalog/${expectedHash}.json`;
await mkdir(join(output, '_catalog'));
await writeFile(join(output, snapshotPath), bytes);
// EdgeOne sends unmatched paths to the edge function, so it carries the site's 404 page: crawlers report a bare text reply as a page without a title.
const notFoundPage = await readFile(join(artifact, '404.html'), 'utf8');
const release = { expectedHash, snapshotPath, cloudflareOrigin: 'https://dshopen.polang.workers.dev', githubIndex: 'https://polang233.github.io/dsh-plugin-index/index.json', notFoundPage };
const headers = [];
for (const line of (await readFile(join(artifact, '_headers'), 'utf8')).split(/\r?\n/)) {
  if (!line.trim() || line.trimStart().startsWith('#')) continue;
  if (line.startsWith('/')) headers.push({ source: line.trim(), headers: [] });
  else {
    const at = line.indexOf(':');
    if (at > 0 && headers.length) headers.at(-1).headers.push({ key: line.slice(0, at).trim(), value: line.slice(at + 1).trim() });
  }
}
headers.push({ source: '/index.json', headers: [{ key: 'Cache-Control', value: 'no-store' }, { key: 'Access-Control-Allow-Origin', value: '*' }] });
await writeFile(join(output, 'edgeone.json'), JSON.stringify({ headers }, null, 2));
await mkdir(join(output, 'edge-functions'));
// A catch-all edge-functions/[[path]].js counted as a function run for nearly every request, static icons and
// pages included. Functions now cover only the routes the handler serves. Makers drops dots from file-based
// routes and never routes /index.json to a named matcher, so one-segment [file].js carries the root JSON files
// (and the HTML 404 for unknown root paths); deeper unknown paths get the platform's own 404.html.
const ROUTES = ['[file].js', 'api/[[default]].js', 'badge/[[default]].js'];
const releasePlugin = { name: 'release', setup(builder) {
  builder.onResolve({ filter: /\/release\.json$/ }, () => ({ path: 'release', namespace: 'release' }));
  builder.onLoad({ filter: /.*/, namespace: 'release' }, () => ({ contents: JSON.stringify(release), loader: 'json' }));
} };
for (const route of ROUTES) {
  await build({
    stdin: { contents: "export { onRequest } from './edgeone/handler.js';", resolveDir: process.cwd(), loader: 'js' },
    bundle: true, format: 'esm', platform: 'neutral', outfile: join(output, 'edge-functions', route), plugins: [releasePlugin],
  });
}
console.log(JSON.stringify({ output, expectedHash, bytes: bytes.length }));
