// IndexNow tells Bing, Yandex, Naver, Seznam and Yep about changed pages at once instead of waiting for a crawl.
// The key is public by design: it only proves that the submitter controls the host, through the key file at the site root.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const INDEXNOW_KEY = 'a21bf6e24f22e9a7cf23afa7423a62c6';
export const INDEXNOW_HOST = 'dshopen.org';
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/IndexNow';
// The protocol accepts up to 10,000 URLs per request.
const BATCH = 10_000;

/**
 * URLs to submit: every page whose fingerprint is new or changed since the previous release, plus pages that change on
 * every build (home and stats). With no previous manifest, everything is submitted once.
 */
export function changedUrls(current, previous = {}) {
  const pages = current?.pages ?? {};
  const before = previous?.pages ?? {};
  return Object.entries(pages).filter(([url, hash]) => hash === null || before[url] !== hash).map(([url]) => url).sort();
}

export async function submit(urls, fetchImpl = fetch) {
  let sent = 0;
  for (let at = 0; at < urls.length; at += BATCH) {
    const urlList = urls.slice(at, at + BATCH);
    const response = await fetchImpl(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', 'user-agent': 'dshopen-indexnow' },
      body: JSON.stringify({ host: INDEXNOW_HOST, key: INDEXNOW_KEY, keyLocation: `https://${INDEXNOW_HOST}/${INDEXNOW_KEY}.txt`, urlList })
    });
    // 200 means accepted, 202 means accepted while the key is still being verified.
    if (![200, 202].includes(response.status)) throw new Error(`IndexNow rejected the submission: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
    sent += urlList.length;
  }
  return sent;
}

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return {}; throw error; }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [currentPath, previousPath] = process.argv.slice(2);
  if (!currentPath) throw new Error('Usage: node scripts/indexnow.mjs public/page-versions.json [previous-page-versions.json]');
  const current = await readJson(currentPath);
  if (!current.pages) throw new Error(`${currentPath} has no pages`);
  const urls = changedUrls(current, previousPath ? await readJson(previousPath) : {});
  if (!urls.length) console.log('No changed pages to submit.');
  else console.log(`Submitted ${await submit(urls)} changed URLs to IndexNow.`);
}
