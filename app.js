/* Step 1: prove the data path.
 *
 * Pick a player and a year, fetch the season, print it. No visual layer yet —
 * the season strip comes next and it is worth building on a data layer that has
 * already been shown to be right.
 *
 * The suites drive this page rather than the model directly, so that what the
 * tests exercise is what actually ships. `window.BST` is the seam they use.
 */

import { loadSeason, loadLastMatch, queueDepth } from './api.js';
import {
  positionInfo, fillFraction, drawFor, seasonDisciplines, defaultDiscipline,
  levelLabel, boxSide, LEVEL,
} from './model.js';

const $ = id => document.getElementById(id);

const state = {
  playerId: null,
  year: null,
  discipline: null,      // null = follow defaultDiscipline()
  includeTeam: false,
  season: null,          // always the whole season, team events included
  disciplines: [],
  lastMatch: null,
  error: null,
};

/**
 * What the strip should actually draw.
 *
 * The team-event toggle filters here rather than at load time: team ties carry
 * no individual position, so they are the largest and emptiest squares in the
 * strip and default off (HANDOVER 2.3) — but dropping them during the parse
 * would mean refetching to turn them back on, and would leave `state.season`
 * meaning something different depending on a checkbox.
 */
function visibleSeason() {
  const s = state.season || [];
  return state.includeTeam ? s : s.filter(t => !t.team);
}

/* ============================ rendering ============================ */

function setStatus(text, isError) {
  const el = $('status');
  el.textContent = text;
  el.className = isError ? 'error' : '';
}

/**
 * One line per tournament, in the order the strip will draw them. The columns
 * are deliberately the ones the square encodes — level, box size, position,
 * fill — so a wrong square can be traced back to a wrong number here.
 */
function seasonAsText(season, discipline) {
  if (!season.length) return '(no tournaments)';

  const rows = season.map(t => {
    const dr = drawFor(t, discipline);
    const info = positionInfo(dr && dr.position);
    const pct = Math.round(fillFraction(info, dr) * 100);
    const wl = dr && dr.win != null ? `${dr.win}-${dr.lose}` : '';
    return [
      t.start,
      t.short.padEnd(24),
      (t.level || '?').padEnd(12),
      boxSide(t.cat).toFixed(1).padStart(5) + 'px',
      dr ? (dr.name || '').padEnd(4) : '--  ',
      (info.label || '').padEnd(4),
      wl.padEnd(6),
      dr ? String(pct).padStart(3) + '%' : '   -',
      t.name,
    ].join('  ');
  });

  const played = season.filter(t => drawFor(t, discipline)).length;
  return rows.join('\n')
    + `\n\n${season.length} tournaments, ${played} with a ${discipline || '?'} draw`;
}

function disciplineSummary() {
  if (!state.disciplines.length) return 'no draws found';
  const parts = state.disciplines.map(d =>
    `${d.name} ${d.count}${d.name === state.discipline ? ' *' : ''}`);
  let s = 'draws: ' + parts.join(', ');

  // A doubles season belongs to the pair, so name the partner as soon as it is
  // known. The season endpoint never carries one; this comes from the player's
  // most recent match, which is why it is only ever "most recent partner" and
  // not a per-tournament answer.
  if (state.lastMatch && state.lastMatch.partner) {
    s += ` — last played ${state.lastMatch.discipline} with ${state.lastMatch.partner.name}`;
  }
  return s;
}

function render() {
  if (state.error) {
    setStatus(state.error, true);
    $('out').textContent = '';
    return;
  }
  if (!state.season) return;

  const shown = visibleSeason();
  setStatus(`player ${state.playerId} · ${state.year} · ${disciplineSummary()}`);
  $('out').textContent = seasonAsText(shown, state.discipline);
  $('raw').textContent = JSON.stringify(shown, null, 1);

  // Team ties are listed in the summary but are not selectable: their draw is
  // called "Singles"/"Doubles" and carries no position, so a strip filtered to
  // one would be a row of empty squares.
  const sel = $('discipline');
  const want = state.discipline;
  sel.innerHTML = '<option value="">auto</option>'
    + state.disciplines.filter(d => d.kind !== 'team').map(d =>
      `<option value="${d.name}"${d.name === want ? ' selected' : ''}>${d.name} (${d.count})</option>`).join('');
}

/* ============================ loading ============================ */

async function load() {
  state.error = null;
  setStatus('loading…');

  try {
    // The whole season, team events and all. visibleSeason() decides what is
    // drawn, so the toggle is instant and never refetches.
    const season = await loadSeason(state.playerId, state.year);
    state.season = season;
    state.disciplines = seasonDisciplines(season);
    if (!state.discipline) state.discipline = defaultDiscipline(season);

    render();

    // Secondary, and allowed to fail: the season is already renderable without
    // it. Low lane so it never delays a click.
    try {
      state.lastMatch = await loadLastMatch(state.playerId, { priority: 'low' });
      render();
    } catch { /* partner is a nicety, not the page */ }
  } catch (e) {
    // BWF's API is undocumented and can change without notice. Say that plainly
    // rather than showing an empty season, which reads as "no tournaments".
    state.error = 'Could not load from BWF: ' + e.message
      + '. The API is unofficial and may have changed.';
    render();
  }
}

/**
 * Form -> state.
 *
 * A discipline belongs to a player and a year, so changing either drops it back
 * to null and lets defaultDiscipline() choose again. Carrying it over meant
 * opening a doubles player's season on MS because the last player was a singles
 * one, and every square then read as "did not enter".
 */
function readForm() {
  const player = $('playerId').value.trim();
  const year = $('year').value.trim();
  if (player !== state.playerId || year !== state.year) state.discipline = null;
  state.playerId = player;
  state.year = year;
  state.includeTeam = $('includeTeam').checked;
}

/* ============================ hash routing ============================

   #p=57945&y=2026&d=MS — enough to link to a season, and enough for a suite to
   open one directly without clicking through the form.
   ================================================================== */

function readHash() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (h.has('p')) $('playerId').value = h.get('p');
  if (h.has('y')) $('year').value = h.get('y');
  if (h.has('team')) $('includeTeam').checked = h.get('team') === '1';
  readForm();
  if (h.has('d')) state.discipline = h.get('d').toUpperCase();
}

function writeHash() {
  const p = new URLSearchParams();
  p.set('p', state.playerId);
  p.set('y', state.year);
  if (state.discipline) p.set('d', state.discipline);
  if (state.includeTeam) p.set('team', '1');
  const next = '#' + p.toString();
  if (location.hash !== next) history.replaceState(null, '', next);
}

$('pick').addEventListener('submit', e => {
  e.preventDefault();
  readForm();
  writeHash();
  load();
});

$('discipline').addEventListener('change', () => {
  state.discipline = $('discipline').value || defaultDiscipline(state.season);
  writeHash();
  render();
});

// No refetch: the season already holds the team events, they were only hidden.
$('includeTeam').addEventListener('change', () => {
  readForm();
  writeHash();
  render();
});

window.addEventListener('hashchange', () => { readHash(); writeHash(); load(); });

/* The suites' seam into the running app: they assert on real state produced by
   a real fetch, not on a re-implementation of the parse. */
window.BST = {
  state,
  get ready() { return !!state.season && queueDepth() === 0; },
  text: () => $('out').textContent,
  season: () => state.season,
  LEVEL, levelLabel, boxSide, positionInfo, fillFraction, drawFor,
};

readHash();
writeHash();
load();
