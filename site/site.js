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

const controls = document.querySelector('[data-filters]');
const search = document.querySelector('#plugin-search');
const chips = [...document.querySelectorAll('[data-chip]')];
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
const numbers = new Intl.NumberFormat(document.documentElement.lang);
// Likes and stars live on dshopen.org's Worker, also for the GitHub Pages mirror. For a local `wrangler dev`, set
// localStorage['opm-api-origin'] to its origin (http://localhost:8787).
let apiOrigin;
try { apiOrigin = localStorage.getItem('opm-api-origin') || undefined; } catch { /* Private mode. */ }
const worker = url => apiOrigin ? new URL(new URL(url).pathname, apiOrigin).href : url;

// The page ships the first cards; later ones arrive in batches for "Show more", or all at once for search and sorting.
let rows = [...document.querySelectorAll('[data-plugin]')];
const total = Number(list?.dataset.total) || rows.length;
const chunkCount = Number(list?.dataset.chunks) || 0;
const present = new Set(rows.map(row => row.dataset.href));
let complete = !list?.dataset.rest;
let fetchedChunks = 0;
let chunkLoading;
let allLoading;
let category = '';
let sort = 'default';
let matches = rows;
let ordered = rows;
// Batches follow the columns on screen: with three columns the first view shows 24 cards and keeps 24 more ready;
// each "Show more" shows the ready batch and readies a larger one (24, 36, 48, …). Two columns use two thirds, one half.
let clicks = 0;
const columns = () => list ? getComputedStyle(list).gridTemplateColumns.split(' ').filter(Boolean).length : 1;
const unit = () => { const cols = columns(); return cols >= 3 ? 12 : cols === 2 ? 8 : 6; };
let limit = 2 * unit();
const readyAhead = () => limit + unit() * (clicks + 2);

// Masonry: each card spans as many 4px rows as its height needs, so short cards no longer leave gaps.
// The 4px rows only switch on here, so a page whose script is slow or missing shows ordinary rows, never a pile of overlapping cards.
const masonry = () => {
  if (!list) return;
  list.dataset.masonry = '';
  const unitHeight = parseFloat(getComputedStyle(list).gridAutoRows) || 4;
  const gap = rows.length ? parseFloat(getComputedStyle(rows[0]).paddingBottom) || 0 : 0;
  // Read every height first, then write, so the browser lays out once instead of once per card.
  const shown = rows.filter(row => !row.hidden);
  // offsetHeight ignores the hover lift and scale, so hovering never reflows the grid.
  const spans = shown.map(row => Math.ceil((row.firstElementChild.offsetHeight + gap) / unitHeight));
  shown.forEach((row, at) => { const value = `span ${spans[at]}`; if (row.style.gridRowEnd !== value) row.style.gridRowEnd = value; });
};
let resized;
if ('ResizeObserver' in window && list) {
  let queued = false;
  resized = new ResizeObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; masonry(); }); } });
}

const filtered = () => Boolean(category || search?.value.trim() || sort !== 'default');
// Show the first `limit` matches; the rest stay hidden until the reader asks for more.
function render() {
  matches.forEach((row, at) => { row.hidden = at >= limit; });
  const shown = Math.min(limit, matches.length);
  // Without filters, cards still on the server count as more to show.
  const narrowed = Boolean(category || search?.value.trim());
  const waiting = !complete && filtered();
  const available = complete || narrowed ? matches.length : total;
  count.textContent = fill(text.results, { count: available, total }) + (waiting ? ` · ${text.moreLoading}` : '');
  empty.hidden = matches.length > 0 || waiting;
  moreWrap.hidden = available <= shown;
  if (!moreWrap.hidden) {
    progress.textContent = fill(text.shown, { shown, count: available });
    bar.style.width = `${Math.round(shown / available * 100)}%`;
    if (!moreButton.disabled) moreButton.textContent = text.more;
  }
  list.dataset.ready = '';
  masonry();
}

const value = (row, key) => { const number = Number(row.dataset[key]); return Number.isFinite(number) && row.dataset[key] !== undefined ? number : -Infinity; };
// Use the same published daily orders as DSH, including random resources; likes come from the Worker.
function order() {
  const key = { recommended: 'sortRecommended', likes: 'sortLikes', stars: 'sortStars', starsWeek: 'sortStarsWeek', published: 'sortPublished', random: 'sortRandom' }[sort];
  ordered = [...rows].sort((a, b) => (key ? value(b, key) - value(a, key) : 0) || value(a, 'sortOrder') - value(b, 'sortOrder'));
  list.append(...ordered);
}

// keep: leave the reader's page count alone, after "Show more" or a background load.
function filter(keep = false) {
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
  if (!keep) { clicks = 0; limit = 2 * unit(); }
  render();
}

function addRows(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const added = [...template.content.querySelectorAll('[data-plugin]')].filter(row => !present.has(row.dataset.href));
  added.forEach(row => { row.hidden = true; present.add(row.dataset.href); });
  list.append(...added);
  added.forEach(setupRow);
  rows = [...rows, ...added];
  paintLikes();
  order();
}
const getJson = path => fetch(new URL(path, location.href)).then(response => response.ok ? response.json() : Promise.reject(new Error(String(response.status))));

// Fetch the next batch files until `wanted` cards are on the page.
function ensureRows(wanted) {
  if (complete || rows.length >= wanted || fetchedChunks >= chunkCount) return Promise.resolve();
  chunkLoading ??= (async () => {
    while (!complete && rows.length < wanted && fetchedChunks < chunkCount) {
      const next = Array.from({ length: Math.min(chunkCount - fetchedChunks, Math.ceil((wanted - rows.length) / 12)) }, (_, at) => fetchedChunks + at);
      const parts = await Promise.all(next.map(n => getJson(list.dataset.chunk.replace('{n}', n))));
      if (complete) break;
      parts.forEach(({ html }) => addRows(html));
      fetchedChunks += next.length;
      if (fetchedChunks >= chunkCount) complete = true;
    }
  })().finally(() => { chunkLoading = undefined; });
  return chunkLoading.then(() => ensureRows(wanted));
}
function loadAll() {
  if (complete) return Promise.resolve();
  allLoading ??= getJson(list.dataset.rest).then(({ html }) => {
    addRows(html);
    complete = true;
    filter(true);
  }).catch(error => { allLoading = undefined; throw error; });
  return allLoading;
}

async function showMore() {
  if (limit >= matches.length && (complete || filtered())) return;
  clicks++;
  limit += unit() * (clicks + 1);
  if (!complete && !filtered() && rows.length < limit) {
    moreButton.disabled = true;
    moreButton.textContent = text.moreLoading;
    try { await ensureRows(limit); } catch {
      clicks--;
      limit -= unit() * (clicks + 2);
      moreButton.disabled = false;
      moreButton.textContent = text.moreFailed;
      return;
    }
    moreButton.disabled = false;
    filter(true);
  } else render();
  // Ready the next, larger batch while the reader looks at this one.
  if (!filtered()) ensureRows(readyAhead()).then(() => filter(true)).catch(() => {});
}

// Searching, filtering or sorting needs the whole catalog; the visible cards update at once and again when it arrives.
const needAll = () => { if (!complete) loadAll().catch(() => render()); };

if (controls && search && chips.length && moreWrap) {
  controls.hidden = false;
  reset.hidden = false;
  search.addEventListener('input', () => { if (search.value.trim()) needAll(); filter(); });
  controls.addEventListener('submit', event => event.preventDefault());
  const select = value => {
    category = value;
    chips.forEach(chip => chip.setAttribute('aria-pressed', String(chip.dataset.chip === value)));
    if (value) needAll();
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
  const sortBy = id => {
    sort = id;
    sortChips.forEach(chip => chip.setAttribute('aria-pressed', String(chip.dataset.sort === id)));
    if (id !== 'default') needAll();
    order();
    filter();
  };
  const settleSort = slider(sortChips[0]?.parentElement, sortChips, chip => chip.getAttribute('aria-pressed') === 'true');
  sortChips.forEach(chip => chip.addEventListener('click', () => { sortBy(chip.dataset.sort); settleSort(); }));
  select('');
  // An idle search box types plugin names into its placeholder, letter by letter, then erases them for the next one.
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const idle = search.placeholder;
    const names = [...new Set(rows.slice(0, 24).map(row => row.querySelector('.plugin-link')?.textContent.trim()).filter(Boolean))].sort(() => Math.random() - .5);
    let at = 0, shown = 0, erasing = false, timer;
    const tick = () => {
      if (document.activeElement === search || search.value) { search.placeholder = idle; timer = setTimeout(tick, 1200); return; }
      const name = names[at % names.length];
      shown += erasing ? -1 : 1;
      search.placeholder = name.slice(0, shown) + '｜';
      let delay = erasing ? 45 : 110;
      if (!erasing && shown >= name.length) { erasing = true; delay = 1600; }
      else if (erasing && shown <= 0) { erasing = false; at++; delay = 500; }
      timer = setTimeout(tick, delay);
    };
    if (names.length) timer = setTimeout(tick, 1500);
    search.addEventListener('focus', () => { search.placeholder = idle; });
  }
  // The first view follows the columns, also after a resize that changes them.
  let lastColumns = columns();
  window.addEventListener('resize', () => {
    const now = columns();
    if (now === lastColumns) return;
    lastColumns = now;
    if (clicks === 0) { limit = 2 * unit(); render(); }
  }, { passive: true });
  ensureRows(readyAhead()).then(() => filter(true)).catch(() => {});
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

// Today's readers of the index, from the Worker; the line keeps its height while loading and stays blank if the stats are unavailable.
const usage = document.querySelector('[data-usage]');
if (usage) {
  fetch(text.statsUrl).then(response => response.ok ? response.json() : Promise.reject()).then(({ today }) => {
    if (!Number.isSafeInteger(today?.readers) || today.readers < 1) return;
    const parts = text.usage.split(/(\{\w+\})/).map(part => {
      const key = part.match(/^\{(\w+)\}$/)?.[1];
      if (!key) return document.createTextNode(part);
      const strong = document.createElement('strong');
      strong.textContent = numbers.format(today[key]);
      return strong;
    });
    usage.querySelector('[data-usage-text]').replaceChildren(...parts);
    usage.classList.add('is-loaded');
  }).catch(() => {});
}

// Floating header: tucks away while scrolling down, returns on any upward scroll or near the top.
const header = document.querySelector('[data-header]');
if (header) {
  let last = window.scrollY, ticking = false;
  const update = () => {
    const y = window.scrollY;
    // Folding the brand shortens the header, which moves the page; the gap between the two thresholds keeps that move
    // from folding and unfolding it again at certain heights.
    if (y > 48) header.classList.add('is-scrolled');
    else if (y < 4) header.classList.remove('is-scrolled');
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

// A card unfolds its details in place: the panel grows, the ResizeObserver above re-spans the row, and the cards below move down.
const setOpen = (row, open) => {
  row.classList.toggle('is-open', open);
  row.firstElementChild.setAttribute('aria-expanded', String(open));
  const panel = row.querySelector('[data-more-panel]');
  if (panel) panel.inert = !open;
};

// Copy the plugin name, then hand off to DSH. It only registers dsh://open, so the user pastes the name into Discover search.
function setupGet(button) {
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
      const name = button.closest('[data-plugin], [data-get-scope]')?.querySelector('.get-name');
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

// Likes: counts from the Worker, one like per plugin per day here (the Worker also counts each person once a day).
const LIKED_KEY = 'opm-liked';
const today = () => new Date().toISOString().slice(0, 10);
const likes = { counts: {}, liked: new Set() };
try {
  const saved = JSON.parse(localStorage.getItem(LIKED_KEY));
  if (saved?.day === today() && Array.isArray(saved.names)) likes.liked = new Set(saved.names);
} catch { /* Private mode or nothing saved. */ }
function paintLike(button) {
  const name = button.dataset.like;
  const value = likes.counts[name] ?? 0;
  const liked = likes.liked.has(name);
  button.hidden = false;
  button.classList.toggle('is-liked', liked);
  button.setAttribute('aria-pressed', String(liked));
  button.title = button.dataset.note ?? (liked ? text.liked : text.likeTitle);
  button.querySelector('[data-like-count]').textContent = value ? numbers.format(value) : '';
  const row = button.closest('[data-plugin]');
  if (row) row.dataset.sortLikes = value;
}
function paintLikes() { document.querySelectorAll('[data-like]').forEach(paintLike); }
function setupLike(button) {
  paintLike(button);
  button.addEventListener('click', async event => {
    event.stopPropagation();
    const name = button.dataset.like;
    if (likes.liked.has(name) || button.dataset.busy) return;
    button.dataset.busy = '1';
    delete button.dataset.note;
    // Answer at once; the server's count replaces the guess.
    likes.liked.add(name);
    likes.counts[name] = (likes.counts[name] ?? 0) + 1;
    button.classList.remove('is-pop'); void button.offsetWidth; button.classList.add('is-pop');
    document.querySelectorAll('[data-like]').forEach(other => { if (other.dataset.like === name) paintLike(other); });
    try {
      const response = await fetch(worker(text.likeApi), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, source: 'like' }) });
      const answer = await response.json().catch(() => ({}));
      if (response.status === 429) throw Object.assign(new Error('limit'), { note: text.likeLimit });
      if (!response.ok || !Number.isSafeInteger(answer.likes)) throw new Error(String(response.status));
      likes.counts[name] = answer.likes;
      try { localStorage.setItem(LIKED_KEY, JSON.stringify({ day: today(), names: [...likes.liked] })); } catch { /* Private mode. */ }
    } catch (error) {
      likes.liked.delete(name);
      likes.counts[name] = Math.max(0, (likes.counts[name] ?? 1) - 1);
      button.dataset.note = error.note ?? text.likeFailed;
    }
    delete button.dataset.busy;
    document.querySelectorAll('[data-like]').forEach(other => { if (other.dataset.like === name) paintLike(other); });
  });
}
const likesFeed = document.querySelector('[data-like]') ? fetch(worker(text.likesUrl)).then(response => response.ok ? response.json() : Promise.reject()) : undefined;
if (document.querySelector('[data-like]')) {
  likesFeed.then(data => {
    if (data?.likes && typeof data.likes === 'object') likes.counts = { ...data.likes, ...Object.fromEntries(Object.entries(likes.counts).filter(([name]) => likes.liked.has(name))) };
    paintLikes();
    if (sort === 'likes' && list) { order(); filter(true); }
  }).catch(() => {});
}

// Anywhere on a card unfolds its details, except links, buttons, the open panel and selected text; the corner link and the
// title open the plugin's page. Keyboard users reach the card itself with Tab and unfold it with Enter or Space.
function setupRow(row) {
  resized?.observe(row.firstElementChild);
  row.querySelectorAll('[data-get]').forEach(setupGet);
  row.querySelectorAll('[data-like]').forEach(setupLike);
  const card = row.firstElementChild;
  card.tabIndex = 0;
  card.setAttribute('aria-controls', row.querySelector('[data-more-panel]')?.id ?? '');
  setOpen(row, false);
  card.addEventListener('click', event => {
    if (event.target.closest('a, button, .plugin-more-inner') || String(getSelection()).trim()) return;
    setOpen(row, !row.classList.contains('is-open'));
  });
  card.addEventListener('keydown', event => {
    if (event.target !== card || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    setOpen(row, !row.classList.contains('is-open'));
  });
}
if (list) {
  list.dataset.expandable = '';
  rows.forEach(setupRow);
}
// Plugin pages carry the same like and copy buttons outside any card.
document.querySelectorAll('[data-get-scope] [data-get]').forEach(setupGet);
document.querySelectorAll('[data-get-scope] [data-like]').forEach(setupLike);

// A pill that slides under the hovered option and settles back on the chosen one, like the language switcher.
function slider(group, items, chosen) {
  if (!group || !items.length) return () => {};
  group.classList.add('has-slider');
  const pill = Object.assign(document.createElement('span'), { className: 'slider' });
  pill.setAttribute('aria-hidden', 'true');
  group.prepend(pill);
  const place = item => {
    if (!item) return;
    pill.style.width = `${item.offsetWidth}px`;
    pill.style.height = `${item.offsetHeight}px`;
    pill.style.transform = `translate(${item.offsetLeft}px, ${item.offsetTop}px)`;
  };
  const settle = () => place(items.find(chosen) ?? items[0]);
  items.forEach(item => item.addEventListener('pointerenter', () => place(item)));
  group.addEventListener('pointerleave', settle);
  window.addEventListener('resize', settle, { passive: true });
  document.fonts?.ready.then(settle);
  settle();
  // The first placement happens without the slide, so the pill does not fly in on load.
  requestAnimationFrame(() => group.classList.add('is-sliding'));
  return settle;
}

// Tabs: the two ways to set up (index or plugin) and the two screenshots in the showcase share one space each.
function tabs(buttons, show, { auto } = {}) {
  if (!buttons.length) return;
  buttons[0].parentElement.hidden = false;
  const settle = slider(buttons[0].parentElement, buttons, button => button.getAttribute('aria-selected') === 'true');
  let timer;
  const pick = (button, focus) => {
    buttons.forEach(other => { other.setAttribute('aria-selected', String(other === button)); other.tabIndex = other === button ? 0 : -1; });
    show(button);
    settle();
    if (focus) button.focus();
  };
  buttons.forEach((button, at) => {
    button.addEventListener('click', () => { clearInterval(timer); pick(button); });
    button.addEventListener('keydown', event => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      clearInterval(timer);
      pick(buttons[(at + step + buttons.length) % buttons.length], true);
    });
  });
  // The showcase alternates by itself while on screen, until the reader picks a tab or hovers it.
  if (auto && !matchMedia('(prefers-reduced-motion: reduce)').matches && 'IntersectionObserver' in window) {
    const frame = auto;
    let paused = false;
    frame.addEventListener('pointerenter', () => { paused = true; });
    frame.addEventListener('pointerleave', () => { paused = false; });
    new IntersectionObserver(([entry]) => {
      clearInterval(timer);
      if (entry.isIntersecting) timer = setInterval(() => {
        if (paused) return;
        const at = buttons.findIndex(button => button.getAttribute('aria-selected') === 'true');
        pick(buttons[(at + 1) % buttons.length]);
      }, 5000);
    }, { threshold: .5 }).observe(frame);
  }
}
const panels = document.querySelector('.method-panels');
if (panels) {
  panels.dataset.tabbed = '';
  tabs([...document.querySelectorAll('[data-method-tab]')], button => {
    panels.querySelectorAll('[data-method]').forEach(panel => panel.classList.toggle('is-active', panel.dataset.method === button.dataset.methodTab));
  });
  panels.querySelector('[data-method="index"]').classList.add('is-active');
}
const shots = document.querySelector('[data-shots]');
if (shots) tabs([...shots.querySelectorAll('[data-shot-tab]')], button => { shots.dataset.showing = button.dataset.shotTab; }, { auto: shots });

// Small copy buttons: the plugin install command and README badges.
for (const button of document.querySelectorAll('[data-copy-text]')) {
  button.hidden = false;
  const label = button.querySelector('span');
  const idle = label.textContent;
  let timer;
  button.addEventListener('click', async () => {
    clearTimeout(timer);
    try {
      await navigator.clipboard.writeText(button.dataset.copyText);
      label.textContent = text.copiedShort;
    } catch {
      const code = button.parentElement.querySelector('code');
      if (code) getSelection()?.selectAllChildren(code);
    }
    timer = setTimeout(() => { label.textContent = idle; }, 2000);
  });
}

// The project's live star count, for the GitHub link's hover and the footer.
const starSlots = document.querySelectorAll('[data-gh-stars]');
if (starSlots.length) {
  fetch(worker(text.starsApi)).then(response => response.ok ? response.json() : Promise.reject()).then(({ stars }) => {
    if (!Number.isSafeInteger(stars)) return;
    starSlots.forEach(slot => { slot.textContent = numbers.format(stars); slot.closest('a')?.classList.add('has-stars'); });
  }).catch(() => {});
}

// Coming back from the page cache should never leave the page faded out.
window.addEventListener('pageshow', () => document.body.classList.remove('is-leaving'));

// Usage stats page: tiles, a daily bar chart (people or loads, one at a time) and the country and region shares, all from stats.json.
const statsRoot = document.querySelector('[data-stats]');
if (statsRoot) {
  const words = JSON.parse(document.querySelector('#stats-messages').textContent);
  const number = new Intl.NumberFormat(words.locale);
  const percent = new Intl.NumberFormat(words.locale, { style: 'percent', maximumFractionDigits: 1 });
  const shortDay = new Intl.DateTimeFormat(words.locale, { month: 'numeric', day: 'numeric', timeZone: 'UTC' });
  const longDay = new Intl.DateTimeFormat(words.locale, { year: 'numeric', month: 'short', day: 'numeric', weekday: 'short', timeZone: 'UTC' });
  const dateOnly = new Intl.DateTimeFormat(words.locale, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  let regionNames;
  try { regionNames = new Intl.DisplayNames([words.locale], { type: 'region' }); } catch { /* Older browsers show the code. */ }
  const regionName = code => code === 'XX' ? words.unknownRegion : words.regionNames[code] ?? regionNames?.of(code) ?? code;
  // UN M49 geographic regions by ISO 3166 code; anything else (XX, AQ) counts as unknown.
  const M49 = {
    Asia: 'AF AM AZ BH BD BT BN KH CN CY GE HK IN ID IR IQ IL JP JO KZ KW KG LA LB MO MY MV MN MM NP KP OM PK PS PH QA SA SG KR LK SY TW TJ TH TL TR TM AE UZ VN YE',
    Americas: 'AI AG AR AW BS BB BZ BM BO BQ BV BR CA KY CL CO CR CU CW DM DO EC SV FK GF GL GD GP GT GY HT HN JM MQ MX MS NI PA PY PE PR BL KN LC MF PM VC SX GS SR TT TC US UM UY VE VG VI',
    Europe: 'AX AL AD AT BY BE BA BG HR CZ DK EE FO FI FR DE GI GR GG VA HU IS IE IM IT JE XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE CH UA GB',
    Oceania: 'AS AU CX CC CK FJ PF GU HM KI MH FM NR NC NZ NU NF MP PW PG PN WS SB TK TO TV VU WF',
    Africa: 'DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU YT MA MZ NA NE NG RE RW SH ST SN SC SL SO ZA SS SD TZ TG TN UG EH ZM ZW IO TF'
  };
  const continentOf = Object.fromEntries(Object.entries(M49).flatMap(([region, codes]) => codes.split(' ').map(code => [code, region])));
  // Fixed colour per region, so a region keeps its colour whatever its rank.
  const REGION_ORDER = ['Asia', 'Americas', 'Europe', 'Oceania', 'Africa', 'Unknown'];
  const status = statsRoot.querySelector('[data-stats-status]');
  const svg = (tag, attributes) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    return node;
  };
  const tile = (id, value) => { const node = statsRoot.querySelector(`[data-tile="${id}"] [data-value]`); if (node) node.textContent = Number.isSafeInteger(value) ? number.format(value) : '–'; };

  // Every UTC day from the first recorded one to today (at most 30), with zeros for days without reads.
  const daysOf = daily => {
    const today = new Date().toISOString().slice(0, 10);
    const known = new Map(daily.map(row => [row.day, row]));
    const first = daily[0]?.day ?? today;
    const days = [];
    for (let at = Date.parse(`${today}T00:00:00Z`); days.length < 30; at -= 86_400_000) {
      const day = new Date(at).toISOString().slice(0, 10);
      if (day < first) break;
      days.unshift({ day, reads: known.get(day)?.reads ?? 0, readers: known.get(day)?.readers ?? 0, today: day === today });
    }
    return days;
  };
  // Gridlines every 1, 2, 2.5 or 5 times a power of ten, about five of them, ending just above the tallest bar.
  const niceScale = max => {
    if (max <= 0) return { step: 1, ticks: 4 };
    const rough = max / 5;
    const power = 10 ** Math.floor(Math.log10(rough));
    const step = Math.max(1, [1, 2, 2.5, 5, 10].find(f => f * power >= rough) * power);
    return { step, ticks: Math.max(1, Math.ceil(max / step)) };
  };

  const chartBox = statsRoot.querySelector('[data-daily]');
  const tooltip = Object.assign(document.createElement('div'), { className: 'chart-tooltip', hidden: true });
  chartBox.append(tooltip);
  let days = [];
  let metric = 'readers';
  const drawDaily = () => {
    chartBox.querySelector('svg')?.remove();
    if (!days.length) return;
    const width = Math.max(280, chartBox.clientWidth);
    const height = width < 520 ? 220 : 280;
    const pad = { top: 12, right: 4, bottom: 28, left: 52 };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const { step, ticks } = niceScale(Math.max(...days.map(day => day[metric])));
    const top = step * ticks;
    const y = value => pad.top + plotH - value / top * plotH;
    const slot = plotW / days.length;
    const barW = Math.max(3, Math.min(36, slot - 2));
    const root = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-label': `${metric === 'readers' ? words.metricReaders : words.metricReads}: ${days.map(day => `${day.day} ${day[metric]}`).join(', ')}` });
    for (let tick = 0; tick <= ticks; tick++) {
      const value = step * tick;
      root.append(svg('line', { x1: pad.left, x2: width - pad.right, y1: y(value), y2: y(value), class: tick ? 'grid' : 'baseline' }));
      const label = svg('text', { x: pad.left - 8, y: y(value) + 4, 'text-anchor': 'end', class: 'axis' });
      label.textContent = number.format(value);
      root.append(label);
    }
    // Label about six days along the axis, always including the last.
    const every = Math.max(1, Math.ceil(days.length / 6));
    days.forEach((day, at) => {
      const x = pad.left + slot * at + (slot - barW) / 2;
      const value = day[metric];
      const h = Math.max(0, y(0) - y(value));
      const r = Math.min(4, barW / 2, h);
      // A bar with a 4px rounded top, flat on the baseline.
      const bar = svg('path', { d: `M${x},${y(0)}V${y(0) - h + r}Q${x},${y(0) - h} ${x + r},${y(0) - h}H${x + barW - r}Q${x + barW},${y(0) - h} ${x + barW},${y(0) - h + r}V${y(0)}Z`, class: day.today ? 'bar is-today' : 'bar' });
      const hit = svg('rect', { x: pad.left + slot * at, y: pad.top, width: slot, height: plotH, class: 'hit', tabindex: 0, 'aria-label': `${day.day}: ${words.metricReaders} ${number.format(day.readers)}, ${words.metricReads} ${number.format(day.reads)}` });
      const show = () => {
        root.querySelectorAll('.bar.is-active').forEach(node => node.classList.remove('is-active'));
        bar.classList.add('is-active');
        const date = new Date(`${day.day}T00:00:00Z`);
        tooltip.innerHTML = '';
        const title = document.createElement('strong');
        title.textContent = longDay.format(date) + (day.today ? ' · UTC' : '');
        tooltip.append(title);
        for (const [key, label] of [['readers', words.metricReaders], ['reads', words.metricReads]]) {
          const row = document.createElement('span');
          row.className = key === metric ? 'is-current' : '';
          row.textContent = `${label} ${number.format(day[key])}`;
          tooltip.append(row);
        }
        tooltip.hidden = false;
        const left = Math.min(Math.max(pad.left + slot * (at + .5) - tooltip.offsetWidth / 2, 0), width - tooltip.offsetWidth);
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${Math.max(0, y(value) - tooltip.offsetHeight - 10)}px`;
      };
      const hide = () => { bar.classList.remove('is-active'); tooltip.hidden = true; };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('focus', show);
      hit.addEventListener('pointerleave', hide);
      hit.addEventListener('blur', hide);
      root.append(bar, hit);
      if (at % every === (days.length - 1) % every) {
        const label = svg('text', { x: pad.left + slot * (at + .5), y: height - 8, 'text-anchor': 'middle', class: 'axis' });
        label.textContent = shortDay.format(new Date(`${day.day}T00:00:00Z`));
        root.append(label);
      }
    });
    chartBox.prepend(root);
  };
  statsRoot.querySelectorAll('[data-metric]').forEach(button => button.addEventListener('click', () => {
    metric = button.dataset.metric;
    statsRoot.querySelectorAll('[data-metric]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    drawDaily();
  }));
  if ('ResizeObserver' in window) {
    let lastWidth = 0;
    new ResizeObserver(() => { if (chartBox.clientWidth !== lastWidth) { lastWidth = chartBox.clientWidth; drawDaily(); } }).observe(chartBox);
  }

  // A donut of the UN regions: one slice per region with people, a 2px gap between slices and the total in the middle.
  const drawRegions = (rows, total, key) => {
    const sums = new Map();
    for (const row of rows) { const region = continentOf[row.country] ?? 'Unknown'; sums.set(region, (sums.get(region) ?? 0) + row[key]); }
    const slices = REGION_ORDER.filter(region => sums.get(region)).map(region => ({ region, value: sums.get(region) }));
    const size = 220, center = size / 2, outer = 104, inner = 66;
    const root = svg('svg', { viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': slices.map(slice => `${words.regions[slice.region]} ${percent.format(slice.value / total)}`).join(', ') });
    let angle = -Math.PI / 2;
    const point = (radius, at) => `${center + radius * Math.cos(at)},${center + radius * Math.sin(at)}`;
    for (const slice of slices) {
      const sweep = slice.value / total * Math.PI * 2;
      const end = angle + sweep;
      const large = sweep > Math.PI ? 1 : 0;
      // A lone region is a full ring, which one arc cannot draw.
      const d = slices.length === 1
        ? `M${center - outer},${center}a${outer},${outer} 0 1,0 ${outer * 2},0a${outer},${outer} 0 1,0 ${-outer * 2},0M${center - inner},${center}a${inner},${inner} 0 1,1 ${inner * 2},0a${inner},${inner} 0 1,1 ${-inner * 2},0Z`
        : `M${point(outer, angle)}A${outer},${outer} 0 ${large},1 ${point(outer, end)}L${point(inner, end)}A${inner},${inner} 0 ${large},0 ${point(inner, angle)}Z`;
      const path = svg('path', { d, class: 'slice', 'data-region': slice.region, 'fill-rule': 'evenodd' });
      const title = svg('title', {});
      title.textContent = `${words.regions[slice.region]}: ${number.format(slice.value)} · ${percent.format(slice.value / total)}`;
      path.append(title);
      root.append(path);
      angle = end;
    }
    const value = svg('text', { x: center, y: center + 2, 'text-anchor': 'middle', class: 'donut-value' });
    value.textContent = number.format(total);
    const label = svg('text', { x: center, y: center + 22, 'text-anchor': 'middle', class: 'donut-label' });
    label.textContent = key === 'reads' ? words.metricReads : words.metricReaders;
    root.append(value, label);
    statsRoot.querySelector('[data-regions]').replaceChildren(root);
    statsRoot.querySelector('[data-region-legend]').replaceChildren(...slices.map(slice => {
      const item = document.createElement('li');
      item.dataset.region = slice.region;
      item.innerHTML = '<span class="swatch" aria-hidden="true"></span><span class="legend-name"></span><strong></strong>';
      item.querySelector('.legend-name').textContent = words.regions[slice.region];
      item.querySelector('strong').textContent = percent.format(slice.value / total);
      return item;
    }));
  };

  const drawCountries = countries => {
    const list = statsRoot.querySelector('[data-countries]');
    // Cloudflare analytics report loads; the Worker's own D1 counts report people.
    const key = countries?.metric === 'reads' ? 'reads' : 'readers';
    const rows = (countries?.last30Days ?? []).filter(row => Number.isSafeInteger(row[key]) && row[key] > 0);
    const total = rows.reduce((sum, row) => sum + row[key], 0);
    statsRoot.querySelector('[data-countries-empty]').hidden = total > 0;
    statsRoot.querySelector('[data-geo]').hidden = !total;
    if (!total) return;
    drawRegions(rows, total, key);
    const note = statsRoot.querySelector('[data-countries-note]');
    if (key === 'reads') note.textContent = words.countriesNoteLoads;
    else if (countries.since) note.textContent = words.countriesNote.replace('{since}', dateOnly.format(new Date(`${countries.since}T00:00:00Z`)));
    // The eight largest by name, the rest folded into one row so the bars stay comparable.
    const shown = rows.slice(0, 8);
    const rest = rows.slice(8);
    if (rest.length) shown.push({ country: '', [key]: rest.reduce((sum, row) => sum + row[key], 0), label: words.otherRegions.replace('{count}', rest.length) });
    const largest = Math.max(...shown.map(row => row[key]));
    list.replaceChildren(...shown.map(row => {
      const item = document.createElement('li');
      item.className = row.country ? '' : 'is-other';
      const share = row[key] / total;
      item.innerHTML = '<span class="country-name"></span><span class="country-track"><span class="country-fill"></span></span><span class="country-value"><strong></strong><small></small></span>';
      item.querySelector('.country-name').textContent = row.label ?? regionName(row.country);
      item.querySelector('.country-fill').style.width = `${Math.max(1.5, row[key] / largest * 100)}%`;
      item.querySelector('strong').textContent = percent.format(share);
      item.querySelector('small').textContent = number.format(row[key]);
      item.title = `${item.querySelector('.country-name').textContent}: ${number.format(row[key])} · ${percent.format(share)}`;
      return item;
    }));
  };

  fetch(statsRoot.dataset.stats).then(response => response.ok ? response.json() : Promise.reject(new Error(String(response.status)))).then(data => {
    status.hidden = true;
    tile('todayReaders', data.today?.readers);
    tile('todayReads', data.today?.reads);
    tile('monthReaders', data.last30Days?.readers);
    tile('totalReads', data.total);
    days = daysOf((data.last30Days?.daily ?? []).filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.day)));
    statsRoot.querySelector('[data-daily-table]').replaceChildren(...[...days].reverse().map(day => {
      const row = document.createElement('tr');
      for (const value of [longDay.format(new Date(`${day.day}T00:00:00Z`)), number.format(day.readers), number.format(day.reads)]) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    }));
    drawDaily();
    drawCountries(data.countries);
  }).catch(() => { status.textContent = words.failed; status.classList.add('is-error'); });
}
