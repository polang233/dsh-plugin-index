import { voterFingerprint } from './visitor-identity.js';

const encoder = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(n => n.toString(16).padStart(2, '0')).join('');
async function macKey(secret, usage) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Invalid gateway secret');
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}
async function message(time, voter, body) {
  return encoder.encode(`like-v1\n${time}\nPOST\n/api/like\n${voter}\n${hex(await crypto.subtle.digest('SHA-256', body))}`);
}

export async function signedLikeRequest(request, { endpoint, secret, visitorSalt, ip, now = Date.now() }) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.pathname !== '/api/like' || url.search || url.hash || url.username || url.password) throw new Error('Invalid like endpoint');
  const body = await request.arrayBuffer();
  if (body.byteLength > 2048) throw new Error('Like body too large');
  const time = String(Math.floor(now / 1000));
  const voter = await voterFingerprint({ salt: visitorSalt, day: new Date(now).toISOString().slice(0, 10), ip });
  const signature = await crypto.subtle.sign('HMAC', await macKey(secret, 'sign'), await message(time, voter, body));
  return new Request(url.toString(), { method: 'POST', body, headers: {
    'content-type': request.headers.get('content-type') ?? 'application/json',
    'x-dsh-voter': voter, 'x-dsh-like-time': time, 'x-dsh-like-signature': hex(signature),
  } });
}

export async function verifySignedLike(request, { secret, now = Date.now() }) {
  const time = request.headers.get('x-dsh-like-time') ?? '';
  const voter = request.headers.get('x-dsh-voter') ?? '';
  const signature = request.headers.get('x-dsh-like-signature') ?? '';
  if (request.method !== 'POST' || new URL(request.url).pathname !== '/api/like' || !/^\d{10}$/.test(time) || !/^[a-f0-9]{24}$/.test(voter) || !/^[a-f0-9]{64}$/.test(signature) || Math.abs(Math.floor(now / 1000) - Number(time)) > 120) return null;
  try {
    const body = await request.clone().arrayBuffer();
    if (body.byteLength > 2048) return null;
    const given = Uint8Array.from(signature.match(/../g), pair => Number.parseInt(pair, 16));
    return await crypto.subtle.verify('HMAC', await macKey(secret, 'verify'), given, await message(time, voter, body)) ? voter : null;
  } catch { return null; }
}
