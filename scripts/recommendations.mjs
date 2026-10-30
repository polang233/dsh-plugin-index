import {createHash} from 'node:crypto';
import {githubRepository} from './github-repository.mjs';
import {addedTimestamp} from './added.mjs';

import {DAY, FRONT_PAGE, POOL_SIZE, ROUND_HOURS, STATE_SCHEMA, recommendationDay, recommendationRound, roundTime, cycleDay, validateState} from './recommendation-state.mjs';
export {recommendationDay, recommendationRound, checkRecommendationSnapshot} from './recommendation-state.mjs';

const KEY = 'recommended';
// Smart picks hold these front-page places for plugins the catalog listed in the last ten days.
const NEWCOMER_DAYS = 10;
const NEWCOMER_PLACES = [1, 4, 7];
// At least this share of each weekly pool comes from outside last week's, so the same names cannot simply return.
const FRESH_SHARE = 0.4;
const hash = value => createHash('sha256').update(value).digest().readUInt32BE(0) / 0x100000000;
const nameOrder = (a, b) => a.plugin.name.localeCompare(b.plugin.name, 'en');
const age = (timestamp, now) => Number.isFinite(timestamp) && timestamp <= now ? (now - timestamp) / DAY : Infinity;

/**
 * Blend momentum (maintenance, download and star growth, releases, newness) with trust and reach (verification by
 * other markets, downloads, stars). Momentum carries most of the weight, and repeated developers or categories are
 * pushed down, so small projects that are moving get seen next to established ones.
 */
function candidatesFor(index, {github = {}, signals = {}, added, now = Date.now()} = {}, mode) {
  const candidates = index.plugins.map(plugin => {
    const repo = githubRepository(plugin.repository?.url);
    const record = github.repositories?.[repo?.key];
    const observed = record && ['ok', 'stale'].includes(record.status);
    const published = plugin.versions[0]?.publishTimestamp * 1000;
    const pushed = observed ? Date.parse(record.pushedAt) : NaN;
    const maintained = Number.isFinite(pushed) && pushed <= now ? pushed : published;
    const stars = observed && Number.isSafeInteger(record.stars) && record.stars >= 0 ? record.stars : 0;
    const signal = signals[plugin.name] ?? {};
    const growth = Number.isFinite(signal.growth) ? Math.min(1, Math.max(0, Math.log2(signal.growth) / 2)) : 0;
    const cadence = Math.min(1, (signal.releases30 ?? 0) / 20);
    const fresh = Number.isFinite(signal.ageDays) ? Math.exp(-signal.ageDays / 14) : 0;
    const starGrowth = signal.starsWeek > 0 ? Math.min(1, Math.log1p(signal.starsWeek) / Math.log1p(50)) : 0;
    const reach = Math.log1p(Math.min(signal.downloads ?? 0, 100_000)) / Math.log1p(100_000);
    const verified = signal.verifiedBy?.length ? 1 : signal.listedBy?.length ? 0.5 : 0;
    const listed = addedTimestamp(added, plugin.name) * 1000;
    const archived = Boolean(observed && record.archived === true);
    return {
      plugin,
      developer: repo?.key.split('/')[0] ?? plugin.author?.trim().toLowerCase() ?? plugin.name,
      category: plugin.metadata?.category ?? 'other',
      archived,
      newcomer: !archived && now - listed < NEWCOMER_DAYS * DAY,
      eligible: !archived && (signal.verifiedBy?.length > 0 || (signal.downloads ?? 0) >= 300 || stars >= 5),
      score: mode === 'default'
        ? 0.32 * reach
          + 0.28 * Math.log1p(Math.min(stars, 5000)) / Math.log1p(5000)
          + 0.15 * (plugin.icon ? 1 : 0)
          + 0.1 * verified
          + 0.1 * Math.exp(-age(maintained, now) / 60)
        : 0.25 * Math.exp(-age(maintained, now) / 30)
        + 0.07 * Math.exp(-age(published, now) / 30)
        + 0.12 * growth
        + 0.1 * starGrowth
        + 0.08 * cadence
        + 0.07 * fresh
        + 0.08 * verified
        + 0.1 * reach
        + 0.08 * Math.log1p(Math.min(stars, 5000)) / Math.log1p(5000)
    };
  });
  return candidates;
}

function spread(candidates, mode, value = item => item.score) {
  candidates = [...candidates];
  const developers = new Map(), categories = new Map(), ordered = [];
  const score = item => value(item) - (mode === 'default' ? 0.3 : 0.55) * (developers.get(item.developer) ?? 0) - (mode === 'default' ? 0 : 0.15) * (categories.get(item.category) ?? 0);
  const order = (a, b) => Number(a.archived) - Number(b.archived) || score(b) - score(a) || nameOrder(a, b);
  while (candidates.length) {
    const at = candidates.reduce((best, item, position) => order(item, candidates[best]) < 0 ? position : best, 0);
    const [chosen] = candidates.splice(at, 1);
    ordered.push(chosen);
    developers.set(chosen.developer, (developers.get(chosen.developer) ?? 0) + 1);
    categories.set(chosen.category, (categories.get(chosen.category) ?? 0) + 1);
  }
  return ordered;
}

/** Daily random ranks are independent of quality signals and stable across retries. */
export function recommendIndex(index, options = {}) {
  const ordered = spread(candidatesFor(index, options, 'recommended'), 'recommended').map(item => item.plugin);
  const day = recommendationDay(options.now ?? Date.now());
  const shuffled = [...index.plugins].sort((a, b) => hash('random:' + day + ':' + b.name) - hash('random:' + day + ':' + a.name) || a.name.localeCompare(b.name, 'en'));
  const randomRanks = new Map(shuffled.map((plugin, position) => [plugin.name, shuffled.length - position]));
  return {
    ...index,
    metadata: {...index.metadata, sortKeys: {...index.metadata?.sortKeys, [KEY]: {title: {en: '⊙ Smart picks', zh: '⊙ 智能推荐'}, order: 'desc'}, 'random-resources': {title: {en: '⚄ Random resources', zh: '⚄ 随机资源'}, order: 'desc'}}},
    plugins: ordered.map((plugin, position) => ({...plugin, metadata: {...plugin.metadata, sortKeys: {...plugin.metadata?.sortKeys, [KEY]: ordered.length - position, 'random-resources': randomRanks.get(plugin.name)}}}))
  };
}

/** DSH's default order is the physical index order. */
export function orderByDefault(index, options = {}) {
  return {...index, plugins: spread(candidatesFor(index, options, 'default'), 'default').map(item => item.plugin)};
}

/** Rank within fresh and returning candidates separately, then guarantee the fresh ones their share of the pool. */
function weeklyPool(ranked, lastPool) {
  const returning = new Set(lastPool);
  const fresh = ranked.filter(item => !returning.has(item.plugin.name));
  const reserved = fresh.slice(0, Math.ceil(POOL_SIZE * FRESH_SHARE));
  return [...reserved, ...ranked.filter(item => !reserved.includes(item))].map(item => item.plugin.name);
}

/**
 * The published state owns weekly candidate pools and the last fourteen days of exposure, one front page per round.
 * Only successful published snapshots feed the next build; failed/PR builds never consume a turn.
 */
export function rotateRecommendations(index, {previous, ...options} = {}) {
  const now = options.now ?? Date.now();
  options = {...options, now};
  const round = recommendationRound(now), cycle = cycleDay(now);
  // Exposure recorded per day under an older schema cannot be replayed per round; the first new build starts clean.
  const prior = previous?.schema === STATE_SCHEMA ? previous : undefined;
  if (prior) validateState(prior);
  const history = (prior?.history ?? []).filter(entry => entry.round <= round && roundTime(round) - roundTime(entry.round) < 14 * DAY);
  const state = {schema: STATE_SCHEMA, timeZone: 'Asia/Taipei', round, cycle, pools: {}, history: []};
  const result = recommendIndex(index, options);
  const defaultCandidates = candidatesFor(result, options, 'default');
  const quality = spread(defaultCandidates.filter(item => item.eligible), 'default');
  const byMode = {
    default: defaultCandidates,
    recommended: candidatesFor(result, options, 'recommended')
  };
  const fronts = {}, orders = {};
  for (const mode of ['default', 'recommended']) {
    const byName = new Map(byMode[mode].map(item => [item.plugin.name, item]));
    const shortlist = mode === 'default' ? quality : quality.slice(0, POOL_SIZE * 2).map(item => byName.get(item.plugin.name));
    const luck = mode === 'default' ? 0.4 : 0.8;
    const ranked = spread(shortlist, mode, item => luck * hash(`${cycle}:${mode}:${item.plugin.name}`) + (1 - luck) * item.score);
    const savedPool = prior?.cycle === cycle ? prior.pools[mode] : [];
    const poolNames = [...new Set([...savedPool.filter(name => byName.get(name)?.eligible), ...weeklyPool(ranked, prior?.pools[mode] ?? [])])].slice(0, POOL_SIZE);
    state.pools[mode] = poolNames;
    const pool = poolNames.map(name => byName.get(name));
    const recent = new Map();
    // Start a new mix each Monday, while still keeping Sunday's last picks off Monday's first front page.
    for (const entry of history.filter(entry => entry.round < round && (entry.round >= cycle || roundTime(round) - roundTime(entry.round) <= ROUND_HOURS * 3_600_000))) {
      for (const name of entry[mode]) if (!recent.has(name) || recent.get(name) < entry.round) recent.set(name, entry.round);
    }
    const today = history.find(entry => entry.round === round);
    const isNewcomer = name => mode === 'recommended' && byName.get(name)?.newcomer === true;
    const kept = [...new Set(today?.[mode] ?? [])].filter(name => poolNames.includes(name) || isNewcomer(name)).slice(0, FRONT_PAGE);
    const available = pool.filter(item => !kept.includes(item.plugin.name) && !recent.has(item.plugin.name));
    const pick = items => spread(items, mode, item => 0.8 * hash(`${round}:${mode}:${item.plugin.name}`) + 0.2 * item.score);
    const fresh = pick(available);
    // A small or shrinking pool reuses the oldest exposure only after exhausting unshown entries.
    const cooling = pool.filter(item => !kept.includes(item.plugin.name) && recent.has(item.plugin.name)).sort((a, b) => recent.get(a.plugin.name).localeCompare(recent.get(b.plugin.name)) || nameOrder(a, b));
    const poolSet = new Set(poolNames);
    const outsideCandidates = byMode[mode].filter(item => !poolSet.has(item.plugin.name));
    const outside = mode === 'recommended' ? pick(outsideCandidates) : spread(outsideCandidates, mode);
    // Newcomers bypass the pool, whose bar they cannot clear yet, and each gets one turn per week.
    const seated = kept.filter(isNewcomer).length;
    const invited = pick(byMode[mode].filter(item => isNewcomer(item.plugin.name) && !kept.includes(item.plugin.name) && !recent.has(item.plugin.name))).map(item => item.plugin.name).slice(0, Math.max(0, NEWCOMER_PLACES.length - seated));
    const front = [...kept, ...fresh.map(item => item.plugin.name), ...cooling.map(item => item.plugin.name), ...outside.map(item => item.plugin.name)].filter(name => !invited.includes(name)).slice(0, FRONT_PAGE - invited.length);
    invited.forEach((name, at) => front.splice(Math.min(NEWCOMER_PLACES[seated + at], front.length), 0, name));
    const frontSet = new Set(front);
    const rest = [...kept.map(name => byName.get(name)), ...fresh, ...cooling].filter(item => !frontSet.has(item.plugin.name));
    fronts[mode] = front;
    orders[mode] = [...front.map(name => byName.get(name)), ...rest, ...outside.filter(item => !frontSet.has(item.plugin.name))];
  }
  state.history = [...history.filter(entry => entry.round !== round), {round, ...fronts}].sort((a, b) => a.round.localeCompare(b.round));
  const ranks = new Map(orders.recommended.map((item, position) => [item.plugin.name, index.plugins.length - position]));
  return {
    index: {...result, plugins: orders.default.map(({plugin}) => ({...plugin, metadata: {...plugin.metadata, sortKeys: {...plugin.metadata?.sortKeys, recommended: ranks.get(plugin.name)}}}))},
    recommendations: state
  };
}
