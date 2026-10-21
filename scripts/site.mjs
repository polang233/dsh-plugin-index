import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { githubRepository } from './github.mjs';
import { releaseAge } from './market-display.mjs';
import { addedTimestamp } from './added.mjs';

const ORIGIN = 'https://dshopen.org/';
const INDEX_URL = `${ORIGIN}index.json`;
const REPOSITORY = 'https://github.com/polang233/dsh-plugin-index';
const DOCS = `${REPOSITORY}/blob/main/README.en.md`;
const SUBMIT = `${REPOSITORY}/issues/new?template=plugin-add.yml`;
const source = new URL('../site/', import.meta.url);
const output = new URL('../public/', import.meta.url);

const COPY = {
  en: {
    brand: 'Open Plugin Market', lang: 'en', locale: 'en_US', title: 'Open Plugin Market — DeepSeek Harness (DSH) plugin index', keywords: 'DeepSeek Harness plugins, DSH plugins, DSH plugin market, dsh plugin, DeepSeek Harness plugin index, Open Plugin Market', socialImage: 'social.png',
    statPlugins: 'plugins', statCategories: 'categories', more: 'Show more', sort: 'Sort', sorts: { default: 'Default', recommended: '✨ Smart picks', stars: 'Most stars', starsWeek: 'New stars (7 days)', added: 'Recently added', published: 'Recently updated', random: 'Random' }, shown: 'Showing {shown} of {count}',
    description: 'Community plugin market for DeepSeek Harness (DSH): tools, skills, memory, UI and more, recommended by growth, updates and downloads. Add one URL to browse and install them in DSH.',
    skip: 'Skip to content', plugins: 'Plugins', docs: 'Docs', language: 'Language',
    headline: 'Everything can be a plugin.<br><em>Find them here.</em>',
    intro: 'DeepSeek Harness is built around plugins, yet it ships no list or recommendations for community ones. The October 15 update added an official plugin market: paste one index JSON and you can browse and install community plugins without downloading anything by hand. So we built this index.',
    address: 'Index URL', copy: 'Copy URL', copyTitle: 'Click to copy',
    copied: 'Copied', copySuccess: 'URL copied. Open DSH and add it as an index source.', details: 'Details', copyOpen: 'Copy name & open DSH', nameCopied: 'Copied, opening…', dshOpened: 'Opened, paste it', dshMissed: 'Copied, open DSH', getFailure: 'Name selected, copy it', getHint: 'Paste the name into DSH Discover search to install.', pluginName: 'Name', copyFailure: 'The address is selected. Press Ctrl+C or ⌘C, or use the selection menu to copy it.',
    showcase: { title: 'How it looks in DSH', text: 'Stars aren\'t everything here. The default picks refresh every day and put fast-growing, actively shipped, genuinely good plugins first, with verification, downloads and stars as supporting signals.', points: ['No single author can flood the list, so a newcomer can make the first screen', 'Rising, Frequent updates and Verified labels at a glance', 'Default order, ✨ Smart picks and Random: every visit turns up something new'], image: 'dsh-discover-en.webp', alt: 'The Discover tab of DeepSeek Harness listing Open Plugin Market plugins with labels and install buttons' },
    zoom: 'Enlarge screenshot', close: 'Close', stepAlts: ['The Custom plugin markets switch under Plugins → Experimental plugins', 'The Add index source button in Discover', 'The index source dialog with the dshopen.org URL and the Add button'],
    setup: 'Quick start', steps: [
      ['Turn on the market', 'Plugins → Experimental → Custom plugin markets'],
      ['Add a source', 'Discover → Add index source'],
      ['Paste the URL', 'Paste the address above. Done.']
    ],
    directory: 'Plugin directory', search: 'Search plugins', searchPlaceholder: 'Name, package or description', category: 'Category', all: 'All categories', other: 'Other',
    results: '{count} of {total} plugins', initialCount: count => `${count} ${count === 1 ? 'plugin' : 'plugins'}`,
    noResults: 'No matching plugins', noResultsHelp: 'Try another search or choose all categories.', reset: 'Clear filters',
    noJs: 'All plugins are listed below. Use your browser’s Find command to search this page.',
    noDescription: 'No description provided by the package author.', version: 'Version', source: 'Source', npm: 'npm package', website: 'Website', compatibility: 'Requires DSH', noVersion: 'Version not listed',
    contributeTitle: 'Add a plugin to the index', contributeText: 'Have a useful DSH plugin? Send its package or repository link.', submit: 'Submit a plugin', readDocs: 'Read the docs',
    independent: 'An independent community project.', updated: 'Index updated', unknownDate: 'Update time unavailable',
    scope: 'Published-package checks do not replace an installation test or a code audit. DSH checks version compatibility when you install.',
    raw: 'JSON index', status: 'Build details', stats: 'Usage stats', footerTagline: 'A community plugin market for DeepSeek Harness. Fast-growing, actively shipped plugins first, so small developers get seen.', starCta: 'Star us on GitHub', starNote: 'If this market helps you, a star keeps it going. Do the same for the plugins you use: the next star might be someone starring yours.', footerData: 'At a glance', footerLinks: 'Links', verifiedCount: 'verified', refresh: 'Rebuilt every 6 hours', license: 'GPL-3.0 license',
  },
  zh: {
    brand: '开放插件市场', lang: 'zh-CN', locale: 'zh_CN', title: 'DSH 插件市场 · 开放插件市场 — DeepSeek Harness 社区插件索引', keywords: 'DeepSeek Harness 插件, DSH 插件, DSH 插件市场, dsh plugin, DeepSeek 插件, 插件索引, 开放插件市场', socialImage: 'social-zh.png',
    statPlugins: '个插件', statCategories: '个分类', more: '查看更多', sort: '排序', sorts: { default: '默认排序', recommended: '✨ 智能推荐', stars: 'star 最多', starsWeek: '近 7 天新增 star', added: '最近新增', published: '最近更新', random: '随机' }, shown: '已显示 {shown} / {count}',
    description: 'DeepSeek Harness（DSH）社区插件市场：工具、技能、记忆、界面等社区插件，按增长、更新和下载推荐。复制索引地址，在 DSH「发现」里浏览和安装。',
    skip: '跳到正文', plugins: '插件目录', docs: '文档', language: '语言',
    headline: '万物皆可插件，<br><em>插件来这里找。</em>',
    intro: 'DeepSeek Harness 以插件为核心，但官方没有提供社区插件的推荐和列表。10 月 15 日的更新加入了官方插件市场，填入一个索引 JSON 就能浏览和安装社区插件，不用再单独下载处理，方便了很多，于是我们做了这份索引。',
    address: '索引地址', copy: '复制地址', copyTitle: '点击复制',
    copied: '已复制', copySuccess: '地址已复制。打开 DSH，把它添加为索引源。', details: '详情', copyOpen: '复制插件名并打开 DSH', nameCopied: '已复制，正在打开…', dshOpened: '已打开，粘贴搜索', dshMissed: '已复制，请手动打开', getFailure: '已选中，请手动复制', getHint: '在 DSH「发现」里粘贴搜索即可安装。', pluginName: '插件名', copyFailure: '地址已选中。按 Ctrl+C 或 ⌘C，或使用选中文字的菜单复制。',
    showcase: { title: '在 DSH 里的样子', text: '不唯 star 🌟 论。默认推荐每天更新，以最近增长快、更新勤、优质的插件为主，同时参考验证、下载量和 star。', points: ['同一作者不会霸榜，小开发者的新作品也能上首屏', '增长快、更新勤、经过验证等标签一眼可见', '默认排序、✨ 智能推荐和随机，每次都有新发现'], image: 'dsh-discover-zh.webp', alt: 'DeepSeek Harness 的「发现」页面，列出开放插件市场的插件、标签和安装按钮' },
    zoom: '放大截图', close: '关闭', stepAlts: ['「插件 → 实验性插件」中的「自定义插件市场」开关', '「发现」里的「添加索引源」按钮', '填好 dshopen.org 地址的索引源窗口和「添加」按钮'],
    setup: '最简单使用教程', steps: [
      ['开启市场', '插件 → 实验性插件 → 自定义插件市场'],
      ['添加索引源', '发现 → 添加索引源'],
      ['粘贴地址', '粘贴上面的地址，完成']
    ],
    directory: '插件目录', search: '搜索插件', searchPlaceholder: '名称、包名或描述', category: '分类', all: '全部分类', other: '其他',
    results: '显示 {count} / {total} 个插件', initialCount: count => `${count} 个插件`,
    noResults: '没有匹配的插件', noResultsHelp: '换个关键词，或选择全部分类。', reset: '清除筛选',
    noJs: '下方显示全部插件。可使用浏览器的查找功能搜索本页。',
    noDescription: '作者尚未提供插件描述。', version: '版本', source: '源码', npm: 'npm 包', website: '网站', compatibility: '适用 DSH', noVersion: '未提供版本',
    contributeTitle: '让更多人找到你的插件', contributeText: '提交插件的包名或仓库地址，申请收录。', submit: '提交收录', readDocs: '阅读文档',
    independent: '独立社区项目。', updated: '索引更新于', unknownDate: '暂无更新时间',
    scope: '发布包检查不等于安装测试或代码审计。安装时，DSH 会检查版本兼容性。',
    raw: 'JSON 索引', status: '构建详情', stats: '使用统计', footerTagline: 'DeepSeek Harness 的社区插件市场。增长快、更新勤的插件优先展示，让小开发者也被看到。', starCta: '给项目点个 Star', starNote: '觉得好用就给我们点个 star 吧。用到的插件也别忘了给作者一个，没准下一个 star 就是别人点给你的。', footerData: '数据一览', footerLinks: '相关链接', verifiedCount: '个经过验证', refresh: '每 6 小时更新', license: 'GPL-3.0 许可证',
  }
};

// Real DSH screenshots for the three steps, each cropped around the highlighted control.
const GUIDE_SIZES = { zh: [[768, 472], [800, 476], [900, 446]], en: [[768, 508], [874, 476], [900, 446]] };
const GUIDE_THEME = process.env.GUIDE_THEME === 'dark' ? 'dark' : 'light';
const SIGNALS = ['verified', 'trending', 'active'];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const localize = (value, language, fallback = '') => typeof value === 'string' ? value : value && typeof value === 'object' ? String(value[language] ?? (language === 'zh' ? value['zh-cn'] : undefined) ?? value.en ?? Object.values(value).find(item => typeof item === 'string') ?? fallback) : fallback;
function safeUrl(value) {
  if (typeof value !== 'string') return undefined;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; } catch { return undefined; }
}
function dateLabel(value, language) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-GB', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date) : undefined;
}
function plainDescription(value) { return value.replace(/\s+/g, ' ').trim(); }
function newestVersion(versions = []) {
  // Officially parsed indexes are sorted by SemVer. Preserve that declared order.
  return versions[0];
}
export function renderStars(plugin, snapshot, language) {
  const repository = githubRepository(plugin.repository?.url);
  if (!repository) return '';
  const repo = snapshot?.repositories?.[repository.key];
  const zh = language === 'zh';
  const measured = repo && ['ok', 'stale'].includes(repo.status) && Number.isSafeInteger(repo.stars) && repo.stars >= 0 && Number.isFinite(Date.parse(repo.fetchedAt));
  if (!measured) return `<span class="stars-unavailable" data-stars-unavailable>${zh ? 'GitHub star 暂不可用' : 'GitHub stars unavailable'}</span>`;
  const count = new Intl.NumberFormat(zh ? 'zh-CN' : 'en').format(repo.stars);
  const date = new Date(repo.fetchedAt).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  const tooltip = `${repo.stars} GitHub stars · ${zh ? '获取于' : 'Fetched'} ${date}`;
  return `<span class="stars-group"><a class="github-stars" data-stars="${repo.stars}" href="${esc(repository.url)}/stargazers" title="${esc(tooltip)}" aria-label="${esc(tooltip)}"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/></svg>${count}<span class="stars-label">GitHub</span></a></span>`;
}
function pluginRow(plugin, language, categories, text, snapshot, root, downloads, display, labels, position = 0, added = {}) {
  const name = localize(plugin.name, language);
  const packageName = localize(plugin.name, 'en', name);
  const title = localize(plugin.title, language, name);
  const description = plainDescription(localize(display.plugins?.[plugin.name]?.description ?? plugin.description, language, text.noDescription));
  const version = newestVersion(plugin.versions);
  const categoryId = plugin.metadata?.category ?? '';
  const categoryTitle = localize(categories[categoryId]?.title, language, text.other);
  const sourceUrl = safeUrl(plugin.repository?.url) ?? safeUrl(version?.source?.type === 'git' ? version.source.url : undefined);
  const homepage = safeUrl(plugin.homepage);
  const npmUrl = version?.source?.type === 'npm' ? `https://www.npmjs.com/package/${packageName.split('/').map(encodeURIComponent).join('/')}` : undefined;
  const links = [];
  if (sourceUrl) links.push(`<a href="${esc(sourceUrl)}" rel="noopener noreferrer">${esc(text.source)}</a>`);
  if (npmUrl) links.push(`<a href="${esc(npmUrl)}" rel="noopener noreferrer">${esc(text.npm)}</a>`);
  if (!sourceUrl && homepage) links.push(`<a href="${esc(homepage)}" rel="noopener noreferrer">${esc(text.website)}</a>`);
  const search = [name, packageName, title, description, ...(plugin.metadata?.keywords ?? [])].join(' ');
  // Stable pastel tone per category so cards read as grouped without extra data.
  const tone = Array.from(categoryId).reduce((sum, char) => (sum * 31 + char.codePointAt(0)) % 997, 7) % 6;
  const date = version?.publishTimestamp != null ? releaseAge(version.publishTimestamp, Date.parse(display.generatedAt), language) : undefined;
  const npm = downloads.packages?.[plugin.name];
  const npmMeasured = npm && ['ok', 'stale'].includes(npm.status) && Number.isSafeInteger(npm.downloads) && npm.downloads >= 0;
  const npmTitle = npmMeasured ? `npm · ${npm.start} – ${npm.end} · ${language === 'zh' ? '获取于' : 'Fetched'} ${npm.fetchedAt}`: '';
  const own = plugin.metadata?.labels ?? [];
  const badges = own.filter(id => id.startsWith('publisher-') && labels[id]).map(id => `<span class="publisher-badge" data-publisher="${esc(id)}">${esc(localize(labels[id].title, language))}</span>`).join('')
    + SIGNALS.filter(id => own.includes(id) && labels[id]).map(id => `<span class="signal-badge" data-signal="${id}">${esc(localize(labels[id].title, language))}</span>`).join('');
  const namedTitle = title && title !== name;
  const icon = typeof plugin.icon === 'string' && /^icons\/[a-f0-9]{64}\.(?:svg|png|jpg|webp)$/.test(plugin.icon) ? root + plugin.icon : undefined;
  // Plugins without their own logo get the market's whale girl, peeking side to side.
  const avatar = icon ? `<img src="${esc(icon)}" alt="" width="44" height="44" loading="lazy" decoding="async">` : `<img class="avatar-placeholder" style="--peek-delay: -${(position % 7) * 0.45}" src="${root}assets/placeholder-whale.webp" alt="" width="54" height="54" loading="lazy" decoding="async">`;
  // Sort values mirror the index's sort keys so the website offers the same orders as DSH.
  const keys = plugin.metadata?.sortKeys ?? {};
  const sortData = [['order', position], ['recommended', keys.recommended], ['random', keys['random-resources']], ['stars', keys['github-stars']], ['stars-week', keys['stars-week']], ['added', addedTimestamp(added, plugin.name)], ['published', version?.publishTimestamp]]
    .filter(([, value]) => Number.isFinite(value)).map(([key, value]) => ` data-sort-${key}="${value}"`).join('');
  return `<li class="plugin" data-plugin data-tone="${tone}" data-category="${esc(categoryId)}" data-search="${esc(search)}"${sortData}>
    <article class="plugin-main" aria-label="${esc(title || name)}">
      <div class="plugin-heading"><span class="plugin-avatar" aria-hidden="true">${avatar}</span><div>${namedTitle ? `<h3 class="plugin-title">${esc(title)}</h3><p class="package-name">${esc(packageName)}</p>` : `<h3 class="package-name is-title">${esc(packageName)}</h3>`}</div></div>
      ${categoryId || badges ? `<div class="plugin-tags">${categoryId ? `<span class="plugin-tag">${esc(categoryTitle)}</span>` : ''}${badges}</div>` : ''}
      <p class="plugin-description">${esc(description)}</p>
    <div class="plugin-detail">
      ${renderStars(plugin, snapshot, language)}
      ${npmMeasured ? `<a class="npm-downloads" data-downloads="${npm.downloads}" href="${esc(npm.source)}" title="${esc(npmTitle)}"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/></svg>${esc(new Intl.NumberFormat(language === 'zh' ? 'zh-CN' : 'en-US').format(npm.downloads))}</a>` : ''}
      ${date ? `<time datetime="${esc(new Date(version.publishTimestamp * 1000).toISOString())}" title="${esc(dateLabel(version.publishTimestamp * 1000, language))}"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>${esc(date)}</time>` : ''}
      <div class="plugin-actions"><button type="button" class="more-toggle" data-more-toggle aria-expanded="false" aria-controls="more-${position}" hidden><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/></svg><span>${esc(text.details)}</span><svg class="chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button></div>
    </div>
    <div class="plugin-more" id="more-${position}" data-more-panel><div class="plugin-more-inner"><dl><dt>${esc(text.pluginName)}</dt><dd class="get-name">${esc(packageName)}</dd><dt>${esc(text.version)}</dt><dd class="version">${version ? esc(version.version) : esc(text.noVersion)}</dd>${version?.engines?.dsh ? `<dt>${esc(text.compatibility)}</dt><dd>${esc(version.engines.dsh)}</dd>` : ''}${version?.publishTimestamp ? `<dt>${language === 'zh' ? '发布于' : 'Released'}</dt><dd>${esc(dateLabel(version.publishTimestamp * 1000, language))}</dd>` : ''}</dl><p class="facts-links">${links.join('')}<button type="button" class="get-copy" data-get="${esc(packageName)}" title="${esc(text.getHint)}" hidden><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg><span>${esc(text.copyOpen)}</span></button></p></div></div>
    </article>
  </li>`;
}
function page(index, evidence, language, snapshot, downloads, display, added = {}) {
  const text = COPY[language];
  const docsUrl = language === 'zh' ? `${REPOSITORY}/blob/main/README.md` : DOCS;
  const root = language === 'zh' ? '../' : './';
  const canonical = language === 'zh' ? `${ORIGIN}zh/` : ORIGIN;
  const plugins = Array.isArray(index.plugins) ? index.plugins : [];
  const categories = index.metadata?.categories ?? {};
  const usedCategories = [...new Set(plugins.map(plugin => plugin.metadata?.category).filter(Boolean))];
  const hasUncategorized = plugins.some(plugin => !plugin.metadata?.category);
  const countBy = id => plugins.filter(plugin => (plugin.metadata?.category ?? '') === id).length;
  const chip = (value, label, count, extra = '') => `<button type="button" class="chip" data-chip="${esc(value)}"${extra} aria-pressed="false">${esc(label)}<small>${count}</small></button>`;
  const categoriesHtml = chip('', text.all, plugins.length)
    + usedCategories.map(id => chip(id, localize(categories[id]?.title, language, id), countBy(id))).join('')
    + (hasUncategorized ? chip('__uncategorized__', text.other, countBy(''), ' data-uncategorized') : '');
  const updated = evidence?.generatedAt ? dateLabel(evidence.generatedAt, language) : undefined;
  const verifiedCount = plugins.filter(plugin => plugin.metadata?.labels?.includes('verified')).length;
  const sortIds = ['default', 'recommended', 'stars', ...(plugins.some(plugin => Number.isFinite(plugin.metadata?.sortKeys?.['stars-week'])) ? ['starsWeek'] : []), ...(plugins.some(plugin => addedTimestamp(added, plugin.name) !== undefined) ? ['added'] : []), 'published', 'random'];
  const sortChips = sortIds.map((id, at) => `<button type="button" class="chip" data-sort="${id}" aria-pressed="${at === 0}">${esc(text.sorts[id])}</button>`).join('');
  const stickers = ['tools', 'skills', 'memory'].filter(id => usedCategories.includes(id))
    .map((id, at) => `<span class="sticker sticker-${at + 1}">${esc(localize(categories[id]?.title, language, id))}</span>`).join('');
  const messages = JSON.stringify({ copy: text.copy, copied: text.copied, copySuccess: text.copySuccess, copyFailure: text.copyFailure, nameCopied: text.nameCopied, dshOpened: text.dshOpened, dshMissed: text.dshMissed, getFailure: text.getFailure, results: text.results, more: text.more, shown: text.shown }).replace(/</g, '\\u003c');
  const structured = JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite', name: text.brand, url: ORIGIN, inLanguage: ['en', 'zh-CN'], description: text.description }).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="${text.lang}" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="theme-color" content="#eef3f8">
  <title>${esc(text.title)}</title>
  <meta name="description" content="${esc(text.description)}">
  <meta name="keywords" content="${esc(text.keywords)}">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" hreflang="en" href="${ORIGIN}">
  <link rel="alternate" hreflang="zh-CN" href="${ORIGIN}zh/">
  <link rel="alternate" hreflang="x-default" href="${ORIGIN}">
  <link rel="icon" href="${root}assets/favicon.png" type="image/png" sizes="64x64">
  <link rel="apple-touch-icon" href="${root}assets/apple-touch-icon.png" sizes="180x180">
  <link rel="stylesheet" href="${root}assets/site.css">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(text.brand)}">
  <meta property="og:locale" content="${text.locale}">
  <meta property="og:locale:alternate" content="${language === 'zh' ? 'en_US' : 'zh_CN'}">
  <meta property="og:title" content="${esc(text.title)}">
  <meta property="og:description" content="${esc(text.description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${ORIGIN}assets/${text.socialImage}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${esc(text.title)}">
  <meta name="twitter:card" content="summary_large_image">
  <script type="application/ld+json">${structured}</script>
  ${language === 'en' ? `<script>try{var l=localStorage.getItem('opm-lang');if(l==='zh'||(!l&&/^zh/i.test(navigator.language||'')))location.replace('zh/'+location.search+location.hash)}catch(e){}</script>` : ''}
  <script>document.documentElement.classList.replace('no-js', 'js')</script>
  <script src="${root}assets/site.js" defer></script>
</head>
<body>
  <a class="skip" href="#main">${esc(text.skip)}</a>
  <header class="site-header" data-header><div class="site-header-inner shell">
    <a class="brand" href="${root}index.html"><img src="${root}assets/logo-256.png" alt="" width="64" height="64"><span>${esc(text.brand)}</span></a>
    <nav class="header-links" aria-label="${language === 'zh' ? '主导航' : 'Main navigation'}">
      <a href="#plugins"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/></svg><span>${esc(text.plugins)}</span></a><a class="header-docs" href="${docsUrl}"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/></svg><span>${esc(text.docs)}</span></a><a href="${REPOSITORY}"><svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.8a10.2 10.2 0 0 0-3.2 19.9c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.6 1 1.6 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.3-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .9-.3 2.8 1a9.6 9.6 0 0 1 5.1 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.8-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10.2 10.2 0 0 0 12 1.8z"/></svg><span>GitHub</span></a>
      <div class="languages" data-current="${language}" aria-label="${esc(text.language)}">${language === 'en' ? '<span lang="en" aria-current="page">EN</span><a href="./zh/index.html" lang="zh-CN" hreflang="zh-CN" data-lang="zh">中文</a>' : '<a href="../index.html" lang="en" hreflang="en" data-lang="en">EN</a><span lang="zh-CN" aria-current="page">中文</span>'}</div>
    </nav>
  </div></header>
  <main id="main">
    <section class="hero shell" aria-labelledby="page-title">
      <div class="hero-copy">
      <h1 id="page-title">${text.headline}</h1>
      <p class="hero-lead">${esc(text.intro)}</p>
      <label class="address-label visually-hidden" for="index-url">${esc(text.address)}</label>
      <div class="address-bar">
        <textarea id="index-url" rows="2" readonly spellcheck="false" title="${esc(text.copyTitle)}" aria-describedby="copy-status">${INDEX_URL}</textarea>
        <button class="copy-button" type="button" data-copy hidden><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 8h12v13H8zM16 8V3H3v13h5"/></svg><span>${esc(text.copy)}</span></button>
        <p class="copy-status" id="copy-status" role="status" aria-live="polite"></p>
      </div>
      </div>
      <div class="hero-art" aria-hidden="true"><div class="art-blob"></div><img src="${root}assets/logo.webp" alt="" width="560" height="560" decoding="async">${stickers}</div>
      <h2 class="section-title steps-title" id="setup-title" data-reveal>${esc(text.setup)}</h2>
      <ol class="steps" aria-labelledby="setup-title" data-guide="${GUIDE_THEME}">${text.steps.map(([title, detail], at) => `<li data-reveal data-zoom-card style="--reveal-delay: ${at * 90}ms"><h3><span class="step-num" aria-hidden="true">${at + 1}</span>${esc(title)}</h3><button type="button" class="step-shot" data-zoom aria-label="${esc(text.zoom)}: ${esc(title)}"><img src="${root}assets/guide-${at + 1}-${language}-${GUIDE_THEME}.webp" alt="${esc(detail)}" title="${esc(detail)}" width="${GUIDE_SIZES[language][at][0]}" height="${GUIDE_SIZES[language][at][1]}" loading="lazy" decoding="async"></button></li>`).join('')}</ol>
    </section>
    <section class="directory-surface" id="plugins" aria-labelledby="directory-title">
    <section class="showcase shell" aria-labelledby="showcase-title">
      <div class="showcase-copy" data-reveal><h2 class="section-title" id="showcase-title">${esc(text.showcase.title)}</h2><p>${esc(text.showcase.text)}</p><ul>${text.showcase.points.map(point => `<li>${esc(point)}</li>`).join('')}</ul></div>
      <figure class="app-frame" data-reveal><div class="app-bar" aria-hidden="true"><span></span><span></span><span></span></div><picture><source media="(max-width: 620px)" srcset="${root}assets/${text.showcase.image.replace('.webp', '-narrow.webp')}" width="800" height="1028"><img src="${root}assets/${text.showcase.image}" alt="${esc(text.showcase.alt)}" width="1600" height="1000" loading="lazy" decoding="async"></picture><picture class="app-light"><source media="(max-width: 620px)" srcset="${root}assets/${text.showcase.image.replace('.webp', '-narrow-light.webp')}"><img src="${root}assets/${text.showcase.image.replace('.webp', '-light.webp')}" alt="" width="1600" height="1000" loading="lazy" decoding="async"></picture></figure>
    </section><div class="directory-zone"><div class="directory shell">
      <div class="directory-heading" data-reveal><h2 class="section-title" id="directory-title">${esc(text.directory)}</h2></div>
      <div class="directory-meta"><ul class="stats"><li><strong>${plugins.length}</strong> ${esc(text.statPlugins)}</li><li><strong>${usedCategories.length}</strong> ${esc(text.statCategories)}</li>${updated ? `<li>${esc(text.updated)} <strong>${esc(updated)}</strong></li>` : ''}</ul></div>
      <form class="filters" data-filters hidden role="search" aria-label="${esc(text.search)}">
        <div class="field"><label class="visually-hidden" for="plugin-search">${esc(text.search)}</label><div class="search-box"><input type="search" id="plugin-search" placeholder="${esc(text.searchPlaceholder)}" autocomplete="off"><p class="result-count" id="result-count" role="status" aria-live="polite">${esc(text.initialCount(plugins.length))}</p></div></div>
        <div class="field chips-field"><span class="field-label visually-hidden" id="sort-label">${esc(text.sort)}</span><div class="chips sort-chips" role="group" aria-labelledby="sort-label">${sortChips}</div></div>
        <div class="field chips-field"><span class="field-label visually-hidden" id="category-label">${esc(text.category)}</span><div class="chips" role="group" aria-labelledby="category-label">${categoriesHtml}</div></div>
      </form>
      <noscript><p class="no-js">${esc(text.noJs)}</p></noscript>
      <ul class="plugin-list">${plugins.map((plugin, position) => pluginRow(plugin, language, categories, text, snapshot, root, downloads, display, index.metadata?.labels ?? {}, position, added)).join('\n')}</ul>
      <div class="more" data-more-wrap hidden><p class="more-progress" data-progress role="status" aria-live="polite"></p><span class="more-bar" aria-hidden="true"><i data-bar></i></span><button type="button" class="more-button" data-more></button></div>
      <div class="empty" id="empty-results" ${plugins.length ? 'hidden' : ''}><h3>${esc(text.noResults)}</h3><p>${esc(text.noResultsHelp)}</p><button type="button" class="text-button" data-reset hidden>${esc(text.reset)}</button></div>
    </div>
    <section class="contribute shell" aria-labelledby="contribute-title" data-reveal>
      <div><h2 id="contribute-title">${esc(text.contributeTitle)}</h2><p>${esc(text.contributeText)}</p></div>
      <div class="contribute-links"><a class="submit-link" href="${esc(SUBMIT)}">${esc(text.submit)}</a><a href="${docsUrl}">${esc(text.readDocs)}</a></div>
    </section>
    </div></section>
  </main>
  <footer class="site-footer">
    <div class="footer-grid shell">
      <div class="footer-brand"><a class="footer-logo" href="${root}index.html"><img src="${root}assets/logo-256.png" alt="" width="48" height="48"><span>${esc(text.brand)}</span></a><p>${esc(text.footerTagline)}</p><div class="star-wrap"><a class="star-cta" href="${REPOSITORY}" aria-describedby="star-note"><span aria-hidden="true">⭐</span>${esc(text.starCta)}</a><p class="star-note" id="star-note" role="tooltip">${esc(text.starNote)}</p></div></div>
      <div><h2>${esc(text.footerData)}</h2><ul class="footer-stats"><li><strong>${plugins.length}</strong> ${esc(text.statPlugins)}</li><li><strong>${usedCategories.length}</strong> ${esc(text.statCategories)}</li><li><strong>${verifiedCount}</strong> ${esc(text.verifiedCount)}</li><li>${esc(text.refresh)}${updated ? ` · ${esc(updated)}` : ''}</li></ul></div>
      <div><h2>${esc(text.footerLinks)}</h2><ul class="footer-links"><li><a href="${esc(SUBMIT)}">${esc(text.submit)}</a></li><li><a href="${docsUrl}">${esc(text.readDocs)}</a></li><li><a href="${REPOSITORY}">GitHub</a></li><li><a href="${root}index.json">${esc(text.raw)}</a></li><li><a href="${root}status.json">${esc(text.status)}</a></li><li><a href="${root}stats.json">${esc(text.stats)}</a></li></ul></div>
    </div>
    <div class="footer-bottom shell"><p>${esc(text.independent)} ${esc(text.scope)}</p><p><a href="${REPOSITORY}/blob/main/LICENSE">${esc(text.license)}</a></p></div>
  </footer>
  <dialog class="shot-viewer" data-viewer><button type="button" class="viewer-close" data-viewer-close aria-label="${esc(text.close)}">×</button><img alt=""></dialog>
  <script id="site-messages" type="application/json">${messages}</script>
</body>
</html>\n`;
}

function sitemap(updated) {
  const lastmod = updated ? `<lastmod>${updated.slice(0, 10)}</lastmod>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${[ORIGIN, `${ORIGIN}zh/`].map(url => `  <url><loc>${url}</loc>${lastmod}<xhtml:link rel="alternate" hreflang="en" href="${ORIGIN}"/><xhtml:link rel="alternate" hreflang="zh-CN" href="${ORIGIN}zh/"/><xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}"/></url>`).join('\n')}\n</urlset>\n`;
}

function notFound(css) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Page not found — Open Plugin Market</title><link rel="icon" href="${ORIGIN}assets/favicon.png" type="image/png" sizes="64x64"><style>${css}</style></head><body><header class="site-header shell"><a class="brand" href="${ORIGIN}"><img src="${ORIGIN}assets/logo-256.png" alt="" width="64" height="64"><span>Open Plugin Market</span></a></header><main class="shell hero"><h1>Page not found.</h1><p lang="zh-CN">页面不存在。</p><p>Open the plugin directory to continue.</p><p lang="zh-CN">返回插件目录，继续查找插件。</p><div class="contribute-links"><a class="submit-link" href="${ORIGIN}">English directory</a><a class="submit-link" href="${ORIGIN}zh/" lang="zh-CN">中文目录</a></div></main></body></html>\n`;
}

/** Write the bilingual static site alongside the canonical format-1 index. */
export async function writeSite(index, evidence, snapshot = {}, downloads = {}, display = {}) {
  if (index?.format !== 1 || !Array.isArray(index.plugins)) throw new Error('writeSite expects a format-1 plugin index');
  await mkdir(new URL('assets/', output), { recursive: true });
  await mkdir(new URL('zh/', output), { recursive: true });
  for (const asset of ['site.css', 'site.js', 'logo.webp', 'logo-256.png', 'favicon.png', 'apple-touch-icon.png', 'placeholder-whale.webp', 'social.png', 'social-zh.png', ...['zh', 'en'].flatMap(lang => ['', '-light', '-narrow', '-narrow-light'].map(kind => `dsh-discover-${lang}${kind}.webp`)), ...[1, 2, 3].flatMap(n => ['zh', 'en'].flatMap(lang => ['light', 'dark'].map(theme => `guide-${n}-${lang}-${theme}.webp`)))]) {
    await copyFile(new URL(asset, source), new URL(`assets/${asset}`, output));
  }
  // Full builds refresh added.json first; the offline rebuilds reuse whatever is already published.
  let added = {};
  try { added = JSON.parse(await readFile(new URL('added.json', output), 'utf8')); } catch { /* No record yet. */ }
  await writeFile(new URL('index.html', output), page(index, evidence, 'en', snapshot, downloads, display, added).replace(/[\t ]+$/gm, ''), 'utf8');
  await writeFile(new URL('zh/index.html', output), page(index, evidence, 'zh', snapshot, downloads, display, added).replace(/[\t ]+$/gm, ''), 'utf8');
  await writeFile(new URL('sitemap.xml', output), sitemap(evidence?.generatedAt), 'utf8');
  await writeFile(new URL('robots.txt', output), `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}sitemap.xml\n`, 'utf8');
  await writeFile(new URL('404.html', output), notFound(await readFile(new URL('site.css', source), 'utf8')), 'utf8');
}
