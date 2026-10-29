import { checkedReadEvent } from './read-event.js';

const encoder = new TextEncoder();
const MAX_BODY_BYTES = 2048;
const PATHS = new Set(['/internal/read', '/internal/config']);

function checkSecret(secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Invalid gateway secret');
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function signatureInput(timestamp, bytes, path) {
  const digest = hex(await crypto.subtle.digest('SHA-256', bytes));
  return encoder.encode(`v1\n${timestamp}\nPOST\n${path}\n${digest}`);
}

async function key(secret, usages) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

async function readBounded(request) {
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new Error('Request too large');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing request body');
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) throw new Error('Request too large');
      chunks.push(value);
    }
  } catch (error) {
    try { await reader.cancel(); } catch { /* The stream may already be closed. */ }
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

export async function signedReadRequest(event, { endpoint, secret, now = Date.now() }) {
  checkSecret(secret);
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || !PATHS.has(url.pathname) || url.search || url.hash) throw new Error('Invalid counter endpoint');
  const timestamp = String(Math.floor(now / 1000));
  if (!/^\d{10}$/.test(timestamp)) throw new Error('Invalid signing time');
  const bytes = encoder.encode(JSON.stringify(checkedReadEvent(event)));
  const signature = await crypto.subtle.sign('HMAC', await key(secret, ['sign']), await signatureInput(timestamp, bytes, url.pathname));
  return new Request(url, { method: 'POST', headers: {
    'content-type': 'application/json',
    'x-dsh-time': timestamp,
    'x-dsh-signature': hex(signature),
  }, body: bytes });
}

// Authentication failures intentionally share one result and never include client data.
export async function verifySignedRead(request, { secret, now = Date.now(), maxSkewSeconds = 120 }) {
  checkSecret(secret);
  if (!Number.isFinite(now) || !Number.isInteger(maxSkewSeconds) || maxSkewSeconds < 0 || maxSkewSeconds > 600) throw new Error('Invalid signing window');
  const url = new URL(request.url);
  const timestamp = request.headers.get('x-dsh-time') ?? '';
  const signature = request.headers.get('x-dsh-signature') ?? '';
  if (request.method !== 'POST' || !PATHS.has(url.pathname) || url.search || !/^\d{10}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature) || Math.abs(Math.floor(now / 1000) - Number(timestamp)) > maxSkewSeconds) return null;
  try {
    const bytes = await readBounded(request);
    const given = Uint8Array.from(signature.match(/../g), pair => Number.parseInt(pair, 16));
    if (!await crypto.subtle.verify('HMAC', await key(secret, ['verify']), given, await signatureInput(timestamp, bytes, url.pathname))) return null;
    return checkedReadEvent(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  } catch { return null; }
}
