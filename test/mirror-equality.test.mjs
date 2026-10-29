import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { promisify } from 'node:util';
import { compareMirrors } from '../scripts/check-mirror-equality.mjs';

const run = promisify(execFile);

test('compares two complete published indexes and rejects mismatches or invalid responses', async t => {
  const requestedAgents = [];
  const server = createServer((request, response) => {
    requestedAgents.push(request.headers['user-agent']);
    if (request.url === '/unavailable') return response.writeHead(503).end();
    if (request.url === '/redirect') return response.writeHead(302, { location: '/same' }).end();
    if (request.url === '/invalid') return response.end('{broken');
    if (request.url === '/wrong-shape') return response.end('{}');
    response.end(JSON.stringify({ plugins: request.url === '/different' ? ['b'] : ['a'] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const result = await compareMirrors([`${base}/same`, `${base}/same`]);
  assert.equal(result.plugins, 1);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(compareMirrors([`${base}/same`, `${base}/different`]), /Published indexes differ/);
  await assert.rejects(compareMirrors([`${base}/same`, `${base}/unavailable`]), /HTTP 503/);
  await assert.rejects(compareMirrors([`${base}/same`, `${base}/redirect`]), /HTTP 302/);
  await assert.rejects(compareMirrors([`${base}/same`, `${base}/invalid`]), /invalid JSON/);
  await assert.rejects(compareMirrors([`${base}/same`, `${base}/wrong-shape`]), /missing plugins array/);
  const cli = await run(process.execPath, ['scripts/check-mirror-equality.mjs', `${base}/same`, `${base}/same`]);
  assert.match(cli.stdout, /Published indexes match/);
  await assert.rejects(run(process.execPath, ['scripts/check-mirror-equality.mjs', `${base}/same`, `${base}/different`]), error => error.code === 1 && /Published indexes differ/.test(error.stderr));
  assert.ok(requestedAgents.every(agent => agent === 'dshopen-check'));
});
