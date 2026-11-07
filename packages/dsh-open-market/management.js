import {readFile, writeFile, rename, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {bundleUpdateTarget, runBundleUpdate} from './bundle-update.js';
import {createTaskGuard} from './task-guard.js';
import {createDiagnostics} from './diagnostics.js';

export const MANAGEMENT_PATH = '/dsh-open-market/manage';
const controllers = globalThis[Symbol.for('dsh-open-market.management')] ??= new WeakMap();
const original = value => value?.[Symbol.for('cordis.original')] ?? value;
const pending = job => ['queued', 'waiting', 'running'].includes(job.state);
const packageName = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const validName = name => typeof name === 'string' && name.length <= 214 && packageName.test(name);
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(id);
const identity = bundle => ({version: bundle.version ?? null, source: bundle.source ?? null,
  enabled: bundle.enabled, installed: bundle.installed, availability: bundle.availability});
const sameInstallation = (bundle, expected) => JSON.stringify(identity(bundle)) === JSON.stringify(expected);
const publicJob = job => structuredClone(job);

export function managementRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid management request');
  const {action} = value;
  if (action === 'open-directory') {
    if (typeof value.location !== 'string' || value.location.length > 700) throw Error('Invalid directory id');
    return {action, location: value.location};
  }
  if (action === 'reorder') {
    if (!Array.isArray(value.order) || value.order.length > 200 || value.order.some(name => !validName(name))
      || new Set(value.order).size !== value.order.length || !/^[a-f0-9]{64}$/.test(value.revision)) throw Error('Invalid load order');
    return {action, order: [...value.order], revision: value.revision};
  }
  if (['cancel', 'retry', 'dismiss'].includes(action)) {
    if (!validId(value.id)) throw Error('Invalid operation id');
    return {action, id: value.id};
  }
  if (!validName(value.name)) throw Error('Invalid package name');
  if (action === 'update') {
    const target = bundleUpdateTarget(value);
    if (!['now', 'idle'].includes(value.when ?? 'now')) throw Error('Invalid update timing');
    if (value.requestId !== undefined && !validId(value.requestId)) throw Error('Invalid request id');
    return {action, ...target, when: value.when ?? 'now', ...(value.requestId === undefined ? {} : {requestId: value.requestId})};
  }
  if (action === 'toggle' && typeof value.enabled === 'boolean') return {action, name: value.name, enabled: value.enabled};
  if (action === 'remove' && value.confirmation === value.name) return {action, name: value.name};
  throw Error('Invalid management action');
}

/** One Host-owned queue per native manager; a self-update can replace its owner without losing an operation. */
export function createManagementController({manager, get, events, dir, profile, diagnostics: suppliedDiagnostics, interval = 3000, guard: suppliedGuard}) {
  manager = original(manager);
  let guard = suppliedGuard ?? createTaskGuard({get, events});
  const diagnostics = suppliedDiagnostics ?? createDiagnostics({profile, get});
  let jobs = [], serial = Promise.resolve(), timer, active, closed = false, guardDisposed = false;
  const file = dir && join(dir, '.dsh-open-market-management.json');
  const ready = (async () => {
    if (!file) return;
    try {
      const bytes = await readFile(file, 'utf8');
      if (Buffer.byteLength(bytes) > 256 * 1024) throw Error('Queue file too large');
      const state = JSON.parse(bytes);
      if (state.schema !== 1 || !Array.isArray(state.jobs) || state.jobs.length > 100) throw Error('Invalid queue');
      jobs = state.jobs.map(job => {
        if (!validId(job.id) || !['queued', 'waiting', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted'].includes(job.state)) throw Error('Invalid queue record');
        const request = managementRequest(job.request);
        if (request.action !== 'update') throw Error('Only updates may persist');
        // A restarted Host never silently replays a package mutation.
        if (!job.original || !['profile', 'missing', 'installation'].includes(job.original.availability)
          || typeof job.original.enabled !== 'boolean' || typeof job.original.installed !== 'boolean'
          || ![job.original.version, job.original.source].every(value => value === null || typeof value === 'string')) throw Error('Invalid installation snapshot');
        return {id: job.id, request, original: job.original, state: job.state, createdAt: job.createdAt, updatedAt: job.updatedAt,
          result: job.result, ...(pending(job) ? {state: 'interrupted', result: {ok: false, code: 'host-restarted'}} : {})};
      });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  })();
  // Callers surface storage failures through the API; a bad queue must not crash the Host at startup.
  void ready.catch(() => {});

  function persist() {
    if (!file) return Promise.resolve();
    const state = JSON.stringify({schema: 1, jobs}, null, 2) + '\n';
    serial = serial.catch(() => {}).then(async () => {
      const temp = file + '.' + randomUUID() + '.tmp';
      try { await writeFile(temp, state, {encoding: 'utf8', mode: 0o600, flag: 'wx'}); await rename(temp, file); }
      finally { await unlink(temp).catch(() => {}); }
    });
    return serial;
  }

  async function snapshot() {
    await ready;
    const [bundles, plugins, activity] = await Promise.all([manager.listBundles(), manager.listPlugins?.() ?? [], guard.activity()]);
    return {jobs: jobs.map(publicJob), activity, inventory: {bundles, plugins}, diagnostics: await diagnostics.snapshot(bundles, plugins)};
  }

  async function execute(request, expected) {
    try {
      const inventory = await manager.listBundles();
      const bundle = inventory.find(item => item.name === request.name);
      if (!bundle || (!bundle.installed && bundle.availability !== 'installation')) return {ok: false, code: 'package-missing'};
      if (bundle.readOnlyReason) return {ok: false, code: 'read-only'};
      if (request.action === 'update') {
        if (!bundle.installed || bundle.removable === false) return {ok: false, code: 'read-only'};
        if (!sameInstallation(bundle, expected)) return {ok: false, code: 'installation-changed'};
        if (request.version && bundle.version === request.version) return {ok: true, alreadyApplied: true};
        return await runBundleUpdate(manager, request, {expected});
      }
      if (request.name === 'dsh-open-market') return {ok: false, code: 'self-management'};
      if (request.action === 'remove' && !bundle.removable) return {ok: false, code: 'read-only'};
      const result = request.action === 'remove' ? await manager.removeBundle(request.name)
        : await manager.setBundleEnabled(request.name, request.enabled);
      if (!result || ['failed', 'cancelled', 'overridden'].includes(result.application) || result.error) {
        return {ok: false, code: result?.error?.code ?? result?.application ?? 'operation-error', error: result?.error?.diagnostic ?? result?.error?.message};
      }
      return {ok: true, restart: result.application === 'restart-required', restartReason: result.restartReason, warnings: result.warnings};
    } catch (error) { return {ok: false, code: 'operation-error', error: error.message || String(error)}; }
  }

  async function protectedOperation(operation, job) {
    if (active || closed) return {ok: false, code: closed ? 'management-unavailable' : 'management-busy'};
    active = {job};
    try {
      return await guard.run(operation);
    } catch (error) {
      return {ok: false, code: 'operation-error', error: error.message || String(error)};
    } finally {
      active = undefined;
      if (closed && !guardDisposed) { guard.dispose?.(); guardDisposed = true; }
    }
  }

  async function run(job) {
    if (!['queued', 'waiting'].includes(job.state)) return {ok: false, code: 'operation-pending'};
    const answer = await protectedOperation(async () => {
      job.state = 'running'; job.updatedAt = new Date().toISOString(); delete job.result;
      await persist();
      return execute(job.request, job.original);
    }, job);
    const waits = ['tasks-active', 'task-monitor-unavailable', 'management-busy'].includes(answer.code);
    const state = waits && job.request.when === 'idle' ? 'waiting' : answer.ok ? 'succeeded' : 'failed';
    if (job.state !== state || JSON.stringify(job.result) !== JSON.stringify(answer)) {
      job.result = answer; job.state = state; job.updatedAt = new Date().toISOString();
      await persist();
    }
    return answer;
  }

  async function pump() {
    await ready;
    if (active || closed) return;
    const next = jobs.find(job => job.request.when === 'idle' && ['queued', 'waiting'].includes(job.state));
    if (next) await run(next);
  }

  async function submit(input) {
    await ready;
    if (closed) return {ok: false, code: 'management-unavailable'};
    const request = managementRequest(input);
    if (request.action === 'open-directory' || request.action === 'reorder') {
      if (request.action === 'reorder' && (active || jobs.some(pending))) return {ok: false, code: 'management-busy'};
      const operation = async () => {
        const [bundles, plugins] = await Promise.all([manager.listBundles(), manager.listPlugins?.() ?? []]);
        return request.action === 'open-directory' ? diagnostics.open(request.location, bundles, plugins) : diagnostics.reorder(request, bundles, plugins);
      };
      return request.action === 'open-directory' ? operation() : protectedOperation(operation);
    }
    if (['cancel', 'retry', 'dismiss'].includes(request.action)) {
      const job = jobs.find(item => item.id === request.id);
      if (!job) return {ok: false, code: 'operation-missing'};
      if (job === active?.job || job.state === 'running') return {ok: false, code: 'operation-running'};
      if (request.action === 'dismiss') {
        if (pending(job)) return {ok: false, code: 'operation-pending'};
        jobs = jobs.filter(item => item !== job);
      } else if (request.action === 'cancel') {
        if (pending(job)) {job.state = 'cancelled'; job.updatedAt = new Date().toISOString();}
      } else {
        if (pending(job)) return {ok: true, queued: true, job: publicJob(job)};
        if (job.result?.code === 'installation-changed') return {ok: false, code: 'installation-changed'};
        if (jobs.some(other => other !== job && pending(other) && other.request.name === job.request.name)) return {ok: false, code: 'management-busy'};
        job.state = 'queued'; job.request.when = 'idle'; job.updatedAt = new Date().toISOString(); delete job.result;
      }
      await persist();
      return {ok: true, ...(request.action === 'retry' ? {queued: true} : {}), job: publicJob(job)};
    }
    if (request.action !== 'update') {
      if (active || jobs.some(job => pending(job) && job.request.name === request.name)) return {ok: false, code: 'management-busy'};
      return protectedOperation(() => execute(request));
    }
    const duplicate = () => {
      const repeat = request.requestId && jobs.find(job => job.id === request.requestId);
      if (repeat) {
        const {requestId: _old, ...old} = repeat.request, {requestId: _new, ...next} = request;
        if (JSON.stringify(old) !== JSON.stringify(next)) throw Error('Operation id already used');
        return pending(repeat) ? {ok: true, queued: true, job: publicJob(repeat)} : {...repeat.result, job: publicJob(repeat)};
      }
      const existing = jobs.find(job => pending(job) && job.request.name === request.name);
      if (existing) return existing.request.spec === request.spec && existing.request.registry === request.registry
        ? {ok: true, queued: true, job: publicJob(existing)} : {ok: false, code: 'management-busy'};
      if (closed || active && request.when === 'now') return {ok: false, code: closed ? 'management-unavailable' : 'management-busy'};
      if (jobs.filter(pending).length >= 50) return {ok: false, code: 'queue-full'};
    };
    const prior = duplicate();
    if (prior) return prior;
    const bundle = (await manager.listBundles()).find(item => item.name === request.name);
    if (!bundle?.installed) return {ok: false, code: 'package-missing'};
    if (bundle.readOnlyReason || !bundle.removable) return {ok: false, code: 'read-only'};
    const raced = duplicate();
    if (raced) return raced;
    jobs = jobs.filter(pending).concat(jobs.filter(job => !pending(job)).slice(-29));
    const job = {id: request.requestId ?? randomUUID(), request, original: identity(bundle), state: 'queued', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()};
    jobs.push(job);
    if (request.when === 'idle') {
      await persist();
      return {ok: true, queued: true, job: publicJob(job)};
    }
    // Reserve before the first file write so the pump cannot steal an immediate request.
    return {...await run(job), job: publicJob(job)};
  }

  timer = setInterval(() => { void pump().catch(() => {}); }, interval);
  timer.unref?.();
  return {snapshot, submit, pump, ready, get running() { return !!active; },
    close() { closed = true; clearInterval(timer); if (!active && !guardDisposed) { guard.dispose?.(); guardDisposed = true; } },
    reopen() {
      if (!closed) return;
      if (guardDisposed) { guard = suppliedGuard ?? createTaskGuard({get, events}); guardDisposed = false; }
      closed = false; timer = setInterval(() => { void pump().catch(() => {}); }, interval); timer.unref?.();
    },
  };
}

export function sharedManagement(options) {
  const manager = original(options.manager);
  let controller = controllers.get(manager);
  if (!controller) { controller = createManagementController({...options, manager}); controllers.set(manager, controller); }
  controller.reopen();
  return controller;
}

export function createManagementHandler(controller, connection) {
  return async (req, res) => {
    const send = (status, value) => { if (res.destroyed || res.writableEnded) return; res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}); res.end(JSON.stringify(value)); };
    let rejection;
    try { if (!connection?.requestRejection) throw Error(); rejection = connection.requestRejection(req); }
    catch { return send(503, {ok: false, code: 'management-unavailable'}); }
    if (rejection !== undefined) return send(rejection === 401 ? 401 : 403, {ok: false});
    if (req.method === 'GET') {
      try { return send(200, {ok: true, ...await controller.snapshot()}); }
      catch { return send(503, {ok: false, code: 'management-unavailable'}); }
    }
    if (req.method !== 'POST') return send(405, {ok: false});
    if (req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return send(415, {ok: false});
    let request;
    try {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 65536) return send(413, {ok: false}); }
      request = managementRequest(JSON.parse(raw));
      if (request.action !== 'reorder' && Buffer.byteLength(raw) > 8192) return send(413, {ok: false});
    } catch { return send(400, {ok: false, code: 'invalid-management-request'}); }
    try { send(200, await controller.submit(request)); }
    catch { send(503, {ok: false, code: 'management-unavailable'}); }
  };
}
