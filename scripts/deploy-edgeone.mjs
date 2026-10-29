import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { signedReadRequest } from '../shared/signed-read.js';

const directory = resolve(process.argv[2] ?? '');
const secret = process.env.DSH_GATEWAY_AUTH_SECRET;
if (!process.argv[2] || !process.env.EDGEONE_PAGES_API_TOKEN || !secret || secret.length < 32) throw new Error('Gateway directory and deployment secrets are required');
const cwd = await mkdtemp(join(tmpdir(), 'dsh-edgeone-deploy-'));
function cli(args, task) {
  const result = spawnSync('npx', ['-y', 'edgeone@1.6.47', 'makers', ...args], { cwd, encoding: 'utf8', env: process.env, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`EdgeOne ${task} failed. Inspect the project console.`);
}
const event = { id: crypto.randomUUID(), day: new Date().toISOString().slice(0, 10), visitor: '0'.repeat(24), country: 'XX' };
const request = await signedReadRequest(event, { endpoint: 'https://dshopen.polang.workers.dev/internal/config', secret });
const response = await fetch(request, { redirect: 'error', signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error('Unable to synchronize gateway visitor identity');
const { visitorSalt } = await response.json();
if (typeof visitorSalt !== 'string' || !visitorSalt) throw new Error('Invalid visitor identity configuration');
cli(['link', '--name', 'dshopen-network-probe'], 'project link');
cli(['env', 'set', 'GATEWAY_AUTH_SECRET', secret, '--environment', 'production'], 'signing configuration');
cli(['env', 'set', 'VISITOR_SALT', visitorSalt, '--environment', 'production'], 'identity configuration');
cli(['deploy', directory, '--name', 'dshopen-network-probe', '--area', 'overseas', '--env', 'production', '--skip-ai-gateway-sync', '--json'], 'deployment');
// CLI responses can include temporary access tokens and preview links.
console.log('EdgeOne gateway deployment completed');
