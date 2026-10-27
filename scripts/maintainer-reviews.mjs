import { githubRepository, validPackageDirectory } from './github-repository.mjs';

export const REVIEW_SOURCE = 'open-plugin-market';
export const EMPTY_REVIEWS = { schema: 1, entries: [] };

/** Maintainer evidence is stored outside package metadata and binds immutable release bytes. */
export function validateMaintainerReviews(reviews) {
  if (reviews?.schema !== 1 || !Array.isArray(reviews.entries)) throw new Error('Invalid maintainer reviews');
  const keys = new Set();
  for (const entry of reviews.entries) {
    const key = `${entry.name}\0${entry.version}\0${entry.source?.type}\0${entry.integrity}`;
    if (typeof entry.name !== 'string' || !entry.name || typeof entry.version !== 'string' || !entry.version
      || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity ?? '') || !githubRepository(entry.repository)
      || !['package', 'static-security'].includes(entry.scope) || !Number.isFinite(Date.parse(entry.reviewedAt))
      || !/^docs\/reviews\/[a-z0-9-]+\.(?:json|md)$/.test(entry.record ?? '')
      || !['npm', 'git'].includes(entry.source?.type)
      || (entry.source.type === 'git' && (!/^[a-f0-9]{40}$/.test(entry.source.commit ?? '') || (entry.source.path !== undefined && !validPackageDirectory(entry.source.path)))) || keys.has(key)) {
      throw new Error('Invalid maintainer review: ' + entry.name);
    }
    keys.add(key);
  }
}

export function maintainerReviewFor(plugin, reviews, packageEvidence, now = Date.now()) {
  const version = plugin.versions?.[0], source = version?.source;
  const repo = githubRepository(plugin.repository?.url)?.key;
  const checked = packageEvidence?.get(plugin.name);
  if (!repo || !checked || checked.version !== version?.version || !checked.checks?.includes('sha512-integrity')) return undefined;
  const matches = reviews.entries.filter(review => review.name === plugin.name && review.version === version.version
    && review.integrity === checked.integrity && githubRepository(review.repository)?.key === repo
    && githubRepository(checked.repository)?.key === repo && Date.parse(review.reviewedAt) <= now
    && review.source.type === source?.type
    && (source.type !== 'git' || (source.commit === review.source.commit && checked.source?.commit === review.source.commit
      && source.path === review.source.path && checked.source?.path === review.source.path
      && githubRepository(source.url)?.key === repo && githubRepository(checked.source?.url)?.key === repo)));
  // A later package-only check does not downgrade a source-security review of the same bytes.
  matches.sort((a, b) => Number(b.scope === 'static-security') - Number(a.scope === 'static-security') || Date.parse(b.reviewedAt) - Date.parse(a.reviewedAt));
  const review = matches[0];
  return review ? { version: review.version, reviewedAt: review.reviewedAt, scope: review.scope, record: `https://github.com/polang233/dsh-plugin-index/blob/main/${review.record}` } : undefined;
}
