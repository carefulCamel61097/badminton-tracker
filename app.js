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
  loadSeason, loadPlayer, loadDraws, searchPlayers, loadTopRanked, loadRoster,
  loadWorldRank, loadRaceRank, loadLastMatch, rankingFor,
  RANKING_CATEGORIES, queueDepth, loadSchedule, loadDayMatches, loadWinners,
  loadDrawList, loadDrawData,
} from './api.js';
import {
  positionInfo, fillFraction, drawForKind, dominantDraw, seasonKinds,
  defaultKind, seasonLevels, levelLabel, levelAbbr, boxSize, isTeamEvent,
  drawLadder, BOX_H, LEVEL, LEVEL_ORDER,
  careerRows, gridSections, sectionCells, gridYears, gridGroupLabel, seasonLabels, GRID_ORDER,
  ERAS, ERA_DEFAULT, eraKey, gridOrder,
  seasonResults, tournamentSeason,
  HONOUR_STEPS, HONOUR_DEFAULT, honourStep, honourScale, honourRung,
  careerHonours, honourSections,
  pickTournament, tournamentDays, defaultDay, parseDayMatches, orderOfPlay,
  courtGrid, drawsPresent, dayOf, matchSignature, prettyDay, tidyTmtName,
  parseDrawList, parseDraw, bracketLayout, bracketRounds, resolvedRound, surnameOf,
  rosterMatches, mergeSuggestions,
  pyramidSeason, pyramidBulges, pyramidRowWidth, pyramidSeasonMarks, pyramidLabel,
  winnersSeasons, pyramidReigns, reignLanes, REIGN_STEPS, REIGN_DEFAULT, reignStep,
  pyramidScale,
  dominationSeasons, thinSeasons, shortSeasonWhy, titleWeight, SCORE_TIERS,
  dominationRanking, rankMode, RANK_MODES, RANK_DEFAULT,
  COVID_SEASONS, isCovidSeason,
  bestScoreFloor, SCORE_FLOOR_MAX, SCORE_FLOOR_STEP,
} from './model.js';
import {
  drawPoster, posterLayout, drawScorePoster, scorePosterLayout, POSTER, TIER_RING,
  drawGridPoster, gridPosterLayout, drawHonoursPoster, honoursPosterLayout, RESULT_COLOURS,
  REIGN_COLOURS, SCORE_COLOURS, CUP_PATHS, CUP_BOX, RING_AT, RING_COLOURS, RING_BOX,
} from './poster.js';

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
/* ⚠️ **2006 is the floor because it is the first season BWF places its results.**
   The tournaments go back further — LIN Dan's 2001 is seven of them — but a
   tournament with no *position* on it is a row that can only say "Played".
   Re-measured with `tools/probe-early.mjs`, 4 Sep 2026, draws carrying a real
   placing:

     year     2001   2002   2003   2004   2005    2006     2007
     LCW      0/11    0/6   0/11   1/12    3/9   12/12    15/16
     LIN Dan   0/7    0/7   1/10   1/11    3/9   10/10    13/14

   The cliff is exactly here. 2005 is two thirds empty, 2004 is one row in
   twelve, and 2001-2002 is nothing at all. (2007 onwards never reaches 100%
   either, and should not: a team event carries no individual position.)

   ⚠⚠ **An absent position is the string `"-"`, not an empty one.** LIN Dan's
   2004 All England — a title he won — comes back as `position: "-"`. The probe
   counted that as placed until 4 Sep 2026 and so reported 2004 as a *complete*
   season, which is an argument for lowering the floor built on a bug. The model
   was never fooled: `positionInfo` reads `"-"` and `"N/A"` as "Played".

   It costs a modern career no requests at all: the empty-season run below stops
   those walks years above the floor. */
const YEAR_FLOOR = 2005;
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
  searching: false,
};

let loadToken = 0;

/* ⚠️ Declared up here, with the rest of the module's state, rather than beside
   the search code that uses them. `wireSearch` is *called* for the compare box
   several hundred lines above where it is defined — a function declaration
   hoists and a `const` does not, so leaving these next to it threw
   "Cannot access 'openBoxes' before initialization" and took the whole page
   down before `window.BST` existed. */
const roster = { players: [], loading: false, asked: false };
const openBoxes = [];

/* Players this reader has actually opened. The roster is the current top 50 of
   five ranking tables and LIN Dan is in none of them — but somebody who looked
   him up once will look him up again. */
const RECENT_KEY = 'bst:recent';
const RECENT_MAX = 30;

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
  view: 'grid',                  // 'grid' | 'honours' — two readings of one career
  kind: null,                    // null = follow the main view's discipline
  hiddenGroups: new Set(),       // column groups switched off
  threshold: HONOUR_DEFAULT,     // the honours board's bar
  /* Which vocabulary the rows are named in. A property of the view, not of a
     result: it renames rows and moves which squares are marked as translated,
     and it changes no career. See "the two eras" in the model. */
  era: ERA_DEFAULT,
  pending: null,                 // a compare id from the hash, waiting to load
  // Whether the export bar is open. A view of the page, not part of what it
  // argues, so it never reaches the hash — the same split the Winners page makes.
  exporting: false,
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
  searching: false,
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
 * One career, bucketed by season and section, in the vocabulary now on screen.
 *
 * The single place this is built. The Finals reattribution, the era translation
 * and the junior and team exclusions all settle inside `careerRows`, and the
 * grid, the honours board and both exports have to be looking at the same thing
 * or they can disagree about what a career contains.
 */
function careerGridRows(career) {
  const kind = gridKindFor(career.seasons);
  const preferred = dominantDraw(career.seasons.flatMap(s => s.tournaments), kind);
  return careerRows(career.seasons, kind, preferred, grid.era);
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
  return `<i class="${cls}${cell.from ? ' mapped' : ''}"${attrs}`
    + ` title="${esc(`${cell.tmt.name}\n${cell.info.full}${wl}`
      + (cell.from ? `\n${cell.from}, drawn as ${gridGroupLabel(cell.group, grid.era)}` : ''))}"></i>`;
}

/**
 * The line under a name: country, age, ranking, discipline, seasons.
 *
 * Its own function because the export prints the same line, and an identity
 * assembled twice is an identity that can disagree with itself.
 */
function careerMeta(career) {
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
  return bits;
}

/** Who the grid belongs to: the same identity block as the page's heading. */
function gridProfile(career) {
  const p = career.player;
  const bits = careerMeta(career);

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

function renderGridGroups(sections, honours) {
  $('gridGroups').innerHTML = sections.map(s => {
    const on = !grid.hiddenGroups.has(String(s.group));
    // The same chips, but the number on them counts a different thing in each
    // view, and a chip that says "6" without saying six of what is a chip that
    // will be misread.
    const why = honours
      ? `${s.label} — ${s.n} at ${honourStep(grid.threshold).label},`
        + ' the most either player has'
      : `${s.label} — ${s.n} slot${s.n === 1 ? '' : 's'},`
        + ' the most anyone here played in one season';
    return `<button type="button" class="chip${on ? ' on' : ''}"`
      + ` data-group="${esc(String(s.group))}" aria-pressed="${on}"`
      + ` title="${esc(why)}">`
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

/* ---------- the honours board ----------

   One row per level, only the results that cleared the bar, and the size of a
   square saying what the level was worth. See the model for why φ is applied
   to area rather than to side.

   Nothing here is laid out on a shared grid: the rows have different pitches
   by design, so a run of green in the Super 1000 row is worth more area than a
   longer run below it, which is the entire point. */

/** One honour. Sized by the row it is in, so it carries no geometry itself. */
function honourCellHtml(cell) {
  const wl = cell.draw && cell.draw.win != null ? ` · ${cell.draw.win}-${cell.draw.lose}` : '';
  return `<i class="cell r-${cell.tier}${cell.from ? ' mapped' : ''}"`
    + ` data-group="${esc(String(cell.group))}" data-year="${cell.year}"`
    + ` data-from="${esc(cell.from || '')}"`
    + ` title="${esc(`${cell.year} — ${cell.tmt.name}\n${cell.info.full}${wl}`
      + (cell.from ? `\n${cell.from}, drawn as ${gridGroupLabel(cell.group, grid.era)}` : ''))}"></i>`;
}

/**
 * One player's half of one row.
 *
 * `mirror` is the left-hand player in a comparison, whose results run outward
 * from the middle so that the two players' *best* results are the ones meeting
 * at the spine. Reading a comparison means reading from the line outwards, and
 * mirroring is what makes the two halves the same shape rather than two lists
 * that happen to point the same way.
 *
 * The count sits on the inside for the same reason: it is the one piece of
 * text worth having and it should not be the first thing to fall off the end.
 */
function honourSide(career, section, bar, mirror) {
  const h = career.honours;
  const list = h.by.get(section.group) || [];
  const entered = h.entries.get(section.group) || 0;
  const cls = `hside${mirror ? ' mirror' : ''}`;

  // An empty row is not one thing. "Played twenty Super 750s and never made a
  // quarter-final" and "never entered one" are both worth saying and they are
  // emphatically not the same sentence, so the ghost carries which it is.
  if (!list.length) {
    const why = entered ? `${entered} entered, none at ${bar.label}`
      : 'never played at this level';
    return `<div class="${cls}"><i class="hnone" data-group="${esc(String(section.group))}"`
      + ` title="${esc(`${section.label} — ${why}`)}"></i></div>`;
  }

  const cells = list.map(honourCellHtml);
  if (mirror) cells.reverse();
  const n = `<span class="hn" title="${esc(`${list.length} at ${bar.label}`
    + ` from ${entered} ${section.label}${entered === 1 ? '' : 's'}`)}">${list.length}</span>`;
  return `<div class="${cls}">${mirror ? cells.join('') + n : n + cells.join('')}</div>`;
}

function honourRow(section, list, bar) {
  const label = `<span class="hlvl" title="${esc(section.label)}">`
    + `${esc(section.short || section.label)}</span>`;
  const sides = list.map((c, i) => honourSide(c, section, bar, list.length > 1 && i === 0));
  const inner = list.length > 1 ? sides[0] + label + sides[1] : label + sides[0];
  return `<div class="hrow" data-group="${esc(String(section.group))}"`
    + ` style="--k:${section.scale.toFixed(4)}">${inner}</div>`;
}

/* The gap between squares, as a fraction of one square — the same number CSS
   uses, kept here because the board's width is computed from it. */
const HGAP = 0.09;
const HN_W = 26;      // the count, fixed width, so the arithmetic below is exact

/**
 * The widest half any row needs, in units of `--hbase`.
 *
 * Handed to CSS as a multiplier rather than a pixel width so that the zoom
 * slider — which moves `--hbase` and nothing else — keeps working without a
 * re-render. `minmax(halfw, 1fr)` then guarantees no row is ever cut short:
 * the board grows and the modal scrolls instead, which is the honest failure
 * for a view whose whole claim is how much of something there is.
 *
 * n squares carry n − 1 gaps between them and one more out to the count, so the
 * run is n × 1.09 squares wide. An empty row still needs its ghost.
 */
function honourHalfUnits(sections, list) {
  let units = 0;
  for (const s of sections) {
    for (const c of list) {
      const n = (c.honours.by.get(s.group) || []).length;
      units = Math.max(units, s.scale * (n ? 1.09 * n : 1));
    }
  }
  return units;
}

/**
 * The empty second slot.
 *
 * The page is called Compare and it should look like it even before anybody has
 * been chosen — an empty seat is a much better instruction than a search box
 * labelled "Compare with…" up in the header, which is where this used to live
 * and where nobody found it.
 *
 * It focuses that search rather than containing it: the body is re-rendered on
 * every keystroke of a career walk, and an input inside it would lose focus and
 * its value each time.
 */
function addSlot(what) {
  return `<button type="button" class="addslot" id="cmpAdd">`
    + '<span class="plus">+</span>'
    + `<span class="say">Compare with a second player</span>`
    + `<span class="hint">their ${esc(what)} beside this one</span></button>`;
}

/** The profiles, on the same three columns as the rows so the spine runs true. */
function honourHeads(list) {
  const heads = list.map((c, i) =>
    `<div class="hhead${list.length > 1 && i === 0 ? ' mirror' : ''}"`
    + ` data-player="${esc(c.id)}">${gridProfile(c)}</div>`);
  // With one player the board below stays centred — the rows are the reading and
  // half a board of nothing is not an improvement on all of it — but the seat
  // beside them is still set, which is what says a second player can sit there.
  const inner = list.length > 1
    ? heads[0] + '<span class="hlvl spacer"></span>' + heads[1]
    : heads[0] + '<span class="hlvl spacer"></span>'
      + `<div class="hhead empty">${addSlot('board')}</div>`;
  return `<div class="hheads two">${inner}</div>`;
}

function renderHonourMin() {
  const bar = honourStep(grid.threshold);
  $('honMin').innerHTML = HONOUR_STEPS.map(s =>
    `<button type="button" class="seg${s.key === bar.key ? ' on' : ''}"`
    + ` data-hmin="${s.key}" aria-pressed="${s.key === bar.key}"`
    + ` title="${esc(`show ${s.full}`)}">${esc(s.label)}</button>`).join('');
}

function renderHonoursBody(list) {
  const bar = honourStep(grid.threshold);
  for (const c of list) c.honours = careerHonours(c.rows, bar.rank);

  // Measured across both careers, like the grid's widths, so a level one of
  // them never entered still gets a row if the other did — an absence is only
  // legible next to the thing it is an absence of.
  const sections = honourSections(list.map(c => c.honours), grid.era);
  const shown = sections.filter(s => !grid.hiddenGroups.has(String(s.group)));

  renderGridGroups(sections, true);
  renderHonourMin();

  const body = $('honBody');
  body.classList.toggle('two', list.length > 1);
  const half = `--halfw: calc(var(--hbase) * ${honourHalfUnits(shown, list).toFixed(3)}`
    + ` + ${HN_W}px)`;
  body.innerHTML = shown.length
    ? `<div class="hboard" style="${half}">`
      + honourHeads(list) + shown.map(s => honourRow(s, list, bar)).join('') + '</div>'
    : sections.length ? '<p class="gnote">Every level is switched off.</p>'
    : list.some(c => c.loading) ? '<p class="gnote">Loading the career…</p>'
    : !state.playerId ? '<p class="gnote">Search for a player to compare.</p>'
    : '<p class="gnote">Nothing here reaches Super 100, which is where the board starts.</p>';
}

/**
 * Which vocabulary the rows are named in.
 *
 * Always drawn, unlike the discipline switch beside it, which hides itself when
 * a career only has one: both eras are always available to read a career in,
 * including a wholly modern one, where switching is the quickest way to see
 * that nothing here needed translating at all.
 */
function renderEraSwitch() {
  $('gridEra').innerHTML = ERAS.map(e =>
    `<button type="button" class="seg${e.key === grid.era ? ' on' : ''}"`
    + ` data-era="${e.key}" aria-pressed="${e.key === grid.era}"`
    + ` title="${esc(e.full)}">${esc(e.label)}</button>`).join('');
}

function renderViewSwitch() {
  $('gridView').querySelectorAll('[data-view]').forEach(b => {
    const on = b.dataset.view === grid.view;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

function renderGridBody(list) {
  // Widths are measured across *both* careers and then filtered, so the two
  // grids line up and the chip counts do not move when one section is hidden.
  const sections = gridSections(list.map(c => c.rows.map(r => r.by)), grid.era);
  const shown = sections.filter(s => !grid.hiddenGroups.has(String(s.group)));
  const years = gridYears(list.map(c => c.rows));

  renderGridGroups(sections);

  const body = $('gridBody');
  body.classList.toggle('two', list.length > 1);
  // "Nothing is loaded yet" and "you have switched everything off" both leave no
  // sections, and they are not the same thing to be told.
  const cards = list.map(c => gridCard(c, shown, years)).join('')
    + (list.length > 1 ? ''
      : `<section class="gcard empty">${addSlot('grid')}</section>`);
  body.innerHTML = shown.length ? cards
    : sections.length ? '<p class="gnote">Every level is switched off.</p>'
    : list.some(c => c.loading) ? '<p class="gnote">Loading the career…</p>'
    : !state.playerId ? '<p class="gnote">Search for a player to compare.</p>'
    : '<p class="gnote">Nothing here reaches Super 100, which is where the grid starts.</p>';
}

function renderGrid() {
  if (!grid.open) return;
  const list = careers();

  // Every career's season bucketed by section, once, whichever view is up.
  // Both the widths and the cells are read off this, so a row cannot be laid
  // out against widths that were measured from something else — and the two
  // views cannot disagree about what a career contains.
  for (const c of list) c.rows = careerGridRows(c);

  renderGridKinds();
  renderEraSwitch();
  renderViewSwitch();
  renderCompareExport();

  const honours = grid.view === 'honours';
  $('gridBody').hidden = honours;
  $('honBody').hidden = !honours;
  $('gridLegend').hidden = honours;
  $('gridNote').hidden = honours;
  $('honLegend').hidden = !honours;
  $('honNote').hidden = !honours;
  /* Which half of a career is being translated is exactly what the era switch
     changes, so the note explaining the notch is swapped with it. Both readings
     show one of the two; neither view hides both. */
  const ss = grid.era === 'ss';
  $('mapNote').hidden = ss;
  $('mapNoteSS').hidden = !ss;
  $('honLadderWT').hidden = ss;
  $('honLadderSS').hidden = !ss;
  $('honMin').hidden = !honours;
  $('gridTitle').textContent = honours ? 'Honours' : 'Career grid';

  if (honours) renderHonoursBody(list); else renderGridBody(list);
}
/* ---- saving the compare page ----

   Both views, on the same button. The Winners board asks for a *range* of
   seasons, because that is the shape of the claim somebody posts from it; a
   career is not a range, so this one draws **what is on screen** — the era, the
   level chips, the round bar, and both players if there are two.

   ⚠️ The careers are handed over as `careerRows` output, not as raw seasons.
   That is where the Finals reattribution, the era translation and the junior and
   team exclusions all settle, and doing any of it twice is two chances for the
   picture and the page to disagree about what a career contains.
   ==================================================================== */

/** The careers as the poster wants them: an identity, and the rows. */
function posterCareers() {
  /* ⚠️ The rows are **rebuilt** here rather than read off `c.rows`. `careers()`
     hands back a fresh object every call, so the `c.rows` the render hangs on
     one of them is not on the next one — the first version of this drew nothing
     at all, on a page that was plainly full of squares. */
  return careers().map(c => ({ c, rows: careerGridRows(c) }))
    .filter(({ rows }) => rows.length)
    .map(({ c, rows }) => ({
      id: String(c.id),
      name: (c.player && c.player.name) || `Player ${c.id}`,
      meta: careerMeta(c).join(' · '),
      avatar: (c.player && c.player.avatar) || '',
      rows,
    }));
}

function comparePosterOpts() {
  return {
    era: grid.era,
    hidden: [...grid.hiddenGroups],
    bar: grid.threshold,
  };
}

/** What the file is called when it lands in somebody's downloads. */
function compareExportName() {
  /* ⚠️ Named for the people in it, not for the view alone: a comparison and a
     single career would otherwise land in a downloads folder as the same file,
     and the second one would silently be `(1)`. */
  const who = posterCareers().map(c => surnameOf(c.name).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).filter(Boolean);
  return `badminton-${grid.view}-${who.join('-v-') || 'career'}.png`;
}

async function makeComparePoster() {
  const list = posterCareers();
  if (!list.length) return null;
  const opts = comparePosterOpts();
  return grid.view === 'honours'
    ? drawHonoursPoster(list, opts) : drawGridPoster(list, opts);
}

function compareSaying(msg, bad) {
  const el = $('gexpNote');
  el.textContent = msg || '';
  el.classList.toggle('is-bad', !!bad);
}

function renderCompareExport() {
  const box = $('gridExport');
  box.hidden = !grid.exporting;
  $('gridSave').classList.toggle('on', grid.exporting);
  $('gridSave').setAttribute('aria-pressed', String(grid.exporting));
}

async function saveComparePoster() {
  compareSaying('Drawing…');
  try {
    const blob = await makeComparePoster();
    if (!blob) return compareSaying('Nothing to draw yet.', true);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = compareExportName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked on a timer: revoking in the same tick as the click races the
    // download in Chrome and lands a zero-byte file.
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    compareSaying(`Saved ${compareExportName()}`);
  } catch (e) {
    compareSaying(e.message || String(e), true);
  }
}

async function copyComparePoster() {
  compareSaying('Drawing…');
  try {
    const blob = await makeComparePoster();
    if (!blob) return compareSaying('Nothing to draw yet.', true);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    compareSaying('Copied — paste it anywhere.');
  } catch (e) {
    compareSaying('Could not copy (' + (e.message || e.name) + '). Save it instead.', true);
  }
}

$('gridSave').addEventListener('click', () => {
  grid.exporting = !grid.exporting;
  compareSaying('');
  renderCompareExport();
});
$('gexpSave').addEventListener('click', saveComparePoster);
$('gexpCopy').addEventListener('click', copyComparePoster);
/* Only offered where it can work: `ClipboardItem` is missing on Firefox and on
   any page not served over https, and a button that always fails is worse than
   no button. */
$('gexpCopy').hidden = typeof ClipboardItem === 'undefined' || !navigator.clipboard;



/* ============================ the winners' pyramid ============================

   One column per season, oldest on the left. Each column is a pyramid: the
   Super 750s along the bottom, the single greatest title at the top.
   ==================================================================== */

/* The tile size is a viewing preference, not part of what the page argues, so
   it lives in localStorage and stays out of the hash — the same split the grid
   and the honours board already make. A Super 750 is the smallest square here,
   so the range is set by what makes *that* face readable rather than by what
   makes the summit fit. */
const WIN_ZOOM = { key: 'bst:winzoom', min: 8, max: 26, def: 14 };

function savedWinZoom() {
  let saved = null;
  try { saved = localStorage.getItem(WIN_ZOOM.key); } catch { /* private mode */ }
  const n = Number(saved);
  return Number.isFinite(n) && n > 0
    ? Math.max(WIN_ZOOM.min, Math.min(WIN_ZOOM.max, n))
    : WIN_ZOOM.def;
}

/* The disciplines this page has data for.
   ⚠️ The three doubles draws were absent until 5 Sep 2026, on the grounds that a
   doubles title is won by a *pair* and one square would have to hold two faces
   and stop meaning what every other square means. The square is now **split down
   the middle**, half a photograph each, which answers that objection without
   changing what a square is: see `winnerFace`. Everything above the square then
   treats the pair as one competitor — one tile, one bar, one line. */
const WIN_KINDS = ['MS', 'WS', 'MD', 'WD', 'XD'];

/* Two readings of the same seasons. The board says *who won what*; the score
   says *how much of it*.

   ⚠️ A view, not a section further down the page. Stacked under the board they
   could never line up: the pyramid is twenty columns that scroll sideways and
   the chart is one fixed-width picture, so the eye would be dragging one of them
   against the other. The Compare page already makes exactly this split between
   its grid and its honours board, so there is one pattern to learn rather than
   two. */
const WIN_VIEWS = ['board', 'score'];

/* ⚠️ Keyed by discipline, not a single `raw`. Switching used to be impossible,
   and the first version that allowed it would have thrown away the file it
   already had every time you switched back. */
const win = {
  files: {}, errors: {}, loading: {},
  kind: 'MS', zoom: savedWinZoom(),
  /* The dominance band under the pyramid, and the bar it draws at. On by
     default: it is the answer to the question the pyramid raises — the faces
     say a name over and over and the band is what that repetition *means*. */
  eras: true, reign: REIGN_DEFAULT,
  // Whether the export picker is open. A view of the page, not part of what it
  // argues, so it never reaches the hash.
  exporting: false,

  /* The score chart. `floor` is the clutter bar in points; `autoFloor` says it
     is still the derived default and may move with the discipline, and goes
     false for good the first time the reader touches the slider. `only` is the
     set of pinned players — empty means everybody the bar admits is lit. */
  view: 'board',
  floor: 0, autoFloor: true, only: new Set(),
  /* Which ordering the dominators' table is in, and whether it is showing the
     whole board or the head of it. See `dominationRanking`. */
  rank: RANK_DEFAULT, rankAll: false,
  /* ⚠️ **The pandemic seasons are out of the ranking by default.** A share of a
     three-tournament calendar is not the same quantity as a share of a fifteen-
     tournament one, and leaving them in put Viktor AXELSEN top of both
     orderings on 184 of his 315 points — and TAI Tzu Ying top of the women's on
     an 81 taken in a season that held three titles. Out by default, and one
     click puts them back. See `COVID_SEASONS`. */
  covid: false,
};

const winFile = () => win.files[win.kind] || null;

/* ⚠️ Registered once, here, rather than in the render — `renderWinnersControls`
   runs on every redraw, and adding the listener there would stack a new one
   each time. */
$('winZoom').addEventListener('input', e => {
  const n = Math.max(WIN_ZOOM.min, Math.min(WIN_ZOOM.max, Number(e.target.value) || WIN_ZOOM.def));
  if (n === win.zoom) return;
  win.zoom = n;
  try { localStorage.setItem(WIN_ZOOM.key, String(n)); } catch { /* private mode */ }
  renderWinners();
});

async function loadWinnersPage() {
  const kind = win.kind;
  if (win.files[kind] || win.loading[kind]) return renderWinners();
  win.loading[kind] = true;
  delete win.errors[kind];
  renderWinners();
  try { win.files[kind] = await loadWinners(kind); }
  catch (e) { win.errors[kind] = e.message || String(e); }
  win.loading[kind] = false;
  /* ⚠️ The reader may have switched away while this was in flight, so redraw
     whatever is up *now* rather than assuming it is still this discipline. */
  renderWinners();
}

/** The initials the board falls back to when BWF has no photograph. */
function faceInitials(name) {
  return String(name || '?').replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/)
    .map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

/** One person's photograph, or their initials, filling whatever box it is in. */
function oneFace(person, side, cls) {
  const name = esc((person && person.n) || 'Unknown');
  return person && person.a
    ? `<img class="${cls}" src="${esc(person.a)}" alt="${name}" loading="lazy"
        width="${Math.round(side)}" height="${Math.round(side)}">`
    : `<span class="${cls} noface" aria-label="${name}">${esc(faceInitials(person && person.n))}</span>`;
}

/**
 * A competitor's square: one face, or a **pair split down the middle**.
 *
 * ⚠️ This is what let the doubles draws onto the board at all. A doubles title
 * is won by two people, and the page's standing rule is that every square means
 * the same thing — so one square has to hold the pair without becoming a
 * different kind of object. Half each, and the square stays the size the ladder
 * says it is.
 *
 * ⚠️ **The half is the middle of the photograph, not the left or right of it.**
 * `object-fit: cover` in a box half as wide as it is tall scales the source to
 * match on height and crops the sides, which takes the central band — and
 * `object-position: top center` keeps the crop off the chin, the same rule the
 * full square already follows. Halving the *photograph* instead would give one
 * player their left ear and the other their right.
 */
function winnerFace(who, side) {
  const people = (who && who.people) || (who ? [who] : []);
  if (people.length < 2) return oneFace(people[0] || who, side, 'face');
  return `<span class="face pairface" aria-label="${esc(who.n || '')}">`
    + people.map(p => oneFace(p, side, 'half')).join('') + '</span>';
}

/* ---- the two badges on the summit row ----

   The top row holds two different prizes and says so by size alone, which is a
   distinction you have to already know to read. A mark beside the face says it
   outright: the rings for an Olympic champion, a cup for a world champion.

   Inline SVG rather than the emoji, for two reasons. It takes `currentColor`
   and the tile's size, so it scales with the zoom slider like everything else
   on the page; and the emoji are a platform decision — 🏆 is a different object
   on Windows and on a phone, and ⛎ is what several platforms draw for the
   rings, which is not the Olympics at all.

   ⚠️ The "black" ring is drawn light. The official mark is black on white and
   this page is #1a1a1a, where the black ring simply is not there — five rings
   with a hole in the middle reads as a mistake rather than as a flag. */
/* ⚠️ Built from the path data in `poster.js` rather than written out here. The
   export has to draw the same two marks with `Path2D`, and two copies of a
   trophy is two trophies to keep in step. */
const OLYMPIC_RINGS = `<svg class="pyrbadge rings" viewBox="0 0 ${RING_BOX[0]} ${RING_BOX[1]}"
  aria-hidden="true">`
  + RING_AT.map(([cx, cy], i) =>
    `<circle cx="${cx}" cy="${cy}" r="15" fill="none"
      stroke="${RING_COLOURS[i]}" stroke-width="5"/>`).join('')
  + `</svg>`;

const WORLDS_CUP = `<svg class="pyrbadge cup" viewBox="0 0 ${CUP_BOX} ${CUP_BOX}"
  aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8"
  stroke-linecap="round" stroke-linejoin="round">`
  + CUP_PATHS.map(d => `<path d="${d}"/>`).join('')
  + `</svg>`;

/** The mark that goes to the left of a summit-row face, or nothing. */
function winnerBadge(tier) {
  if (String(tier) === 'OLY') return OLYMPIC_RINGS;
  if (String(tier) === '20') return WORLDS_CUP;
  return '';
}

/** Everything the hover has to say about one title. */
function tileTitle(t, year) {
  const people = (t.who && t.who.people) || [];
  /* A pair is "GIDEON / SUKAMULJO" on the chip, where it has to fit; the hover
     has room for both names in full, so it says them. */
  const who = people.length > 1
    ? people.map(p => p.n).join(' & ')
    : ((t.who && t.who.n) || 'unknown');
  return [
    t.name,
    // What this rung was called in *this* season: "Superseries Premier" in
    // 2013, "Super 1000" in 2023. The point the page was making only in a note.
    t.level,
    who + (t.who && t.who.c ? ' · ' + t.who.c : ''),
    String(t.date).slice(0, 10),
    t.mark ? '⁕ ' + t.mark.note : null,
  ].filter(Boolean).join('\n');
}

function renderWinners() {
  const body = $('winBody');
  const scoring = win.view === 'score';
  renderWinnersControls();

  /* The two views share the discipline, the span and the export button and
     nothing else, so everything below the header swaps together. */
  $('winScore').hidden = !scoring;
  $('winNote').hidden = scoring;
  $('scoreNote').hidden = !scoring;
  body.hidden = scoring && !win.errors[win.kind] && !!winFile();

  const file = winFile();
  if (win.errors[win.kind]) {
    body.hidden = false;
    body.innerHTML = `<p class="empty">${esc(win.errors[win.kind])}</p>`;
    $('winSpan').textContent = '';
    return;
  }
  if (!file) {
    body.hidden = false;
    body.innerHTML = '<p class="empty">Reading the harvested winners…</p>';
    return;
  }
  if (scoring) {
    /* ⚠️ The span is set here as well as below, because the board's render is
       what usually writes it and the board is not drawn in this view. */
    const yrs = winnersSeasons(file);
    $('winSpan').textContent = `${yrs.years[0]}–${yrs.years[yrs.years.length - 1]} · `
      + `${yrs.years.reduce((n, y) => n + yrs.byYear.get(y).length, 0)} titles`;
    return renderScore(file);
  }

  const players = file.players || {};
  /* ⚠️ Not `Object.keys(file.seasons)`. The file is filed by the year a
     tournament was *played* in and two season-ending Finals were played in the
     January after their season — see `winnersSeasons`, which puts them back
     where the career grid already had them. */
  const seasons = winnersSeasons(file);
  const years = seasons.years;
  if (!years.length) {
    body.innerHTML = '<p class="empty">Nothing harvested yet.</p>';
    return;
  }
  const marks = pyramidSeasonMarks(seasons);

  const unit = win.zoom;
  $('winSpan').textContent = `${years[0]}–${years[years.length - 1]} · `
    + `${years.reduce((n, y) => n + seasons.byYear.get(y).length, 0)} titles`;

  /* ⚠️ Laid out once and then drawn, because the pick has to be checked against
     the whole board before a single square is written. A pick that names nobody
     here makes `pickedOff` true for *every* square — a board dimmed to nothing,
     with no visible cause and nothing to click to get it back. It cannot happen
     by clicking, only by arriving in a link that names somebody from a
     different draw, so it is dropped rather than drawn. The link is left to be
     rewritten by whatever the reader does next; a render does not write
     history. */
  const perYear = new Map(years.map(year =>
    [year, pyramidSeason(seasons.byYear.get(year), players, year)]));
  if (win.only.size) {
    const present = new Set();
    for (const rows of perYear.values()) {
      for (const row of rows) for (const t of row.tiles) present.add(String(t.id));
    }
    if (![...win.only].some(id => present.has(String(id)))) win.only.clear();
  }

  const columns = years.map(year => {
    const rows = perYear.get(year);
    const bulges = pyramidBulges(rows);
    const widest = Math.max(...rows.map(pyramidRowWidth), 1);

    const html = rows.map(row => {
      if (!row.tiles.length) {
        /* ⚠️ An empty row is drawn as a gap, not closed up. A season with no
           Tour Finals — every season before 2008 — should show the hole where
           it goes rather than quietly becoming a different shape. */
        const h = Math.round(pyramidScale(row.tiers[row.tiers.length - 1]) * unit);
        return `<div class="pyrrow is-empty" style="height:${h}px"
          title="no ${esc(row.label)} this season"></div>`;
      }
      return `<div class="pyrrow">` + row.tiles.map(t => {
        const side = Math.round(t.scale * unit);
        /* ⚠️ The fade goes on the badge's wrapper as well as on the square. The
           rings and the cup are *siblings* of the tile, not children of it, so
           dimming the tile alone left a full-strength Olympic badge floating
           beside a square that had receded. */
        const off = pickedOff(t.id) ? ' faded' : '';
        const tile = `<span class="pyrtile t-${esc(String(t.tier))}${t.mark ? ' is-moved' : ''}${off}"
          style="width:${side}px;height:${side}px"
          data-tier="${esc(String(t.tier))}" data-level="${esc(t.level)}"
          data-id="${esc(String(t.id))}"
          data-mark="${esc(t.mark ? t.mark.kind : '')}"
          title="${esc(tileTitle(t, year))}">${winnerFace(t.who, side)}</span>`;
        const badge = winnerBadge(t.tier);
        /* The badge is a sibling of the tile rather than something inside it,
           so it sits *beside* the photograph and never over a face. */
        return badge
          /* Half the photograph, with a floor: at the smallest zoom a Worlds
             square is 22px and a proportional mark is a smudge. */
          ? `<span class="pyrmajor${off}" style="--badge:${Math.max(15, Math.round(side * 0.5))}px"
              >${badge}${tile}</span>`
          : tile;
      }).join('') + `</div>`;
    }).join('');

    const note = marks.get(year);
    return `<div class="pyrseason${bulges.length ? ' is-bulging' : ''}"
      data-year="${year}" style="min-width:${Math.round(widest * unit) + 12}px">
      <div class="pyrstack">${html}</div>
      <div class="pyryear${note ? ' is-moved' : ''}"${
        note ? ` title="${esc(note.join('\n'))}"` : ''}>${year}${
        note ? '<i class="ast">⁕</i>' : ''}</div>
    </div>`;
  }).join('');

  /* ⚠️ Both bands live inside one wrapper, and the wrapper is what scrolls.
     The bars under the pyramid are placed at measured pixel offsets taken off
     the columns above them, so the two have to share an origin and a scroll
     position or the bars point at the wrong years. */
  body.innerHTML = `<div class="pyrwrap">`
    + `<div class="pyrscroll">${columns}</div>`
    + (win.eras ? `<div class="eraband" id="winEraBand"></div>` : '')
    + `</div>`;

  if (win.eras) renderEraBand(seasons, players);
}

/* ---- the dominance band ----

   ⚠️ **Measured, not computed.** A column's declared `min-width` is what the
   widest *row* would be if its squares butted together, and they do not — there
   are 3px gaps between them, twelve of them in a 2007 column. So the drawn
   column is wider than the number the render asked for, and a band laid out
   from that number drifts a whole year to the left by the end of the chart.
   The offsets below come off `getBoundingClientRect` after the pyramid is in
   the document, which is the same thing the bracket does with its feeders. */

const ERA_LANE_H = 26;
const ERA_LANE_GAP = 4;

/* The colours are `REIGN_COLOURS`, from `poster.js` — the module that has to
   draw them from primitives owns the palette, and the export and the page then
   cannot disagree about who is blue. */

function renderEraBand(seasons, players) {
  const host = $('winEraBand');
  if (!host) return;
  const lanes = reignLanes(pyramidReigns(seasons, players, reignStep(win.reign).n));
  if (!lanes.length) {
    host.innerHTML = `<p class="empty">Nobody won ${esc(reignStep(win.reign).full)}`
      + ` in any season on this board.</p>`;
    host.style.height = '';
    return;
  }

  const wrap = host.parentElement;
  const base = wrap.getBoundingClientRect();
  const at = new Map();
  for (const col of wrap.querySelectorAll('.pyrseason')) {
    const r = col.getBoundingClientRect();
    at.set(Number(col.dataset.year), { left: r.left - base.left, w: r.width });
  }

  /* ⚠️ A season's block runs to where the *next* one starts, not to its own
     right edge. The columns are 10px apart, and stopping at the edge left a
     dark stripe at every year boundary — so a nine-season run read as nine
     bars rather than as one. The last season in a run stops at the column,
     because that is where the run stops. */
  const order = [...at.keys()].sort((a, b) => a - b);
  const runsTo = new Map(order.map((y, i) => {
    const next = at.get(order[i + 1]);
    return [y, next ? next.left : at.get(y).left + at.get(y).w];
  }));

  // The brightest year on the board, so the shading means the same thing at
  // every bar rather than being normalised per player.
  const peak = Math.max(...lanes.flatMap(p => p.runs.map(r => r.peak)), 1);
  const bar = reignStep(win.reign).n;
  const rows = Math.max(...lanes.map(p => p.lane)) + 1;

  const bars = lanes.flatMap((p, i) => p.runs.map(run => {
    const a = at.get(run.from), b = at.get(run.to);
    if (!a || !b) return '';
    const left = Math.round(a.left);
    const right = b.left + b.w;
    const width = Math.round(right - a.left);
    const years = run.years.map((y, n) => {
      const c = at.get(y.year);
      if (!c) return '';
      const to = n === run.years.length - 1 ? right : runsTo.get(y.year);
      /* ⚠️ A ramp, not a flat fill: the bar says "a run", the shading says how
         hard. LEE Chong Wei's 2013 was seven titles and his 2008 was three, and
         one block of colour claims those were the same season.
         ⚠️ Gentle on purpose — 0.62 to 0.95, not 0 to 1. A wide range turned
         every season boundary into a hard edge, and a decade drawn in ten
         visibly different shades reads as ten bars however well they touch. */
      const alpha = (0.62 + 0.33 * (y.n - bar) / Math.max(1, peak - bar)).toFixed(3);
      return `<span class="erayr" style="left:${Math.round(c.left - a.left)}px;`
        + `width:${Math.round(to - c.left)}px;opacity:${alpha}"></span>`;
    }).join('');
    const who = (p.who && p.who.n) || String(p.id);
    const span = run.from === run.to ? String(run.from) : `${run.from}–${run.to}`;
    const detail = run.years.map(y => `${y.year}: ${y.n}`).join('\n');
    /* ⚠️ The name is `position: sticky`, so it slides along the bar and stays on
       screen for the whole of a ten-season run rather than only while its first
       season is in view. Repeating it once per season was the other candidate
       and is a wall of the same six words. That is why `.erabar` must *not*
       clip: an `overflow: hidden` ancestor is a scroll container, and a sticky
       element inside one sticks to a box that never scrolls — which is to say,
       it does nothing at all. The shading is clipped by `.erafill` instead. */
    return `<div class="erabar${pickedOff(p.id) ? ' faded' : ''}"
      data-id="${esc(String(p.id))}" data-lane="${p.lane}"
      data-from="${run.from}" data-to="${run.to}" data-n="${run.total}"
      style="--era:${REIGN_COLOURS[i % REIGN_COLOURS.length]};left:${left}px;`
      + `width:${width}px;top:${p.lane * (ERA_LANE_H + ERA_LANE_GAP)}px"
      title="${esc(`${who}${p.who && p.who.c ? ' · ' + p.who.c : ''}\n`
        + `${span} · ${run.total} titles\n${detail}`)}">`
      + `<span class="erafill">${years}</span>`
      + `<span class="erawho">${winnerFace(p.who, 20)}<b>${esc(who)}</b>`
      + (p.who && p.who.f
        /* ⚠️ Not lazy, unlike the faces. There are at most fifteen of these on
           the board and they are a kilobyte each, and a lazy flag arrives after
           the name it belongs to has already been read. */
        ? `<img class="flag" src="${esc(p.who.f)}" alt="${esc(p.who.c || '')}"
            width="14" height="14">`
        : '')
      + `</span></div>`;
  })).join('');

  host.style.height = (rows * ERA_LANE_H + (rows - 1) * ERA_LANE_GAP) + 'px';
  host.innerHTML = bars;
}

/* ---- the domination score ----

   The same seasons, read as a quantity. One line per career, a point in every
   season they won something, and the height is how much of that season they
   took — see `dominationSeasons` for the ladder and for why there is no toggle
   on it.

   Drawn as SVG rather than as the board's boxes because the claim is a shape
   over time, and because a line chart is the one thing in this app that has to
   be readable at a glance without a hover.
   ==================================================================== */

/* A viewBox, not pixels: the chart scales to whatever width the page gives it
   and the geometry below never has to be recomputed on a resize. `b` leaves
   room under the plot for the year labels *and* the strip that says how big
   each season was. */
const SC = {
  w: 1180, h: 510,
  l: 46, r: 16, t: 14, b: 74,
  stripH: 32,
  /* Big enough to be a face rather than a smudge, small enough that a crowded
     stretch is still a set of separate marks. */
  face: 9,
};
const scX = (i, n) => SC.l + (SC.w - SC.l - SC.r) * (n < 2 ? 0.5 : i / (n - 1));

/** Out of 100, and never printed with a % sign — see `dominationSeasons`. */
function scoreText(x) {
  return (x * 100).toFixed(x >= 0.995 ? 0 : 1).replace(/\.0$/, '');
}

/** The model for whatever discipline is up, or null. */
function scoreModel() {
  const file = winFile();
  return file ? dominationSeasons(file) : null;
}

/**
 * Hand the palette out to the careers on screen, in the order they opened.
 *
 * ⚠️ Over the **shown** players and not all forty-four. The era bands can colour
 * every career from a fixed cycle because two bars of one colour lie far apart
 * on the page; a line chart draws them through each other, and at one colour per
 * career LEE Chong Wei, SHI Yu Qi and KIDAMBI Srikanth all came out green.
 * Colouring what is drawn keeps the set on screen distinct.
 *
 * The cost is that a ring changes colour when the bar moves, and it is worth
 * paying now the marker is a photograph: the face says who it is and the ring
 * only has to make the line followable.
 */
function scorePaint(shown) {
  shown.forEach((p, i) => { p.colour = SCORE_COLOURS[i % SCORE_COLOURS.length]; });
  return shown;
}

/**
 * The top of the y-axis, which must **not** move under the reader.
 *
 * ⚠️ Scaled to the best season in *either* draw, and never to the selection.
 * Fitted to what was on screen it rescaled every time a name was clicked — so
 * isolating somebody made their line climb the page, which is the chart lying
 * about the one thing it was asked to show — and the men's and women's boards
 * came out at two different heights, so switching between them compared two
 * pictures at two scales.
 */
function scoreTop() {
  let best = 0.01;
  for (const kind of WIN_KINDS) {
    const file = win.files[kind];
    if (!file) continue;
    for (const p of dominationSeasons(file).people) if (p.peak > best) best = p.peak;
  }
  return Math.min(1, Math.max(0.25, Math.ceil(best * 10) / 10));
}

/**
 * The photograph inside a marker — one face, or a pair split down the middle.
 *
 * ⚠️ `slice` in a box half as wide as it is tall takes the **central band** of
 * the photograph, which is the same crop the board's split square gets from
 * `object-fit: cover`. One rule, two renderers, so a pair looks like itself in
 * both places. A competitor with no photograph at all falls back to a plain dot,
 * as it always has.
 */
function scoreMarkFace(p) {
  /* ⚠️ Positional, not filtered. A pair with one photograph between them keeps
     the missing half *in its half* — filtering the blank out would let the other
     photograph slide across and fill the whole marker, which would say the pair
     was one person. */
  const faces = p.who.faces && p.who.faces.length ? p.who.faces : [p.who.a];
  if (!faces.some(Boolean)) return `<circle r="${SC.face - 1}" fill="${p.colour}"></circle>`;
  const w = (SC.face * 2) / faces.length;
  return faces.map((href, i) => (href
    ? `<image href="${esc(href)}" x="${-SC.face + i * w}" y="${-SC.face}"`
      + ` width="${w}" height="${SC.face * 2}"`
      + ' preserveAspectRatio="xMidYMin slice" clip-path="url(#scoreFace)"></image>'
    : '')).join('');
}

function drawScore(model) {
  const { years, seasons, people } = model;
  const floor = win.floor / 100;
  /* ⚠️ Pinning a name **dims the rest instead of removing them**. Drawing only
     the pinned player re-ran `scorePaint` over a set of one, so the act of
     picking somebody out changed their colour — and it threw away the context
     that makes a share chart worth reading at all, which is who else was in the
     season. The set on screen is the bar's set, always; `win.only` decides what
     is lit. */
  const shown = scorePaint(people.filter(p => p.peak >= floor));
  /* ⚠️ Only the picks the chart can actually **draw** decide what is dim. A pick
     naming somebody the bar has hidden would otherwise make `lit` false for
     every line at once — a chart faded to nothing, with the thing that caused
     it not on screen. It happens from a link, and from the ranking below, which
     lists everybody whatever the bar is set to. */
  const drawn = new Set(shown.map(p => p.id));
  const active = [...win.only].filter(id => drawn.has(id));
  const lit = id => !active.length || active.includes(id);
  // Faded first, pinned last, so a lit line is never buried under a dim one.
  shown.sort((a, b) => Number(lit(a.id)) - Number(lit(b.id)));

  const top = scoreTop();
  const n = years.length;
  const x = i => scX(i, n);
  const y = v => SC.h - SC.b - (SC.h - SC.t - SC.b) * (v / top);
  const at = year => x(years.indexOf(year));
  const stripTop = SC.h - 44;

  const out = [`<defs><clipPath id="scoreFace"><circle r="${SC.face}"></circle></clipPath></defs>`];
  const thin = thinSeasons(seasons);
  const now = new Date().getUTCFullYear();

  /* A faint column for a season the reader should not take at face value, named
     at the foot of it. The strip under the axis says *how* short; this says
     *why*, and puts it where the line does something strange rather than in a
     caption.

     ⚠️ **Two different reasons, and 2021 has only the second one.** `thin` is a
     count — far fewer titles than the seasons around it — and it catches 2020
     and 2022. It does not catch 2021, which held ten, the same as 2018 and
     2019: what was wrong with 2021 was not how many but *which*, and no count
     can see that. The pandemic set is written down instead, from the tournament
     list; see `COVID_SEASONS`. The union is marked, because the reason a column
     is faint is "do not read this as a normal season" either way. */
  const half = (SC.w - SC.l - SC.r) / Math.max(1, n - 1) / 2;
  /* In year order, not set order: these are drawn into the document and read
     left to right, and the union came out 2020, 2022, 2026, 2021. */
  for (const yr of [...new Set([...thin.set, ...COVID_SEASONS])].sort((a, b) => a - b)) {
    const i = years.indexOf(yr);
    if (i < 0) continue;
    out.push(`<rect class="scorehole" x="${x(i) - half * 0.75}" y="${SC.t}"`
      + ` width="${half * 1.5}" height="${SC.h - SC.t - SC.b}"></rect>`);
    const why = shortSeasonWhy(yr, now);
    if (!why) continue;
    /* The season in progress is the last column, and a centred label there runs
       off the plot. Anchored to whichever edge it is against. */
    const last = i === n - 1;
    out.push(`<text class="scorewhy" x="${last ? SC.w - SC.r - 4 : x(i)}"`
      + ` y="${SC.h - SC.b - 7}" text-anchor="${last ? 'end' : 'middle'}">${esc(why)}</text>`);
  }

  const step = top > 0.6 ? 0.2 : top > 0.3 ? 0.1 : 0.05;
  out.push('<g class="scoregrid">');
  for (let v = 0; v <= top + 1e-9; v += step) {
    out.push(`<line x1="${SC.l}" x2="${SC.w - SC.r}" y1="${y(v)}" y2="${y(v)}"></line>`);
  }
  out.push('</g><g class="scoreaxis">');
  for (let v = 0; v <= top + 1e-9; v += step) {
    out.push(`<text x="${SC.l - 8}" y="${y(v) + 3.5}" text-anchor="end">${Math.round(v * 100)}</text>`);
  }
  years.forEach((yr, i) => {
    /* ⚠️ **Every year, not every other one.** It used to thin the labels above
       fourteen seasons, and that was a guess rather than a measurement: the
       plot is 1118 units wide, which is 59 to a season over twenty of them,
       against a four-digit label of about 27. They were never going to collide.
       What the thinning did instead was make the reader count gaps to place a
       point — and it had already had to be special-cased twice, because 2020
       and 2022 both fell on the skipped alternate and their footnote marks
       simply were not drawn. */
    /* ⚠️ A plain **asterisk**, not the pyramid's ⁕ (U+2055). That glyph has no
       form in Roboto or in any of the fallbacks, so it renders as a small dot —
       which is what it does on the board above, where the note calls it an
       asterisk and the page draws a dot. Here the note says asterisk and the
       page draws one. */
    const mark = thin.set.has(yr) ? '<tspan class="ast">*</tspan>' : '';
    out.push(`<text x="${x(i)}" y="${SC.h - SC.b + 15}" text-anchor="middle">${yr}${mark}</text>`);
  });
  out.push('</g>');

  /* ---- how much there was to win ----

     ⚠️ The denominator, drawn. A score is a fraction and the line only shows the
     numerator; without this, 66.7 in 2020 and 66.7 in 2015 are the same height
     on the page and one of them is two matches. Kept out of the plot and under
     the axis, because it is a different quantity — behind the lines it read as
     a second series. */
  out.push('<g class="scorestrip">');
  /* Narrow, so a bar reads as a bar. At the width of its own height the tall
     ones came out as squares and the strip stopped looking like a quantity. */
  const bw = Math.max(3, Math.min(11, half * 0.7));
  years.forEach((yr, i) => {
    const s = seasons[i];
    const h = thin.max ? (SC.stripH * s.total) / thin.max : 0;
    const isThin = thin.set.has(yr) ? ' is-thin' : '';
    out.push(`<rect class="sz${isThin}" x="${x(i) - bw / 2}"`
      + ` y="${stripTop + SC.stripH - h}" width="${bw}"`
      + ` height="${Math.max(h, s.total ? 1 : 0)}"></rect>`);
    /* On every bar, not only the short ones. The number was the short seasons'
       badge, which made a count look like a warning; it is just the size of the
       season, and a reader comparing 2022 to 2023 wants both of them. */
    /* ⚠️ The season being played says **both** numbers. Its scores are shares
       of the whole year, so a strip reading "8" under a column weighed against
       twelve is the one place a reader could not see why the line sits low. */
    const label = s.forecast && s.planned > s.played
      ? `${s.played}/${s.planned}` : s.total;
    out.push(`<text class="szn${isThin}" x="${x(i)}"`
      + ` y="${stripTop + SC.stripH - h - 4}" text-anchor="middle">${label}</text>`);
  });
  out.push(`<text class="szlbl" x="${SC.l - 8}" y="${stripTop + SC.stripH}"`
    + ' text-anchor="end">titles</text></g>');

  // Lines first, then every marker over every line, so a face is never buried
  // under somebody else's segment.
  for (const p of shown) {
    /* ⚠️ Runs **break at any gap in the seasons**, because a point means "won
       something" and its absence means "not in the winners list" — which is not
       the same claim as "entered and won nothing". Two dots four years apart
       stay two dots. */
    const runs = [];
    for (const pt of p.pts) {
      const last = runs[runs.length - 1];
      if (last && pt.year === last[last.length - 1].year + 1) last.push(pt);
      else runs.push([pt]);
    }
    /* ⚠️ Segment by segment rather than one polyline per run, so a leg touching
       a short season can be **dashed**: a solid line across 2020 asserts a trend
       through a year that was barely played. The legs are straight, so nothing
       is lost by drawing them separately. */
    for (const run of runs) {
      for (let i = 1; i < run.length; i++) {
        const a = run[i - 1], b = run[i];
        const holed = thin.set.has(a.year) || thin.set.has(b.year) ? ' over-hole' : '';
        out.push(`<path class="series${holed}${lit(p.id) ? '' : ' faded'}"`
          + ` data-id="${esc(p.id)}" stroke="${p.colour}"`
          + ` d="M${at(a.year)} ${y(a.score)} L${at(b.year)} ${y(b.score)}"></path>`);
      }
    }
  }
  /* ⚠️ **The marker is the face**, ringed in the player's colour. A dot needs a
     legend and a face does not, and the whole point of a marker here is that
     somebody who appears in one season only should still be *someone*. The ring
     stays because the line has to be traceable between faces, and because a
     photograph is not always there — no avatar falls back to a plain dot. */
  for (const p of shown) {
    for (const pt of p.pts) {
      const hole = thin.set.has(pt.year) ? ' on-hole' : '';
      out.push(`<g class="pt${hole}${lit(p.id) ? '' : ' faded'}"`
        + ` data-id="${esc(p.id)}" data-year="${pt.year}"`
        + ` transform="translate(${at(pt.year)} ${y(pt.score)})">`
        + scoreMarkFace(p)
        + `<circle class="ring" r="${SC.face}" fill="none" stroke="${p.colour}"></circle></g>`);
    }
  }
  // A fatter invisible target, because a 9px marker is a hard thing to hover.
  for (const p of shown) {
    for (const pt of p.pts) {
      out.push(`<circle class="hit" data-id="${esc(p.id)}" data-year="${pt.year}"`
        + ` cx="${at(pt.year)}" cy="${y(pt.score)}" r="13"></circle>`);
    }
  }

  $('scoreChart').innerHTML = out.join('');
}

/** The round thumbnail on a legend chip or a hover — split, for a pair. */
function legendFace(who) {
  const people = (who && who.people) || [];
  if (!people.some(p => p.a)) return '';
  if (people.length === 1) return `<img src="${esc(people[0].a)}" alt="" width="18" height="18">`;
  // Positional, so a pair with one photograph keeps its empty half. See
  // `scoreMarkFace` for why that matters.
  return '<span class="pairpic">'
    + people.map(p => (p.a ? `<img src="${esc(p.a)}" alt="">`
      : `<i class="blank" aria-label="${esc(p.n || '')}"></i>`)).join('') + '</span>';
}

/**
 * Everybody the bar admits, with whoever is not currently lit dimmed.
 *
 * ⚠️ The list must not shrink when a name is clicked. It did, which made picking
 * somebody out a one-way door: the chips you would need to get back — or to put
 * a second player beside the first — were the ones that had just disappeared.
 * Off is a state, not an absence.
 */
function renderScoreLegend(model) {
  const floor = win.floor / 100;
  const here = model.people.filter(p => p.peak >= floor);
  /* The same guard the chart uses, and it has to be the same: a pick the bar
     has hidden would mark every chip off, which says nothing is picked while
     something is. See `drawScore`. */
  const active = [...win.only].filter(id => here.some(p => p.id === id));
  const lit = id => !active.length || active.includes(id);
  $('scoreLegend').innerHTML = here
    .slice().sort((a, b) => b.peak - a.peak)
    .map(p => `<button type="button" class="lg${lit(p.id) ? '' : ' off'}"`
      + ` data-id="${esc(p.id)}" aria-pressed="${lit(p.id)}">`
      + `<i style="background:${p.colour || '#666'}"></i>`
      + legendFace(p.who)
      + `${esc(p.who.n)}<span class="pk">${scoreText(p.peak)}</span></button>`).join('');
}

function renderScoreTables(model) {
  /* ⚠️ The **same rule the chart marks with**, not a second one. These tables
     were left on a fixed "fewer than six" test when the chart moved to two
     thirds of the median, so they called 2020 short and 2022 normal while the
     axis above them said otherwise. */
  const thin = thinSeasons(model.seasons);
  const mark = yr => (thin.set.has(yr) ? '<i class="ast">*</i>' : '');

  const rows = [];
  for (const p of model.people) for (const pt of p.pts) rows.push({ p, pt });
  rows.sort((a, b) => b.pt.score - a.pt.score);
  $('scoreBest').innerHTML =
    '<tr><th>Season</th><th>Player</th><th>Score</th><th>Titles</th></tr>'
    + rows.slice(0, 14).map(r =>
      `<tr${thin.set.has(r.pt.year) ? ' class="thin"' : ''}>`
      + `<td class="n">${r.pt.year}${mark(r.pt.year)}</td>`
      + `<td>${esc(r.p.who.n)}</td>`
      + `<td class="n">${scoreText(r.pt.score)}</td>`
      + `<td class="n">${r.pt.n} of ${r.pt.played}</td></tr>`).join('');

  $('scoreYears').innerHTML =
    '<tr><th>Year</th><th>Titles</th><th>Made of</th><th>Winners</th></tr>'
    + model.seasons.map(s => {
      const by = new Map();
      for (const t of s.titles) by.set(t.tier, (by.get(t.tier) || 0) + 1);
      const made = [...by.entries()]
        .sort((a, b) => honourRung(a[0]) - honourRung(b[0]))
        /* ⚠️ `pyramidLabel`, not `levelLabel`: a title is named for what it was
           called **in its own season**, so 2013 reads 12×Superseries Premier and
           2023 reads 4×Super 1000. The board above does this and needs no era
           switch for it; naming everything in the modern vocabulary here had the
           two views of one board disagreeing about what a title was. */
        .map(([t, k]) => `${k}×${esc(pyramidLabel(t, s.year))}`).join(', ');
      const held = s.forecast && s.planned > s.played
        ? `${s.played} <span class="of">of ${s.planned}</span>` : s.total;
      return `<tr${thin.set.has(s.year) ? ' class="thin"' : ''}>`
        + `<td class="n">${s.year}${mark(s.year)}</td><td class="n">${held}</td>`
        + `<td>${made || '—'}</td><td class="n">${s.by.size}</td></tr>`;
    }).join('');
}

/* ---- the dominators, ranked ----

   The chart says who dominated *and when*; this says who dominated, full stop.
   Both orderings are drawn at once and only the sort moves, because the whole
   point is that they **disagree** — KIM / SEO took 76 of 2024 and appear in two
   seasons; CAI / FU never took 39 of one and lead the men's doubles on total.
   Two separate tables would have hidden exactly that.

   ⚠️ **The Show bar does not govern this table.** It filters on *peak*, so a
   total ranking cut by it is a different claim: at the men's singles default of
   40 it leaves seven people, and it drops BOE / MOGENSEN — eight seasons and
   seventh on total — for a peak of 25.5. The bar declutters the chart; the
   ranking is the whole board. */

const RANK_TOP = 20;

/** "2020–22" — written once, so the chip and the caption cannot disagree. */
function covidSpan() {
  const years = [...COVID_SEASONS].sort((a, b) => a - b);
  return `${years[0]}–${String(years[years.length - 1]).slice(2)}`;
}

/** How many rows to draw, and the words under them saying so. */
function rankRows(rows) {
  return win.rankAll ? rows : rows.slice(0, RANK_TOP);
}

function renderScoreRanking(model) {
  const skip = win.covid ? new Set() : COVID_SEASONS;
  const rows = dominationRanking(model, win.rank, { skip });
  const mode = rankMode(win.rank);

  $('rankMode').innerHTML = RANK_MODES.map(m =>
    `<button type="button" class="chip${m.key === mode.key ? ' on' : ''}"`
    + ` data-mode="${esc(m.key)}" aria-pressed="${m.key === mode.key}">`
    + `${esc(m.label)}</button>`).join('');

  /* ⚠️ Off by default, and the *off* state is the one that needs no
     explanation: a level chip that is off means that level is not counted, and
     this reads the same way. On means the pandemic seasons are back in. */
  $('rankCovid').className = 'chip' + (win.covid ? ' on' : '');
  $('rankCovid').setAttribute('aria-pressed', String(win.covid));
  $('rankCovid').textContent = covidSpan();
  $('rankCovid').title = win.covid
    ? 'The pandemic seasons are being counted. Click to set them aside.'
    : 'The pandemic seasons are set aside. Click to count them.';

  /* ⚠️ Lit against the **ranking's own** set, not the chart's. Every competitor
     is in this table, so a pick is always one of these rows — unlike the chart
     above, where the bar may have hidden it. */
  const lit = id => !win.only.size || win.only.has(id);
  const num = x => scoreText(x);

  /* ⚠️ **The last two columns follow the sort, because a career total is the
     wrong fact beside a peak.** Ranked on total, what matters is how long it
     took and how much of it there was: seasons, and titles. Ranked on peak, the
     career count says nothing about the season being ranked — what a peak of 76
     *means* is "8 of the 12 titles there were that year", and which year it
     was. */
  const byPeak = win.rank === 'peak';
  const tail = byPeak
    ? { a: 'Season', b: 'Titles', va: r => r.peakYear,
      vb: r => `${r.peakTitles}<span class="of">of ${r.peakPlayed}</span>` }
    : { a: 'Seasons', b: 'Titles', va: r => r.seasons, vb: r => r.titles };

  $('scoreRank').innerHTML =
    '<tr><th class="n">#</th><th>Competitor</th>'
    + `<th class="n${byPeak ? '' : ' by'}">Total</th>`
    + `<th class="n${byPeak ? ' by' : ''}">Peak</th>`
    + `<th class="n">${tail.a}</th><th class="n">${tail.b}</th></tr>`
    + rankRows(rows).map(r =>
      `<tr class="rankrow${lit(r.id) ? '' : ' faded'}" data-id="${esc(String(r.id))}"`
      + ` tabindex="0" title="${esc(`${r.who.n}
${r.first}–${r.last}`
        + ` · ${r.titles} titles in ${r.seasons} seasons`
        + ` · best ${scoreText(r.peak)} in ${r.peakYear},`
        + ` ${r.peakTitles} of ${r.peakPlayed}`)}">`
      + `<td class="n rk">${r.rank}</td>`
      + `<td><span class="rkwho">${legendFace(r.who) || '<i class="noface"></i>'}`
      + `${esc(r.who.n)}</span></td>`
      + `<td class="n${byPeak ? '' : ' by'}">${num(r.total)}</td>`
      /* The year is what makes a peak a claim rather than a number — 76 in a
         season nobody remembers is a different sentence from 76 in 2025. It is
         a suffix here only when the sort is *not* peak; ranked on peak it has a
         column of its own, and printing it twice reads as two facts. */
      + `<td class="n${byPeak ? ' by' : ''}">${num(r.peak)}`
      + (byPeak ? '' : `<span class="yr">${r.peakYear}</span>`) + '</td>'
      + `<td class="n">${tail.va(r)}</td>`
      + `<td class="n">${tail.vb(r)}</td></tr>`).join('');

  const shown = rankRows(rows).length;
  $('rankMore').hidden = rows.length <= RANK_TOP;
  $('rankMore').textContent = win.rankAll
    ? `all ${rows.length} — show the top ${RANK_TOP}`
    : `${shown} of ${rows.length} — show them all`;
  /* What the sort means, and — when they are out — what is not being counted.
     A number that has quietly had three seasons taken out of it has to say so
     where the number is, not only in the note at the foot of the page. */
  $('rankWhat').textContent = mode.of
    + (win.covid ? '' : ` · ${covidSpan()} set aside`);
}

/**
 * A click in the ranking, which is a pick like any other — with one extra job.
 *
 * ⚠️ **It lowers the bar to fit.** The table lists everybody and the chart does
 * not, so picking somebody the bar has hidden would light a row against a chart
 * that could not show them. Dropping the bar to their best season puts the line
 * on screen, which is what a reader clicking a name in a ranking is asking for.
 * The bar's own handlers clear the pick when it moves — deliberately, so that
 * dragging it does not leave a stale selection — so this must not go through
 * them.
 */
function pickFromRanking(id) {
  const p = scoreCurrent && scoreCurrent.people.find(q => q.id === id);
  if (p && !win.only.has(id) && p.peak * 100 < win.floor) {
    win.floor = Math.max(0, Math.floor(p.peak * 100 / SCORE_FLOOR_STEP) * SCORE_FLOOR_STEP);
    win.autoFloor = false;
  }
  toggleWinPick(id);
}

$('scoreRank').addEventListener('click', e => {
  const row = e.target.closest('.rankrow');
  if (row) pickFromRanking(row.dataset.id);
});
/* A table row is not a button, so it does not answer the keyboard for free —
   and this is a list of names somebody may well be tabbing through. */
$('scoreRank').addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('.rankrow');
  if (!row) return;
  e.preventDefault();
  pickFromRanking(row.dataset.id);
});

$('rankMode').addEventListener('click', e => {
  const chip = e.target.closest('.chip');
  if (chip) setRankMode(chip.dataset.mode);
});

$('rankMore').addEventListener('click', () => {
  win.rankAll = !win.rankAll;
  renderWinners();
});

$('rankCovid').addEventListener('click', () => setCovid(!win.covid));

/** Whether the pandemic seasons are weighed. See `COVID_SEASONS`. */
function setCovid(on) {
  if (!!on === win.covid) return false;
  win.covid = !!on;
  renderWinners();
  writeHash();
  return true;
}

function setRankMode(key) {
  const next = rankMode(key).key;
  if (next === win.rank) return false;
  win.rank = next;
  renderWinners();
  writeHash();
  return true;
}

/** The clutter bar, and what it is currently hiding, said in words. */
function renderScoreFloor() {
  const r = $('winFloorRange');
  if (Number(r.value) !== win.floor) r.value = String(win.floor);
  $('winFloorTxt').textContent = (win.floor
    ? `everyone who scored ${win.floor}+ in a season`
    : 'everyone')
    + (win.autoFloor ? ' · as high as it goes without dropping a season’s best' : '');
}

/**
 * The ladder, written out, because a weight nobody can check is a magic number.
 *
 * ⚠️ Modern names here, deliberately, where the tables and the hover use the
 * season's own. These are the **rungs** rather than any particular title, and a
 * rung has no season to be named for — the note says in words that an older
 * season is weighed on the same five.
 */
function renderScoreLadder() {
  $('scoreLadder').innerHTML = SCORE_TIERS.map(t =>
    `<span class="wt">${esc(levelLabel(t))}`
    + `<b>${titleWeight(t).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}</b></span>`).join('');
}

/* The model the hover reads. Held rather than rebuilt per mousemove: it carries
   every title in every season, which is not a thing to recompute at 60Hz. */
let scoreCurrent = null;

function renderScore(file) {
  renderScoreLadder();
  let model = scoreCurrent = dominationSeasons(file);
  /* The default bar is derived from the data, so it moves with the discipline —
     and stops moving the moment the reader touches the slider. */
  if (win.autoFloor) win.floor = bestScoreFloor(model);
  /* ⚠️ Only the bar, not the whole header. `renderWinnersControls` has already
     run by the time we are here, and running it again would rebuild the buttons
     under whichever one the reader just clicked. */
  renderScoreFloor();
  drawScore(model);
  renderScoreLegend(model);
  renderScoreRanking(model);
  renderScoreTables(model);
}

function scoreTipFor(id, year) {
  const p = scoreCurrent && scoreCurrent.people.find(q => q.id === id);
  const pt = p && p.pts.find(q => q.year === year);
  if (!pt) return null;
  return `<span class="who">`
    + legendFace(p.who)
    + `<b>${esc(p.who.n)}</b></span>`
    /* A pair is named by its surnames everywhere it has to fit; the hover has
       room to say who they actually are. */
    + (p.who.people.length > 1
      ? `<span class="k">${esc(p.who.people.map(q => q.n).join(' · '))}</span>` : '')
    + `<span class="big">${scoreText(pt.score)}</span>`
    + `<span class="k"> / 100 in ${year}</span>`
    + `<span class="k">${pt.n} of ${pt.played} titles · `
    + `${pt.weight.toFixed(2)} of ${pt.of.toFixed(2)} by weight</span>`
    + '<ul>' + pt.titles.slice()
      .sort((a, b) => honourRung(a.tier) - honourRung(b.tier))
      .map(t => `<li>${esc(String(t.name).trim())}`
        + ` <span class="k">${esc(pyramidLabel(t.tier, year))}</span></li>`).join('')
    + '</ul>';
}

/* Hovering a marker names the player and lists what they actually won, because
   the question a score always raises is "out of what?" and the answer is the
   titles. */
$('scoreChart').addEventListener('mousemove', e => {
  const tip = $('scoreTip');
  const hit = e.target.closest('.hit');
  if (!hit) { tip.hidden = true; scoreHighlight(null); return; }
  const html = scoreTipFor(hit.dataset.id, Number(hit.dataset.year));
  if (!html) { tip.hidden = true; return; }
  tip.innerHTML = html;
  tip.hidden = false;
  const box = $('scoreChart').getBoundingClientRect();
  tip.style.left = Math.min(e.clientX - box.left + 16,
    box.width - tip.offsetWidth - 8) + 'px';
  tip.style.top = Math.max(4, e.clientY - box.top - 20) + 'px';
  scoreHighlight(hit.dataset.id);
});
$('scoreChart').addEventListener('mouseleave', () => {
  $('scoreTip').hidden = true;
  scoreHighlight(null);
});

/** Everything that is not this player, pushed back — for the length of a hover. */
function scoreHighlight(id) {
  for (const el of $('scoreChart').querySelectorAll('path.series, .pt')) {
    el.classList.toggle('dim', id != null && el.dataset.id !== id);
  }
}

/* ---- picking somebody out ----

   ⚠️ One set, `win.only`, and **one gesture wherever a competitor is drawn**:
   the legend chip, the marker on the chart, the square on the board, the bar in
   the era band. They are the same person keyed the same way, so clicking any of
   them has to mean the same thing or the reader has to learn four rules for one
   idea. Additive, because the question a board like this raises is usually
   about two people rather than one, and clicking a lit one again puts it back.

   ⚠️ It **dims what is not picked rather than hiding it** — everywhere, not
   only on the chart. The shape of a season, and who else was in it, is most of
   what these views are for; see `drawScore` for the first time that lesson was
   learned. */
function toggleWinPick(id) {
  if (!id) return;
  if (win.only.has(id)) win.only.delete(id); else win.only.add(id);
  repaintWinPick();
  writeHash();
}

/** True if it actually cleared something, so Escape can fall through if not. */
function clearWinPick() {
  if (!win.only.size) return false;
  win.only.clear();
  repaintWinPick();
  writeHash();
  return true;
}

/**
 * The fade, moved without redrawing the board.
 *
 * ⚠️ The board is **repainted in place, not re-rendered**. A full
 * `renderWinners` throws away several hundred `<img>` elements and builds new
 * ones, and a fresh `<img>` decodes asynchronously even from cache — so every
 * click flashed an empty board for a frame. Which is the whole picture, on a
 * gesture whose entire purpose is to make the picture easier to read.
 *
 * ⚠️ The render still applies the classes itself, from `pickedOff`, and must
 * keep doing so: a board arriving with `wp=` in the link has never been through
 * here. Two paths that have to agree, which is why both read the one predicate.
 */
function repaintWinPick() {
  // The chart redraws from a model and has no such cost, so it takes the
  // ordinary path — and its legend has to be rebuilt anyway.
  if (win.view !== 'board') return renderWinners();
  for (const el of $('winBody').querySelectorAll('.pyrtile[data-id]')) {
    const off = pickedOff(el.dataset.id);
    el.classList.toggle('faded', off);
    // The badge hangs off a wrapper around the square; it fades with it.
    if (el.parentElement && el.parentElement.classList.contains('pyrmajor')) {
      el.parentElement.classList.toggle('faded', off);
    }
  }
  for (const el of $('winBody').querySelectorAll('.erabar[data-id]')) {
    el.classList.toggle('faded', pickedOff(el.dataset.id));
  }
}

$('scoreLegend').addEventListener('click', e => {
  const lg = e.target.closest('.lg');
  if (lg) toggleWinPick(lg.dataset.id);
});

/* The marker is a face with a name attached, which is exactly what the chip
   below is — so it does what the chip does. The reader who has just hovered a
   face to find out whose line that is should not have to go and find the same
   face again in a list of twenty to pin it. */
$('scoreChart').addEventListener('click', e => {
  const hit = e.target.closest('.hit');
  if (hit) toggleWinPick(hit.dataset.id);
});

/* The board, where there is no legend at all — the squares *are* the legend.
   Delegated on the container, which survives every redraw, rather than on the
   squares, of which a doubles season can have twelve and the board six hundred.

   ⚠️ The era bar is picked up by the same handler and not by a second one. It
   carries `data-id` already and it is the same key, so a reader who clicks the
   name on a run gets exactly what they would have got by clicking one of the
   squares that run is made of. */
$('winBody').addEventListener('click', e => {
  const hit = e.target.closest('.pyrtile[data-id], .erabar[data-id]');
  if (hit) toggleWinPick(hit.dataset.id);
});

/** Whether a competitor is one of the ones being pushed back right now. */
function pickedOff(id) {
  return win.only.size > 0 && !win.only.has(String(id));
}

$('winFloorRange').addEventListener('input', e => {
  const n = Math.max(0, Math.min(SCORE_FLOOR_MAX, Number(e.target.value) || 0));
  if (n === win.floor && !win.autoFloor) return;
  win.floor = n;
  /* ⚠️ Touching the slider ends the derived default for good. Recomputing it on
     the next redraw would snap the reader's choice back the moment they clicked
     a name. */
  win.autoFloor = false;
  win.only.clear();
  renderWinners();
  writeHash();
});

/** Move the bar to a chosen point, the way the slider does. */
function stepFloorTo(n) {
  const want = Math.max(0, Math.min(SCORE_FLOOR_MAX,
    Math.round(n / SCORE_FLOOR_STEP) * SCORE_FLOOR_STEP));
  if (want === win.floor && !win.autoFloor) return false;
  win.floor = want;
  win.autoFloor = false;
  win.only.clear();
  renderWinners();
  writeHash();
  return true;
}

/** Up shows more, the same as the honours bar and the era bar. */
function stepScoreFloor(dir) {
  stepFloorTo(win.floor + dir * SCORE_FLOOR_STEP);
  return true;
}

function setWinView(v) {
  const next = WIN_VIEWS.includes(v) ? v : 'board';
  if (next === win.view) return;
  win.view = next;
  win.only.clear();
  renderWinners();
  writeHash();
}


/* ---- saving a slice of the board ----

   ⚠️ The picture is drawn by `poster.js` onto a canvas, not scraped off the
   page — see the note at the top of that file for why, and for the `crossOrigin`
   trap that decides whether the faces can be in it at all.

   The years are a *range*, not a filter: an export is something somebody else
   will look at once, and "2011 to 2016" is the shape of the claim being made.
   Both ends default to the whole board, so the first click gives a picture
   rather than a form. */

function exportYears() {
  const file = winFile();
  if (!file) return [];
  return winnersSeasons(file).years;
}

/** The range the picker is asking for, clamped and in order. */
function exportRange() {
  const years = exportYears();
  if (!years.length) return null;
  const lo = Number($('expFrom').value) || years[0];
  const hi = Number($('expTo').value) || years[years.length - 1];
  return { from: Math.min(lo, hi), to: Math.max(lo, hi) };
}

function renderExportBar() {
  const years = exportYears();
  const box = $('winExport');
  box.hidden = !win.exporting || !years.length;
  $('winSave').classList.toggle('on', win.exporting);
  $('winSave').setAttribute('aria-pressed', String(win.exporting));
  if (box.hidden) return;

  /* ⚠️ Rebuilt only when the years actually change. The selects hold the
     reader's choice, and re-rendering the options on every redraw — which is
     what a redraw of the board does — would reset it to the whole span every
     time they moved the bar. */
  const stamp = win.kind + ':' + years.join(',');
  if (box.dataset.stamp !== stamp) {
    box.dataset.stamp = stamp;
    const opts = sel => years.map(y =>
      `<option value="${y}"${y === sel ? ' selected' : ''}>${y}</option>`).join('');
    $('expFrom').innerHTML = opts(years[0]);
    $('expTo').innerHTML = opts(years[years.length - 1]);
  }
}

/** What the file is called when it lands in somebody's downloads. */
function exportName(range) {
  const what = win.view === 'score' ? 'score' : 'winners';
  return `badminton-${what}-${win.kind}-${range.from}-${range.to}.png`;
}

/** What the poster has to be told about whichever view is up. */
function posterOpts(range) {
  return win.view === 'score'
    ? {
      from: range.from, to: range.to, kind: win.kind,
      floor: win.floor, only: [...win.only],
      /* ⚠️ The axis height is handed in, because the page scales it across
         **both** draws and `poster.js` is given one file. Without this a men's
         export and a women's export of the same seasons come back at two
         different scales — which is the bug the page already fixed once. */
      top: scoreTop(),
    }
    /* ⚠️ `only` goes to the board poster too, and for the same reason the score
       poster has always had it: an export of a board with one pair followed
       across it is a different claim from an export of the board. */
    : { from: range.from, to: range.to, kind: win.kind, min: win.reign,
      eras: win.eras, only: [...win.only] };
}

async function makePoster() {
  const file = winFile();
  const range = exportRange();
  if (!file || !range) return null;
  const opts = posterOpts(range);
  return win.view === 'score' ? drawScorePoster(file, opts) : drawPoster(file, opts);
}

function exportSaying(msg, bad) {
  const el = $('expNote');
  el.textContent = msg || '';
  el.classList.toggle('is-bad', !!bad);
}

async function savePoster() {
  exportSaying('Drawing…');
  try {
    const blob = await makePoster();
    if (!blob) return exportSaying('Nothing to draw yet.', true);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportName(exportRange());
    document.body.appendChild(a);
    a.click();
    a.remove();
    /* ⚠️ Revoked on a timer rather than immediately: revoking in the same tick
       as the click races the download in Chrome and lands a zero-byte file. */
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    exportSaying(`Saved ${exportName(exportRange())}`);
  } catch (e) {
    exportSaying(e.message || String(e), true);
  }
}

async function copyPoster() {
  exportSaying('Drawing…');
  try {
    const blob = await makePoster();
    if (!blob) return exportSaying('Nothing to draw yet.', true);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    exportSaying('Copied — paste it anywhere.');
  } catch (e) {
    /* Clipboard images need a secure context and a permission most browsers
       only grant on a real click, so this is a *likely* failure rather than a
       surprising one. Saying so beats a silent no-op. */
    exportSaying('Could not copy (' + (e.message || e.name) + '). Save it instead.', true);
  }
}

$('winSave').addEventListener('click', () => {
  win.exporting = !win.exporting;
  exportSaying('');
  renderExportBar();
});
$('expSave').addEventListener('click', savePoster);
$('expCopy').addEventListener('click', copyPoster);
/* Only offered where it can work: `ClipboardItem` is missing on Firefox and on
   any page not served over https, and a button that always fails is worse than
   no button. */
$('expCopy').hidden = typeof ClipboardItem === 'undefined' || !navigator.clipboard;

const WIN_VIEW_LABEL = { board: 'Board', score: 'Score' };

function renderWinnersControls() {
  const scoring = win.view === 'score';

  $('winView').innerHTML = WIN_VIEWS.map(v =>
    `<button type="button" class="seg${v === win.view ? ' on' : ''}" data-view="${v}"`
    + ` aria-pressed="${v === win.view}">${WIN_VIEW_LABEL[v]}</button>`).join('');
  $('winView').querySelectorAll('[data-view]').forEach(btn => {
    btn.onclick = () => setWinView(btn.dataset.view);
  });

  $('winKind').innerHTML = WIN_KINDS.map(k =>
    `<button type="button" class="seg${k === win.kind ? ' on' : ''}" data-kind="${k}"
      aria-pressed="${k === win.kind}">${k}</button>`).join('');
  $('winKind').querySelectorAll('[data-kind]').forEach(btn => {
    btn.onclick = () => {
      if (btn.dataset.kind === win.kind) return;
      win.kind = btn.dataset.kind;
      writeHash();
      loadWinnersPage();
    };
  });

  const eras = $('winEras');
  eras.classList.toggle('on', win.eras);
  eras.setAttribute('aria-pressed', String(win.eras));
  eras.onclick = () => { win.eras = !win.eras; renderWinners(); writeHash(); };

  /* ⚠️ Every control that belongs to one view is **hidden** in the other, never
     disabled. A row of greyed-out buttons reads as a broken page to anybody who
     never finds out what would enable them — measured on this project already,
     with a ladder picker that was only ever seen dead. */
  eras.hidden = scoring;
  $('winZoomLbl').hidden = scoring;
  $('winFloor').hidden = !scoring;
  if (scoring) renderScoreFloor();

  /* Hidden rather than disabled when the band is off: a bar that sets something
     invisible is a control with nothing to control. */
  $('winMin').hidden = !win.eras || scoring;
  $('winMin').innerHTML = REIGN_STEPS.map(s =>
    `<button type="button" class="seg${s.key === win.reign ? ' on' : ''}"`
    + ` data-reign="${s.key}" aria-pressed="${s.key === win.reign}"`
    + ` title="${esc(`a season with ${s.full}`)}">${esc(s.label)}</button>`).join('');
  $('winMin').querySelectorAll('[data-reign]').forEach(btn => {
    btn.onclick = () => setReign(btn.dataset.reign);
  });

  const z = $('winZoom');
  if (z && Number(z.value) !== win.zoom) z.value = String(win.zoom);

  renderExportBar();
}

function setReign(key) {
  const next = reignStep(key).key;
  if (next === win.reign) return;
  win.reign = next;
  renderWinners();
  writeHash();
}

/** Which page the nav says you are on. */
function renderViewPick() {
  $('pageNav').querySelectorAll('[data-page]').forEach(b => {
    const on = b.dataset.page === page;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
}

/* The pages, one at a time. `grid.open` stays as the compare page's own flag —
   a great deal of the grid keys off it — but which page is up lives here. */
const PAGES = ['seasons', 'compare', 'tmt', 'winners'];
let page = 'seasons';

/* ⚠️ Stamped here as well as in `showPage`, and it is not belt and braces.
   `showPage` is the only thing that writes it, and boot only calls `showPage`
   when the hash asks for a page *other* than the default — so landing on the
   seasons page, which is what nearly every visit does, left the attribute
   unset. The stylesheet reads it as `body:not([data-page="seasons"])`, and an
   absent attribute matches that: the discipline picker and the *Size by weight*
   toggle were hidden on the one page they belong to, on the deployed site,
   until a reader happened to visit another page and come back. */
document.body.dataset.page = page;

function showPage(name) {
  page = PAGES.includes(name) ? name : 'seasons';
  grid.open = page === 'compare';
  $('seasonsPage').hidden = page !== 'seasons';
  $('comparePage').hidden = page !== 'compare';
  $('tmtPage').hidden = page !== 'tmt';
  $('winPage').hidden = page !== 'winners';
  // Read by the stylesheet to put away the controls that only govern the strip.
  document.body.dataset.page = page;
  if (page === 'compare') renderGrid();
  if (page === 'tmt') { renderTmt(); loadTournament(); startLive(); }
  if (page === 'winners') loadWinnersPage();
  renderViewPick();
  writeHash();
}

function openGrid() { showPage('compare'); }
function closeGrid() { showPage('seasons'); }

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

/* One slider, two scales. The grid's cell is a flat 10–40px; the board's base
   is the size of its *smallest* row and everything above it is multiplied by up
   to 8.7, so the two views cannot share a range without one of them being
   useless at both ends. They keep separate settings for the same reason: a
   zoom that suits a 20px grid does not suit a board 8.7 times as tall. */
const ZOOM = {
  grid: {
    key: 'bst:gridzoom', prop: '--cell', target: 'gridBody',
    min: 10, max: 40, step: 2, def: 20, label: 'cell size',
  },
  honours: {
    key: 'bst:honourzoom', prop: '--hbase', target: 'honBody',
    // 8 is the largest default that fits the two longest careers in the data
    // side by side on a 1440-wide screen — measured at QF+, the *widest* bar,
    // so that moving the bar never introduces a scrollbar. See honourHalfUnits.
    //
    // ⚠️ The floor is 7 because of the #1 mark, not because of layout. Every
    // row is sized `--hbase * --k`, and a Super 750 is k=2.618, so 7 puts it at
    // 18.3px — just clear of the 16px gate the mark is drawn behind. At 6 it is
    // 15.7px and every Super 750 title silently goes back to being nothing but
    // a darker green. The floor used to be 3, which is how a saved zoom could
    // leave a reader wondering where the marks went.
    min: 7, max: 16, step: 1, def: 8, label: 'square size',
  },
};

function zoomOf(view) { return ZOOM[view] || ZOOM.grid; }

function setZoom(px, save = true, view = grid.view) {
  const z = zoomOf(view);
  const n = Math.max(z.min, Math.min(z.max, Number(px) || z.def));
  $(z.target).style.setProperty(z.prop, n + 'px');
  if (view === grid.view) $('gridZoom').value = String(n);
  if (save) { try { localStorage.setItem(z.key, String(n)); } catch { /* private mode */ } }
  return n;
}

/** Point the one slider at whichever view is up, without changing its value. */
function syncZoomControl() {
  const z = zoomOf(grid.view);
  const input = $('gridZoom');
  input.min = String(z.min);
  input.max = String(z.max);
  input.step = String(z.step);
  input.setAttribute('aria-label', z.label);
  let saved = null;
  try { saved = localStorage.getItem(z.key); } catch { /* private mode */ }
  setZoom(saved || z.def, false);
}

$('gridZoom').addEventListener('input', e => setZoom(e.target.value));

for (const view of Object.keys(ZOOM)) {
  let saved = null;
  try { saved = localStorage.getItem(ZOOM[view].key); } catch { /* private mode */ }
  setZoom(saved || ZOOM[view].def, false, view);
}
syncZoomControl();

/* The three readings of a career, named and side by side.

   This used to be one button saying "Grid & compare", which hid two views
   behind a label that named neither of them — there was no way to find out the
   honours board existed except by opening something else and noticing a tab.
   Naming all three costs one row of the hero and makes the alternatives
   visible from the view you are already in.

   The strip stays the landing view. It is the only one of the three that always
   has something to say: at SF+ a world #22 is seven squares and eight empty
   rows, which is true and reads as a broken page. */
$('pageNav').addEventListener('click', e => {
  const b = e.target.closest('[data-page]');
  if (b) showPage(b.dataset.page);
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

function setGridEra(key) {
  const era = eraKey(key);
  if (era === grid.era) return;
  grid.era = era;
  /* ⚠️ The level chips are keyed on the group, and the two eras do not share
     their keys — a hidden Super 750 is `24` and a hidden Superseries is `2`.
     Left alone, switching era silently un-hides everything and then re-hides it
     on the way back, which reads as the chips forgetting themselves. Clearing
     is the honest version of that: the chips are about the ladder on screen,
     and the ladder has just been replaced. */
  grid.hiddenGroups.clear();
  renderGrid();
  writeHash();
}

$('gridEra').addEventListener('click', e => {
  const b = e.target.closest('[data-era]');
  if (b) setGridEra(b.dataset.era);
});

function setGridView(view) {
  if (view !== 'grid' && view !== 'honours') return;
  if (grid.view === view) return;
  grid.view = view;
  syncZoomControl();     // the slider now means something else
  renderGrid();
  renderViewPick();
  writeHash();
}

$('gridView').addEventListener('click', e => {
  const b = e.target.closest('[data-view]');
  if (b) setGridView(b.dataset.view);
});

$('honMin').addEventListener('click', e => {
  const b = e.target.closest('[data-hmin]');
  if (!b) return;
  grid.threshold = honourStep(b.dataset.hmin).key;
  renderGrid();
  writeHash();
});

function wireBody(id) {
  $(id).addEventListener('click', e => {
    if (e.target.closest('#cmpDrop')) removeCompare();
    else if (e.target.closest('.addslot')) $('cmpQ').focus();
  });
}
wireBody('honBody');

wireBody('gridBody');

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
/* ---------- who the box already knows about ----------

   ⚠️ BWF's search is **alphabetical, not relevant**: it returns page 1 of a
   list ordered by given name. Measured 3 Sep 2026, "viktor" put Viktor AXELSEN
   at index 13 of 30, and "chen" and "an" did not contain CHEN Yu Fei or AN Se
   Young at all — the reigning world number ones, missing from their own names.
   Sorting the answer harder cannot fix that; they are not in it.

   So the top of each ranking table is held locally and matched *before* the
   network is asked. It is also instant, which is the other half of it: BWF is
   400ms–1.2s away and until it answers the box has nothing to show at all. */

function recentPlayers() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(p => p && p.id && p.name) : [];
  } catch { return []; }        // a corrupt list is no list, not a broken page
}

function rememberPlayer(player) {
  if (!player || !player.id || !player.name) return;
  const keep = { id: String(player.id), name: player.name, slug: player.slug || '',
    country: player.country || '', countryCode: player.countryCode || '',
    flag: player.flag || '' };
  const rest = recentPlayers().filter(p => String(p.id) !== keep.id);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([keep, ...rest].slice(0, RECENT_MAX)));
  } catch { /* a full or blocked store is not worth a broken search box */ }
}

/* Fetched on first focus rather than at boot: five requests that nobody who
   never searches should pay for, and they would otherwise compete with the
   first career load. Cached twelve hours by api.js, so it is once a day. */
async function ensureRoster() {
  if (roster.asked) return;
  roster.asked = true;
  roster.loading = true;
  try { roster.players = await loadRoster(); }
  catch { roster.players = []; }     // the network search still works without it
  roster.loading = false;
  // A reader who typed while this was in flight is looking at a shorter list
  // than they should be; redraw whichever box is open.
  refreshOpenSuggestions();
}

function refreshOpenSuggestions() {
  for (const box of openBoxes) box.retryLocal();
}

/** The roster and the reader's own history, as one pool. */
function knownPlayers() {
  return roster.players.concat(recentPlayers());
}

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
    /* ⚠️ "Nothing" and "not yet" are different sentences. Before this the list
       was simply hidden until BWF answered, so for up to a second and a half a
       search that was working looked like a search box that was broken. */
    list.innerHTML = rows.length
      ? rows.map((p, i) => `<li role="option" data-id="${esc(p.id)}" data-i="${i}"`
        + ` aria-selected="${i === store.highlighted}">`
        + (p.flag ? `<img class="flag" src="${esc(p.flag)}" alt="">` : '')
        + `<span>${esc(p.name)}</span>`
        + `<span class="cc">${esc(p.countryCode || p.country || '')}</span></li>`).join('')
      : store.searching ? '<li class="none">Searching…</li>'
      : '<li class="none">No player of that name</li>';
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function close() {
    store.suggestions = null;
    store.highlighted = -1;
    store.searching = false;
    draw();
  }

  function pick(player) {
    if (!player) return;
    close();
    onPick(player);
  }

  /* Two answers to every keystroke.
     The local one is drawn immediately — no await, no debounce, the roster is
     already in memory — so the players almost everybody searches for appear as
     fast as the letters do. BWF is then asked on the usual delay and merged in
     underneath, because the roster is only the current top of five tables and
     the careers worth looking up historically are in none of them. */
  function localFor(q) {
    return q.length < 2 ? [] : rosterMatches(knownPlayers(), q);
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clearTimeout(timer);
    if (q.length < 2) { close(); return; }

    const local = localFor(q);
    store.suggestions = local;
    store.highlighted = local.length ? 0 : -1;
    /* Only while there is nothing yet: a list that is already showing the right
       player should not also be saying it is still looking. */
    store.searching = !local.length;
    draw();

    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const found = await searchPlayers(q);
        if (mine !== seq) return;               // a later keystroke already won
        store.searching = false;
        // Recomputed rather than reused: the roster may have landed meanwhile.
        store.suggestions = mergeSuggestions(localFor(q), found);
        store.highlighted = store.suggestions.length ? 0 : -1;
        draw();
      } catch {
        if (mine !== seq) return;
        store.searching = false;
        // The local list is still a real answer, so it is kept rather than
        // thrown away because BWF was unreachable.
        if (!store.suggestions || !store.suggestions.length) close();
        else draw();
      }
    }, 320);
  });

  /* The five roster requests are paid for by somebody who is about to search,
     not by everybody who loads the page. */
  input.addEventListener('focus', () => { ensureRoster(); });

  /* Called when the roster lands, in case it landed mid-query. */
  function retryLocal() {
    const q = input.value.trim();
    if (q.length < 2 || !store.suggestions) return;
    const merged = mergeSuggestions(localFor(q), store.suggestions);
    if (merged.length === store.suggestions.length
      && merged.every((p, i) => p.id === store.suggestions[i].id)) return;
    store.suggestions = merged;
    store.highlighted = merged.length ? 0 : -1;
    store.searching = false;
    draw();
  }
  openBoxes.push({ retryLocal });

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
  rememberPlayer(player);
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
/* ============================ keyboard ============================

   Every shortcut here does something the page already offers with a click. It
   is a faster route through the same controls, never a hidden feature.

   ⚠️⚠️ **Nothing fires while a modifier is held.** `Alt`+arrow is the browser's
   Back and Forward, `Ctrl`+O opens a file, `Ctrl`+S saves the page and `Ctrl`+W
   closes the tab — every one of those collides with a letter below. So a
   modified keystroke is ignored *and left alone*: not handled, not prevented,
   passed straight through to the browser.

   ⚠️ **Nothing fires while you are typing**, which matters more than it sounds:
   the app focuses the search box on load, so on a fresh page every letter here
   would land in it rather than reaching the page. `Escape` blurs the box for
   exactly this reason — it is the way out of the field and into the shortcuts.

   ⚠️ **The arrows are taken from the page scroller, on purpose and only where
   they earn it.** Left and Right move between pages everywhere; Up and Down are
   claimed *only* on the tournament page, where they step the day or the fold.
   That page has a scroller of its own — an unfolded 64 draw is 1906px inside a
   ~900px viewport — so the trade is real: the mouse wheel, the scrollbar,
   PageUp/PageDown, Home/End and the space bar all still scroll it, and every
   other page keeps its arrows.
   ==================================================================== */

/** Anywhere text is being entered, the keyboard belongs to the field. */
function isTyping(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
    || el.isContentEditable;
}

/** Wrapping, because four pages in a ring beats two dead ends. */
function stepPage(by) {
  const i = PAGES.indexOf(page);
  showPage(PAGES[(i + by + PAGES.length) % PAGES.length]);
}

/**
 * Step through a list of values, clamped.
 *
 * ⚠️ Clamped rather than wrapped, unlike the pages: these lists have real ends.
 * Pressing Down on the last day of a tournament should stay there, not jump
 * back to "All" — and the same for folding past the semi-finals.
 */
function stepIn(list, current, by) {
  const i = list.indexOf(current);
  if (i < 0) return list[0];
  return list[Math.min(list.length - 1, Math.max(0, i + by))];
}

/* ---- the tournament's disciplines ----

   ⚠️ The same keystroke has to mean the same thing in both views, and the two
   views hold the discipline in genuinely different ways: the bracket **picks**
   one draw, while the order of play **filters** several, any number of which
   can be on at once. So M/W/X mean "show me the men's singles" in both — in the
   bracket that picks the draw, and in the order of play it isolates it, hiding
   the rest. Pressing the same letter again moves to that gender's doubles,
   which is the only sensible reading of one letter for two draws. Clicking the
   chips undoes any of it. */

const DISCIPLINE_KEY = { m: ['MS', 'MD'], w: ['WS', 'WD'], x: ['XD'] };

/** The draw the tournament page is currently *about*, in either view. */
function soleDraw() {
  if (tmt.view === 'draw') return tmt.drawCode;
  const shown = drawsPresent(tmt.matches).filter(d => !tmt.hiddenDraws.has(d));
  return shown.length === 1 ? shown[0] : null;
}

function isolateDraw(code) {
  const present = drawsPresent(tmt.matches);
  tmt.hiddenDraws = new Set(present.filter(d => d !== code));
  renderTmt();
  writeHash();
}

function cycleDiscipline(letter) {
  const wanted = DISCIPLINE_KEY[letter];
  if (!wanted) return false;
  // Only the ones this tournament actually runs: a letter for a draw that is
  // not there should do nothing rather than blank the view.
  const have = tmt.view === 'draw'
    ? tmt.drawList.map(d => d.code)
    : drawsPresent(tmt.matches);
  const options = wanted.filter(c => have.includes(c));
  if (!options.length) return false;
  const at = options.indexOf(soleDraw());
  const next = options[(at + 1) % options.length];
  if (tmt.view === 'draw') pickDrawCode(next); else isolateDraw(next);
  return true;
}

/** Up and down on the tournament page: the day, or how much of the draw. */
function stepTournament(by) {
  if (tmt.view === 'draw') {
    const draw = currentDraw();
    if (!draw) return false;
    // Rounds outermost first, minus the final — the same list the chips offer.
    const rounds = ['all', ...bracketRounds(draw).slice(1, -1).map(r => r.round)];
    if (rounds.length < 2) return false;
    // Up shows more of the draw, down shows less. Up is out, as it is in a map.
    pickRound(stepIn(rounds, resolvedRound(draw, tmt.round), by));
    return true;
  }
  const days = ['all', ...tournamentDays(tmt.pick && tmt.pick.tmt)];
  if (days.length < 2) return false;
  pickDay(stepIn(days, tmt.day, by));
  return true;
}

/**
 * The QF+ / SF+ / F+ / W bar, on the arrows.
 *
 * ⚠️ Only on the honours board, because that is the only place the bar exists —
 * `honMin` is hidden in the grid view. So the arrows are *not* claimed on the
 * grid, where they go on scrolling a career that is taller than the window,
 * which is the right answer for a page with nothing to step.
 *
 * Up lowers the bar and down raises it, which is the same direction as the
 * bracket's fold: up shows more.
 */
function stepHonourBar(by) {
  if (grid.view !== 'honours') return false;
  const next = stepIn(HONOUR_STEPS.map(s => s.key), grid.threshold, by);
  if (next === grid.threshold) return true;    // at the end, but still handled
  grid.threshold = honourStep(next).key;
  renderGrid();
  writeHash();
  return true;
}

/* ---- stepping the level chips ----

   ⚠️ **Up adds the highest that is off, down removes the lowest that is on.**
   Not "the next one along from wherever you last were": there is no cursor on a
   row of chips, and a key that depended on one would do different things
   depending on what had been clicked. Working from the ends means the two keys
   are inverses of each other — every press of down is undone by a press of up —
   and it walks the ladder the way somebody narrowing a career actually thinks:
   *drop the small ones, keep the big ones.*

   ⚠️ The order is the **chip order**, which is the order on screen, so what the
   key does is visible before it is pressed. On the Seasons page that is
   `LEVEL_ORDER` filtered to what the career holds; on the Compare grid it is
   `gridOrder`, which changes with the era switch. Neither is the numeric order
   of BWF's category ids, which is arbitrary.
   ==================================================================== */

/**
 * Which chip the key should press, read off **the chips themselves**.
 *
 * ⚠️ Off the row that is rendered, not off `LEVEL_ORDER` or `gridOrder`. Those
 * are what the row is *built* from, and a key that walked the source list would
 * eventually reach for something the page had not drawn — the tail behind the
 * **more** menu on the Seasons page is a dozen unmapped Superseries-era ids, and
 * switching one of those on changes the strip with nothing on screen moving to
 * explain it. What is on the bar is what the keys can reach.
 *
 * @param {string} id  the chip row
 * @param {number} by  -1 to add the highest that is off, +1 to remove the lowest on
 * @returns {HTMLElement|null}
 */
function nextLevelChip(id, by) {
  const chips = [...$(id).querySelectorAll('.chip')];
  return (by < 0 ? chips.find(c => !c.classList.contains('on'))
    : chips.reverse().find(c => c.classList.contains('on'))) || null;
}

/** The Seasons page's level chips. */
function stepSeasonLevel(by) {
  const chip = nextLevelChip('levels', by);
  if (!chip) return !!$('levels').querySelector('.chip');   // nothing left to do
  toggleLevel(chip.dataset.cat);
  return true;
}

/** The Compare page's grid, whose chips are sections rather than raw levels. */
function stepGridGroup(by) {
  if (grid.view !== 'grid') return false;
  const chip = nextLevelChip('gridGroups', by);
  if (!chip) return !!$('gridGroups').querySelector('.chip');
  const g = chip.dataset.group;
  if (grid.hiddenGroups.has(g)) grid.hiddenGroups.delete(g);
  else grid.hiddenGroups.add(g);
  renderGrid();
  writeHash();
  return true;
}

function setWinKind(kind) {
  if (!WIN_KINDS.includes(kind) || kind === win.kind) return;
  win.kind = kind;
  /* ⚠️ The pick does not survive a change of discipline. It is keyed on player
     ids, so a pair picked out of the men's doubles matches nothing at all in the
     mixed — and `pickedOff` would then be true for every square on the new
     board, which is a board dimmed to nothing with no visible cause. Switching
     draw is switching subject; the same reasoning as `setWinView`. */
  win.only.clear();
  writeHash();
  loadWinnersPage();
}

/**
 * What a key does, given where you are. Returns true if it did something —
 * only then is the browser's own behaviour suppressed.
 */
function runHotkey(key) {
  if (key === 'ArrowLeft') { stepPage(-1); return true; }
  if (key === 'ArrowRight') { stepPage(1); return true; }

  if (page === 'seasons') {
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      return stepSeasonLevel(key === 'ArrowUp' ? -1 : 1);
    }
    return false;
  }

  if (page === 'compare') {
    if (key === 'g') { setGridView('grid'); return true; }
    if (key === 'h') { setGridView('honours'); return true; }
    if (key === 'w') { setGridEra('wt'); return true; }
    if (key === 's') { setGridEra('ss'); return true; }
    /* Up shows more on both views, and what "more" means is what each view has
       to give: another round on the honours board, another level on the grid. */
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      const by = key === 'ArrowUp' ? -1 : 1;
      return grid.view === 'honours' ? stepHonourBar(by) : stepGridGroup(by);
    }
    return false;
  }

  if (page === 'tmt') {
    if (key === 'o') { setTmtView('oop'); return true; }
    if (key === 'b') { setTmtView('draw'); return true; }
    if (key === 'ArrowUp') return stepTournament(-1);
    if (key === 'ArrowDown') return stepTournament(1);
    /* ⚠️ Before the discipline letters, so that S is Starred only here. It is
       Superseries on the compare page, which is a different page — one letter
       can mean two things as long as it never means both at once. */
    if (key === 's') {
      tmt.starredOnly = !tmt.starredOnly;
      renderTmt();
      writeHash();
      return true;
    }
    return cycleDiscipline(key);
  }

  if (page === 'winners') {
    /* ⚠️ The tournament page's idiom, borrowed rather than invented: M is the
       men's singles and M again is the men's doubles. Five draws will not fit
       five letters that anybody would guess, and a reader who has learned the
       double-tap on one page has learned it here. */
    if (DISCIPLINE_KEY[key]) {
      const options = DISCIPLINE_KEY[key].filter(c => WIN_KINDS.includes(c));
      if (!options.length) return false;
      setWinKind(options[(options.indexOf(win.kind) + 1) % options.length]);
      return true;
    }
    if (key === 'b') { setWinView('board'); return true; }
    /* ⚠️ S rather than D. It is Superseries on the compare page and Starred on
       the tournament page, which is fine — a letter may mean two things as long
       as it never means both at once — and "score" is the word on the button. */
    if (key === 's') { setWinView('score'); return true; }
    if (win.view === 'score') {
      // The same two keys as the honours bar and the era bar: up shows more.
      if (key === 'ArrowUp') return stepScoreFloor(-1);
      if (key === 'ArrowDown') return stepScoreFloor(1);
      /* The two orderings of the ranking, by their initials. Neither letter is
         doing anything else on this page. */
      if (key === 't') return setRankMode('total') || true;
      if (key === 'p') return setRankMode('peak') || true;
      // The pandemic seasons, in or out of the ranking.
      if (key === 'c') return setCovid(!win.covid) || true;
      return false;
    }
    if (key === 'e') { win.eras = !win.eras; renderWinners(); writeHash(); return true; }
    /* The same two keys as the honours bar, doing the same thing: up shows
       more. Only while the band is on — with nothing to move they are left to
       the page scroller, which this page badly needs. */
    if ((key === 'ArrowUp' || key === 'ArrowDown') && win.eras) {
      setReign(stepIn(REIGN_STEPS.map(r => r.key), win.reign,
        key === 'ArrowUp' ? -1 : 1));
      return true;
    }
  }
  return false;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    openPanel($('topBtn'), $('topPanel'), false);
    openPanel($('moreBtn'), $('morePanel'), false);
    /* ⚠️ The way back from a pick, and the reason picking is safe to make
       additive. Clicking a lit square again un-picks it, but on a board of six
       hundred squares "which three did I click?" is a question the reader
       should never have to answer to get their board back. */
    if (page === 'winners' && !isTyping(e.target)) clearWinPick();
    /* The way out of the search box, which the app focuses on load — and so the
       way in to everything below. */
    if (isTyping(e.target) && e.target.blur) e.target.blur();
    return;
  }
  // Left entirely alone: this is the browser's keystroke, not the page's.
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (isTyping(e.target)) return;
  if (runHotkey(e.key.length === 1 ? e.key.toLowerCase() : e.key)) e.preventDefault();
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

/* ============================ the tournament now ============================

   The one page that is not about a player. It shows whatever tournament BWF
   says is current and that day's order of play, and nobody has to choose
   anything for it to be right.
   ==================================================================== */

const tmt = {
  schedule: null,
  pick: null,             // {tmt, state} from the model
  day: null,              // YYYY-MM-DD
  matches: [],
  hiddenDraws: new Set(),
  loading: false,
  error: null,
  wantDay: null,          // a day from the hash, before the schedule has landed
  wantCode: null,         // a tournament pinned by the hash, when two are on
  pickedFor: null,        // the date the current pick was made against
  byDay: new Map(),       // day -> that day's matches, so "All" is one merge
  starred: new Set(),     // match ids the reader picked out
  starredOnly: false,
  fresh: new Map(),       // match id -> when it last moved under us
  checked: null,          // when the scores were last asked for
  moved: 0,               // how many moved on that check

  /* The bracket. A second reading of the same tournament, so it shares the
     pick, the stars and the freshness marks and keeps only what is its own. */
  view: 'oop',            // 'oop' | 'draw'
  drawList: [],           // the disciplines, with the drawId each one has
  drawFor: null,          // the tmtId drawList belongs to, so a switch clears it
  drawCode: null,         // the discipline showing
  wantDraw: null,         // one asked for by the hash, before the list has landed
  draws: new Map(),       // drawId -> parsed bracket
  round: null,            // the round to lay out from; null follows the tournament
  drawLoading: false,
  drawError: null,
};
let tmtToken = 0;
let drawToken = 0;
let liveTimer = null;

/* ---------- stars ----------

   The point of the page, and the reason the predecessor called it Follow
   Matches: the whole day is on screen, so the default has to recede far enough
   that a handful of picked-out cards read at a glance from across the room.

   Keyed by match id, which is unique across a tournament — the `code` is only
   unique within one draw, so MS and WD would collide. Kept in localStorage
   because a star is a decision, and losing it on a refresh mid-session is the
   one thing that would stop anybody using it. */

const STAR_KEY = 'bst:starred';

function readStars() {
  try {
    const raw = JSON.parse(localStorage.getItem(STAR_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch { return new Set(); }
}

function writeStars() {
  try { localStorage.setItem(STAR_KEY, JSON.stringify([...tmt.starred])); }
  catch { /* private mode — the stars still work for this session */ }
}

const isStarred = m => tmt.starred.has(String(m.id));

function toggleStar(id) {
  const k = String(id);
  if (tmt.starred.has(k)) tmt.starred.delete(k); else tmt.starred.add(k);
  writeStars();
  renderTmt();
}

function clearStars() {
  tmt.starred.clear();
  writeStars();
  renderTmt();
}

tmt.starred = readStars();

/* Today, as a string, and overridable from the hash.
 *
 * Everything on this page is decided by comparing dates against the calendar
 * BWF returns, so a suite replaying an August 2026 fixture in December would be
 * testing a different branch every run. `#now=YYYY-MM-DD` pins it. It is a
 * debugging aid as much as a test seam: it is the only way to see what the page
 * will do on finals day without waiting for one. */
let pinnedToday = null;
function todayStr() {
  if (pinnedToday) return pinnedToday;
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

const STATE_WORD = {
  live: 'On now',
  upcoming: 'Up next',
  finished: 'Finished',
};

/** The schedule, then the chosen day's matches. */
async function loadTournament(opts = {}) {
  if (tmt.loading) return;
  const token = ++tmtToken;
  tmt.loading = true;
  tmt.error = null;
  renderTmt();

  try {
    /* Re-decide when the date it was decided against has moved. In the app that
       is a tab left open overnight; in a suite or a screenshot it is `now=`
       changing in the hash, which used to be silently ignored because a
       schedule had already been fetched. */
    if (!tmt.schedule || opts.fresh || tmt.pickedFor !== todayStr()) {
      tmt.schedule = await loadSchedule({ fresh: !!opts.fresh });
      if (token !== tmtToken) return;
      tmt.pickedFor = todayStr();
      tmt.pick = pickTournament(tmt.schedule, todayStr(), tmt.wantCode);
      const days = tournamentDays(tmt.pick && tmt.pick.tmt);
      // A day from the hash only counts if this tournament actually has it.
      tmt.day = (tmt.wantDay && days.includes(tmt.wantDay)) ? tmt.wantDay
        : defaultDay(tmt.pick && tmt.pick.tmt, tmt.pick && tmt.pick.state, todayStr());
      tmt.wantDay = null;
    } else if (tmt.wantDay) {
      const days = tournamentDays(tmt.pick && tmt.pick.tmt);
      if (days.includes(tmt.wantDay)) tmt.day = tmt.wantDay;
      tmt.wantDay = null;
    }
    if (tmt.pick && tmt.day) await loadDay(tmt.day, token, opts);
  } catch (e) {
    if (token !== tmtToken) return;
    tmt.error = 'Could not load from BWF: ' + e.message;
  }

  if (token !== tmtToken) return;
  tmt.loading = false;
  if (opts.fresh) tmt.checked = new Date();
  /* A bracket fills in as the week goes, so the live check refreshes it too —
     but only while it is the view being looked at. */
  if (tmt.view === 'draw') loadBracket({ fresh: !!opts.fresh });
  renderTmt();
  writeHash();
}

/**
 * One day, or all of them.
 *
 * "All" is a real request per day, which the predecessor did not need because
 * it held the whole draw. Seven of them at the queue's 320ms pacing is a couple
 * of seconds, they land in the cache, and the page redraws as each arrives
 * rather than sitting blank until the last one — a day you can already read is
 * worth more than a complete page you are waiting for.
 */
async function loadDay(day, token, opts = {}) {
  const days = day === 'all' ? tournamentDays(tmt.pick && tmt.pick.tmt) : [day];
  const seen = new Map();

  for (const d of days) {
    const raw = await loadDayMatches(tmt.pick.tmt.code, d, { fresh: !!opts.fresh });
    if (token !== tmtToken) return;
    const list = parseDayMatches(raw, d);

    // Only on a refresh: on a first load *everything* is new, which is not news.
    if (opts.fresh) {
      const before = new Map((tmt.byDay.get(d) || []).map(m => [m.id, matchSignature(m)]));
      for (const m of list) {
        const was = before.get(m.id);
        if (was != null && was !== matchSignature(m)) {
          tmt.fresh.set(m.id, Date.now());
          tmt.moved++;
        }
      }
    }

    tmt.byDay.set(d, list);
    seen.set(d, list);
    // Show what has arrived so far, in day order.
    tmt.matches = [...seen.keys()].sort().flatMap(k => seen.get(k));
    if (days.length > 1) renderTmt();
  }
  tmt.matches = days.flatMap(d => tmt.byDay.get(d) || []);
}

/** Switch day without re-asking for the schedule. */
async function pickDay(day) {
  if (!tmt.pick || day === tmt.day) return;
  const token = ++tmtToken;
  tmt.day = day;
  tmt.matches = [];
  tmt.loading = true;
  tmt.error = null;
  renderTmt();
  writeHash();
  try {
    await loadDay(day, token);
  } catch (e) {
    if (token !== tmtToken) return;
    tmt.error = 'Could not load from BWF: ' + e.message;
  }
  if (token !== tmtToken) return;
  tmt.loading = false;
  renderTmt();
}

/* ---------- the bracket ----------

   The other reading of the same tournament. The order of play answers "what is
   on court today"; the draw answers "where is this all heading", which is the
   question a tournament page cannot answer from one day's fixtures.

   ⚠️ Loaded only when the view is actually opened. It is two requests per
   discipline switch and most readers come for the day's matches, so a page that
   fetched all five draws on arrival would spend the reader's rate limit on
   something they never looked at. */

/** Every draw at this tournament, then the one that is showing. */
async function loadBracket(opts = {}) {
  const t = tmt.pick && tmt.pick.tmt;
  if (!t || !t.id) return;
  const token = ++drawToken;
  /* Switching between two tournaments running the same week keeps the page but
     changes everything on it: the drawIds are that tournament's, and MS at one
     is not MS at the other. */
  if (tmt.drawFor !== t.id) {
    tmt.drawFor = t.id;
    tmt.drawList = [];
    tmt.draws.clear();
    tmt.drawCode = null;
  }
  tmt.drawError = null;
  tmt.drawLoading = true;
  renderTmt();

  try {
    // The list of draws at a tournament is settled before it starts, so a live
    // refresh re-asks for the bracket and never for this.
    if (!tmt.drawList.length) {
      const list = parseDrawList(await loadDrawList(t.id));
      if (token !== drawToken) return;
      tmt.drawList = list;
    }
    /* ⚠️ Outside the block above, not inside it. A link naming a discipline is
       usually followed *while the list is already loaded* — the reader is
       already on the page — so honouring `dr=` only on the first fetch meant a
       bracket link opened on whatever was showing before. Falling back to the
       first draw covers the other case: a link made at a tournament that ran a
       discipline this one does not, which should not blank the page. */
    if (tmt.wantDraw) {
      const want = tmt.drawList.find(d => d.code === tmt.wantDraw);
      if (want) tmt.drawCode = want.code;
      tmt.wantDraw = null;
    }
    if (!tmt.drawCode) tmt.drawCode = (tmt.drawList[0] || {}).code || null;
    const d = tmt.drawList.find(x => x.code === tmt.drawCode);
    if (!d) { tmt.drawLoading = false; renderTmt(); return; }

    if (!tmt.draws.has(d.id) || opts.fresh) {
      const raw = await loadDrawData(t.id, d.id, { fresh: !!opts.fresh });
      if (token !== drawToken) return;
      tmt.draws.set(d.id, parseDraw(raw));
    }
  } catch (e) {
    if (token !== drawToken) return;
    /* ⚠️ Expected, not exceptional: `vue-tournament-draw-data` returns 500 for
       some tournaments — Paris 2024 and the 2026 Indonesia Open are both known
       (Part 3.4d) — and a bracket *is* that payload, so there is nothing to
       fall back to. What matters is that the order of play beside it stays
       reachable rather than the page going down with the draw. */
    tmt.drawError = 'BWF would not give up this draw (' + e.message
      + '). The order of play still works.';
  }
  if (token !== drawToken) return;
  tmt.drawLoading = false;
  renderTmt();
}

const currentDraw = () => {
  const d = tmt.drawList.find(x => x.code === tmt.drawCode);
  return d ? tmt.draws.get(d.id) || null : null;
};

function setTmtView(view) {
  if (tmt.view === view) return;
  tmt.view = view;
  writeHash();
  renderTmt();
  if (view === 'draw') loadBracket();
}

function pickDrawCode(code) {
  if (code === tmt.drawCode) return;
  tmt.drawCode = code;
  /* The round belonged to the draw being left. Two disciplines at the same
     tournament can be different sizes — the men's singles at Pontianak is a 64
     and the women's is a 32 — so "R64" is not even a round the next one has. */
  tmt.round = null;
  writeHash();
  renderTmt();
  loadBracket();
}

function pickRound(round) {
  tmt.round = round;
  writeHash();
  renderTmt();
}

/* A seed, in the brackets an order of play is printed with.
 *
 * ⚠️ **Always bracketed, never bare.** BWF hands back a plain `"1"`, and a bare
 * numeral beside a name is the one thing on a match card that could be read as
 * anything — a score, a game count, a court. `[1]` is how a draw sheet writes a
 * seeding and it cannot be mistaken for a number that was played for. The
 * brackets are punctuation, so they live here and not in the model: `sd.seed`
 * stays the string BWF sent. */
function seedTag(sd) {
  return sd.seed ? `[${esc(sd.seed)}]` : '';
}

/* One side of a bracket card. The same reading order as the order of play —
   flag, seed, name, that side's games — in a card a third of the width, so the
   country line and the round label the big card carries are dropped rather than
   shrunk. */
function bracketSide(m, sd) {
  const cls = ['bside', sd.won ? 'is-winner' : '', sd.lost ? 'is-loser' : '']
    .filter(Boolean).join(' ');
  /* ⚠️ Surnames only. A doubles pair written in full is four names in a 190px
     card; the predecessor found the same thing and shortened its pair names
     everywhere for it. Singles keep the full name, and the full form is on the
     card's tooltip either way. */
  const names = sd.players.length
    ? (sd.players.length > 1
      ? sd.players.map(pl => surnameOf(pl.name)).join(' / ')
      : sd.players[0].name)
    : `<span class="muted">${m.bye ? 'Bye' : '—'}</span>`;
  const sets = sd.games.map(g => `<b class="${g.won ? 'won' : ''}">${g.own}</b>`).join('');
  const mark = m.note && sd.lost ? `<b class="mk">${esc(m.note.short)}</b>` : '';
  return `<div class="${cls}">`
    + (sd.flag ? `<img class="flag" src="${esc(sd.flag)}" alt="${esc(sd.country)}">`
      : '<span class="flag"></span>')
    + `<span class="seed">${seedTag(sd)}</span>`
    + `<span class="bn">${sd.players.length ? esc(names) : names}</span>`
    + `<span class="bsc">${sets}${mark}</span></div>`;
}

function bracketCardHtml(card) {
  const m = card.match;
  const star = isStarred(m);
  const dimming = tmt.starred.size > 0;
  const moved = tmt.fresh.get(m.id);
  const cls = ['bcard', 'is-' + m.status,
    m.bye ? 'is-bye' : '',
    star ? 'is-starred' : dimming && !m.bye ? 'is-dim' : '',
    moved && Date.now() - moved < FRESH_MS ? 'is-fresh' : ''].filter(Boolean).join(' ');

  // The full names, which the card itself has no room for.
  const who = m.sides.map(sd => sd.players.map(pl => pl.name).join(' / ') || 'TBD').join('  v  ');
  const tip = m.bye
    ? `${who.replace('  v  TBD', '')}\nThrough without playing`
    : `${who}\n${m.round}${m.time ? ' · ' + m.time : ''}`
      + (star ? '\nStarred — click to remove' : '\nClick to star this match');

  return `<article class="${cls}" data-id="${esc(m.id)}" data-bye="${m.bye}"`
    + ` style="left:${card.x}px;top:${card.y}px;width:${card.w}px;height:${card.h}px"`
    + ` title="${esc(tip)}">`
    + m.sides.map(sd => bracketSide(m, sd)).join('')
    + '</article>';
}

function renderDrawBars() {
  const draw = currentDraw();
  $('tmtDrawPick').innerHTML = tmt.drawList.map(d => {
    const on = d.code === tmt.drawCode;
    return `<button type="button" class="chip${on ? ' on' : ''}" data-code="${esc(d.code)}"`
      + ` aria-pressed="${on}" title="${esc(d.label + (d.size ? ` — ${d.size} draw` : ''))}">`
      + `${esc(d.code)}${d.size ? `<span class="n">${d.size}</span>` : ''}</button>`;
  }).join('');

  /* The rounds that can be folded to. The last one is left off: "Final" would
     be one card, which is not a bracket, and `fromCol` refuses to go past the
     semi-finals anyway — offering a chip that silently does something else is
     worse than not offering it. */
  const rounds = draw ? bracketRounds(draw).slice(1, -1) : [];
  const active = draw ? resolvedRound(draw, tmt.round) : 'all';
  const chip = (val, text, title) =>
    `<button type="button" class="chip${val === active ? ' on' : ''}" data-round="${esc(val)}"`
    + ` aria-pressed="${val === active}" title="${esc(title)}">${esc(text)}</button>`;
  $('tmtRounds').innerHTML = rounds.length
    ? chip('all', 'All', 'The whole draw, first round included')
      + rounds.map(r => chip(r.round, r.round,
        `Re-lay the tree out from the ${r.round}`)).join('')
    : '';
}

function renderBracket() {
  const body = $('tmtDrawBody');
  const canvas = $('tmtCanvas');
  const draw = currentDraw();

  // The schedule failing is a bigger problem than the draw failing, and this is
  // the only place it can be said while the bracket is the view.
  if (tmt.error) {
    canvas.style.width = canvas.style.height = '';
    canvas.innerHTML = `<p class="gnote error">${esc(tmt.error)}</p>`;
    return;
  }
  if (tmt.drawError) {
    canvas.style.width = canvas.style.height = '';
    canvas.innerHTML = `<p class="gnote error">${esc(tmt.drawError)}</p>`;
    return;
  }
  if (!draw) {
    canvas.style.width = canvas.style.height = '';
    canvas.innerHTML = tmt.drawLoading
      ? '<p class="gnote">Working out the bracket…</p>'
      : `<p class="gnote">BWF has not published ${tmt.drawList.length ? 'this draw'
        : 'the draws'} yet.</p>`;
    return;
  }

  const L = bracketLayout(draw, tmt.round);
  canvas.style.width = L.width + 'px';
  canvas.style.height = L.height + 'px';
  canvas.innerHTML =
    L.labels.map(l => `<div class="bcol" style="left:${l.x}px;top:${l.y}px;`
      + `width:${l.w}px">${esc(l.text)}</div>`).join('')
    + L.lines.map(n => `<div class="bline" style="left:${n.x}px;top:${n.y}px;`
      + `width:${n.w}px;height:${n.h}px"></div>`).join('')
    + L.cards.map(bracketCardHtml).join('');
  body.dataset.cards = L.cards.length;
}

$('tmtView').addEventListener('click', e => {
  const b = e.target.closest('[data-view]');
  if (b) setTmtView(b.dataset.view);
});

$('tmtDrawPick').addEventListener('click', e => {
  const b = e.target.closest('[data-code]');
  if (b) pickDrawCode(b.dataset.code);
});

$('tmtRounds').addEventListener('click', e => {
  const b = e.target.closest('[data-round]');
  if (b) pickRound(b.dataset.round);
});

/* A bye has nobody to play, so there is nothing to star — and a card that
   highlights on hover but does nothing when clicked is worse than an inert one. */
$('tmtCanvas').addEventListener('click', e => {
  const card = e.target.closest('.bcard');
  if (!card || card.dataset.bye === 'true' || !card.dataset.id) return;
  toggleStar(card.dataset.id);
});

/* ---------- checking for changes ----------

   Only while something is actually being played, and only while the page is in
   front of somebody. A tournament that finished last week does not change, and
   polling a background tab for scores nobody is reading is exactly the sort of
   thing that gets a client blocked. */

const LIVE_MS = 60000;
const FRESH_MS = 3 * 60 * 1000;   // how long a card stays marked as having moved

function liveWanted() {
  return page === 'tmt' && tmt.pick && tmt.pick.state === 'live'
    && document.visibilityState === 'visible';
}

async function checkScores() {
  if (!liveWanted() || tmt.loading) return;
  await loadTournament({ fresh: true });
}

function paintLive() {
  const btn = $('tmtRefresh');
  if (!btn) return;
  const when = tmt.checked
    ? tmt.checked.toTimeString().slice(0, 5) : null;
  btn.title = (when ? `Scores last checked at ${when}. ` : '')
    + (liveWanted() ? `Checking every ${LIVE_MS / 1000} seconds. ` : '')
    + 'Click to check now.';
  btn.classList.toggle('is-live', !!liveWanted());
}

function startLive() {
  if (liveTimer) return;
  liveTimer = setInterval(checkScores, LIVE_MS);
  /* The high-value moment is coming back to a tab left open through a session.
     Waiting out the rest of the interval would show a stale page at exactly the
     moment somebody looked at it. */
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkScores();
  });
}

/* ---------- drawing it ---------- */

/* BWF's own reading order for a match: flag, seed, name, then that side's game
   scores as badges. The predecessor's layout, and it is the right one — a row
   of numbers beside a name says who won which game without the reader doing
   any arithmetic on a joined "21-14 14-21" line. */
function sideHtml(sd, note) {
  const cls = ['side', sd.won ? 'is-winner' : '', sd.lost ? 'is-loser' : '']
    .filter(Boolean).join(' ');
  const names = sd.players.length
    ? sd.players.map(pl => esc(pl.name)).join(' / ')
    : '<span class="muted">TBD</span>';
  const sets = sd.games.map(g =>
    `<b class="${g.won ? 'won' : ''}">${g.own}</b>`).join('');
  // The mark belongs to whoever it happened to, which is the side that lost.
  const mark = note && sd.lost ? `<b class="mk">${esc(note.short)}</b>` : '';

  return `<div class="${cls}">`
    + (sd.flag ? `<img class="flag" src="${esc(sd.flag)}" alt="${esc(sd.country)}">`
      : '<span class="flag"></span>')
    + `<span class="seed">${seedTag(sd)}</span>`
    + `<span class="nm">${names}<small class="sub">${esc(sd.country)}</small></span>`
    + `<span class="sets">${sets}${mark}</span></div>`;
}

/** The venue clock, and the reader's own where it differs. Always 24-hour. */
function localClock(m) {
  if (!m.utc) return '';
  const at = new Date(m.utc.replace(' ', 'T') + 'Z');
  if (Number.isNaN(at.getTime())) return '';
  const here = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return here === m.time ? '' : here;
}

function matchHtml(m) {
  const statCls = m.note ? 'finished is-note' : m.status;
  const head = `<span class="rnd">${esc(m.round)}</span>`
    + '<span class="sep">&middot;</span>'
    + `<span class="ev">${esc(m.draw)}</span>`
    + `<span class="sep court">&middot;</span><span class="court">${esc(m.court)}</span>`
    + `<span class="stat ${statCls}">${esc(m.statusWord)}</span>`;

  /* A match BWF gave a time to says it plainly; one that only says "Followed
     by" is carrying a flat 50-minute estimate that on some courts runs
     backwards, so it is marked approximate rather than presented as fact.
     ⚠️ "Not before 5:00 PM" is a published time and is **not** marked — it opens
     a session, which is also what the grid builds its rows on. */
  const tip = m.estimated
    ? ' title="Estimated — this match follows the one before it on court"' : '';
  const approx = m.estimated ? '&asymp;' : '';
  const here = localClock(m);
  const foot = [
    m.time ? `<span${tip}>${approx}${esc(m.time)}</span>` : '<span>Time to be confirmed</span>',
    // Only when it is a different clock. Beside an identical number it would be
    // two readings of the same thing taking up a line.
    here ? `<span class="local"${tip}>${approx}${esc(here)} yours</span>` : '',
    m.oop ? `<span class="oopt"${tip}>${esc(m.oop)}</span>` : '',
    m.duration ? `<span>${m.duration} min</span>` : '',
  ].filter(Boolean).join('');

  const star = isStarred(m);
  const moved = tmt.fresh.get(m.id);
  /* ⚠️ Dimmed only once something is starred — a deliberate departure from the
     predecessor, which dimmed the day unconditionally. It could afford to:
     following matches was one of two views there, and the other one was for
     reading. Here this is the only view of a day, so dimming it by default
     charges every reader for a feature most of them have not used yet, and a
     uniformly grey page reads as a rendering fault rather than as a state. The
     effect that matters — a handful of lit cards against a receding day —
     appears the moment there is a handful to light. */
  const dimming = tmt.starred.size > 0;
  const cls = ['match', 'is-' + m.status,
    star ? 'is-starred' : dimming ? 'is-dim' : '',
    moved && Date.now() - moved < FRESH_MS ? 'is-fresh' : ''].filter(Boolean).join(' ');

  return `<article class="${cls}" data-draw="${esc(m.draw)}"`
    + ` data-id="${esc(m.id)}" data-seq="${m.seq == null ? '' : m.seq}"`
    + ` data-court="${esc(m.court)}" data-at="${esc(m.utc)}"`
    + ` data-anchored="${m.anchored}" data-starred="${star}"`
    + ` title="${star ? 'Starred — click to remove' : 'Click to star this match'}">`
    + `<div class="match-head"><span class="star" aria-hidden="true">`
    + `${star ? '&#9733;' : '&#9734;'}</span>${head}</div>`
    + `<div class="match-body">${m.sides.map(sd => sideHtml(sd, m.note)).join('')}</div>`
    + `<div class="match-foot">${foot}</div></article>`;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function renderTmtDays() {
  const days = tournamentDays(tmt.pick && tmt.pick.tmt);
  const today = todayStr();
  const all = `<button type="button" class="day${tmt.day === 'all' ? ' is-active' : ''}"`
    + ` data-day="all" aria-pressed="${tmt.day === 'all'}"`
    + ' title="Every day of the tournament at once">'
    + '<b>All</b>days</button>';
  $('tmtDays').innerHTML = all + days.map(d => {
    const on = d === tmt.day;
    const isToday = d === today;
    const dow = WEEKDAY[new Date(d + 'T00:00:00Z').getUTCDay()];
    return `<button type="button" class="day${on ? ' is-active' : ''}`
      + `${isToday ? ' is-today' : ''}" data-day="${d}" aria-pressed="${on}"`
      + ` title="${esc(d + (isToday ? ' — today' : ''))}">`
      + `<b>${Number(d.slice(8, 10))}</b>${esc(dow)}</button>`;
  }).join('');
}

function renderStarBar() {
  const n = tmt.starred.size;
  const shown = tmt.matches.filter(m => isStarred(m)).length;
  $('starCount').textContent = n === 0 ? 'Nothing starred yet'
    : `${n} starred${shown !== n ? ` · ${shown} here` : ''}`;
  $('clearStars').disabled = n === 0;
  const only = $('starredOnly');
  if (only.checked !== tmt.starredOnly) only.checked = tmt.starredOnly;
}

function renderTmtDraws() {
  const present = drawsPresent(tmt.matches);
  $('tmtDraws').innerHTML = present.map(d => {
    const on = !tmt.hiddenDraws.has(d);
    const n = tmt.matches.filter(m => m.draw === d).length;
    return `<button type="button" class="chip${on ? ' on' : ''}" data-draw="${esc(d)}"`
      + ` aria-pressed="${on}">${esc(d)}<span class="n">${n}</span></button>`;
  }).join('');
}

/**
 * The order of play.
 *
 * A real grid where there is one to draw — one column per court, one row per
 * point in the day, so two cards on the same row really are on court together
 * — and a plain stack when there is not: one court, or a day whose order of
 * play BWF has not published.
 *
 * ⚠️ A row is a *moment*, not "nth on this court". A court that opens its own
 * session gets its own row, and the columns beside it are simply empty there.
 * See `courtGrid`.
 */
function oopHtml(shown) {
  const grid = courtGrid(shown);
  if (!grid) {
    return `<div class="oop-list">${orderOfPlay(shown)
      .map(c => c.matches.map(matchHtml).join('')).join('')}</div>`;
  }
  const heads = grid.courts.map((c, i) =>
    `<div class="oop-head" style="grid-column:${i + 1};grid-row:1">${esc(c)}</div>`).join('');
  const cells = grid.cells.map(cell =>
    `<div class="oop-cell" style="grid-column:${cell.col};grid-row:${cell.row}">`
    + matchHtml(cell.match) + '</div>').join('');
  return `<div class="oop-grid" style="--cols:${grid.courts.length}">${heads}${cells}</div>`;
}

/** One day's heading when several are on screen at once. */
function dayGroupHtml(day, list) {
  const starred = list.filter(m => isStarred(m)).length;
  const n = `${list.length} match${list.length === 1 ? '' : 'es'}`;
  return '<section class="daygroup"><header class="daygroup-head">'
    + `<h3>${esc(prettyDay(day))}</h3>`
    + `<span>${n}${starred ? ` &middot; <b>${starred}</b> starred` : ''}</span>`
    + `</header>${oopHtml(list)}</section>`;
}

/**
 * The other tournaments running right now.
 *
 * BWF streams more than one at a time and the page shows the biggest, so
 * without this the smaller one is not merely second — it is unreachable. Drawn
 * only when there is one, so an ordinary week gains no furniture.
 */
function renderTmtAlso() {
  const pick = tmt.pick;
  const also = (pick && pick.also) || [];
  const box = $('tmtAlso');
  if (!also.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = '<span class="lbl">Also on</span>' + also.map(t =>
    `<button type="button" class="seg" data-code="${esc(String(t.code))}">`
    + `${esc(tidyTmtName(t.name).label || t.name)}</button>`).join('');
}

$('tmtAlso').addEventListener('click', e => {
  const b = e.target.closest('[data-code]');
  if (!b) return;
  tmt.wantCode = b.dataset.code;
  // The day belonged to the tournament being left, so it is dropped rather
  // than carried across to one whose dates it may not even be inside.
  tmt.wantDay = null;
  tmt.day = null;
  tmt.pickedFor = null;
  writeHash();
  loadTournament();
});

function renderTmt() {
  if (page !== 'tmt') return;
  const pick = tmt.pick;
  const t = pick && pick.tmt;

  $('tmtTitle').textContent = t ? t.name : 'Tournament';
  $('tmtWhen').textContent = t ? `${dayOf(t.start_date)} → ${dayOf(t.end_date)}` : '';
  const badge = $('tmtState');
  badge.textContent = pick ? STATE_WORD[pick.state] : '';
  badge.className = 'badge' + (pick ? ' ' + pick.state : '');
  const link = $('tmtLink');
  if (t && t.tmtLink) { link.href = t.tmtLink; link.hidden = false; } else { link.hidden = true; }
  renderTmtAlso();

  const isDraw = tmt.view === 'draw';
  $('tmtView').querySelectorAll('[data-view]').forEach(b => {
    const on = b.dataset.view === tmt.view;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  /* The day bar and the draw filter belong to the order of play. A bracket is
     one discipline across the whole week, so neither question applies to it —
     it brings its own two bars instead. */
  $('tmtDayBar').hidden = isDraw;
  $('tmtDrawsBar').hidden = isDraw;
  $('tmtBody').hidden = isDraw;
  $('tmtNote').hidden = isDraw;
  $('tmtDrawBar').hidden = !isDraw;
  $('tmtDrawBody').hidden = !isDraw;
  $('tmtDrawNote').hidden = !isDraw;

  if (isDraw) { renderDrawBars(); renderBracket(); paintLive(); return; }

  renderTmtDays();
  renderTmtDraws();
  renderStarBar();
  paintLive();

  let shown = tmt.matches.filter(m => !tmt.hiddenDraws.has(m.draw));
  if (tmt.starredOnly) shown = shown.filter(isStarred);
  const body = $('tmtBody');

  if (tmt.error) { body.innerHTML = `<p class="gnote error">${esc(tmt.error)}</p>`; return; }
  if (!t && tmt.loading) { body.innerHTML = '<p class="gnote">Asking BWF what is on…</p>'; return; }
  if (!t) { body.innerHTML = '<p class="gnote">BWF is not naming a tournament just now.</p>'; return; }
  if (tmt.loading && !shown.length) {
    body.innerHTML = '<p class="gnote">Loading the order of play…</p>'; return;
  }

  if (!shown.length) {
    body.innerHTML = tmt.starredOnly && tmt.matches.length
      ? '<p class="gnote">Nothing starred here. Turn off <em>Starred only</em>'
        + ' and click the matches you want to watch.</p>'
      : tmt.matches.length
        ? '<p class="gnote">Every draw is switched off.</p>'
        : `<p class="gnote">Nothing scheduled on ${esc(tmt.day === 'all' ? 'any day yet'
          : tmt.day || 'this day')}`
          + (pick.state === 'upcoming' ? ' — the draws are not out yet.' : '.') + '</p>';
    return;
  }

  if (tmt.day === 'all') {
    const days = [...new Set(shown.map(m => m.day))].sort();
    body.innerHTML = days.map(d =>
      dayGroupHtml(d, shown.filter(m => m.day === d))).join('');
  } else {
    body.innerHTML = oopHtml(shown);
  }
}

$('tmtRefresh').addEventListener('click', () => loadTournament({ fresh: true }));

$('tmtDays').addEventListener('click', e => {
  const b = e.target.closest('[data-day]');
  if (b) pickDay(b.dataset.day);
});

/* The card itself is the target — starring is the point of the page, and a
   small star to aim at would make the common action the fiddly one. */
$('tmtBody').addEventListener('click', e => {
  const card = e.target.closest('.match');
  if (card && card.dataset.id) toggleStar(card.dataset.id);
});

$('starredOnly').addEventListener('change', e => {
  tmt.starredOnly = !!e.target.checked;
  renderTmt();
  writeHash();
});

$('clearStars').addEventListener('click', clearStars);

$('tmtDraws').addEventListener('click', e => {
  const b = e.target.closest('[data-draw]');
  if (!b) return;
  const d = b.dataset.draw;
  if (tmt.hiddenDraws.has(d)) tmt.hiddenDraws.delete(d); else tmt.hiddenDraws.add(d);
  renderTmt();
  writeHash();
});

/* ============================ hash routing ============================

   #p=57945&k=doubles&sz=0&hy=2019.2018&hl=21&pg=compare&v=h&th=w&c=87442 — enough to link to a
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
  /* Set unconditionally, not `if (h.has(...))`. Both have a real default, so a
     link that does not carry them is *claiming* the default — and a reader that
     only ever turns things on leaves the last view in place when you navigate
     back to one that never mentioned it. The season and level filters above are
     deliberately sticky, because they have no default to return to; these do. */
  grid.view = h.get('v') === 'h' ? 'honours' : 'grid';
  grid.threshold = h.has('th') ? honourStep(h.get('th')).key : HONOUR_DEFAULT;
  // Set unconditionally for the same reason as the two above: 'World Tour' is a
  // real default, so a link without `er` is claiming it rather than saying
  // nothing about it.
  grid.era = eraKey(h.get('er'));
  // `now=` pins what the tournament page believes today is. A debugging aid and
  // the only way a suite replaying an August fixture can be deterministic.
  pinnedToday = /^\d{4}-\d{2}-\d{2}$/.test(h.get('now') || '') ? h.get('now') : null;
  if (h.has('d')) tmt.wantDay = h.get('d');
  /* Which of the concurrent tournaments this link is about. Only honoured if it
     names one that is actually on, so an old link falls back to the default. */
  tmt.wantCode = h.get('t') || null;
  if (h.has('dw')) tmt.hiddenDraws = new Set(h.get('dw').split('.').filter(Boolean));
  /* Set unconditionally, like the grid's view: a link without `tv` is claiming
     the order of play rather than saying nothing about it. */
  tmt.view = h.get('tv') === 'draw' ? 'draw' : 'oop';
  tmt.wantDraw = h.get('dr') || null;
  tmt.round = h.get('rd') || null;
  tmt.starredOnly = h.get('so') === '1';
  /* Set unconditionally, like the grid's view and bar: a link without it is
     claiming the default rather than saying nothing. */
  win.kind = WIN_KINDS.includes(h.get('wk')) ? h.get('wk') : 'MS';
  /* The band and its bar are what the page *argues* — a link to LEE Chong Wei's
     decade is not that link with the band switched off — so both travel, and
     both are set unconditionally rather than only when present. */
  win.eras = h.get('we') !== 'off';
  win.reign = h.has('we') && h.get('we') !== 'off'
    ? reignStep(h.get('we')).key : REIGN_DEFAULT;
  win.view = WIN_VIEWS.includes(h.get('wv')) ? h.get('wv') : 'board';
  /* ⚠️ The bar travels only when it was *chosen*. Absent, the link says "the
     default" and the default is derived from the data — which is what a reader
     opening somebody else's link should get, rather than a number frozen at
     whatever the sender's copy of the harvest made of it. */
  win.autoFloor = !h.has('wf');
  win.floor = win.autoFloor
    ? 0 : Math.max(0, Math.min(SCORE_FLOOR_MAX, Number(h.get('wf')) || 0));
  win.only = new Set((h.get('wp') || '').split(',').filter(Boolean));
  win.rank = rankMode(h.get('wr') || RANK_DEFAULT).key;
  win.covid = h.get('wc') === '1';
  // `g=1` is what the compare page was called when it was a modal, and links
  // carrying it are still out there.
  wantPage = h.get('pg') || (h.get('g') === '1' ? 'compare' : 'seasons');
  // The comparison is a whole second career — dozens of requests — so it is
  // handed back rather than started here, and only once, by whoever asked.
  grid.pending = { compare: h.get('c') || null };
  return h.get('p');
}

/** Act on the parts of the hash that cost requests or open something. */
let wantPage = 'seasons';

function applyGridHash() {
  // The hash can have just changed which view is up, and the slider means a
  // different thing in each — it is read at boot, which is before the hash has
  // been looked at, so it has to be pointed again here.
  syncZoomControl();
  const want = grid.pending;
  grid.pending = null;
  if (!want) return;
  if (want.compare && want.compare !== cmp.playerId) loadCompare({ id: want.compare, name: '' });
  else if (!want.compare && cmp.playerId) removeCompare();
  if (PAGES.includes(wantPage) && wantPage !== page) showPage(wantPage);
  // Already on the tournament page: the hash may still have moved the day, or
  // the date the whole page is reasoned from.
  else if (page === 'tmt') loadTournament();
  else if (page === 'winners') loadWinnersPage();
}

function writeHash() {
  // The tournament page is about a *tournament*, so it is worth a link with no
  // player in it at all — which is also the only state the app can be in before
  // anybody has searched for one.
  if (!state.playerId && page === 'seasons') return;
  const p = new URLSearchParams();
  if (state.playerId) p.set('p', state.playerId);
  if (state.kind) p.set('k', state.kind);
  if (!state.sized) p.set('sz', '0');
  if (state.hiddenYears.size) p.set('hy', [...state.hiddenYears].join('.'));
  if (state.hiddenLevels && state.hiddenLevels.size) p.set('hl', [...state.hiddenLevels].join('.'));
  if (page !== 'seasons') p.set('pg', page);
  if (grid.kind) p.set('gk', grid.kind);
  if (grid.hiddenGroups.size) p.set('hg', [...grid.hiddenGroups].join('.'));
  if (grid.view === 'honours') p.set('v', 'h');
  // The bar is part of what the board *says*, so it travels; the zoom is a
  // viewing preference and stays in localStorage. A shared link should open on
  // the reader's own zoom and on the sender's argument.
  if (grid.threshold !== HONOUR_DEFAULT) p.set('th', grid.threshold);
  // Which names the ladder carries is part of the argument a shared board makes
  // — a Lin Dan / Lee Chong Wei link that opens in World Tour names is not the
  // board that was sent — so it travels, like the bar and the view.
  if (grid.era !== ERA_DEFAULT) p.set('er', grid.era);
  if (cmp.playerId) p.set('c', cmp.playerId);
  if (pinnedToday) p.set('now', pinnedToday);
  if (page === 'tmt' && tmt.day) p.set('d', tmt.day);
  // Only when it is doing something: a pin that names the tournament the page
  // would have chosen anyway is noise in the link.
  if (page === 'tmt' && tmt.pick && tmt.pick.also && tmt.pick.also.length
      && tmt.wantCode) p.set('t', tmt.wantCode);
  if (page === 'tmt' && tmt.hiddenDraws.size) p.set('dw', [...tmt.hiddenDraws].join('.'));
  /* Which reading of the tournament, which discipline, and how far in — all
     three are what the page is *arguing*, so a link to a semi-final draw opens
     on that semi-final draw. The round only travels when it was chosen: the
     default follows the tournament, and a link that pinned it would still be
     showing the quarter-finals a week later. */
  if (page === 'tmt' && tmt.view === 'draw') {
    p.set('tv', 'draw');
    if (tmt.drawCode) p.set('dr', tmt.drawCode);
    if (tmt.round) p.set('rd', tmt.round);
  }
  // Which matches are starred is a decision about *this reader*, not about the
  // tournament, so it stays in localStorage. Whether the page is filtered to
  // them is a view of it, and travels.
  if (page === 'tmt' && tmt.starredOnly) p.set('so', '1');
  // Which discipline is what the page is *about*, so it travels. The tile size
  // is a viewing preference and stays in localStorage.
  if (page === 'winners' && win.kind !== 'MS') p.set('wk', win.kind);
  if (page === 'winners' && win.view !== 'board') p.set('wv', win.view);
  if (page === 'winners') {
    /* ⚠️ The pick travels on **both** views. It used to be the score's alone,
       when the score was the only view that had one; the board picks with the
       same gesture on the same set now, and a board with one pair followed
       across it is exactly what a link to it is about. */
    if (win.only.size) p.set('wp', [...win.only].join(','));
    // The bar is the other half of what a score link says.
    if (win.view === 'score') {
      if (!win.autoFloor) p.set('wf', String(win.floor));
      /* Which ordering the ranking is in is an argument about it — total and
         peak genuinely disagree — so it travels like the bar does. How many
         rows are on screen does not: that is a reader looking further down a
         list, not a different claim. */
      if (win.rank !== RANK_DEFAULT) p.set('wr', win.rank);
      /* Only when it is on, because off is the default and a link should carry
         the argument rather than the absence of one. */
      if (win.covid) p.set('wc', '1');
    } else if (!win.eras) p.set('we', 'off');
    else if (win.reign !== REIGN_DEFAULT) p.set('we', win.reign);
  }
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
  roster: {
    state: roster,
    load: ensureRoster,
    known: knownPlayers,
    local: q => rosterMatches(knownPlayers(), q),
    remember: rememberPlayer,
    recent: recentPlayers,
  },
  // How much work is outstanding. `ready` is derived from it; exposing the
  // number itself is what lets a probe say *why* something felt slow.
  queueDepth,
  positionInfo, fillFraction,
  top: () => topCache.get(topCat) || null,
  showTop,
  loadTop: catId => loadTopRanked(catId, { count: 1 }),

  /* The grid, read back the same way: its own state, and what the browser
     actually laid out rather than what the model said it should. */
  grid: {
    state: grid,
    compare: cmp,
    /* The era switch, driven the way a reader drives it, so a test can assert
       on both readings of one career without reloading the page. */
    era: k => (k == null ? grid.era : (setGridEra(k), grid.era)),
    open: openGrid,
    close: closeGrid,
    isOpen: () => grid.open && !$('comparePage').hidden && $('seasonsPage').hidden,
    /** The sections and their widths, as the render would compute them. */
    rows: () => careers().map(careerGridRows),
    sections: () => gridSections(
      window.BST.grid.rows().map(rows => rows.map(r => r.by)), grid.era),
    years: () => gridYears(window.BST.grid.rows()),
    seasonOf: name => tournamentSeason(
      careers().flatMap(c => c.seasons).flatMap(s => s.tournaments)
        .find(t => t.name === name) || null),
    kindFor: i => gridKindFor((careers()[i] || { seasons: [] }).seasons),
    compareWith: id => loadCompare({ id: String(id), name: '' }),
    drop: removeCompare,

    /* ---- the export ----
       The layout as numbers so the suite can check where things land without
       decoding a picture, and a real encoded image because a tainted canvas
       only shows up at `toBlob`, after everything has drawn perfectly. */
    export: on => (on == null ? grid.exporting
      : (grid.exporting = !!on, renderCompareExport(), grid.exporting)),
    exportName: compareExportName,
    /* ⚠️ Handed back so the suite can hold the stylesheet's `--res-*` against
       the table the canvas paints from — the one place the two can drift. */
    results: () => RESULT_COLOURS,
    poster: () => {
      const list = posterCareers();
      if (!list.length) return null;
      const opts = comparePosterOpts();
      const L = grid.view === 'honours'
        ? honoursPosterLayout(list, opts) : gridPosterLayout(list, opts);
      return {
        view: grid.view, width: L.width, height: L.height,
        title: L.title, legend: L.legend,
        sections: L.sections.map(s => String(s.group)),
        all: L.all.map(s => String(s.group)),
        years: L.years ? L.years.slice() : null,
        two: !!L.two,
      };
    },
    png: async () => {
      const blob = await makeComparePoster();
      if (!blob) return null;
      const url = await new Promise(res => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.readAsDataURL(blob);
      });
      return { bytes: blob.size, type: blob.type, url };
    },
    zoom: px => (px == null ? Number($('gridZoom').value) : (setZoom(px), Number($('gridZoom').value))),
    /** Every card on screen, as cells with their laid-out geometry. */
    /* `:not(.empty)` — the seat waiting for a second player is not a career and
       has no profile to read. */
    cards: () => [...document.querySelectorAll('.gcard:not(.empty)')].map(card => ({
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
          mapped: c.classList.contains('mapped'),
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

  /* The tournament page. Its whole job is deciding *which* tournament and
     *which day*, so that is what it exposes; the rest is read off the DOM. */
  tmt: {
    state: tmt,
    pick: () => (tmt.pick ? { state: tmt.pick.state, name: tmt.pick.tmt.name,
      code: tmt.pick.tmt.code, from: dayOf(tmt.pick.tmt.start_date),
      to: dayOf(tmt.pick.tmt.end_date) } : null),
    days: () => tournamentDays(tmt.pick && tmt.pick.tmt),
    day: d => (d == null ? tmt.day : (pickDay(d), tmt.day)),
    today: () => todayStr(),
    matches: () => tmt.matches,
    ready: () => !tmt.loading && queueDepth() === 0,
    reload: () => loadTournament({ fresh: true }),
    stars: () => [...tmt.starred],
    star: id => (toggleStar(id), [...tmt.starred]),
    clearStars,
    only: v => (v == null ? tmt.starredOnly
      : (tmt.starredOnly = !!v, renderTmt(), writeHash(), tmt.starredOnly)),
    moved: () => tmt.moved,

    /** The bracket, read back off the DOM rather than off the model. */
    bracket: {
      view: v => (v == null ? tmt.view : (setTmtView(v), tmt.view)),
      draws: () => tmt.drawList.map(d => ({ code: d.code, id: d.id, size: d.size })),
      pick: c => (c == null ? tmt.drawCode : (pickDrawCode(c), tmt.drawCode)),
      round: r => (r === undefined ? tmt.round : (pickRound(r), tmt.round)),
      shown: () => {
        const on = document.querySelector('#tmtRounds .chip.on');
        return on ? on.dataset.round : null;
      },
      ready: () => !tmt.drawLoading && !tmt.loading && queueDepth() === 0,
      reload: () => loadBracket({ fresh: true }),
      /** Every card on the canvas, with where it actually landed. */
      cards: () => [...document.querySelectorAll('#tmtCanvas .bcard')].map(c => ({
        id: c.dataset.id,
        bye: c.dataset.bye === 'true',
        starred: c.classList.contains('is-starred'),
        x: Math.round(parseFloat(c.style.left)),
        y: Math.round(parseFloat(c.style.top)),
        w: Math.round(parseFloat(c.style.width)),
        h: Math.round(parseFloat(c.style.height)),
        names: [...c.querySelectorAll('.bn')].map(n => n.textContent.trim()),
      })),
      lines: () => document.querySelectorAll('#tmtCanvas .bline').length,
      labels: () => [...document.querySelectorAll('#tmtCanvas .bcol')]
        .map(l => l.textContent.trim()),
      canvas: () => {
        const c = $('tmtCanvas');
        return { w: Math.round(parseFloat(c.style.width) || 0),
          h: Math.round(parseFloat(c.style.height) || 0) };
      },
      /** Does the viewport have to scroll to show it? */
      fits: () => {
        const vp = document.querySelector('#tmtDrawBody .brwrap');
        const c = $('tmtCanvas');
        if (!vp || !c) return null;
        return { w: vp.clientWidth >= (parseFloat(c.style.width) || 0),
          h: vp.clientHeight >= (parseFloat(c.style.height) || 0) };
      },
    },

    /** Day headings, when every day is on screen at once. */
    groups: () => [...document.querySelectorAll('#tmtPage .daygroup')].map(g => ({
      head: (g.querySelector('h3') || {}).textContent || '',
      note: (g.querySelector('.daygroup-head span') || {}).textContent || '',
      matches: g.querySelectorAll('.match').length,
    })),
    /** Is the day drawn as a real grid, and what shape? */
    grid: () => {
      const g = document.querySelector('#tmtPage .oop-grid');
      if (!g) return null;
      return {
        cols: Number(getComputedStyle(g).getPropertyValue('--cols')),
        heads: [...g.querySelectorAll('.oop-head')].map(h => h.textContent),
        /** Every card with the cell it was placed in, read off the layout. */
        cells: [...g.querySelectorAll('.oop-cell')].map(c => ({
          col: Number(c.style.gridColumn),
          row: Number(c.style.gridRow),
          court: (c.querySelector('.match') || {}).dataset.court,
          seq: Number((c.querySelector('.match') || { dataset: {} }).dataset.seq),
          /* The instant BWF gave the match, and whether it published it or
             estimated it — which is what the grid's rows are built on. */
          at: (c.querySelector('.match') || { dataset: {} }).dataset.at,
          anchored: (c.querySelector('.match') || { dataset: {} }).dataset.anchored === 'true',
          x: Math.round(c.getBoundingClientRect().left),
          y: Math.round(c.getBoundingClientRect().top),
        })),
      };
    },
    /** Every match on screen, in DOM order — which is running order. */
    cards: () => [...document.querySelectorAll('#tmtPage .match')].map(m => ({
      draw: m.dataset.draw,
      id: m.dataset.id,
      court: m.dataset.court,
      seq: Number(m.dataset.seq),
      at: m.dataset.at,
      anchored: m.dataset.anchored === 'true',
      status: (m.className.match(/is-(finished|live|upcoming)/) || [])[1],
      starred: m.dataset.starred === 'true',
      dim: m.classList.contains('is-dim'),
      fresh: m.classList.contains('is-fresh'),
      round: (m.querySelector('.rnd') || {}).textContent || '',
      stat: (m.querySelector('.stat') || {}).textContent || '',
      sides: [...m.querySelectorAll('.side')].map(sd => ({
        who: (sd.querySelector('.nm') || {}).textContent || '',
        seed: (sd.querySelector('.seed') || {}).textContent || '',
        sets: [...sd.querySelectorAll('.sets b')].map(b => b.textContent
          + (b.classList.contains('won') ? '*' : '')
          + (b.classList.contains('mk') ? '!' : '')),
        won: sd.classList.contains('is-winner'),
        lost: sd.classList.contains('is-loser'),
      })),
      foot: (m.querySelector('.match-foot') || {}).textContent || '',
    })),
  },

  /* The winners' pyramid and the band under it. The bars are placed at
     measured pixel offsets, so the seam reads back the geometry rather than the
     model — a bar that points at the wrong year is the failure worth catching,
     and it cannot be seen from the numbers that produced it. */
  winners: {
    kind: k => (k == null ? win.kind : (setWinKind(k), win.kind)),
    eras: on => (on == null ? win.eras
      : (win.eras = !!on, renderWinners(), writeHash(), win.eras)),
    bar: k => (k == null ? win.reign : (setReign(k), win.reign)),
    /** Every column, with the year it claims and where it actually is. */
    columns: () => [...document.querySelectorAll('#winBody .pyrseason')].map(c => {
      const r = c.getBoundingClientRect();
      return {
        year: Number(c.dataset.year),
        moved: !!c.querySelector('.pyryear.is-moved'),
        note: (c.querySelector('.pyryear') || {}).title || '',
        rows: [...c.querySelectorAll('.pyrrow')].map(row =>
          [...row.querySelectorAll('.pyrtile')].map(t => ({
            tier: t.dataset.tier, level: t.dataset.level, mark: t.dataset.mark,
            title: t.getAttribute('title') || '',
            badge: (() => {
              const b = t.parentElement.querySelector && t.parentElement.matches('.pyrmajor')
                ? t.parentElement.querySelector('.pyrbadge') : null;
              return b ? (b.classList.contains('rings') ? 'rings' : 'cup') : '';
            })(),
          }))),
        x: Math.round((r.left) * 10) / 10,
        w: Math.round(r.width * 10) / 10,
      };
    }),
    /** The dominance bars, as painted. */
    bars: () => [...document.querySelectorAll('#winEraBand .erabar')].map(b => {
      const r = b.getBoundingClientRect();
      return {
        id: b.dataset.id,
        who: (b.querySelector('.erawho b') || {}).textContent || '',
        faded: b.classList.contains('faded'),
        lane: Number(b.dataset.lane),
        from: Number(b.dataset.from),
        to: Number(b.dataset.to),
        n: Number(b.dataset.n),
        x: Math.round(r.left * 10) / 10,
        w: Math.round(r.width * 10) / 10,
      };
    }),
    /* ---- picking one competitor out of the board ----
       Read off the drawn squares rather than off `win.only`, because the whole
       claim is about what the reader can see: the set is trivially right and
       the fade is the part that has been wrong. */
    tiles: () => [...document.querySelectorAll('#winBody .pyrtile')].map(t => ({
      id: t.dataset.id,
      tier: t.dataset.tier,
      /* The name is on the wrapper for a pair and on the photograph for a
         singles winner, so both are asked. */
      who: (() => {
        const f = t.querySelector('.pairface, .face, .noface');
        return f ? (f.getAttribute('aria-label') || f.getAttribute('alt') || '') : '';
      })(),
      faded: t.classList.contains('faded'),
      /* The two halves in the order they are drawn in, which is the thing
         `settleWinnerOrder` exists to keep still. */
      halves: [...t.querySelectorAll('.half')].map(h =>
        h.getAttribute('alt') || h.textContent || ''),
    })),
    /** A click on a square, which is the only way a reader has of picking. */
    tap: id => {
      const t = document.querySelector(`#winBody .pyrtile[data-id="${id}"]`);
      if (t) t.click();
      return [...win.only];
    },
    /** Escape, delivered the way the document hears it. */
    escape: () => {
      document.dispatchEvent(new KeyboardEvent('keydown',
        { key: 'Escape', bubbles: true }));
      return [...win.only];
    },
    /* ---- the export ----
       The layout is handed back as numbers so the suite can check where things
       land without decoding a picture, and `png` returns a real encoded image
       so it can check that the canvas came back *readable* — which is the one
       failure that happens at the very last step, after everything has drawn
       perfectly. */
    export: on => (on == null ? win.exporting
      : (win.exporting = !!on, renderExportBar(), win.exporting)),
    range: (from, to) => {
      if (from != null) $('expFrom').value = String(from);
      if (to != null) $('expTo').value = String(to);
      return exportRange();
    },
    poster: (from, to) => {
      const L = posterLayout(winFile(), {
        from, to, kind: win.kind, min: win.reign, eras: win.eras,
        only: [...win.only],
      });
      /* `lit` is a function and does not survive the trip out of the page, so
         it is answered here for the squares the suite can see. */
      return { ...L, lit: undefined,
        litTiles: L.columns.flatMap(c => c.rows.flatMap(r => r.tiles))
          .map(t => ({ id: t.id, lit: L.lit(t.id) })) };
    },
    png: async (from, to) => {
      const blob = await drawPoster(winFile(), {
        from, to, kind: win.kind, min: win.reign, eras: win.eras,
        only: [...win.only],
      });
      const url = await new Promise(res => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.readAsDataURL(blob);
      });
      return { bytes: blob.size, type: blob.type, url };
    },
    name: exportName,
    /* ⚠️ The one place the CSS and `poster.js` can drift: the page paints the
       tier rings from a stylesheet and the export paints them from a table.
       Handed back so the suite can hold one against the other. */
    rings: () => TIER_RING,
    poster_unit: () => POSTER.unit,

    runs: () => {
      const file = winFile();
      if (!file) return [];
      return reignLanes(pyramidReigns(winnersSeasons(file), file.players || {},
        reignStep(win.reign).n));
    },
  },

  /* The domination score.

     ⚠️ Read back off the **painted SVG**, not off the model that produced it.
     Every one of the mistakes this view has made was a drawing mistake that the
     numbers underneath were innocent of — a colour handed out over the wrong
     set, an axis refitted to the selection, a legend that emptied itself — so
     what the suite has to see is the picture. */
  score: {
    view: v => (v == null ? win.view : (setWinView(v), win.view)),
    floor: n => (n == null ? win.floor : (stepFloorTo(n), win.floor)),
    auto: () => win.autoFloor,
    pinned: () => [...win.only],
    pin: id => { $(`scoreLegend`).querySelector(`.lg[data-id="${id}"]`).click(); },
    /** The model, for holding the drawing against. */
    model: () => {
      const m = scoreModel();
      return m && {
        years: m.years,
        seasons: m.seasons.map(s => ({
          year: s.year, total: s.total, winners: s.by.size,
          /* What the season's denominator is, which is the whole question for
             the year still being played. See `dominationSeasons`. */
          played: s.played, planned: s.planned,
          ongoing: s.ongoing, forecast: s.forecast,
        })),
        people: m.people.map(p => ({
          id: p.id, who: p.who.n, peak: p.peak,
          pts: p.pts.map(pt => ({ year: pt.year, score: pt.score, n: pt.n })),
        })),
      };
    },
    /** Every face on the chart, as drawn: who, when, where, and how it looks. */
    marks: () => [...document.querySelectorAll('#scoreChart .pt')].map(g => {
      const r = g.getBoundingClientRect();
      const ring = g.querySelector('.ring');
      return {
        id: g.dataset.id,
        year: Number(g.dataset.year),
        colour: ring ? ring.getAttribute('stroke') : '',
        face: !!g.querySelector('image'),
        faded: g.classList.contains('faded'),
        hole: g.classList.contains('on-hole'),
        x: Math.round(r.left * 10) / 10,
        y: Math.round(r.top * 10) / 10,
      };
    }),
    /** Every leg of every line, so a run that should have broken can be seen. */
    legs: () => [...document.querySelectorAll('#scoreChart path.series')].map(p => ({
      id: p.dataset.id,
      colour: p.getAttribute('stroke'),
      dashed: p.classList.contains('over-hole'),
      faded: p.classList.contains('faded'),
      d: p.getAttribute('d'),
    })),
    legend: () => [...document.querySelectorAll('#scoreLegend .lg')].map(l => ({
      id: l.dataset.id,
      who: l.childNodes.length ? l.textContent.trim() : '',
      colour: (l.querySelector('i') || {}).style
        ? l.querySelector('i').style.background : '',
      off: l.classList.contains('off'),
    })),
    /* ---- the dominators ----
       Read off the drawn table, because the claim is what the reader sees: the
       ordering is `dominationRanking`'s and is checked there. */
    rank: k => {
      /* Through the chip, not through `setRankMode`, so the suite exercises the
         control the reader actually has. */
      if (k != null) {
        const chip = document.querySelector(`#rankMode .chip[data-mode="${k}"]`);
        if (chip) chip.click();
      }
      return win.rank;
    },
    rankAll: on => {
      if (on != null && win.rankAll !== !!on) $('rankMore').click();
      return win.rankAll;
    },
    /* Through the chip, so the suite exercises the control the reader has. */
    covid: on => {
      if (on != null && win.covid !== !!on) $('rankCovid').click();
      return win.covid;
    },
    ranks: () => [...document.querySelectorAll('#scoreRank .rankrow')].map(r => {
      const cell = i => r.children[i];
      return {
        id: r.dataset.id,
        rank: Number(cell(0).textContent),
        who: cell(1).textContent.trim(),
        total: Number(cell(2).textContent),
        /* The year is a suffix inside the peak cell, so the two are read apart
           rather than as one number. */
        peak: Number(cell(3).childNodes[0].textContent),
        peakYear: Number((cell(3).querySelector('.yr') || {}).textContent),
        seasons: Number(cell(4).textContent),
        titles: Number(cell(5).textContent),
        faded: r.classList.contains('faded'),
        by: [...r.children].map(c => c.classList.contains('by')),
      };
    }),
    /** Which column the table says it is sorted by, off the header. */
    rankBy: () => [...document.querySelectorAll('#scoreRank th')]
      .filter(t => t.classList.contains('by')).map(t => t.textContent),
    /** A click on a row, which is the only way a reader has of picking here. */
    rankTap: id => {
      const r = document.querySelector(`#scoreRank .rankrow[data-id="${id}"]`);
      if (r) r.click();
      return [...win.only];
    },
    /** The axis labels, which is where the footnote mark has to appear. */
    axis: () => [...document.querySelectorAll('#scoreChart .scoreaxis text')]
      .map(t => t.textContent),
    /** The top of the y-axis, as a score — it must not move under the reader. */
    top: () => scoreTop(),
    /** What each season's strip bar says it held. */
    /* ⚠️ `text`, not only `n`. The season being played reads "8/12" — played over
       planned — and `Number()` of that is `NaN`, which came back as a hole in
       the list and read as a missing bar rather than a different label. */
    strip: () => [...document.querySelectorAll('#scoreChart .scorestrip .szn')]
      .map(t => ({
        text: t.textContent,
        n: Number(String(t.textContent).split('/')[0]),
        thin: t.classList.contains('is-thin'),
      })),
    /** The reasons written inside the plot, in year order. */
    why: () => [...document.querySelectorAll('#scoreChart .scorewhy')]
      .map(t => t.textContent),
    ladder: () => [...document.querySelectorAll('#scoreLadder .wt')]
      .map(w => w.textContent.trim()),
    /* The export, the same two hooks the board has: the layout as numbers, and
       a real encoded image, because a tainted canvas only shows up at `toBlob`
       after everything has drawn perfectly. */
    poster: (from, to) => {
      const L = scorePosterLayout(winFile(), posterOpts({ from, to }));
      return {
        width: L.width, from: L.from, to: L.to, top: L.top,
        years: L.years, title: L.title, legend: L.legend,
        shown: L.shown.map(p => ({ id: p.id, who: p.who.n, colour: p.colour })),
      };
    },
    png: async (from, to) => {
      const blob = await drawScorePoster(winFile(), posterOpts({ from, to }));
      const url = await new Promise(res => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.readAsDataURL(blob);
      });
      return { bytes: blob.size, type: blob.type, url };
    },
    rows: id => [...document.querySelectorAll('#' + id + ' tr')].slice(1).map(tr => ({
      cells: [...tr.querySelectorAll('td')].map(td => td.textContent.trim()),
      thin: tr.classList.contains('thin'),
    })),
  },

  /* The honours board. Same principle: what the browser laid out, not what the
     model said it should — the row sizes are the whole claim of the view, so
     they are read back as painted pixels. */
  honours: {
    view: v => (v == null ? grid.view : (setGridView(v), grid.view)),
    bar: k => (k == null ? grid.threshold
      : (grid.threshold = honourStep(k).key, renderGrid(), writeHash(), grid.threshold)),
    scale: honourScale,
    rung: honourRung,
    /** Each career's honours, straight from the model. */
    of: () => careers().map(c => {
      const kind = gridKindFor(c.seasons);
      const rows = careerRows(c.seasons, kind,
        dominantDraw(c.seasons.flatMap(s => s.tournaments), kind), grid.era);
      return careerHonours(rows, honourStep(grid.threshold).rank);
    }),
    sections: () => honourSections(window.BST.honours.of(), grid.era),
    zoom: px => (px == null ? Number($('gridZoom').value)
      : (setZoom(px), Number($('gridZoom').value))),
    /** Every row on screen, with both players' halves and the real geometry. */
    rows: () => [...document.querySelectorAll('#honBody .hrow')].map(row => {
      const side = el => [...el.querySelectorAll('.cell')].map(c => {
        const r = c.getBoundingClientRect();
        return {
          tier: (c.className.match(/r-([\w]+)/) || [])[1],
          mapped: c.classList.contains('mapped'),
          from: c.dataset.from || '',
          year: Number(c.dataset.year),
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10,
          x: Math.round(r.left * 10) / 10,
          bg: getComputedStyle(c).backgroundColor,
          title: c.getAttribute('title') || '',
        };
      });
      const sides = [...row.querySelectorAll('.hside')];
      return {
        group: row.dataset.group,
        label: (row.querySelector('.hlvl') || {}).textContent || '',
        counts: [...row.querySelectorAll('.hn')].map(n => Number(n.textContent)),
        empty: [...row.querySelectorAll('.hnone')].map(n => n.getAttribute('title') || ''),
        sides: sides.map(side),
        mirrored: sides.map(el => el.classList.contains('mirror')),
      };
    }),
    /* Where the spine actually is. Measured off `.hboard` and not off the
       scroller around it: when the board is wider than the modal the two have
       different middles, and the line is drawn on the board. */
    /** Is the second seat on screen, and empty? */
    seat: () => {
      const el = document.querySelector('#comparePage .addslot');
      return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : null;
    },
    spine: () => {
      const board = document.querySelector('#honBody .hboard');
      if (!board) return null;
      const r = board.getBoundingClientRect();
      return Math.round((r.left + r.width / 2) * 10) / 10;
    },
    order: () => gridOrder(grid.era),
    heads: () => [...document.querySelectorAll('#honBody .hhead:not(.empty)')].map(h => ({
      player: h.dataset.player,
      name: (h.querySelector('.who') || {}).textContent || '',
      mirrored: h.classList.contains('mirror'),
    })),
  },
};

/**
 * Nobody named in the link, so open on the **world number one in men's
 * singles**.
 *
 * An empty strip is a worse first impression than somebody's, and it is one
 * request to find out who: the ranking table is already the top-ranked
 * shortcut's first call and comes out of the 12-hour cache, so on any second
 * visit this costs nothing.
 *
 * Deliberately not a hardcoded id. The point is that it is whoever is number
 * one *now*, and a constant would quietly become a different claim the week
 * they lost the ranking.
 */
async function openOnNumberOne() {
  const ms = RANKING_CATEGORIES.find(c => c.code === 'MS');
  try {
    const top = await loadTopRanked(ms.id, { count: 1 });
    const who = top && top[0] && top[0].players && top[0].players[0];
    // Only if nobody has chosen in the meantime — the lookup takes a moment and
    // a reader who searched during it should not have it snatched back.
    if (who && !state.playerId) {
      loadCareer(who.id);
      // `loadCareer` does not touch the hash — only the search picker does —
      // and a default that leaves the link empty is a page you cannot share or
      // come back to. The id is set synchronously, so this catches it.
      writeHash();
    }
  } catch { /* the search box is still right there */ }
}

const initial = readHash();
if (initial) loadCareer(initial);
else { $('q').focus(); openOnNumberOne(); }
applyGridHash();
