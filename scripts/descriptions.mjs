// Generated star counts belong to the market presentation, never to editorial copy.
const STAR_PREFIX = /^(?:\s*★\s*\d[\d,.\u00a0\u202f ]*\s*(?:[│|｜]\s*|$))+/u;

export function stripStarPrefix(value) {
  return typeof value === 'string' ? value.replace(STAR_PREFIX, '') : value;
}

export function cleanDescription(value) {
  if (typeof value === 'string') return stripStarPrefix(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([language, text]) => [language, stripStarPrefix(text)]));
}
