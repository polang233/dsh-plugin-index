// Maintainers choose these URLs from author submissions; README guesses are a client fallback.
export function validateScreenshots(images) {
  if (images === undefined) return undefined;
  if (!Array.isArray(images) || images.length > 6) throw Error('Provide at most six plugin screenshots');
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
