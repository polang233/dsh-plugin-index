import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogSizeAfterAdding, normalizeEntries } from '../scripts/submission-entries.mjs';

const listed = new Map([['listed-plugin', { name: 'listed-plugin', category: 'tools' }]]);

test('an accepted submission keeps its issue and reply', () => {
  const [entry] = normalizeEntries({
    schema: 1,
    entries: [{ issue: 42, name: 'listed-plugin', replyLanguage: 'zh', reply: '感谢！' }],
  }, listed);
  assert.equal(entry.issue, 42);
  assert.equal(entry.reply, '感谢！');
  assert.equal(entry.discovery, false);
  assert.equal(entry.packageEntry, listed.get('listed-plugin'));
});

test('an entry without an issue is a discovered candidate', () => {
  const [entry] = normalizeEntries({ schema: 1, entries: [{ name: 'brand-new' }] }, listed);
  assert.equal(entry.issue, null);
  assert.equal(entry.reply, '');
  assert.equal(entry.discovery, true);
  assert.deepEqual(entry.packageEntry, { name: 'brand-new' });
});

test('submissions and discoveries can be mixed in one batch', () => {
  const entries = normalizeEntries({
    schema: 1,
    entries: [
      { issue: 7, name: 'listed-plugin', reply: 'Thanks!' },
      { name: 'brand-new' },
    ],
  }, listed);
  assert.deepEqual(entries.map(entry => [entry.name, entry.discovery]), [
    ['listed-plugin', false],
    ['brand-new', true],
  ]);
});

test('a listed package can be re-checked without a reply', () => {
  const [entry] = normalizeEntries({ schema: 1, entries: [{ name: 'listed-plugin' }] }, listed);
  assert.equal(entry.discovery, false);
  assert.equal(entry.issue, null);
});

test('invalid batch files are rejected', () => {
  assert.throws(() => normalizeEntries({ schema: 2, entries: [{ name: 'x' }] }), /schema 1/);
  assert.throws(() => normalizeEntries({ schema: 1, entries: [] }), /schema 1/);
  assert.throws(() => normalizeEntries({ schema: 1 }), /schema 1/);
  assert.throws(() => normalizeEntries({ schema: 1, entries: [{ issue: 1, reply: 'x' }] }), /package name/);
  assert.throws(() => normalizeEntries({ schema: 1, entries: [{ name: '' }] }), /package name/);
});

test('duplicate package names are rejected', () => {
  assert.throws(() => normalizeEntries({
    schema: 1,
    entries: [{ name: 'a' }, { name: 'a' }],
  }), /Duplicate entry/);
});

test('issue numbers and reply drafts must agree', () => {
  assert.throws(() => normalizeEntries({ schema: 1, entries: [{ issue: 0, name: 'a', reply: 'x' }] }), /positive integers/);
  assert.throws(() => normalizeEntries({ schema: 1, entries: [{ issue: '12', name: 'a', reply: 'x' }] }), /positive integers/);
  assert.throws(() => normalizeEntries({ schema: 1, entries: [{ issue: 12, name: 'a' }] }), /needs a reply draft/);
  assert.throws(() => normalizeEntries({ schema: 1, entries: [{ issue: 12, name: 'a', reply: '   ' }] }), /needs a reply draft/);
  assert.throws(() => normalizeEntries({ schema: 1, entries: [{ name: 'a', reply: 'x' }] }), /no issue to reply to/);
  assert.throws(() => normalizeEntries({ schema: 1, entries: [{ issue: 12, name: 'a', reply: 5 }] }), /must be text/);
});

test('the reported catalog size includes discovered candidates', () => {
  const entries = normalizeEntries({
    schema: 1,
    entries: [
      { issue: 7, name: 'listed-plugin', reply: 'Thanks!' },
      { name: 'brand-new' },
      { name: 'also-new' },
    ],
  }, listed);
  assert.equal(catalogSizeAfterAdding(100, entries), 102);
});

test('a submission-only batch keeps the catalog size', () => {
  const entries = normalizeEntries({
    schema: 1,
    entries: [{ issue: 7, name: 'listed-plugin', reply: 'Thanks!' }],
  }, listed);
  assert.equal(catalogSizeAfterAdding(100, entries), 100);
});
