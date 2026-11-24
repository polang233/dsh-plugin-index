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

test('site reports issues, offers ranking limits and cleans historical description prefixes', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'site-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = pathToFileURL(dir + '/');
  const index = { format: 1, plugins: [{ name: 'demo-plugin', description: { en: '★ 1,234 │ ★ 56 | Draws\n demo charts.', zh: '★ 12 │ 绘制\n 演示图表。' }, versions: [{ version: '1.0.0', source: { type: 'npm' } }] }] };
  const display = { plugins: { 'demo-plugin': { description: { en: '★ 9 │ ★ 8 | Selected\n description.', zh: '★ 9 │ ★ 8 | 精选\n 介绍。' } } } };
  // One plugin exercises the display override, the other the historical index fallback.
  index.plugins.push({ ...index.plugins[0], name: 'fallback-plugin' });
  await writeSite(index, {}, {}, {}, display, { output });
  const reports = { en: 'Report an issue', zh: '提交问题', tw: '提交問題', ja: '問題を報告', ko: '문제 신고' };
  const template = await readFile(new URL('../.github/ISSUE_TEMPLATE/bug.yml', import.meta.url), 'utf8');
  assert.match(template, /^name: Bug report/m);
  for (const [language, { dir: folder }] of Object.entries(LANGUAGES)) {
    const home = await readFile(new URL(folder + 'index.html', output), 'utf8');
    const stats = await readFile(new URL(folder + 'stats/index.html', output), 'utf8');
    assert.ok(home.includes(`href="https://github.com/polang233/dsh-plugin-index/issues/new?template=bug.yml">${reports[language]}</a>`), language);
    assert.doesNotMatch(home, /template=plugin-remove\.yml|★\s*[\d,]+\s*[│|]/);
    assert.match(stats, /<label[^>]*data-like-limit-field[^>]*><span>[^<]+<\/span><select data-like-limit aria-controls="like-ranking" disabled>/);
    assert.deepEqual([...stats.matchAll(/<option value="(\d+)"( selected)?>Top \d+<\/option>/g)].map(([, value, selected]) => [Number(value), !!selected]), [[10, true], [20, false], [30, false], [40, false], [50, false]]);
  }
  for (const path of ['index.html', 'plugins/demo-plugin/index.html', 'plugins/fallback-plugin/index.html']) {
    const html = await readFile(new URL(path, output), 'utf8');
    assert.doesNotMatch(html, /★\s*[\d,]+\s*[│|]/);
    assert.match(html, path.includes('fallback') ? /Draws demo charts\./ : /Selected description\./);
  }
  assert.match(index.plugins[0].description.en, /^★/);
  assert.match(display.plugins['demo-plugin'].description.en, /^★/);
});

test('plugin pages show distinct project links and only registered screenshots', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'site-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = pathToFileURL(dir + '/');
  const repository = { url: 'https://github.com/owner/plugin' };
  const index = { format: 1, metadata: { categories: { tools: { title: { en: 'Tools', zh: '工具' } } } }, plugins: [
    { name: 'with-preview', repository, homepage: 'https://github.com/owner/plugin/wiki', metadata: { category: 'tools' } },
    { name: 'duplicate', repository, homepage: 'https://github.com/Owner/Plugin.git/#readme' },
    { name: 'invalid', repository, homepage: 'https://user:pass@example.com/' },
    { name: 'website-only', homepage: 'https://example.com/' },
    { name: 'single-preview' }
  ] };
  const screenshots = [{ url: 'https://raw.githubusercontent.com/owner/plugin/abc/preview.png', alt: 'Compare charts < A & B' }];
  const display = { plugins: {
    'with-preview': { screenshots: [...screenshots, { url: 'https://raw.githubusercontent.com/owner/plugin/abc/another.png', alt: 'Second view' }] },
    'single-preview': { screenshots }, duplicate: { screenshots: [] }
  } };
  await writeSite(index, {}, {}, {}, display, { output });
  const read = path => readFile(new URL(path, output), 'utf8');
  const [detail, duplicate, invalid, websiteOnly, single, home, chinese, traditional] = await Promise.all([
    'plugins/with-preview/index.html', 'plugins/duplicate/index.html', 'plugins/invalid/index.html', 'plugins/website-only/index.html',
    'plugins/single-preview/index.html', 'index.html', 'zh/plugins/with-preview/index.html', 'zh-tw/plugins/with-preview/index.html'
  ].map(read));
  assert.match(detail, /class="link-source" href="https:\/\/github\.com\/owner\/plugin"[^\n]+View source/);
  assert.match(detail, /class="link-website" href="https:\/\/github\.com\/owner\/plugin\/wiki"[^\n]+Visit website/);
  assert.match(detail, /data-zoom href="https:\/\/raw\.githubusercontent\.com\/owner\/plugin\/abc\/preview\.png"/);
  assert.match(detail, /<img[^>]+alt="Compare charts &lt; A &amp; B"/);
  assert.doesNotMatch(detail, /<figcaption>/);
  assert.match(detail, /class="detail-grid detail-grid-with-screenshots"/);
  assert.match(detail, /class="plugin-screenshot-slide" role="group" aria-roledescription="slide" aria-label="Screenshot 1 of 2"/);
  assert.match(detail, /id="plugin-screenshot-track" role="group" aria-label="Screenshots" tabindex="0"/);
  assert.match(detail, /data-screenshot-previous aria-label="Previous screenshot"/);
  assert.match(detail, /data-screenshot-next aria-label="Next screenshot"/);
  assert.match(detail, /class="plugin-screenshot-viewport">\s*<div class="plugin-screenshot-controls"/);
  assert.match(detail, /id="plugin-screenshot-track"[^>]*><div class="plugin-screenshot-slide".*><div class="plugin-screenshot-slide"/);
  assert.match(detail, /<p class="detail-lead">.*<\/p>\s*<div class="detail-meta">[\s\S]*class="plugin-tag plugin-category"/);
  assert.match(detail, /<dialog[^>]+data-viewer/);
  assert.match(single, /id="plugin-screenshot-track"/);
  assert.match(single, /class="detail-grid detail-grid-with-screenshots detail-grid-single-screenshot"/);
  assert.doesNotMatch(single, /data-screenshot-controls/);
  for (const html of [duplicate, invalid]) {
    assert.doesNotMatch(html, /class="link-website"|id="plugin-screenshot-track"|data-viewer/);
  }
  assert.match(websiteOnly, /class="link-website" href="https:\/\/example\.com\/"/);
  assert.doesNotMatch(websiteOnly, /class="link-source"/);
  assert.doesNotMatch(home, /owner\/plugin\/wiki|id="plugin-screenshot-track"/);
  assert.match(chinese, /界面预览|查看源码/);
  assert.match(traditional, /介面預覽|檢視原始碼/);
});

test('page titles are sized per page and the 404 page has its own layout', async t => {
  const css = await readFile(new URL('../site/site.css', import.meta.url), 'utf8');
  // A language selector outranks .detail-head h1 and .stats-intro h1, so it must never carry a size of its own.
  // Every rule, inside media queries too: any selector in its list that is a bare `html:is([lang…]) h1` forbids a size.
  const split = selectors => { const parts = []; let depth = 0, current = ''; for (const char of selectors) { if (char === ',' && !depth) { parts.push(current.trim()); current = ''; continue; } depth += char === '(' ? 1 : char === ')' ? -1 : 0; current += char; } return [...parts, current.trim()]; };
  let languageHeadings = 0;
  for (const [, selectors, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!split(selectors).some(selector => /^html:is\(\[lang[^)]*\) h1$/.test(selector))) continue;
    languageHeadings++;
    assert.doesNotMatch(body, /font-size/, selectors.trim());
  }
  assert.ok(languageHeadings >= 1, 'the language heading rule is still there to guard');
  // Traditional Chinese pages are CJK pages too.
  for (const [list] of css.matchAll(/html:is\(\[lang[^)]*\)/g)) assert.match(list, /zh-TW/, list);
  // Plugin logos show whole inside their frame.
  assert.doesNotMatch(css, /\.plugin-avatar img \{[^}]*scale\(/);
  const dir = await mkdtemp(join(tmpdir(), 'site-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const output = pathToFileURL(dir + '/');
  await writeSite({ format: 1, plugins: [] }, { generatedAt: '2026-11-01T00:00:00Z' }, {}, {}, {}, { output });
  const missing = await readFile(new URL('404.html', output), 'utf8');
  assert.match(missing, /<main class="shell not-found">/);
  assert.doesNotMatch(missing, /<main class="[^"]*\bhero\b/);
});

test('home page titles stay within the 70 characters search engines show', () => {
  for (const [language, copy] of Object.entries(COPY)) {
    assert.ok([...copy.title].length <= 70, `${language} title is ${[...copy.title].length} characters: ${copy.title}`);
  }
});
