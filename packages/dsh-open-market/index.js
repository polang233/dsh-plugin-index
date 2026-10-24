import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const name = 'dsh-open-market';
// The row id our patch inserts; it differs from the package name so the Plugins page does not show the same name twice.
export const ROW_ID = 'open-market';

export const INDEX_URL = 'https://dshopen.org/index.json';
// The optional DSH bundle behind Plugins → Experimental plugins → Custom plugin markets.
export const MARKET_BUNDLE = '@deepseek-ai/dsh-experimental-plugin-market-bundle';
// Earlier address of the same index; a profile that already has it needs no second copy.
const ALIASES = ['https://polang233.github.io/dsh-plugin-index/index.json'];
const STATE_FILE = '.dsh-open-market.json';

const canonical = url => URL.canParse(url) ? new URL(url).href : url;
const sameIndex = url => new Set([url, ...(url === INDEX_URL ? ALIASES : [])].map(canonical));

/** The marker lives in the profile, so each profile is set up once and the user's later choices stay. */
async function readState(dir) {
  if (!dir) return {};
  try { return JSON.parse(await readFile(join(dir, STATE_FILE), 'utf8')); } catch { return {}; }
}

async function writeState(dir, patch) {
  if (!dir) return;
  const state = { ...await readState(dir), ...patch };
  await writeFile(join(dir, STATE_FILE), JSON.stringify(state, null, 2) + '\n');
}

/**
 * Add the index to the configured sources unless this profile already received it.
 * @param force Add it even if the user removed it earlier, for an explicit request.
 * @returns 'added' | 'present' | 'skipped'
 */
export async function ensureIndex(market, { url = INDEX_URL, dir, force = false } = {}) {
  const seeded = (await readState(dir)).added;
  const added = Array.isArray(seeded) ? seeded : [];
  if (!force && added.includes(canonical(url))) return 'skipped';
  const current = market.listIndexes().map(source => source.url);
  const same = sameIndex(url);
  const present = current.some(source => same.has(canonical(source)));
  if (!present) await market.setIndexes([...current, url]);
  if (!added.includes(canonical(url))) await writeState(dir, { added: [...added, canonical(url)] });
  return present ? 'present' : 'added';
}

/**
 * Switch on Custom plugin markets once per profile. A user who turns it off afterwards keeps it off.
 * @param force Switch it on regardless, for an explicit request.
 * @returns 'enabled' | 'restart' (saved, takes effect at the next start) | 'on' | 'skipped' | 'unavailable'
 */
export async function ensureMarketBundle(manager, { dir, force = false } = {}) {
  const state = await readState(dir);
  if (!force && state.marketBundle) return 'skipped';
  const bundle = (await manager.listBundles()).find(info => info.name === MARKET_BUNDLE);
  if (!bundle || bundle.availability === 'missing') return 'unavailable';
  let result = 'on';
  if (!bundle.enabled) {
    const change = await manager.setBundleEnabled(MARKET_BUNDLE, true);
    if (change.application === 'failed') throw new Error(change.error?.message ?? 'could not enable ' + MARKET_BUNDLE);
    result = change.application === 'restart-required' ? 'restart' : 'enabled';
  }
  await writeState(dir, { marketBundle: true });
  return result;
}

// Command output goes straight to the UI, which has no locale for Host text, so it carries both languages.
/** Whether the user switched this plugin, or its bundle, off on the Plugins page. */
export async function turnedOff(manager) {
  const bundle = (await manager.listBundles()).find(info => info.name === name);
  if (bundle && !bundle.enabled) return true;
  const row = (await manager.listPlugins()).find(entry => entry.patchId === ROW_ID);
  return row?.enabled === false;
}

/**
 * Turning the plugin off and on again is an explicit request to set it up again, so forget what this profile
 * already received. A plain restart never gets here and keeps the user's earlier choices.
 */
export async function forgetIfTurnedOff(manager, dir) {
  if (!dir || !await turnedOff(manager)) return false;
  await writeState(dir, { added: [], marketBundle: false });
  return true;
}

const MESSAGES = {
  unavailable: '当前 DSH 不包含「自定义插件市场」，无法添加开放插件市场。\nThis DSH does not ship Custom plugin markets, so Open Plugin Market cannot be added.',
  failed: reason => `开放插件市场设置失败 / Could not set up Open Plugin Market: ${reason}`,
  waiting: '已打开「自定义插件市场」，开放插件市场稍后会出现在「插件 → 发现」中。\nCustom plugin markets is on. Open Plugin Market will appear in Plugins → Discover in a moment.',
  restart: '已打开「自定义插件市场」，重启 DSH 后开放插件市场会出现在「插件 → 发现」中。\nCustom plugin markets is on. Restart DSH and Open Plugin Market will appear in Plugins → Discover.',
  ready: url => `开放插件市场已加入「插件 → 发现」。\nOpen Plugin Market is ready in Plugins → Discover.\n${url}`
};

/** `/open-market`: put the market back after the user removed it, switching Custom plugin markets on if needed. */
export async function openMarket(ctx, { url, dir }) {
  const text = MESSAGES;
  try {
    let market = ctx.get('pluginMarket');
    if (!market) {
      const manager = ctx.get('pluginManager');
      if (!manager) return { kind: 'error', text: text.unavailable };
      const bundle = await ensureMarketBundle(manager, { dir, force: true });
      if (bundle === 'unavailable') return { kind: 'error', text: text.unavailable };
      market = ctx.get('pluginMarket');
      // The bundle loads its service asynchronously; the index is added when it arrives.
      if (!market) {
        const { added = [] } = await readState(dir);
        await writeState(dir, { added: added.filter(seeded => !sameIndex(url).has(canonical(seeded))) });
        return { kind: 'success', text: bundle === 'restart' ? text.restart : text.waiting };
      }
    }
    await ensureIndex(market, { url, dir, force: true });
    return { kind: 'success', text: text.ready(url) };
  } catch (error) {
    return { kind: 'error', text: text.failed(error?.message ?? String(error)) };
  }
}

/**
 * Run a profile write outside the HMR transaction that may be loading this plugin. Switching the plugin back on loads
 * it inside one, every async call made from there inherits it, and a nested transaction is a fatal load failure.
 * Outside the transaction the write simply queues behind the reload.
 */
export function outsideReload(ctx, write) {
  const executing = ctx.get?.('hmr')?.executing;
  return typeof executing?.exit === 'function' ? executing.exit(write) : write();
}

export function apply(ctx, config = {}) {
  const url = typeof config?.indexUrl === 'string' ? config.indexUrl : INDEX_URL;
  const dir = ctx.get?.('profileContext')?.dir;
  const logger = ctx.logger?.('dsh-open-market') ?? ctx.logger;
  const warn = what => error => logger?.warn?.('Could not %s: %s', what, error?.message ?? error);

  ctx.inject(['pluginManager'], ctx => {
    // Without hot reload a switched-off plugin keeps running until the next start, so it sees its own change;
    // with hot reload it is unloaded right after the change is saved and checks on the way out.
    // Switching it back on may only re-run this part, so seed the index here too; the marker still guards removals.
    const check = () => forgetIfTurnedOff(ctx.pluginManager, dir).then(
      async forgot => {
        if (forgot) return logger?.info?.('Switched off; the index will be added again when switched back on');
        const market = ctx.get('pluginMarket');
        if (market && await outsideReload(ctx, () => ensureIndex(market, { url, dir })) === 'added') logger?.info?.('Added %s to plugin market sources', url);
      },
      warn('read the plugin state')
    );
    ctx.on('plugin-manager/changed', check);
    ctx.effect(() => check, 'dsh-open-market: forget on switch-off');
    check();
    outsideReload(ctx, () => ensureMarketBundle(ctx.pluginManager, { dir })).then(
      result => {
        if (result === 'enabled') logger?.info?.('Switched on Custom plugin markets');
        if (result === 'restart') logger?.info?.('Switched on Custom plugin markets; it takes effect at the next start');
      },
      warn('switch on Custom plugin markets')
    );
  });

  ctx.inject(['pluginMarket'], ctx => {
    outsideReload(ctx, () => ensureIndex(ctx.pluginMarket, { url, dir })).then(
      result => { if (result === 'added') logger?.info?.('Added %s to plugin market sources', url); },
      warn(`add ${url} to plugin market sources`)
    );
  });

  ctx.inject(['commands'], ctx => {
    ctx.commands.register({
      name: 'open-market',
      description: 'add Open Plugin Market to Plugins → Discover / 把开放插件市场加入「发现」',
      handler: () => openMarket(ctx, { url, dir })
    });
  });
}
