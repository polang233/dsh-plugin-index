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
