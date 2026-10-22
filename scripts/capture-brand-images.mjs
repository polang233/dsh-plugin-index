// Rebuild the sharing cards (English, Simplified and Traditional Chinese) and the README home screenshots from the local site.
// Run build:site first; needs sharp and Playwright's Chromium, or BROWSER_EXECUTABLE.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const { default: sharp } = await import(process.env.SHARP_PATH ?? 'sharp');
const root = fileURLToPath(new URL('..', import.meta.url));
const port = process.env.DSH_INDEX_PREVIEW_PORT ?? '4177';
const base = `http://127.0.0.1:${port}/dsh-plugin-index/`;
const preview = spawn(process.execPath, ['scripts/preview.mjs'], {
  cwd: root,
  env: { ...process.env, DSH_INDEX_PREVIEW_PORT: port },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});

const socialStyles = `
  .site-header, footer, main > section:not(.hero),
  .hero > .steps-title, .hero > .steps { display: none !important; }
  body { min-height: 630px; }
  .hero {
    width: calc(100% - 64px); height: 630px; margin: 0 32px; padding: 32px 0;
    grid-template-columns: minmax(0, 1.45fr) minmax(220px, .55fr);
    grid-template-rows: 1fr; gap: 32px;
  }
  .hero h1 { font-size: 60px; line-height: 1.1; }
  html[lang^="zh"] .hero h1 { font-size: 56px; line-height: 1.2; }
  .hero-lead { font-size: 20px; line-height: 1.7; max-width: none; }
  .hero-art { max-width: 300px; }
  .copy-status { display: none; }
`;

let browser;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Local preview did not start')), 15000);
    preview.once('error', error => { clearTimeout(timer); reject(error); });
    preview.once('exit', code => { clearTimeout(timer); reject(new Error(`Local preview exited: ${code}`)); });
    preview.stdout.on('data', data => {
      if (data.toString().includes('Preview:')) { clearTimeout(timer); resolve(); }
    });
    preview.stderr.on('data', data => process.stderr.write(data));
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'light',
    locale: 'en-US',
  });
  // Traditional Chinese only needs a sharing card; the README shows the English and Simplified pages.
  const pages = { en: { path: './', lang: 'en', social: 'social.png', readme: true }, zh: { path: 'zh/', lang: 'zh-CN', social: 'social-zh.png', readme: true }, tw: { path: 'zh-tw/', lang: 'zh-TW', social: 'social-tw.png', readme: false } };
  for (const [language, target] of Object.entries(pages)) {
    const page = await context.newPage();
    await page.addInitScript(language => localStorage.setItem('opm-lang', language), language);
    await page.goto(new URL(target.path, base).href);
    assert.equal(await page.locator('html').getAttribute('lang'), target.lang);
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: `
      *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
      [data-reveal] { opacity: 1 !important; transform: none !important; }
      /* Today's live count would date the images, so it stays out of them. */
      .usage { display: none !important; }
    ` });
    await page.locator('.hero img, .brand img').evaluateAll(async images => {
      await Promise.all(images.map(image => image.decode()));
    });
    assert.equal(await page.locator('.hero-art img').evaluate(image => image.naturalWidth), 720);
    assert.equal(await page.locator('.brand img').evaluate(image => image.naturalWidth), 256);
    if (target.readme) await page.screenshot({
      path: fileURLToPath(new URL(`../docs/images/originals/home-${language}.png`, import.meta.url)),
      animations: 'disabled',
    });
    await page.setViewportSize({ width: 1200, height: 630 });
    await page.addStyleTag({ content: socialStyles });
    const copy = await page.locator('.hero-copy').boundingBox();
    assert(copy.y >= 0 && copy.y + copy.height <= 630, `${language} sharing-card copy is clipped`);
    const screenshot = await page.screenshot({ animations: 'disabled' });
    const social = target.social;
    await sharp(screenshot).png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(fileURLToPath(new URL(`../site/${social}`, import.meta.url)));
    console.log(target.readme ? `Captured docs/images/originals/home-${language}.png and site/${social}` : `Captured site/${social}`);
    await page.close();
  }
} finally {
  try { await browser?.close(); } finally { preview.kill(); }
}
