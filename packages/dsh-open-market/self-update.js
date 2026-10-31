import { randomUUID } from 'node:crypto';

export const SELF_PACKAGE = 'dsh-open-market';
export const SELF_UPDATE_PATH = '/dsh-open-market/self-update';
const active = new WeakMap();

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

function changeError(result) {
  if (!result) return 'Plugin manager unavailable';
  if (result.error) return result.error.message || result.error.code;
  if (result.application === 'failed' || result.application === 'cancelled') return result.application;
  return null;
}

/** Hold the native Host service throughout; disposing this bundle or closing the UI cannot stop the accepted sequence. */
export async function runSelfUpdate(manager, input) {
  const target = selfUpdateTarget(input);
  if (!manager?.listBundles || !manager.inspect || !manager.removeBundle || !manager.installBundle) return { ok: false, error: 'Self-update service unavailable' };
  if (active.has(manager)) return { ok: false, error: 'Self-update already running' };
  const matches = subject => (!subject.name || subject.name === SELF_PACKAGE) && (!target.version || !subject.version || subject.version === target.version);
  const operation = (async () => {
    try {
      const bundle = (await manager.listBundles()).find(item => item.name === SELF_PACKAGE);
      if (!bundle?.installed || bundle.availability === 'installation' || bundle.removable === false) return { ok: false, error: 'Open Market is not removable in this profile' };
      const preflight = await manager.inspect(target.spec, { registry: target.registry });
      if (preflight.status === 'refused' && preflight.problem !== 'already-installed') return { ok: false, error: preflight.reason };
      if (preflight.status !== 'accepted' && !(preflight.status === 'refused' && preflight.problem === 'already-installed')) return { ok: false, error: 'Self-update inspection unavailable' };
      if (preflight.status === 'accepted' && !matches(preflight)) return { ok: false, error: 'Self-update package identity mismatch' };
      const removed = await manager.removeBundle(SELF_PACKAGE);
      if (changeError(removed)) return { ok: false, error: changeError(removed), code: removed?.error?.code };
      const subject = await manager.inspect(target.spec, { registry: target.registry });
      if (subject.status !== 'accepted') return { ok: false, error: subject.reason || 'Self-update inspection unavailable' };
      if (!matches(subject)) return { ok: false, error: 'Self-update package identity mismatch' };
      const result = await manager.installBundle(target.spec, {
        enabled: bundle.enabled ?? true, requestId: randomUUID(), registry: subject.registry,
        ...(subject.saveExact === undefined ? {} : { saveExact: subject.saveExact })
      });
      if (result.pendingBuilds?.length) return { ok: false, code: 'install-needs-dialog', error: 'Install scripts need approval on the Plugins page' };
      const error = changeError(result);
      return error ? { ok: false, error, code: result.error?.code } : { ok: true, restart: result.application === 'restart-required' };
    } catch (error) { return { ok: false, error: error.message || String(error) }; }
  })();
  active.set(manager, operation);
  try { return await operation; } finally { active.delete(manager); }
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
