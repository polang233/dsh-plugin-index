// Serves the built site from static assets and counts reads of index.json.
// A "read" is one fetch of the index, which DSH makes when Discover loads or refreshes this market.
// Daily unique readers are counted by a salted hash of IP and user agent; neither is stored.
// Each read is also tallied under Cloudflare's country or region code, without anything finer.
// With an analytics token, the country split instead comes from Cloudflare's own request analytics, which reach back
// 30 days; it counts loads (not people) and is sampled, so D1 stays the source for every people count.

const COUNTED = new Set(['/index.json']);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/stats.json') return stats(env, ctx);
    const response = await env.ASSETS.fetch(request);
    const own = request.headers.get('user-agent') === 'dshopen-check';
    if (COUNTED.has(url.pathname) && request.method === 'GET' && response.ok && !own) ctx.waitUntil(count(request, env));
    return response;
  }
};

async function count(request, env) {
  const day = new Date().toISOString().slice(0, 10);
  const visitor = `${request.headers.get('cf-connecting-ip') ?? ''}|${request.headers.get('user-agent') ?? ''}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.STATS_SALT ?? 'dshopen'}|${day}|${visitor}`));
  const hash = [...new Uint8Array(digest).slice(0, 12)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const seen = await env.DB.prepare('INSERT OR IGNORE INTO visitors (day, hash) VALUES (?, ?)').bind(day, hash).run();
  const unique = seen.meta.changes > 0 ? 1 : 0;
  await env.DB.prepare('INSERT INTO reads (day, reads, readers) VALUES (?, 1, ?) ON CONFLICT(day) DO UPDATE SET reads = reads + 1, readers = readers + ?')
    .bind(day, unique, unique).run();
  const country = /^[A-Z]{2}$/.test(request.cf?.country ?? '') ? request.cf.country : 'XX';
  // The country table is newer than the others; a database without it still counts totals.
  try {
    await env.DB.prepare('INSERT INTO countries (day, country, reads, readers) VALUES (?, ?, 1, ?) ON CONFLICT(day, country) DO UPDATE SET reads = reads + 1, readers = readers + ?')
      .bind(day, country, unique, unique).run();
  } catch { /* Table not created yet. */ }
  // Hashes are only needed for the current day; prune older ones now and then.
  if (Math.random() < 0.01) await env.DB.prepare('DELETE FROM visitors WHERE day < ?').bind(day).run();
}

async function stats(env, ctx) {
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  const [total, recent] = await env.DB.batch([
    env.DB.prepare('SELECT COALESCE(SUM(reads), 0) AS reads FROM reads'),
    env.DB.prepare('SELECT day, reads, readers FROM reads WHERE day >= ? ORDER BY day').bind(since)
  ]);
  const days = recent.results;
  const sum = key => days.reduce((value, row) => value + row[key], 0);
  const todayRow = days.find(row => row.day === today) ?? { reads: 0, readers: 0 };
  let countries = { since: null, last30Days: [], today: [] };
  try {
    const [first, month, day] = await env.DB.batch([
      env.DB.prepare('SELECT MIN(day) AS day FROM countries'),
      env.DB.prepare('SELECT country, SUM(reads) AS reads, SUM(readers) AS readers FROM countries WHERE day >= ? GROUP BY country ORDER BY readers DESC, reads DESC').bind(since),
      env.DB.prepare('SELECT country, reads, readers FROM countries WHERE day = ? ORDER BY readers DESC, reads DESC').bind(today)
    ]);
    countries = { source: 'd1', metric: 'readers', since: first.results[0]?.day ?? null, last30Days: month.results, today: day.results };
  } catch { /* Table not created yet. */ }
  countries = (await analyticsCountries(env, ctx)) ?? countries;
  const body = {
    schema: 1,
    note: 'Reads of index.json, made when DSH loads or refreshes this market. Readers are distinct IP and user agent pairs per day.',
    total: total.results[0].reads,
    today: { reads: todayRow.reads, readers: todayRow.readers },
    last30Days: { reads: sum('reads'), readers: sum('readers'), daily: days },
    // Country or region codes (XX: unknown). source "cloudflare": sampled loads from Cloudflare analytics over the last 30 days;
    // source "d1": this Worker's own exact counts of people, kept from `since`.
    countries
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' }
  });
}

const DAY = 86_400_000;
const GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';
// Cloudflare caps adaptive queries at one day, so the 30 days go out as 30 aliased one-day queries in one request.
const COUNTRY_QUERY = days => `query ($zone: String!) { viewer { zones(filter: { zoneTag: $zone }) { ${days.map((day, at) => `d${at}: httpRequestsAdaptiveGroups(limit: 300, filter: { datetime_geq: "${day.start}", datetime_lt: "${day.end}", clientRequestPath: "/index.json", requestSource: "eyeball", edgeResponseStatus: 200 }) { count dimensions { clientCountryName } }`).join(' ')} } } }`;

// Loads of index.json by country over the last 30 days from Cloudflare analytics, cached for an hour.
// Returns undefined without CF_ANALYTICS_TOKEN and CF_ZONE_ID, or when the query fails, so the D1 counts stand.
async function analyticsCountries(env, ctx) {
  if (!env.CF_ANALYTICS_TOKEN || !env.CF_ZONE_ID) return undefined;
  const cache = caches.default;
  const key = new Request('https://dshopen.org/__stats/countries-v1');
  const cached = await cache.match(key);
  if (cached) return cached.json();
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const days = Array.from({ length: 30 }, (_, back) => {
    const start = Date.parse(`${today}T00:00:00Z`) - (29 - back) * DAY;
    return { day: new Date(start).toISOString().slice(0, 10), start: new Date(start).toISOString(), end: new Date(Math.min(start + DAY, now)).toISOString() };
  });
  try {
    const response = await fetch(GRAPHQL, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: COUNTRY_QUERY(days), variables: { zone: env.CF_ZONE_ID } })
    });
    const data = await response.json();
    const zone = data?.data?.viewer?.zones?.[0];
    if (!response.ok || data.errors?.length || !zone) throw new Error(JSON.stringify(data.errors ?? response.status));
    const month = new Map();
    let todayRows = [];
    let since = null;
    days.forEach((day, at) => {
      const rows = (zone[`d${at}`] ?? []).map(row => ({ country: /^[A-Z]{2}$/.test(row.dimensions?.clientCountryName ?? '') ? row.dimensions.clientCountryName : 'XX', reads: row.count }));
      if (rows.length && !since) since = day.day;
      for (const row of rows) month.set(row.country, (month.get(row.country) ?? 0) + row.reads);
      if (day.day === today) todayRows = rows.sort((a, b) => b.reads - a.reads);
    });
    const countries = { source: 'cloudflare', metric: 'reads', since, last30Days: [...month].map(([country, reads]) => ({ country, reads })).sort((a, b) => b.reads - a.reads), today: todayRows };
    ctx.waitUntil(cache.put(key, new Response(JSON.stringify(countries), { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=3600' } })));
    return countries;
  } catch (error) {
    console.error('Cloudflare analytics query failed', String(error).slice(0, 500));
    return undefined;
  }
}
