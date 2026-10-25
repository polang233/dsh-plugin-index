// Serves the built site from static assets and counts reads of index.json.
// A "read" is one fetch of the index, which DSH makes when Discover loads or refreshes this market.
// Daily unique readers are counted by a salted hash of IP and user agent; neither is stored.
// Each read is also tallied under Cloudflare's country or region code, without anything finer.
// With an analytics token, the country split instead comes from Cloudflare's own request analytics, which reach back
// 30 days; it counts loads (not people) and is sampled, so D1 stays the source for every people count.

const COUNTED = new Set(['/index.json']);
const PLUGIN_NAMES = new WeakMap();
const BADGE_LOGO = new WeakMap();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/badge/') && request.method === 'GET') return badge(request, env, url);
    if (url.pathname === '/likes.json' || url.pathname === '/api/like') {
      try {
        if (url.pathname === '/likes.json' && request.method === 'GET') return await edgeCached(request, ctx, 60, () => likes(env));
        if (url.pathname === '/api/like') {
          if (request.method === 'OPTIONS') return new Response(null, {
            status: 204,
            headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type' }
          });
          if (request.method === 'POST') return await like(request, env);
        }
        return likeJson({ error: 'method-not-allowed' }, 405);
      } catch {
        return likeJson({ error: 'internal-error' }, 500);
      }
    }
    if (url.pathname === '/stats.json') return edgeCached(request, ctx, 300, () => stats(env, ctx));
    if (url.pathname === '/api/stars' && request.method === 'GET') return edgeCached(request, ctx, 3600, () => repositoryStars(env));
    const response = await env.ASSETS.fetch(request);
    const own = request.headers.get('user-agent') === 'dshopen-check';
    if (COUNTED.has(url.pathname) && request.method === 'GET' && response.ok && !own) ctx.waitUntil(count(request, env));
    return response;
  }
};

async function count(request, env) {
  const day = new Date().toISOString().slice(0, 10);
  const hash = await visitorHash(request, env, day);
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

async function visitorHash(request, env, day) {
  const visitor = `${request.headers.get('cf-connecting-ip') ?? ''}|${request.headers.get('user-agent') ?? ''}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${env.STATS_SALT ?? 'dshopen'}|${day}|${visitor}`));
  return [...new Uint8Array(digest).slice(0, 12)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function pluginNames(request, env, now) {
  let cached = PLUGIN_NAMES.get(env.ASSETS);
  if (!cached || cached.expires <= now) {
    const names = (async () => {
      const response = await env.ASSETS.fetch(new Request(new URL('/index.json', request.url)));
      if (!response.ok) throw new Error('Index unavailable');
      const index = await response.json();
      return new Set(index.plugins.map(plugin => plugin.name));
    })();
    cached = { names, expires: now + 5 * 60_000 };
    PLUGIN_NAMES.set(env.ASSETS, cached);
  }
  try {
    return await cached.names;
  } catch (error) {
    if (PLUGIN_NAMES.get(env.ASSETS) === cached) PLUGIN_NAMES.delete(env.ASSETS);
    throw error;
  }
}

function likeJson(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store', ...headers }
  });
}

function effectiveLikes(row, day) {
  const cycles = Math.max(0, Math.floor((Date.parse(day) - Date.parse(row.decayed_at)) / (3 * DAY)));
  return Math.max(0, row.count - cycles);
}

function validPluginName(name) {
  return typeof name === 'string' && name.length <= 214 && /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(name);
}

// The badge logo is the mascot's face; shields.io takes it as SVG, so the PNG is wrapped in one.
async function badgeLogo(request, env, now) {
  let cached = BADGE_LOGO.get(env.ASSETS);
  if (!cached || cached.expires <= now) {
    const svg = (async () => {
      const response = await env.ASSETS.fetch(new Request(new URL('/assets/badge-logo.png', request.url)));
      if (!response.ok) throw new Error('Badge logo unavailable');
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return `<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42"><image width="42" height="42" href="data:image/png;base64,${btoa(binary)}"/></svg>`;
    })();
    cached = { svg, expires: now + 60 * 60_000 };
    BADGE_LOGO.set(env.ASSETS, cached);
  }
  try {
    return await cached.svg;
  } catch {
    // A badge without the logo is still a badge.
    if (BADGE_LOGO.get(env.ASSETS) === cached) BADGE_LOGO.delete(env.ASSETS);
    return undefined;
  }
}

function badgeNumber(value, english) {
  const unit = english ? (value >= 1_000_000 ? [1_000_000, 'M'] : [1_000, 'k']) : [10_000, '万'];
  return value < unit[0] ? String(value) : (value / unit[0]).toFixed(1).replace(/\.0$/, '') + unit[1];
}

async function badge(request, env, url) {
  const english = url.searchParams.get('lang') === 'en';
  const now = Date.now();
  const logoSvg = await badgeLogo(request, env, now);
  const reply = (message, color = '2563eb', cacheSeconds = 1800) => likeJson({
    schemaVersion: 1, label: english ? 'Open Plugin Market' : '开放插件市场', message, color, cacheSeconds, ...(logoSvg ? { logoSvg } : {})
  }, 200, { 'cache-control': 'public, max-age=1800' });
  const notListed = () => reply(english ? 'not listed' : '未收录', 'lightgrey');
  let name;
  try {
    if (!url.pathname.endsWith('.json')) return notListed();
    name = decodeURIComponent(url.pathname.slice('/badge/'.length, -'.json'.length));
  } catch {
    return notListed();
  }
  if (!validPluginName(name)) return notListed();
  try {
    if (!(await pluginNames(request, env, now)).has(name)) return notListed();
    const rows = await env.DB.prepare('SELECT count, decayed_at FROM likes WHERE name = ?').bind(name).all();
    const row = rows.results[0];
    const count = row ? effectiveLikes(row, new Date(now).toISOString().slice(0, 10)) : 0;
    return reply(`${english ? 'listed' : '已收录'} · ♥ ${badgeNumber(count, english)}`);
  } catch {
    return reply(english ? 'unavailable' : '暂不可用', 'lightgrey', 300);
  }
}

/**
 * Serve a computed JSON response from the edge cache, refreshing it in the background once it is older than
 * `fresh` seconds. A cold Worker and D1 can take several seconds, longer than shields.io and the plugin wait.
 */
async function edgeCached(request, ctx, fresh, produce) {
  if (typeof caches === 'undefined' || !ctx?.waitUntil) return produce();
  const cache = caches.default;
  const key = new Request(new URL(new URL(request.url).pathname, request.url));
  const store = async response => {
    const copy = new Response(response.body, response);
    copy.headers.set('cache-control', 'public, max-age=86400');
    copy.headers.set('x-stored-at', String(Date.now()));
    await cache.put(key, copy);
  };
  const hit = await cache.match(key);
  if (hit) {
    if (Date.now() - Number(hit.headers.get('x-stored-at')) > fresh * 1000) {
      ctx.waitUntil(produce().then(response => response.ok ? store(response) : undefined).catch(() => {}));
    }
    const response = new Response(hit.body, hit);
    response.headers.set('cache-control', `public, max-age=${fresh}`);
    response.headers.delete('x-stored-at');
    return response;
  }
  const response = await produce();
  if (response.ok) ctx.waitUntil(store(response.clone()).catch(() => {}));
  return response;
}

// The site's GitHub link shows the project's star count; one GitHub request an hour serves every visitor.
async function repositoryStars(env) {
  try {
    const response = await fetch('https://api.github.com/repos/polang233/dsh-plugin-index', {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'dshopen.org', ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}) }
    });
    const repository = response.ok ? await response.json() : undefined;
    if (!Number.isSafeInteger(repository?.stargazers_count)) return likeJson({ error: 'unavailable' }, 502);
    return likeJson({ stars: repository.stargazers_count, fetchedAt: new Date().toISOString() }, 200, { 'cache-control': 'public, max-age=3600' });
  } catch {
    return likeJson({ error: 'unavailable' }, 502);
  }
}

async function likes(env) {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const rows = await env.DB.prepare('SELECT name, count, decayed_at FROM likes WHERE count > 0').all();
  return likeJson({
    schema: 1,
    generatedAt: now.toISOString(),
    rule: 'Each person can like each plugin once per UTC day (including installs), up to 100 plugins daily; likes lose one every three days, stopping at zero.',
    likes: Object.fromEntries(rows.results.map(row => [row.name, effectiveLikes(row, day)]).filter(([, value]) => value > 0))
  }, 200, { 'cache-control': 'public, max-age=60' });
}

async function like(request, env) {
  const body = await request.json();
  const name = body?.name;
  if (!validPluginName(name)) {
    return likeJson({ error: 'unknown-plugin' }, 400);
  }
  const now = Date.now();
  if (!(await pluginNames(request, env, now)).has(name)) return likeJson({ error: 'unknown-plugin' }, 400);
  if (body.source !== 'like' && body.source !== 'install') return likeJson({ error: 'invalid-source' }, 400);
  const day = new Date(now).toISOString().slice(0, 10);
  const hash = await visitorHash(request, env, day);
  // D1 batches are transactions: only an inserted vote can increment the total.
  const cycles = 'MAX(0, CAST((julianday(excluded.decayed_at) - julianday(likes.decayed_at)) / 3 AS INTEGER))';
  const [vote, , total, seen] = await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO like_votes (day, name, hash) SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM like_votes WHERE day = ? AND hash = ?) < 100')
      .bind(day, name, hash, day, hash),
    env.DB.prepare(`INSERT INTO likes (name, count, decayed_at) SELECT ?, 1, ? WHERE changes() > 0
      ON CONFLICT(name) DO UPDATE SET
        count = MAX(0, likes.count - ${cycles}) + 1,
        decayed_at = CASE WHEN likes.count - ${cycles} <= 0 THEN excluded.decayed_at
          ELSE date(likes.decayed_at, '+' || (3 * ${cycles}) || ' days') END`)
      .bind(name, day),
    env.DB.prepare('SELECT count, decayed_at FROM likes WHERE name = ?').bind(name),
    env.DB.prepare('SELECT 1 FROM like_votes WHERE day = ? AND name = ? AND hash = ?').bind(day, name, hash)
  ]);
  if (!seen.results.length) return likeJson({ error: 'daily-limit' }, 429);
  if (Math.random() < 0.01) await env.DB.prepare('DELETE FROM like_votes WHERE day < ?').bind(day).run();
  return likeJson({ name, likes: effectiveLikes(total.results[0], day), counted: vote.meta.changes > 0 });
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
