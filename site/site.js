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
    const key = { recommended: 'sortRecommended', stars: 'sortStars', starsWeek: 'sortStarsWeek', published: 'sortPublished', random: 'sortRandom' }[id];
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

// Today's readers of the index, from the Worker; the line keeps its height while loading and stays blank if the stats are unavailable.
const usage = document.querySelector('[data-usage]');
if (usage) {
  fetch(usage.dataset.usage).then(response => response.ok ? response.json() : Promise.reject()).then(({ today }) => {
    if (!Number.isSafeInteger(today?.readers) || today.readers < 1) return;
    const format = new Intl.NumberFormat(document.documentElement.lang);
    const parts = text.usage.split(/(\{\w+\})/).map(part => {
      const key = part.match(/^\{(\w+)\}$/)?.[1];
      if (!key) return document.createTextNode(part);
      const strong = document.createElement('strong');
      strong.textContent = format.format(today[key]);
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
