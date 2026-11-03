import {randomUUID} from 'node:crypto';

export const BUNDLE_UPDATE_PATH = '/dsh-open-market/update';
const active = new WeakMap();
const exactVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const packageName = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const fixedGit = /^git\+https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?#[a-f0-9]{40}(?:&path:\/[^\s?#&]+)?$/;

export function bundleUpdateTarget(value) {
  if (typeof value?.name !== 'string' || value.name.length > 214 || !packageName.test(value.name)) throw Error('Invalid package name');
  const spec = value.spec;
  const version = typeof spec === 'string' && spec.startsWith(value.name + '@') ? spec.slice(value.name.length + 1) : null;
  if ((!version || !exactVersion.test(version)) && !(typeof spec === 'string' && fixedGit.test(spec))) throw Error('An exact package version or fixed Git source is required');
  if (spec.includes('&path:') && spec.split('&path:')[1].split('/').some(part => part === '..' || part === '.')) throw Error('Invalid package directory');
  let registry = value.registry;
  if (registry !== undefined && registry !== null) {
    const url = new URL(registry);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('Invalid registry');
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    registry = url.href;
  }
  return {name: value.name, spec, ...(version ? {version} : {}), ...(registry === undefined ? {} : {registry})};
}

const failed = result => !result || !!result.error || !!result.pendingBuilds?.length || ['failed', 'cancelled'].includes(result.application);
const reason = result => result?.pendingBuilds?.length ? 'Install scripts need approval on the Plugins page' : result?.error?.message || result?.error?.diagnostic || result?.error?.code || result?.application || 'Package operation failed';
const failure = result => ({ok: false, error: reason(result), ...(result?.pendingBuilds?.length ? {code: 'install-needs-dialog'} : result?.error?.code ? {code: result.error.code} : {})});

export function originalTarget(bundle) {
  if (!exactVersion.test(bundle.version || '') || typeof bundle.source !== 'string') return null;
  if (bundle.source.startsWith(bundle.name + '@') && /^[a-zA-Z0-9~^<>=*| ._+-]+$/.test(bundle.source.slice(bundle.name.length + 1))) {
    return {spec: bundle.name + '@' + bundle.version};
  }
  if (fixedGit.test(bundle.source)) return {spec: bundle.source};
  return null;
}

function newer(a, b) {
  const parse = value => value.split('+', 1)[0].split('-');
  const [coreA, ...preA] = parse(a), [coreB, ...preB] = parse(b);
  const left = coreA.split('.').map(BigInt), right = coreB.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i];
  if (!preA.length || !preB.length) return !preA.length && !!preB.length;
  const x = preA.join('-').split('.'), y = preB.join('-').split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === y[i]) continue;
    if (x[i] === undefined || y[i] === undefined) return y[i] === undefined;
    const nx = /^\d+$/.test(x[i]), ny = /^\d+$/.test(y[i]);
    return nx && ny ? BigInt(x[i]) > BigInt(y[i]) : nx !== ny ? !nx : x[i] > y[i];
  }
  return false;
}

/** Keep the native manager alive through removal, installation and restoration, even if the Client disappears. */
export async function runBundleUpdate(manager, input) {
  const target = bundleUpdateTarget(input);
  if (!manager?.listBundles || !manager.inspect || !manager.removeBundle || !manager.installBundle) return {ok: false, code: 'update-unavailable', error: 'Update service unavailable'};
  if (active.has(manager)) return {ok: false, code: 'update-busy', error: 'A plugin update is already running'};
  const operation = (async () => {
    let original, rollback, removed = false, installedName;
    let existingNames;
    try {
      const inventory = await manager.listBundles();
      existingNames = new Set(inventory.filter(bundle => bundle.installed).map(bundle => bundle.name));
      original = inventory.find(bundle => bundle.name === target.name);
      if (!original?.installed || original.availability === 'installation' || original.removable === false) return {ok: false, error: 'This bundle cannot be replaced in this profile'};
      rollback = originalTarget(original);
      if (!rollback) return {ok: false, code: 'restore-unavailable', error: 'The original installation source is not available; the current version was kept'};
      if (target.version && original.updatable && newer(target.version, original.version) && typeof manager.updateBundle === 'function') {
        const result = await manager.updateBundle(target.name, target.version, {registry: target.registry, requestId: randomUUID()});
        if (!failed(result.result)) return {ok: true, restart: result.result.application === 'restart-required'};
        return {...failure(result.result), ...(result.restore ? {restored: !failed(result.restore), restoreRestart: result.restore.application === 'restart-required'} : {})};
      }
      const preflight = await manager.inspect(target.spec, {registry: target.registry});
      if (preflight.status !== 'accepted' && !(preflight.status === 'refused' && preflight.problem === 'already-installed')) return {ok: false, error: preflight.reason || 'Update inspection unavailable'};
      if (preflight.status === 'accepted' && ((preflight.name && preflight.name !== target.name) || (target.version && preflight.version && preflight.version !== target.version))) return {ok: false, error: 'Update package identity mismatch'};
      // An npm source is pinned to the actual installed version. Restoration uses the Host's original registry plan.
      if (target.version && typeof manager.listVersions === 'function' && !fixedGit.test(rollback.spec)) {
        const versions = await manager.listVersions(target.name);
        if (versions.status === 'listed') rollback.registry = versions.registry;
      }
      const removal = await manager.removeBundle(target.name);
      if (failed(removal)) return failure(removal);
      removed = true;
      const inspection = await manager.inspect(target.spec, {registry: target.registry});
      if (inspection.status !== 'accepted') throw Error(inspection.reason || 'Update inspection unavailable');
      if ((inspection.name && inspection.name !== target.name) || (target.version && inspection.version && inspection.version !== target.version)) throw Error('Update package identity mismatch');
      const result = await manager.installBundle(target.spec, {enabled: original.enabled ?? true, requestId: randomUUID(), registry: inspection.registry,
        ...(target.version ? {saveExact: true} : {})});
      installedName = result.bundle;
      if (failed(result)) {
        const error = Object.assign(Error(reason(result)), failure(result));
        throw error;
      }
      if (installedName && installedName !== target.name) throw Error('Installed package identity mismatch');
      const installed = (await manager.listBundles()).find(bundle => bundle.name === target.name);
      if (!installed?.installed || (target.version && installed.version !== target.version)) throw Error('Installed version could not be verified');
      if (!target.version && !installed.source?.includes(/#([a-f0-9]{40})/.exec(target.spec)[1])) throw Error('Installed commit could not be verified');
      return {ok: true, restart: result.application === 'restart-required'};
    } catch (error) {
      const answer = {ok: false, error: error.message || String(error), ...(error.code ? {code: error.code} : {})};
      if (!removed) return answer;
      try {
        const current = (await manager.listBundles()).find(bundle => bundle.name === (installedName || target.name));
        if (current?.installed) {
          if (current.name !== original.name && existingNames.has(current.name)) throw Error('An unrelated installed bundle was preserved');
          const cleanup = await manager.removeBundle(current.name);
          if (failed(cleanup)) throw Error(reason(cleanup));
        }
        const check = await manager.inspect(rollback.spec, {registry: rollback.registry});
        if (check.status !== 'accepted' || (check.name && check.name !== original.name)) throw Error(check.reason || 'Original source inspection failed');
        const restore = await manager.installBundle(rollback.spec, {enabled: original.enabled ?? true, registry: check.registry,
          ...(!fixedGit.test(rollback.spec) ? {saveExact: true} : {})});
        if (failed(restore)) throw Error(reason(restore));
        const restored = (await manager.listBundles()).find(bundle => bundle.name === original.name);
        if (!restored?.installed || restored.version !== original.version || restored.enabled !== (original.enabled ?? true)) throw Error('Original version could not be verified');
        if (fixedGit.test(rollback.spec) && !restored.source?.includes(/#([a-f0-9]{40})/.exec(rollback.spec)[1])) throw Error('Original commit could not be verified');
        return {...answer, restored: true, restoreRestart: restore.application === 'restart-required'};
      } catch (restoreError) { return {...answer, restored: false, restoreError: restoreError.message || String(restoreError), restoreSpec: rollback.spec}; }
    }
  })();
  active.set(manager, operation);
  try { return await operation; } finally { active.delete(manager); }
}

export function createBundleUpdateHandler(manager, connection) {
  return async (req, res) => {
    const send = (status, value) => { if (res.destroyed || res.writableEnded) return; res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}); res.end(JSON.stringify(value)); };
    if (req.method !== 'POST') return send(405, {ok: false});
    let rejection;
    try { if (!connection?.requestRejection) throw Error(); rejection = connection.requestRejection(req); }
    catch { return send(503, {ok: false}); }
    if (rejection !== undefined) return send(rejection === 401 ? 401 : 403, {ok: false});
    if (req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return send(415, {ok: false});
    let target;
    try {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 4096) return send(413, {ok: false}); }
      target = bundleUpdateTarget(JSON.parse(raw));
    } catch { return send(400, {ok: false}); }
    send(200, await runBundleUpdate(manager, target));
  };
}
