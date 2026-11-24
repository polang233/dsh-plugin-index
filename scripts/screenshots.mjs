import { githubRepository, validPackageDirectory } from './github-repository.mjs';

const MAX_SCREENSHOTS = 6;
const SOURCE_MAX_BYTES = 1024 * 1024;
const CACHE_MS = 24 * 60 * 60 * 1000;
const GITHUB_IMAGE_HOSTS = new Set(['github.com', 'raw.githubusercontent.com', 'user-images.githubusercontent.com', 'private-user-images.githubusercontent.com']);
const rasterImage = /\.(?:png|jpe?g|webp|gif|avif)$/i;
const preview = /screenshot|screen[-_ ]?shot|preview|demo|界面|截图|效果|预览|演示/i;
const decoration = /badge|logo|icon|avatar|banner|border|divider|separator|spacer|sponsor|star[-_ ]?history|徽章|标志|边框|分隔|赞助|二维码/i;
const encodePath = path => path.split('/').map(encodeURIComponent).join('/');

function screenshotUrl(value, base, {githubOnly = false} = {}) {
  if (typeof value !== 'string' || !value.trim() || !URL.canParse(value, base)) return undefined;
  const url = new URL(value, base);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined;
  if (githubOnly && !GITHUB_IMAGE_HOSTS.has(url.hostname)) return undefined;
  if (url.hostname === 'github.com' && /^\/[^/]+\/[^/]+\/(?:blob|raw)\//.test(url.pathname)) {
    url.hostname = 'raw.githubusercontent.com';
    url.pathname = url.pathname.replace(/^(\/[^/]+\/[^/]+)\/(?:blob|raw)\//, '$1/');
    url.search = '';
  }
  if (!rasterImage.test(url.pathname) && !(url.hostname === 'github.com' && url.pathname.startsWith('/user-attachments/assets/'))) return undefined;
  url.hash = '';
  return url.href;
}

function uniqueScreenshots(items) {
  const unique = new Map();
  for (const item of items) {
    if (item && !unique.has(item.url)) unique.set(item.url, item);
    if (unique.size === MAX_SCREENSHOTS) break;
  }
  return [...unique.values()];
}

function listedScreenshots(text, resolve) {
  let list;
  try { list = JSON.parse(text); } catch { return undefined; }
  if (!Array.isArray(list)) return undefined;
  const images = uniqueScreenshots(list.map(item => {
    const url = resolve(typeof item === 'string' ? item : item?.url ?? item?.src);
    if (!url) return undefined;
    const alt = typeof item?.alt === 'string' ? item.alt.trim().slice(0, 200) : '';
    return {url, alt};
  }));
  return images.length ? images : undefined;
}

function rawProjectBase(repo, ref, directory) {
  return `https://raw.githubusercontent.com/${repo.url.slice('https://github.com/'.length)}/${ref}/${directory ? encodePath(directory) + '/' : ''}`;
}

function projectImage(value, base, root, options) {
  if (typeof value !== 'string' || !URL.canParse(value, base)) return undefined;
  const path = value.trim();
  if (URL.canParse(path) || path.startsWith('//')) return screenshotUrl(path, base, options);
  const url = path.startsWith('/') ? new URL(path.slice(1), root) : new URL(path, base);
  return url.href.startsWith(root) ? screenshotUrl(url.href, undefined, options) : undefined;
}

function imageInProject(image, base) {
  if (!image) return false;
  const url = new URL(image);
  const project = new URL(base);
  if (url.origin !== project.origin) return false;
  const path = url.pathname.slice(1).split('/');
  const folder = project.pathname.slice(1).split('/');
  if (path.slice(0, 2).join('/').toLowerCase() !== folder.slice(0, 2).join('/').toLowerCase()) return false;
  const start = path[2] === 'refs' && ['heads', 'tags'].includes(path[3]) ? 5 : 3;
  return path.slice(start).join('/').startsWith(folder.slice(3).join('/'));
}

export const PACKAGE_SCREENSHOTS = 'package/screenshots.json';

/** A relative image from package metadata must be a regular file in the verified archive. */
export function packagePreviews(contents, files, name, version, source, readmePath) {
  const base = source.type === 'git'
    ? rawProjectBase(githubRepository(source.url), source.commit, source.path)
    : `https://cdn.jsdelivr.net/npm/${name}@${encodeURIComponent(version)}/`;
  const resolve = value => {
    if (typeof value !== 'string') return undefined;
    const declared = value.trim();
    if (URL.canParse(declared)) return screenshotUrl(declared);
    const path = declared.replace(/^\.\//, '');
    if (!files.has('package/' + path) || /[\\?#:\x00-\x1f]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) return undefined;
    return screenshotUrl(encodePath(path), base);
  };
  const list = contents.get(PACKAGE_SCREENSHOTS);
  const screenshots = list && listedScreenshots(list.toString('utf8'), resolve);
  if (screenshots) return {screenshots};
  const readme = contents.get(readmePath);
  const fallback = readme && readmeScreenshots(readme.toString('utf8'), resolve);
  return fallback?.length ? {readmeScreenshots: fallback} : {};
}

function readmeScreenshots(markdown, resolve) {
  const source = markdown.replace(/```[^\n]*\n[\s\S]*?```|~~~[^\n]*\n[\s\S]*?~~~|<!--[\s\S]*?-->/g, '');
  const referenceKey = value => value.trim().replace(/\s+/g, ' ').toLowerCase();
  const references = new Map();
  for (const [, key, enclosed, direct] of source.matchAll(/^ {0,3}\[([^\]\n]+)\]:[ \t]*(?:\r?\n[ \t]*)?(?:<([^>\n]+)>|([^\s]+))/gm)) {
    const id = referenceKey(key);
    if (!references.has(id)) references.set(id, enclosed ?? direct);
  }
  const marks = /^#{1,6}\s+([^\n]+)|!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^)]*)?\s*\)|<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>|!\[([^\]\n]*)\](?:\[([^\]\n]*)\])?/gim;
  let heading = '';
  const images = [];
  for (const [tag, title, markdownAlt, enclosed, direct, html, referenceAlt, reference] of source.matchAll(marks)) {
    if (title !== undefined) {
      heading = title;
      continue;
    }
    const value = enclosed ?? direct ?? html ?? references.get(referenceKey(reference || referenceAlt || ''));
    if (!value) continue;
    const alt = markdownAlt ?? referenceAlt ?? /\balt\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
    if (!preview.test(alt + ' ' + value + ' ' + heading) || decoration.test(alt + ' ' + value)) continue;
    const width = Number(/\bwidth\s*=\s*["']?(\d+)/i.exec(tag)?.[1]);
    const height = Number(/\bheight\s*=\s*["']?(\d+)/i.exec(tag)?.[1]);
    if (width < 180 || height < 100 || width / height > 5) continue;
    const url = resolve(value);
    if (url) images.push({url, alt: alt.trim().slice(0, 200)});
  }
  return uniqueScreenshots(images);
}

async function readProjectFile(url, fetchImpl, deadline) {
  const response = await fetchImpl(url, {redirect: 'error', signal: AbortSignal.any([deadline, AbortSignal.timeout(10_000)])});
  if (!response.ok || Number(response.headers.get('content-length')) > SOURCE_MAX_BYTES) {
    await response.body?.cancel();
    if (response.status === 404 || response.ok) return undefined;
    throw Error(`Project preview source HTTP ${response.status}`);
  }
  if (!response.body) return undefined;
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > SOURCE_MAX_BYTES) return undefined;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function projectScreenshots(base, root, fetchImpl, deadline) {
  const list = await readProjectFile(base + 'screenshots.json', fetchImpl, deadline);
  const declared = list === undefined ? undefined : listedScreenshots(list, value => projectImage(value, base, root));
  if (declared) {
    const available = await availableRepositoryImages(declared, fetchImpl, deadline);
    if (available.length) return {screenshots: available, source: 'declared'};
  }
  for (const directory of new Set([base, root, root + '.github/', root + 'docs/'])) {
    const url = directory + 'README.md';
    const readme = await readProjectFile(url, fetchImpl, deadline);
    if (readme !== undefined) {
      const images = readmeScreenshots(readme, value => {
        const image = projectImage(value, url, root, {githubOnly: true});
        // A shared README can describe another plugin in the same repository.
        return base === root || directory === base || imageInProject(image, base) ? image : undefined;
      });
      const available = await availableRepositoryImages(images, fetchImpl, deadline);
      if (available.length) return {screenshots: available, source: 'readme'};
    }
  }
  return {screenshots: []};
}

// HEAD on GitHub's raw file host catches moved files without downloading images.
// Transient responses and attachment redirects are left to the browser.
async function availableRepositoryImages(images, fetchImpl, deadline) {
  const available = [];
  for (const image of images) {
    if (!deadline.aborted && new URL(image.url).origin === 'https://raw.githubusercontent.com') {
      try {
        const response = await fetchImpl(image.url, {
          method: 'HEAD', redirect: 'error', signal: AbortSignal.any([deadline, AbortSignal.timeout(5000)])
        });
        await response.body?.cancel();
        if (response.status === 404 || response.status === 410) continue;
      } catch { /* A timeout cannot establish that the image was removed. */ }
    }
    available.push(image);
  }
  return available;
}

/** Read only small public metadata files, once per repository directory and Git ref. */
export async function collectRepositoryPreviews(index, evidence, curated, previous = {}, {
  fetchImpl = fetch, now = Date.now(), github = {}
} = {}) {
  const packages = new Map((evidence.packages ?? []).map(record => [record.name, record]));
  const targets = new Map();
  for (const plugin of index.plugins) {
    if (curated.plugins[plugin.name]?.screenshots !== undefined || packages.get(plugin.name)?.display?.screenshots?.length) continue;
    const source = plugin.versions[0]?.source;
    const original = githubRepository(plugin.repository?.url ?? source?.url);
    const repo = githubRepository(github.repositories?.[original?.key]?.canonicalUrl) ?? original;
    if (!repo) continue;
    const ref = source?.type === 'git' ? source.commit : 'HEAD';
    const path = source?.path ?? plugin.repository?.directory;
    const directory = validPackageDirectory(path) ? path : undefined;
    const root = rawProjectBase(repo, ref);
    const base = rawProjectBase(repo, ref, directory);
    const target = targets.get(base) ?? {root, names: []};
    target.names.push(plugin.name);
    targets.set(base, target);
  }
  const entries = [...targets];
  const previews = new Map();
  const deadline = AbortSignal.timeout(300_000);
  let next = 0, failed = 0;
  await Promise.all(Array.from({length: Math.min(8, entries.length)}, async () => {
    while (next < entries.length) {
      const [base, {root, names}] = entries[next++];
      const old = names.map(name => previous[name]).find(record => record?.base === base && Array.isArray(record.screenshots));
      const checked = Date.parse(old?.checkedAt);
      let result = old;
      if (!(checked <= now && now - checked < CACHE_MS)) {
        try {
          deadline.throwIfAborted();
          result = {base, checkedAt: new Date(now).toISOString(), ...await projectScreenshots(base, root, fetchImpl, deadline)};
        } catch { failed++; }
      }
      if (result) for (const name of names) previews.set(name, result);
    }
  }));
  return {previews: Object.fromEntries([...previews].sort(([a], [b]) => a.localeCompare(b, 'en'))), failed};
}

/** Site rendering and metadata-only rebuilds use the same source order. */
export function websiteScreenshots(evidence, display) {
  const published = new Map((evidence?.packages ?? []).map(record => [record.name, record.display]));
  return name => {
    const packageDisplay = published.get(name);
    const repository = evidence?.repositoryPreviews?.[name];
    const items = display.plugins?.[name]?.screenshots ?? packageDisplay?.screenshots
      ?? (repository?.source === 'declared' ? repository.screenshots : packageDisplay?.readmeScreenshots)
      ?? repository?.screenshots ?? [];
    return items.flatMap(image => {
      const url = screenshotUrl(image.url);
      return url ? [{url, alt: image.alt}] : [];
    });
  };
}

// Maintainer overrides are public GitHub screenshots selected from author submissions.
export function validateScreenshots(images) {
  if (images === undefined) return undefined;
  if (!Array.isArray(images) || images.length > MAX_SCREENSHOTS) throw Error('Provide at most six plugin screenshots');
  return images.map(image => {
    const url = new URL(image?.url);
    if (url.protocol !== 'https:' || url.username || url.password
      || !['github.com', 'raw.githubusercontent.com', 'user-images.githubusercontent.com', 'private-user-images.githubusercontent.com'].includes(url.hostname)
      || (!/\.(?:png|jpe?g|webp|gif)$/i.test(url.pathname) && !(url.hostname === 'github.com' && url.pathname.startsWith('/user-attachments/assets/')))
      || typeof image.alt !== 'string' || !image.alt.trim() || image.alt.length > 200) throw Error('Screenshot needs a public GitHub image URL and a short caption');
    return {url: url.href, alt: image.alt.trim()};
  });
}

/** Website-only editorial data. It never changes the official plugin index. */
export function applyPluginPreviews(display, previews) {
  if (previews?.schema !== 1 || !previews.plugins || typeof previews.plugins !== 'object' || Array.isArray(previews.plugins)) {
    throw Error('Invalid plugin preview registry');
  }
  const plugins = Object.fromEntries(Object.entries(display.plugins).map(([name, plugin]) => {
    const {screenshots, ...entry} = plugin;
    return [name, entry];
  }));
  for (const [name, entry] of Object.entries(previews.plugins)) {
    if (!/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(name)
      || !entry || typeof entry !== 'object' || Array.isArray(entry)
      || Object.keys(entry).some(key => key !== 'screenshots') || !Array.isArray(entry.screenshots)) {
      throw Error('Invalid plugin previews: ' + name);
    }
    const screenshots = validateScreenshots(entry.screenshots);
    if (plugins[name]) plugins[name] = {...plugins[name], screenshots};
  }
  return {...display, plugins};
}
