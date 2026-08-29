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
  RANKING_CATEGORIES, queueDepth, loadSchedule, loadDayMatches, loadWinners,
} from './api.js';
import {
  positionInfo, fillFraction, drawForKind, dominantDraw, seasonKinds,
  defaultKind, seasonLevels, levelLabel, levelAbbr, boxSize, isTeamEvent,
  drawLadder, BOX_H, LEVEL, LEVEL_ORDER,
  careerRows, gridSections, sectionCells, gridYears, gridGroupLabel, seasonLabels, GRID_ORDER,
  seasonResults, tournamentSeason,
  HONOUR_STEPS, HONOUR_DEFAULT, honourStep, honourScale, honourRung,
  careerHonours, honourSections,
  pickTournament, tournamentDays, defaultDay, parseDayMatches, orderOfPlay,
  courtGrid, drawsPresent, dayOf, matchSignature, prettyDay,
  pyramidSeason, pyramidBulges, pyramidRowWidth,
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
  view: 'grid',                  // 'grid' | 'honours' — two readings of one career
  kind: null,                    // null = follow the main view's discipline
  hiddenGroups: new Set(),       // column groups switched off
  threshold: HONOUR_DEFAULT,     // the honours board's bar
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
  return `<i class="${cls}${cell.from ? ' mapped' : ''}"${attrs}`
    + ` title="${esc(`${cell.tmt.name}\n${cell.info.full}${wl}`
      + (cell.from ? `\n${cell.from}, drawn as ${gridGroupLabel(cell.group)}` : ''))}"></i>`;
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
      + (cell.from ? `\n${cell.from}, drawn as ${gridGroupLabel(cell.group)}` : ''))}"></i>`;
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
  const label = `<span class="hlvl" title="${esc(section.label)}">${esc(section.label)}</span>`;
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
  const sections = honourSections(list.map(c => c.honours));
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
  const sections = gridSections(list.map(c => c.rows.map(r => r.by)));
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
  for (const c of list) {
    const kind = gridKindFor(c.seasons);
    const preferred = dominantDraw(c.seasons.flatMap(s => s.tournaments), kind);
    c.rows = careerRows(c.seasons, kind, preferred);
  }

  renderGridKinds();
  renderViewSwitch();

  const honours = grid.view === 'honours';
  $('gridBody').hidden = honours;
  $('honBody').hidden = !honours;
  $('gridLegend').hidden = honours;
  $('gridNote').hidden = honours;
  $('honLegend').hidden = !honours;
  $('honNote').hidden = !honours;
  $('honMin').hidden = !honours;
  $('gridTitle').textContent = honours ? 'Honours' : 'Career grid';

  if (honours) renderHonoursBody(list); else renderGridBody(list);
}

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

/* The disciplines this page has data for. Doubles is deliberately absent: a
   doubles title is won by a *pair*, so one square would have to hold two faces
   and would stop meaning what every other square on the page means. */
const WIN_KINDS = ['MS', 'WS'];

/* ⚠️ Keyed by discipline, not a single `raw`. Switching used to be impossible,
   and the first version that allowed it would have thrown away the file it
   already had every time you switched back. */
const win = {
  files: {}, errors: {}, loading: {},
  kind: 'MS', zoom: savedWinZoom(),
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

/** A face, or the initials of somebody BWF has no photograph of. */
function winnerFace(who, side) {
  const name = esc((who && who.n) || 'Unknown');
  const initials = String((who && who.n) || '?')
    .replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/)
    .map(w => w[0]).slice(0, 2).join('').toUpperCase();
  if (who && who.a) {
    return `<img class="face" src="${esc(who.a)}" alt="${name}" loading="lazy"
      width="${Math.round(side)}" height="${Math.round(side)}">`;
  }
  return `<span class="face noface" aria-label="${name}">${esc(initials)}</span>`;
}

function renderWinners() {
  const body = $('winBody');
  renderWinnersControls();

  const file = winFile();
  if (win.errors[win.kind]) {
    body.innerHTML = `<p class="empty">${esc(win.errors[win.kind])}</p>`;
    $('winSpan').textContent = '';
    return;
  }
  if (!file) {
    body.innerHTML = '<p class="empty">Reading the harvested winners…</p>';
    return;
  }

  const players = file.players || {};
  const years = Object.keys(file.seasons || {}).map(Number)
    .filter(y => Number.isFinite(y)).sort((a, b) => a - b);
  if (!years.length) {
    body.innerHTML = '<p class="empty">Nothing harvested yet.</p>';
    return;
  }

  const unit = win.zoom;
  $('winSpan').textContent = `${years[0]}–${years[years.length - 1]} · `
    + `${years.reduce((n, y) => n + file.seasons[y].length, 0)} titles`;

  const columns = years.map(year => {
    const rows = pyramidSeason(file.seasons[year], players);
    const bulges = pyramidBulges(rows);
    const widest = Math.max(...rows.map(pyramidRowWidth), 1);

    const html = rows.map(row => {
      if (!row.tiles.length) {
        /* ⚠️ An empty row is drawn as a gap, not closed up. A season with no
           Tour Finals — every season before 2008 — should show the hole where
           it goes rather than quietly becoming a different shape. */
        const h = Math.round(honourScale(row.tiers[row.tiers.length - 1]) * unit);
        return `<div class="pyrrow is-empty" style="height:${h}px"
          title="no ${esc(row.label)} this season"></div>`;
      }
      return `<div class="pyrrow">` + row.tiles.map(t => {
        const side = Math.round(t.scale * unit);
        const when = String(t.date).slice(0, 10);
        return `<span class="pyrtile t-${esc(String(t.tier))}"
          style="width:${side}px;height:${side}px"
          title="${esc(t.name)}\n${esc((t.who && t.who.n) || 'unknown')}${
            t.who && t.who.c ? ' · ' + esc(t.who.c) : ''}\n${when}">${
          winnerFace(t.who, side)}</span>`;
      }).join('') + `</div>`;
    }).join('');

    return `<div class="pyrseason${bulges.length ? ' is-bulging' : ''}"
      style="min-width:${Math.round(widest * unit) + 12}px">
      <div class="pyrstack">${html}</div>
      <div class="pyryear">${year}</div>
    </div>`;
  }).join('');

  body.innerHTML = `<div class="pyrscroll">${columns}</div>`;
}

function renderWinnersControls() {
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
  const z = $('winZoom');
  if (z && Number(z.value) !== win.zoom) z.value = String(win.zoom);
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
  pickedFor: null,        // the date the current pick was made against
  byDay: new Map(),       // day -> that day's matches, so "All" is one merge
  starred: new Set(),     // match ids the reader picked out
  starredOnly: false,
  fresh: new Map(),       // match id -> when it last moved under us
  checked: null,          // when the scores were last asked for
  moved: 0,               // how many moved on that check
};
let tmtToken = 0;
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
      tmt.pick = pickTournament(tmt.schedule, todayStr());
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
    + `<span class="seed">${esc(sd.seed || '')}</span>`
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

  /* Only the first match on a court has a real time. Everything after it is
     "Followed by" against a flat 50-minute estimate that on some courts runs
     backwards, so it is marked approximate rather than presented as fact. */
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
    + ` data-court="${esc(m.court)}" data-starred="${star}"`
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
 * position on it, so two cards on the same row are at the same point in the day
 * — and a plain stack when there is not: one court, or a day whose order of
 * play BWF has not published.
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
  // `now=` pins what the tournament page believes today is. A debugging aid and
  // the only way a suite replaying an August fixture can be deterministic.
  pinnedToday = /^\d{4}-\d{2}-\d{2}$/.test(h.get('now') || '') ? h.get('now') : null;
  if (h.has('d')) tmt.wantDay = h.get('d');
  if (h.has('dw')) tmt.hiddenDraws = new Set(h.get('dw').split('.').filter(Boolean));
  tmt.starredOnly = h.get('so') === '1';
  /* Set unconditionally, like the grid's view and bar: a link without it is
     claiming the default rather than saying nothing. */
  win.kind = WIN_KINDS.includes(h.get('wk')) ? h.get('wk') : 'MS';
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
  if (cmp.playerId) p.set('c', cmp.playerId);
  if (pinnedToday) p.set('now', pinnedToday);
  if (page === 'tmt' && tmt.day) p.set('d', tmt.day);
  if (page === 'tmt' && tmt.hiddenDraws.size) p.set('dw', [...tmt.hiddenDraws].join('.'));
  // Which matches are starred is a decision about *this reader*, not about the
  // tournament, so it stays in localStorage. Whether the page is filtered to
  // them is a view of it, and travels.
  if (page === 'tmt' && tmt.starredOnly) p.set('so', '1');
  // Which discipline is what the page is *about*, so it travels. The tile size
  // is a viewing preference and stays in localStorage.
  if (page === 'winners' && win.kind !== 'MS') p.set('wk', win.kind);
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
  loadTop: catId => loadTopRanked(catId, { count: 1 }),

  /* The grid, read back the same way: its own state, and what the browser
     actually laid out rather than what the model said it should. */
  grid: {
    state: grid,
    compare: cmp,
    open: openGrid,
    close: closeGrid,
    isOpen: () => grid.open && !$('comparePage').hidden && $('seasonsPage').hidden,
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
        dominantDraw(c.seasons.flatMap(s => s.tournaments), kind));
      return careerHonours(rows, honourStep(grid.threshold).rank);
    }),
    sections: () => honourSections(window.BST.honours.of()),
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
    order: () => GRID_ORDER,
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
