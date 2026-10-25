import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index';

const DAY = 24 * 60 * 60 * 1000;
const MAX_CACHE_AGE = 7 * DAY;
const HISTORY_DAYS = 35;
const SORT_KEY = 'github-stars';

export function githubRepository(value) {
  if (typeof value !== 'string' || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || !['github.com', 'www.github.com'].includes(url.hostname) || url.username || url.password) return undefined;
  const path = url.pathname.replace(/\/$/, '').replace(/\.git$/, '').slice(1);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(path)) return undefined;
  return { key: path.toLowerCase(), url: `https://github.com/${path}` };
}

function validStars(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function cachedEntry(value, repo, now) {
  if (!value || !['ok', 'stale'].includes(value.status) || !validStars(value.stars)) return undefined;
  const fetchedAt = Date.parse(value.fetchedAt);
  if (!Number.isFinite(fetchedAt) || fetchedAt > now || now - fetchedAt > MAX_CACHE_AGE) return undefined;
  if (githubRepository(value.url)?.key !== repo.key) return undefined;
  return {
    url: value.url, stars: value.stars, fetchedAt: value.fetchedAt,
    ...(typeof value.pushedAt === 'string' ? { pushedAt: value.pushedAt } : {}),
    ...(typeof value.archived === 'boolean' ? { archived: value.archived } : {})
  };
}

async function fetchRepository(repo, { fetchImpl, token, timestamp }) {
  const headers = {
    accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28',
    'user-agent': 'dsh-plugin-index (+https://github.com/polang233/dsh-plugin-index)'
  };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetchImpl(`https://api.github.com/repos/${repo.key}`, {
    headers, redirect: 'error', signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) {
    await response.body?.cancel();
    return { error: `HTTP ${response.status}` };
  }
  // Repository metadata is small. Do not publish an unbounded or unexpected response.
  let body = '';
  for await (const chunk of response.body) {
    body += Buffer.from(chunk).toString('utf8');
    if (body.length > 512 * 1024) return { error: 'Response too large' };
  }
  const data = JSON.parse(body);
  const actual = githubRepository(data.html_url);
  if (actual?.key !== repo.key || typeof data.full_name !== 'string' || data.full_name.toLowerCase() !== repo.key || !validStars(data.stargazers_count)) {
    return { error: 'Invalid repository metadata' };
  }
  return {
    url: actual.url, status: 'ok', stars: data.stargazers_count, fetchedAt: timestamp,
    ...(typeof data.pushed_at === 'string' && Number.isFinite(Date.parse(data.pushed_at)) ? { pushedAt: data.pushed_at } : {}),
    archived: data.archived === true
  };
}

/** Read each unique GitHub repository once; failures never become a fabricated zero. */
export async function collectGitHub(index, {
  fetchImpl = fetch,
  token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
  previous = {}, now = Date.now(), concurrency = 4
} = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('GitHub concurrency must be between 1 and 8');
  const repos = new Map();
  for (const plugin of index.plugins) {
    const repo = githubRepository(plugin.repository?.url);
    if (repo) repos.set(repo.key, repo);
  }
  const entries = [...repos.values()].sort((a, b) => a.key.localeCompare(b.key));
  const timestamp = new Date(now).toISOString();
  const repositories = {};
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
    while (next < entries.length) {
      const repo = entries[next++];
      let result;
      try { result = await fetchRepository(repo, { fetchImpl, token, timestamp }); }
      catch { result = { error: 'GitHub request failed' }; }
      if (result.error) {
        const cached = cachedEntry(previous.repositories?.[repo.key], repo, now);
        repositories[repo.key] = cached
          ? { ...cached, status: 'stale', attemptedAt: timestamp, error: result.error }
          : { url: repo.url, status: 'unavailable', attemptedAt: timestamp, error: result.error };
      } else repositories[repo.key] = result;
    }
  }));
  for (const repo of entries) {
    const history = starHistory(previous.repositories?.[repo.key]?.history, repositories[repo.key], now);
    if (history.length) repositories[repo.key].history = history;
  }
  return { schema: 1, generatedAt: timestamp, repositories: Object.fromEntries(entries.map(repo => [repo.key, repositories[repo.key]])) };
}

/** One [date, stars] point per day for the last five weeks; star growth needs this, GitHub has no cheap history API. */
export function starHistory(previous, record, now) {
  const cutoff = new Date(now - HISTORY_DAYS * DAY).toISOString().slice(0, 10);
  const points = new Map((Array.isArray(previous) ? previous : [])
    .filter(point => Array.isArray(point) && /^\d{4}-\d{2}-\d{2}$/.test(point[0]) && validStars(point[1]) && point[0] >= cutoff)
    .map(point => [point[0], point[1]]));
  if (record?.status === 'ok' && validStars(record.stars)) points.set(new Date(now).toISOString().slice(0, 10), record.stars);
  return [...points].sort((a, b) => a[0] < b[0] ? -1 : 1);
}

/** Stars gained over about a week, from the history point closest to seven days ago (at least six). */
export function starsGained(record, now) {
  if (!record || !validStars(record.stars) || !Array.isArray(record.history)) return undefined;
  const target = now - 7 * DAY;
  let best;
  for (const [date, stars] of record.history) {
    const time = Date.parse(date + 'T00:00:00Z');
    if (now - time < 6 * DAY) continue;
    if (!best || Math.abs(time - target) < Math.abs(best.time - target)) best = { time, stars };
  }
  return best ? record.stars - best.stars : undefined;
}

/** The last deployed snapshot, used when the CI cache is empty so histories survive. */
export async function publishedSnapshot(name, { fetchImpl = fetch, base = 'https://polang233.github.io/dsh-plugin-index/' } = {}) {
  try {
    const response = await fetchImpl(new URL(name, base), { redirect: 'error', signal: AbortSignal.timeout(20_000) });
    return response.ok ? await response.json() : undefined;
  } catch { return undefined; }
}

/** Add only measured counts to the official index's supported numeric sort keys. */
export function applyGitHubStars(index, snapshot) {
  const metadata = { ...index.metadata, sortKeys: { ...index.metadata?.sortKeys } };
  delete metadata.sortKeys[SORT_KEY];
  let measured = 0;
  const plugins = index.plugins.map(plugin => {
    const sortKeys = { ...plugin.metadata?.sortKeys };
    delete sortKeys[SORT_KEY];
    const key = githubRepository(plugin.repository?.url)?.key;
    const repo = key ? snapshot.repositories?.[key] : undefined;
    if (repo && ['ok', 'stale'].includes(repo.status) && validStars(repo.stars)) {
      sortKeys[SORT_KEY] = repo.stars;
      measured++;
    }
    return { ...plugin, metadata: { ...plugin.metadata, sortKeys } };
  });
  if (measured) metadata.sortKeys[SORT_KEY] = { title: { en: 'GitHub stars', zh: 'GitHub 星标数' }, order: 'desc' };
  const result = { ...index, metadata, plugins };
  parseMarketIndex(result, 'https://polang233.github.io/dsh-plugin-index/index.json');
  return result;
}

/**
 * When each star of one repository arrived, as [day, stars by the end of that day] pairs, for the stats page's trend.
 * GitHub gives star dates only to authenticated requests, and the Actions token may not list stargazers over REST, so
 * this reads them through GraphQL, a hundred at a time, oldest first. On any failure the previous history stays.
 */
export async function collectStarHistory(key, { fetchImpl = fetch, token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN, previous } = {}) {
  const kept = Array.isArray(previous?.history) ? previous : undefined;
  if (!token) return kept;
  const [owner, name] = key.split('/');
  try {
    const days = [];
    let after = null;
    for (let page = 0; page < 50; page++) {
      const response = await fetchImpl('https://api.github.com/graphql', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'dsh-plugin-index' },
        body: JSON.stringify({
          query: 'query($owner: String!, $name: String!, $after: String) { repository(owner: $owner, name: $name) { stargazers(first: 100, after: $after, orderBy: { field: STARRED_AT, direction: ASC }) { edges { starredAt } pageInfo { hasNextPage endCursor } } } }',
          variables: { owner, name, after }
        })
      });
      if (!response.ok) throw new Error(`GitHub ${response.status} ${(await response.text()).slice(0, 160)}`);
      const { data, errors } = await response.json();
      if (errors?.length) throw new Error(errors.map(error => error.message).join('; ').slice(0, 160));
      const stargazers = data?.repository?.stargazers;
      if (!stargazers) throw new Error('No stargazers in the answer');
      days.push(...stargazers.edges.map(edge => String(edge?.starredAt ?? '').slice(0, 10)).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day)));
      if (!stargazers.pageInfo?.hasNextPage) break;
      after = stargazers.pageInfo.endCursor;
    }
    const totals = new Map();
    days.sort().forEach((day, at) => totals.set(day, at + 1));
    return { schema: 1, repository: key, generatedAt: new Date().toISOString(), history: [...totals] };
  } catch (error) {
    console.warn(`::warning title=Star history unavailable::${key}: ${error.message}`);
    return kept;
  }
}
