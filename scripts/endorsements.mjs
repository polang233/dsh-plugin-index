import { githubRepository } from './github-repository.mjs';

const MAX_CACHE_AGE = 14 * 86_400_000;

/**
 * Other DSH markets that publish a human or source-level review. A plugin counts as verified there only when the
 * review binds to its repository, or to its exact npm version, never to a bare name.
 */
export const SOURCES = {
  'awesome-dsh': {
    title: 'awesome-deepseek-harness-plugins',
    strict: true,
    url: 'https://raw.githubusercontent.com/walkinglabs/awesome-deepseek-harness-plugins/main/README.md',
    home: 'https://github.com/walkinglabs/awesome-deepseek-harness-plugins',
    parse: parseAwesome
  },
  'dsh-plugin-shop': {
    title: 'dsh-plugin-shop',
    strict: true,
    url: 'https://raw.githubusercontent.com/LivXue/dsh-plugin-shop/main/registry/verified.yml',
    home: 'https://github.com/LivXue/dsh-plugin-shop',
    parse: parseShop
  },
  // A large reviewed list: listing helps the order, but on its own it does not earn the "Verified" label.
  'awesome-dsh-plugin': {
    title: 'awesome-dsh-plugin',
    strict: false,
    url: 'https://raw.githubusercontent.com/awesome-dsh-plugin/awesome-dsh-plugin/main/README.md',
    home: 'https://github.com/awesome-dsh-plugin/awesome-dsh-plugin',
    parse: parseAwesome
  }
};

/** Each list item's first GitHub link is the entry; the curated list only admits source-verified plugins. */
export function parseAwesome(text) {
  const repos = new Set();
  for (const line of text.split('\n')) {
    const match = /^\s*[-*]\s+\[[^\]]*\]\((https:\/\/github\.com\/[^)\s]+)\)/.exec(line);
    const repo = match && githubRepository(match[1].split('/').slice(0, 5).join('/'));
    if (repo) repos.add(repo.key);
  }
  return { repos: [...repos].sort() };
}

/** The shop's verified.yml is a flat list of reviews; a small line reader avoids a YAML dependency. */
export function parseShop(text) {
  const reviews = [];
  let current;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '');
    const item = /^-\s+(\w+):\s*(.+?)\s*$/.exec(line);
    const field = /^\s+(\w+):\s*(.+?)\s*$/.exec(line);
    if (item) reviews.push(current = { [item[1]]: unquote(item[2]) });
    else if (field && current) current[field[1]] = unquote(field[2]);
  }
  return {
    reviews: reviews.filter(review => typeof review.name === 'string').map(review => ({
      name: review.name,
      ...(review.reviewedVersion ? { version: review.reviewedVersion } : {}),
      ...(githubRepository('https://github.com/' + review.repo) ? { repo: githubRepository('https://github.com/' + review.repo).key } : {})
    }))
  };
}
const unquote = value => value.replace(/^(['"])(.*)\1$/, '$2');

export async function collectEndorsements({ fetchImpl = fetch, previous = {}, now = Date.now() } = {}) {
  const timestamp = new Date(now).toISOString();
  const sources = {};
  for (const [id, source] of Object.entries(SOURCES)) {
    try {
      const response = await fetchImpl(source.url, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const text = await response.text();
      if (text.length > 4 * 1024 * 1024) throw new Error('Response too large');
      sources[id] = { status: 'ok', fetchedAt: timestamp, url: source.url, ...source.parse(text) };
    } catch (error) {
      const cached = previous.sources?.[id];
      const age = now - Date.parse(cached?.fetchedAt);
      sources[id] = ['ok', 'stale'].includes(cached?.status) && age >= 0 && age <= MAX_CACHE_AGE
        ? { ...cached, status: 'stale', attemptedAt: timestamp }
        : { status: 'unavailable', url: source.url, attemptedAt: timestamp, error: error.message };
    }
  }
  return { schema: 1, generatedAt: timestamp, sources };
}

/** Source ids that vouch for this plugin's repository or exact version; `strict` keeps only verifying sources. */
export function endorsementsFor(plugin, snapshot, { strict } = {}) {
  const repo = githubRepository(plugin.repository?.url)?.key;
  const version = plugin.versions?.[0]?.version;
  return Object.entries(snapshot?.sources ?? {}).filter(([id, source]) => ['ok', 'stale'].includes(source.status)
    && (strict === undefined || (SOURCES[id]?.strict ?? false) === strict) && (
    (repo && source.repos?.includes(repo))
    || source.reviews?.some(review => review.name === plugin.name && (review.repo ? review.repo === repo : review.version === version))
  )).map(([id]) => id);
}
