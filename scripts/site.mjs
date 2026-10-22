import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Converter } from 'opencc-js';
import { githubRepository } from './github.mjs';
import { releaseAge } from './market-display.mjs';
import { addedTimestamp } from './added.mjs';

const ORIGIN = 'https://dshopen.org/';
const INDEX_URL = `${ORIGIN}index.json`;
const STATS_URL = `${ORIGIN}stats.json`;
const REPOSITORY = 'https://github.com/polang233/dsh-plugin-index';
const DOCS = `${REPOSITORY}/blob/main/README.en.md`;
const SUBMIT = `${REPOSITORY}/issues/new?template=plugin-add.yml`;
const source = new URL('../site/', import.meta.url);
const output = new URL('../public/', import.meta.url);

// Site languages: the folder each lives in, its tags, its switcher label and which index language it reads.
// Traditional Chinese is the Simplified page run through OpenCC with Taiwan phrasing (插件 → 外掛, 软件 → 軟體).
export const LANGUAGES = {
  en: { dir: '', tag: 'en', locale: 'en_US', label: 'EN', name: 'English', data: 'en' },
  zh: { dir: 'zh/', tag: 'zh-CN', locale: 'zh_CN', label: '简', name: '简体中文', data: 'zh' },
  tw: { dir: 'zh-tw/', tag: 'zh-TW', locale: 'zh_TW', label: '繁', name: '繁體中文', data: 'zh' }
};
const toTraditional = Converter({ from: 'cn', to: 'twp' });
// DSH's own menus are in Simplified Chinese, so text marked with ui() keeps its exact wording on the Traditional pages.
const ui = label => `\uE000${label}\uE001`;
// Taiwan usage OpenCC leaves as mainland terms.
const TAIWAN_TERMS = [['賬', '帳'], ['質量', '品質']];
const traditional = html => html.split(/(\uE000[^\uE001]*\uE001)/).map(part => part.startsWith('\uE000') ? part : TAIWAN_TERMS.reduce((text, [from, to]) => text.replaceAll(from, to), toTraditional(part))).join('');
const finish = (html, language) => (language === 'tw' ? traditional(html) : html).replace(/[\uE000\uE001]/g, '').replace(/[\t ]+$/gm, '');

const COPY = {
  en: {
    brand: 'Open Plugin Market', title: 'Open Plugin Market — DeepSeek Harness (DSH) plugin index', keywords: 'DeepSeek Harness plugins, DSH plugins, DSH extensions, DSH plugin market, dsh plugin, DeepSeek Harness plugin index, Open Plugin Market', socialImage: 'social.png',
    statPlugins: 'plugins', statCategories: 'categories', more: 'Show more', sort: 'Sort', sorts: { default: 'Default', recommended: '✨ Smart picks', stars: 'Most stars', starsWeek: 'New stars (7 days)', published: 'Recently updated', random: 'Random' }, shown: 'Showing {shown} of {count}',
    description: 'Community plugin market for DeepSeek Harness (DSH): tools, skills, memory, UI and more, recommended by growth, updates and downloads. Add one URL to browse and install them in DSH.',
    skip: 'Skip to content', plugins: 'Plugins', docs: 'Docs', statsNav: 'Stats', language: 'Language', nav: 'Main navigation', home: 'Home',
    headline: 'Everything can be a plugin.<br><em>Find them here.</em>',
    intro: 'DeepSeek Harness is built around plugins, yet it ships no list or recommendations for community ones. The October 15 update added an official plugin market: paste one index JSON and you can browse and install community plugins without downloading anything by hand. So we built this index.',
    address: 'Index URL', copy: 'Copy URL', copyTitle: 'Click to copy',
    copied: 'Copied', usage: '{readers} people using it today', usageNote: 'People whose DSH loaded this index today (UTC date), counted once per IP and user agent; neither is stored.', copySuccess: 'URL copied. Open DSH and add it as an index source.', details: 'Details', copyOpen: 'Copy name & open DSH', nameCopied: 'Copied, opening…', dshOpened: 'Opened, paste it', dshMissed: 'Copied, open DSH', getFailure: 'Name selected, copy it', getHint: 'Paste the name into DSH Discover search to install.', pluginName: 'Name', copyFailure: 'The address is selected. Press Ctrl+C or ⌘C, or use the selection menu to copy it.',
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
    noDescription: 'No description provided by the package author.', version: 'Version', source: 'Source', npm: 'npm package', website: 'Website', compatibility: 'Requires DSH', noVersion: 'Version not listed', released: 'Released',
    contributeTitle: 'Add a plugin to the index', contributeText: 'Have a useful DSH plugin? Send its package or repository link.', submit: 'Submit a plugin', readDocs: 'Read the docs',
    independent: 'An independent community project.', updated: 'Index updated', unknownDate: 'Update time unavailable',
    scope: 'Published-package checks do not replace an installation test or a code audit. DSH checks version compatibility when you install.',
    raw: 'JSON index', status: 'Build details', stats: 'Usage stats', footerTagline: 'A community plugin market for DeepSeek Harness. Fast-growing, actively shipped plugins first, so small developers get seen.', starCta: 'Star us on GitHub', starNote: 'If this market helps you, a star keeps it going. Do the same for the plugins you use: the next star might be someone starring yours.', footerData: 'At a glance', footerLinks: 'Links', verifiedCount: 'verified', refresh: 'Rebuilt every 6 hours', license: 'GPL-3.0 license',
    starsUnavailable: 'GitHub stars unavailable', fetched: 'Fetched',
    // Plugin pages.
    pluginTitle: title => `${title} — DeepSeek Harness (DSH) plugin · Open Plugin Market`,
    pluginDescription: (title, description) => `${title}: ${description} A community plugin for DeepSeek Harness (DSH), listed on Open Plugin Market.`,
    install: 'Install in DSH', installSteps: ['Add Open Plugin Market as an index source once: Plugins → Experimental → Custom plugin markets, then Discover → Add index source, and paste this URL.', 'Copy the plugin name, open DSH and paste it into Discover search to install.'],
    facts: 'Plugin details', author: 'Author', keywords: 'Keywords', related: 'More in {category}', browseAll: 'Browse all plugins', npmMonth: 'npm downloads in the last 30 days',
    // Usage stats page.
    statsTitle: 'Usage stats — Open Plugin Market', statsHeading: 'Usage stats', statsDescription: 'How many people use Open Plugin Market in DeepSeek Harness each day, and where they are: daily users and loads for the last 30 days, by country and region.',
    statsLead: 'DSH fetches this market’s index each time it loads or refreshes it. The numbers below come straight from those fetches and refresh every few minutes.',
    statsTiles: { todayReaders: 'People today', todayReads: 'Loads today', monthReaders: 'People, last 30 days', totalReads: 'Loads in total' },
    monthReadersNote: 'Sum of each day’s people; someone who uses DSH on several days counts once per day.',
    dailyTitle: 'Daily use, last 30 days', metricReaders: 'People', metricReads: 'Loads', metric: 'Show',
    countriesTitle: 'Where people use it', countriesNote: 'Share of people over the last 30 days. Collected since {since}.', countriesNoteLoads: 'Share of loads over the last 30 days, from Cloudflare traffic analytics (sampled, so approximate).', regionsTitle: 'By UN geographic region', countriesSub: 'By country or region',
    regions: { Asia: 'Asia', Americas: 'Americas', Europe: 'Europe', Oceania: 'Oceania', Africa: 'Africa', Unknown: 'Unknown' },
    // Names follow United Nations usage.
    regionNames: { HK: 'Hong Kong SAR, China', MO: 'Macao SAR, China', TW: 'Taiwan Province of China' }, countriesEmpty: 'Country and region data has not started yet. It appears here from the first day it is collected.',
    unknownRegion: 'Unknown', otherRegions: 'Other {count}', share: 'Share', day: 'Day', region: 'Country or region', showTable: 'Show as a table',
    methodTitle: 'How this is counted', methodText: 'A load is one fetch of index.json. People are distinct IP address and user agent pairs within one UTC day: the pair is hashed with a daily salt to dedupe the day and is never stored. Countries and regions come from Cloudflare’s network location as two-letter codes: the split by loads is read from Cloudflare’s own traffic analytics for the last 30 days, and nothing finer than the country is kept. Checks made by this project are not counted.', rawStats: 'Raw data (stats.json)',
    statsLoading: 'Loading usage stats…', statsFailed: 'Usage stats are unavailable right now. Try again later.'
  },
  zh: {
    brand: '开放插件市场', title: 'DSH 插件市场 · 开放插件市场 — DeepSeek Harness 社区插件索引', keywords: 'DeepSeek Harness 插件, DSH 插件, DSH 插件市场, dsh plugin, DeepSeek 插件, 插件索引, 开放插件市场', socialImage: 'social-zh.png',
    statPlugins: '个插件', statCategories: '个分类', more: '查看更多', sort: '排序', sorts: { default: '默认排序', recommended: '✨ 智能推荐', stars: 'star 最多', starsWeek: '近 7 天新增 star', published: '最近更新', random: '随机' }, shown: '已显示 {shown} / {count}',
    description: `DeepSeek Harness（DSH）社区插件市场：工具、技能、记忆、界面等社区插件，按增长、更新和下载推荐。复制索引地址，在 DSH「${ui('发现')}」里浏览和安装。`,
    skip: '跳到正文', plugins: '插件目录', docs: '文档', statsNav: '统计', language: '语言', nav: '主导航', home: '首页',
    headline: '万物皆可插件，<br><em>插件来这里找。</em>',
    intro: 'DeepSeek Harness 以插件为核心，但官方没有提供社区插件的推荐和列表。10 月 15 日的更新加入了官方插件市场，填入一个索引 JSON 就能浏览和安装社区插件，不用再单独下载处理，方便了很多，于是我们做了这份索引。',
    address: '索引地址', copy: '复制地址', copyTitle: '点击复制',
    copied: '已复制', usage: '今日已有 {readers} 位用户在使用', usageNote: '今天（UTC 日期）在 DSH 中加载过这份索引的用户数，按 IP 和 UA 每日去重，两者都不保存。', copySuccess: '地址已复制。打开 DSH，把它添加为索引源。', details: '详情', copyOpen: '复制插件名并打开 DSH', nameCopied: '已复制，正在打开…', dshOpened: '已打开，粘贴搜索', dshMissed: '已复制，请手动打开', getFailure: '已选中，请手动复制', getHint: `在 DSH「${ui('发现')}」里粘贴搜索即可安装。`, pluginName: '插件名', copyFailure: '地址已选中。按 Ctrl+C 或 ⌘C，或使用选中文字的菜单复制。',
    showcase: { title: '在 DSH 里的样子', text: '不唯 star 🌟 论。默认推荐每天更新，以最近增长快、更新勤、优质的插件为主，同时参考验证、下载量和 star。', points: ['同一作者不会霸榜，小开发者的新作品也能上首屏', '增长快、更新勤、经过验证等标签一眼可见', '默认排序、✨ 智能推荐和随机，每次都有新发现'], image: 'dsh-discover-zh.webp', alt: 'DeepSeek Harness 的「发现」页面，列出开放插件市场的插件、标签和安装按钮' },
    zoom: '放大截图', close: '关闭', stepAlts: [`「${ui('插件 → 实验性插件')}」中的「${ui('自定义插件市场')}」开关`, `「${ui('发现')}」里的「${ui('添加索引源')}」按钮`, '填好 dshopen.org 地址的索引源窗口和「添加」按钮'],
    setup: '最简单使用教程', steps: [
      ['开启市场', ui('插件 → 实验性插件 → 自定义插件市场')],
      ['添加索引源', ui('发现 → 添加索引源')],
      ['粘贴地址', '粘贴上面的地址，完成']
    ],
    directory: '插件目录', search: '搜索插件', searchPlaceholder: '名称、包名或描述', category: '分类', all: '全部分类', other: '其他',
    results: '显示 {count} / {total} 个插件', initialCount: count => `${count} 个插件`,
    noResults: '没有匹配的插件', noResultsHelp: '换个关键词，或选择全部分类。', reset: '清除筛选',
    noJs: '下方显示全部插件。可使用浏览器的查找功能搜索本页。',
    noDescription: '作者尚未提供插件描述。', version: '版本', source: '源码', npm: 'npm 包', website: '网站', compatibility: '适用 DSH', noVersion: '未提供版本', released: '发布于',
    contributeTitle: '让更多人找到你的插件', contributeText: '提交插件的包名或仓库地址，申请收录。', submit: '提交收录', readDocs: '阅读文档',
    independent: '独立社区项目。', updated: '索引更新于', unknownDate: '暂无更新时间',
    scope: '发布包检查不等于安装测试或代码审计。安装时，DSH 会检查版本兼容性。',
    raw: 'JSON 索引', status: '构建详情', stats: '使用统计', footerTagline: 'DeepSeek Harness 的社区插件市场。增长快、更新勤的插件优先展示，让小开发者也被看到。', starCta: '给项目点个 Star', starNote: '觉得好用就给我们点个 star 吧。用到的插件也别忘了给作者一个，没准下一个 star 就是别人点给你的。', footerData: '数据一览', footerLinks: '相关链接', verifiedCount: '个经过验证', refresh: '每 6 小时更新', license: 'GPL-3.0 许可证',
    starsUnavailable: 'GitHub star 暂不可用', fetched: '获取于',
    pluginTitle: title => `${title} — DeepSeek Harness（DSH）插件 · 开放插件市场`,
    pluginDescription: (title, description) => `${title}：${description}DeepSeek Harness（DSH）社区插件，收录于开放插件市场。`,
    install: '在 DSH 中安装', installSteps: [`先把开放插件市场添加为索引源（只需一次）：${ui('插件 → 实验性插件 → 自定义插件市场')}，再到「${ui('发现 → 添加索引源')}」粘贴这个地址。`, `复制插件名，打开 DSH，在「${ui('发现')}」里粘贴搜索即可安装。`],
    facts: '插件信息', author: '作者', keywords: '关键词', related: '更多「{category}」插件', browseAll: '浏览全部插件', npmMonth: '近 30 天 npm 下载量',
    statsTitle: '使用统计 — 开放插件市场', statsHeading: '使用统计', statsDescription: '开放插件市场在 DeepSeek Harness 中每天有多少人使用、来自哪里：近 30 天每日用户数和加载次数，以及国家和地区分布。',
    statsLead: 'DSH 每次加载或刷新这个市场，都会读取一次索引。下面的数字直接来自这些读取，每隔几分钟更新。',
    statsTiles: { todayReaders: '今日用户', todayReads: '今日加载', monthReaders: '近 30 天用户', totalReads: '累计加载' },
    monthReadersNote: '每天用户数之和；同一个人在不同的日子使用，每天各算一次。',
    dailyTitle: '近 30 天每日使用', metricReaders: '用户', metricReads: '加载次数', metric: '显示',
    countriesTitle: '使用地区分布', countriesNote: '近 30 天用户占比，自 {since} 起统计。', countriesNoteLoads: '近 30 天加载次数占比，来自 Cloudflare 流量分析（抽样统计，为估算值）。', regionsTitle: '按联合国地理分区', countriesSub: '按国家和地区',
    regions: { Asia: '亚洲', Americas: '美洲', Europe: '欧洲', Oceania: '大洋洲', Africa: '非洲', Unknown: '未知' },
    regionNames: { HK: '中国香港', MO: '中国澳门', TW: '中国台湾' }, countriesEmpty: '国家和地区数据尚未开始统计，从统计开始的那天起会显示在这里。',
    unknownRegion: '未知', otherRegions: '其他 {count} 个', share: '占比', day: '日期', region: '国家或地区', showTable: '以表格查看',
    methodTitle: '统计方式', methodText: '一次加载就是读取一次 index.json。用户按 UTC 日期内不同的 IP 地址和 UA 组合计算：两者加上每日更换的盐值做哈希，只用于当天去重，从不保存。国家和地区来自 Cloudflare 网络位置，只用两个字母的国家或地区代号：按加载次数的分布读取自 Cloudflare 自带的近 30 天流量分析，不保留比国家更细的信息。本项目自己的检查请求不计入。', rawStats: '原始数据（stats.json）',
    statsLoading: '正在加载使用统计…', statsFailed: '暂时无法获取使用统计，请稍后再试。'
  }
};
// Traditional pages share the Simplified copy (converted when written) but have their own sharing card.
COPY.tw = { ...COPY.zh, socialImage: 'social-tw.png' };

// Real DSH screenshots for the three steps, each cropped around the highlighted control. DSH itself is Simplified, so Traditional reuses those.
const GUIDE_SIZES = { zh: [[768, 472], [800, 476], [900, 446]], en: [[768, 508], [874, 476], [900, 446]] };
const GUIDE_THEME = process.env.GUIDE_THEME === 'dark' ? 'dark' : 'light';
const SIGNALS = ['verified', 'trending', 'active'];
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const localize = (value, language, fallback = '') => typeof value === 'string' ? value : value && typeof value === 'object' ? String(value[language] ?? (language === 'zh' ? value['zh-cn'] : undefined) ?? value.en ?? Object.values(value).find(item => typeof item === 'string') ?? fallback) : fallback;
const numberFormat = language => new Intl.NumberFormat(language === 'zh' ? 'zh-CN' : 'en-US');
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

// Pages are addressed by a path under each language folder: '' for home, 'stats/', 'plugins/<package>/'.
export const pluginPath = name => `plugins/${name}/`;
const depth = path => path.split('/').filter(Boolean).length;
// A relative link from `from` (language folder + path) to `path` in `language`, so the site works under any base path.
const link = (from, language, path = '') => '../'.repeat(depth(from)) + LANGUAGES[language].dir + path || './';
const absolute = (language, path = '') => ORIGIN + LANGUAGES[language].dir + path;

export function renderStars(plugin, snapshot, language) {
  const repository = githubRepository(plugin.repository?.url);
  if (!repository) return '';
  const repo = snapshot?.repositories?.[repository.key];
  const text = COPY[language === 'zh' ? 'zh' : 'en'];
  const measured = repo && ['ok', 'stale'].includes(repo.status) && Number.isSafeInteger(repo.stars) && repo.stars >= 0 && Number.isFinite(Date.parse(repo.fetchedAt));
  if (!measured) return `<span class="stars-unavailable" data-stars-unavailable>${text.starsUnavailable}</span>`;
  const count = numberFormat(language).format(repo.stars);
  const date = new Date(repo.fetchedAt).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  const tooltip = `${repo.stars} GitHub stars · ${text.fetched} ${date}`;
  return `<span class="stars-group"><a class="github-stars" data-stars="${repo.stars}" href="${esc(repository.url)}/stargazers" title="${esc(tooltip)}" aria-label="${esc(tooltip)}"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z"/></svg>${count}<span class="stars-label">GitHub</span></a></span>`;
}

// Everything a card or a plugin page shows about one plugin, resolved once per language.
function describe(plugin, data, context) {
  const { categories, text, snapshot, downloads, display, labels, root } = context;
  const name = localize(plugin.name, data);
  const packageName = localize(plugin.name, 'en', name);
  const title = localize(plugin.title, data, name);
  const description = plainDescription(localize(display.plugins?.[plugin.name]?.description ?? plugin.description, data, text.noDescription));
  const version = newestVersion(plugin.versions);
  const categoryId = plugin.metadata?.category ?? '';
  const categoryTitle = localize(categories[categoryId]?.title, data, text.other);
  const sourceUrl = safeUrl(plugin.repository?.url) ?? safeUrl(version?.source?.type === 'git' ? version.source.url : undefined);
  const homepage = safeUrl(plugin.homepage);
  const npmUrl = version?.source?.type === 'npm' ? `https://www.npmjs.com/package/${packageName.split('/').map(encodeURIComponent).join('/')}` : undefined;
  const links = [];
  if (sourceUrl) links.push(`<a href="${esc(sourceUrl)}" rel="noopener noreferrer">${esc(text.source)}</a>`);
  if (npmUrl) links.push(`<a href="${esc(npmUrl)}" rel="noopener noreferrer">${esc(text.npm)}</a>`);
  if (!sourceUrl && homepage) links.push(`<a href="${esc(homepage)}" rel="noopener noreferrer">${esc(text.website)}</a>`);
  // Stable pastel tone per category so cards read as grouped without extra data.
  const tone = Array.from(categoryId).reduce((sum, char) => (sum * 31 + char.codePointAt(0)) % 997, 7) % 6;
  const date = version?.publishTimestamp != null ? releaseAge(version.publishTimestamp, Date.parse(display.generatedAt), data) : undefined;
  const npm = downloads.packages?.[plugin.name];
  const npmMeasured = npm && ['ok', 'stale'].includes(npm.status) && Number.isSafeInteger(npm.downloads) && npm.downloads >= 0;
  const npmTitle = npmMeasured ? `npm · ${npm.start} – ${npm.end} · ${text.fetched} ${npm.fetchedAt}` : '';
  const own = plugin.metadata?.labels ?? [];
  const badges = own.filter(id => id.startsWith('publisher-') && labels[id]).map(id => `<span class="publisher-badge" data-publisher="${esc(id)}">${esc(localize(labels[id].title, data))}</span>`).join('')
    + SIGNALS.filter(id => own.includes(id) && labels[id]).map(id => `<span class="signal-badge" data-signal="${id}">${esc(localize(labels[id].title, data))}</span>`).join('');
  const icon = typeof plugin.icon === 'string' && /^icons\/[a-f0-9]{64}\.(?:svg|png|jpg|webp)$/.test(plugin.icon) ? root + plugin.icon : undefined;
  const detail = `${renderStars(plugin, snapshot, data)}
      ${npmMeasured ? `<a class="npm-downloads" data-downloads="${npm.downloads}" href="${esc(npm.source)}" title="${esc(npmTitle)}"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/></svg>${esc(numberFormat(data).format(npm.downloads))}</a>` : ''}
      ${date ? `<time datetime="${esc(new Date(version.publishTimestamp * 1000).toISOString())}" title="${esc(dateLabel(version.publishTimestamp * 1000, data))}"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>${esc(date)}</time>` : ''}`;
  const facts = `<dt>${esc(text.pluginName)}</dt><dd class="get-name">${esc(packageName)}</dd><dt>${esc(text.version)}</dt><dd class="version">${version ? esc(version.version) : esc(text.noVersion)}</dd>${version?.engines?.dsh ? `<dt>${esc(text.compatibility)}</dt><dd>${esc(version.engines.dsh)}</dd>` : ''}${version?.publishTimestamp ? `<dt>${esc(text.released)}</dt><dd>${esc(dateLabel(version.publishTimestamp * 1000, data))}</dd>` : ''}`;
  const getButton = `<button type="button" class="get-copy" data-get="${esc(packageName)}" title="${esc(text.getHint)}" hidden><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="3"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg><span>${esc(text.copyOpen)}</span></button>`;
  return { name, packageName, title, namedTitle: title && title !== name, description, version, categoryId, categoryTitle, links, tone, npm: npmMeasured ? npm : undefined, badges, icon, detail, facts, getButton, sourceUrl, homepage, npmUrl };
}

function avatar(info, root, position = 0) {
  // Plugins without their own logo get the market's whale girl, peeking side to side.
  return info.icon ? `<img src="${esc(info.icon)}" alt="" width="44" height="44" loading="lazy" decoding="async">` : `<img class="avatar-placeholder" style="--peek-delay: -${(position % 7) * 0.45}" src="${root}assets/placeholder-whale.webp" alt="" width="54" height="54" loading="lazy" decoding="async">`;
}

function pluginRow(plugin, language, context, position = 0, added = {}) {
  const { text, root, from } = context;
  const info = describe(plugin, LANGUAGES[language].data, context);
  const search = [info.name, info.packageName, info.title, info.description, ...(plugin.metadata?.keywords ?? [])].join(' ');
  const href = link(from, language, pluginPath(plugin.name));
  // Sort values mirror the index's sort keys so the website offers the same orders as DSH.
  // "Recently updated" also surfaces new listings: whichever is later, the release or the day it joined the catalog.
  const recency = Math.max(...[info.version?.publishTimestamp, addedTimestamp(added, plugin.name)].filter(Number.isFinite));
  const keys = plugin.metadata?.sortKeys ?? {};
  const sortData = [['order', position], ['recommended', keys.recommended], ['random', keys['random-resources']], ['stars', keys['github-stars']], ['stars-week', keys['stars-week']], ['published', recency]]
    .filter(([, value]) => Number.isFinite(value)).map(([key, value]) => ` data-sort-${key}="${value}"`).join('');
  return `<li class="plugin" data-plugin data-tone="${info.tone}" data-category="${esc(info.categoryId)}" data-search="${esc(search)}"${sortData}>
    <article class="plugin-main" aria-label="${esc(info.title || info.name)}">
      <div class="plugin-heading"><span class="plugin-avatar" aria-hidden="true">${avatar(info, root, position)}</span><div>${info.namedTitle ? `<h3 class="plugin-title"><a class="plugin-link" href="${esc(href)}">${esc(info.title)}</a></h3><p class="package-name">${esc(info.packageName)}</p>` : `<h3 class="package-name is-title"><a class="plugin-link" href="${esc(href)}">${esc(info.packageName)}</a></h3>`}</div></div>
      ${info.categoryId || info.badges ? `<div class="plugin-tags">${info.categoryId ? `<span class="plugin-tag">${esc(info.categoryTitle)}</span>` : ''}${info.badges}</div>` : ''}
      <p class="plugin-description">${esc(info.description)}</p>
    <div class="plugin-detail">
      ${info.detail}
      <div class="plugin-actions"><button type="button" class="more-toggle" data-more-toggle aria-expanded="false" aria-controls="more-${position}" hidden><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.5h.01"/></svg><span>${esc(text.details)}</span><svg class="chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></button></div>
    </div>
    <div class="plugin-more" id="more-${position}" data-more-panel><div class="plugin-more-inner"><dl>${info.facts}</dl><p class="facts-links">${info.links.join('')}${info.getButton}</p></div></div>
    </article>
  </li>`;
}

const ICONS = {
  plugins: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/></svg>',
  stats: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><rect x="5.5" y="11" width="3.5" height="6" rx="1"/><rect x="10.25" y="6" width="3.5" height="11" rx="1"/><rect x="15" y="9" width="3.5" height="8" rx="1"/></svg>',
  docs: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/></svg>',
  github: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.8a10.2 10.2 0 0 0-3.2 19.9c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.6 1 1.6 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.3-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .9-.3 2.8 1a9.6 9.6 0 0 1 5.1 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.8-4.6 5 .4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10.2 10.2 0 0 0 12 1.8z"/></svg>',
  copy: '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M8 8h12v13H8zM16 8V3H3v13h5"/></svg>'
};

// The index URL with its copy button, shared by the home page and every plugin page.
const addressBar = text => `<label class="address-label visually-hidden" for="index-url">${esc(text.address)}</label>
      <div class="address-bar">
        <textarea id="index-url" rows="2" readonly spellcheck="false" title="${esc(text.copyTitle)}" aria-describedby="copy-status">${INDEX_URL}</textarea>
        <button class="copy-button" type="button" data-copy hidden>${ICONS.copy}<span>${esc(text.copy)}</span></button>
        <p class="copy-status" id="copy-status" role="status" aria-live="polite"></p>
      </div>`;

/**
 * The shell every page shares: head tags with alternates in all three languages, header, footer and messages.
 * `path` is the page's address under the language folder; `site` carries the catalog numbers for the footer.
 */
function layout({ language, path, title, description, body, site, structured = [], type = 'website', image }) {
  const text = COPY[language];
  const from = LANGUAGES[language].dir + path;
  const root = '../'.repeat(depth(from));
  const home = link(from, language);
  const onHome = path === '';
  const docsUrl = language === 'en' ? DOCS : `${REPOSITORY}/blob/main/README.md`;
  const canonical = absolute(language, path);
  const social = `${ORIGIN}assets/${image ?? site.socialImages[text.socialImage] ?? text.socialImage}`;
  const alternates = [['en', 'en'], ['zh-CN', 'zh'], ['zh-TW', 'tw'], ['zh-HK', 'tw'], ['x-default', 'en']]
    .map(([tag, id]) => `<link rel="alternate" hreflang="${tag}" href="${absolute(id, path)}">`).join('\n  ');
  const switcher = Object.entries(LANGUAGES).map(([id, entry]) => id === language
    ? `<span lang="${entry.tag}" aria-current="page" title="${entry.name}">${entry.label}</span>`
    : `<a href="${esc(link(from, id, path))}" lang="${entry.tag}" hreflang="${entry.tag}" data-lang="${id}" title="${entry.name}">${entry.label}</a>`).join('');
  const messages = { usage: text.usage, copy: text.copy, copied: text.copied, copySuccess: text.copySuccess, copyFailure: text.copyFailure, nameCopied: text.nameCopied, dshOpened: text.dshOpened, dshMissed: text.dshMissed, getFailure: text.getFailure, results: text.results, more: text.more, shown: text.shown };
  // The English home page is the x-default: send visitors on to their remembered or browser language.
  const redirect = language === 'en' && onHome ? `<script>try{var l=localStorage.getItem('opm-lang'),n=navigator.language||'';if(!l)l=/^zh-(tw|hk|mo|hant)/i.test(n)?'tw':/^zh/i.test(n)?'zh':'';var d={zh:'zh/',tw:'zh-tw/'}[l];if(d)location.replace(d+location.search+location.hash)}catch(e){}</script>` : '';
  return finish(`<!doctype html>
<html lang="${LANGUAGES[language].tag}" class="no-js">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <meta name="theme-color" content="#eef3f8">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  ${onHome ? `<meta name="keywords" content="${esc(text.keywords)}">` : ''}
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="${canonical}">
  ${alternates}
  <link rel="icon" href="${root}assets/favicon.png" type="image/png" sizes="64x64">
  <link rel="apple-touch-icon" href="${root}assets/apple-touch-icon.png" sizes="180x180">
  <link rel="stylesheet" href="${root}assets/site.css">
  <meta property="og:type" content="${type}">
  <meta property="og:site_name" content="${esc(text.brand)}">
  <meta property="og:locale" content="${LANGUAGES[language].locale}">
  ${Object.entries(LANGUAGES).filter(([id]) => id !== language).map(([, entry]) => `<meta property="og:locale:alternate" content="${entry.locale}">`).join('\n  ')}
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${social}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${esc(title)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${social}">
  <meta name="twitter:image:alt" content="${esc(title)}">
  ${structured.map(item => `<script type="application/ld+json">${json(item)}</script>`).join('\n  ')}
  ${redirect}
  <script>document.documentElement.classList.replace('no-js', 'js')</script>
  <script src="${root}assets/site.js" defer></script>
</head>
<body>
  <a class="skip" href="#main">${esc(text.skip)}</a>
  <header class="site-header" data-header><div class="site-header-inner shell">
    <a class="brand" href="${esc(home)}"><img src="${root}assets/logo-256.png" alt="" width="64" height="64"><span>${esc(text.brand)}</span></a>
    <nav class="header-links" aria-label="${esc(text.nav)}">
      <a class="header-home" href="${onHome ? '#top' : esc(home)}" aria-label="${esc(text.brand)}"><img src="${root}assets/logo-256.png" alt="" width="64" height="64"></a><a href="${onHome ? '' : esc(home)}#plugins">${ICONS.plugins}<span>${esc(text.plugins)}</span></a><a href="${esc(link(from, language, 'stats/'))}"${path === 'stats/' ? ' aria-current="page"' : ''}>${ICONS.stats}<span>${esc(text.statsNav)}</span></a><a href="${REPOSITORY}">${ICONS.github}<span>GitHub</span></a>
      <div class="languages" data-current="${language}" aria-label="${esc(text.language)}">${switcher}</div>
    </nav>
  </div></header>
  <main id="main">
${body}
  </main>
  <footer class="site-footer">
    <div class="footer-grid shell">
      <div class="footer-brand"><a class="footer-logo" href="${esc(home)}"><img src="${root}assets/logo-256.png" alt="" width="48" height="48"><span>${esc(text.brand)}</span></a><p>${esc(text.footerTagline)}</p><div class="star-wrap"><a class="star-cta" href="${REPOSITORY}" aria-describedby="star-note"><span aria-hidden="true">⭐</span>${esc(text.starCta)}</a><p class="star-note" id="star-note" role="tooltip">${esc(text.starNote)}</p></div></div>
      <div><h2>${esc(text.footerData)}</h2><ul class="footer-stats"><li><strong>${site.plugins}</strong> ${esc(text.statPlugins)}</li><li><strong>${site.categories}</strong> ${esc(text.statCategories)}</li><li><strong>${site.verified}</strong> ${esc(text.verifiedCount)}</li><li>${esc(text.refresh)}${site.updated[LANGUAGES[language].data] ? ` · ${esc(site.updated[LANGUAGES[language].data])}` : ''}</li></ul></div>
      <div><h2>${esc(text.footerLinks)}</h2><ul class="footer-links"><li><a href="${esc(SUBMIT)}">${esc(text.submit)}</a></li><li><a href="${docsUrl}">${esc(text.readDocs)}</a></li><li><a href="${REPOSITORY}">GitHub</a></li><li><a href="${esc(link(from, language, 'stats/'))}">${esc(text.stats)}</a></li><li><a href="${root}index.json">${esc(text.raw)}</a></li><li><a href="${root}status.json">${esc(text.status)}</a></li></ul></div>
    </div>
    <div class="footer-bottom shell"><p>${esc(text.independent)} ${esc(text.scope)}</p><p><a href="${REPOSITORY}/blob/main/LICENSE">${esc(text.license)}</a></p></div>
  </footer>
  ${onHome ? `<dialog class="shot-viewer" data-viewer><button type="button" class="viewer-close" data-viewer-close aria-label="${esc(text.close)}">×</button><img alt=""></dialog>` : ''}
  <script id="site-messages" type="application/json">${json(messages)}</script>
</body>
</html>\n`, language);
}

function homePage(index, language, context) {
  const { text, site, added } = context;
  const data = LANGUAGES[language].data;
  const plugins = index.plugins;
  const categories = index.metadata?.categories ?? {};
  const hasUncategorized = plugins.some(plugin => !plugin.metadata?.category);
  const countBy = id => plugins.filter(plugin => (plugin.metadata?.category ?? '') === id).length;
  const chip = (value, label, count, extra = '') => `<button type="button" class="chip" data-chip="${esc(value)}"${extra} aria-pressed="false">${esc(label)}<small>${count}</small></button>`;
  const categoriesHtml = chip('', text.all, plugins.length)
    + site.usedCategories.map(id => chip(id, localize(categories[id]?.title, data, id), countBy(id))).join('')
    + (hasUncategorized ? chip('__uncategorized__', text.other, countBy(''), ' data-uncategorized') : '');
  const updated = site.updated[data];
  const sortIds = ['default', 'recommended', 'stars', ...(plugins.some(plugin => Number.isFinite(plugin.metadata?.sortKeys?.['stars-week'])) ? ['starsWeek'] : []), 'published', 'random'];
  const sortChips = sortIds.map((id, at) => `<button type="button" class="chip" data-sort="${id}" aria-pressed="${at === 0}">${esc(text.sorts[id])}</button>`).join('');
  const stickers = ['tools', 'skills', 'memory'].filter(id => site.usedCategories.includes(id))
    .map((id, at) => `<span class="sticker sticker-${at + 1}">${esc(localize(categories[id]?.title, data, id))}</span>`).join('');
  const guide = data;
  const root = context.root;
  const body = `    <section class="hero shell" aria-labelledby="page-title">
      <div class="hero-copy">
      <h1 id="page-title">${text.headline}</h1>
      <p class="hero-lead">${esc(text.intro)}</p>
      ${addressBar(text)}
      <a class="usage" href="${esc(link(context.from, language, 'stats/'))}" data-usage="${STATS_URL}" title="${esc(text.usageNote)}"><span class="usage-dot" aria-hidden="true"></span><span data-usage-text></span><span class="usage-arrow" aria-hidden="true">→</span></a>
      </div>
      <div class="hero-art" aria-hidden="true"><div class="art-blob"></div><img src="${root}assets/logo.webp" alt="" width="560" height="560" decoding="async">${stickers}</div>
      <h2 class="section-title steps-title" id="setup-title" data-reveal>${esc(text.setup)}</h2>
      <ol class="steps" aria-labelledby="setup-title" data-guide="${GUIDE_THEME}">${text.steps.map(([title, detail], at) => `<li data-reveal data-zoom-card style="--reveal-delay: ${at * 90}ms"><h3><span class="step-num" aria-hidden="true">${at + 1}</span>${esc(title)}</h3><button type="button" class="step-shot" data-zoom aria-label="${esc(text.zoom)}: ${esc(title)}"><img src="${root}assets/guide-${at + 1}-${guide}-${GUIDE_THEME}.webp" alt="${esc(detail)}" title="${esc(detail)}" width="${GUIDE_SIZES[guide][at][0]}" height="${GUIDE_SIZES[guide][at][1]}" loading="lazy" decoding="async"></button></li>`).join('')}</ol>
    </section>
    <section class="directory-surface" aria-labelledby="directory-title">
    <section class="showcase shell" aria-labelledby="showcase-title">
      <div class="showcase-copy" data-reveal><h2 class="section-title" id="showcase-title">${esc(text.showcase.title)}</h2><p>${esc(text.showcase.text)}</p><ul>${text.showcase.points.map(point => `<li>${esc(point)}</li>`).join('')}</ul></div>
      <figure class="app-frame" data-reveal><div class="app-bar" aria-hidden="true"><span></span><span></span><span></span></div><picture><source media="(max-width: 620px)" srcset="${root}assets/${text.showcase.image.replace('.webp', '-narrow.webp')}" width="800" height="1028"><img src="${root}assets/${text.showcase.image}" alt="${esc(text.showcase.alt)}" width="1600" height="1000" loading="lazy" decoding="async"></picture><picture class="app-light"><source media="(max-width: 620px)" srcset="${root}assets/${text.showcase.image.replace('.webp', '-narrow-light.webp')}"><img src="${root}assets/${text.showcase.image.replace('.webp', '-light.webp')}" alt="" width="1600" height="1000" loading="lazy" decoding="async"></picture></figure>
    </section><div class="directory-zone"><div class="directory shell" id="plugins">
      <div class="directory-heading" data-reveal><h2 class="section-title" id="directory-title">${esc(text.directory)}</h2></div>
      <div class="directory-meta"><ul class="stats"><li><strong>${plugins.length}</strong> ${esc(text.statPlugins)}</li><li><strong>${site.usedCategories.length}</strong> ${esc(text.statCategories)}</li>${updated ? `<li>${esc(text.updated)} <strong>${esc(updated)}</strong></li>` : ''}</ul></div>
      <form class="filters" data-filters hidden role="search" aria-label="${esc(text.search)}">
        <div class="field"><label class="visually-hidden" for="plugin-search">${esc(text.search)}</label><div class="search-box"><input type="search" id="plugin-search" placeholder="${esc(text.searchPlaceholder)}" autocomplete="off"><p class="result-count" id="result-count" role="status" aria-live="polite">${esc(text.initialCount(plugins.length))}</p></div></div>
        <div class="field chips-field"><span class="field-label visually-hidden" id="sort-label">${esc(text.sort)}</span><div class="chips sort-chips" role="group" aria-labelledby="sort-label">${sortChips}</div></div>
        <div class="field chips-field"><span class="field-label visually-hidden" id="category-label">${esc(text.category)}</span><div class="chips" role="group" aria-labelledby="category-label">${categoriesHtml}</div></div>
      </form>
      <noscript><p class="no-js">${esc(text.noJs)}</p></noscript>
      <ul class="plugin-list">${plugins.map((plugin, position) => pluginRow(plugin, language, context, position, added)).join('\n')}</ul>
      <div class="more" data-more-wrap hidden><p class="more-progress" data-progress role="status" aria-live="polite"></p><span class="more-bar" aria-hidden="true"><i data-bar></i></span><button type="button" class="more-button" data-more></button></div>
      <div class="empty" id="empty-results" ${plugins.length ? 'hidden' : ''}><h3>${esc(text.noResults)}</h3><p>${esc(text.noResultsHelp)}</p><button type="button" class="text-button" data-reset hidden>${esc(text.reset)}</button></div>
    </div>
    <section class="contribute shell" aria-labelledby="contribute-title" data-reveal>
      <div><h2 id="contribute-title">${esc(text.contributeTitle)}</h2><p>${esc(text.contributeText)}</p></div>
      <div class="contribute-links"><a class="submit-link" href="${esc(SUBMIT)}">${esc(text.submit)}</a><a href="${language === 'en' ? DOCS : `${REPOSITORY}/blob/main/README.md`}">${esc(text.readDocs)}</a></div>
    </section>
    </div></section>`;
  const structured = [{ '@context': 'https://schema.org', '@type': 'WebSite', name: text.brand, url: absolute(language), inLanguage: LANGUAGES[language].tag, description: text.description }];
  return layout({ language, path: '', title: text.title, description: text.description, body, site, structured });
}

function pluginPage(plugin, index, language, context, related) {
  const { text, site, root, from } = context;
  const data = LANGUAGES[language].data;
  const info = describe(plugin, data, context);
  const heading = info.namedTitle ? info.title : info.packageName;
  const home = link(from, language);
  const categoryLink = info.categoryId ? `${home}#plugins` : undefined;
  const keywords = (plugin.metadata?.keywords ?? []).filter(word => typeof word === 'string' && word.length <= 40).slice(0, 12);
  const author = typeof plugin.author === 'string' ? plugin.author : plugin.author?.name;
  const relatedItems = related.map(other => {
    const item = describe(other, data, context);
    return `<li><a class="related-card" href="${esc(link(from, language, pluginPath(other.name)))}"><span class="plugin-avatar" aria-hidden="true">${avatar(item, root)}</span><span class="related-text"><strong>${esc(item.namedTitle ? item.title : item.packageName)}</strong><span>${esc(item.description)}</span></span></a></li>`;
  }).join('');
  const body = `    <div class="detail shell">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="${esc(home)}">${esc(text.home)}</a><span aria-hidden="true">/</span><a href="${esc(home)}#plugins">${esc(text.plugins)}</a>${info.categoryId ? `<span aria-hidden="true">/</span><span>${esc(info.categoryTitle)}</span>` : ''}</nav>
      <article class="detail-card" data-get-scope data-tone="${info.tone}">
        <div class="detail-head"><span class="plugin-avatar detail-avatar" aria-hidden="true">${avatar(info, root)}</span><div><h1 id="page-title">${esc(heading)}</h1>${info.namedTitle ? `<p class="package-name">${esc(info.packageName)}</p>` : ''}</div></div>
        ${info.categoryId || info.badges ? `<div class="plugin-tags">${info.categoryId ? `<span class="plugin-tag">${esc(info.categoryTitle)}</span>` : ''}${info.badges}</div>` : ''}
        <p class="detail-lead">${esc(info.description)}</p>
        <div class="plugin-detail">${info.detail}</div>
      </article>
      <div class="detail-grid">
        <section class="detail-panel" aria-labelledby="install-title" data-get-scope>
          <h2 id="install-title">${esc(text.install)}</h2>
          <ol class="install-steps">
            <li><p>${esc(text.installSteps[0])}</p><div class="hero-copy">${addressBar(text)}</div></li>
            <li><p>${esc(text.installSteps[1])}</p><p class="install-name"><code class="get-name">${esc(info.packageName)}</code>${info.getButton}</p></li>
          </ol>
        </section>
        <section class="detail-panel" aria-labelledby="facts-title">
          <h2 id="facts-title">${esc(text.facts)}</h2>
          <dl class="facts">${info.facts}${author ? `<dt>${esc(text.author)}</dt><dd>${esc(author)}</dd>` : ''}${info.categoryId ? `<dt>${esc(text.category)}</dt><dd><a href="${esc(categoryLink)}">${esc(info.categoryTitle)}</a></dd>` : ''}${info.npm ? `<dt>${esc(text.npmMonth)}</dt><dd>${esc(numberFormat(data).format(info.npm.downloads))}</dd>` : ''}</dl>
          ${info.links.length ? `<p class="facts-links">${info.links.join('')}</p>` : ''}
          ${keywords.length ? `<h3>${esc(text.keywords)}</h3><ul class="keyword-list">${keywords.map(word => `<li>${esc(word)}</li>`).join('')}</ul>` : ''}
        </section>
      </div>
      ${relatedItems ? `<section class="related" aria-labelledby="related-title"><h2 class="section-title" id="related-title">${esc(text.related.replace('{category}', info.categoryTitle))}</h2><ul class="related-list">${relatedItems}</ul><p class="related-more"><a class="text-button" href="${esc(home)}#plugins">${esc(text.browseAll)}</a></p></section>` : ''}
    </div>`;
  const url = absolute(language, pluginPath(plugin.name));
  const version = info.version;
  const structured = [
    { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: heading, alternateName: info.namedTitle ? info.packageName : undefined, description: info.description, url, applicationCategory: 'DeveloperApplication', applicationSubCategory: info.categoryId ? info.categoryTitle : undefined, operatingSystem: 'DeepSeek Harness', softwareVersion: version?.version, datePublished: version?.publishTimestamp ? new Date(version.publishTimestamp * 1000).toISOString().slice(0, 10) : undefined, author: author ? { '@type': 'Person', name: author } : undefined, codeRepository: info.sourceUrl, downloadUrl: info.npmUrl, keywords: keywords.join(', ') || undefined, inLanguage: LANGUAGES[language].tag, offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD' } },
    { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ name: text.home, item: absolute(language) }, { name: text.plugins, item: `${absolute(language)}#plugins` }, { name: heading, item: url }].map((entry, at) => ({ '@type': 'ListItem', position: at + 1, ...entry })) }
  ];
  return layout({ language, path: pluginPath(plugin.name), title: text.pluginTitle(heading), description: text.pluginDescription(heading, info.description.replace(/[。.]?$/, language === 'en' ? '.' : '。')), body, site, structured, type: 'article' });
}

function statsPage(language, context) {
  const { text, site } = context;
  const tiles = Object.entries(text.statsTiles).map(([id, label]) => `<li class="stat-tile" data-tile="${id}"><span class="stat-label">${esc(label)}${id === 'monthReaders' ? `<span class="stat-note" title="${esc(text.monthReadersNote)}" aria-label="${esc(text.monthReadersNote)}">?</span>` : ''}</span><strong data-value>–</strong></li>`).join('');
  const messages = { locale: LANGUAGES[language].tag, metricReaders: text.metricReaders, metricReads: text.metricReads, countriesNote: text.countriesNote, countriesNoteLoads: text.countriesNoteLoads, unknownRegion: text.unknownRegion, otherRegions: text.otherRegions, regions: text.regions, regionNames: text.regionNames, failed: text.statsFailed };
  const body = `    <div class="stats-page shell" data-stats="${STATS_URL}">
      <header class="stats-intro"><h1 id="page-title">${esc(text.statsHeading)}</h1><p>${esc(text.statsLead)}</p><p class="stats-status" data-stats-status role="status">${esc(text.statsLoading)}</p></header>
      <ul class="stat-tiles">${tiles}</ul>
      <section class="detail-panel chart-panel" aria-labelledby="daily-title">
        <div class="chart-head"><h2 id="daily-title">${esc(text.dailyTitle)}</h2><div class="chips metric-chips" role="group" aria-label="${esc(text.metric)}"><button type="button" class="chip" data-metric="readers" aria-pressed="true">${esc(text.metricReaders)}</button><button type="button" class="chip" data-metric="reads" aria-pressed="false">${esc(text.metricReads)}</button></div></div>
        <div class="daily-chart" data-daily></div>
        <details class="chart-table"><summary>${esc(text.showTable)}</summary><div class="table-wrap"><table><thead><tr><th scope="col">${esc(text.day)}</th><th scope="col">${esc(text.metricReaders)}</th><th scope="col">${esc(text.metricReads)}</th></tr></thead><tbody data-daily-table></tbody></table></div></details>
      </section>
      <section class="detail-panel chart-panel" aria-labelledby="countries-title">
        <div class="chart-head"><h2 id="countries-title">${esc(text.countriesTitle)}</h2><p class="chart-note" data-countries-note></p></div>
        <div class="geo-grid" data-geo>
          <figure class="region-chart"><figcaption>${esc(text.regionsTitle)}</figcaption><div class="region-donut" data-regions></div><ul class="region-legend" data-region-legend></ul></figure>
          <div class="country-chart"><h3>${esc(text.countriesSub)}</h3><ol class="country-bars" data-countries></ol></div>
        </div>
        <p class="chart-empty" data-countries-empty hidden>${esc(text.countriesEmpty)}</p>
      </section>
      <section class="detail-panel method" aria-labelledby="method-title"><h2 id="method-title">${esc(text.methodTitle)}</h2><p>${esc(text.methodText)}</p><p><a href="${STATS_URL}">${esc(text.rawStats)}</a></p></section>
      <script id="stats-messages" type="application/json">${json(messages)}</script>
    </div>`;
  const structured = [{ '@context': 'https://schema.org', '@type': 'WebPage', name: text.statsHeading, url: absolute(language, 'stats/'), inLanguage: LANGUAGES[language].tag, description: text.statsDescription }];
  return layout({ language, path: 'stats/', title: text.statsTitle, description: text.statsDescription, body, site, structured });
}

// Up to six plugins from the same category, nearest in the catalog's default order, so every page links onward.
function relatedPlugins(plugins, at) {
  const category = plugins[at].metadata?.category;
  if (!category) return [];
  return plugins.map((plugin, position) => ({ plugin, position })).filter(({ plugin, position }) => position !== at && plugin.metadata?.category === category)
    .sort((a, b) => Math.abs(a.position - at) - Math.abs(b.position - at)).slice(0, 6).sort((a, b) => a.position - b.position).map(({ plugin }) => plugin);
}

function sitemap(paths, updated) {
  const lastmod = updated ? `<lastmod>${updated.slice(0, 10)}</lastmod>` : '';
  const alternates = path => [['en', 'en'], ['zh-CN', 'zh'], ['zh-TW', 'tw'], ['zh-HK', 'tw'], ['x-default', 'en']].map(([tag, id]) => `<xhtml:link rel="alternate" hreflang="${tag}" href="${esc(absolute(id, path))}"/>`).join('');
  const urls = paths.flatMap(path => Object.keys(LANGUAGES).map(id => `  <url><loc>${esc(absolute(id, path))}</loc>${lastmod}${alternates(path)}</url>`));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
}

function notFound(css) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Page not found — Open Plugin Market</title><link rel="icon" href="${ORIGIN}assets/favicon.png" type="image/png" sizes="64x64"><style>${css}</style></head><body><header class="site-header shell"><a class="brand" href="${ORIGIN}"><img src="${ORIGIN}assets/logo-256.png" alt="" width="64" height="64"><span>Open Plugin Market</span></a></header><main class="shell hero"><h1>Page not found.</h1><p lang="zh-CN">页面不存在。</p><p lang="zh-TW">頁面不存在。</p><p>Open the plugin directory to continue.</p><p lang="zh-CN">返回插件目录，继续查找插件。</p><div class="contribute-links"><a class="submit-link" href="${ORIGIN}">English directory</a><a class="submit-link" href="${ORIGIN}zh/" lang="zh-CN">中文目录</a><a class="submit-link" href="${ORIGIN}zh-tw/" lang="zh-TW">繁體中文目錄</a></div></main></body></html>\n`;
}

async function write(path, html) {
  const file = new URL(path + 'index.html', output);
  await mkdir(new URL('.', file), { recursive: true });
  await writeFile(file, html, 'utf8');
}

/** Write the static site in English, Simplified and Traditional Chinese alongside the canonical format-1 index. */
export async function writeSite(index, evidence, snapshot = {}, downloads = {}, display = {}) {
  if (index?.format !== 1 || !Array.isArray(index.plugins)) throw new Error('writeSite expects a format-1 plugin index');
  await mkdir(new URL('assets/', output), { recursive: true });
  for (const asset of ['site.css', 'site.js', 'logo.webp', 'logo-256.png', 'favicon.png', 'apple-touch-icon.png', 'placeholder-whale.webp', 'social.png', 'social-zh.png', 'social-tw.png', ...['zh', 'en'].flatMap(lang => ['', '-light', '-narrow', '-narrow-light'].map(kind => `dsh-discover-${lang}${kind}.webp`)), ...[1, 2, 3].flatMap(n => ['zh', 'en'].flatMap(lang => ['light', 'dark'].map(theme => `guide-${n}-${lang}-${theme}.webp`)))]) {
    await copyFile(new URL(asset, source), new URL(`assets/${asset}`, output));
  }
  // X and other link previews cache card images by URL, so name each card after its content.
  const socialImages = {};
  for (const name of ['social.png', 'social-zh.png', 'social-tw.png']) {
    const bytes = await readFile(new URL(name, source));
    socialImages[name] = name.replace(/\.png$/, `-${createHash('sha256').update(bytes).digest('hex').slice(0, 10)}.png`);
    await writeFile(new URL(`assets/${socialImages[name]}`, output), bytes);
  }
  // Full builds refresh added.json first; the offline rebuilds reuse whatever is already published.
  let added = {};
  try { added = JSON.parse(await readFile(new URL('added.json', output), 'utf8')); } catch { /* No record yet. */ }
  const plugins = index.plugins;
  const site = {
    plugins: plugins.length,
    usedCategories: [...new Set(plugins.map(plugin => plugin.metadata?.category).filter(Boolean))],
    verified: plugins.filter(plugin => plugin.metadata?.labels?.includes('verified')).length,
    updated: { en: evidence?.generatedAt ? dateLabel(evidence.generatedAt, 'en') : undefined, zh: evidence?.generatedAt ? dateLabel(evidence.generatedAt, 'zh') : undefined },
    socialImages
  };
  site.categories = site.usedCategories.length;
  // Plugin pages are regenerated from scratch so withdrawn plugins do not linger.
  for (const language of Object.keys(LANGUAGES)) await rm(new URL(LANGUAGES[language].dir + 'plugins/', output), { recursive: true, force: true });
  const shared = { categories: index.metadata?.categories ?? {}, snapshot, downloads, display, labels: index.metadata?.labels ?? {}, site, added };
  for (const language of Object.keys(LANGUAGES)) {
    const context = path => ({ ...shared, text: COPY[language], from: LANGUAGES[language].dir + path, root: '../'.repeat(depth(LANGUAGES[language].dir + path)) });
    await write(LANGUAGES[language].dir, homePage(index, language, context('')));
    await write(LANGUAGES[language].dir + 'stats/', statsPage(language, context('stats/')));
    for (const [at, plugin] of plugins.entries()) {
      await write(LANGUAGES[language].dir + pluginPath(plugin.name), pluginPage(plugin, index, language, context(pluginPath(plugin.name)), relatedPlugins(plugins, at)));
    }
  }
  await writeFile(new URL('sitemap.xml', output), sitemap(['', 'stats/', ...plugins.map(plugin => pluginPath(plugin.name))], evidence?.generatedAt), 'utf8');
  await writeFile(new URL('robots.txt', output), `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}sitemap.xml\n`, 'utf8');
  await writeFile(new URL('404.html', output), notFound(await readFile(new URL('site.css', source), 'utf8')), 'utf8');
}
