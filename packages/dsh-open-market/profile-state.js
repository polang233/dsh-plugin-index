import {readFile, writeFile, rename, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

export const PROFILE_STATE_PATH = '/dsh-open-market/state';
const queues = new Map();
const packageName = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function profilePatch(value) {
  if (!object(value) || Object.keys(value).some(key => !['settings', 'favorites', 'installCounted', 'footerTurn'].includes(key))) throw Error('Invalid preferences');
  const patch = {};
  for (const [key, data] of Object.entries(value)) {
    if (key === 'installCounted') {
      if (typeof data !== 'boolean') throw Error('Invalid installation marker');
    } else if (key === 'footerTurn') {
      if (data !== 0 && data !== 1) throw Error('Invalid footer state');
    } else if (key === 'settings') {
      const booleans = ['autoRotate', 'showInstalled', 'showCheckup', 'likes', 'theme'];
      if (!object(data) || Object.entries(data).some(([name, val]) => booleans.includes(name) ? typeof val !== 'boolean'
        : name === 'registry' ? !['index', 'dsh', 'npmmirror', 'custom'].includes(val)
        : name === 'sidebarMarket' ? !['auto', 'on', 'off'].includes(val)
        : name === 'customRegistry' ? typeof val !== 'string' || val.length > 2048 : true)) throw Error('Invalid settings');
    } else {
      if (!object(data) || data.schema !== 1 || !Array.isArray(data.groups) || data.groups.length > 100) throw Error('Invalid favorites');
      const ids = new Set();
      for (const group of data.groups) {
        if (!object(group) || typeof group.id !== 'string' || !group.id || group.id.length > 100 || ids.has(group.id)
          || typeof group.name !== 'string' || group.name.length > 40 || !Array.isArray(group.names) || group.names.length > 2000
          || group.names.some(name => typeof name !== 'string' || name.length > 214 || !packageName.test(name))) throw Error('Invalid favorite group');
        ids.add(group.id);
      }
      if (!ids.has('default')) throw Error('Default favorite group required');
    }
    patch[key] = data;
  }
  return patch;
}

export async function saveProfileState(dir, patch, {initialize = false} = {}) {
  if (!dir) throw Error('Profile directory unavailable');
  const valid = profilePatch(patch), path = join(dir, '.dsh-open-market-user.json');
  const operation = (queues.get(path) ?? Promise.resolve()).catch(() => {}).then(async () => {
    let state = {schema: 1};
    try {
      state = JSON.parse(await readFile(path, 'utf8'));
      if (state.schema !== 1) throw Error('Unsupported preferences file');
      profilePatch(Object.fromEntries(Object.entries(state).filter(([key]) => key !== 'schema')));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const [key, value] of Object.entries(valid)) if (!initialize || !Object.hasOwn(state, key)) state[key] = value;
    const text = JSON.stringify(state, null, 2) + '\n';
    if (Buffer.byteLength(text) > 256 * 1024) throw Error('Preferences too large');
    const temp = path + '.' + randomUUID() + '.tmp';
    try { await writeFile(temp, text, {encoding: 'utf8', mode: 0o600, flag: 'wx'}); await rename(temp, path); }
    finally { await unlink(temp).catch(() => {}); }
    return state;
  });
  queues.set(path, operation);
  try { return await operation; } finally { if (queues.get(path) === operation) queues.delete(path); }
}

export function createProfileStateHandler(dir, connection) {
  return async (req, res) => {
    const send = (status, value) => { if (res.destroyed || res.writableEnded) return; res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}); res.end(JSON.stringify(value)); };
    if (req.method !== 'POST') return send(405, {ok: false});
    let rejected;
    try { if (!connection?.requestRejection) throw Error(); rejected = connection.requestRejection(req); }
    catch { return send(503, {ok: false}); }
    if (rejected !== undefined) return send(rejected === 401 ? 401 : 403, {ok: false});
    if (req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') return send(415, {ok: false});
    let body;
    try {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 256 * 1024) return send(413, {ok: false}); }
      body = JSON.parse(raw);
      if (!object(body) || (body.initialize !== undefined && typeof body.initialize !== 'boolean')) throw Error();
      profilePatch(body.patch);
    } catch { return send(400, {ok: false}); }
    try { return send(200, {ok: true, state: await saveProfileState(dir, body.patch, {initialize: body.initialize})}); }
    catch { return send(503, {ok: false}); }
  };
}
