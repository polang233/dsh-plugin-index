import { outsideReload } from '../index.js';

export const name = 'dsh-open-market-auto-review';
// The row our patch inserts for this switch; it ships disabled.
export const ROW_ID = 'open-market-auto-review';
// DSH's experimental per-call review, which adds the Auto review permission preset.
export const AUTO_REVIEW_BUNDLE = '@deepseek-ai/dsh-experimental-auto-review';
export const AUTO_PRESET = 'auto';

/**
 * Whether a session is a brand-new conversation the user started: not a restored one, not a fork or a seeded copy,
 * and not a delegated child, which keeps its own fixed approval policy.
 */
export function isNewConversation(session) {
  const header = session?.header;
  return !!header && session.firstLiveSeq === 0 && !header.isSeeded && header.origin === undefined && header.parentSession === undefined;
}

/**
 * Switch on DSH's experimental Auto review bundle if it is off.
 * @returns 'on' | 'enabled' | 'restart' (saved, takes effect at the next start) | 'unavailable'
 */
export async function ensureAutoReviewBundle(manager) {
  const bundle = (await manager.listBundles()).find(info => info.name === AUTO_REVIEW_BUNDLE);
  if (!bundle || bundle.availability === 'missing') return 'unavailable';
  if (bundle.enabled) return 'on';
  const change = await manager.setBundleEnabled(AUTO_REVIEW_BUNDLE, true);
  if (change.application === 'failed') throw new Error(change.error?.message ?? 'could not enable ' + AUTO_REVIEW_BUNDLE);
  return change.application === 'restart-required' ? 'restart' : 'enabled';
}

/**
 * While this row is on, every new conversation starts in Auto review instead of the default permission preset, so
 * nobody has to pick it and confirm it twice per conversation. The switch goes through the same preset writer as
 * DSH's /permission command, without the picker's confirmation dialogs.
 */
export function apply(ctx) {
  const logger = ctx.logger?.('dsh-open-market') ?? ctx.logger;
  const warn = what => error => logger?.warn?.('Could not %s: %s', what, error?.message ?? error);

  ctx.inject(['pluginManager'], ctx => {
    outsideReload(ctx, () => ensureAutoReviewBundle(ctx.pluginManager)).then(
      result => {
        if (result === 'enabled') logger?.info?.('Switched on Auto review');
        if (result === 'restart') logger?.info?.('Switched on Auto review; it takes effect at the next start');
        if (result === 'unavailable') logger?.warn?.('This DSH does not ship Auto review');
      },
      warn('switch on Auto review')
    );
  });

  ctx.inject(['permissionPresets'], ctx => {
    ctx.on('session/created', session => {
      if (!isNewConversation(session)) return;
      try {
        ctx.permissionPresets.set(session, AUTO_PRESET);
      } catch (error) {
        // Auto review is not loaded yet (for example until the next start); the session keeps its default.
        warn('start the new conversation in Auto review')(error);
      }
    });
  });
}
