import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !process.env.EDGEONE_PAGES_API_TOKEN) throw new Error('Gateway directory and EdgeOne deployment token are required');
const result = spawnSync('npx', ['-y', 'edgeone@1.6.47', 'makers', 'deploy', directory, '--name', 'dshopen-network-probe', '--area', 'overseas', '--env', 'production', '--skip-ai-gateway-sync', '--json'], { encoding: 'utf8', env: process.env, maxBuffer: 4 * 1024 * 1024 });
// CLI responses can include temporary access tokens and preview links.
if (result.status !== 0) throw new Error('EdgeOne deployment failed. Inspect the deployment status in the project console.');
console.log('EdgeOne gateway deployment completed');
