import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index';
import { applyGitHubStars, starsGained } from './github.mjs';
import { githubRepository } from './github-repository.mjs';
import { endorsementsFor } from './endorsements.mjs';
import { LABELS, TIERS } from './labels.mjs';
import { EMPTY_REVIEWS, REVIEW_SOURCE, maintainerReviewFor, validateMaintainerReviews } from './maintainer-reviews.mjs';

export { LABELS };
import { rotateRecommendations } from './recommendations.mjs';

const DAY = 86_400_000;
const measured = value => value && ['ok', 'stale'].includes(value.status);
const count = value => Number.isSafeInteger(value) && value >= 0;
const sortId = 'npm-downloads-month';
const TRENDING = 'trending';
const STARS_WEEK = 'stars-week';

const OWN = new Set(Object.keys(LABELS));
const owned = id => OWN.has(id) || id.startsWith('publisher-') || id.startsWith('metric-');

export function releaseAge(timestamp, now, language) {
  if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp * 1000 > now) return undefined;
  const days = Math.floor((now - timestamp * 1000) / DAY);
  return language === 'zh' ? (days === 0 ? '今天更新' : `${days} 天前更新`) : (days === 0 ? 'Updated today' : `Updated ${days} ${days === 1 ? 'day' : 'days'} ago`);
}

/**
 * Growth compares the last 7 days with the weekly average of the 23 days before them.
 * A floor of 30 weekly downloads keeps one-off spikes on tiny packages out of "Rising".
 */
export function marketSignals(plugin, { npm, releases, repo, endorsements = [], listings = [], maintainerReview, now }) {
  const signals = {};
  if (endorsements.length) signals.verifiedBy = endorsements;
  if (listings.length) signals.listedBy = listings;
  if (maintainerReview) signals.maintainerReview = maintainerReview;
  if (plugin.icon) signals.logo = true;
  if (measured(repo) && count(repo.stars)) {
    signals.stars = repo.stars;
    const gained = starsGained(repo, now);
    if (Number.isSafeInteger(gained)) signals.starsWeek = gained;
  }
  if (measured(npm) && count(npm.downloads)) {
    signals.downloads = npm.downloads;
    if (count(npm.week) && npm.week <= npm.downloads) {
      const before = (npm.downloads - npm.week) / 23 * 7;
      signals.week = npm.week;
      if (npm.week >= 30) signals.growth = Math.round(npm.week / Math.max(before, 7) * 100) / 100;
    }
  }
  const first = Date.parse(releases?.firstPublished);
  if (Number.isFinite(first) && first <= now) signals.ageDays = Math.floor((now - first) / DAY);
  if (count(releases?.last30Days)) signals.releases30 = releases.last30Days;
  if (count(releases?.last90Days)) signals.releases90 = releases.last90Days;
  const published = plugin.versions[0]?.publishTimestamp * 1000;
  if (Number.isFinite(published) && published <= now) signals.updatedDays = Math.floor((now - published) / DAY);
  return signals;
}

export function labelsFor(signals) {
  const labels = [];
  if (signals.verifiedBy?.length) labels.push('verified');
  // Rising: downloads clearly up on the prior weekly average, or a meaningful jump in stars.
  if (signals.growth >= 1.5 || (signals.starsWeek >= 5 && signals.starsWeek >= 0.1 * Math.max(signals.stars - signals.starsWeek, 10))) labels.push('trending');
  // Ten releases in 30 days marks roughly the top third of the catalog; young DSH plugins release often.
  if (signals.releases30 >= 10) labels.push('active');
  const age = [[3, 'recent'], [7, 'week'], [30, 'month'], [90, 'quarter']].find(([days]) => signals.updatedDays <= days);
  if (age) labels.push('updated-' + age[1]);
  const tier = TIERS.find(([floor]) => signals.downloads >= floor);
  if (tier) labels.push('downloads-' + tier[1]);
  return labels;
}

function starText(plugin, github, language) {
  const repo = github.repositories?.[githubRepository(plugin.repository?.url)?.key];
  return measured(repo) && count(repo.stars) ? '★ ' + new Intl.NumberFormat(language === 'zh' ? 'zh-CN' : 'en-US').format(repo.stars) : undefined;
}

function publisherFor(plugin, publishers) {
  const repo = githubRepository(plugin.repository?.url)?.key;
  return publishers.entries.find(entry => entry.packages.includes(plugin.name) && githubRepository(entry.repository)?.key === repo);
}

/** Identity claims bind an exact package to a reviewed repository, never just an npm prefix. */
export function validatePublishers(publishers) {
  const ids = new Set(), names = new Set();
  if (publishers.schema !== 1 || !Array.isArray(publishers.entries)) throw new Error('Invalid publisher evidence');
  for (const entry of publishers.entries) {
    if (!/^[a-z0-9-]+$/.test(entry.id) || ids.has(entry.id) || !['company', 'developer'].includes(entry.kind) || !githubRepository(entry.repository) || !entry.title?.en || !entry.title?.zh || !Number.isFinite(Date.parse(entry.reviewedAt)) || !entry.evidence?.length || !entry.packages?.length) throw new Error('Invalid publisher identity: ' + entry.id);
    ids.add(entry.id);
    for (const url of entry.evidence) if (!URL.canParse(url) || new URL(url).protocol !== 'https:') throw new Error('Invalid publisher source');
    for (const name of entry.packages) {
      if (names.has(name)) throw new Error('Repeated publisher package: ' + name);
      names.add(name);
    }
  }
}

export function applyMarketDisplay(index, { github = {}, downloads = {}, releases = {}, endorsements = {}, publishers = { schema: 1, entries: [] }, maintainerReviews = EMPTY_REVIEWS, packageEvidence = {}, previousRecommendations, added, now = Date.now() } = {}) {
  validatePublishers(publishers);
  validateMaintainerReviews(maintainerReviews);
  const checked = new Map((packageEvidence.packages ?? []).map(record => [record.name, record]));
  const starred = applyGitHubStars(index, github);
  const metadata = { ...starred.metadata, labels: { ...starred.metadata?.labels }, sortKeys: { ...starred.metadata?.sortKeys } };
  for (const id of Object.keys(metadata.labels)) if (owned(id)) delete metadata.labels[id];
  delete metadata.sortKeys[sortId];
  delete metadata.sortKeys[TRENDING];
  delete metadata.sortKeys[STARS_WEEK];
  const display = { schema: 1, generatedAt: new Date(now).toISOString(), plugins: {} };
  const used = new Set();
  let withStarGrowth = 0;
  const plugins = starred.plugins.map(plugin => {
    const labels = (plugin.metadata?.labels ?? []).filter(id => !owned(id));
    const publisher = publisherFor(plugin, publishers);
    if (publisher) {
      const id = 'publisher-' + publisher.id;
      metadata.labels[id] = { title: publisher.title };
      labels.push(id);
    }
    const npm = downloads.packages?.[plugin.name];
    const repo = github.repositories?.[githubRepository(plugin.repository?.url)?.key];
    const maintainerReview = maintainerReviewFor(plugin, maintainerReviews, checked, now);
    const verifiedBy = endorsementsFor(plugin, endorsements, { strict: true });
    if (maintainerReview) verifiedBy.push(REVIEW_SOURCE);
    const signals = marketSignals(plugin, { npm, repo, releases: releases[plugin.name], endorsements: verifiedBy, maintainerReview, listings: endorsementsFor(plugin, endorsements, { strict: false }), now });
    const own = labelsFor(signals);
    for (const id of own) used.add(id);
    labels.push(...own);
    const description = typeof plugin.description === 'string' ? { en: plugin.description, zh: plugin.description } : { ...plugin.description };
    const composed = Object.fromEntries(Object.entries(description).map(([language, value]) => {
      const star = starText(plugin, github, language.startsWith('zh') ? 'zh' : 'en');
      return [language, star ? star + ' │ ' + value : value];
    }));
    // Star-only descriptions still work when the author supplied no description.
    for (const language of ['en', 'zh']) if (!composed[language] && starText(plugin, github, language)) composed[language] = starText(plugin, github, language);
    const sortKeys = { ...plugin.metadata?.sortKeys };
    delete sortKeys[sortId];
    delete sortKeys[TRENDING];
    delete sortKeys[STARS_WEEK];
    if (Number.isSafeInteger(signals.starsWeek)) { sortKeys[STARS_WEEK] = signals.starsWeek; withStarGrowth++; }
    display.plugins[plugin.name] = { description, labels: own, signals, ...(publisher ? { publisher: publisher.id } : {}) };
    return { ...plugin, ...(Object.keys(composed).length ? { description: composed } : {}), metadata: { ...plugin.metadata, labels, sortKeys } };
  });
  for (const id of Object.keys(LABELS)) if (used.has(id)) metadata.labels[id] = { title: LABELS[id] };
  if (withStarGrowth) metadata.sortKeys[STARS_WEEK] = { title: { en: '▲ Recent growth', zh: '▲ 近期增长' }, order: 'desc' };
  const signals = Object.fromEntries(Object.entries(display.plugins).map(([name, value]) => [name, value.signals]));
  const {index: result, recommendations} = rotateRecommendations({ ...starred, metadata, plugins }, { github, signals, added, now, previous: previousRecommendations });
  parseMarketIndex(result, 'https://polang233.github.io/dsh-plugin-index/index.json');
  return { index: result, display, recommendations };
}
