/** Normalize a public GitHub repository URL without loading the catalog SDK. */
export function githubRepository(value) {
  if (typeof value !== 'string' || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || !['github.com', 'www.github.com'].includes(url.hostname) || url.username || url.password) return undefined;
  const path = url.pathname.replace(/\/$/, '').replace(/\.git$/, '').slice(1);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(path)) return undefined;
  return { key: path.toLowerCase(), url: `https://github.com/${path}` };
}

/** Match the DSH index format's relative Git package directory. */
export function validPackageDirectory(value) {
  return typeof value === 'string' && value.length > 0
    && value.split('/').every(part => /^[A-Za-z0-9._@+-]+$/.test(part) && part !== '.' && part !== '..');
}
