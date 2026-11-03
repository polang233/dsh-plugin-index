import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {saveProfileState, profilePatch, createProfileStateHandler} from './profile-state.js';

const favorites = {schema: 1, groups: [{id: 'default', name: '', names: ['demo']}]};
test('profile preferences migrate once and concurrent field writes survive a new browser', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opm-profile-'));
  await saveProfileState(dir, {settings: {likes: false}, favorites, installCounted: true}, {initialize: true});
  await Promise.all([saveProfileState(dir, {settings: {likes: true}}), saveProfileState(dir, {footerTurn: 1})]);
  const next = await saveProfileState(dir, {settings: {likes: false}, favorites: {schema: 1, groups: [{id: 'default', name: '', names: []}]}, installCounted: false}, {initialize: true});
  assert.equal(next.settings.likes, true);
  assert.equal(next.installCounted, true);
  assert.equal(next.footerTurn, 1);
  assert.deepEqual(next.favorites, favorites);
  const persisted = JSON.parse(await readFile(join(dir, '.dsh-open-market-user.json'), 'utf8'));
  assert.deepEqual(persisted, next);
});

test('invalid or corrupted profile data is preserved rather than reset', async () => {
  for (const value of [{path: '../other'}, {installCounted: 1}, {footerTurn: 2}, {settings: {likes: 'false'}},
    {favorites: {schema: 1, groups: [{id: 'default', name: '', names: ['../bad']}]}}]) assert.throws(() => profilePatch(value));
  const dir = await mkdtemp(join(tmpdir(), 'opm-profile-'));
  const path = join(dir, '.dsh-open-market-user.json');
  await writeFile(path, '{invalid');
  await assert.rejects(saveProfileState(dir, {installCounted: true}));
  assert.equal(await readFile(path, 'utf8'), '{invalid');
});

test('the preferences endpoint requires Host admission and rejects unbounded or invalid writes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'opm-profile-'));
  let connection = {requestRejection: req => req.headers.cookie === 'session=test' ? undefined : 401};
  const server = createServer((req, res) => createProfileStateHandler(dir, connection)(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {server.close(resolve); server.closeAllConnections();}));
  const url = 'http://127.0.0.1:' + server.address().port;
  const post = (body, headers = {}) => fetch(url, {method: 'POST', headers: {'content-type': 'application/json', cookie: 'session=test', ...headers}, body: JSON.stringify(body)});
  assert.equal((await fetch(url)).status, 405);
  assert.equal((await post({patch: {}}, {cookie: ''})).status, 401);
  assert.equal((await post({patch: {}}, {'content-type': 'text/plain'})).status, 415);
  assert.equal((await post({patch: {path: 'elsewhere'}})).status, 400);
  assert.equal((await post({patch: {}, padding: 'x'.repeat(300000)})).status, 413);
  const response = await post({patch: {installCounted: true}, initialize: true});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state.installCounted, true);
  connection = {};
  assert.equal((await post({patch: {}})).status, 503);
});
