import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertNotWithdrawn, readWithdrawn } from '../scripts/withdrawn.mjs';

test('no withdrawn package is back in the source list', async () => {
  const withdrawn = await readWithdrawn();
  const config = JSON.parse(await readFile(new URL('../data/sources.json', import.meta.url), 'utf8'));
  assert.ok(withdrawn.size > 0);
  assert.doesNotThrow(() => assertNotWithdrawn(config.packages.map(entry => entry.name), withdrawn));
});

test('a withdrawn name is rejected by name', () => {
  assert.throws(() => assertNotWithdrawn(['kept', 'gone'], new Set(['gone'])), /gone/);
});
