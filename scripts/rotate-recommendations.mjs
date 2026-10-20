import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {parseMarketIndex} from '@deepseek-ai/dsh-plugin-market-index';
import {rotateRecommendations, checkRecommendationSnapshot} from './recommendations.mjs';
import {writeSite} from './site.mjs';

// Reorder already checked packages offline. Source/version changes still require a full build.
const output = new URL('../public/', import.meta.url);
const read = async name => JSON.parse(await readFile(new URL(name, output), 'utf8'));
const current = await read('index.json');
const github = await read('github.json');
const display = await read('display.json');
const evidence = await read('status.json');
const downloads = await read('downloads.json');
let previous;
try { previous = await read('recommendations.json'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const signals = Object.fromEntries(Object.entries(display.plugins).map(([name, value]) => [name, value.signals]));
const {index, recommendations} = rotateRecommendations(current, {github, signals, previous});
parseMarketIndex(index, 'https://polang233.github.io/dsh-plugin-index/index.json');
checkRecommendationSnapshot(index, recommendations);
evidence.market = {...evidence.market, recommendations: 'recommendations.json'};
await mkdir(output, {recursive: true});
for (const [name, value] of Object.entries({'index.json': index, 'status.json': evidence, 'recommendations.json': recommendations})) {
  await writeFile(new URL(name, output), JSON.stringify(value, null, 2) + '\n');
}
await writeSite(index, evidence, github, downloads, display);
console.log(JSON.stringify({day: recommendations.day, plugins: index.plugins.length, frontPages: recommendations.history.at(-1)}));
