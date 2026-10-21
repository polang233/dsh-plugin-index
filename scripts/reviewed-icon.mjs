import { createHash } from 'node:crypto';
import { packageDisplay, MAX_ICON_BYTES } from './package-display.mjs';

const REVIEW_KEYS = new Set(['version', 'integrity', 'commit', 'path', 'sha256', 'normalization']);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/**
 * A reviewed exception stays bound to immutable artwork in the package's declared upstream.
 * Without `version` and `integrity` the review follows npm `latest`: every build re-checks that the
 * current release still declares the same GitHub repository, and the artwork hash pins the image itself.
 */
export function reviewedIconSource(input, { version, integrity, repository } = {}) {
  const review = input.iconReview;
  if (review === undefined) return undefined;
  if (!review || typeof review !== 'object' || Array.isArray(review) || Object.keys(review).some(key => !REVIEW_KEYS.has(key))) {
    throw new Error('Icon review contains unsupported fields');
  }
  const followsLatest = review.version === undefined && review.integrity === undefined;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version) || typeof integrity !== 'string' || !integrity.split(/\s+/).some(hash => /^sha512-[A-Za-z0-9+/]{86}==$/.test(hash))
    || (!followsLatest && (input.version !== version || review.version !== version || review.integrity !== integrity))) {
    throw new Error('Icon review must match the pinned package version and SHA-512 integrity');
  }
  if (typeof review.commit !== 'string' || !/^[0-9a-f]{40}$/.test(review.commit)) throw new Error('Icon review requires an immutable commit');
  if (typeof review.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(review.sha256)) throw new Error('Icon review requires the original artwork SHA-256');
  if (typeof review.path !== 'string' || review.path.length > 1024 || /[\\%?#:\u0000-\u001f\u007f]/.test(review.path) || review.path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('Icon review requires a relative repository artwork path');
  }
  if (!/\.(?:svg|png|jpe?g|webp)$/i.test(review.path)) throw new Error('Icon review requires a supported image format');
  if (review.normalization !== undefined && review.normalization !== 'remove-xml-comments') throw new Error('Unsupported icon review normalization');
  if (review.normalization && !/\.svg$/i.test(review.path)) throw new Error('XML comment normalization requires SVG artwork');
  if (!repository?.url || !URL.canParse(repository.url)) throw new Error('Icon review requires the published GitHub repository');
  const repositoryUrl = new URL(repository.url);
  const match = repositoryUrl.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/?$/);
  if (repositoryUrl.protocol !== 'https:' || repositoryUrl.hostname !== 'github.com' || repositoryUrl.port || repositoryUrl.username || repositoryUrl.password || repositoryUrl.search || repositoryUrl.hash || !match) {
    throw new Error('Icon review requires the published GitHub repository');
  }
  const sourceUrl = `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${review.commit}/${review.path.split('/').map(encodeURIComponent).join('/')}`;
  return { sourceUrl, review: { version, integrity, commit: review.commit, path: review.path, sha256: review.sha256, ...(review.normalization ? { normalization: review.normalization } : {}) } };
}

/** Only this boundary can fetch source artwork; the npm downloader keeps its existing allowlist. */
export async function reviewedIcon(input, { version, integrity, repository, fetchImpl = fetch } = {}) {
  const source = reviewedIconSource(input, { version, integrity, repository });
  if (!source) return undefined;
  const response = await fetchImpl(source.sourceUrl, {
    redirect: 'error', signal: AbortSignal.timeout(30_000),
    headers: { 'user-agent': 'dsh-plugin-index/0.1 (+https://github.com/polang233/dsh-plugin-index)' }
  });
  if (!response.ok || !response.body || response.redirected || response.url && response.url !== source.sourceUrl) {
    await response.body?.cancel();
    throw new Error(`Reviewed icon request failed or redirected: HTTP ${response.status}`);
  }
  const declaredBytes = response.headers.get('content-length');
  if (declaredBytes !== null && (!/^\d+$/.test(declaredBytes) || Number(declaredBytes) > MAX_ICON_BYTES)) {
    await response.body.cancel();
    throw new Error('Reviewed icon must be between 1 byte and 256 KiB');
  }
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > MAX_ICON_BYTES) throw new Error('Reviewed icon must be between 1 byte and 256 KiB');
    chunks.push(chunk);
  }
  const original = Buffer.concat(chunks);
  if (!original.length) throw new Error('Reviewed icon must be between 1 byte and 256 KiB');
  if (digest(original) !== source.review.sha256) throw new Error('Reviewed icon original SHA-256 does not match');
  let bytes = original;
  if (source.review.normalization === 'remove-xml-comments') {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(original);
    const normalized = text.replace(/<!--[\s\S]*?-->/g, '');
    if (/<!--|-->/.test(normalized)) throw new Error('Reviewed SVG contains an incomplete XML comment');
    bytes = Buffer.from(normalized);
  }
  if (/\.svg$/i.test(source.review.path)) {
    const svg = bytes.toString('utf8').replace(/<!--[\s\S]*?-->/g, '');
    for (const match of svg.matchAll(/\s(?:href|xlink:href)\s*=\s*([^\s>]+)/gi)) {
      if (!/^['"]/.test(match[1])) throw new Error('Reviewed SVG resource references must be quoted');
    }
  }
  const iconPath = `package/${source.review.path}`;
  const display = packageDisplay({}, { icon: iconPath, iconDeclared: true, locales: {} }, new Map([[iconPath, bytes]]));
  if (!display.asset) throw new Error(`Reviewed icon is invalid: ${display.evidence.warnings.map(warning => warning.reason).join('; ')}`);
  return {
    icon: display.icon, asset: display.asset,
    evidence: { ...display.evidence.icon, source: 'reviewed-repository', sourceUrl: source.sourceUrl, originalSha256: source.review.sha256, originalBytes: original.length, review: source.review }
  };
}
