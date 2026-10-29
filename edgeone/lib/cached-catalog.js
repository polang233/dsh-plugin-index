import { selectCatalog } from './catalog-routing.js';

/**
 * Cache only a previously verified release. The caller must run its own request
 * accounting before returning the response to the client.
 */
export async function cachedCatalog(options, { cache, waitUntil, maxAge = 300 }) {
  if (!/^[a-f0-9]{64}$/.test(options.expectedHash ?? '')) throw new Error('Invalid release hash');
  if (!Number.isInteger(maxAge) || maxAge < 1 || maxAge > 86400) throw new Error('Invalid cache duration');
  const key = new Request(`https://dsh-catalog-cache.invalid/${options.expectedHash}`);
  try {
    const hit = await cache.match(key);
    if (hit?.status === 200 && hit.headers.get('x-dsh-release') === options.expectedHash) {
      const response = new Response(hit.body, hit);
      response.headers.set('cache-control', 'no-store');
      return { response, source: 'cache' };
    }
  } catch { /* An expired or unavailable cache is a miss. */ }

  const selected = await selectCatalog(options);
  const cached = new Response(selected.bytes, { headers: {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'cache-control': `public, max-age=${maxAge}`,
    'x-dsh-release': options.expectedHash,
  } });
  try {
    const write = cache.put(key, cached.clone()).catch(() => {});
    if (waitUntil) waitUntil(write);
    else await write;
  } catch { /* A failed cache write must not block the catalog. */ }
  cached.headers.set('cache-control', 'no-store');
  return { response: cached, source: selected.source };
}
