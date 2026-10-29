import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const MAX_BYTES = 25 * 1024 * 1024;
const URLS = [
  'https://dshopen.org/index.json',
  'https://polang233.github.io/dsh-plugin-index/index.json',
];

async function readIndex(url) {
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
    headers: { accept: 'application/json', 'user-agent': 'dshopen-check' },
  });
  if (response.status !== 200) throw new Error(`${url}: HTTP ${response.status}`);
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > MAX_BYTES) throw new Error(`${url}: index exceeds ${MAX_BYTES} bytes`);
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  let index;
  try { index = JSON.parse(body.toString('utf8')); }
  catch { throw new Error(`${url}: invalid JSON`); }
  if (!Array.isArray(index?.plugins)) throw new Error(`${url}: missing plugins array`);
  return { length, plugins: index.plugins.length, sha256: createHash('sha256').update(body).digest('hex') };
}

export async function compareMirrors(urls = URLS) {
  if (urls.length !== 2) throw new Error('Exactly two index URLs are required');
  const results = await Promise.all(urls.map(readIndex));
  if (results[0].sha256 !== results[1].sha256) {
    throw new Error(`Published indexes differ: ${results.map(result => `${result.sha256} (${result.length} bytes)`).join(' vs ')}`);
  }
  return results[0];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  compareMirrors(process.argv.length > 2 ? process.argv.slice(2) : URLS).then(result => {
    console.log(`Published indexes match: ${result.sha256} (${result.length} bytes, ${result.plugins} plugins)`);
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
