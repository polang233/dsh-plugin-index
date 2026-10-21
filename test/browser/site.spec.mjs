import { test, expect } from '@playwright/test';
import {githubRepository} from '../../scripts/github.mjs';

const INDEX_URL = 'https://dshopen.org/index.json';
for (const language of ['en', 'zh']) {
  const route = language === 'en' ? './' : './zh/';
  test(`${language}: directory filters, language navigation and layout`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
    await page.goto(route);
    await expect(page.locator('html')).toHaveAttribute('lang', language === 'en' ? 'en' : 'zh-CN');
    await expect(page.locator('#index-url')).toHaveValue(INDEX_URL);
    const rows = page.locator('[data-plugin]');
    expect(await rows.count()).toBeGreaterThan(20);
    const all = await rows.count();
    const PAGE = 24;
    // The directory opens with one batch; the rest is revealed on demand.
    await expect(page.locator('[data-plugin]:visible')).toHaveCount(PAGE);
    await expect(page.locator('[data-more]')).toBeVisible();
    await page.locator('[data-more]').click();
    // Each click reveals exactly one more batch; scrolling never loads more on its own.
    await expect(page.locator('[data-plugin]:visible')).toHaveCount(PAGE * 2);
    await page.mouse.wheel(0, 20000);
    await page.waitForTimeout(300);
    await expect(page.locator('[data-plugin]:visible')).toHaveCount(PAGE * 2);
    await page.locator('[data-sort="stars"]').click();
    const stars = await page.locator('[data-plugin]:visible').evaluateAll(items => items.slice(0, 5).map(item => Number(item.dataset.sortStars ?? -1)));
    expect(stars).toEqual([...stars].sort((a, b) => b - a));
    await page.locator('[data-sort="default"]').click();
    const firstPackage = await rows.first().locator('.package-name').textContent();
    await page.locator('#plugin-search').fill(firstPackage.trim());
    // A package search can also match related packages with the same prefix.
    await expect(page.locator('.plugin-heading').getByText(firstPackage.trim(), {exact: true})).toBeVisible();
    await page.locator('#plugin-search').fill('no-match-783491');
    await expect(page.locator('#empty-results')).toBeVisible();
    await page.locator('[data-reset]').click();
    await expect(page.locator('[data-plugin]:visible')).toHaveCount(PAGE);
    const chip = page.locator('[data-chip]').nth(1);
    const category = await chip.getAttribute('data-chip');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    const expectedCount = await page.locator('[data-plugin]').evaluateAll((nodes, category) => nodes.filter(node => node.dataset.category === category).length, category);
    await expect(page.locator('[data-plugin]:visible')).toHaveCount(Math.min(PAGE, expectedCount));
    await page.locator('[data-chip=""]').click();
    await expect(page.locator('[data-plugin]:visible')).toHaveCount(PAGE);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.languages a').click();
    await expect(page.locator('html')).toHaveAttribute('lang', language === 'en' ? 'zh-CN' : 'en');
    expect(errors).toEqual([]);
  });
  test(`${language}: catalog metadata, icons and screenshots`, async ({ page }, info) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
    await page.goto(route);
    const rows = page.locator('[data-plugin]');
    const snapshot = await (await page.request.get('./github.json')).json();
    const index = await (await page.request.get('./index.json')).json();
    const starLinks = page.locator('[data-stars]');
    const expectedStars = index.plugins.flatMap(plugin => {
      const key = githubRepository(plugin.repository?.url)?.key;
      const repo = key && snapshot.repositories[key];
      return repo && ['ok', 'stale'].includes(repo.status) ? [repo] : [];
    });
    await expect(starLinks).toHaveCount(expectedStars.length);
    const actualStars = await starLinks.evaluateAll(links => links.map(link => ({href: link.href, stars: Number(link.dataset.stars), title: link.title})));
    expect(actualStars.map(link => (link.href + ':' + link.stars).toLowerCase()).sort()).toEqual(expectedStars.map(repo => (repo.url + '/stargazers:' + repo.stars).toLowerCase()).sort());
    expect(actualStars.every(link => link.title.includes('UTC'))).toBe(true);
    const downloads = await (await page.request.get('./downloads.json')).json();
    const expectedDownloads = Object.values(downloads.packages).filter(record => ['ok', 'stale'].includes(record.status));
    const downloadLinks = page.locator('[data-downloads]');
    await expect(downloadLinks).toHaveCount(expectedDownloads.length);
    const actualDownloads = await downloadLinks.evaluateAll(links => links.map(link => ({ count: Number(link.dataset.downloads), href: link.href, title: link.title })));
    expect(actualDownloads.map(item => item.href + ':' + item.count).sort()).toEqual(expectedDownloads.map(item => item.source + ':' + item.downloads).sort());
    expect(actualDownloads.every(item => /\d{4}-\d{2}-\d{2}/.test(item.title))).toBe(true);
    await expect(page.locator('[data-publisher]')).toHaveCount(index.plugins.filter(plugin => plugin.metadata.labels.some(id => id.startsWith('publisher-'))).length);
    await expect(page.locator('.brand')).toContainText(language === 'en' ? 'Open Plugin Market' : '开放插件市场');
    await expect(rows.first().locator('.version')).toBeHidden();
    const below = rows.nth(1);
    await rows.first().locator('[data-more-toggle]').click();
    await expect(rows.first().locator('.version')).toBeVisible();
    await expect(rows.first().locator('[data-more-toggle]')).toHaveAttribute('aria-expanded', 'true');
    await expect(rows.first().locator('[data-get]')).toHaveAttribute('data-get', /\S/);
    await rows.first().locator('[data-more-toggle]').click();
    await expect(rows.first().locator('.version')).toBeHidden();
    // Blank card space opens the details too; clicking the title text does not.
    await rows.first().locator('.plugin-main').click({ position: { x: 6, y: 6 } });
    await expect(rows.first().locator('.version')).toBeVisible();
    await rows.first().locator('.plugin-main').click({ position: { x: 6, y: 6 } });
    await expect(rows.first().locator('.version')).toBeHidden();
    await rows.first().locator('h3').click({ position: { x: 4, y: 8 } });
    await expect(rows.first().locator('.version')).toBeHidden();
    expect(await below.isVisible()).toBe(true);
    expect(await downloadLinks.first().textContent()).not.toContain('/30');
    expect(await page.locator('.plugin-detail time').allTextContents()).toEqual(expect.arrayContaining([expect.stringMatching(language === 'en' ? /Updated/ : /更新/)]));
    const icons = page.locator('.plugin-avatar img:not(.avatar-placeholder)');
    await expect(icons).toHaveCount(index.plugins.filter(plugin => plugin.icon).length);
    // Every plugin without its own logo shows the whale-girl placeholder instead of an initial.
    await expect(page.locator('.plugin-avatar img.avatar-placeholder')).toHaveCount(index.plugins.filter(plugin => !plugin.icon).length);
    if (await icons.count()) {
      await icons.first().scrollIntoViewIfNeeded();
      await expect.poll(() => icons.first().evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
    }
    if (language === 'en' && info.project.name === 'desktop') {
      const broken = await page.evaluate(async paths => {
        let next = 0;
        const failures = [];
        await Promise.all(Array.from({length: Math.min(8, paths.length)}, async () => {
          while (next < paths.length) {
            const path = paths[next++];
            const image = new Image();
            image.src = new URL(path, location.href).href;
            try { await image.decode(); } catch { failures.push(path); }
          }
        }));
        return failures;
      }, [...new Set(index.plugins.map(plugin => plugin.icon).filter(Boolean))]);
      expect(broken).toEqual([]);
    }
    await page.locator('#plugins').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`${language}-directory.png`) });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: info.outputPath(`${language}-page.png`) });
    expect(errors).toEqual([]);
  });
  test(`${language}: copy and clipboard failure recovery`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto(route);
    await page.locator('[data-copy]').click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(INDEX_URL);
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } }));
    await page.locator('[data-copy]').click();
    await expect(page.locator('#index-url')).toBeFocused();
    expect(await page.locator('#index-url').evaluate(node => node.selectionEnd - node.selectionStart)).toBe(INDEX_URL.length);
    await expect(page.locator('#copy-status')).toContainText(language === 'en' ? 'selected' : '选中');
  });
}

test('content and the index URL remain available without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(baseURL);
  await expect(page.locator('#index-url')).toHaveValue(INDEX_URL);
  expect(await page.locator('[data-plugin]').count()).toBeGreaterThan(20);
  await expect(page.locator('[data-copy]')).toBeHidden();
  await expect(page.locator('[data-filters]')).toBeHidden();
  await context.close();
});
