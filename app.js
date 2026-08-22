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

import {
  loadSeason, loadPlayer, loadDraws, searchPlayers, loadTopRanked,
  loadWorldRank, loadRaceRank, loadLastMatch, rankingFor,
  RANKING_CATEGORIES, queueDepth,
} from './api.js';
import {
  positionInfo, fillFraction, drawForKind, dominantDraw, seasonKinds,
  defaultKind, seasonLevels, levelLabel, levelAbbr, boxSize, isTeamEvent,
  drawLadder, BOX_H, LEVEL, LEVEL_ORDER,
  careerRows, gridSections, sectionCells, gridYears, gridGroupLabel, seasonLabels,
  seasonResults, tournamentSeason,
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
  ranks: null,           // {draw, world, race, pair} once looked up
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
function square(tmt, kind, preferred, label) {
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

  const inner = `<span class="tn">${esc(label != null ? label : tmt.short)}</span>`
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
    // Labels are chosen for the row as a whole, not per square: two tournaments
    // that tidy to the same words have to be told apart, and a square cannot
    // know that on its own.
    const labels = seasonLabels(s.tournaments);
    const squares = s.tournaments.map((t, i) => square(t, kind, preferred, labels[i])).join('');
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

/**
 * Level filters, with a tail.
 *
 * A long career carries a dozen category ids from the Superseries era that this
 * project has no name or weight for. As chips they crowded out the levels
 * anybody actually filters by, so the named levels stay as buttons and the rest
 * go behind a menu of checkboxes — visible enough to switch off, quiet enough
 * to ignore.
 */
function renderLevels() {
  const all = allTournaments();
  const present = seasonLevels(all);
  const named = present.filter(c => LEVEL_ORDER.includes(c));
  const rest = present.filter(c => !LEVEL_ORDER.includes(c));
  const count = c => all.filter(t => t.cat === c).length;

  $('levels').innerHTML = named.map(c => {
    const on = levelShown(c);
    const team = isTeamEvent(c);
    return `<button type="button" class="chip${on ? ' on' : ''}${team ? ' team' : ''}"`
      + ` data-cat="${c}" aria-pressed="${on}">${esc(levelLabel(c))}`
      + `<span class="n">${count(c)}</span></button>`;
  }).join('');

  const btn = $('moreBtn');
  btn.hidden = !rest.length;
  if (!rest.length) { $('morePanel').hidden = true; $('morePanel').innerHTML = ''; return; }

  const off = rest.filter(c => !levelShown(c)).length;
  btn.innerHTML = `${rest.length} more${off ? ` · ${off} off` : ''} <span class="caret">▾</span>`;
  $('morePanel').innerHTML = rest.map(c =>
    `<label><input type="checkbox" data-cat="${c}"${levelShown(c) ? ' checked' : ''}>`
    + `<span>${esc(levelLabel(c))}</span><span class="n">${count(c)}</span></label>`).join('');
}

/* ---------- who you are looking at ---------- */

function renderHero() {
  const hero = $('hero');
  if (!state.playerId) { hero.hidden = true; return; }
  hero.hidden = false;

  const p = state.player;
  $('heroName').textContent = p ? p.name : `Player ${state.playerId}`;

  const avatar = $('heroAvatar');
  if (p && p.avatar) { avatar.src = p.avatar; avatar.alt = p.name; avatar.hidden = false; }
  else { avatar.hidden = true; avatar.removeAttribute('src'); }

  const flag = $('heroFlag');
  if (p && p.flag) { flag.src = p.flag; flag.alt = p.country; flag.hidden = false; }
  else { flag.hidden = true; flag.removeAttribute('src'); }

  const n = state.seasons.length;
  const r = state.ranks;
  const bits = [];
  if (p && p.country) bits.push(p.country);
  if (p && p.age != null) bits.push(`${p.age}`);
  if (r && r.world != null) bits.push(`${r.draw} #${r.world}${r.pair ? '*' : ''}`);
  if (r && r.race != null) bits.push(`Race #${r.race}`);
  bits.push(`${n} season${n === 1 ? '' : 's'}`);
  if (state.loading) bits.push('loading…');
  else if (n) bits.push(`${allTournaments().length} tournaments`);
  $('heroMeta').textContent = bits.join(' · ');

  // A doubles ranking belongs to the pair, and BWF only files it against one
  // half of it. Saying so beats quietly presenting somebody else's number as
  // this player's.
  $('heroMeta').title = r && r.pair
    ? `BWF files this doubles ranking against ${r.pair} — it is the pair's, not one player's`
    : '';
}

function setStatus(text, isError) {
  const el = $('status');
  el.textContent = text;
  el.className = isError ? 'error' : '';
}

function render() {
  if (state.error) { setStatus(state.error, true); return; }

  // The heading carries who and how much; the status line is left for things
  // that are actually worth a sentence.
  setStatus('');
  renderHero();
  renderKinds();
  renderYears();
  renderLevels();
  renderSeasons();
  watchRows();
  if (grid.open) renderGrid();
}

/* ============================ loading ============================ */

/**
 * Walk back year by year from the current one, handing each season to
 * `onSeason` as it arrives rather than collecting the whole career first.
 *
 * Nothing says which years a player competed in, so the only way to find out is
 * to ask. That is one request per year at 320ms apart, which is exactly why the
 * rows appear one at a time instead of after twenty of them have landed.
 *
 * `alive` is re-checked after every await. A reader who picks somebody else
 * halfway through leaves this walk running — it must stop rendering into a page
 * that has moved on, and it must not be the thing that decides the page is
 * finished loading.
 *
 * Errors are thrown, not swallowed: BWF's API is unofficial and a caller that
 * cannot say why a career is empty should not pretend it is.
 */
async function walkCareer(playerId, onSeason, alive = () => true, opts = {}) {
  const thisYear = new Date().getFullYear();
  let found = 0;
  let empties = 0;

  for (let year = thisYear; year > YEAR_FLOOR; year--) {
    const tournaments = await loadSeason(playerId, year, opts);
    if (!alive()) return;

    if (!tournaments.length) {
      // A gap mid-career is normal — an injury, a year out — so one empty
      // season is not the end of a career. A run of them is.
      //
      // But only once something has been found: a player who retired in 2020
      // has two empty years before their career even starts, and stopping on
      // those would show them as having never played.
      if (found && ++empties >= EMPTY_RUN) break;
      continue;
    }

    empties = 0;
    found++;
    onSeason(year, tournaments);
    if (!alive()) return;
  }
}

/** The walk above, wired into the main view's state and rendered as it lands. */
async function loadCareer(playerId, { keepFilters = false } = {}) {
  // A player id is a number. Anything else — a hand-edited hash, a stale link —
  // would otherwise walk twenty years of requests to discover that nobody by
  // that name ever played.
  if (!/^\d+$/.test(String(playerId))) return;
  const token = ++loadToken;
  const previous = state.playerId;
  state.playerId = String(playerId);
  // Whoever was picked already carries a name; keep it so the heading says who
  // this is from the first frame rather than flashing an id until the summary
  // lands a second later.
  if (!state.player || state.player.id !== state.playerId) state.player = null;
  state.seasons = [];
  state.kinds = [];
  state.ranks = null;

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

  try {
    await walkCareer(playerId, (year, tournaments) => {
      applyLevelDefaults(tournaments);
      state.seasons.push({ year, tournaments });
      state.kinds = seasonKinds(allTournaments());
      if (!state.kind || !state.kinds.some(k => k.kind === state.kind)) {
        state.kind = defaultKind(allTournaments());
      }
      render();
    }, () => token === loadToken);
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
  state.loading = false;
  render();
  loadRanks(token);
}

/**
 * The player's current standing, once their discipline is known.
 *
 * Both of these depend on which draw they play, so neither can be asked before
 * the season has told us — and neither may be cached against the player alone,
 * because BWF answers "-" for a discipline they do not play rather than
 * refusing the question.
 */
/**
 * @param {function} nameOf  the display name, read *late*.
 *
 * ⚠️ Not the name itself. The Race standing is looked up by searching the
 * ranking table for the player's name, and the name arrives on its own
 * unawaited low-lane request. Reading it up front caught it as `undefined`
 * often enough to silently switch the Race standing off — it only ever worked
 * because the world-ranking round trip happened to take longer than the
 * summary. So it is read at the moment it is needed, and if it still is not
 * there the summary is awaited outright: that call is already in flight and
 * cached, so asking for it costs nothing.
 */
async function fetchRanks(playerId, tournaments, kind, nameOf) {
  const draw = dominantDraw(tournaments, kind);
  const cat = rankingFor(draw);
  if (!cat) return null;

  const ranks = { draw, world: null, race: null, pair: null };

  try {
    ranks.world = await loadWorldRank(playerId, cat.id);

    // A doubles ranking only resolves against player1_id, and in mixed doubles
    // BWF stores the man as player1 — so asking as the woman returns nothing at
    // all. Retry through the partner and say whose number it is.
    if (ranks.world == null && cat.doubles) {
      const last = await loadLastMatch(playerId, { priority: 'low' });
      const partner = last && last.partner;
      if (partner) {
        const viaPartner = await loadWorldRank(partner.id, cat.id);
        if (viaPartner != null) { ranks.world = viaPartner; ranks.pair = partner.name; }
      }
    }
  } catch { /* a ranking is a nicety, not the page */ }

  try {
    let name = nameOf && nameOf();
    if (!name) {
      const p = await loadPlayer(playerId, { priority: 'low' });
      name = p && p.name;
    }
    ranks.race = await loadRaceRank(playerId, name, cat.race);
  } catch { /* likewise */ }

  return ranks;
}

async function loadRanks(token) {
  const ranks = await fetchRanks(state.playerId, allTournaments(), state.kind,
    () => state.player && state.player.name);
  if (token !== loadToken || !ranks) return;
  state.ranks = ranks;
  renderHero();
  if (grid.open) renderGrid();
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

/* ============================ the career grid ============================

   The same seasons, re-indexed by tournament: a row per year, a column per
   event, every cell the same size and filled solid. Deliberately less
   informative than the strip — no sizes, no partial fills, no labels — because
   what it is for is the shape of a career at a glance, and detail is what gets
   in the way of that. The model settles which columns exist and what each cell
   means; this draws them and handles the second player.
   ==================================================================== */

const grid = {
  open: false,
  kind: null,                    // null = follow the main view's discipline
  hiddenGroups: new Set(),       // column groups switched off
  pending: null,                 // a compare id from the hash, waiting to load
};

/* The second career, held well apart from `state`. A comparison is a view of
   two players, and folding the second one into the first's state is how a
   compare feature starts quietly changing what the page underneath it says. */
const cmp = {
  playerId: null,
  player: null,
  seasons: [],
  ranks: null,
  loading: false,
  error: null,
  suggestions: null,
  highlighted: -1,
};
let cmpToken = 0;

/** The careers on screen, in order: the page's player, then the comparison. */
function careers() {
  const list = [{
    id: state.playerId, player: state.player, seasons: state.seasons,
    ranks: state.ranks, loading: state.loading, error: null, second: false,
  }];
  if (cmp.playerId) list.push({
    id: cmp.playerId, player: cmp.player, seasons: cmp.seasons,
    ranks: cmp.ranks, loading: cmp.loading, error: cmp.error, second: true,
  });
  return list;
}

/**
 * The discipline one career's grid is drawn in.
 *
 * One toggle governs both grids, because a comparison drawn in two different
 * disciplines is not a comparison. But a player who does not play the chosen
 * one falls back to their own rather than showing an empty grid — comparing a
 * singles player with a doubles player is a fair thing to want, and the card
 * says which discipline it is showing.
 */
function gridKindFor(seasons) {
  const all = (seasons || []).flatMap(s => s.tournaments);
  const want = grid.kind || state.kind;
  const has = seasonKinds(all).map(k => k.kind);
  return has.includes(want) ? want : (defaultKind(all) || want);
}

/**
 * One cell.
 *
 * There is no text anywhere in the grid, so the tooltip is the whole of the
 * detail: which tournament this was and how it went. A padded slot names the
 * section instead, because that is all it is — one more Super 750 they did not
 * play that year.
 */
function cellHtml(cell, year) {
  // The opening slot of a section is the only place the grid draws a line.
  const cls = `cell r-${cell.tier}${cell.first ? ' edge' : ''}`;
  const attrs = ` data-group="${esc(String(cell.group))}" data-slot="${cell.slot}"`;

  if (!cell.tmt) {
    return `<i class="${cls}"${attrs}`
      + ` title="${esc(`${year} — no ${cell.section.label} result here`)}"></i>`;
  }
  const wl = cell.draw.win != null ? ` · ${cell.draw.win}-${cell.draw.lose}` : '';
  return `<i class="${cls}"${attrs}`
    + ` title="${esc(`${cell.tmt.name}\n${cell.info.full}${wl}`)}"></i>`;
}

/** Who the grid belongs to: the same identity block as the page's heading. */
function gridProfile(career) {
  const p = career.player;
  const r = career.ranks;
  const kind = gridKindFor(career.seasons);
  const n = career.seasons.length;

  const bits = [];
  if (p && p.country) bits.push(p.country);
  if (p && p.age != null) bits.push(`${p.age}`);
  if (r && r.world != null) bits.push(`${r.draw} #${r.world}${r.pair ? '*' : ''}`);
  if (r && r.race != null) bits.push(`Race #${r.race}`);
  if (kind) bits.push(kind);
  // Both, not one or the other: a career that is half in should say how much of
  // it has arrived as well as that more is coming.
  if (n) bits.push(`${n} season${n === 1 ? '' : 's'}`);
  if (career.loading) bits.push('loading…');

  return '<header class="gprofile">'
    + (p && p.avatar ? `<img class="avatar" src="${esc(p.avatar)}" alt="">` : '<span class="avatar"></span>')
    + '<div class="ident">'
    + `<h3 class="who">${esc(p ? p.name : `Player ${career.id}`)}</h3>`
    + '<p class="meta">'
    + (p && p.flag ? `<img class="flag" src="${esc(p.flag)}" alt="${esc(p.country)}">` : '')
    + `<span>${esc(bits.join(' · '))}</span></p></div>`
    + (career.second ? '<button type="button" id="cmpDrop" class="seg close"'
      + ' aria-label="remove this comparison">✕</button>' : '')
    + '</header>';
}

/** The band above the grid that says which stretch of slots is which level. */
function tierBand(sections) {
  return `<div class="gtiers">${sections.map(s =>
    `<span class="gt" style="--n:${s.n}"`
    + ` title="${esc(`${s.label} — ${s.n} slot${s.n === 1 ? '' : 's'}`)}">`
    + `${esc(s.code)}</span>`).join('')}</div>`;
}

function gridCard(career, sections, years) {
  const byYear = new Map(career.rows.map(r => [r.year, r.by]));

  const rows = years.map(y => {
    const cells = sectionCells(byYear.get(y), sections);
    return `<div class="grow" data-year="${y}"><span class="gy">${y}</span>`
      + cells.map(c => cellHtml(c, y)).join('') + '</div>';
  }).join('');

  const note = career.error ? `<p class="gnote error">${esc(career.error)}</p>`
    : (!years.length && !career.loading) ? '<p class="gnote">Nothing to show yet.</p>' : '';

  return `<section class="gcard" data-player="${esc(career.id)}">`
    + gridProfile(career) + tierBand(sections)
    + `<div class="gmatrix">${rows}</div>${note}</section>`;
}

function renderGridGroups(sections) {
  $('gridGroups').innerHTML = sections.map(s => {
    const on = !grid.hiddenGroups.has(String(s.group));
    return `<button type="button" class="chip${on ? ' on' : ''}"`
      + ` data-group="${esc(String(s.group))}" aria-pressed="${on}"`
      + ` title="${esc(`${s.label} — ${s.n} slot${s.n === 1 ? '' : 's'},`
        + ' the most anyone here played in one season')}">`
      + `${esc(s.label)}<span class="n">${s.n}</span></button>`;
  }).join('');
}

function renderGridKinds() {
  const all = careers().flatMap(c => c.seasons).flatMap(s => s.tournaments);
  const kinds = seasonKinds(all);
  const active = grid.kind || state.kind;
  $('gridKind').innerHTML = kinds.length < 2 ? '' : kinds.map(k =>
    `<button type="button" class="seg${k.kind === active ? ' on' : ''}"`
    + ` data-gkind="${k.kind}" aria-pressed="${k.kind === active}">${esc(k.kind)}</button>`).join('');
}

function renderGrid() {
  if (!grid.open) return;
  const list = careers();

  // Every career's season bucketed by section, once. Both the widths and the
  // cells are read off this, so a row cannot be laid out against widths that
  // were measured from something else.
  for (const c of list) {
    const kind = gridKindFor(c.seasons);
    const preferred = dominantDraw(c.seasons.flatMap(s => s.tournaments), kind);
    c.rows = careerRows(c.seasons, kind, preferred);
  }

  // Widths are measured across *both* careers and then filtered, so the two
  // grids line up and the chip counts do not move when one section is hidden.
  const sections = gridSections(list.map(c => c.rows.map(r => r.by)));
  const shown = sections.filter(s => !grid.hiddenGroups.has(String(s.group)));
  const years = gridYears(list.map(c => c.rows));

  renderGridGroups(sections);
  renderGridKinds();

  const body = $('gridBody');
  body.classList.toggle('two', list.length > 1);
  // "Nothing is loaded yet" and "you have switched everything off" both leave no
  // sections, and they are not the same thing to be told.
  body.innerHTML = shown.length ? list.map(c => gridCard(c, shown, years)).join('')
    : sections.length ? '<p class="gnote">Every level is switched off.</p>'
    : list.some(c => c.loading) ? '<p class="gnote">Loading the career…</p>'
    : '<p class="gnote">Nothing here reaches Super 100, which is where the grid starts.</p>';
}

function openGrid() {
  grid.open = true;
  const d = $('gridModal');
  if (!d.open) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
  renderGrid();
  writeHash();
}

function closeGrid() {
  grid.open = false;
  const d = $('gridModal');
  if (d.close && d.open) d.close(); else d.removeAttribute('open');
  writeHash();
}

/** Load a second whole career, rendering it into the grid as it arrives. */
async function loadCompare(player) {
  if (!player || !/^\d+$/.test(String(player.id))) return;
  const token = ++cmpToken;
  cmp.playerId = String(player.id);
  cmp.player = player.name ? player : null;
  cmp.seasons = [];
  cmp.ranks = null;
  cmp.error = null;
  cmp.loading = true;
  $('cmpQ').value = player.name || '';
  renderGrid();
  writeHash();

  loadPlayer(cmp.playerId, { priority: 'low' })
    .then(p => { if (token === cmpToken && p) { cmp.player = p; renderGrid(); } })
    .catch(() => { /* a name is a nicety */ });

  try {
    await walkCareer(cmp.playerId, (year, tournaments) => {
      cmp.seasons.push({ year, tournaments });
      renderGrid();
    }, () => token === cmpToken);
  } catch (e) {
    if (token !== cmpToken) return;
    cmp.error = 'Could not load from BWF: ' + e.message;
  }

  if (token !== cmpToken) return;
  renderGrid();

  // `loading` stays true across the ranking lookups, not just the career walk.
  // It is what says whether this card is finished, and a card that says it is
  // done and then grows a world ranking a second later was not.
  const ranks = await fetchRanks(cmp.playerId, cmp.seasons.flatMap(s => s.tournaments),
    gridKindFor(cmp.seasons), () => cmp.player && cmp.player.name);
  if (token !== cmpToken) return;
  cmp.ranks = ranks;
  cmp.loading = false;
  renderGrid();
}

function removeCompare() {
  cmpToken++;                     // abandons a walk that is still running
  cmp.playerId = null;
  cmp.player = null;
  cmp.seasons = [];
  cmp.ranks = null;
  cmp.loading = false;
  cmp.error = null;
  $('cmpQ').value = '';
  renderGrid();
  writeHash();
}

wireSearch({
  input: $('cmpQ'), list: $('cmpSuggest'), form: $('cmpPick'), store: cmp,
  onPick: loadCompare,
});

/* ---------- zoom ----------

   How big a cell is is a viewing preference, not part of what the grid says, so
   it lives in localStorage rather than in the hash: a shared link should open on
   the reader's own zoom, not on whatever the sender happened to be using. */

const ZOOM_KEY = 'bst:gridzoom';
const ZOOM_DEFAULT = 20;

function setZoom(px, save = true) {
  const n = Math.max(10, Math.min(40, Number(px) || ZOOM_DEFAULT));
  $('gridZoom').value = String(n);
  $('gridBody').style.setProperty('--cell', n + 'px');
  if (save) { try { localStorage.setItem(ZOOM_KEY, String(n)); } catch { /* private mode */ } }
}

$('gridZoom').addEventListener('input', e => setZoom(e.target.value));

let saved = null;
try { saved = localStorage.getItem(ZOOM_KEY); } catch { /* private mode */ }
setZoom(saved || ZOOM_DEFAULT, false);

$('gridBtn').addEventListener('click', openGrid);
$('gridClose').addEventListener('click', closeGrid);
// Escape, the backdrop and the close button all route through the same place,
// so the hash cannot be left claiming the grid is open when it is not.
$('gridModal').addEventListener('close', () => {
  if (!grid.open) return;
  grid.open = false;
  writeHash();
});
$('gridModal').addEventListener('click', e => {
  // A click on the dialog element itself is a click on the backdrop: the
  // content is all in children.
  if (e.target === $('gridModal')) closeGrid();
});

$('gridGroups').addEventListener('click', e => {
  const b = e.target.closest('[data-group]');
  if (!b) return;
  const g = b.dataset.group;
  if (grid.hiddenGroups.has(g)) grid.hiddenGroups.delete(g);
  else grid.hiddenGroups.add(g);
  renderGrid();
  writeHash();
});

$('gridKind').addEventListener('click', e => {
  const b = e.target.closest('[data-gkind]');
  if (!b) return;
  grid.kind = b.dataset.gkind;
  renderGrid();
  writeHash();
});

$('gridBody').addEventListener('click', e => {
  if (e.target.closest('#cmpDrop')) removeCompare();
});

/* ============================ player search ============================ */

/**
 * A type-ahead over BWF's player database, bound to one input and one list.
 *
 * A factory rather than a block of top-level code because there are two of
 * them: the one that decides whose career is on the page, and the one in the
 * grid that picks somebody to compare them against. They differ only in what
 * they do with the answer, and a second copy of the keyboard handling would be
 * a second place for it to drift.
 *
 * `store` is where the current suggestions live, so the main search can keep
 * them on `state` — which is where the suites and the recorder read them from.
 */
function wireSearch({ input, list, form, store, onPick }) {
  let seq = 0;
  let timer = null;

  function draw() {
    const rows = store.suggestions;
    if (!rows) {
      list.hidden = true;
      list.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
      return;
    }
    list.innerHTML = rows.length
      ? rows.map((p, i) => `<li role="option" data-id="${esc(p.id)}" data-i="${i}"`
        + ` aria-selected="${i === store.highlighted}">`
        + (p.flag ? `<img class="flag" src="${esc(p.flag)}" alt="">` : '')
        + `<span>${esc(p.name)}</span><span class="cc">${esc(p.countryCode)}</span></li>`).join('')
      : '<li class="none">No player of that name</li>';
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function close() {
    store.suggestions = null;
    store.highlighted = -1;
    draw();
  }

  function pick(player) {
    if (!player) return;
    close();
    onPick(player);
  }

  /* Search runs on a delay, and only the newest keystroke's answer is used. The
     lookup is a single call, but it is still BWF's server: typing "axelsen"
     should cost one request, not seven. */
  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(timer);
    if (q.length < 2) { close(); return; }

    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const found = await searchPlayers(q);
        if (mine !== seq) return;               // a later keystroke already won
        store.suggestions = found.slice(0, 12);
        store.highlighted = found.length ? 0 : -1;
        draw();
      } catch {
        if (mine === seq) close();
      }
    }, 320);
  });

  input.addEventListener('keydown', e => {
    const rows = store.suggestions;
    if (!rows || !rows.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      store.highlighted = (store.highlighted + step + rows.length) % rows.length;
      draw();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(rows[store.highlighted] || rows[0]);
    } else if (e.key === 'Escape') {
      // Swallowed, so the first Escape closes the list rather than the dialog
      // the list is sitting in.
      e.stopPropagation();
      close();
    }
  });

  list.addEventListener('mousedown', e => {
    // mousedown rather than click: the input's blur would close the list before
    // a click ever landed on it.
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    e.preventDefault();
    pick(store.suggestions[Number(li.dataset.i)]);
  });

  input.addEventListener('blur', () => setTimeout(close, 150));

  form.addEventListener('submit', e => {
    e.preventDefault();
    const rows = store.suggestions;
    if (rows && rows.length) pick(rows[Math.max(0, store.highlighted)]);
  });

  return { close, draw };
}

/** Put a player on the page. */
function choose(player) {
  if (!player) return;
  state.player = player.name ? player : null;
  $('q').value = player.name || '';
  loadCareer(player.id);
  writeHash();
}

const mainSearch = wireSearch({
  input: $('q'), list: $('suggest'), form: $('pick'), store: state, onPick: choose,
});

/* ============================ top ranked ============================

   A shortcut to the players most people arrive looking for, so the search box
   is not the only way in. One call per discipline, only when its tab is opened,
   cached for twelve hours — rankings move once a week.
   ================================================================= */

const topCache = new Map();          // ranking category id -> rows
let topCat = RANKING_CATEGORIES[0].id;

function renderTopTabs() {
  $('topTabs').innerHTML = RANKING_CATEGORIES.map(c =>
    `<button type="button" role="tab" data-cat="${c.id}"`
    + ` class="${c.id === topCat ? 'on' : ''}" aria-selected="${c.id === topCat}"`
    + ` title="${esc(c.label)}">${c.code}</button>`).join('');
}

function renderTopList() {
  const rows = topCache.get(topCat);
  if (!rows) { $('topList').innerHTML = '<li class="loading">Loading…</li>'; return; }
  if (!rows.length) { $('topList').innerHTML = '<li class="loading">No ranking available</li>'; return; }

  $('topList').innerHTML = rows.map(r => {
    // A doubles row is a pair, and either half may be the one being looked for,
    // so both are offered rather than guessing at the first.
    const players = r.players.map(p =>
      (p.flag ? `<img class="flag" src="${esc(p.flag)}" alt="${esc(p.country)}">` : '')
      + `<button type="button" class="pl" data-id="${esc(p.id)}"`
      + ` data-name="${esc(p.name)}">${esc(p.name)}</button>`).join('<span class="sep">/</span>');
    return `<li><span class="rk">${esc(r.rank)}</span>${players}</li>`;
  }).join('');
}

async function showTop(catId) {
  topCat = Number(catId);
  renderTopTabs();
  renderTopList();
  if (topCache.has(topCat)) return;
  try {
    topCache.set(topCat, await loadTopRanked(topCat));
  } catch {
    topCache.set(topCat, []);        // an empty list says so; a spinner forever does not
  }
  if (!$('topPanel').hidden) renderTopList();
}

function openPanel(btn, panel, open) {
  panel.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
}

$('topBtn').addEventListener('click', () => {
  const open = $('topPanel').hidden;
  openPanel($('topBtn'), $('topPanel'), open);
  if (open) showTop(topCat);
});

$('topTabs').addEventListener('click', e => {
  const b = e.target.closest('[data-cat]');
  if (b) showTop(b.dataset.cat);
});

$('topList').addEventListener('click', e => {
  const b = e.target.closest('.pl');
  if (!b) return;
  openPanel($('topBtn'), $('topPanel'), false);
  choose({ id: b.dataset.id, name: b.dataset.name });
});

$('moreBtn').addEventListener('click', () => {
  openPanel($('moreBtn'), $('morePanel'), $('morePanel').hidden);
});

$('morePanel').addEventListener('change', e => {
  const box = e.target.closest('input[data-cat]');
  if (!box) return;
  toggleLevel(box.dataset.cat);
});

/**
 * A panel left open over the seasons is in the way; anything outside closes it.
 *
 * Capture phase, deliberately. The handlers inside these panels redraw their own
 * contents — picking a discipline tab re-renders the tabs — so by the time a
 * bubbling listener ran, the clicked element had already been replaced and
 * detached, `closest()` found nothing above it, and the panel closed itself
 * every time somebody used it.
 */
document.addEventListener('click', e => {
  if (!e.target.closest('#topBtn, #topPanel')) openPanel($('topBtn'), $('topPanel'), false);
  if (!e.target.closest('#moreBtn, #morePanel')) openPanel($('moreBtn'), $('morePanel'), false);
}, true);
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  openPanel($('topBtn'), $('topPanel'), false);
  openPanel($('moreBtn'), $('morePanel'), false);
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
  state.ranks = null;          // a different discipline has a different ranking
  writeHash();
  render();
  loadRanks(loadToken);
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

/** cat is a string: most are numeric ids, "OLY" is not. */
function toggleLevel(cat) {
  state.touchedLevels.add(cat);
  if (state.hiddenLevels.has(cat)) state.hiddenLevels.delete(cat);
  else state.hiddenLevels.add(cat);
  writeHash();
  render();
}

$('levels').addEventListener('click', e => {
  const b = e.target.closest('[data-cat]');
  if (b) toggleLevel(b.dataset.cat);
});

/* ============================ hash routing ============================

   #p=57945&k=doubles&sz=0&hy=2019.2018&hl=21&g=1&c=87442 — enough to link to a
   career exactly as it is on screen, comparison and all, and enough for a suite
   to open one directly.
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
  if (h.has('gk')) grid.kind = h.get('gk');
  if (h.has('hg')) grid.hiddenGroups = new Set(h.get('hg').split('.').filter(Boolean));
  // The comparison is a whole second career — dozens of requests — so it is
  // handed back rather than started here, and only once, by whoever asked.
  grid.pending = { compare: h.get('c') || null, open: h.get('g') === '1' };
  return h.get('p');
}

/** Act on the parts of the hash that cost requests or open something. */
function applyGridHash() {
  const want = grid.pending;
  grid.pending = null;
  if (!want) return;
  if (want.compare && want.compare !== cmp.playerId) loadCompare({ id: want.compare, name: '' });
  else if (!want.compare && cmp.playerId) removeCompare();
  if (want.open && !grid.open) openGrid();
}

function writeHash() {
  if (!state.playerId) return;
  const p = new URLSearchParams();
  p.set('p', state.playerId);
  if (state.kind) p.set('k', state.kind);
  if (!state.sized) p.set('sz', '0');
  if (state.hiddenYears.size) p.set('hy', [...state.hiddenYears].join('.'));
  if (state.hiddenLevels && state.hiddenLevels.size) p.set('hl', [...state.hiddenLevels].join('.'));
  if (grid.open) p.set('g', '1');
  if (grid.kind) p.set('gk', grid.kind);
  if (grid.hiddenGroups.size) p.set('hg', [...grid.hiddenGroups].join('.'));
  if (cmp.playerId) p.set('c', cmp.playerId);
  const next = '#' + p.toString();
  if (location.hash !== next) history.replaceState(null, '', next);
}

window.addEventListener('hashchange', () => {
  // readHash has just applied whatever filters the new hash carries, so they
  // are kept rather than reset.
  const p = readHash();
  if (p && p !== state.playerId) loadCareer(p, { keepFilters: true });
  else render();
  applyGridHash();
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
  loadRanks: () => loadRanks(loadToken),
  search: searchPlayers,
  positionInfo, fillFraction,
  top: () => topCache.get(topCat) || null,
  showTop,

  /* The grid, read back the same way: its own state, and what the browser
     actually laid out rather than what the model said it should. */
  grid: {
    state: grid,
    compare: cmp,
    open: openGrid,
    close: closeGrid,
    isOpen: () => grid.open && $('gridModal').hasAttribute('open'),
    /** The sections and their widths, as the render would compute them. */
    rows: () => careers().map(c => {
      const kind = gridKindFor(c.seasons);
      return careerRows(c.seasons, kind,
        dominantDraw(c.seasons.flatMap(s => s.tournaments), kind));
    }),
    sections: () => gridSections(window.BST.grid.rows().map(rows => rows.map(r => r.by))),
    years: () => gridYears(window.BST.grid.rows()),
    seasonOf: name => tournamentSeason(
      careers().flatMap(c => c.seasons).flatMap(s => s.tournaments)
        .find(t => t.name === name) || null),
    kindFor: i => gridKindFor((careers()[i] || { seasons: [] }).seasons),
    compareWith: id => loadCompare({ id: String(id), name: '' }),
    drop: removeCompare,
    zoom: px => (px == null ? Number($('gridZoom').value) : (setZoom(px), Number($('gridZoom').value))),
    /** Every card on screen, as cells with their laid-out geometry. */
    cards: () => [...document.querySelectorAll('.gcard')].map(card => ({
      player: card.dataset.player,
      name: card.querySelector('.who').textContent,
      tiers: [...card.querySelectorAll('.gt')].map(t => t.textContent),
      years: [...card.querySelectorAll('.grow')].map(r => Number(r.dataset.year)),
      cells: [...card.querySelectorAll('.cell')].map(c => {
        const r = c.getBoundingClientRect();
        return {
          year: Number(c.closest('.grow').dataset.year),
          group: c.dataset.group,
          slot: Number(c.dataset.slot),
          tier: (c.className.match(/r-([\w]+)/) || [])[1],
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10,
          x: Math.round(r.left * 10) / 10,
          bg: getComputedStyle(c).backgroundColor,
          title: c.getAttribute('title') || '',
        };
      }),
    })),
    ready: () => !cmp.loading && !state.loading && queueDepth() === 0,
  },
};

const initial = readHash();
if (initial) loadCareer(initial);
else $('q').focus();
applyGridHash();
