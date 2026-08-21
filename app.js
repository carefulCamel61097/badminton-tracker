/* A player's whole career as a stack of seasons.
 *
 * One row per season, most recent at the top; within a row, one square per
 * tournament in chronological order. Each square is a gauge: it fills from the
 * bottom by how far the player got in that draw and ramps green (title) to red
 * (first-round exit), with the round repeated as text so the encoding survives
 * colour blindness.
 *
 * Squares are sized by how much the tournament weighs — HANDOVER Part 2 settles
 * the numbers, the 42px full square, the 9px label floor and the equal 52px
 * slot — and filled against that draw's real ladder, per Part 2.5.
 */

import { loadSeason, loadPlayer, loadDraws, searchPlayers, queueDepth } from './api.js';
import {
  positionInfo, fillFraction, drawForKind, dominantDraw, seasonKinds,
  defaultKind, seasonLevels, levelLabel, levelAbbr, boxSize, isTeamEvent,
  drawLadder, BOX_H, LEVEL,
} from './model.js';

const $ = id => document.getElementById(id);

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* How far back to look. BWF returns an empty list rather than an error for a
   year it has nothing for, and real data reaches back to about 2007, so the
   walk stops after a run of empty seasons rather than grinding through two
   decades of nothing for a player who turned professional last year. */
const YEAR_FLOOR = 2006;
const EMPTY_RUN = 2;

const state = {
  playerId: null,
  player: null,          // {id, name, country, countryCode}
  kind: null,            // 'singles' | 'doubles'
  sized: true,
  hiddenLevels: null,    // level keys switched off
  touchedLevels: null,   // level keys the reader has actually clicked
  hiddenYears: new Set(),
  seasons: [],           // [{year, tournaments}], newest first
  draws: new Map(),      // tournament code -> tournaments/draws payload, or null
  kinds: [],
  error: null,
  loading: false,
  suggestions: null,
  highlighted: -1,
};

let loadToken = 0;

/* ============================ what gets drawn ============================ */

/**
 * Team events are off unless explicitly switched on. They carry no individual
 * position — BWF returns "N/A" — so at full weight they are the largest and
 * emptiest squares in the strip: maximum prominence, zero information.
 *
 * Applied to every season as it arrives, but never to a level the reader has
 * already decided about: switching team events on and then loading another
 * season should not switch them off again.
 */
function applyLevelDefaults(tournaments) {
  if (!state.hiddenLevels) { state.hiddenLevels = new Set(); state.touchedLevels = new Set(); }
  for (const c of seasonLevels(tournaments)) {
    if (isTeamEvent(c) && !state.touchedLevels.has(String(c))) state.hiddenLevels.add(String(c));
  }
}

const allTournaments = () => state.seasons.flatMap(s => s.tournaments);

/* Levels are held as what is *hidden*. Holding the shown set meant that a
   season containing a level an earlier one did not — and historical seasons are
   full of them — was filtered away silently. */
const levelShown = cat => !state.hiddenLevels || !state.hiddenLevels.has(String(cat));

const visibleSeasons = () => state.seasons
  .filter(s => !state.hiddenYears.has(s.year))
  .map(s => ({ year: s.year, tournaments: s.tournaments.filter(t => levelShown(t.cat)) }))
  .filter(s => s.tournaments.length);

/** How many rounds the player's own draw had, or null if not known yet. */
function roundsFor(tmt, drawName) {
  const payload = state.draws.get(tmt.code);
  if (!payload) return null;
  return drawLadder(payload, drawName);
}

/* ============================ the strip ============================ */

/**
 * One square.
 *
 * The box shrinks *inside* a fixed 52px slot rather than the column narrowing,
 * so a lighter event reads as more air around it — every tournament occupies an
 * equal share of the strip whatever it weighed.
 */
function square(tmt, kind, preferred) {
  // A team tie has no individual position, but the player was there and won
  // matches. Showing it as an empty square is right; showing it as *the same*
  // empty square as "did not enter this discipline" is not, so it keeps its own
  // tier and its own label.
  const draw = tmt.team
    ? (tmt.draws || [])[0] || null
    : drawForKind(tmt, kind, preferred);
  const info = positionInfo(draw && draw.position, draw);
  const rounds = draw ? roundsFor(tmt, draw.name) : null;
  const pct = Math.round(fillFraction(info, draw, rounds) * 100);
  const box = boxSize(tmt.cat, state.sized);

  const weight = (LEVEL[tmt.cat] || {}).weight;
  const wl = draw && draw.win != null ? ` · ${draw.win}-${draw.lose}` : '';
  const entered = draw ? `${draw.raw || draw.name} — ${info.full}${wl}` : 'did not enter';
  // Naming the ladder makes the gauge checkable: a quarter-final filling 2/5
  // and another filling 3/6 are both right, and the tooltip says why.
  const ladder = rounds ? `\n${Math.max(0, rounds - (info.steps || 0))} of ${rounds} rounds` : '';
  const tip = `${tmt.name}\n${tmt.level || 'Unknown level'}`
    + (weight != null ? ` · weight ${weight.toFixed(2)}` : '')
    + `\n${entered}${ladder}`;

  const inner = `<span class="tn">${esc(tmt.short)}</span>`
    + `<span class="slot" style="height:${BOX_H}px">`
    + `<span class="box r-${draw ? info.tier : 'none'}"`
    + ` style="width:${box.w.toFixed(1)}px;height:${box.h.toFixed(1)}px;`
    + `font-size:${box.font.toFixed(1)}px;--pct:${pct}%">`
    + `${esc(draw ? info.label : '')}</span></span>`
    + `<span class="lv">${esc(levelAbbr(tmt.cat))}</span>`;

  // Link back to BWF's own tournament page — their data, their pages.
  return tmt.url
    ? `<a class="sq" href="${esc(tmt.url)}" target="_blank" rel="noopener"
         title="${esc(tip)}">${inner}</a>`
    : `<span class="sq" title="${esc(tip)}">${inner}</span>`;
}

function renderSeasons() {
  const shown = visibleSeasons();
  const kind = state.kind;
  const preferred = dominantDraw(allTournaments(), kind);

  $('seasons').innerHTML = shown.map(s => {
    const squares = s.tournaments.map(t => square(t, kind, preferred)).join('');
    return `<section class="srow" data-year="${s.year}">`
      + `<div class="yr">${s.year}<span class="cnt">${s.tournaments.length}</span></div>`
      + `<div class="season">${squares}</div></section>`;
  }).join('');

  const box = $('empty');
  let why = '';
  if (!state.loading && state.playerId && !state.seasons.length) {
    why = 'No tournaments recorded for this player. BWF\'s results reach back to about 2007.';
  } else if (state.seasons.length && !shown.length) {
    why = 'Everything is hidden by the season or level filters.';
  }
  box.textContent = why;
  box.hidden = !why;

  $('raw').textContent = JSON.stringify(shown, null, 1);
}

/* ============================ the controls ============================ */

function renderKinds() {
  const wrap = $('kindWrap');
  if (state.kinds.length < 2) {
    // Nothing to choose between: a singles player gets no toggle rather than a
    // dead one.
    wrap.innerHTML = state.kinds.length
      ? `<span class="only">${esc(state.kinds[0].kind)}</span>` : '';
    return;
  }
  wrap.innerHTML = state.kinds.map(k =>
    `<button type="button" class="seg${k.kind === state.kind ? ' on' : ''}"`
    + ` data-kind="${k.kind}" aria-pressed="${k.kind === state.kind}">`
    + `${esc(k.kind)}<span class="n">${k.count}</span></button>`).join('');
}

function renderYears() {
  $('years').innerHTML = state.seasons.map(s => {
    const on = !state.hiddenYears.has(s.year);
    return `<button type="button" class="chip${on ? ' on' : ''}" data-year="${s.year}"`
      + ` aria-pressed="${on}">${s.year}<span class="n">${s.tournaments.length}</span></button>`;
  }).join('');
}

function renderLevels() {
  const all = allTournaments();
  $('levels').innerHTML = seasonLevels(all).map(c => {
    const on = levelShown(c);
    const team = isTeamEvent(c);
    const n = all.filter(t => t.cat === c).length;
    return `<button type="button" class="chip${on ? ' on' : ''}${team ? ' team' : ''}"`
      + ` data-cat="${c}" aria-pressed="${on}">${esc(levelLabel(c))}`
      + `<span class="n">${n}</span></button>`;
  }).join('');
}

function setStatus(text, isError) {
  const el = $('status');
  el.textContent = text;
  el.className = isError ? 'error' : '';
}

function render() {
  if (state.error) { setStatus(state.error, true); return; }

  const who = state.player
    ? `${state.player.name}${state.player.countryCode ? ' (' + state.player.countryCode + ')' : ''}`
    : state.playerId ? `player ${state.playerId}` : '';
  const n = state.seasons.length;
  setStatus(!state.playerId ? ''
    : state.loading ? `${who || 'Loading'} — ${n} season${n === 1 ? '' : 's'} so far…`
    : `${who} · ${n} season${n === 1 ? '' : 's'} · ${state.kind || '—'}`);

  renderKinds();
  renderYears();
  renderLevels();
  renderSeasons();
  watchRows();
}

/* ============================ loading ============================ */

/**
 * Walk back year by year from the current one, rendering each season as it
 * arrives rather than waiting for the whole career.
 *
 * Nothing says which years a player competed in, so the only way to find out is
 * to ask. That is one request per year at 320ms apart, which is exactly why the
 * rows appear one at a time instead of after twenty of them have landed.
 */
async function loadCareer(playerId, { keepFilters = false } = {}) {
  // A player id is a number. Anything else — a hand-edited hash, a stale link —
  // would otherwise walk twenty years of requests to discover that nobody by
  // that name ever played.
  if (!/^\d+$/.test(String(playerId))) return;
  const token = ++loadToken;
  const previous = state.playerId;
  state.playerId = String(playerId);
  state.player = null;
  state.seasons = [];
  state.kinds = [];

  // Picking a different player starts fresh — their discipline and their years
  // are not this one's. But a link that arrives already carrying filters, or a
  // hash somebody edited, has just had them read: clearing those would make
  // `#k=doubles&hy=2019` do nothing, which is the whole point of putting them
  // in the URL.
  if (!keepFilters && previous && previous !== state.playerId) {
    state.kind = null;
    state.hiddenYears = new Set();
  }

  state.error = null;
  state.loading = true;
  render();

  loadPlayer(playerId, { priority: 'low' })
    .then(p => { if (token === loadToken && p) { state.player = p; render(); } })
    .catch(() => { /* a name is a nicety, not the page */ });

  const thisYear = new Date().getFullYear();
  let empties = 0;

  for (let year = thisYear; year > YEAR_FLOOR; year--) {
    let tournaments;
    try {
      tournaments = await loadSeason(playerId, year);
    } catch (e) {
      // BWF's API is undocumented and can change without notice. Say so plainly
      // rather than showing a blank page.
      if (token !== loadToken) return;
      state.error = 'Could not load from BWF: ' + e.message
        + '. The API is unofficial and may have changed.';
      state.loading = false;
      render();
      return;
    }
    if (token !== loadToken) return;

    if (!tournaments.length) {
      // A gap mid-career is normal — an injury, a year out — so one empty
      // season is not the end of a career. A run of them is.
      //
      // But only once something has been found: a player who retired in 2020
      // has two empty years before their career even starts, and stopping on
      // those would show them as having never played.
      if (state.seasons.length && ++empties >= EMPTY_RUN) break;
      continue;
    }

    empties = 0;
    applyLevelDefaults(tournaments);
    state.seasons.push({ year, tournaments });
    state.kinds = seasonKinds(allTournaments());
    if (!state.kind || !state.kinds.some(k => k.kind === state.kind)) {
      state.kind = defaultKind(allTournaments());
    }
    render();
  }

  if (token !== loadToken) return;
  state.loading = false;
  render();
}

/**
 * Fetch the real ladder for the tournaments in one season row.
 *
 * One call per tournament, so a whole career would be hundreds — which is why
 * this is driven by what has actually scrolled into view rather than run over
 * everything at once. Squares are drawn with the inferred fill first and
 * corrected when the sizes land; for most of them nothing visibly moves. Draw
 * sizes are immutable history, so the twelve-hour cache means a season costs
 * this once.
 */
async function loadLadders(year) {
  const token = loadToken;
  const season = state.seasons.find(s => s.year === year);
  if (!season) return;

  const wanted = season.tournaments.filter(t =>
    t.code && !t.team && levelShown(t.cat) && !state.draws.has(t.code));
  if (!wanted.length) return;

  // Claim them first, so a second scroll past the same row does not ask again.
  for (const t of wanted) state.draws.set(t.code, undefined);

  await Promise.all(wanted.map(async t => {
    try { state.draws.set(t.code, await loadDraws(t.code)); }
    catch { state.draws.set(t.code, null); }      // keeps the inferred fill
  }));

  if (token !== loadToken) return;
  renderSeasons();
}

/* Only the rows someone has actually looked at cost requests. */
const rowWatcher = 'IntersectionObserver' in window
  ? new IntersectionObserver(entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        rowWatcher.unobserve(e.target);
        loadLadders(Number(e.target.dataset.year));
      }
    }, { rootMargin: '200px' })
  : null;

function watchRows() {
  if (!rowWatcher) {
    for (const s of visibleSeasons()) loadLadders(s.year);
    return;
  }
  for (const row of document.querySelectorAll('.srow')) rowWatcher.observe(row);
}

/* ============================ player search ============================ */

let searchSeq = 0;
let searchTimer = null;

function renderSuggestions() {
  const box = $('suggest');
  const list = state.suggestions;
  if (!list) {
    box.hidden = true;
    box.innerHTML = '';
    $('q').setAttribute('aria-expanded', 'false');
    return;
  }
  box.innerHTML = list.length
    ? list.map((p, i) => `<li role="option" data-id="${esc(p.id)}" data-i="${i}"`
      + ` aria-selected="${i === state.highlighted}">`
      + `<span>${esc(p.name)}</span><span class="cc">${esc(p.countryCode)}</span></li>`).join('')
    : '<li class="none">No player of that name</li>';
  box.hidden = false;
  $('q').setAttribute('aria-expanded', 'true');
}

function closeSuggestions() {
  state.suggestions = null;
  state.highlighted = -1;
  renderSuggestions();
}

/**
 * Search runs on a delay, and only the newest keystroke's answer is used. The
 * lookup is a single call, but it is still BWF's server: typing "axelsen"
 * should cost one request, not seven.
 */
function onType() {
  const q = $('q').value.trim();
  clearTimeout(searchTimer);
  if (q.length < 2) { closeSuggestions(); return; }

  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    try {
      const found = await searchPlayers(q);
      if (seq !== searchSeq) return;            // a later keystroke already won
      state.suggestions = found.slice(0, 12);
      state.highlighted = found.length ? 0 : -1;
      renderSuggestions();
    } catch {
      if (seq === searchSeq) closeSuggestions();
    }
  }, 320);
}

function choose(player) {
  if (!player) return;
  state.player = player;
  $('q').value = player.name;
  closeSuggestions();
  loadCareer(player.id);
  writeHash();
}

$('q').addEventListener('input', onType);

$('q').addEventListener('keydown', e => {
  const list = state.suggestions;
  if (!list || !list.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const step = e.key === 'ArrowDown' ? 1 : -1;
    state.highlighted = (state.highlighted + step + list.length) % list.length;
    renderSuggestions();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    choose(list[state.highlighted] || list[0]);
  } else if (e.key === 'Escape') {
    closeSuggestions();
  }
});

$('suggest').addEventListener('mousedown', e => {
  // mousedown rather than click: the input's blur would close the list before a
  // click ever landed on it.
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  e.preventDefault();
  choose(state.suggestions[Number(li.dataset.i)]);
});

$('q').addEventListener('blur', () => setTimeout(closeSuggestions, 150));

$('pick').addEventListener('submit', e => {
  e.preventDefault();
  const list = state.suggestions;
  if (list && list.length) choose(list[Math.max(0, state.highlighted)]);
});

/* ============================ filters ============================ */

// Size is a user toggle, on by default, and it is only a redraw.
$('sized').addEventListener('change', () => {
  state.sized = $('sized').checked;
  writeHash();
  renderSeasons();
});

$('kindWrap').addEventListener('click', e => {
  const b = e.target.closest('[data-kind]');
  if (!b) return;
  state.kind = b.dataset.kind;
  writeHash();
  render();
});

$('years').addEventListener('click', e => {
  const b = e.target.closest('[data-year]');
  if (!b) return;
  const year = Number(b.dataset.year);
  if (state.hiddenYears.has(year)) state.hiddenYears.delete(year);
  else state.hiddenYears.add(year);
  writeHash();
  render();
});

$('levels').addEventListener('click', e => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  const cat = b.dataset.cat;         // a string: most are numeric ids, "OLY" is not
  state.touchedLevels.add(cat);
  if (state.hiddenLevels.has(cat)) state.hiddenLevels.delete(cat);
  else state.hiddenLevels.add(cat);
  writeHash();
  render();
});

/* ============================ hash routing ============================

   #p=57945&k=doubles&sz=0&hy=2019.2018&hl=21 — enough to link to a career
   exactly as it is on screen, and enough for a suite to open one directly.
   ================================================================== */

function readHash() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (h.has('k')) state.kind = h.get('k');
  if (h.has('sz')) { state.sized = h.get('sz') !== '0'; $('sized').checked = state.sized; }
  if (h.has('hy')) state.hiddenYears = new Set(h.get('hy').split('.').map(Number).filter(Boolean));
  if (h.has('hl')) {
    state.hiddenLevels = new Set(h.get('hl').split('.').filter(Boolean));
    state.touchedLevels = new Set(state.hiddenLevels);
  }
  return h.get('p');
}

function writeHash() {
  if (!state.playerId) return;
  const p = new URLSearchParams();
  p.set('p', state.playerId);
  if (state.kind) p.set('k', state.kind);
  if (!state.sized) p.set('sz', '0');
  if (state.hiddenYears.size) p.set('hy', [...state.hiddenYears].join('.'));
  if (state.hiddenLevels && state.hiddenLevels.size) p.set('hl', [...state.hiddenLevels].join('.'));
  const next = '#' + p.toString();
  if (location.hash !== next) history.replaceState(null, '', next);
}

window.addEventListener('hashchange', () => {
  // readHash has just applied whatever filters the new hash carries, so they
  // are kept rather than reset.
  const p = readHash();
  if (p && p !== state.playerId) loadCareer(p, { keepFilters: true });
  else render();
});

/* The suites' seam into the running app: they assert on real state produced by
   a real fetch and on the real geometry the browser laid out, not on a
   re-implementation of either. */
window.BST = {
  state,
  get ready() { return !!state.playerId && !state.loading && queueDepth() === 0; },
  seasons: () => state.seasons,
  visible: visibleSeasons,
  suggestions: () => state.suggestions,
  rounds: (code, drawName) => {
    const t = allTournaments().find(x => x.code === code);
    return t ? roundsFor(t, drawName) : null;
  },
  /** What the rows are actually showing, read back off the DOM. */
  squares: year => {
    const sel = year ? `.srow[data-year="${year}"] .sq` : '.srow .sq';
    return [...document.querySelectorAll(sel)].map(sq => {
      const box = sq.querySelector('.box');
      const r = box.getBoundingClientRect();
      return {
        year: Number(sq.closest('.srow').dataset.year),
        name: sq.querySelector('.tn').textContent,
        level: sq.querySelector('.lv').textContent,
        label: box.textContent.trim(),
        tier: (box.className.match(/r-([\w]+)/) || [])[1],
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        slot: Math.round(sq.getBoundingClientRect().width * 10) / 10,
        font: Math.round(parseFloat(getComputedStyle(box).fontSize) * 10) / 10,
        pct: box.style.getPropertyValue('--pct'),
        href: sq.getAttribute('href') || '',
        title: sq.getAttribute('title') || '',
      };
    });
  },
  loadLadders,
  search: searchPlayers,
};

const initial = readHash();
if (initial) loadCareer(initial);
else $('q').focus();
