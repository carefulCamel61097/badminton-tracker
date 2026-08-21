/* The season view.
 *
 * One square per tournament, chronological, left to right. Each square is a
 * gauge: it fills from the bottom in proportion to how far the player got, and
 * the fill ramps green (title) to red (first-round exit). The label repeats the
 * same information as text, so the encoding survives colour blindness.
 *
 * Squares are sized by how much the tournament weighs — see HANDOVER Part 2,
 * which settles the numbers, the 42px full square, the 9px label floor and the
 * equal 52px slot. That was decided against real seasons on tools/bench.html;
 * this is the same rendering, wired to live data.
 */

import { loadSeason, loadPlayer, queueDepth } from './api.js';
import {
  positionInfo, fillFraction, drawForKind, dominantDraw, seasonKinds,
  defaultKind, seasonLevels, levelLabel, levelAbbr, boxSize, isTeamEvent,
  SLOT_W, BOX_H, LEVEL,
} from './model.js';

const $ = id => document.getElementById(id);

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const state = {
  playerId: null,
  year: null,
  kind: null,            // 'singles' | 'doubles'; null = follow defaultKind()
  sized: true,
  levels: null,          // Set of category ids to show; null = "not chosen yet"
  player: null,          // {name, country} once the summary lands; null before
  season: null,          // always the whole season, team events included
  kinds: [],
  error: null,
  loading: false,
};

/* ============================ what gets drawn ============================ */

/**
 * Team events are off unless explicitly switched on. They carry no individual
 * position — BWF returns "N/A" — so at full weight they are the largest and
 * emptiest squares in the strip: maximum prominence, zero information.
 */
function defaultLevels(season) {
  return new Set(seasonLevels(season).filter(c => !isTeamEvent(c)));
}

/** The tournaments the strip should draw, in order. */
function visibleSeason() {
  const s = state.season || [];
  if (!state.levels) return s;
  return s.filter(t => state.levels.has(t.cat));
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
  const info = positionInfo(draw && draw.position);
  const pct = Math.round(fillFraction(info, draw) * 100);
  const box = boxSize(tmt.cat, state.sized);

  const weight = (LEVEL[tmt.cat] || {}).weight;
  const wl = draw && draw.win != null ? ` · ${draw.win}-${draw.lose}` : '';
  const entered = draw ? `${draw.name} — ${info.full}${wl}` : 'did not enter';
  const tip = `${tmt.name}\n${tmt.level || 'Unknown level'}`
    + (weight != null ? ` · weight ${weight.toFixed(2)}` : '')
    + `\n${entered}`;

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

function renderStrip() {
  const shown = visibleSeason();
  const kind = state.kind;
  const preferred = dominantDraw(state.season, kind);

  $('strip').innerHTML = shown.map(t => square(t, kind, preferred)).join('');

  const total = (state.season || []).length;
  $('stripCount').textContent = shown.length === total
    ? `${total} tournament${total === 1 ? '' : 's'}`
    : `${shown.length} of ${total} tournaments`;
  // The id until the summary lands, then the name. Never a blank heading — the
  // strip should say whose season it is before it says anything else.
  const who = state.player ? state.player.name : `player ${state.playerId}`;
  const where = state.player && state.player.countryCode ? ` (${state.player.countryCode})` : '';
  $('stripWho').textContent = `${who}${where} · ${state.year} · ${kind || '—'}`;

  // An empty strip has three quite different causes and the difference matters:
  // a filter you can undo, a discipline this player does not play, or a year
  // BWF has no record of.
  const box = $('empty');
  let why = '';
  if (!total) {
    why = `No tournaments recorded for ${state.year}.`
      + ' BWF\'s data may not reach back this far, or this player did not compete.';
  } else if (!shown.length) {
    why = `All ${total} tournaments are hidden by the level filters.`;
  } else if (!shown.some(t => drawForKind(t, kind, preferred))) {
    why = `No ${kind} results in ${state.year}.`;
  }
  box.textContent = why;
  box.hidden = !why;
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
    `<button type="button" class="seg${k.kind === state.kind ? ' on' : ''}"
       data-kind="${k.kind}" aria-pressed="${k.kind === state.kind}">
       ${esc(k.kind)} <span class="n">${k.count}</span></button>`).join('');
}

function renderLevels() {
  const present = seasonLevels(state.season);
  $('levels').innerHTML = present.map(c => {
    const on = state.levels && state.levels.has(c);
    const team = isTeamEvent(c);
    const n = (state.season || []).filter(t => t.cat === c).length;
    return `<button type="button" class="chip${on ? ' on' : ''}${team ? ' team' : ''}"
      data-cat="${c}" aria-pressed="${!!on}">${esc(levelLabel(c))}
      <span class="n">${n}</span></button>`;
  }).join('');
}

function setStatus(text, isError) {
  const el = $('status');
  el.textContent = text;
  el.className = isError ? 'error' : '';
}

function render() {
  if (state.error) {
    setStatus(state.error, true);
    $('stripWrap').hidden = true;
    return;
  }
  if (state.loading) { setStatus('Loading…'); return; }
  if (!state.season) return;

  setStatus('');
  $('stripWrap').hidden = false;
  renderKinds();
  renderLevels();
  renderStrip();
  $('raw').textContent = JSON.stringify(visibleSeason(), null, 1);
}

/* ============================ loading ============================ */

async function load() {
  state.error = null;
  state.loading = true;
  render();

  try {
    // The whole season, team events and all: the level chips decide what is
    // drawn, so toggling one never costs another request.
    const season = await loadSeason(state.playerId, state.year);
    state.season = season;
    state.kinds = seasonKinds(season);
    if (!state.kind || !state.kinds.some(k => k.kind === state.kind)) {
      state.kind = defaultKind(season);
    }
    if (!state.levels) state.levels = defaultLevels(season);
    else {
      // Keep the choice across a year change, but adopt any level this season
      // has that the last one did not — otherwise stepping back a year can
      // silently hide half of it.
      const known = defaultLevels(season);
      for (const c of known) if (!seasonLevels(state.season).includes(c)) state.levels.add(c);
    }
    state.loading = false;
    render();

    // Secondary and allowed to fail: the strip is complete without it, so it
    // rides the low lane behind the season and never delays a click.
    if (!state.player || state.player.id !== String(state.playerId)) {
      state.player = null;
      try {
        const who = await loadPlayer(state.playerId, { priority: 'low' });
        if (who && who.id === String(state.playerId)) { state.player = who; render(); }
      } catch { /* a name is a nicety, not the page */ }
    }
  } catch (e) {
    // BWF's API is undocumented and can change without notice. Say so plainly
    // rather than showing an empty strip, which reads as "no tournaments".
    state.loading = false;
    state.error = 'Could not load from BWF: ' + e.message
      + '. The API is unofficial and may have changed.';
    render();
  }
}

/* ============================ input ============================ */

function readForm() {
  const player = $('playerId').value.trim();
  const year = $('year').value.trim();
  // A discipline and a set of levels belong to a player. Carrying them across
  // meant opening a doubles player on singles and every square reading as
  // "did not enter".
  if (player !== state.playerId) { state.kind = null; state.levels = null; }
  state.playerId = player;
  state.year = year;
  state.sized = $('sized').checked;
}

function commit() {
  readForm();
  writeHash();
  load();
}

function stepYear(by) {
  const y = Number($('year').value) || new Date().getFullYear();
  $('year').value = String(y + by);
  commit();
}

$('pick').addEventListener('submit', e => { e.preventDefault(); commit(); });
$('yearPrev').addEventListener('click', () => stepYear(-1));
$('yearNext').addEventListener('click', () => stepYear(1));

// Size is a user toggle, on by default, and it is only a redraw.
$('sized').addEventListener('change', () => {
  state.sized = $('sized').checked;
  writeHash();
  render();
});

$('kindWrap').addEventListener('click', e => {
  const b = e.target.closest('[data-kind]');
  if (!b) return;
  state.kind = b.dataset.kind;
  writeHash();
  render();
});

$('levels').addEventListener('click', e => {
  const b = e.target.closest('[data-cat]');
  if (!b) return;
  const cat = Number(b.dataset.cat);
  if (state.levels.has(cat)) state.levels.delete(cat);
  else state.levels.add(cat);
  writeHash();
  render();
});

/* ============================ hash routing ============================

   #p=57945&y=2026&k=singles&lv=23.24.25&sz=0 — enough to link to a season
   exactly as it is on screen, and enough for a suite to open one directly.
   ================================================================== */

function readHash() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (h.has('p')) $('playerId').value = h.get('p');
  if (h.has('y')) $('year').value = h.get('y');
  if (h.has('sz')) $('sized').checked = h.get('sz') !== '0';
  readForm();
  if (h.has('k')) state.kind = h.get('k');
  if (h.has('lv')) state.levels = new Set(h.get('lv').split('.').map(Number).filter(Boolean));
}

function writeHash() {
  const p = new URLSearchParams();
  p.set('p', state.playerId);
  p.set('y', state.year);
  if (state.kind) p.set('k', state.kind);
  if (!state.sized) p.set('sz', '0');
  // Only when it differs from the default, so an untouched strip has a short
  // shareable link rather than thirteen category ids.
  if (state.levels && state.season) {
    const def = defaultLevels(state.season);
    const same = def.size === state.levels.size && [...def].every(c => state.levels.has(c));
    if (!same) p.set('lv', [...state.levels].join('.'));
  }
  const next = '#' + p.toString();
  if (location.hash !== next) history.replaceState(null, '', next);
}

window.addEventListener('hashchange', () => { readHash(); writeHash(); load(); });

/* The suites' seam into the running app: they assert on real state produced by
   a real fetch and on the real geometry the browser laid out, not on a
   re-implementation of either. */
window.BST = {
  state,
  get ready() { return !!state.season && !state.loading && queueDepth() === 0; },
  season: () => state.season,
  visible: visibleSeason,
  /** What the strip is actually showing, read back off the DOM. */
  squares: () => [...document.querySelectorAll('#strip .sq')].map(sq => {
    const box = sq.querySelector('.box');
    const r = box.getBoundingClientRect();
    return {
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
    };
  }),
  SLOT_W, BOX_H, LEVEL, boxSize, positionInfo, fillFraction,
};

readHash();
writeHash();
load();
