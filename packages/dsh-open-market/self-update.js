import {runBundleUpdate} from './bundle-update.js';

export const SELF_PACKAGE = 'dsh-open-market';
export const SELF_UPDATE_PATH = '/dsh-open-market/self-update';

/** Update only this bundle, using an exact npm release or this repository's fixed package directory. */
export function selfUpdateTarget(value) {
  const spec = value?.spec;
  const npm = typeof spec === 'string' && /^dsh-open-market@((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/.exec(spec);
  const git = typeof spec === 'string' && /^git\+https:\/\/github\.com\/polang233\/dsh-plugin-index(?:\.git)?#[a-f0-9]{40}&path:\/packages\/dsh-open-market$/.test(spec);
  if (!npm && !git) throw new Error('Self-update requires an exact dsh-open-market release or its fixed Git source');
  let registry = value.registry;
  if (registry !== undefined && registry !== null) {
    const url = new URL(registry);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid registry');
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    registry = url.href;
  }
  return { spec, ...(registry === undefined ? {} : { registry }), ...(npm ? { version: npm[1] } : {}) };
}

/** The Host owns replacement and recovery even when this bundle's Client is unloaded. */
export function runSelfUpdate(manager, input) {
  const target = selfUpdateTarget(input);
  return runBundleUpdate(manager, {name: SELF_PACKAGE, ...target});
}

export function createSelfUpdateHandler(manager, connection) {
  return async (req, res) => {
    const send = (status, result) => {
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(result));
    };
    if (req.method !== 'POST') return send(405, { ok: false, error: 'POST required' });
    let rejection;
    try {
      if (typeof connection?.requestRejection !== 'function') throw new Error('Admission unavailable');
      rejection = connection.requestRejection(req);
    } catch { return send(503, { ok: false, error: 'Admission unavailable' }); }
    if (rejection !== undefined) return send(rejection === 401 ? 401 : 403, { ok: false, error: 'Admission rejected' });
    if (req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return send(415, { ok: false, error: 'JSON required' });
    let target;
    try {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 4096) return send(413, { ok: false, error: 'Request too large' }); }
      target = selfUpdateTarget(JSON.parse(raw));
    } catch { return send(400, { ok: false, error: 'Invalid self-update target' }); }
    // Unregistering this route stops new requests, not this job. Do not attach it to the request's AbortSignal or ctx.effect.
    const result = await runSelfUpdate(manager, target);
    if (!result.ok) console.warn('[dsh-open-market] Self-update failed: %s', result.error);
    send(200, result);
  };
}
