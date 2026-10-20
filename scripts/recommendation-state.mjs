export const DAY = 86_400_000;
export const FRONT_PAGE = 10;
export const CYCLE_DAYS = 7;
export const POOL_SIZE = FRONT_PAGE * CYCLE_DAYS;
const OFFSET = 8 * 60 * 60 * 1000;
export const recommendationDay = now => new Date(now + OFFSET).toISOString().slice(0, 10);
const dayNumber = now => Math.floor((now + OFFSET) / DAY);
export const cycleDay = now => recommendationDay(now - ((dayNumber(now) + 3) % CYCLE_DAYS) * DAY);

export function validateState(state) {
  const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
  const names = (value, limit) => Array.isArray(value) && value.length <= limit && value.every(name => typeof name === 'string') && new Set(value).size === value.length;
  if (state?.schema !== 1 || state.timeZone !== 'Asia/Taipei' || !date(state.day) || !date(state.cycle) || state.cycle > state.day || !Array.isArray(state.history) || state.history.length > 14 || new Set(state.history.map(entry => entry.day)).size !== state.history.length) throw new Error('Invalid recommendation history');
  for (const mode of ['default', 'recommended']) {
    if (!names(state.pools?.[mode], POOL_SIZE) || state.history.some(entry => !date(entry.day) || entry.day > state.day || !names(entry[mode], FRONT_PAGE))) throw new Error('Invalid recommendation pool or exposure list: ' + mode);
  }
}

/** Verify that the deployed exposure record describes the actual two front pages. */
export function checkRecommendationSnapshot(index, state) {
  validateState(state);
  const today = state.history.find(entry => entry.day === state.day);
  const actual = {
    default: index.plugins.slice(0, FRONT_PAGE).map(plugin => plugin.name),
    recommended: [...index.plugins].sort((a, b) => b.metadata.sortKeys.recommended - a.metadata.sortKeys.recommended).slice(0, FRONT_PAGE).map(plugin => plugin.name)
  };
  for (const mode of ['default', 'recommended']) {
    if (JSON.stringify(actual[mode]) !== JSON.stringify(today?.[mode])) throw new Error('Recommendation exposure mismatch: ' + mode);
  }
}

