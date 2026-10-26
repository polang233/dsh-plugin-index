import { test, expect } from '@playwright/test';
import {githubRepository} from '../../scripts/github.mjs';

const INDEX_URL = 'https://dshopen.org/index.json';
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SITE = {
  en: { route: './', lang: 'en', brand: 'Open Plugin Market', selected: 'selected', updated: /Updated/ },
  zh: { route: './zh/', lang: 'zh-CN', brand: '开放插件市场', selected: '选中', updated: /更新/ },
  tw: { route: './zh-tw/', lang: 'zh-TW', brand: '開放外掛市場', selected: '選中', updated: /更新/ }
};
// Likes, the project's star count and README badges come from dshopen.org and shields.io; tests never reach them.
test.beforeEach(async ({ page }) => {
  await page.route('https://dshopen.org/likes.json', route => route.fulfill({ json: { schema: 1, likes: {} } }));
  await page.route('https://dshopen.org/api/stars', route => route.fulfill({ json: { stars: 1234 } }));
  await page.route('https://img.shields.io/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="20"/>' }));
});

for (const language of Object.keys(SITE)) {
  const route = SITE[language].route;
  test(`${language}: directory filters, language navigation and layout`, async ({ page }) => {
    test.slow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
    await page.goto(route);
    await expect(page.locator('html')).toHaveAttribute('lang', SITE[language].lang);
    await expect(page.locator('#index-url')).toHaveValue(INDEX_URL);
    await expect(page.locator('.languages > *')).toHaveCount(3);
    await expect(page.locator('.languages [aria-current]')).toHaveCount(1);
    const rows = page.locator('[data-plugin]');
    const index = await (await page.request.get('./index.json')).json();
    // The page ships 48 cards; the first view follows the columns: 24 for three, 16 for two, 12 for one.
    await expect(rows).toHaveCount(48);
    const columns = await page.locator('.plugin-list').evaluate(list => getComputedStyle(list).gridTemplateColumns.split(' ').length);
    const PAGE = { 1: 12, 2: 16, 3: 24 }[columns];
    await expect(page.locator('[data-plugin]:visible')).toHaveCount(PAGE);
    await expect(page.locator('[data-more]')).toBeVisible();
    await page.locator('[data-more]').click();
    // The first click shows the ready batch and readies a larger one; scrolling never loads more on its own.
    await expect(page.locator('[data-plugin]:visible')).toHaveCount(PAGE * 2);
    // The page already carries 48, so on narrow screens nothing more is fetched yet.
    await expect(rows).toHaveCount(Math.max(48, PAGE * 2 + PAGE / 2 * 3));
    await page.locator('[data-more]').click();
    await expect(page.locator('[data-plugin]:visible')).toHaveCount(PAGE * 2 + PAGE / 2 * 3);
    await page.mouse.wheel(0, 20000);
    await page.waitForTimeout(300);
    await expect(page.locator('[data-plugin]:visible')).toHaveCount(PAGE * 2 + PAGE / 2 * 3);
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
    const expectedCount = index.plugins.filter(plugin => plugin.metadata?.category === category).length;
    await expect(page.locator('[data-plugin]:visible')).toHaveCount(Math.min(PAGE, expectedCount));
    await page.locator('[data-chip=""]').click();
    await expect(page.locator('[data-plugin]:visible')).toHaveCount(PAGE);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const next = await page.locator('.languages a').first().getAttribute('data-lang');
    await page.locator('.languages a').first().click();
    await expect(page.locator('html')).toHaveAttribute('lang', SITE[next].lang);
    expect(errors).toEqual([]);
  });
  test(`${language}: catalog metadata, icons and screenshots`, async ({ page }, info) => {
    test.slow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
    await page.goto(route);
    const rows = page.locator('[data-plugin]');
    const snapshot = await (await page.request.get('./github.json')).json();
    const index = await (await page.request.get('./index.json')).json();
    // Sorting loads the rest of the catalog.
    await page.locator('[data-sort="stars"]').click();
    await expect(rows).toHaveCount(index.plugins.length, { timeout: 15000 });
    await page.locator('[data-sort="default"]').click();
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
    await expect(page.locator('.brand')).toContainText(SITE[language].brand);
    await expect(rows.first().locator('.version')).toBeHidden();
    const below = rows.nth(1);
    // Anywhere on the card unfolds its details, text included.
    await rows.first().locator('.plugin-description').click({ position: { x: 10, y: 10 } });
    await expect(rows.first().locator('.version')).toBeVisible();
    await expect(rows.first().locator('.plugin-main')).toHaveAttribute('aria-expanded', 'true');
    await expect(rows.first().locator('[data-get]')).toHaveAttribute('data-get', /\S/);
    await rows.first().locator('.plugin-main').click({ position: { x: 6, y: 6 } });
    await expect(rows.first().locator('.version')).toBeHidden();
    expect(await below.isVisible()).toBe(true);
    expect(await downloadLinks.first().textContent()).not.toContain('/30');
    expect(await page.locator('.plugin-detail time').allTextContents()).toEqual(expect.arrayContaining([expect.stringMatching(SITE[language].updated)]));
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
    await expect(page.locator('#copy-status')).toContainText(SITE[language].selected);
  });
  test(`${language}: plugin pages link from the directory and back`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()}: ${response.url()}`); });
    await page.goto(route);
    const card = page.locator('[data-plugin]').first();
    const name = (await card.locator('[data-get]').getAttribute('data-get')).trim();
    await card.locator('.plugin-link').click();
    await expect(page).toHaveURL(new RegExp(`plugins/${escapeRegExp(name)}/$`));
    await expect(page.locator('html')).toHaveAttribute('lang', SITE[language].lang);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.install-name .get-name')).toHaveText(name);
    await expect(page.locator('#index-url')).toHaveValue(INDEX_URL);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`plugins/${escapeRegExp(name)}/$`));
    await expect(page.locator('link[rel="alternate"]')).toHaveCount(5);
    const structured = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(structured.map(item => JSON.parse(item)['@type'])).toEqual(['SoftwareApplication', 'BreadcrumbList']);
    // The language switch keeps the reader on the same plugin.
    const next = await page.locator('.languages a').first().getAttribute('data-lang');
    await page.locator('.languages a').first().click();
    await expect(page.locator('html')).toHaveAttribute('lang', SITE[next].lang);
    await expect(page.locator('.install-name .get-name')).toHaveText(name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.brand').click();
    await expect(page.locator('#plugins')).toBeAttached();
    // The corner link opens the page too.
    const other = page.locator('[data-plugin]').nth(1);
    const otherName = (await other.locator('[data-get]').getAttribute('data-get')).trim();
    await other.locator('.page-link').click();
    await expect(page).toHaveURL(new RegExp(`plugins/${escapeRegExp(otherName)}/$`));
    await expect(page.locator('.detail-panel:not(:has(.install-steps)) .snippet code')).toContainText('img.shields.io/endpoint?url=https%3A%2F%2Fdshopen.org%2Fbadge%2F');
    // The Open Market plugin is offered as an easier way to install and update.
    await expect(page.locator('.install-plugin code')).toHaveText('dsh plugin --profile desktop add dsh-open-market');
    expect(errors).toEqual([]);
  });
  test(`${language}: likes and the project's stars`, async ({ page }) => {
    let liked;
    await page.route('https://dshopen.org/api/like', async route => { liked = route.request().postDataJSON(); await route.fulfill({ json: { name: liked.name, likes: 5, counted: true } }); });
    await page.goto(route);
    const like = page.locator('[data-plugin]').first().locator('[data-like]');
    await expect(like).toBeVisible();
    await like.click();
    await expect(like).toHaveAttribute('aria-pressed', 'true');
    await expect(like.locator('[data-like-count]')).toHaveText('5');
    expect(liked).toEqual({ name: await like.getAttribute('data-like'), source: 'like' });
    await expect(page.locator('.github-link [data-gh-stars]')).toHaveText(/1[,.\s]?234/);
  });
  test(`${language}: usage stats page draws days and countries`, async ({ page }) => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await page.route('https://dshopen.org/stats.json', route => route.fulfill({ json: {
      schema: 1, total: 5000, today: { reads: 900, readers: 400 },
      last30Days: { reads: 3000, readers: 1300, daily: [{ day: yesterday, reads: 2100, readers: 900 }, { day: today, reads: 900, readers: 400 }] },
      countries: { since: yesterday, today: [], last30Days: [{ country: 'CN', reads: 2000, readers: 900 }, { country: 'TW', reads: 600, readers: 250 }, { country: 'JP', reads: 300, readers: 100 }, { country: 'XX', reads: 100, readers: 50 }] }
    } }));
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(route + 'stats/');
    await expect(page.locator('[data-tile="todayReaders"] [data-value]')).toHaveText(/400/);
    await expect(page.locator('[data-tile="plugins"] [data-value]')).toHaveText(/\d/);
    // Loads show by default; each chip adds or removes a line, and the last line cannot be switched off.
    await expect(page.locator('[data-daily] .series-line')).toHaveCount(1);
    await expect(page.locator('[data-daily] .series-point.is-today')).toHaveCount(1);
    await page.locator('[data-series="readers"]').click();
    await expect(page.locator('[data-daily] .series-line')).toHaveCount(2);
    await page.locator('[data-series="reads"]').click();
    await page.locator('[data-series="readers"]').click();
    await expect(page.locator('[data-daily] .series-line')).toHaveCount(1);
    await expect(page.locator('[data-countries] li')).toHaveCount(4);
    // 900 of 1,300 people: the largest share comes first.
    await expect(page.locator('[data-countries] li').first().locator('strong')).toHaveText(/69[.,]2/);
    await expect(page.locator('[data-daily-table] tr')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
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

test('usage stats page shows the Cloudflare split as shares of loads', async ({ page }) => {
  await page.route('https://dshopen.org/stats.json', route => route.fulfill({ json: {
    schema: 1, total: 100, today: { reads: 10, readers: 5 },
    last30Days: { reads: 100, readers: 50, daily: [{ day: new Date().toISOString().slice(0, 10), reads: 10, readers: 5 }] },
    countries: { source: 'cloudflare', metric: 'reads', since: null, today: [], last30Days: [{ country: 'CN', reads: 300 }, { country: 'MO', reads: 100 }] }
  } }));
  await page.goto('./zh/stats/');
  await expect(page.locator('[data-countries] li')).toHaveCount(2);
  await expect(page.locator('[data-countries] li').first().locator('strong')).toHaveText('75%');
  await expect(page.locator('[data-countries] li').nth(1).locator('.country-name')).toHaveText('中国澳门');
  await expect(page.locator('[data-countries-note]')).toContainText('Cloudflare');
  await expect(page.locator('.donut-label')).toHaveText('加载次数');
});
