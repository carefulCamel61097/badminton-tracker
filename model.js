/* Pure model: tournament levels, weights, result positions, name tidying, and
 * the parse of a raw vue-player-tournaments payload into a season.
 *
 * Deliberately free of `window`, `document`, `fetch` and storage so the test
 * harness can import it straight into Node and check the maths in
 * milliseconds instead of driving a browser. Everything that touches the
 * network lives in api.js; everything that touches the DOM lives in app.js.
 */

/* ============================ tournament levels ============================

   `tournament_category_id` as it arrives on tournament_model. The full set seen
   in real data is 5, 6, 7, 11, 17, 20, 21, 22, 23, 24, 25, 26, 27 — note 7
   (Future Series), which the predecessor's map was missing.
   ======================================================================== */

/**
 * `label` is what a filter chip says; `abbr` is what fits under a 52px square.
 * Only the ones that overflow carry an abbreviation — "Super 1000" fits, and
 * abbreviating it would cost legibility for nothing.
 */
export const LEVEL = {
  5:  { label: 'Challenge',   weight: 0.40 },
  6:  { label: 'Series',      weight: 0.40 },
  7:  { label: 'Future',      weight: 0.40 },
  11: { label: 'Continental', weight: 1.00, abbr: 'Cont.' },
  17: { label: 'Cont. Team',  weight: 1.00, abbr: 'C. Team', team: true },
  20: { label: 'Worlds',      weight: 1.00 },
  21: { label: 'Team event',  weight: 1.00, abbr: 'Team', team: true },
  22: { label: 'Tour Finals', weight: 1.00, abbr: 'Finals' },
  23: { label: 'Super 1000',  weight: 1.00 },
  24: { label: 'Super 750',   weight: 1.00 },
  25: { label: 'Super 500',   weight: 0.80 },
  26: { label: 'Super 300',   weight: 0.60 },
  27: { label: 'Super 100',   weight: 0.40 },
};

/**
 * Areas, not sides. The basis is BWF's own Top Committed Player Programme:
 * a top-15 singles player must enter every Super 1000 and every Super 750, so
 * **Super 750 is the line above which entry is compulsory** and is therefore
 * the full-size tier — 10 of the 42 events on the 2026 calendar. Below it,
 * equal steps in area down to Super 100, with everything under the World Tour
 * sharing the Super 100 size.
 *
 * Continental Championships are full size (settled 21 Aug 2026): an Asian
 * Championships title is a major even though the commitment rules, which only
 * cover the World Tour, say nothing about them.
 *
 * Rejected: area proportional to the Super number (a Super 100 title is ~46% of
 * a Super 1000 in ranking points, not 10%), to ranking points (too compressed —
 * Super 750 lands within ~1.3px of Super 1000), to prize money (too wide —
 * Super 100 dies at ~10px), and opacity (collides with the result ramp).
 */
/**
 * Chip order for the level filters: the majors, then the World Tour ladder,
 * then everything below it, then the team events last because they are off by
 * default. Not the numeric order of the ids, which is arbitrary.
 */
export const LEVEL_ORDER = [20, 22, 23, 24, 11, 25, 26, 27, 5, 6, 7, 21, 17];

/** The levels a season actually contains, in chip order. */
export function seasonLevels(season) {
  const present = new Set((season || []).map(t => t.cat));
  return LEVEL_ORDER.filter(c => present.has(c));
}

export const SLOT_W = 52;        // every tournament keeps this footprint; the box shrinks within it
export const BOX_H = 42;         // at 30px the whole weight range is 11px and reads as noise
export const BOX_FONT = 11;      // round label at full size
export const MIN_LABEL_PX = 9;   // never scale it below this — a Challenge QF became unreadable

/** How much of full size a category draws at. `side = sqrt(area)`. */
export function boxScale(catId, sized = true) {
  const w = (LEVEL[catId] || {}).weight;
  if (!sized || w == null) return 1;
  return Math.sqrt(w);
}

/**
 * The box for a category: both dimensions scale by the side, but the label is
 * floored. Scaling the label with the box is what made a Challenge
 * quarter-final unreadable, and a square nobody can read encodes nothing.
 */
export function boxSize(catId, sized = true) {
  const s = boxScale(catId, sized);
  return {
    w: SLOT_W * s,
    h: BOX_H * s,
    font: Math.max(MIN_LABEL_PX, BOX_FONT * s),
  };
}

export function levelLabel(catId) {
  return (LEVEL[catId] || {}).label || '';
}

/** The level as it fits under a square: abbreviated only where it has to be. */
export function levelAbbr(catId) {
  const l = LEVEL[catId] || {};
  return l.abbr || l.label || '';
}

export function isTeamEvent(catId) {
  return !!(LEVEL[catId] || {}).team;
}

/* ============================ results ============================

   BWF spells a placing, not a round: "1st" / "2nd" / "3rd", then "QF", "R16",
   "R32", "R64", "Qual...", and "N/A" for team ties, which carry no individual
   position at all.
   ============================================================== */

const POSITION = {
  '1st': { label: 'W',   tier: 'w',   depth: 6, full: 'Champion' },
  '2nd': { label: 'F',   tier: 'f',   depth: 6, full: 'Runner-up' },
  '3rd': { label: 'SF',  tier: 'sf',  depth: 5, full: 'Semi-final' },
  'QF':  { label: 'QF',  tier: 'qf',  depth: 4, full: 'Quarter-final' },
  'R16': { label: 'R16', tier: 'r16', depth: 3, full: 'Round of 16' },
  'R32': { label: 'R32', tier: 'r1',  depth: 2, full: 'Round of 32' },
  'R64': { label: 'R64', tier: 'r1',  depth: 1, full: 'Round of 64' },
};

const FINAL_DEPTH = 6;
const MIN_FILL = 0.13;           // a first-round exit still shows a sliver

export function positionInfo(pos) {
  if (!pos || pos === 'N/A') return { label: '-', tier: 'na', full: 'Played' };
  if (POSITION[pos]) return POSITION[pos];
  if (/^Qual/i.test(pos)) return { label: 'Q', tier: 'q', depth: 0, full: pos };
  return { label: String(pos), tier: 'na', full: String(pos) };
}

/**
 * How full the gauge should be: rounds won divided by rounds available *in that
 * tournament*, so a Super 300 quarter-final and a Super 1000 quarter-final read
 * the same rather than being skewed by draw size.
 *
 * The entry round is derived from where they went out and how many matches they
 * played: entry = exitDepth - matchesPlayed + 1.
 */
export function fillFraction(info, draw) {
  if (!draw || info.tier === 'na') return 0;
  const wins = Number(draw.win) || 0;
  const played = wins + (Number(draw.lose) || 0);
  if (!played || !info.depth) return MIN_FILL;

  const entry = info.depth - played + 1;
  const rounds = FINAL_DEPTH - entry + 1;
  if (rounds <= 0) return MIN_FILL;

  return Math.max(MIN_FILL, Math.min(1, wins / rounds));
}

/* ============================ names ============================ */

/**
 * The family name out of a BWF display name, which capitalises it: "Thom
 * GICQUEL" -> GICQUEL, "SHI Yu Qi" -> SHI. Compound surnames and initials fall
 * out of the caps rule; names where *every* token is caps (THET HTAR THUZAR,
 * CHEN ZHI YI) have no case signal and are kept whole, because the family name
 * leads in Chinese and Korean names and trails in Indian ones.
 */
export function surnameOf(nameDisplay) {
  const toks = String(nameDisplay || '').trim().split(/\s+/).filter(t => t && t[0] !== '(');
  const isCaps = t => /\p{Lu}/u.test(t) && t === t.toUpperCase() && !t.includes('.');
  const caps = toks.filter(isCaps);
  if (!caps.length) return toks[toks.length - 1] || '';
  if (caps.length === toks.length) return toks.join(' ');
  return caps.join(' ');
}

/**
 * Country codes and other all-caps tokens that belong to the tournament's name
 * rather than to a sponsor. Without this "YONEX US Open 2026" loses YONEX
 * (right) and then US (wrong) and renders as "Open" — a bug the predecessor
 * shipped. An allow-list, not a rewrite: edition numerals like VI and XXIX
 * *should* still be stripped.
 */
const NOT_A_SPONSOR = new Set(['US', 'USA', 'UAE', 'UK', 'BWF']);

/**
 * "PETRONAS Malaysia Open 2026" -> "Malaysia Open".
 *
 * The square is ~52px wide and gets two lines, so this has to be aggressive:
 * drop the sponsor, the year and the filler, then abbreviate. The full name is
 * always kept in the tooltip, so nothing is lost.
 */
export function shortTmtName(name) {
  let s = String(name || '')
    .replace(/\s*(19|20)\d{2}\s*$/, '')      // trailing year
    .replace(/^\s*(19|20)\d{2}\s+/, '')      // leading year ("2026 European ...")
    .trim();

  // Drop a leading run of sponsor tokens (all-caps, or known mixed-case ones).
  const words = s.split(/\s+/);
  const sponsorish = w =>
    !NOT_A_SPONSOR.has(w) &&
    (/^[A-Z][A-Z&.'-]{1,}$/.test(w)
      || /^(TotalEnergies|Yonex|Victor|Daihatsu|Petronas|Perodua|Toyota|Crowne|Blibli|Polytron)$/i.test(w));
  let i = 0;
  while (i < words.length - 1 && sponsorish(words[i])) i++;
  s = words.slice(i).join(' ');

  s = s
    .replace(/^BWF\s+/i, '')                 // space is tight; BWF is implied
    .replace(/\bBadminton\b/gi, '')
    .replace(/\bOpen\s+Championships?\b/i, 'Open')
    .replace(/\bChampionships?\b/gi, 'Champs')
    .replace(/\bInternational\b/gi, 'Intl')
    .replace(/\bMen's\s*&\s*Women's\s*Team\b/i, 'Team')
    .replace(/\bIndividual\b/gi, '')
    .replace(/\bThomas\s*&\s*Uber\s*Cup\s*Finals?\b/i, 'Thomas & Uber')
    .replace(/\s+/g, ' ')
    .trim();

  if (s.length > 24) s = s.slice(0, 23).trimEnd() + '…';
  return s || String(name || '');
}

/* ============================ season parsing ============================ */

export const SINGLES_DRAWS = ['MS', 'WS'];
export const DOUBLES_DRAWS = ['MD', 'WD', 'XD'];

/**
 * Raw vue-player-tournaments payload -> one season, oldest first.
 *
 * `results` is polymorphic: a plain array when drawCount is passed, a paginated
 * object otherwise. Both are accepted here so a caller that forgets the
 * parameter degrades to slow rather than to empty.
 *
 * The API returns newest first. A season reads left to right, so it is reversed
 * exactly once — here — and nowhere else.
 *
 * Team events are kept in the parse and filtered at display time: they carry no
 * individual position, so they render as empty squares and default off (Part
 * 2.3), but dropping them here would make the toggle impossible.
 */
export function parseSeason(raw, opts = {}) {
  const results = raw && raw.results;
  const list = Array.isArray(results) ? results
    : (results && Array.isArray(results.data)) ? results.data
    : [];

  const season = list.map(t => {
    const tm = t.tournament_model || {};
    const cat = tm.tournament_category_id;
    return {
      tournamentId: t.tournament_id != null ? t.tournament_id : tm.id,
      name: tm.name || '',
      short: shortTmtName(tm.name),
      code: tm.code || '',
      slug: tm.slug || '',
      cat,
      level: levelLabel(cat),
      team: isTeamEvent(cat),
      start: String(tm.start_date || '').slice(0, 10),
      end: String(tm.end_date || '').slice(0, 10),
      location: t.location || '',
      url: t.tmt_url || '',
      draws: (t.draws || []).map(dr => ({
        event: dr.event_id,
        name: String(dr.name || '').toUpperCase(),
        position: dr.position,
        win: dr.match_win,
        lose: dr.match_lose,
        games: { win: dr.game_win, lose: dr.game_lose },
        points: { player: dr.score_player, opponent: dr.score_opponent },
      })),
    };
  });

  // Chronological. start_date is the honest key; the API's own ordering is
  // reverse-chronological and is trusted only as a tie-break.
  season.reverse();
  season.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  return opts.includeTeam === false ? season.filter(t => !t.team) : season;
}

/**
 * Singles or doubles — the only distinction the strip makes.
 *
 * A doubles season is not filtered by partner. `vue-player-tournaments` carries
 * no partner at all (HANDOVER 2.4), and more to the point a player's doubles
 * season is worth reading whole: someone who changes partner mid-year has still
 * played one season. So the toggle is the discipline, and every tournament the
 * player entered in it is shown.
 *
 * Team ties are their own kind and are never a choice — their draws are called
 * "Singles"/"Doubles" and carry no position.
 */
export function kindOf(drawName) {
  const n = String(drawName || '').toUpperCase();
  if (SINGLES_DRAWS.includes(n)) return 'singles';
  if (DOUBLES_DRAWS.includes(n)) return 'doubles';
  return 'team';
}

/** Which disciplines a season contains, commonest first. */
export function seasonDisciplines(season) {
  const counts = new Map();
  for (const t of season || []) {
    for (const d of t.draws || []) {
      if (!d.name || d.name === 'N/A') continue;
      counts.set(d.name, (counts.get(d.name) || 0) + 1);
    }
  }
  const rank = n => (kindOf(n) === 'singles' ? 0 : kindOf(n) === 'doubles' ? 1 : 2);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count, kind: kindOf(name) }))
    .sort((a, b) => b.count - a.count || rank(a.name) - rank(b.name));
}

/** Singles/doubles the season contains, with how many tournaments each. */
export function seasonKinds(season) {
  const counts = { singles: 0, doubles: 0 };
  for (const t of season || []) {
    const kinds = new Set((t.draws || []).map(d => kindOf(d.name)));
    for (const k of kinds) if (k in counts) counts[k]++;
  }
  return ['singles', 'doubles'].filter(k => counts[k] > 0).map(k => ({ kind: k, count: counts[k] }));
}

/** The kind a season should open on: most played, ties to singles. */
export function defaultKind(season) {
  const ks = seasonKinds(season);
  if (!ks.length) return null;
  return ks.slice().sort((a, b) => b.count - a.count
    || (a.kind === 'singles' ? -1 : 1))[0].kind;
}

/**
 * The draw a player plays most of within one kind — MD for someone who plays
 * mostly men's doubles and the occasional mixed.
 *
 * This exists for the one tournament where they entered both: the square can
 * only show one result, and showing whichever the API happened to list first
 * would make the strip inconsistent from event to event.
 */
export function dominantDraw(season, kind) {
  const ds = seasonDisciplines(season).filter(d => d.kind === kind);
  return ds.length ? ds[0].name : null;
}

/** The draw matching a discipline, or null. Never falls back to a different one. */
export function drawFor(tmt, discipline) {
  if (!tmt || !tmt.draws || !tmt.draws.length) return null;
  const want = String(discipline || '').toUpperCase();
  return tmt.draws.find(d => d.name === want) || null;
}

/**
 * The draw to show for a tournament under a singles/doubles toggle.
 *
 * `preferred` is the season's dominant draw for that kind, which settles the
 * both-MD-and-XD case in favour of the one the player actually plays.
 */
export function drawForKind(tmt, kind, preferred) {
  if (!tmt || !tmt.draws) return null;
  const inKind = tmt.draws.filter(d => kindOf(d.name) === kind);
  if (!inKind.length) return null;
  return inKind.find(d => d.name === preferred) || inKind[0];
}
