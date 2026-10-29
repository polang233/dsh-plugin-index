import { cachedCatalog } from './cached-catalog.js';
import { recordRead, replayQueuedReads } from './read-queue.js';
import { readerFingerprint } from '../../shared/visitor-identity.js';
import { signedReadRequest } from '../../shared/signed-read.js';

/**
 * Serve a verified index and record its read. This module is not a deployed
 * entry point; the caller supplies release configuration and platform bindings.
 */
export async function serveIndex(request, config, context) {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET' } });
  const country = /^[A-Z]{2}$/.test(request.eo?.geo?.countryCodeAlpha2 ?? '') ? request.eo.geo.countryCodeAlpha2 : 'XX';
  const fetchImpl = context.fetch ?? fetch;
  const selected = await cachedCatalog({ ...config.release, country, fetch: fetchImpl }, {
    cache: context.cache, waitUntil: context.waitUntil,
  });
  if (request.headers.get('user-agent') === 'dshopen-check') return selected.response;

  const now = context.now?.() ?? Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const visitor = await readerFingerprint({ salt: config.visitorSalt, day, ip: request.eo?.clientIp, userAgent: request.headers.get('user-agent') ?? '' });
  const event = { id: crypto.randomUUID(), day, visitor, country };
  const deliver = async value => {
    const signed = await signedReadRequest(value, { endpoint: config.counterEndpoint, secret: config.gatewaySecret, now: context.now?.() ?? Date.now() });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.counterTimeoutMs ?? 1500);
    try {
      const response = await fetchImpl(signed, { signal: controller.signal, redirect: 'error' });
      if (!response.ok) throw new Error('Counter unavailable');
      const result = await response.json();
      if (result?.accepted !== true) throw new Error('Counter did not acknowledge the read');
    } finally { clearTimeout(timer); }
  };
  // Analytics must not take the catalog offline when both storage providers fail.
  try { await recordRead(event, { store: context.store, deliver }); }
  catch { console.error('Read reporting unavailable'); }
  if (context.waitUntil && (context.random?.() ?? Math.random()) < 0.10) {
    context.waitUntil(replayQueuedReads({ store: context.store, deliver }).catch(() => {}));
  }
  return selected.response;
}
