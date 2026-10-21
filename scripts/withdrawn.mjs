import { readFile } from 'node:fs/promises';

/** Packages whose authors asked to leave the market. They stay out until the author asks to relist. */
export async function readWithdrawn(url = new URL('../data/withdrawn.json', import.meta.url)) {
  const value = JSON.parse(await readFile(url, 'utf8'));
  if (value.schema !== 1 || !Array.isArray(value.packages)
    || value.packages.some(entry => typeof entry?.name !== 'string' || !entry.name || !/^https:\/\//.test(entry.request ?? ''))) {
    throw new Error('Withdrawn list needs schema 1 and a name and request link for every package');
  }
  return new Set(value.packages.map(entry => entry.name));
}

export function assertNotWithdrawn(names, withdrawn) {
  const listed = [...names].filter(name => withdrawn.has(name));
  if (listed.length) throw new Error('Withdrawn at author request, remove from sources: ' + listed.join(', '));
}
