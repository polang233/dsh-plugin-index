/** First day each package appeared in the catalog. Builds carry earlier dates forward, so "Recently added" survives rebuilds. */
export function trackAdded(names, previous, now = Date.now()) {
  const known = previous?.schema === 1 && previous.packages ? previous.packages : {};
  const today = new Date(now).toISOString().slice(0, 10);
  return { schema: 1, packages: Object.fromEntries(names.map(name => [name, /^\d{4}-\d{2}-\d{2}$/.test(known[name]) ? known[name] : today]).sort(([a], [b]) => a.localeCompare(b))) };
}

/** Seconds since the epoch for a recorded day, or undefined when the package has no record. */
export function addedTimestamp(added, name) {
  const day = added?.packages?.[name];
  const time = typeof day === 'string' ? Date.parse(`${day}T00:00:00Z`) : NaN;
  return Number.isFinite(time) ? time / 1000 : undefined;
}
