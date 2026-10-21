import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

// Lists what the six-hourly build cannot fix by itself: pinned entries a newer release has passed,
// Git sources whose repository moved on, and packages the build had to keep or leave out.
// `--issue` keeps one GitHub issue in sync with the report and closes it when nothing is left.

const ISSUE_TITLE = 'Index maintenance: pinned entries and failing packages';
const LONG_FAILURE_DAYS = 7;

const githubHeaders = () => ({ accept: 'application/vnd.github+json', 'user-agent': 'dsh-plugin-index', ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) });

// A dropped connection retries once; an entry that still cannot be read is reported next run instead of crashing this one.
async function json(url, headers = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(30_000) });
      return response.ok ? await response.json() : undefined;
    } catch { /* Retry once. */ }
  }
  return undefined;
}

/** Pinned npm releases behind `latest`, and Git sources whose default branch declares a newer version. */
export async function staleEntries(packages) {
  const stale = [];
  for (const entry of packages.filter(entry => entry.version)) {
    if (entry.source?.type === 'git') {
      const repo = entry.source.url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/)?.[1];
      const head = repo && await json(`https://api.github.com/repos/${repo}/contents/package.json`, githubHeaders());
      const version = head?.content && JSON.parse(Buffer.from(head.content, 'base64').toString('utf8')).version;
      if (version && version !== entry.version) stale.push({ name: entry.name, pinned: entry.version, latest: version, kind: 'git', url: entry.source.url });
      continue;
    }
    const metadata = await json(`https://registry.npmjs.org/${entry.name.replace('/', '%2F')}`, { accept: 'application/vnd.npm.install-v1+json' });
    const latest = metadata?.['dist-tags']?.latest;
    if (latest && latest !== entry.version) {
      stale.push({ name: entry.name, pinned: entry.version, latest, kind: 'npm', reviews: ['iconReview', 'repositoryReview', 'archiveReview'].filter(key => entry[key]) });
    }
  }
  return stale;
}

export function report({ stale, failures, now = Date.now() }) {
  const days = since => Math.floor((now - Date.parse(since)) / 86_400_000);
  const lines = [];
  if (failures.length) {
    lines.push('## Failing packages', '', 'Kept packages still show their last good release; left-out packages are missing from the index until fixed or removed.', '');
    for (const failure of failures) {
      const age = days(failure.since);
      lines.push(`- ${age >= LONG_FAILURE_DAYS ? '**[long]** ' : ''}\`${failure.name}\` ${failure.retained ? `kept at ${failure.version}` : 'left out'}, failing for ${age} day(s): ${failure.error}`);
    }
    lines.push('');
  }
  if (stale.length) {
    lines.push('## Pinned entries behind upstream', '', 'Review each new release or commit, then update the pin in `data/sources.json`.', '');
    for (const item of stale) lines.push(`- \`${item.name}\` (${item.kind}${item.reviews?.length ? `, ${item.reviews.join(', ')}` : ''}): pinned ${item.pinned}, upstream ${item.latest}`);
    lines.push('');
  }
  return lines.join('\n');
}

async function syncIssue(body) {
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo || !process.env.GITHUB_TOKEN) throw new Error('--issue needs GITHUB_REPOSITORY and GITHUB_TOKEN');
  const api = path => `https://api.github.com/repos/${repo}/${path}`;
  const send = async (method, path, payload) => {
    const response = await fetch(api(path), { method, headers: { ...githubHeaders(), 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}`);
    return response.json();
  };
  const open = (await json(api('issues?state=open&per_page=100'), githubHeaders()) ?? []).find(issue => issue.title === ISSUE_TITLE && !issue.pull_request);
  if (body) {
    const text = `${body}\n_Updated by the scheduled build._`;
    if (!open) return console.log(`Opened #${(await send('POST', 'issues', { title: ISSUE_TITLE, body: text })).number}`);
    if (open.body !== text) await send('PATCH', `issues/${open.number}`, { body: text });
    return console.log(`Updated #${open.number}`);
  }
  if (open) {
    await send('POST', `issues/${open.number}/comments`, { body: 'Nothing left to review: every pinned entry is current and no package is failing.' });
    await send('PATCH', `issues/${open.number}`, { state: 'closed' });
    console.log(`Closed #${open.number}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const config = JSON.parse(await readFile(new URL('../data/sources.json', import.meta.url), 'utf8'));
  let status = {};
  try { status = JSON.parse(await readFile(new URL('../public/status.json', import.meta.url), 'utf8')); } catch { /* No local build. */ }
  const stale = await staleEntries(config.packages);
  const failures = status.failures ?? [];
  const body = report({ stale, failures });
  console.log(body || 'Every pinned entry is current and no package is failing.');
  if (process.argv.includes('--issue')) await syncIssue(body);
}
