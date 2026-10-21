// Remember an explicit language choice so the English page stops sending Chinese browsers to /zh/.
for (const link of document.querySelectorAll('[data-lang]')) {
  link.addEventListener('click', event => {
    try { localStorage.setItem('opm-lang', link.dataset.lang); } catch { /* Private mode. */ }
    if (event.metaKey || event.ctrlKey || event.shiftKey || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Let the pill slide and the page fade before navigating.
    event.preventDefault();
    link.closest('.languages')?.setAttribute('data-current', link.dataset.lang);
    document.body.classList.add('is-leaving');
    setTimeout(() => { location.href = link.href; }, 260);
  });
}

const copyButton = document.querySelector('[data-copy]');
const indexInput = document.querySelector('#index-url');
const copyStatus = document.querySelector('#copy-status');
const text = JSON.parse(document.querySelector('#site-messages').textContent);
let flashTimer;
const flash = error => {
  copyStatus.classList.toggle('is-error', error);
  copyStatus.classList.add('is-shown');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { copyStatus.classList.remove('is-shown'); copyButton.querySelector('span').textContent = text.copy; }, error ? 5000 : 2600);
};

if (copyButton && indexInput) {
  copyButton.hidden = false;
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(indexInput.value);
      copyButton.querySelector('span').textContent = text.copied;
      copyStatus.textContent = text.copySuccess; flash(false);
    } catch {
      copyButton.querySelector('span').textContent = text.copy;
      indexInput.focus();
      indexInput.select();
      indexInput.setSelectionRange(0, indexInput.value.length);
      copyStatus.textContent = text.copyFailure; flash(true);
    }
  };
  copyButton.addEventListener('click', copy);
  indexInput.addEventListener('click', () => { indexInput.select(); copy(); });
}

const PAGE_SIZE = 24;
const controls = document.querySelector('[data-filters]');
const search = document.querySelector('#plugin-search');
const chips = [...document.querySelectorAll('[data-chip]')];
const rows = [...document.querySelectorAll('[data-plugin]')];
const count = document.querySelector('#result-count');
const empty = document.querySelector('#empty-results');
const reset = document.querySelector('[data-reset]');
const moreWrap = document.querySelector('[data-more-wrap]');
const moreButton = document.querySelector('[data-more]');
const progress = document.querySelector('[data-progress]');
const bar = document.querySelector('[data-bar]');
const list = document.querySelector('.plugin-list');
const sortChips = [...document.querySelectorAll('[data-sort]')];
const normalize = value => value.normalize('NFKC').toLocaleLowerCase().trim();
const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => values[key]);

let category = '';
let limit = PAGE_SIZE;
let matches = rows;
let ordered = rows;

// Masonry: each card spans as many 4px rows as its height needs, so short cards no longer leave gaps.
const masonry = () => {
  if (!list) return;
  const unit = parseFloat(getComputedStyle(list).gridAutoRows) || 4;
  const gap = rows.length ? parseFloat(getComputedStyle(rows[0]).paddingBottom) || 0 : 0;
  // Read every height first, then write, so the browser lays out once instead of once per card.
  const shown = rows.filter(row => !row.hidden);
  // offsetHeight ignores the hover lift and scale, so hovering never reflows the grid.
  const spans = shown.map(row => Math.ceil((row.firstElementChild.offsetHeight + gap) / unit));
  shown.forEach((row, at) => { const value = `span ${spans[at]}`; if (row.style.gridRowEnd !== value) row.style.gridRowEnd = value; });
};
if ('ResizeObserver' in window && list) {
  let queued = false;
  const watch = new ResizeObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; masonry(); }); } });
  rows.forEach(row => watch.observe(row.firstElementChild));
}

// Show the first `limit` matches; the rest stay hidden until the reader asks for more.
function render() {
  matches.forEach((row, at) => { row.hidden = at >= limit; });
  const shown = Math.min(limit, matches.length);
  count.textContent = fill(text.results, { count: matches.length, total: rows.length });
  empty.hidden = matches.length > 0;
  moreWrap.hidden = matches.length <= shown;
  if (!moreWrap.hidden) {
    progress.textContent = fill(text.shown, { shown, count: matches.length });
    bar.style.width = `${Math.round(shown / matches.length * 100)}%`;
    moreButton.textContent = text.more;
  }
  masonry();
}

function filter() {
  const terms = normalize(search.value).split(/\s+/).filter(Boolean);
  const uncategorized = category === '__uncategorized__';
  const hit = new Set();
  for (const row of rows) {
    const haystack = normalize(row.dataset.search);
    const textOk = terms.every(term => haystack.includes(term));
    const categoryOk = !category || (uncategorized ? !row.dataset.category : row.dataset.category === category);
    if (textOk && categoryOk) hit.add(row);
    else row.hidden = true;
  }
  matches = ordered.filter(row => hit.has(row));
  limit = PAGE_SIZE;
  render();
}

function showMore() {
  if (limit >= matches.length) return;
  limit += PAGE_SIZE;
  render();
}

if (controls && search && chips.length && moreWrap) {
  controls.hidden = false;
  reset.hidden = false;
  search.addEventListener('input', filter);
  controls.addEventListener('submit', event => event.preventDefault());
  const select = value => {
    category = value;
    chips.forEach(chip => chip.setAttribute('aria-pressed', String(chip.dataset.chip === value)));
    filter();
  };
  chips.forEach(chip => chip.addEventListener('click', () => select(chip.dataset.chip)));
  reset.addEventListener('click', () => {
    search.value = '';
    select('');
    search.focus();
  });
  // Each click reveals one more batch; the list never grows on its own.
  moreButton.addEventListener('click', showMore);
  // Use the same published daily orders as DSH, including random resources.
  const value = (row, key) => { const number = Number(row.dataset[key]); return Number.isFinite(number) && row.dataset[key] !== undefined ? number : -Infinity; };
  const sortBy = id => {
    sortChips.forEach(chip => chip.setAttribute('aria-pressed', String(chip.dataset.sort === id)));
    const key = { recommended: 'sortRecommended', stars: 'sortStars', starsWeek: 'sortStarsWeek', added: 'sortAdded', published: 'sortPublished', random: 'sortRandom' }[id];
    ordered = [...rows].sort((a, b) => (key ? value(b, key) - value(a, key) : 0) || value(a, 'sortOrder') - value(b, 'sortOrder'));
    list.append(...ordered);
    filter();
  };
  sortChips.forEach(chip => chip.addEventListener('click', () => sortBy(chip.dataset.sort)));
  select('');
}

// Step screenshots open full size in a dialog; Escape, the close button or a click outside closes it.
const viewer = document.querySelector('[data-viewer]');
if (viewer && viewer.showModal) {
  const full = viewer.querySelector('img');
  const open = img => { full.src = img.currentSrc || img.src; full.alt = img.alt; viewer.showModal(); };
  document.querySelectorAll('[data-zoom]').forEach(button => button.addEventListener('click', event => { event.stopPropagation(); open(button.querySelector('img')); }));
  // A click anywhere on a step card opens its screenshot too.
  document.querySelectorAll('[data-zoom-card]').forEach(card => card.addEventListener('click', () => open(card.querySelector('img'))));
  viewer.addEventListener('click', event => { if (event.target === viewer || event.target.closest('[data-viewer-close]')) viewer.close(); });
}

// Floating header: tucks away while scrolling down, returns on any upward scroll or near the top.
const header = document.querySelector('[data-header]');
if (header) {
  let last = window.scrollY, ticking = false;
  const update = () => {
    const y = window.scrollY;
    header.classList.toggle('is-scrolled', y > 8);
    if (y > last + 4 && y > 140) header.classList.add('is-hidden');
    else if (y < last - 4 || y <= 140) header.classList.remove('is-hidden');
    last = y; ticking = false;
  };
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  header.addEventListener('focusin', () => header.classList.remove('is-hidden'));
}

// Sections ease in as they enter the viewport.
const revealed = document.querySelectorAll('[data-reveal]');
if ('IntersectionObserver' in window) {
  const seen = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add('is-visible'); seen.unobserve(entry.target); }
  }), { rootMargin: '0px 0px -8% 0px' });
  revealed.forEach(node => seen.observe(node));
} else revealed.forEach(node => node.classList.add('is-visible'));

// "Details" unfolds the card in place: the panel grows, the ResizeObserver above re-spans the row, and the cards below move down.
const setOpen = (row, open) => {
  row.classList.toggle('is-open', open);
  row.querySelector('[data-more-toggle]')?.setAttribute('aria-expanded', String(open));
  const panel = row.querySelector('[data-more-panel]');
  if (panel) panel.inert = !open;
};
// Whether a point sits on an actual glyph, not just inside a text element's box (a short line's trailing space counts as blank).
const onText = (x, y) => {
  const position = document.caretPositionFromPoint?.(x, y);
  const caret = position ? { node: position.offsetNode, offset: position.offset } : (range => range && { node: range.startContainer, offset: range.startOffset })(document.caretRangeFromPoint?.(x, y));
  if (caret?.node?.nodeType !== Node.TEXT_NODE) return false;
  const glyph = document.createRange();
  return [caret.offset - 1, caret.offset].some(at => {
    if (at < 0 || at >= caret.node.length) return false;
    glyph.setStart(caret.node, at); glyph.setEnd(caret.node, at + 1);
    return [...glyph.getClientRects()].some(box => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom);
  });
};
if (list) {
  list.dataset.expandable = '';
  rows.forEach(row => {
    setOpen(row, false);
    const toggle = row.querySelector('[data-more-toggle]');
    if (!toggle) return;
    toggle.hidden = false;
    toggle.addEventListener('click', () => setOpen(row, !row.classList.contains('is-open')));
    // A click on the card's blank space works like "Details"; text stays selectable and links, buttons and the open panel keep their own clicks.
    row.firstElementChild.addEventListener('click', event => {
      if (event.target.closest('a, button, .plugin-more-inner') || String(getSelection()).trim() || onText(event.clientX, event.clientY)) return;
      setOpen(row, !row.classList.contains('is-open'));
    });
  });
}

// Copy the plugin name, then hand off to DSH. It only registers dsh://open, so the user pastes the name into Discover search.
for (const button of document.querySelectorAll('[data-get]')) {
  button.hidden = false;
  const label = button.querySelector('span');
  const idle = label.textContent;
  let resetTimer;
  button.addEventListener('click', async () => {
    clearTimeout(resetTimer);
    // Hold the idle width so status text never shrinks the button or wraps it onto its own line.
    if (!button.style.minWidth) button.style.minWidth = `${button.offsetWidth}px`;
    let copied = true;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(button.dataset.get);
    } catch {
      copied = false;
      // Select the name so a manual copy is one keystroke away.
      const name = button.closest('[data-plugin]')?.querySelector('.get-name');
      if (name) getSelection()?.selectAllChildren(name);
    }
    button.classList.toggle('is-done', copied);
    button.classList.toggle('is-error', !copied);
    label.textContent = copied ? text.nameCopied : text.getFailure;
    const reset = delay => { resetTimer = setTimeout(() => { button.classList.remove('is-done', 'is-error', 'is-missed'); label.textContent = idle; }, delay); };
    if (!copied) return reset(5000);
    // The page cannot see whether DSH launched; losing focus soon after the hand-off is the signal. A declined prompt or a missing app keeps focus here.
    let settled = false;
    const opened = () => {
      if (settled) return;
      settled = true; clearTimeout(resetTimer);
      label.textContent = text.dshOpened;
      reset(4000);
    };
    window.addEventListener('blur', opened, { once: true });
    document.addEventListener('visibilitychange', opened, { once: true });
    location.href = 'dsh://open';
    resetTimer = setTimeout(() => {
      window.removeEventListener('blur', opened);
      document.removeEventListener('visibilitychange', opened);
      if (settled) return;
      settled = true;
      button.classList.replace('is-done', 'is-missed');
      label.textContent = text.dshMissed;
      reset(5000);
    }, 3000);
  });
}

// Coming back from the page cache should never leave the page faded out.
window.addEventListener('pageshow', () => document.body.classList.remove('is-leaving'));
