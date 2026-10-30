export const DAY = 86_400_000;
export const FRONT_PAGE = 10;
export const CYCLE_DAYS = 7;
// Rounds follow the four scheduled builds; a delayed build simply opens whichever round it lands in.
export const ROUND_HOURS = 6;
export const ROUNDS_PER_DAY = 24 / ROUND_HOURS;
export const POOL_SIZE = FRONT_PAGE * CYCLE_DAYS * ROUNDS_PER_DAY;
export const STATE_SCHEMA = 2;
const OFFSET = 8 * 60 * 60 * 1000;
export const recommendationDay = now => new Date(now + OFFSET).toISOString().slice(0, 10);
export const recommendationRound = now => {
  const local = new Date(now + OFFSET).toISOString();
  return `${local.slice(0, 10)}T${String(Math.floor(Number(local.slice(11, 13)) / ROUND_HOURS) * ROUND_HOURS).padStart(2, '0')}`;
};
export const roundTime = round => Date.parse(`${round}:00:00+08:00`);
const dayNumber = now => Math.floor((now + OFFSET) / DAY);
export const cycleDay = now => recommendationDay(now - ((dayNumber(now) + 3) % CYCLE_DAYS) * DAY);

export function validateState(state) {
  const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
  const names = (value, limit) => Array.isArray(value) && value.length <= limit && value.every(name => typeof name === 'string') && new Set(value).size === value.length;
  const round = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T(00|06|12|18)$/.test(value) && Number.isFinite(roundTime(value));
  if (state?.schema !== STATE_SCHEMA || state.timeZone !== 'Asia/Taipei' || !round(state.round) || !date(state.cycle) || state.cycle > state.round.slice(0, 10) || !Array.isArray(state.history) || state.history.length > 14 * ROUNDS_PER_DAY || new Set(state.history.map(entry => entry.round)).size !== state.history.length) throw new Error('Invalid recommendation history');
  for (const mode of ['default', 'recommended']) {
    if (!names(state.pools?.[mode], POOL_SIZE) || state.history.some(entry => !round(entry.round) || entry.round > state.round || !names(entry[mode], FRONT_PAGE))) throw new Error('Invalid recommendation pool or exposure list: ' + mode);
  }
}

/** Verify that the deployed exposure record describes the actual two front pages. */
export function checkRecommendationSnapshot(index, state) {
  validateState(state);
  const today = state.history.find(entry => entry.round === state.round);
  const actual = {
    default: index.plugins.slice(0, FRONT_PAGE).map(plugin => plugin.name),
    recommended: [...index.plugins].sort((a, b) => b.metadata.sortKeys.recommended - a.metadata.sortKeys.recommended).slice(0, FRONT_PAGE).map(plugin => plugin.name)
  };
  for (const mode of ['default', 'recommended']) {
    if (JSON.stringify(actual[mode]) !== JSON.stringify(today?.[mode])) throw new Error('Recommendation exposure mismatch: ' + mode);
  }
}
