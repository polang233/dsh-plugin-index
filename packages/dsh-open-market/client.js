// Browser half: an "Open Market" tab on the Plugins page, next to Installed and Discover.
// Hand-written in the shape DSH's module loader expects, so the package still needs no build step.
window.__ModuleLoader__.load({
  id: 'dsh-open-market',
  factory: require => {
    const React = require('react');
    const h = React.createElement;
    let Switch;
    try { Switch = require('@deepseek-ai/dsh-client-ui-primitives').Switch; } catch { /* Older hosts use the checkbox fallback. */ }

    const SETTINGS_KEY = 'dsh-open-market:settings';
    const DEFAULT_SETTINGS = { autoRotate: true, hideInstalled: false, showCheckup: true, likes: true };
    function readSettings() {
      try {
        const saved = JSON.parse(window.localStorage.getItem(SETTINGS_KEY));
        return Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) =>
          [key, typeof saved?.[key] === 'boolean' ? saved[key] : fallback]));
      } catch { return { ...DEFAULT_SETTINGS }; }
    }
    let settings = readSettings();
    const settingsListeners = new Set();
    const getSettings = () => settings;
    function subscribeSettings(listener) {
      settingsListeners.add(listener);
      return () => settingsListeners.delete(listener);
    }
    function updateSettings(key, value) {
      if (typeof value !== 'boolean' || settings[key] === value) return;
      settings = { ...settings, [key]: value };
      try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* Keep this session usable without storage. */ }
      settingsListeners.forEach(listener => listener());
    }
    function useSettings() {
      return React.useSyncExternalStore(subscribeSettings, getSettings, getSettings);
    }

    const INDEX_URL = 'https://dshopen.org/index.json';
    const LIKES_ORIGIN = 'https://dshopen.org';
    const LIKED_KEY = 'dsh-open-market:liked';
    const EMPTY_LIKES = {};

    function likesOrigin() {
      try {
        const url = new URL(window.localStorage.getItem('dsh-open-market:likes-origin'));
        if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin;
      } catch { /* Invalid overrides and unavailable storage use the public origin. */ }
      return LIKES_ORIGIN;
    }

    function utcDay() { return new Date().toISOString().slice(0, 10); }

    function saveLiked(day, names) {
      try { window.localStorage.setItem(LIKED_KEY, JSON.stringify({ day, names: [...names] })); } catch { /* Keep the in-memory state. */ }
    }

    function readLiked() {
      const day = utcDay();
      try {
        const saved = JSON.parse(window.localStorage.getItem(LIKED_KEY));
        if (saved?.day === day && Array.isArray(saved.names)) {
          return { day, names: new Set(saved.names.filter(name => typeof name === 'string')) };
        }
      } catch { /* Start a new UTC day when storage is unavailable or malformed. */ }
      saveLiked(day, []);
      return { day, names: new Set() };
    }

    // One immutable snapshot feeds every carousel/rail card through useSyncExternalStore.
    let likesState = { counts: EMPTY_LIKES, ...readLiked(), errors: {} };
    const likesListeners = new Set();
    const likesRevisions = new Map();
    const pendingLikes = new Map();
    const getLikes = () => likesState;
    function subscribeLikes(listener) {
      likesListeners.add(listener);
      return () => likesListeners.delete(listener);
    }
    function updateLikes(patch) {
      likesState = { ...likesState, ...patch };
      likesListeners.forEach(listener => listener());
    }
    function resetLikedDay() {
      const day = utcDay();
      if (likesState.day === day) return;
      pendingLikes.clear();
      saveLiked(day, []);
      updateLikes({ day, names: new Set(), errors: {} });
    }
    function setLikeCount(name, count, patch = {}) {
      likesRevisions.set(name, (likesRevisions.get(name) || 0) + 1);
      updateLikes({ ...patch, counts: { ...likesState.counts, [name]: count } });
    }
    function likeCount(counts, name) {
      return Number.isSafeInteger(counts[name]) && counts[name] > 0 ? counts[name] : 0;
    }

    // One attempt; a cold server can take several seconds, so the caller tries twice.
    async function fetchLikeCounts(signal) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal.addEventListener('abort', abort);
      const timer = window.setTimeout(abort, 10000);
      try {
        const response = await fetch(likesOrigin() + '/likes.json', { signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (data?.schema !== 1 || !data.likes || typeof data.likes !== 'object' || Array.isArray(data.likes)) throw new Error();
        return Object.fromEntries(Object.entries(data.likes).filter(([, count]) => Number.isSafeInteger(count) && count > 0));
      } finally {
        window.clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      }
    }

    function loadLikes() {
      const controller = new AbortController();
      const revisions = new Map(likesRevisions);
      let live = true;
      async function load() {
        let counts = {};
        for (let attempt = 0; attempt < 2 && live; attempt++) {
          try {
            counts = await fetchLikeCounts(controller.signal);
            break;
          } catch { /* Likes are optional; the rest of the market must always remain usable. */ }
        }
        if (!live) return;
        // A cached GET must not overwrite an optimistic vote or a newer POST response.
        for (const [name, revision] of likesRevisions) {
          if (revision !== revisions.get(name) || pendingLikes.has(name)) counts[name] = likeCount(likesState.counts, name);
        }
        updateLikes({ counts });
      }
      load();
      return () => { live = false; controller.abort(); };
    }

    async function sendLike(name, source) {
      if (!settings.likes) return;
      resetLikedDay();
      if (likesState.names.has(name)) return;
      const previous = likeCount(likesState.counts, name);
      const request = {};
      pendingLikes.set(name, request);
      const names = new Set(likesState.names).add(name);
      saveLiked(likesState.day, names);
      setLikeCount(name, previous + 1, { names, errors: { ...likesState.errors, [name]: undefined } });
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 5000);
      let failure = 'likeFailed';
      try {
        const response = await fetch(likesOrigin() + '/api/like', {
          method: 'POST', signal: controller.signal,
          headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ name, source })
        });
        if (response.status === 429) failure = 'likeLimit';
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (data?.name !== name || !Number.isSafeInteger(data.likes) || data.likes < 0 || typeof data.counted !== 'boolean') throw new Error();
        resetLikedDay();
        if (pendingLikes.get(name) === request) setLikeCount(name, data.likes);
      } catch {
        resetLikedDay();
        if (pendingLikes.get(name) === request) {
          const names = new Set(likesState.names);
          names.delete(name);
          saveLiked(likesState.day, names);
          setLikeCount(name, previous, { names,
            errors: { ...likesState.errors, [name]: source === 'like' ? failure : undefined } });
        }
      } finally {
        if (pendingLikes.get(name) === request) pendingLikes.delete(name);
        window.clearTimeout(timer);
      }
    }

    function useLikes(enabled) {
      const snapshot = React.useSyncExternalStore(subscribeLikes, getLikes, getLikes);
      React.useEffect(() => {
        resetLikedDay();
        const timer = window.setInterval(resetLikedDay, 60000);
        window.addEventListener('focus', resetLikedDay);
        return () => { window.clearInterval(timer); window.removeEventListener('focus', resetLikedDay); };
      }, []);
      React.useEffect(() => {
        if (enabled) return loadLikes();
      }, [enabled, snapshot.day]);
      return snapshot;
    }

    const NS = 'openMarket';
    const zh = {
      title: '开放市场', loading: '正在读取开放插件市场…',
      heroTitle: '开放插件市场', heroLead: '{count} 个社区插件，推荐每天更新', searchPlaceholder: '搜索插件名称、作者或描述',
      allCategories: '全部', resultCount: '{count} 个插件', noResults: '没有找到匹配的插件', showMore: '显示更多', clearSearch: '清除', failed: '读取失败', retry: '重试',
      missingTitle: '开放插件市场不在索引源中', missingBody: '它可能在「发现」里被删掉了。添加后这里和「发现」都能看到。', addSource: '添加索引源',
      today: '今日推荐', recommended: '智能推荐', popular: '最受欢迎', trending: '增长最快',
      newest: '最新发布', active: '更新最勤', health: '我的插件体检',
      todayHint: '每天更新，按点赞和推荐加权', recommendedHint: '综合增长与维护情况', popularHint: '按近期点赞',
      trendingHint: '近 7 天下载增长', newestHint: '按发布时间', activeHint: '近 30 天发版频繁',
      close: '关闭', homepage: '主页', sourceCode: '源码', marketPage: '在开放插件市场网站查看',
      copy: '复制', copied: '已复制', installCommand: '安装命令', likeCount: '点赞 {count}',
      noCompatibleVersion: '这个插件没有兼容当前 DSH 的版本', dateLocale: 'zh-CN',
      updates: '可更新', incompatibleGroup: '不兼容当前 DSH',
      healthyCount: '另有 {count} 个已安装的插件状态正常', upToDate: '已安装的插件都是最新的',
      install: '安装', notInstalled: '未安装', installed: '已安装', updateAvailable: '有更新', update: '更新',
      incompatible: '不兼容', busy: '正在打开…', updating: '正在卸载旧版本…', actionFailed: '无法打开插件操作',
      updateHint: '先卸载当前版本，再打开新版本的安装', updateRestart: '这个插件正在运行，DSH 重启后才能更新，请重启后再试',
      updateUnavailable: '当前 DSH 不支持在这里更新，请到「已安装」里卸载后重新安装',
      unknownError: '未知错误', invalidPage: '市场返回了无效的分页数据', unknownVersion: '版本未知',
      noDescription: '暂无描述', sectionEmpty: '暂无符合条件的插件',
      previous: '向左浏览 {section}', next: '向右浏览 {section}',
      source: '数据来自开放插件市场', sourceLink: 'dshopen.org', newWindow: '在新窗口打开',
      recommendationPosition: '查看第 {number} 组推荐', settings: '设置', about: '关于',
      autoRotate: '今日推荐自动轮播', hideInstalled: '在横向列表中隐藏已安装的插件', showCheckup: '显示「我的插件体检」',
      autoReview: '新对话自动使用「自动审查」', autoReviewHelp: '打开后，每个新对话都直接使用 DSH 的实验性「自动审查」权限，不用每次手动选择、确认两次；DSH 没开「自动审查」时会一并打开，可能需要重启 DSH 生效。自动审查由当前模型判断每次工具调用，可能误放行或误拒绝，并消耗额外 token。', autoReviewRestart: '已保存，重启 DSH 后生效', autoReviewFailed: '切换失败：{reason}',
      likes: '参与点赞', likesHelp: '点赞和安装会向 dshopen.org 发送匿名请求，用于推荐排序；每人每天每个插件计一次，点赞每 3 天减少 1。',
      like: '点赞', likedToday: '今天已经点过赞了', likeLimit: '今天点赞次数已达上限', likeFailed: '点赞失败，请稍后再试',
      website: '官网', websiteUrl: 'https://dshopen.org/zh/', repository: 'GitHub 仓库', submitPlugin: '提交插件', indexAddress: '索引地址'
    };
    const en = {
      title: 'Open Market', loading: 'Loading Open Plugin Market…',
      heroTitle: 'Open Plugin Market', heroLead: '{count} community plugins, picks refreshed daily', searchPlaceholder: 'Search plugins by name, author or description',
      allCategories: 'All', resultCount: '{count} plugins', noResults: 'No matching plugins', showMore: 'Show more', clearSearch: 'Clear', failed: 'Could not load the market', retry: 'Retry',
      missingTitle: 'Open Plugin Market is not an index source', missingBody: 'It may have been removed in Discover. Add it back to see it here and in Discover.', addSource: 'Add index source',
      today: 'Today’s picks', recommended: 'Recommended', popular: 'Most popular', trending: 'Fastest growing',
      newest: 'Newly published', active: 'Most active', health: 'My plugin checkup',
      todayHint: 'Daily, weighted by likes and recommendations', recommendedHint: 'Growth and maintenance', popularHint: 'By recent likes',
      trendingHint: '7-day download growth', newestHint: 'By publication date', activeHint: 'Frequent releases in 30 days',
      close: 'Close', homepage: 'Homepage', sourceCode: 'Source code', marketPage: 'View on Open Plugin Market',
      copy: 'Copy', copied: 'Copied', installCommand: 'Install command', likeCount: '{count} likes',
      noCompatibleVersion: 'This plugin has no version compatible with your DSH', dateLocale: 'en',
      updates: 'Updates available', incompatibleGroup: 'Incompatible with this DSH version',
      healthyCount: '{count} other installed plugins are in good shape', upToDate: 'Installed plugins are all up to date',
      install: 'Install', notInstalled: 'Not installed', installed: 'Installed', updateAvailable: 'Update available', update: 'Update',
      incompatible: 'Incompatible', busy: 'Opening…', updating: 'Removing the old version…', actionFailed: 'Could not open the plugin action',
      updateHint: 'Removes the current version, then opens the install for the new one', updateRestart: 'This plugin is running; restart DSH, then update it',
      updateUnavailable: 'This DSH cannot update plugins from here; uninstall it under Installed and install it again',
      unknownError: 'Unknown error', invalidPage: 'The market returned invalid pagination data', unknownVersion: 'Unknown version',
      noDescription: 'No description available',
      sectionEmpty: 'No matching plugins yet', previous: 'Browse {section} left', next: 'Browse {section} right',
      source: 'Data from Open Plugin Market', sourceLink: 'dshopen.org', newWindow: 'Opens in a new window',
      recommendationPosition: 'Show recommendation group {number}', settings: 'Settings', about: 'About',
      autoRotate: 'Auto-rotate today’s picks', hideInstalled: 'Hide installed plugins in horizontal lists', showCheckup: 'Show my plugin checkup',
      autoReview: 'Start new conversations in Auto review', autoReviewHelp: "Every new conversation uses DSH's experimental Auto review permission, so you no longer pick and confirm it each time. If Auto review is off in DSH it is switched on too, which may need a restart. Auto review asks the current model about each tool call; it can wrongly allow or refuse actions and uses extra tokens.", autoReviewRestart: 'Saved; restart DSH for it to take effect', autoReviewFailed: 'Could not switch: {reason}',
      likes: 'Join likes', likesHelp: 'Likes and installs send anonymous requests to dshopen.org for recommendation ranking; each person counts once per plugin per UTC day, and likes decrease by 1 every 3 days.',
      like: 'Like', likedToday: 'Already liked today', likeLimit: 'Daily like limit reached', likeFailed: 'Could not like this plugin. Please try again later',
      website: 'Website', websiteUrl: 'https://dshopen.org/', repository: 'GitHub repository', submitPlugin: 'Submit a plugin', indexAddress: 'Index address'
    };

    // In the light theme every DSH layer is white, so cards sit on the grey module fill to stand apart from the page.
    const STYLES = `
      .opm-root { min-width: 0; width: 100%; padding: 6px 0 12px; box-sizing: border-box;
        color: var(--dsw-alias-label-primary); line-height: 1.5; }
      .opm-root *, .opm-root *::before, .opm-root *::after { box-sizing: border-box; }
      .opm-root h2, .opm-root h3, .opm-root p { margin: 0; }
      .opm-root h2, .opm-root h3 { font-size: 14px; font-weight: 600; }
      .opm-root button, .opm-root a, .opm-root summary { -webkit-tap-highlight-color: var(--dsw-alias-interactive-bg-active); }
      .opm-root :focus-visible { outline: 2px solid var(--dsw-alias-label-primary); outline-offset: 3px; }
      .opm-root ::selection { background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); }
      .opm-section { margin-top: 12px; min-width: 0; }
      .opm-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 22px; margin-bottom: 6px; }
      .opm-heading-copy { display: flex; align-items: baseline; gap: 6px; min-width: 0; }
      .opm-heading-copy h2 { flex-shrink: 0; }
      .opm-heading-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary); overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap; }
      .opm-button { font: inherit; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;
        min-height: 32px; padding: 6px 12px; border: 0; border-radius: var(--dsw-radius-sm);
        background: var(--dsw-alias-button-elevated-fill); color: var(--dsw-alias-label-primary);
        cursor: pointer; font-size: 13px; font-weight: 500; line-height: 1.4; }
      /* In the light theme buttons and cards are both white, so outline the plain buttons. */
      .opm-button:not(.opm-button-primary) { box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2); }
      .opm-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
      .opm-button:active:not(:disabled) { background: var(--dsw-alias-interactive-bg-active); }
      .opm-button-primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
      .opm-button-primary:hover:not(:disabled), .opm-button-primary:active:not(:disabled) { opacity: .85; background: var(--dsw-alias-button-primary-fill); }
      .opm-button:disabled { cursor: default; color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-interactive-bg-hover); }
      .opm-button-small { min-height: 28px; padding: 4px 9px; font-size: 12px; }
      .opm-like { gap: 3px; font-variant-numeric: tabular-nums; }
      .opm-like:disabled { color: var(--dsw-alias-state-warn-primary); background: var(--dsw-alias-button-elevated-fill); }
      .opm-author { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 16px; overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap; }
      .opm-description { color: var(--dsw-alias-label-secondary); font-size: 13px; overflow-wrap: anywhere; }
      .opm-icon { width: 36px; height: 36px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center;
        overflow: hidden; border-radius: var(--dsw-radius-md); background: var(--dsw-alias-interactive-bg-hover);
        color: var(--dsw-alias-label-secondary); font-size: 22px; font-weight: 600; }
      .opm-icon-large { width: 56px; height: 56px; font-size: 28px; }
      .opm-icon img { display: block; width: 100%; height: 100%; object-fit: contain; }
      .opm-tags { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
      .opm-tag { max-width: 100%; padding: 0 6px; border: 1px solid var(--dsw-alias-border-l2);
        border-radius: var(--dsw-radius-sm); font-size: 11px; line-height: 16px;
        color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .opm-tag-verified { color: var(--dsw-alias-state-success-primary); }
      .opm-tag-trending { color: var(--dsw-alias-state-warn-primary); }
      .opm-tag-active { color: var(--dsw-alias-button-info-fill); }
      .opm-list { position: relative; display: flow-root; min-width: 0; }
      .opm-arrow { position: absolute; z-index: 2; top: 50%; transform: translateY(-50%); width: 28px; height: 28px;
        min-height: 28px; padding: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-full, var(--dsw-radius-lg));
        background: var(--dsw-alias-settings-card-fill); box-shadow: var(--dsw-elevation-soft); color: var(--dsw-alias-label-primary);
        font: inherit; cursor: pointer; opacity: 0; pointer-events: none; transition: opacity 150ms ease-out; }
      .opm-arrow-previous { left: 4px; }
      .opm-arrow-next { right: 4px; }
      .opm-section:hover .opm-arrow:not(:disabled), .opm-section:focus-within .opm-arrow:not(:disabled),
      .opm-carousel:hover .opm-arrow:not(:disabled), .opm-carousel:focus-within .opm-arrow:not(:disabled) { opacity: 1; pointer-events: auto; }
      .opm-arrow:disabled { visibility: hidden; }
      .opm-rail, .opm-carousel-viewport { display: flex; align-items: stretch; gap: 10px; overflow-x: auto; overscroll-behavior-x: contain;
        scroll-snap-type: x proximity; scrollbar-width: none; padding: 24px 8px; margin: -24px -8px; scroll-padding-inline: 8px; }
      .opm-rail::-webkit-scrollbar, .opm-carousel-viewport::-webkit-scrollbar { display: none; }
      .opm-card { flex: 0 0 220px; width: 220px; min-width: 0; scroll-snap-align: start; padding: 12px;
        display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--dsw-alias-border-l2);
        border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-module-platform); cursor: pointer;
        transition: transform 150ms ease-out, box-shadow 150ms ease-out, border-color 150ms ease-out; }
      @media (hover: hover) {
        .opm-card:hover { transform: translateY(-2px) scale(1.02); box-shadow: var(--dsw-elevation-soft); border-color: var(--dsw-alias-border-l3); }
      }
      .opm-card-heading { display: flex; gap: 8px; align-items: center; min-width: 0; }
      .opm-card-copy { min-width: 0; flex: 1; }
      .opm-card .opm-title { line-height: 20px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .opm-card .opm-description { display: -webkit-box; -webkit-line-clamp: 2;
        -webkit-box-orient: vertical; overflow: hidden; }
      .opm-card-action { display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin-top: auto; }
      .opm-card .opm-tags { flex-wrap: nowrap; overflow: hidden; }
      .opm-card .opm-tag { white-space: nowrap; flex-shrink: 0; }
      .opm-carousel { min-width: 0; margin-top: 18px; }
      .opm-featured-slide { min-width: 0; flex-shrink: 0; display: flex; scroll-snap-align: start; }
      .opm-featured-card { width: 100%; flex: 1 1 auto; }
      .opm-dots { display: flex; align-items: center; flex-shrink: 0; }
      .opm-dot { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 22px;
        padding: 0; border: 0; background: none; cursor: pointer; border-radius: var(--dsw-radius-sm); }
      .opm-dot::after { content: ''; width: 6px; height: 6px; border-radius: var(--dsw-radius-sm);
        background: var(--dsw-alias-border-l3); }
      .opm-dot[aria-current="true"]::after { width: 14px; background: var(--dsw-alias-label-primary); }
      .opm-dot:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .opm-health { padding-top: 8px; border-top: 1px solid var(--dsw-alias-border-l2); }
      .opm-health-group { margin-top: 6px; }
      .opm-health-group > h3 { margin-bottom: 4px; }
      .opm-health-list { list-style: none; margin: 0; padding: 0; }
      .opm-health-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 5px 0; }
      .opm-health-row + .opm-health-row { border-top: 1px solid var(--dsw-alias-border-l2); }
      .opm-health-copy { flex: 1; min-width: 0; }
      .opm-health-title { font-size: 14px; overflow-wrap: anywhere; }
      .opm-version { font-size: 12px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
      .opm-health-summary { cursor: pointer; padding: 6px 0; color: var(--dsw-alias-label-secondary); font-size: 13px; }
      .opm-health-summary:hover { color: var(--dsw-alias-label-primary); }
      .opm-muted { color: var(--dsw-alias-label-secondary); font-size: 13px; }
      .opm-state { padding: 18px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg);
        background: var(--dsw-alias-bg-module-platform); }
      .opm-state .opm-button { margin-top: 10px; }
      .opm-error { color: var(--dsw-alias-state-warn-primary); font-size: 13px; overflow-wrap: anywhere; }
      .opm-error-detail { margin-top: 8px !important; white-space: pre-wrap; }
      .opm-action-error { margin-top: 12px !important; }
      .opm-footer { margin-top: 12px !important; color: var(--dsw-alias-label-caption); font-size: 12px; }
      .opm-footer a { color: var(--dsw-alias-label-secondary); text-underline-offset: 3px; }
      .opm-footer a:hover { color: var(--dsw-alias-label-primary); }
      .opm-skeleton { background: var(--dsw-alias-bg-skeleton); border-radius: var(--dsw-radius-sm); }
      .opm-skeleton-title { height: 22px; width: 45%; margin-bottom: 8px; }
      .opm-skeleton-hero { height: 168px; border-radius: var(--dsw-radius-lg); }
      .opm-skeleton-card { height: 148px; border: 0; background: var(--dsw-alias-bg-skeleton); }
      .opm-settings { padding: 0; font-size: 13px; }
      .opm-settings h2 { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
      .opm-settings-group + .opm-settings-group { margin-top: 18px; }
      .opm-setting-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; max-width: 560px; padding: 6px 0; }
      .opm-setting-row + .opm-setting-row { border-top: 1px solid var(--dsw-alias-border-l2); }
      .opm-setting-label { color: var(--dsw-alias-label-primary); }
      .opm-setting-separate { margin-top: 12px; border-top: 1px solid var(--dsw-alias-border-l2); }
      .opm-setting-help { max-width: 560px; margin-top: 2px !important; color: var(--dsw-alias-label-caption); font-size: 12px; }
      .opm-checkbox { display: flex; align-items: center; gap: 8px; cursor: pointer; }
      .opm-checkbox input { margin: 0; accent-color: var(--dsw-alias-button-primary-fill); }
      .opm-about-link { display: block; width: fit-content; padding: 4px 0;
        color: var(--dsw-alias-label-secondary); text-underline-offset: 3px; }
      .opm-about-link:hover { color: var(--dsw-alias-label-primary); }
      .opm-index-address { margin-top: 6px !important; color: var(--dsw-alias-label-secondary); }
      .opm-index-address code { display: block; user-select: text; overflow-wrap: anywhere; font-size: 12px; }
      .opm-overlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center;
        background: var(--dsw-alias-bg-mask-1); }
      .opm-panel { position: relative; width: min(560px, calc(100% - 32px)); max-height: calc(100vh - 64px); overflow-y: auto;
        padding: 24px; border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-1);
        box-shadow: var(--dsw-elevation-prominent); overscroll-behavior: contain; scrollbar-color: var(--dsw-alias-border-l3) var(--dsw-alias-bg-layer-1); }
      .opm-panel-close { position: absolute; top: 12px; right: 12px; padding: 0; width: 28px; }
      .opm-panel-heading { display: flex; align-items: center; gap: 12px; padding-right: 28px; margin-bottom: 16px; }
      .opm-panel-heading h2 { font-size: 18px; overflow-wrap: anywhere; }
      .opm-panel .opm-author { white-space: normal; overflow-wrap: anywhere; }
      .opm-panel > .opm-tags, .opm-panel-description, .opm-panel-info, .opm-panel-links, .opm-command, .opm-panel-actions { margin-top: 16px !important; }
      .opm-panel-description { white-space: pre-wrap; }
      .opm-panel-info, .opm-panel-links { display: flex; flex-wrap: wrap; gap: 6px 12px; }
      .opm-panel-links a { color: var(--dsw-alias-label-secondary); font-size: 13px; text-underline-offset: 3px; overflow-wrap: anywhere; }
      .opm-command { display: flex; align-items: center; gap: 8px; padding: 10px; background: var(--dsw-alias-bg-module-platform);
        border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm); }
      .opm-command code { flex: 1; min-width: 0; font-family: monospace; font-size: 12px; overflow-wrap: anywhere; user-select: text; }
      .opm-panel-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
      .opm-panel-actions .opm-like { min-height: 32px; }
      .opm-compatibility { margin-top: 16px !important; }
      /* Banner: the market's name and size over two soft colour washes, then search and category chips. */
      .opm-hero { position: relative; overflow: hidden; display: grid; gap: 12px; margin-top: 6px; padding: 18px 20px 16px;
        border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-lg);
        background: radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, #4f7cff 20%, transparent), transparent 55%),
          radial-gradient(90% 120% at 100% 100%, color-mix(in srgb, #b36bff 18%, transparent), transparent 55%),
          var(--dsw-alias-bg-module-platform); }
      .opm-hero-title { font-size: 20px !important; font-weight: 700 !important; letter-spacing: -.01em; }
      .opm-hero-lead { margin-top: 2px !important; color: var(--dsw-alias-label-secondary); font-size: 13px; }
      .opm-search { position: relative; display: flex; align-items: center; max-width: 560px; }
      .opm-search-icon { position: absolute; left: 11px; width: 15px; height: 15px; color: var(--dsw-alias-label-tertiary); pointer-events: none; }
      .opm-search input { width: 100%; height: 36px; padding: 0 32px 0 32px; border: 1px solid var(--dsw-alias-border-l2);
        border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary);
        font: inherit; font-size: 13px; outline: none; transition: border-color 150ms ease-out, box-shadow 150ms ease-out; }
      .opm-search input::placeholder { color: var(--dsw-alias-label-tertiary); }
      .opm-search input:focus { border-color: var(--dsw-alias-border-l3); box-shadow: 0 0 0 3px color-mix(in srgb, #4f7cff 22%, transparent); }
      .opm-search input::-webkit-search-cancel-button { display: none; }
      .opm-search-clear { position: absolute; right: 6px; width: 24px; height: 24px; padding: 0; border: 0; border-radius: var(--dsw-radius-sm);
        background: none; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 16px; cursor: pointer; }
      .opm-search-clear:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .opm-chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .opm-chip { display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l2);
        border-radius: 999px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px;
        cursor: pointer; transition: background-color 150ms ease-out, color 150ms ease-out; }
      .opm-chip small { color: var(--dsw-alias-label-tertiary); font-size: 11px; font-variant-numeric: tabular-nums; }
      .opm-chip:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
      .opm-chip[aria-pressed="true"] { border-color: transparent; background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }
      .opm-chip[aria-pressed="true"] small { color: inherit; opacity: .7; }
      .opm-result-count { margin-bottom: 8px !important; }
      .opm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
      .opm-grid .opm-card { width: auto; }
      .opm-more { display: flex; margin: 12px auto 0; }
      /* Section headings carry a small tinted glyph. */
      .opm-glyph { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 20px; height: 20px; align-self: center;
        border-radius: 6px; font-size: 12px; line-height: 1; color: var(--opm-glyph); background: color-mix(in srgb, var(--opm-glyph) 16%, transparent); }
      .opm-glyph-today { --opm-glyph: #e59a00; }
      .opm-glyph-recommended { --opm-glyph: #4f7cff; }
      .opm-glyph-popular { --opm-glyph: #f0507a; }
      .opm-glyph-trending { --opm-glyph: #f06a2c; }
      .opm-glyph-newest { --opm-glyph: #19a974; }
      .opm-glyph-active { --opm-glyph: #9a5cf5; }
      /* Cards: a soft wash of the plugin's own hue, an icon that glows in it, and a featured size for today's picks. */
      .opm-card { --opm-accent: hsl(var(--opm-hue, 220) 72% 58%);
        background: linear-gradient(160deg, color-mix(in srgb, var(--opm-accent) 9%, transparent), transparent 55%), var(--dsw-alias-bg-module-platform); }
      .opm-card .opm-icon { background: color-mix(in srgb, var(--opm-accent) 14%, var(--dsw-alias-bg-layer-1));
        box-shadow: 0 6px 14px -8px var(--opm-accent); }
      @media (hover: hover) {
        .opm-card:hover { border-color: color-mix(in srgb, var(--opm-accent) 45%, var(--dsw-alias-border-l2)); }
      }
      .opm-featured-card { gap: 10px; padding: 16px; min-height: 168px;
        background: radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, var(--opm-accent) 20%, transparent), transparent 60%), var(--dsw-alias-bg-module-platform); }
      .opm-featured-card .opm-title { font-size: 16px; line-height: 22px; }
      .opm-featured-card .opm-description { -webkit-line-clamp: 3; }
      .opm-featured-card .opm-icon { box-shadow: 0 10px 22px -10px var(--opm-accent); }
      @media (hover: none) { .opm-arrow { display: none; } }
      @media (prefers-reduced-motion: reduce) {
        .opm-card, .opm-arrow { transition: none; }
        .opm-card:hover { transform: none; border-color: var(--dsw-alias-border-l3); }
      }
    `;

    function errorText(error, fallback) {
      return String(error?.message || error?.code || (typeof error === 'string' && error) || fallback);
    }

    function titleOf(entry, resolve) {
      return resolve(entry.title) || entry.name;
    }

    // Each plugin gets a stable hue from its name, for the soft tint behind its card and icon.
    function hueOf(name) {
      let hash = 0;
      for (const char of name) hash = (hash * 31 + char.codePointAt(0)) % 360;
      return hash;
    }

    const SECTION_GLYPHS = { today: '☀', recommended: '✦', popular: '♥', trending: '↗', newest: '✚', active: '⚡' };

    function descriptionOf(entry, resolve, t) {
      const text = resolve(entry.description) || '';
      return text.replace(/^\s*★\s*[\d,.]+\s*│\s*/, '').trim() || t('noDescription');
    }

    function marketPageOf(entry, t) {
      return t('websiteUrl') + 'plugins/' + entry.name.split('/').map(encodeURIComponent).join('/') + '/';
    }

    function repositoryOf(entry) {
      return (entry.repository?.url || '').replace(/^git\+/, '').replace(/\.git(?=[?#]|$)/, '');
    }

    function externalUrl(value) {
      try {
        const url = new URL(value);
        if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
      } catch { /* An absent or malformed link is omitted. */ }
      return null;
    }

    function defaultVersionOf(entry) {
      return entry.defaultVersion ? entry.versions.find(version => version.version === entry.defaultVersion) : undefined;
    }

    function localDay() {
      const date = new Date();
      return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    }

    function featuredPool(entries, likes, day) {
      const ranked = [...entries].sort(recommendedOrder);
      const scores = new Map(ranked.map((entry, rank) => [entry.name,
        (Number(likes[entry.name]) || 0) * 10 + (ranked.length <= 1 ? 100 : 100 * (1 - rank / (ranked.length - 1)))]));
      const pool = ranked.filter(entry => entry.installation.status === 'not-installed')
        .sort((a, b) => scores.get(b.name) - scores.get(a.name) || recommendedOrder(a, b)).slice(0, 30);
      // Stable input ordering plus a date-seeded Fisher–Yates shuffle is independent of locale and input order.
      let seed = 2166136261;
      for (let i = 0; i < day.length; i++) seed = Math.imul(seed ^ day.charCodeAt(i), 16777619) >>> 0;
      function random() {
        seed = (seed + 0x6D2B79F5) >>> 0;
        let value = Math.imul(seed ^ (seed >>> 15), seed | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
      }
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      return pool.slice(0, 9);
    }

    function recommendedOrder(a, b) {
      const difference = (b.metadata?.sortKeys?.recommended ?? 0) - (a.metadata?.sortKeys?.recommended ?? 0);
      // A language-independent tie break keeps the daily pick identical for the same index and local date.
      return difference || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    }

    function latestPublication(entry) {
      return entry.versions.reduce((latest, version) => Math.max(latest, version.publishTimestamp || 0), 0);
    }

    function PluginIcon({ entry, title, large }) {
      const [failedSource, setFailedSource] = React.useState(null);
      let source;
      try { source = entry.icon ? new URL(entry.icon, INDEX_URL).href : null; } catch { source = null; }
      return h('span', { className: 'opm-icon' + (large ? ' opm-icon-large' : ''), 'aria-hidden': true },
        source && source !== failedSource
          ? h('img', { src: source, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer', onError: () => setFailedSource(source) })
          : Array.from(title.trim())[0]);
    }

    function Tags({ entry, metadata, resolve, limit }) {
      const rank = id => id === 'verified' ? 0 : id === 'trending' ? 1 : id === 'active' ? 2
        : id.startsWith('downloads-') ? 3 : id.startsWith('updated-') ? 4 : 5;
      const ids = [...new Set(entry.metadata?.labels || [])];
      const hasPriority = ids.some(id => rank(id) < 4);
      const selected = ids.filter(id => limit == null || !hasPriority || !id.startsWith('updated-'))
        .sort((a, b) => rank(a) - rank(b)).slice(0, limit);
      return h('div', { className: 'opm-tags' }, selected.map(id => h('span', {
        key: id, className: 'opm-tag' + (['verified', 'trending', 'active'].includes(id) ? ' opm-tag-' + id : '')
      }, resolve(metadata?.labels?.[id]?.title) || id)));
    }

    function InstallButton({ entry, t, resolve, install, openPackage, manager, onError, small, update }) {
      const [busy, setBusy] = React.useState(false);
      const [phase, setPhase] = React.useState('busy');
      const version = defaultVersionOf(entry);
      const status = entry.installation.status;
      const installed = status !== 'not-installed' && status !== 'update-available';
      const label = !version ? 'incompatible' : installed ? 'installed' : status === 'update-available'
        ? (update ? 'update' : 'updateAvailable') : 'install';
      async function act() {
        if (busy || !version) return;
        setBusy(true);
        onError('');
        try {
          function startInstall() {
            const answer = install({ ...version.install, title: titleOf(entry, resolve), version: version.version });
            void sendLike(entry.name, 'install');
            return answer;
          }
          // DSH's install refuses a package that is already there, so an update removes it first, as DSH's own
          // Update for official plugins does; the install dialog then installs the new version.
          async function startUpdate() {
            const service = manager?.();
            if (!service?.removeBundle) return { ok: false, error: t('updateUnavailable') };
            setPhase('updating');
            const removed = await service.removeBundle(entry.name);
            if (!removed?.ok) return removed;
            const failure = removed.value?.error;
            if (failure) return { ok: false, error: failure.code === 'stop-profile' ? t('updateRestart') : failure };
            if (removed.value?.application === 'failed') return { ok: false, error: t('unknownError') };
            setPhase('busy');
            return install({ ...version.install, title: titleOf(entry, resolve), version: version.version });
          }
          const answer = installed
            ? await openPackage(entry.name)
            : status === 'update-available' ? await startUpdate() : await startInstall();
          if (answer?.ok === false) onError(errorText(answer.error, t('unknownError')));
        } catch (error) {
          onError(errorText(error, t('unknownError')));
        } finally {
          setBusy(false);
          setPhase('busy');
        }
      }
      const updating = status === 'update-available' && version;
      return h('button', {
        type: 'button', className: 'opm-button' + (version && !installed ? ' opm-button-primary' : '') + (small ? ' opm-button-small' : ''),
        disabled: !version || busy, onClick: event => { event.stopPropagation(); return act(); }, 'aria-busy': busy,
        title: updating && !busy ? t('updateHint') : undefined,
        'aria-label': t(busy ? phase : label) + ' · ' + titleOf(entry, resolve)
      }, t(busy ? phase : label));
    }

    function LikeButton({ entry, t, resolve, likes }) {
      const liked = likes.names.has(entry.name);
      const count = likeCount(likes.counts, entry.name);
      const title = t(liked ? 'likedToday' : Object.hasOwn(likes.errors, entry.name) && likes.errors[entry.name] || 'like');
      return h('button', { type: 'button', className: 'opm-button opm-button-small opm-like', disabled: liked, title,
        'aria-pressed': liked, 'aria-label': title + ' · ' + titleOf(entry, resolve) + (count ? ' · ' + count : ''),
        onClick: event => { event.stopPropagation(); void sendLike(entry.name, 'like'); }
      }, h('span', { 'aria-hidden': true }, '♥'), count > 0 ? String(count) : null);
    }

    function PluginCard(props) {
      const { entry, t, resolve, metadata, featured } = props;
      const title = titleOf(entry, resolve);
      return h('article', { className: 'opm-card' + (featured ? ' opm-featured-card' : ''), style: { '--opm-hue': hueOf(entry.name) },
        tabIndex: 0, role: 'button', 'aria-label': title, 'aria-haspopup': 'dialog', 'data-plugin-name': entry.name,
        onClick: event => {
          // Disabled buttons do not run their own click handler, so guard their descendants here too.
          if (!event.target.closest('button, a')) props.onOpen(entry, event.currentTarget);
        },
        onKeyDown: event => {
          if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            props.onOpen(entry, event.currentTarget);
          }
        } },
        h('div', { className: 'opm-card-heading' },
          h(PluginIcon, { entry, title, large: featured }),
          h('div', { className: 'opm-card-copy' }, h('h3', { className: 'opm-title', title }, title),
            entry.author ? h('p', { className: 'opm-author', title: entry.author }, entry.author) : null)),
        h('p', { className: 'opm-description' }, descriptionOf(entry, resolve, t)),
        // Tags get their own line; beside the like and install buttons they wrapped in narrow cards.
        h(Tags, { entry, metadata, resolve, limit: featured ? 3 : 2 }),
        h('div', { className: 'opm-card-action' },
          props.likesEnabled ? h(LikeButton, props) : null,
          h(InstallButton, { ...props, small: true })));
    }

    function PluginDetails({ entry, returnTarget, marketRoot, onClose, ...props }) {
      const { t, resolve, metadata, likes } = props;
      const panel = React.useRef(null);
      const headingId = React.useId();
      const [copied, setCopied] = React.useState(false);
      const [actionError, setActionError] = React.useState('');
      const title = titleOf(entry, resolve);
      const latest = entry.versions?.[0];
      const version = entry.defaultVersion || latest?.version;
      const date = Number.isFinite(latest?.publishTimestamp) ? new Date(latest.publishTimestamp * 1000) : null;
      const published = date && Number.isFinite(date.getTime()) ? date.toLocaleDateString(t('dateLocale')) : '';
      const category = entry.metadata?.category;
      const status = entry.installation.status;
      const installation = status === 'not-installed' ? t('notInstalled') : status === 'update-available'
        ? t('updateAvailable') : t('installed') + (entry.installation.installedVersion ? ' ' + entry.installation.installedVersion : '');
      const command = 'dsh plugin --profile desktop add ' + entry.name;
      React.useEffect(() => {
        const node = panel.current;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        node.focus({ preventScroll: true });
        function keydown(event) {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          } else if (event.key === 'Tab') {
            const controls = [...node.querySelectorAll('button:not(:disabled), a[href], [tabindex="0"]')];
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (!first) { event.preventDefault(); node.focus(); }
            else if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) {
              event.preventDefault(); last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === node)) {
              event.preventDefault(); first.focus();
            }
          }
        }
        document.addEventListener('keydown', keydown, true);
        return () => {
          document.removeEventListener('keydown', keydown, true);
          document.body.style.overflow = previousOverflow;
          // A like can reorder a rail or today's picks while this dialog is open.
          const available = node => node?.isConnected && !node.closest('[inert]');
          const fallback = [...(marketRoot.current?.querySelectorAll('[data-plugin-name]') || [])]
            .find(node => node.dataset.pluginName === entry.name && available(node));
          const target = available(returnTarget) ? returnTarget : fallback || marketRoot.current;
          target?.focus();
        };
      }, [onClose, entry.name, returnTarget, marketRoot]);
      React.useEffect(() => {
        if (!copied) return;
        const timer = window.setTimeout(() => setCopied(false), 1800);
        return () => window.clearTimeout(timer);
      }, [copied]);
      async function copy() {
        try { await navigator.clipboard.writeText(command); setCopied(true); } catch { /* Clipboard access is optional. */ }
      }
      const links = [['homepage', externalUrl(entry.homepage)], ['sourceCode', externalUrl(repositoryOf(entry))],
        ['marketPage', marketPageOf(entry, t)]];
      return h('div', { className: 'opm-overlay', onClick: event => { if (event.target === event.currentTarget) onClose(); } },
        h('section', { className: 'opm-panel', role: 'dialog', 'aria-modal': true, 'aria-labelledby': headingId, tabIndex: -1, ref: panel },
          h('button', { type: 'button', className: 'opm-button opm-button-small opm-panel-close', onClick: onClose, 'aria-label': t('close') }, '×'),
          h('div', { className: 'opm-panel-heading' }, h(PluginIcon, { entry, title, large: true }),
            h('div', { className: 'opm-card-copy' }, h('h2', { id: headingId }, title),
              entry.author && h('p', { className: 'opm-author' }, entry.author),
              h('p', { className: 'opm-version' }, [version, published].filter(Boolean).join(' · ')))),
          h(Tags, { entry, metadata, resolve }),
          h('p', { className: 'opm-description opm-panel-description' }, descriptionOf(entry, resolve, t)),
          h('div', { className: 'opm-muted opm-panel-info' },
            category && h('span', null, resolve(metadata?.categories?.[category]?.title) || category),
            h('span', null, t('likeCount').replace('{count}', likeCount(likes.counts, entry.name))),
            h('span', null, installation)),
          h('div', { className: 'opm-panel-links' }, links.filter(([, href]) => href).map(([key, href]) =>
            h('a', { key, href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': t(key) + ' · ' + t('newWindow') }, t(key)))),
          h('div', { className: 'opm-command', role: 'group', 'aria-label': t('installCommand') }, h('code', null, command),
            h('button', { type: 'button', className: 'opm-button opm-button-small', onClick: copy, 'aria-live': 'polite' }, t(copied ? 'copied' : 'copy'))),
          !entry.defaultVersion && h('p', { className: 'opm-error opm-compatibility' }, t('noCompatibleVersion')),
          h('div', { className: 'opm-panel-actions' },
            props.likesEnabled && h(LikeButton, { ...props, entry }),
            h(InstallButton, { ...props, entry, update: true, onError: setActionError })),
          actionError && h('p', { className: 'opm-error', role: 'alert' }, t('actionFailed') + ': ' + actionError)));
    }

    function SectionHeading({ section, t, children }) {
      return h('div', { className: 'opm-heading' },
        h('div', { className: 'opm-heading-copy' }, h('span', { className: 'opm-glyph opm-glyph-' + section, 'aria-hidden': true }, SECTION_GLYPHS[section] || '•'), h('h2', null, t(section)),
          h('span', { className: 'opm-heading-hint', title: t(section + 'Hint') }, '· ' + t(section + 'Hint'))), children);
    }

    function FloatingArrows({ title, t, start, end, move }) {
      return h(React.Fragment, null,
        h('button', { type: 'button', className: 'opm-arrow opm-arrow-previous', disabled: start,
          'aria-label': t('previous').replace('{section}', title), onClick: () => move(-1) }, '←'),
        h('button', { type: 'button', className: 'opm-arrow opm-arrow-next', disabled: end,
          'aria-label': t('next').replace('{section}', title), onClick: () => move(1) }, '→'));
    }

    function useReducedMotion() {
      const [reduced, setReduced] = React.useState(() => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
      React.useEffect(() => {
        const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
        if (!media) return;
        const update = () => setReduced(media.matches);
        update();
        media.addEventListener('change', update);
        return () => media.removeEventListener('change', update);
      }, []);
      return reduced;
    }

    function FeaturedCarousel({ entries, autoRotate, ...props }) {
      const viewport = React.useRef(null);
      const [visible, setVisible] = React.useState(1);
      const [index, setIndex] = React.useState(0);
      const [edges, setEdges] = React.useState({ start: true, end: true });
      const [hovered, setHovered] = React.useState(false);
      const [focused, setFocused] = React.useState(false);
      const reduced = useReducedMotion();
      const count = Math.min(visible, entries.length || 1);
      const last = Math.max(0, entries.length - count);
      const position = Math.min(index, last);
      function measureScroll() {
        const node = viewport.current;
        if (!node) return;
        const width = node.firstElementChild?.getBoundingClientRect().width;
        if (width) setIndex(Math.max(0, Math.min(last, Math.round(node.scrollLeft / (width + 10)))));
        setEdges({ start: node.scrollLeft <= 1, end: node.scrollLeft + node.clientWidth >= node.scrollWidth - 1 });
      }
      function goTo(number, behavior = reduced ? 'auto' : 'smooth') {
        const node = viewport.current;
        const slide = node?.firstElementChild;
        if (slide) node.scrollTo({ left: number * (slide.getBoundingClientRect().width + 10), behavior });
      }
      React.useEffect(() => {
        const node = viewport.current;
        if (!node) return;
        function measure() {
          // The 8px gutters protect hover shadows without changing the card area's width.
          const width = node.clientWidth - 16;
          setVisible(width >= 900 ? 3 : width >= 560 ? 2 : 1);
        }
        measure();
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
        observer?.observe(node);
        window.addEventListener('resize', measure);
        return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
      }, []);
      React.useEffect(() => { goTo(0, 'auto'); setIndex(0); measureScroll(); }, [entries, count]);
      React.useEffect(() => {
        if (!autoRotate || reduced || hovered || focused || !last) return;
        const timer = window.setInterval(() => goTo(position >= last ? 0 : position + 1), 5000);
        return () => window.clearInterval(timer);
      }, [autoRotate, reduced, hovered, focused, last, position, entries, count]);
      const title = props.t('today');
      return h('section', { className: 'opm-carousel', 'aria-label': title,
        onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false),
        onFocusCapture: () => setFocused(true),
        onBlurCapture: event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); } },
        h(SectionHeading, { section: 'today', t: props.t },
          entries.length > 0 && h('div', { className: 'opm-dots' }, Array.from({ length: last + 1 }, (_, number) =>
            h('button', { type: 'button', className: 'opm-dot', key: number, 'aria-current': number === position ? 'true' : undefined,
              'aria-label': props.t('recommendationPosition').replace('{number}', number + 1), onClick: () => goTo(number) })))),
        h('div', { className: 'opm-list' },
          h('div', { className: 'opm-carousel-viewport', ref: viewport, onScroll: measureScroll }, entries.length ? entries.map(entry =>
            h('div', { key: entry.name, className: 'opm-featured-slide', style: { flexBasis: `calc((100% - ${(count - 1) * 10}px) / ${count})` } },
              h(PluginCard, { ...props, entry, featured: true })))
            : h('p', { className: 'opm-muted' }, props.t('sectionEmpty'))),
          h(FloatingArrows, { title, t: props.t, start: edges.start, end: edges.end,
            move: direction => goTo(Math.max(0, Math.min(last, position + direction))) })));
    }

    function PluginRail({ section, entries, ...props }) {
      const rail = React.useRef(null);
      const [edges, setEdges] = React.useState({ start: true, end: true });
      function measure() {
        const node = rail.current;
        if (node) setEdges({ start: node.scrollLeft <= 1, end: node.scrollLeft + node.clientWidth >= node.scrollWidth - 1 });
      }
      React.useEffect(() => {
        measure();
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
        if (rail.current) observer?.observe(rail.current);
        window.addEventListener('resize', measure);
        return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
      }, [entries]);
      function scroll(direction) {
        const node = rail.current;
        if (node) node.scrollBy({ left: direction * Math.max(230, node.clientWidth - 40), behavior: 'auto' });
      }
      const title = props.t(section);
      return h('section', { className: 'opm-section', 'aria-label': title },
        h(SectionHeading, { section, t: props.t }),
        h('div', { className: 'opm-list' },
          entries.length ? h('div', { className: 'opm-rail', ref: rail, tabIndex: 0, role: 'region', 'aria-label': title, onScroll: measure },
            entries.map(entry => h(PluginCard, { ...props, key: entry.name, entry })))
            : h('p', { className: 'opm-muted' }, props.t('sectionEmpty')),
          h(FloatingArrows, { title, t: props.t, start: edges.start, end: edges.end, move: scroll })));
    }

    function HealthRow({ entry, update, ...props }) {
      const title = titleOf(entry, props.resolve);
      const current = entry.installation.installedVersion || props.t('unknownVersion');
      return h('li', { className: 'opm-health-row' },
        h(PluginIcon, { entry, title }),
        h('div', { className: 'opm-health-copy' },
          h('p', { className: 'opm-health-title' }, title),
          h('p', { className: 'opm-version' }, update ? current + ' → ' + entry.defaultVersion : current)),
        h(InstallButton, { ...props, entry, update, small: true }));
    }

    function Checkup({ entries, ...props }) {
      const installed = entries.filter(entry => entry.installation.status !== 'not-installed');
      const incompatible = installed.filter(entry => !entry.defaultVersion);
      const updates = installed.filter(entry => entry.defaultVersion && entry.installation.status === 'update-available');
      const healthy = installed.filter(entry => entry.defaultVersion && entry.installation.status !== 'update-available');
      function group(key, items, update) {
        return items.length > 0 && h('div', { className: 'opm-health-group' },
          h('h3', null, props.t(key)), h('ul', { className: 'opm-health-list' },
            items.map(entry => h(HealthRow, { ...props, key: entry.name, entry, update }))));
      }
      return h('section', { className: 'opm-section opm-health', 'aria-label': props.t('health') },
        h('div', { className: 'opm-heading' }, h('h2', null, props.t('health'))),
        group('updates', updates, true), group('incompatibleGroup', incompatible, false),
        healthy.length > 0 && h('details', { className: 'opm-health-group' },
          h('summary', { className: 'opm-health-summary' }, props.t('healthyCount').replace('{count}', healthy.length)),
          h('ul', { className: 'opm-health-list' }, healthy.map(entry => h(HealthRow, { ...props, key: entry.name, entry })))),
        installed.length === 0 && h('p', { className: 'opm-muted' }, props.t('upToDate')));
    }

    // The top banner: the market's name, its size, and a search with category chips over the whole catalog.
    function MarketHero({ t, resolve, entries, metadata, query, setQuery, category, setCategory }) {
      const counts = new Map();
      for (const entry of entries) { const id = entry.metadata?.category; if (id) counts.set(id, (counts.get(id) || 0) + 1); }
      const categories = [...counts].sort((a, b) => b[1] - a[1]);
      return h('section', { className: 'opm-hero', 'aria-label': t('heroTitle') },
        h('div', { className: 'opm-hero-copy' },
          h('h2', { className: 'opm-hero-title' }, t('heroTitle')),
          h('p', { className: 'opm-hero-lead' }, t('heroLead').replace('{count}', entries.length))),
        h('label', { className: 'opm-search' },
          h('svg', { className: 'opm-search-icon', viewBox: '0 0 24 24', 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' },
            h('circle', { cx: 11, cy: 11, r: 7 }), h('path', { d: 'm20 20-3.5-3.5' })),
          h('input', { type: 'search', value: query, placeholder: t('searchPlaceholder'), 'aria-label': t('searchPlaceholder'),
            onChange: event => setQuery(event.target.value) }),
          query && h('button', { type: 'button', className: 'opm-search-clear', onClick: () => setQuery(''), 'aria-label': t('clearSearch') }, '×')),
        h('div', { className: 'opm-chips', role: 'group', 'aria-label': t('allCategories') },
          [['', t('allCategories'), entries.length], ...categories.map(([id, count]) => [id, resolve(metadata?.categories?.[id]?.title) || id, count])]
            .map(([id, label, count]) => h('button', { type: 'button', key: id || 'all', className: 'opm-chip', 'aria-pressed': category === id,
              onClick: () => setCategory(id) }, label, h('small', null, count)))));
    }

    // Search and category results replace the rows with one grid of cards.
    function SearchResults({ entries, ...props }) {
      const [limit, setLimit] = React.useState(24);
      React.useEffect(() => setLimit(24), [entries]);
      return h('section', { className: 'opm-section', 'aria-label': props.t('resultCount').replace('{count}', entries.length) },
        h('p', { className: 'opm-muted opm-result-count', role: 'status' }, props.t('resultCount').replace('{count}', entries.length)),
        entries.length ? h('div', { className: 'opm-grid' }, entries.slice(0, limit).map(entry => h(PluginCard, { ...props, key: entry.name, entry })))
          : h('p', { className: 'opm-muted' }, props.t('noResults')),
        entries.length > limit && h('button', { type: 'button', className: 'opm-button opm-more', onClick: () => setLimit(value => value + 24) }, props.t('showMore')));
    }

    function Loading({ t }) {
      return h('div', { role: 'status', 'aria-label': t('loading'), 'aria-busy': true },
        h('div', { 'aria-hidden': true },
          h('div', { className: 'opm-skeleton opm-skeleton-hero' }),
          [0, 1].map(row => h('div', { key: row, className: 'opm-section' },
            h('div', { className: 'opm-skeleton opm-skeleton-title' }),
            h('div', { className: 'opm-rail' }, [0, 1, 2, 3].map(card => h('div', {
              key: card, className: 'opm-card opm-skeleton-card'
            })))))));
    }

    function OpenMarketTab({ t, remote, manager, resolve, install, openPackage }) {
      const root = React.useRef(null);
      const [selected, setSelected] = React.useState(null);
      const closeDetails = React.useCallback(() => setSelected(null), []);
      const [state, setState] = React.useState({ status: 'loading' });
      const [attempt, setAttempt] = React.useState(0);
      // A reload after an install or removal keeps the current page on screen instead of the skeleton.
      const quiet = React.useRef(false);
      const [day, setDay] = React.useState(localDay);
      const preferences = useSettings();
      React.useEffect(() => {
        if (typeof remote.$on !== 'function') return;
        let timer;
        const off = remote.$on('plugin-manager/changed', () => {
          window.clearTimeout(timer);
          timer = window.setTimeout(() => { quiet.current = true; setAttempt(value => value + 1); }, 400);
        });
        return () => { window.clearTimeout(timer); if (typeof off === 'function') off(); };
      }, [remote]);
      const likes = useLikes(preferences.likes);
      const counts = preferences.likes ? likes.counts : EMPTY_LIKES;
      React.useEffect(() => {
        const timer = window.setInterval(() => setDay(localDay()), 60000);
        return () => window.clearInterval(timer);
      }, []);
      const [actionError, setActionError] = React.useState('');
      const [query, setQuery] = React.useState('');
      const [category, setCategory] = React.useState('');
      React.useEffect(() => {
        let live = true;
        if (!quiet.current) setState({ status: 'loading' });
        quiet.current = false;
        async function load() {
          const entries = new Map();
          let offset = 0;
          let metadata;
          try {
            while (live) {
              // Only the host reads the index. Each page is an explicit Remote result envelope.
              const answer = await remote.pluginMarket.search(INDEX_URL, {
                sort: { kind: 'key', id: 'recommended', direction: 'desc' }, offset, limit: 100
              });
              if (!live) return;
              if (!answer.ok) {
                // The user removed our source from Discover; offer to add it back instead of an error.
                const missing = /unknown-index/.test(String(answer.error?.code ?? '')) || /not a configured index/i.test(String(answer.error?.message ?? ''));
                setState(missing ? { status: 'missing' } : { status: 'error', error: answer.error });
                return;
              }
              const page = answer.value;
              if (!Array.isArray(page?.entries) || (page.nextOffset !== null &&
                  (!Number.isInteger(page.nextOffset) || page.nextOffset <= offset))) {
                setState({ status: 'error', invalidPage: true });
                return;
              }
              if (offset === 0) metadata = page.metadata;
              page.entries.forEach(entry => entries.set(entry.name, entry));
              if (page.nextOffset === null) {
                setState({ status: 'ready', entries: [...entries.values()], metadata });
                return;
              }
              offset = page.nextOffset;
            }
          } catch (error) {
            if (live) setState({ status: 'error', error });
          }
        }
        load();
        return () => { live = false; };
      }, [remote, attempt]);

      const sections = React.useMemo(() => {
        if (state.status !== 'ready') return null;
        const entries = preferences.hideInstalled
          ? state.entries.filter(entry => entry.installation.status === 'not-installed') : state.entries;
        const ranked = [...entries].sort(recommendedOrder);
        const labeled = label => ranked.filter(entry => entry.metadata?.labels?.includes(label)).slice(0, 20);
        const popular = entries.filter(entry => likeCount(counts, entry.name) > 0)
          .sort((a, b) => counts[b.name] - counts[a.name] || recommendedOrder(a, b)).slice(0, 20);
        return {
          daily: featuredPool(state.entries, counts, day),
          rails: [
            ['recommended', ranked.slice(0, 20)], ...(popular.length ? [['popular', popular]] : []),
            ['trending', labeled('trending')],
            ['newest', [...entries].sort((a, b) => latestPublication(b) - latestPublication(a) || recommendedOrder(a, b)).slice(0, 20)],
            ['active', labeled('active')]
          ]
        };
      }, [state, day, preferences.hideInstalled, counts]);

      const results = React.useMemo(() => {
        if (state.status !== 'ready' || (!query.trim() && !category)) return null;
        const terms = query.normalize('NFKC').toLowerCase().split(/\s+/).filter(Boolean);
        return [...state.entries].sort(recommendedOrder).filter(entry => {
          if (category && entry.metadata?.category !== category) return false;
          const haystack = [entry.name, titleOf(entry, resolve), entry.author, resolve(entry.description), ...(entry.metadata?.keywords || [])]
            .join(' ').normalize('NFKC').toLowerCase();
          return terms.every(term => haystack.includes(term));
        });
      }, [state, query, category, resolve]);

      async function addSource() {
        const listed = await remote.pluginMarket.listIndexes();
        const urls = listed.ok ? listed.value.map(source => source.url) : [];
        const added = urls.includes(INDEX_URL) ? { ok: true } : await remote.pluginMarket.setIndexes([...urls, INDEX_URL]);
        if (added.ok) setAttempt(value => value + 1);
        else setState({ status: 'error', error: added.error });
      }

      const props = { t, resolve, install, openPackage, manager, metadata: state.metadata, onError: setActionError,
        likesEnabled: preferences.likes, likes, onOpen: (entry, returnTarget) => setSelected({ entry, returnTarget }) };
      let content;
      if (state.status === 'loading') content = h(Loading, { t });
      else if (state.status === 'missing') content = h('div', { className: 'opm-state' },
        h('div', null, h('h2', null, t('missingTitle')), h('p', { className: 'opm-muted' }, t('missingBody'))),
        h('button', { type: 'button', className: 'opm-button opm-button-primary', onClick: addSource }, t('addSource')));
      else if (state.status === 'error') content = h('div', { className: 'opm-state' },
        h('div', { role: 'alert' }, h('h2', null, t('failed')),
          h('p', { className: 'opm-muted opm-error-detail' }, state.invalidPage ? t('invalidPage') : errorText(state.error, t('unknownError')))),
        h('button', { type: 'button', className: 'opm-button', onClick: () => setAttempt(value => value + 1) }, t('retry')));
      else {
        content = h(React.Fragment, null,
          h(MarketHero, { t, resolve, entries: state.entries, metadata: state.metadata, query, setQuery, category, setCategory }),
          results ? h(SearchResults, { ...props, entries: results }) : h(React.Fragment, null,
            h(FeaturedCarousel, { ...props, entries: sections.daily, autoRotate: preferences.autoRotate && !selected }),
            sections.rails.map(([section, entries]) => h(PluginRail, { ...props, key: section, section, entries }))),
          preferences.showCheckup && h(Checkup, { ...props, entries: state.entries }),
          actionError && h('p', { className: 'opm-error opm-action-error', role: 'alert' }, t('actionFailed') + ': ' + actionError));
      }
      const detailEntry = selected && (state.entries?.find(entry => entry.name === selected.entry.name) || selected.entry);
      return h('div', { className: 'opm-root', ref: root, tabIndex: -1 },
        h('div', { inert: selected ? '' : undefined }, content,
        h('p', { className: 'opm-footer' }, t('source') + ' ',
          h('a', { href: t('websiteUrl'), target: '_blank', rel: 'noopener noreferrer',
            'aria-label': t('sourceLink') + ' · ' + t('newWindow') }, t('sourceLink')))),
        selected && h(PluginDetails, { ...props, entry: detailEntry, returnTarget: selected.returnTarget,
          marketRoot: root, onClose: closeDetails }));
    }

    const inject = ['slots', 'locale', 'remote', 'remote.pluginMarket'];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'open-market: dictionaries');
      ctx.effect(() => {
        const style = document.createElement('style');
        style.textContent = STYLES;
        document.head.appendChild(style);
        return () => style.remove();
      }, 'open-market: styles');
      const t = ctx.locale.bind(NS);
      // The Auto review switch is this package's second row; the plugin manager reads and saves it like any row.
      const AUTO_REVIEW_ROW = 'open-market-auto-review';
      function useAutoReviewRow() {
        const [row, setRow] = React.useState({ status: 'loading' });
        const read = React.useCallback(async () => {
          const manager = pluginManager;
          if (!manager) return setRow({ status: 'unavailable' });
          const answer = await manager.listPlugins();
          const entry = answer?.ok ? answer.value.find(item => item.patchId === AUTO_REVIEW_ROW) : undefined;
          setRow(entry ? { status: 'ready', entryId: entry.entryId, enabled: !!entry.enabled } : { status: 'unavailable' });
        }, []);
        React.useEffect(() => { read().catch(() => setRow({ status: 'unavailable' })); }, [read]);
        async function set(enabled) {
          if (row.status !== 'ready') return;
          setRow({ ...row, enabled, busy: true, note: '' });
          try {
            const answer = await pluginManager.setPluginEnabled(row.entryId, enabled);
            const application = answer?.ok ? answer.value?.application : undefined;
            if (!answer?.ok || application === 'failed') throw new Error(errorText(answer?.ok ? answer.value?.error : answer?.error, t('unknownError')));
            await read();
            if (application === 'restart-required') setRow(current => ({ ...current, note: t('autoReviewRestart') }));
          } catch (error) {
            await read().catch(() => {});
            setRow(current => ({ ...current, note: t('autoReviewFailed').replace('{reason}', errorText(error, t('unknownError'))) }));
          }
        }
        return [row, set];
      }

      function SettingsSection({ view }) {
        const preferences = useSettings();
        const [autoReview, setAutoReview] = useAutoReviewRow();
        if (view !== 'page') return null;
        function link(key, href) {
          return h('a', { key, className: 'opm-about-link', href, target: '_blank', rel: 'noopener noreferrer',
            'aria-label': t(key) + ' · ' + t('newWindow') }, t(key));
        }
        return h('div', { className: 'opm-root opm-settings' },
          h('section', { className: 'opm-settings-group', 'aria-label': t('settings') },
            h('h2', null, t('settings')),
            // DSH's Switch uses its label for screen readers only, so the visible text sits beside it.
            Object.keys(DEFAULT_SETTINGS).map(key => h('div', { key, className: 'opm-setting-row' },
              Switch ? h(React.Fragment, null, h('span', { className: 'opm-setting-label' }, t(key)),
                h(Switch, { checked: preferences[key], label: t(key), onChange: value => updateSettings(key, value) }))
                : h('label', { className: 'opm-checkbox' },
                  h('input', { type: 'checkbox', checked: preferences[key], onChange: event => updateSettings(key, event.target.checked) }),
                  h('span', null, t(key))))),
            h('p', { className: 'opm-setting-help' }, t('likesHelp')),
            autoReview.status === 'ready' && h(React.Fragment, null,
              h('div', { className: 'opm-setting-row opm-setting-separate' },
                Switch ? h(React.Fragment, null, h('span', { className: 'opm-setting-label' }, t('autoReview')),
                  h(Switch, { checked: autoReview.enabled, disabled: !!autoReview.busy, label: t('autoReview'), onChange: setAutoReview }))
                  : h('label', { className: 'opm-checkbox' },
                    h('input', { type: 'checkbox', checked: autoReview.enabled, disabled: !!autoReview.busy, onChange: event => setAutoReview(event.target.checked) }),
                    h('span', null, t('autoReview')))),
              h('p', { className: 'opm-setting-help' }, t('autoReviewHelp')),
              autoReview.note && h('p', { className: 'opm-setting-help', role: 'status' }, autoReview.note))),
          h('section', { className: 'opm-settings-group', 'aria-label': t('about') }, h('h2', null, t('about')),
            link('website', t('websiteUrl')),
            link('repository', 'https://github.com/polang233/dsh-plugin-index'),
            link('submitPlugin', 'https://github.com/polang233/dsh-plugin-index/issues/new?template=plugin-add.yml'),
            h('p', { className: 'opm-index-address' }, t('indexAddress'), h('code', null, INDEX_URL))));
      }
      ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register(
        { name: 'plugins.bundle.config', key: 'dsh-open-market' }, SettingsSection));
      // Installs from DSH's own Discover never reach dshopen.org. While likes are on, each bundle that appears after an
      // install counts as an install like; sendLike skips plugins liked today and the server ignores unlisted names.
      // The plugin manager is optional: without it the tab still browses and installs, only Update is unavailable.
      let pluginManager;
      ctx.inject(['remote.pluginManager'], ctx => {
        pluginManager = ctx.remote.pluginManager;
        ctx.effect(() => () => { pluginManager = undefined; }, 'open-market: plugin manager');
        let known;
        const installed = async () => {
          const answer = await ctx.remote.pluginManager.listBundles();
          return answer?.ok ? new Set(answer.value.filter(bundle => bundle.installed).map(bundle => bundle.name)) : undefined;
        };
        installed().then(names => { known ??= names; }, () => {});
        ctx.effect(() => ctx.remote.$on('plugin-manager/changed', change => {
          if (change?.reason !== 'install') return;
          installed().then(names => {
            if (!names) return;
            if (known) for (const name of names) if (!known.has(name)) void sendLike(name, 'install');
            known = names;
          }, () => {});
        }), 'open-market: count installs');
      });
      const face = { remote: ctx.remote, manager: () => pluginManager, resolve: text => ctx.locale.resolveText(text) };
      ctx.slots.inject('plugins.tab', () => ctx.slots.register({
        name: 'plugins.tab',
        id: 'open-market',
        // Installed and Discover share order 0 and then follow load order; 1 keeps this tab after both.
        order: 1,
        label: () => t('title'),
        locale: NS,
        inject: () => face
      }, OpenMarketTab));
    }

    return { apply, inject };
  }
});
