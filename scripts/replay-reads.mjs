const secret = process.env.DSH_GATEWAY_AUTH_SECRET;
if (!secret || secret.length < 32) throw new Error('Gateway signing secret is required');
let continuation = null;
let delivered = 0;
for (let round = 0; round < 8; round++) {
  const response = await fetch('https://network-probe.dshopen.org/api/replay-reads', { method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ continuation }), signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Queue replay failed: HTTP ${response.status}`);
  const result = await response.json();
  delivered += result.delivered;
  if (result.failed) throw new Error(`Queue delivery is unavailable; ${result.failed} events retained for retry`);
  continuation = result.continuation;
  if (!continuation) break;
}
console.log(`Replayed ${delivered} queued reads`);
