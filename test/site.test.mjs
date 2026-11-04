import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { COPY, HEADERS, LANGUAGES, renderStars, writeSite } from '../scripts/site.mjs';

const plugin = { repository: { url: 'https://github.com/owner/plugin' } };
const snapshot = (stars, status = 'ok') => ({ repositories: { 'owner/plugin': { url: 'https://github.com/owner/plugin', stars, status, fetchedAt: '2026-10-18T05:26:39.262Z' } } });

test('star link preserves the exact count, source and fetch timestamp', () => {
  const html = renderStars(plugin, snapshot(1234), 'en');
  assert.match(html, /data-stars="1234"/);
  assert.match(html, /1,234/);
  assert.match(html, /https:\/\/github.com\/owner\/plugin\/stargazers/);
  assert.match(html, /2026-10-18 05:26:39 UTC/);
});
test('measured zero and unavailable counts have different visible states', () => {
  assert.match(renderStars(plugin, snapshot(0), 'en'), /data-stars="0"/);
  assert.match(renderStars(plugin, {}, 'zh'), /暂不可用/);
  assert.doesNotMatch(renderStars(plugin, {}, 'en'), /data-stars=/);
});
test('a fallback count shows the number without cache wording', () => {
  assert.match(renderStars(plugin, snapshot(345, 'stale'), 'en'), /data-stars="345"/);
  assert.doesNotMatch(renderStars(plugin, snapshot(345, 'stale'), 'zh'), /缓存/);
});
test('non-GitHub repositories do not display a fabricated count', () => {
  assert.equal(renderStars({ repository: { url: 'https://gitee.com/owner/plugin' } }, {}, 'zh'), '');
});

test('hashed plugin icons are served as immutable', () => {
  assert.match(HEADERS, /^\/icons\/\*\n  Cache-Control: public, max-age=31536000, immutable\n  Access-Control-Allow-Origin: \*\n  X-Content-Type-Options: nosniff\n  Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src data:\n$/);
});

test('every language carries every piece of interface copy', () => {
  const shape = value => typeof value === 'function' ? 'function' : Array.isArray(value) ? `array:${value.length}` : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item)])) : typeof value;
  const english = shape(COPY.en);
  for (const language of Object.keys(LANGUAGES)) {
    const own = shape(COPY[language]);
    // Alternate names are search terms, as many as each language needs.
    for (const key of Object.keys(english).filter(key => key !== 'alternateNames')) assert.deepEqual(own[key], english[key], `${language}.${key}`);
  }
});

test('Japanese and Korean have a home and stats page whose cards open the English plugin pages', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'site-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = pathToFileURL(dir + '/');
  const index = { format: 1, metadata: { categories: { tools: { title: { en: 'Tools', zh: '工具' } } } }, plugins: [{ name: 'demo-plugin', description: { en: 'Draws demo charts.', zh: '绘制演示图表。' }, versions: [{ version: '1.0.0', source: { type: 'npm' } }], metadata: { category: 'tools' } }] };
  await writeSite(index, { generatedAt: '2026-11-01T00:00:00Z' }, {}, {}, {}, { output });
  const read = path => readFile(new URL(path, output), 'utf8');
  const [ja, ko, names, english, sitemap, versions, missing] = await Promise.all(['ja/index.html', 'ko/index.html', 'ja/stats/plugins.json', 'plugins/demo-plugin/index.html', 'sitemap.xml', 'page-versions.json', '404.html'].map(read));
  for (const language of ['ja', 'ko']) await assert.rejects(read(`${language}/plugins/demo-plugin/index.html`), { code: 'ENOENT' });
  assert.match(ja, /<html lang="ja"/);
  assert.match(ja, /Draws demo charts\./);
  assert.match(ja, /ツール/);
  assert.match(ja, /data-href="\.\.\/plugins\/demo-plugin\/"/);
  assert.equal(JSON.parse(names)['demo-plugin'][2], '../../plugins/demo-plugin/');
  assert.match(ko, /<html lang="ko"/);
  assert.match(ko, /2026년 11월 1일/);
  // Home and stats list every language; plugin pages only the languages that have them.
  for (const html of [ja, ko]) for (const tag of ['en', 'zh-CN', 'zh-TW', 'zh-HK', 'ja', 'ko', 'x-default']) assert.match(html, new RegExp(`hreflang="${tag}" href=`));
  const alternates = [...english.matchAll(/<link rel="alternate" hreflang="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(alternates, ['en', 'zh-CN', 'zh-TW', 'zh-HK', 'x-default']);
  assert.doesNotMatch(english, /og:locale:alternate" content="(ja_JP|ko_KR)"/);
  // The switcher on a plugin page sends Japanese and Korean readers to their home page.
  assert.match(english, /<a href="\.\.\/\.\.\/ja\/" lang="ja" hreflang="ja" data-lang="ja"/);
  assert.match(english, /<a href="\.\.\/\.\.\/zh\/plugins\/demo-plugin\/" lang="zh-CN"/);
  assert.doesNotMatch(sitemap, /dshopen\.org\/(ja|ko)\/plugins\//);
  assert.match(sitemap, /<loc>https:\/\/dshopen.org\/ja\/stats\/<\/loc>/);
  assert.match(sitemap, /hreflang="ko" href="https:\/\/dshopen.org\/ko\/"/);
  const pages = JSON.parse(versions).pages;
  assert.equal(Object.keys(pages).filter(url => /\/(ja|ko)\/plugins\//.test(url)).length, 0);
  for (const language of ['ja', 'ko']) for (const path of ['', 'stats/']) assert.equal(pages[`https://dshopen.org/${language}/${path}`], null);
  assert.match(pages['https://dshopen.org/plugins/demo-plugin/'], /^[a-f0-9]{16}$/);
  assert.match(missing, /href="https:\/\/dshopen.org\/ja\/" lang="ja"/);
  assert.match(missing, /href="https:\/\/dshopen.org\/ko\/" lang="ko"/);
});
