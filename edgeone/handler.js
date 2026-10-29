import { getStore } from '@edgeone/pages-blob';
import { serveIndex } from './lib/index-gateway.js';
import { replayQueuedReads } from './lib/read-queue.js';
import { signedReadRequest } from '../shared/signed-read.js';
import { signedLikeRequest } from '../shared/signed-like.js';
import release from './release.json';

async function timedFetch(input, init = {}, milliseconds = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), milliseconds);
  try { return await fetch(input, { ...init, signal: controller.signal, redirect: 'manual' }); }
  finally { clearTimeout(timer); }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const waitUntil = task => context.waitUntil(task);
  const origin = release.cloudflareOrigin;
  const store = getStore({ name: 'dshopen-read-queue', consistency: 'strong' });
  const secret = env.GATEWAY_AUTH_SECRET;
  if (url.pathname === '/api/network-health') return new Response(JSON.stringify({ release: release.expectedHash, sources: ['cloudflare', 'github'], snapshot: true }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  if (url.pathname === '/api/replay-reads') {
    if (request.method !== 'POST' || request.headers.get('authorization') !== `Bearer ${secret}` || !secret) return new Response('Unauthorized', { status: 401 });
    const deliver = async event => {
      const signed = await signedReadRequest(event, { endpoint: origin + '/internal/read', secret });
      const response = await timedFetch(signed);
      if (!response.ok || (await response.json()).accepted !== true) throw new Error('Read not acknowledged');
    };
    const input = await request.json().catch(() => ({}));
    const result = await replayQueuedReads({ store, deliver, limit: 25, continuation: input.continuation ?? null });
    return new Response(JSON.stringify(result), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
  if (url.pathname === '/index.json') {
    const config = {
      release: { sources: { cloudflare: origin + '/index.json', github: release.githubIndex }, expectedHash: release.expectedHash, snapshot: url.origin + release.snapshotPath },
      visitorSalt: env.VISITOR_SALT, gatewaySecret: secret, counterEndpoint: origin + '/internal/read',
    };
    if (request.method === 'HEAD') {
      return new Response(null, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'x-dsh-release': release.expectedHash } });
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD' } });
    try { return await serveIndex(request, config, { cache: caches.default, store, waitUntil }); }
    catch (error) {
      console.error('Index gateway failed', error?.name ?? 'Error');
      const diagnostic = secret && request.headers.get('authorization') === `Bearer ${secret}`;
      return new Response(JSON.stringify(diagnostic ? { error: error?.name, detail: String(error?.message ?? '').slice(0, 200) } : { error: 'temporarily-unavailable' }), { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
    }
  }
  if (url.pathname.startsWith('/internal/')) return new Response('Not found', { status: 404 });
  const api = ['/stats.json', '/likes.json', '/api/like', '/api/stars'].includes(url.pathname) || url.pathname.startsWith('/badge/');
  if (!api) return new Response('Not found', { status: 404 });
  let upstream;
  if (url.pathname === '/api/like' && request.method === 'POST') {
    upstream = await signedLikeRequest(request, { endpoint: origin + '/api/like', secret, visitorSalt: env.VISITOR_SALT, ip: request.eo.clientIp });
  } else {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    upstream = new Request(origin + url.pathname + url.search, { method: request.method, headers: { accept: 'application/json', 'user-agent': 'dshopen-check' } });
  }
  try {
    const result = await timedFetch(upstream, {}, 8000);
    if (result.status >= 300 && result.status < 400) return new Response('Upstream unavailable', { status: 502 });
    return result;
  } catch { return new Response(JSON.stringify({ error: 'temporarily-unavailable' }), { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } }); }
}
