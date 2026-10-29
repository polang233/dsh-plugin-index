const MAX_INDEX_BYTES = 25 * 1024 * 1024;

async function readBounded(response, maxBytes) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) throw new Error('Index is too large');
  // Use the platform's native body decoder for fetched responses. Its stream
  // chunks can differ from those produced by a locally constructed Response.
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error('Index is too large');
  return bytes;
}

async function fetchVerified(url, expectedHash, options, cancelled) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  cancelled.addEventListener('abort', cancel, { once: true });
  if (cancelled.aborted) cancel();
  const timer = setTimeout(cancel, options.timeoutMs);
  try {
    const response = await options.fetch(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'dshopen-check' },
    });
    if (response.status !== 200) throw new Error(`Index source returned HTTP ${response.status}`);
    const bytes = await readBounded(response, options.maxBytes);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== expectedHash) throw new Error('Index does not match this release');
    return bytes;
  } catch (error) {
    controller.abort();
    throw error;
  } finally {
    clearTimeout(timer);
    cancelled.removeEventListener('abort', cancel);
  }
}

/**
 * Pick the first reachable source containing the index for this release.
 * `snapshot` is an immutable copy packaged with the same release.
 */
export async function selectCatalog({
  sources,
  snapshot,
  expectedHash,
  country,
  fetch: fetchImpl = fetch,
  timeoutMs = 4_000,
  hedgeDelayMs = 400,
  maxBytes = MAX_INDEX_BYTES,
}) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash ?? '')) throw new Error('Invalid release hash');
  for (const value of [sources?.cloudflare, sources?.github, snapshot]) {
    if (typeof value !== 'string' || new URL(value).protocol !== 'https:') throw new Error('Invalid index source');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(hedgeDelayMs) || hedgeDelayMs < 0 || !Number.isInteger(maxBytes) || maxBytes <= 0) throw new Error('Invalid routing limits');

  const order = country === 'CN' ? ['github', 'cloudflare'] : ['cloudflare', 'github'];
  const options = { fetch: fetchImpl, timeoutMs, maxBytes };
  const cancelled = new AbortController();
  const first = fetchVerified(sources[order[0]], expectedHash, options, cancelled.signal)
    .then(bytes => ({ source: order[0], bytes }));
  let started = false;
  let timer;
  let startSecond;
  const second = new Promise((resolve, reject) => {
    startSecond = () => {
      if (started || cancelled.signal.aborted) return;
      started = true;
      clearTimeout(timer);
      fetchVerified(sources[order[1]], expectedHash, options, cancelled.signal)
        .then(bytes => resolve({ source: order[1], bytes }), reject);
    };
    timer = setTimeout(startSecond, hedgeDelayMs);
  });
  first.catch(startSecond);
  try {
    return await Promise.any([first, second]);
  } catch {
    return { source: 'snapshot', bytes: await fetchVerified(snapshot, expectedHash, options, cancelled.signal) };
  } finally {
    clearTimeout(timer);
    cancelled.abort();
  }
}
