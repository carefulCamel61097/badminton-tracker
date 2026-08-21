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

/**
 * The levels a season actually contains, in chip order.
 *
 * Anything LEVEL_ORDER does not know about goes on the end rather than being
 * dropped: a Superseries-era season is mostly categories this project has not
 * mapped, and leaving them out of the chip row rendered their squares with no
 * way to filter them — visible but unreachable.
 */
export function seasonLevels(season) {
  const present = new Set((season || []).map(t => t.cat).filter(c => c != null));
  const known = LEVEL_ORDER.filter(c => present.has(c));
  const unknown = [...present].filter(c => !LEVEL_ORDER.includes(c)).sort((a, b) => a - b);
  return known.concat(unknown);
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

/**
 * The level's name for a filter chip.
 *
 * The map above covers what the 2026 calendar uses. Seasons from before about
 * 2018 carry ids it does not — 1, 2, 3, 4, 8, 10, 13, 16, 33 and 35 have all
 * been seen, from the Superseries era, the Grand Prix, the Games and the junior
 * circuit. Rather than render those as a blank chip nobody can click on
 * knowingly, they are named for what they are: an id this project has not
 * mapped yet. They keep full size, because guessing a weight downwards would
 * quietly shrink a season nobody has looked at.
 */
export function levelLabel(catId) {
  const l = LEVEL[catId];
  if (l) return l.label;
  return catId == null ? '' : `Level ${catId}`;
}

/** The level as it fits under a square: abbreviated only where it has to be. */
export function levelAbbr(catId) {
  const l = LEVEL[catId];
  if (!l) return catId == null ? '' : `Lv ${catId}`;
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

/**
 * `steps` is how many rounds from the final the player went out — 0 for the
 * champion, 1 for the runner-up, and so on outwards. Counting *from the final*
 * rather than from the first round is what makes the scale independent of how
 * big the draw was: the final is the final in a 16-draw and a 128-draw alike,
 * whereas "round one" is R16 in one and R128 in the other.
 */
const POSITION = {
  '1st':  { label: 'W',    tier: 'w',   steps: 0, full: 'Champion' },
  '2nd':  { label: 'F',    tier: 'f',   steps: 1, full: 'Runner-up' },
  '3rd':  { label: 'SF',   tier: 'sf',  steps: 2, full: 'Semi-final' },
  'QF':   { label: 'QF',   tier: 'qf',  steps: 3, full: 'Quarter-final' },
  'R16':  { label: 'R16',  tier: 'r16', steps: 4, full: 'Round of 16' },
  'R32':  { label: 'R32',  tier: 'r1',  steps: 5, full: 'Round of 32' },
  'R64':  { label: 'R64',  tier: 'r1',  steps: 6, full: 'Round of 64' },
  'R128': { label: 'R128', tier: 'r1',  steps: 7, full: 'Round of 128' },
};

const MIN_FILL = 0.13;           // a first-round exit still shows a sliver

export function positionInfo(pos) {
  if (!pos || pos === 'N/A') return { label: '-', tier: 'na', full: 'Played' };
  if (POSITION[pos]) return POSITION[pos];
  if (/^Qual/i.test(pos)) return { label: 'Q', tier: 'q', full: pos };
  return { label: String(pos), tier: 'na', full: String(pos) };
}

/**
 * How many rounds a draw of `size` entrants takes to win. 32 -> 5, 64 -> 6.
 * Rounded up, because BWF's sizes are not always exact powers of two.
 */
export function roundsInDraw(size) {
  const n = parseInt(String(size), 10);
  if (!Number.isFinite(n) || n < 2) return null;
  return Math.ceil(Math.log2(n));
}

/**
 * The main draw for a discipline out of a tournaments/draws payload, and its
 * size.
 *
 * The endpoint returns one row per *stage*, not per discipline: a Super 500
 * comes back with ten rows, because every discipline also has a qualifying
 * draw named "MS - Qualification" and sized "16>4" (sixteen entrants producing
 * four qualifiers). The Asian Championships adds four round-robin group rows
 * per discipline on top. Only the row named exactly for the discipline is the
 * knockout everyone's `position` refers to.
 *
 * Sizes differ *between disciplines of the same tournament* — the 2026 China
 * Masters ran MS at 64 and WS at 32 — so this must be asked per draw and never
 * cached against the tournament alone.
 */
export function mainDrawSize(payload, discipline) {
  const rows = Array.isArray(payload) ? payload
    : (payload && Array.isArray(payload.data)) ? payload.data
    : [];
  const want = String(discipline || '').toUpperCase();
  const main = rows.find(d =>
    String(d.name || '').toUpperCase() === want && d.type === 'Elimination');
  if (!main) return null;
  const n = parseInt(String(main.size), 10);
  return Number.isFinite(n) && n >= 2 ? n : null;
}

/**
 * How many rounds a player had to win to take the title in one discipline of
 * one tournament — the ladder the strip measures against.
 *
 * Usually that is just the main knockout. Two stages complicate it, and the
 * payload distinguishes them:
 *
 *   Qualifying — `stage_type: 2`, `stage_name: "Qualifying"`. Either a
 *   "MS - Qualification" draw sized "16>4", or, at the Asian Championships,
 *   four round-robin groups of three. These happen *before* the tournament
 *   proper, so they are not part of the ladder. A qualifier who then loses in
 *   R32 has made a first-round exit, whatever their match record says — which
 *   is precisely what the old inference got wrong, since it counted qualifying
 *   wins as rounds of the main draw.
 *
 *   Round-robin as the main stage — the season-ending Finals, where two groups
 *   of four feed a four-player knockout. Here the group *is* the tournament: a
 *   semi-finalist won three group matches to get there, and counting only the
 *   knockout would score them the same as a first-round loser.
 *
 * Payloads from before about 2019 leave `stage_type` and `stage_name` null, so
 * the two cannot always be told apart by what the row says. They can be told
 * apart by shape: a main stage has to hold the whole field, so its groups seat
 * at least as many players as the knockout that follows. The 2017 Dubai Finals
 * ran two groups of four into a knockout of four — the groups are the event.
 * The 2018 Asian Championships ran four groups of three into a knockout of
 * thirty-two, which is a side entrance for twelve players, not the tournament.
 */
export function drawLadder(payload, discipline) {
  const rows = Array.isArray(payload) ? payload
    : (payload && Array.isArray(payload.data)) ? payload.data
    : [];
  const want = String(discipline || '').toUpperCase();
  const mine = rows.filter(d => {
    const n = String(d.name || '').toUpperCase();
    return n === want || n.startsWith(want + ' -');
  });

  const knockout = mainDrawSize(mine, want);
  const rounds = roundsInDraw(knockout);
  if (rounds == null) return null;

  const qualifying = d => d.stage_type === 2 || /qualif/i.test(String(d.stage_name || ''));
  const size = d => parseInt(String(d.size), 10) || 0;
  const groups = mine.filter(d => d.type === 'Round Robin' && !qualifying(d));
  if (!groups.length) return rounds;

  const field = groups.reduce((n, g) => n + size(g), 0);
  if (field < knockout) return rounds;      // a side entrance, not the main stage

  // Everyone in a group plays everyone else in it: size - 1 matches.
  const biggest = Math.max(...groups.map(size));
  return biggest >= 2 ? rounds + (biggest - 1) : rounds;
}

/**
 * How full the gauge should be: how far through that tournament's own ladder
 * the player got.
 *
 * With `rounds` — the real number of rounds in that draw, from
 * `tournaments/draws` — this is simply the rounds survived over the rounds
 * there were. A quarter-final of a 64-draw fills 3/6 and a quarter-final of a
 * 32-draw fills 2/5, which is the honest difference: one of them had to win a
 * round the other did not.
 *
 * Without it, the ladder depth is inferred from matches played, which is what
 * the strip did before the draw sizes were available and is still the fallback
 * when the extra call fails. The two agree whenever a player entered the main
 * draw at round one; they diverge on byes, on qualifiers whose wins include
 * qualifying rounds, and on walkovers. The inference also cannot see past R64,
 * because it has to assume where the ladder starts.
 */
export function fillFraction(info, draw, rounds) {
  if (!draw || info.tier === 'na') return 0;
  // Qualifying, or a placing we do not recognise: they were there, and that is
  // all this can honestly say.
  if (info.steps == null) return MIN_FILL;

  if (rounds > 0) {
    const survived = Math.max(0, rounds - info.steps);
    return Math.max(MIN_FILL, Math.min(1, survived / rounds));
  }

  const wins = Number(draw.win) || 0;
  const played = wins + (Number(draw.lose) || 0);
  if (!played) return MIN_FILL;
  // Rounds available from wherever they came in: the ones they won, plus the
  // ones between their exit and the final.
  const available = wins + info.steps;
  if (available <= 0) return MIN_FILL;
  return Math.max(MIN_FILL, Math.min(1, wins / available));
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
