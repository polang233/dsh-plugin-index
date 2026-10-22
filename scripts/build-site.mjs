import { readFile } from 'node:fs/promises';
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index';
import { writeSite } from './site.mjs';

const index = JSON.parse(await readFile(new URL('../public/index.json', import.meta.url), 'utf8'));
const evidence = JSON.parse(await readFile(new URL('../public/status.json', import.meta.url), 'utf8'));
parseMarketIndex(index, 'https://polang233.github.io/dsh-plugin-index/index.json');
const github = JSON.parse(await readFile(new URL('../public/github.json', import.meta.url), 'utf8'));
const optional = async name => { try { return JSON.parse(await readFile(new URL('../public/' + name, import.meta.url), 'utf8')); } catch { return {}; } };
await writeSite(index, evidence, github, await optional('downloads.json'), await optional('display.json'));
console.log(`Built English, Simplified and Traditional Chinese pages, including a page for each of ${index.plugins.length} plugins.`);
