import {readFile} from 'node:fs/promises';

// Static files of the optional macaron theme. The Client links theme.css, which loads the artwork relative to itself.
export const THEME_PATH = '/dsh-open-market/theme';
const TYPES = {'.css': 'text/css; charset=utf-8', '.webp': 'image/webp'};
// Only these shipped files are served; the request path never reaches the file system.
export const THEME_FILES = ['theme.css', 'whale-maid-wave.webp', 'whale-maid-tea.webp', 'whale-maid-peek.webp'];
const directory = new URL('./theme/', import.meta.url);

export function createThemeAssetsHandler({files = THEME_FILES, root = directory} = {}) {
  const allowed = new Set(files);
  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405, {Allow: 'GET, HEAD'}).end();
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const file = pathname.startsWith(THEME_PATH + '/') ? pathname.slice(THEME_PATH.length + 1) : '';
    if (!allowed.has(file)) return res.writeHead(404).end();
    let bytes;
    try { bytes = await readFile(new URL(file, root)); }
    catch { return res.writeHead(404).end(); }
    // The files come from the local Host, so revalidating each load is cheap and a plugin update shows right away.
    res.writeHead(200, {'Content-Type': TYPES[file.slice(file.lastIndexOf('.'))], 'Content-Length': bytes.length,
      'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff'});
    res.end(req.method === 'HEAD' ? undefined : bytes);
  };
}
