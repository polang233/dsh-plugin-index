import {readFile, stat} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';

const original = value => value?.[Symbol.for('cordis.original')] ?? value;
const revisionOf = text => createHash('sha256').update(text).digest('hex');
const system = bundle => bundle.official || bundle.availability === 'installation';
const packageName = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

async function manifestAt(directory) {
  const file = join(directory, 'package.json');
  if ((await stat(file)).size > 1024 * 1024) throw Error('Package manifest too large');
  return JSON.parse(await readFile(file, 'utf8'));
}

async function nativeRuntime(profile) {
  if (!profile?.installAnchor) throw Error('diagnostics-unavailable');
  const require = createRequire(profile.installAnchor);
  const [boot, atomic] = await Promise.all(['@deepseek-ai/dsh-app-boot', '@deepseek-ai/dsh-atomic-write']
    .map(name => import(pathToFileURL(require.resolve(name)).href)));
  return {...boot, ...atomic, satisfies: require('semver').satisfies};
}

/** Launch only a directory derived from the current inventory, never a caller-supplied path or command. */
export async function openDirectory(path) {
  const archive = /\.asar(?:[/\\]|$)/i.exec(path);
  const target = archive ? dirname(path.slice(0, archive.index + 5)) : path;
  if (!(await stat(target)).isDirectory()) throw Error('Directory is unavailable');
  const [command, args] = process.platform === 'win32' ? ['explorer.exe', [target]]
    : process.platform === 'darwin' ? ['open', [target]] : ['xdg-open', [target]];
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {shell: false, windowsHide: true, detached: true, stdio: 'ignore'});
    child.once('error', reject); child.once('spawn', () => {child.unref(); resolve();});
  });
}

/** Static local metadata, explicit locations and the profile's bundle-layer order. No plugin code is executed. */
export function createDiagnostics({profile, get, runtime: suppliedRuntime, opener = openDirectory}) {
  let runtime, cached;
  const native = () => runtime ??= suppliedRuntime ? Promise.resolve(suppliedRuntime) : nativeRuntime(profile);
  const locations = new Map();

  function location(id, path) {
    if (!path) return null;
    locations.set(id, path);
    return {id, path, archived: /\.asar(?:[/\\]|$)/i.test(path)};
  }

  async function readSnapshot(bundles, plugins) {
    if (!profile?.dir) return {available: false};
    bundles = bundles.filter(bundle => bundle.installed || bundle.availability === 'installation');
    try {
      const api = await native();
      const text = await readFile(join(profile.dir, 'package.json'), 'utf8');
      const manifest = JSON.parse(text);
      const order = manifest.dsh?.profile?.bundles ?? [];
      if (!Array.isArray(order) || order.some(name => typeof name !== 'string')) throw Error('Invalid bundle selection');
      const versions = api.readProfileVersionExemptions?.(profile.dir) ?? [];
      const runtimeVersion = api.getDshRuntimeVersion();
      locations.clear();
      const environment = {profileName: profile.name, runtimeVersion,
        home: location('home', profile.home), profile: location('profile', profile.dir),
        installation: location('installation', dirname(profile.installAnchor)),
        patch: profile.patchPath ?? join(profile.dir, 'cordis.patch.yml')};
      const details = await Promise.all(bundles.map(async bundle => {
        const item = {name: bundle.name, system: !!system(bundle), order: order.includes(bundle.name) ? order.indexOf(bundle.name) + 1 : null,
          dependencies: [], risks: [], configuration: location('config:' + bundle.name, profile.dir), configurationShared: true};
        try {
          const directory = api.resolveBundleDir('dsh', bundle.name, profile.installAnchor, profile.dir);
          item.directory = location('package:' + bundle.name, directory);
          const pkg = await manifestAt(directory);
          const compatibility = api.evaluatePluginCompatibility?.(pkg, versions);
          const requirements = typeof pkg.engines?.dsh === 'string' ? {'engines.dsh': pkg.engines.dsh}
            : Object.fromEntries(Object.entries(pkg.peerDependencies ?? {}).filter(([name]) => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')));
          // The native evaluator returns only mismatches, not a success record.
          item.compatibility = {status: compatibility ? compatibility.exempted ? 'exempted' : 'incompatible'
            : typeof api.evaluatePluginCompatibility !== 'function' ? 'unknown' : Object.keys(requirements).length ? 'compatible' : 'undeclared', requirements};
          if (['incompatible', 'exempted'].includes(item.compatibility.status)) item.risks.push({code: 'compatibility', detail: item.compatibility.status});
          const scripts = Object.keys(pkg.scripts ?? {}).filter(name => ['preinstall', 'install', 'postinstall'].includes(name));
          if (scripts.length) item.risks.push({code: 'install-scripts', detail: scripts.join(', ')});
          const resolveDependency = async (name, requested, kind) => {
            const dependency = {name, requested, kind};
            if (!packageName.test(name)) return {...dependency, status: 'unknown'};
            try {
              // Resolve from the package that declares the dependency, including nested pnpm installations.
              const require = createRequire(join(directory, 'package.json'));
              let found;
              try { found = dirname(require.resolve(name + '/package.json')); }
              catch {
                try {
                  let candidate = dirname(require.resolve(name));
                  for (let depth = 0; depth < 15; depth++) {
                    try { if ((await manifestAt(candidate)).name === name) {found = candidate; break;} } catch {}
                    if (dirname(candidate) === candidate) break;
                    candidate = dirname(candidate);
                  }
                } catch { /* Import-only packages can omit both CommonJS and manifest exports. */ }
              }
              if (!found) {
                try { found = api.resolveBundleDir('dsh', name, join(directory, 'package.json'), directory); }
                catch { found = api.resolveBundleDir('dsh', name, profile.installAnchor, profile.dir); }
              }
              if (!found) throw Error('Missing dependency');
              const resolved = await manifestAt(found);
              dependency.version = resolved.version;
              dependency.directory = location('dependency:' + bundle.name + ':' + name, found);
              dependency.status = /^(?:file:|link:|workspace:|git\+|https?:|npm:)/.test(requested) ? 'unverified'
                : api.satisfies(resolved.version, requested, {includePrerelease: true}) ? 'satisfied' : 'mismatch';
            } catch { dependency.status = kind === 'optional' ? 'optional-missing' : 'missing'; }
            return dependency;
          };
          const declared = new Map();
          for (const [kind, values] of [['dependency', pkg.dependencies], ['peer', pkg.peerDependencies], ['optional', pkg.optionalDependencies]]) {
            for (const [name, requested] of Object.entries(values ?? {})) declared.set(name,
              [name, requested, pkg.peerDependenciesMeta?.[name]?.optional ? 'optional' : kind]);
          }
          item.dependencies = await Promise.all([...declared.values()].map(args => resolveDependency(...args)));
          for (const dep of item.dependencies) if (['missing', 'mismatch'].includes(dep.status)) item.risks.push({code: 'dependency', detail: dep.name + ': ' + dep.status});
        } catch (error) { item.error = error.message; item.compatibility ??= {status: 'unknown'}; }
        item.runtimeOrder = (bundle.rows ?? []).map(row => plugins.findIndex(plugin => plugin.entryId === row.entryId))
          .filter(index => index >= 0).map(index => index + 1);
        return item;
      }));
      for (const item of details) item.dependents = details.filter(other => other.dependencies.some(dep => dep.name === item.name)).map(other => other.name);
      const customOrder = order.filter(name => details.some(item => item.name === name && !item.system));
      return {available: true, revision: revisionOf(text), environment, order, customOrder, bundles: details,
        summary: {custom: bundles.filter(bundle => !system(bundle) && bundle.installed).length,
          loadedCustom: details.filter(item => !item.system && (bundles.find(bundle => bundle.name === item.name)?.rows ?? [])
            .some(row => plugins.some(plugin => plugin.entryId === row.entryId && plugin.fiberPhase === 'active'))).length,
          errors: bundles.filter(bundle => bundle.enabled && bundle.error || bundle.rows?.some(row => plugins.some(plugin => plugin.entryId === row.entryId && (plugin.diagnostic || plugin.fiberPhase === 'failed')))).length,
          risks: details.filter(item => item.risks.length).length}};
    } catch (error) { return {available: false, error: error.message}; }
  }

  function snapshot(bundles, plugins) {
    const key = JSON.stringify([bundles.map(({name, version, enabled, source, error}) => [name, version, enabled, source, error]),
      plugins.map(({entryId, fiberPhase, enabled, diagnostic}) => [entryId, fiberPhase, enabled, diagnostic])]);
    if (cached?.key === key && cached.until > Date.now()) return cached.value;
    const value = readSnapshot(bundles, plugins);
    cached = {key, until: Date.now() + 10000, value};
    return value;
  }

  async function open(id, bundles, plugins) {
    const result = await readSnapshot(bundles, plugins);
    if (!result.available) return {ok: false, code: 'diagnostics-unavailable'};
    if (!locations.has(id)) return {ok: false, code: 'directory-unavailable'};
    try { await opener(locations.get(id)); return {ok: true}; }
    catch (error) { return {ok: false, code: 'directory-unavailable', error: error.message}; }
  }

  async function reorder({order, revision}, bundles, plugins) {
    const before = await readSnapshot(bundles, plugins);
    if (!before.available) return {ok: false, code: 'diagnostics-unavailable'};
    const selected = before.customOrder;
    if (order.length !== selected.length || new Set(order).size !== order.length || order.some(name => !selected.includes(name))) return {ok: false, code: 'invalid-load-order'};
    if (before.revision !== revision) return {ok: false, code: 'installation-changed'};
    for (const item of before.bundles.filter(item => order.includes(item.name))) {
      const late = item.dependencies.find(dep => dep.kind !== 'optional' && order.includes(dep.name) && order.indexOf(dep.name) > order.indexOf(item.name));
      if (late) return {ok: false, code: 'dependency-order', error: item.name, dependency: late.name};
    }
    const api = await native(), file = join(profile.dir, 'package.json');
    return api.withFileLock(file, async () => {
      const hmr = original(get('hmr'));
      if (hmr && typeof hmr.runExclusive !== 'function') return {ok: false, code: 'diagnostics-unavailable'};
      const apply = async () => {
        const text = await readFile(file, 'utf8');
        if (revisionOf(text) !== revision) return {ok: false, code: 'installation-changed'};
        const manifest = JSON.parse(text);
        let cursor = 0;
        manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.map(name => selected.includes(name) ? order[cursor++] : name);
        try {
          await api.writeFileAtomic(file, JSON.stringify(manifest, null, 2) + '\n', {mode: 0o600});
          // Use the same composition and reconciliation as native management; required core slots remain fixed.
          api.composeEntries([api.readProfilePatches('dsh', profile)]);
          const result = hmr ? await hmr.reconcileProfile([]) : undefined;
          cached = undefined;
          return {ok: true, restart: !hmr || !!result.restartReason || !!result.pending?.length, warnings: result?.warnings};
        } catch (error) {
          await api.writeFileAtomic(file, text, {mode: 0o600});
          let restored = true;
          try { if (hmr) await hmr.reconcileProfile([]); } catch { restored = false; }
          return {ok: false, code: 'load-order-failed', error: error.message, restored};
        }
      };
      return hmr ? hmr.runExclusive(apply) : apply();
    });
  }
  return {snapshot, open, reorder};
}
