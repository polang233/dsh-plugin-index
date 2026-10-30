import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {rotateRecommendations} from './recommendations.mjs';

const ROUNDS = 8 * 4;
// Replay the actual catalog without downloads, installing packages, or changing public files.
const read = async name => JSON.parse(await readFile(new URL('../public/' + name, import.meta.url), 'utf8'));
const index = await read('index.json');
const github = await read('github.json');
const display = await read('display.json');
const added = await read('added.json');
const signals = Object.fromEntries(Object.entries(display.plugins).map(([name, value]) => [name, value.signals]));
const start = process.argv[2] ? Date.parse(process.argv[2]) : Date.now();
if (!Number.isFinite(start)) throw new Error('Expected an ISO start date');
let previous;
const days = [];
for (let offset = 0; offset < ROUNDS; offset++) {
  const {index: rotated, recommendations} = rotateRecommendations(index, {github, signals, added, previous, now: start + offset * 6 * 3600000});
  const row = recommendations.history.find(entry => entry.round === recommendations.round);
  days.push({...row, cycle: recommendations.cycle, pools: Object.fromEntries(Object.entries(recommendations.pools).map(([mode, pool]) => [mode, pool.length])),
    repeatedWithinCycle: Object.fromEntries(['default', 'recommended'].map(mode => [mode, row[mode].filter(name => days.filter(prior => prior.cycle === recommendations.cycle).some(prior => prior[mode].includes(name))).length])),
    overlapsWithPreviousRound: Object.fromEntries(['default', 'recommended'].map(mode => [mode, row[mode].filter(name => days.at(-1)?.[mode].includes(name)).length])),
    uniquePlugins: new Set(rotated.plugins.map(plugin => plugin.name)).size});
  previous = recommendations;
}
const report = {catalogSize: index.plugins.length, sourceGeneratedAt: display.generatedAt, days};
const output = new URL('../.local/recommendation-preview.json', import.meta.url);
await mkdir(new URL('../.local/', import.meta.url), {recursive: true});
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({report: output.pathname, catalogSize: report.catalogSize, days: days.map(({round, pools, repeatedWithinCycle, overlapsWithPreviousRound, uniquePlugins}) => ({round, pools, repeatedWithinCycle, overlapsWithPreviousRound, uniquePlugins}))}, null, 2));
