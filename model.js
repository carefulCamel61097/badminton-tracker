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
  // The Olympics come back as category 20, the same id as the World
  // Championships, so they are separated here on the tournament's name. They
  // are not a World Championships and the strip should not call them one.
  OLY: { label: 'Olympics',   weight: 1.00 },
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

  /* ---- the Superseries era, 2007–2017 ----

     BWF still returns these ids and still ships no name for them, so before
     this they rendered as "Level 8" and sat in the grid's Unmapped block — which
     meant LIN Dan and LEE Chong Wei had no comparable career at all.

     `mapsTo` is what the grid and the honours board place them on. It is *not*
     what the strip calls them: a 2011 Superseries Premier was a Superseries
     Premier, and the strip says so. Only the comparison views translate, and
     they mark that they did. See `mappedTier`. */
  8: { label: 'Superseries Premier', abbr: 'SS Prem', weight: 1.00, mapsTo: 23 },
  2: { label: 'Superseries',         abbr: 'SSeries', weight: 1.00, mapsTo: 24 },
  3: { label: 'Grand Prix Gold',     abbr: 'GP Gold', weight: 0.60, mapsTo: 26 },
  4: { label: 'Grand Prix',          abbr: 'GP',      weight: 0.40, mapsTo: 27 },
};

/**
 * Which modern tier a pre-2018 category is drawn as, or null for one that is
 * already modern.
 *
 * ⚠️ **Derived from `tournament_series_id`, which survives an edition.** The
 * tournament id does not — that is why the grid's blocks are not keyed on one
 * (1.1b) — but the *series* id does, and 1396 of 1404 recorded rows carry one.
 * Following a series across the 2018 boundary says what each old tier actually
 * turned into, using the same tournaments rather than a guess:
 *
 * | was | became | evidence |
 * |---|---|---|
 * | 8 Superseries Premier | Super 1000 | S1000 in 5 of 6 series that span the change |
 * | 2 Superseries         | Super 750  | the centre of 14 spanning series, which run S1000 to S300 |
 * | 3 Grand Prix Gold     | Super 300  | S300 in 8, more than every other answer together |
 * | 4 Grand Prix          | Super 100  | thin, but it sat below Grand Prix Gold and nothing else is left |
 *
 * ⚠️ **Prize money cannot do this job.** Each old tier's median sits at roughly
 * two thirds of the modern tier it became — Premier $600k against Super 750's
 * $850k — because the World Tour raised the minimums. Read as dollars it drags
 * every historical result down a rung. It is good evidence of the ordering
 * *within* an era and none at all across the boundary.
 *
 * ⚠️ **Four old tiers, five new ones.** Nothing maps to Super 500. That is the
 * honest shape of it rather than a gap to be filled: the Superseries era had
 * Premier, Superseries, Grand Prix Gold and Grand Prix beneath the majors, and
 * inventing a fifth to make the rows line up would be making it up.
 *
 * ⚠️ **Before 2011 there was no Premier tier** — all twelve Superseries events
 * were category 2, so a 2008 All England is drawn a rung below a 2013 one. It
 * is the coarsest edge of this and the reason every translated square is
 * marked.
 */
export function mappedTier(catId) {
  const l = LEVEL[catId];
  return l && l.mapsTo != null ? l.mapsTo : null;
}

/**
 * Chip order for the level filters: the majors, then the World Tour ladder,
 * then everything below it, then the team events last because they are off by
 * default. Not the numeric order of the ids, which is arbitrary.
 */
export const LEVEL_ORDER =
  ['OLY', 20, 22, 11, 23, 8, 24, 2, 25, 26, 3, 27, 4, 5, 6, 7, 21, 17];

/**
 * True for a tournament that is an Olympic Games rather than a World
 * Championships.
 *
 * ⚠️ The **Youth Olympic Games** are not the Olympics. BWF files them under
 * category 33 with the World Junior Championships, and matching on "olympic"
 * alone promoted them to the senior Games — so Shi Yu Qi's 2014 Youth Olympic
 * gold drew as a full-size Olympic title next to Tokyo and Paris. Found while
 * building the grid, where all three landed in one column.
 */
export function isOlympics(name) {
  const n = String(name || '');
  return /\bolympic/i.test(n) && !/\byouth\b/i.test(n);
}

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
  const unknown = [...present].filter(c => !LEVEL_ORDER.includes(c))
    .sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
  return known.concat(unknown);
}

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

/**
 * The same rounds spelled out in full.
 *
 * The Olympics use these — Tokyo 2020 and Paris 2024 return `"Quarterfinals"`
 * where the World Tour returns `"QF"` — and so do some pre-2015 events. A
 * spelling the map did not know rendered as an unrecognised placing, which is
 * drawn as an empty square: the strip was quietly blanking Olympic results.
 */
const POSITION_ALIAS = {
  'FINAL': '2nd', 'FINALS': '2nd', 'F': '2nd',
  'SEMIFINAL': '3rd', 'SEMIFINALS': '3rd', 'SEMI-FINAL': '3rd', 'SEMI-FINALS': '3rd',
  'SF': '3rd',
  'QUARTERFINAL': 'QF', 'QUARTERFINALS': 'QF', 'QUARTER-FINAL': 'QF', 'QUARTER-FINALS': 'QF',
  'ROUND OF 16': 'R16', 'ROUND OF 32': 'R32', 'ROUND OF 64': 'R64', 'ROUND OF 128': 'R128',
};

/* A placing that names a round the player has *reached* rather than one they
   went out in. A tournament still being played reports the round they are in —
   the 2026 World Championships returned "SF" mid-event — and the gauge reads
   the same either way: this is how far they have got. */
const REACHED = /^(F|SF)$/;

const MIN_FILL = 0.13;           // a first-round exit still shows a sliver

/**
 * @param {string} pos    BWF's placing string
 * @param {object} [draw] the draw entry, used only to settle "Final", which
 *   does not say who won it. A finalist who lost no match won the thing.
 */
export function positionInfo(pos, draw) {
  const raw = String(pos == null ? '' : pos).trim();
  if (!raw || raw === 'N/A' || raw === '-') {
    return { label: '-', tier: 'na', full: 'Played' };
  }
  if (POSITION[raw]) return POSITION[raw];

  const key = raw.toUpperCase();
  if (POSITION_ALIAS[key]) {
    // "Final" and "F" do not say who *won* it. Whoever lost no match did.
    if ((/^FINALS?$/.test(key) || REACHED.test(key))
        && draw && Number(draw.lose) === 0 && POSITION_ALIAS[key] === '2nd') {
      return POSITION['1st'];
    }
    return POSITION[POSITION_ALIAS[key]];
  }

  /* Group stages: the Olympics and the season-ending Finals both seed a knockout
     from round-robin groups, and going out in one is the earliest exit there is
     — so it reads red, but there is no ladder position for it and it fills the
     minimum.

     Two spellings. "Group A" is the obvious one. The other is a bare "R" and a
     single digit, which every occurrence in the recorded data is also a group
     exit: at the Tour Finals, groups of four play three matches and everyone
     who fails to come out of one is "R3" with a 1-2 or 0-3 record; at the Asian
     Championships, where the groups are a qualifying stage, it is "R3" again.
     Whether the digit counts matches or places, the meaning is the same.

     A single digit is unambiguous: the knockout rounds are R16 and larger. */
  if (/^(GROUP|GRP)\b/i.test(raw) || /^R[1-9]$/i.test(raw)) {
    return { label: 'Grp', tier: 'r1', full: 'Group stage — ' + raw };
  }
  if (/^Qual/i.test(raw)) return { label: 'Q', tier: 'q', full: raw };

  // A placing this project does not recognise — "R3" at a Tour Finals, and
  // whatever else BWF has used over twenty years. The player was *there*, so it
  // gets its own tier and the minimum fill rather than the blank square an
  // absent result draws: "we do not know how far" and "there was no individual
  // result" are different statements and should not look the same.
  return { label: raw, tier: 'unk', full: 'Placing: ' + raw };
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
    (canonicalDraw(d.name) || String(d.name || '').toUpperCase()) === want
    && d.type === 'Elimination');
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
    // "MS", "Men's Singles", and the stage rows "MS - Group A" that hang off
    // them.
    const head = n.split(' - ')[0];
    return canonicalDraw(head) === want || head === want;
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
const NOT_A_SPONSOR = new Set([
  'US', 'USA', 'UAE', 'UK', 'BWF',
  // Regions, which BWF writes in caps at the front of the Games and the
  // continental events: "ASIAN Games 2022" was rendering as just "Games".
  'ASIAN', 'ASIA', 'EUROPEAN', 'EUROPE', 'AFRICAN', 'AMERICAN', 'PAN', 'OCEANIA',
  'COMMONWEALTH', 'OLYMPIC', 'OLYMPICS', 'WORLD',
]);

/**
 * "PETRONAS Malaysia Open 2026" -> "Malaysia Open".
 *
 * The square is ~52px wide and gets two lines, so this has to be aggressive:
 * drop the sponsor, the year and the filler, then abbreviate. The full name is
 * always kept in the tooltip, so nothing is lost.
 */
/**
 * Words that name no tournament on their own. If stripping the sponsor leaves
 * only one of these, the sponsor *was* the name — "HYLO Open" is the event's
 * actual title, and reducing it to "Open" identifies nothing.
 */
const GENERIC_EVENT = /^(Open|Masters|Championships?|Champs|International|Intl|Classic|Cup|Games|Series|Finals?|Tournament)$/i;

const clip = (s, n = 24) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

/**
 * The tidied name **and the sponsor run that was removed to get it**.
 *
 * The sponsor is normally noise, which is why `shortTmtName` throws it away.
 * Once in a while it is the only thing telling two events apart: January 2021
 * ran the YONEX Thailand Open and the TOYOTA Thailand Open a week apart in the
 * same Bangkok bubble, and BWF left the year off *both* names because the
 * sponsor is how it distinguishes them. Tidied, they are two squares reading
 * "Thailand Open" in one season, which looks like the same tournament drawn
 * twice. `seasonLabels` hands the sponsor back where that happens.
 */
export function tidyTmtName(name) {
  let s = String(name || '')
    // "Denmark Open 2022 presented by VICTOR" — a sponsor at the *end*, which
    // also pushes the year into the middle where the trailing strip misses it.
    .replace(/[\s,]+presented\s+by\s+.*$/i, '')
    // Scheduling notes BWF appends to a name. "(Cancelled)" is deliberately not
    // in here: that one changes what the square means.
    .replace(/\s*\((new\s*dates?|postponed|rescheduled|formerly[^)]*)\)\s*$/i, '')
    .replace(/\b(19|20)\d{2}\b/g, ' ')       // a year anywhere, not just the ends
    .replace(/\s+/g, ' ')
    .trim();

  // Drop a leading run of sponsor tokens (all-caps, or known mixed-case ones).
  const words = s.split(/\s+/);
  const sponsorish = w =>
    !NOT_A_SPONSOR.has(w) &&
    (/^[A-Z][A-Z&.'-]{1,}$/.test(w)
      || /^(TotalEnergies|Yonex|Victor|Daihatsu|Petronas|Perodua|Toyota|Crowne|Blibli|Polytron)$/i.test(w));
  let i = 0;
  while (i < words.length - 1 && sponsorish(words[i])) i++;
  // Back off if the strip left nothing but a generic word.
  if (i > 0 && words.length - i === 1 && GENERIC_EVENT.test(words[i])) i--;
  const sponsor = words.slice(0, i).join(' ');
  s = words.slice(i).join(' ');

  s = s
    .replace(/^BWF\s+/i, '')                 // space is tight; BWF is implied
    .replace(/\bBadminton\b/gi, '')
    .replace(/\bOpen\s+Championships?\b/i, 'Open')
    .replace(/\bChampionships?\b/gi, 'Champs')
    .replace(/\bInternational\b/gi, 'Intl')
    .replace(/\bMen's\s*&\s*Women's\s*Team\b/i, 'Team')
    // The individual event is the default; only the team one needs saying.
    .replace(/\(\s*Individual\s+Event\s*\)/i, '')
    .replace(/\bIndividual\b/gi, '')
    .replace(/\bThomas\s*&\s*Uber\s*Cup\s*Finals?\b/i, 'Thomas & Uber')
    .replace(/\s*[-–]\s*Non\s+World\s+Ranking\s*$/i, '')
    // Tidy after the removals above: "(Individual Event)" losing its first word
    // must not leave "( Event)", and an emptied bracket should go entirely.
    .replace(/\(\s+/g, '(')
    .replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return { label: s || String(name || ''), sponsor };
}

export function shortTmtName(name) {
  return clip(tidyTmtName(name).label);
}

/**
 * Labels for one season's squares, with any that would read the same told
 * apart.
 *
 * Two squares in a row carrying the same words are read as one tournament drawn
 * twice — which is exactly what happened with the two Thailand Opens of January
 * 2021, and it is a fair thing to mistrust. So where a label repeats within a
 * season, the sponsor comes back, because that is what BWF itself is
 * distinguishing them by. If the sponsors match too, the month settles it.
 *
 * Only where it is needed: giving every square its sponsor back would cost the
 * legibility the tidying exists for.
 */
export function seasonLabels(tournaments) {
  const list = tournaments || [];
  const tidy = list.map(t => tidyTmtName(t.name));
  const bases = tidy.map(t => t.label);
  const suffixes = list.map(() => '');

  // What the reader will actually see: the base, clipped, with room reserved
  // for whatever suffix has been added, so a disambiguator is never the thing
  // that gets truncated away.
  const render = i => clip(bases[i], 24 - suffixes[i].length) + suffixes[i];

  /* Ambiguity is judged **after clipping**, because the 24-character limit is
     itself capable of making two different names identical — and does. Both
     halves of the 2017 Badminton Asia Junior Championships, the team event and
     the individual one, clip to "Pembangunan Jaya Raya A…". Comparing the full
     names would have called those distinct and left two identical squares on
     screen. Caught by the end-to-end check that no row repeats a label. */
  const ambiguous = () => {
    const seen = new Map();
    const shown = list.map((_, i) => render(i));
    for (const s of shown) seen.set(s, (seen.get(s) || 0) + 1);
    return shown.map(s => seen.get(s) > 1);
  };

  // The sponsor first — it is what BWF itself distinguishes the two January
  // 2021 Thailand Opens by, and it is the most informative thing available.
  let bad = ambiguous();
  list.forEach((_, i) => {
    if (bad[i] && tidy[i].sponsor) bases[i] = `${tidy[i].sponsor} ${tidy[i].label}`;
  });

  // Then the date, at the coarsest resolution that still separates them.
  for (const end of [7, 10]) {
    bad = ambiguous();
    list.forEach((_, i) => {
      if (!bad[i]) return;
      const when = String((list[i] || {}).start || '').slice(5, end);
      if (when) suffixes[i] = ` (${when})`;
    });
  }

  return list.map((_, i) => render(i));
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
    // The Olympics share category 20 with the World Championships and are
    // told apart only by name, so that is settled here, once.
    const cat = isOlympics(tm.name) ? 'OLY' : tm.tournament_category_id;
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
        // Canonical code where there is one, BWF's own wording otherwise —
        // which is what leaves a team tie as "SINGLES"/"DOUBLES".
        name: canonicalDraw(dr.name) || String(dr.name || '').toUpperCase(),
        raw: String(dr.name || ''),
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
/**
 * BWF's draw name reduced to one of MS / WS / MD / WD / XD, or null.
 *
 * The World Tour uses the two-letter codes, but the Olympics spell them out —
 * "Men's Singles", "Mixed Doubles" — and junior events use "BS U19" for boys'
 * singles. Everything downstream keys off the code, so a season is
 * canonicalised once, at the parse, rather than every reader learning the
 * variants.
 *
 * Null is a meaningful answer, and it is how a team tie is recognised: BWF
 * names those draws bare "Singles" and "Doubles", with no gender, because the
 * tie is the competitor rather than the player.
 */
export function canonicalDraw(name) {
  const n = String(name || '').trim().toUpperCase();
  if (!n) return null;
  if (/^(MS|WS|MD|WD|XD)$/.test(n)) return n;
  if (/MIXED/.test(n)) return 'XD';

  const doubles = /DOUBLES/.test(n) || /^[BGMW]D\b/.test(n);
  const singles = /SINGLES/.test(n) || /^[BGMW]S\b/.test(n);
  if (!doubles && !singles) return null;

  // Boys and girls are the junior circuit's men and women.
  const women = /^[WG]/.test(n) || /WOMEN|GIRL/.test(n);
  const men = /^[MB]/.test(n) || /\bMEN|BOY/.test(n);
  if (!women && !men) return null;      // bare "Singles"/"Doubles": a team tie

  return (women ? 'W' : 'M') + (doubles ? 'D' : 'S');
}

export function kindOf(drawName) {
  const code = canonicalDraw(drawName);
  if (!code) return 'team';
  if (SINGLES_DRAWS.includes(code)) return 'singles';
  if (DOUBLES_DRAWS.includes(code)) return 'doubles';
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

/* ============================ the career grid ============================

   A second reading of the same data, and a deliberately poorer one.

   The season strip answers "how did this year go": squares in the order they
   were played, sized by what they were worth, filled by how far the player got.
   The grid answers a coarser question — "how did this player do at this *level*,
   year after year" — and it answers it by throwing away almost everything the
   strip spends its detail on. Every cell is the same size, flooded solid, with
   no label.

   The layout is a row per season and a **section** per level. A section is not
   one column per tournament: it is a fixed number of slots, filled left to right
   with that season's results at that level **sorted best-first**, and padded on
   the right where the player entered fewer than the section holds.

   That is the second design, settled 22 Aug 2026 (HANDOVER 2.9). The first gave
   every tournament its own column, keyed on its name, and it had two problems
   that turned out to be one problem: a name is not a stable identity across
   editions, and 2020–21 is full of one-offs — two Thailand Opens in one January,
   the 2020 Finals played in 2021 — so every tier grew a ragged tail of columns
   one cell deep. Sorting inside a section makes both disappear. Two Thailand
   Opens are simply two Super 1000 results, which is what they were.

   What it costs: a cell no longer says *which* tournament without hovering it,
   and a column no longer reads down the years as one event. What it buys: every
   row is directly comparable, each section runs green-to-red left to right by
   construction, and a career is 25–35 cells wide instead of 45–60.
   ==================================================================== */

/**
 * Sections, left to right: hardest to win on the left, Super 100 on the right.
 * The same judgement as LEVEL_ORDER, minus everything the grid does not show.
 */
export const GRID_ORDER = ['OLY', 20, 22, 11, 23, 24, 25, 26, 27, 'OTHER'];

/* ============================== the two eras ==============================

   The World Tour replaced the Superseries in 2018, and until now the grid and
   the board have spoken only the newer language: `mappedTier` places a
   Superseries Premier where a Super 1000 goes and marks the square. That is the
   right default and the wrong one for the comparison people actually come here
   to make — LIN Dan against LEE Chong Wei, where the modern names are the
   foreign ones and every square on both boards is a translation.

   So the ladder can be read in either vocabulary. `era` is 'wt' or 'ss', it is
   a property of the *view* rather than of a result, and it changes two things
   and nothing else: which names the rows carry, and which squares are marked as
   translated.

   ⚠️⚠️ **Backwards is not the same map forwards.** Running the same evidence
   the other way — `tournament_series_id` followed across the 2018 boundary —
   the Super 1000 is unanimously the old Premier (4 of 4 spanning series) and
   the Super 300 is the Grand Prix Gold (8 of 9), but the **Super 500 splits 4–3
   between Grand Prix Gold and Superseries**. That is not missing evidence, it
   is evidence of a split: 2018 was not a renaming, and one Grand Prix Gold
   became both a Super 500 and a Super 300. There is no fifth old tier for the
   Super 500 to be.

   It is folded **upward into the Superseries** (decided 30 Aug 2026). That is
   the one real cost of reading the board this way, it is a cost paid by the
   comparison this exists for — ten of LIN Dan's results are Super 500s, against
   one of LEE Chong Wei's — and it is not hidden: those squares carry the same
   notch the Superseries-era ones carry in World Tour mode, and hovering one
   says "Super 500, drawn as Superseries".
   ==================================================================== */

export const ERAS = [
  { key: 'wt', label: 'World Tour',  full: 'World Tour names, 2018 onwards' },
  { key: 'ss', label: 'Superseries', full: 'Superseries-era names, 2007–2017' },
];

export const ERA_DEFAULT = 'wt';

export function eraKey(key) {
  return ERAS.some(e => e.key === key) ? key : ERA_DEFAULT;
}

/* Modern tier → the Superseries-era tier it is drawn on. The values are BWF's
   own pre-2018 category ids, so `LEVEL` already holds their names and
   abbreviations and there is no second table of labels to drift out of step.

   Keyed as strings for the reason `honourRung` gives: a group makes a round
   trip through `data-group` in the DOM, and a lookup that silently missed would
   leave a Super 750 sitting in its own unlabelled row. */
const TO_ERA = new Map([['23', 8], ['24', 2], ['25', 2], ['26', 3], ['27', 4]]);

/**
 * The row a tier is drawn on in the chosen era.
 *
 * Identity in World Tour mode, and identity in either mode for everything off
 * the Super ladder: the majors, the Tour Finals and the Continentals are the
 * same events under both sets of names, and only the Finals is even called
 * something different.
 */
export function eraGroup(group, era) {
  if (era !== 'ss') return group;
  const to = TO_ERA.get(String(group));
  return to == null ? group : to;
}

/* Derived, never written out, so a tier added to GRID_ORDER cannot go missing
   from the era ladder. The Set is what collapses the Super 750 and the Super
   500 into the one Superseries row they share. */
export const ERA_GRID_ORDER = [...new Set(GRID_ORDER.map(g => eraGroup(g, 'ss')))];

export function gridOrder(era) {
  return era === 'ss' ? ERA_GRID_ORDER : GRID_ORDER;
}

/* The tiers that exist only after 2018. Reading the board in Superseries names
   makes *these* the translated ones, which is why the notch is defined by the
   era rather than by the category: it always marks the squares the other era
   had to be converted into this one, and never the ones already speaking the
   view's own vocabulary. */
const MODERN_TIERS = new Set(['23', '24', '25', '26', '27']);

/**
 * What a result actually was, when the chosen era's ladder is not where its own
 * category would have put it — null when the square needs no translating.
 *
 * ⚠️ Deliberately **not** "the category differs from the row". A major rescued
 * by name is filed correctly despite a useless id — the 2017 World
 * Championships is category 1, the 2012 Asian Championships category 3 — and
 * that rule would put a notch on half the majors and call an Asian
 * Championships a Grand Prix Gold.
 */
export function translatedFrom(cat, era) {
  if (era === 'ss') return MODERN_TIERS.has(String(cat)) ? levelLabel(cat) : null;
  return mappedTier(cat) != null ? levelLabel(cat) : null;
}

/** Below Super 100: the feeder circuit. */
const BELOW_GRID = new Set([5, 6, 7]);

/**
 * A tournament every one of whose draws is a team tie.
 *
 * The category ids only name the team events this project has mapped — 17 and
 * 21 — and the unmapped era is full of others: the Suhandinata Cup, the Asia
 * Mixed Team Championships, the Asian Games team event. They are recognisable
 * without the id, because BWF names a tie's draws bare "Singles"/"Doubles" with
 * no gender: the tie is the competitor, so `canonicalDraw` returns null and
 * `kindOf` says "team". That is a fact in the payload rather than a guess from
 * a name.
 */
function isTeamTournament(tmt) {
  if (isTeamEvent(tmt && tmt.cat)) return true;
  const draws = (tmt && tmt.draws) || [];
  return draws.length > 0 && draws.every(d => kindOf(d.name) === 'team');
}

/**
 * The junior circuit, which no reading of "Super 100 and above" includes.
 *
 * Again the ids do not say so — 10, 13, 33 and 35 are all junior and all
 * unmapped — but the payload does, twice over: the tournament is named for it
 * ("World Junior Championships", "Dutch Junior", "Asia Youth U19") and the draws
 * carry the age band ("BS U19"). Either is enough.
 */
const JUNIOR = /\b(junior|youth|u1[3-9]|u2[01]|under[\s-]*1[3-9])\b/i;

function isJunior(tmt) {
  if (JUNIOR.test(String((tmt && tmt.name) || ''))) return true;
  return ((tmt && tmt.draws) || []).some(d => JUNIOR.test(String(d.raw || '')));
}

/**
 * The three majors, recognised by name where the category id cannot be trusted.
 *
 * This is the pre-2019 id gap (Part 7) showing up where it does the most damage.
 * The 2017 World Championships is category **1**, the 2012 and 2010 Asian
 * Championships are **1** and **3**, and the 2017 Dubai World Superseries Finals
 * is **8** — so without this a 2017 Worlds result lands in the unmapped section
 * at the far right, and the one section that should hold exactly one cell every
 * year holds none.
 *
 * Narrow on purpose, and applied only after the junior and team exclusions —
 * "BWF World Junior Championships" is category 20, the senior id, and must not
 * come through here. It moves nothing but which section a result lands in: the
 * strip keeps weighting by the id it was given, which is the honest thing for a
 * size to do.
 */
const MAJOR_BY_NAME = [
  [/\bworld\s+championships?\b/i, 20],
  [/\b(world\s+tour|world\s+super\s?series|super\s?series)\s+finals\b/i, 22],
  [/\b(asian?|europ(e|ean)|africa[n]?|oceania|americas?|pan\s?americ\w*)\s+championships?\b/i, 11],
];

/**
 * The grid section a tournament belongs to, or null if it does not belong in the
 * grid at all.
 *
 * Super 100 and above (settled 22 Aug 2026). Below that, an event is rarely the
 * same standard twice — the feeder circuit reshuffles year to year — and a
 * Future Series title sorted next to a Super 1000 title would read as the same
 * result. Team events are out for the older reason: they carry no individual
 * position, so a team cell is a blank. The junior circuit is out because it is
 * not the same sport being measured.
 *
 * Takes the whole tournament rather than its category because the category is
 * exactly what cannot be trusted here: the ids from before 2018 are unmapped,
 * and among them are team events and junior events that would otherwise be waved
 * through into the grid.
 *
 * The rest of the unmapped ids — the Superseries, Premier and Grand Prix era —
 * are kept together as one 'OTHER' section on the end rather than dropped. They
 * *are* Super-100-and-above events under earlier names, and dropping them would
 * silently blank the first half of a long career. Putting them last, in one
 * section with one toggle, says plainly that their placing is a guess.
 */
export function gridGroup(tmt) {
  const cat = tmt && tmt.cat;
  if (cat == null || cat === '') return null;
  if (isTeamTournament(tmt) || isJunior(tmt)) return null;

  const g = cat === 'OLY' ? 'OLY' : Number(cat);
  if (GRID_ORDER.includes(g)) return g;

  const name = String(tmt.name || '');
  /* ⚠️ The name rescues run **before** the era mapping, because an old category
     id is not always one tier. Category 8 is Superseries Premier *and* the
     Dubai World Superseries Finals; category 3 is Grand Prix Gold *and* some
     Continental Championships. Mapping first put the 2017 season-ending Finals
     in the Super 1000 block — the id was right and the tournament was not. */
  for (const [re, group] of MAJOR_BY_NAME) if (re.test(name)) return group;

  // A Superseries Premier is drawn where a Super 1000 is drawn. The strip still
  // calls it what it was; only the comparison views translate.
  const mapped = mappedTier(g);
  if (mapped != null) return mapped;

  if (BELOW_GRID.has(g)) return null;
  return 'OTHER';
}

/* The one row whose era name is not simply its category's label. The Tour
   Finals is the same rung and the same event under both structures and was
   called something else; everything else on the era ladder *is* a pre-2018
   category id, and `LEVEL` already names it. */
const ERA_LABEL = new Map([['22', 'Superseries Finals']]);
const ERA_CODE = new Map([['22', 'SSF']]);

/* ⚠️ The honours board's label gutter is 84px of 10px mono — fourteen
   characters. Every World Tour name fits it ("Continental" and "Tour Finals"
   are the longest at eleven); the era names do not, and "Superseries Premier"
   arrived on screen as "Superseries Pr", which reads as a bug rather than as an
   abbreviation. Only the three that overflow are shortened, and the full name
   stays on the row's tooltip. */
const SHORT = new Map([['8', 'SS Premier'], ['3', 'GP Gold']]);

/* The Tour Finals is the one that only overflows once it has been *renamed*:
   'Tour Finals' fits and 'Superseries Finals' does not, so unlike the two above
   this one is conditional on the era. */
const ERA_SHORT = new Map([['22', 'SS Finals']]);

/**
 * The level as it fits in the honours board's gutter: the full name wherever it
 * does fit, which is everywhere in World Tour names.
 *
 * ⚠️ Total for every group in either era, not only for the combinations that
 * arise — 8 and 3 are era ids and are shortened whichever era is asked for,
 * because a function that is right only where it happens to be called is a trap
 * for the next reader.
 */
export function gridGroupShort(group, era) {
  if (era === 'ss' && ERA_SHORT.has(String(group))) return ERA_SHORT.get(String(group));
  if (SHORT.has(String(group))) return SHORT.get(String(group));
  return gridGroupLabel(group, era);
}

export function gridGroupLabel(group, era) {
  if (era === 'ss' && ERA_LABEL.has(String(group))) return ERA_LABEL.get(String(group));
  return group === 'OTHER' ? 'Unmapped' : levelLabel(group);
}

/**
 * The section as it fits above a single narrow column.
 *
 * The band over the grid is the only text there is, and several sections —
 * Olympics, Worlds, Continental — are one slot wide by construction, so the
 * ordinary labels clipped to "WO" and "CO", which reads as a bug rather than as
 * an abbreviation. Three characters is what fits at the smallest zoom, so three
 * characters is what they get; the full name is on the tooltip.
 */
const GRID_CODE = {
  OLY: 'OLY', 20: 'WCH', 22: 'WTF', 11: 'CON',
  23: 'S1000', 24: 'S750', 25: 'S500', 26: 'S300', 27: 'S100',
  // The Superseries-era ladder, under its own ids.
  8: 'SSP', 2: 'SS', 3: 'GPG', 4: 'GP',
  OTHER: 'OTH',
};

export function gridGroupCode(group, era) {
  if (era === 'ss' && ERA_CODE.has(String(group))) return ERA_CODE.get(String(group));
  return GRID_CODE[group] || String(group == null ? '' : group);
}

/**
 * How far a result got, as a number that sorts best-first.
 *
 * Steps from the final for anything on the ladder — 0 is the champion — and then
 * the results with no rung on it, in the order they deserve: out in the group
 * stage, out in qualifying, a placing we do not recognise, no individual placing
 * at all. The gaps in the numbering keep those clear of the ladder, where a
 * round of 128 is 7.
 */
const OFF_LADDER = { r1: 10, q: 20, unk: 30, na: 40 };
const LAST = 90;

export function resultRank(info) {
  if (!info) return LAST;
  if (info.steps != null) return info.steps;
  return OFF_LADDER[info.tier] != null ? OFF_LADDER[info.tier] : LAST;
}

/**
 * The season a tournament belongs to, which is not always the year it was
 * played in.
 *
 * ⚠️ **The season-ending Finals belongs to the season it concludes.** COVID
 * pushed the 2020 edition to 27 January 2021, and BWF files it under
 * `tmtYear=2021` — so a player who competed in both it and the 2021 edition
 * that December has *two* Tour Finals in one row, which is a contradiction: the
 * Finals is the one event there is exactly one of per season. The fix is
 * BWF's own name, which still says which edition it is:
 * "HSBC BWF World Tour Finals 2020 (New Dates)".
 *
 * ⚠️ Deliberately **not** a general "the year in the name wins" rule. Three
 * other events in the recorded data carry an earlier year than the date they
 * were played on — the Tokyo 2020 Olympics (July 2021) and both halves of the
 * 2022 Asian Games (September 2023) — and those should stay where they were
 * played. The difference is not that BWF marked two of them "(New Dates)",
 * which it did inconsistently; it is that the Finals is *retrospective*. It is
 * the final of a season already played, contested by the players that season's
 * results qualified. An Olympics is not the conclusion of anything, and saying
 * a player competed at the Olympics in 2020 would be false.
 */
export function tournamentSeason(tmt) {
  const start = Number(String((tmt && tmt.start) || '').slice(0, 4)) || null;
  if (gridGroup(tmt) !== 22) return start;

  const years = (String((tmt && tmt.name) || '').match(/\b(?:19|20)\d{2}\b/g) || []).map(Number);
  if (!years.length) return start;
  // The last year in the name: "Dubai World Superseries Finals 2017" has one,
  // and a name that ever carries two would mean the edition, not the venue.
  const edition = years[years.length - 1];
  // Only ever backwards. A qualifier played in December for next year's event
  // — "2024 European … Championships Qualification" ran in 2023 — was still
  // played in the season it was played in.
  return start && edition < start ? edition : start;
}

/**
 * One season's results, bucketed by section and sorted best-first inside each.
 *
 * Only results in the chosen discipline. A tournament the player entered in some
 * *other* discipline is not a result here and takes no slot — under the old
 * tournament-per-column layout it needed a state of its own, because the column
 * existed either way; here the question does not arise.
 *
 * Ties are broken by date, oldest first, so a row is stable from render to
 * render rather than reshuffling itself when nothing has changed.
 */
export function seasonResults(season, kind, preferred, era) {
  const by = new Map();

  for (const tmt of (season && season.tournaments) || []) {
    const modern = gridGroup(tmt);
    if (modern == null) continue;
    const group = eraGroup(modern, era);
    const draw = drawForKind(tmt, kind, preferred);
    if (!draw) continue;
    const info = positionInfo(draw.position, draw);
    // `from` is the tier this actually was, on the results the chosen era had to
    // translate to get here. Null on everything already in its own vocabulary —
    // which is the pre-2018 half of a career in Superseries mode.
    const from = translatedFrom(tmt.cat, era);
    const cell = { group, tmt, draw, info, tier: info.tier, from,
      rank: resultRank(info) };
    const list = by.get(group);
    if (list) list.push(cell); else by.set(group, [cell]);
  }

  for (const list of by.values()) {
    list.sort((a, b) => a.rank - b.rank
      || (String(a.tmt.start) < String(b.tmt.start) ? -1
        : String(a.tmt.start) > String(b.tmt.start) ? 1 : 0));
  }
  return by;
}

/**
 * The sections to draw, in order, with the width each needs.
 *
 * A section is **as wide as the most results anyone put in it in any one
 * season**. That is the narrowest the grid can be while still fitting every row,
 * and it is derived rather than declared — which is just as well, because the
 * declared answer moves: four Super 1000s in 2026, five in 2027, and five in
 * 2021 because that January ran two Super 1000 Thailand Opens back to back in
 * the Bangkok bubble.
 *
 * ⚠️ The consequence is that a level a player never fills completely is never
 * drawn at full width. Somebody who plays three of the four Super 1000s every
 * year gets a three-slot section, and the fourth is invisible rather than empty.
 * Fixing that means asking BWF what the calendar held — see Part 7.
 *
 * Takes every career that will be drawn, because two grids side by side are only
 * comparable if their sections are the same width.
 */
export function gridSections(rowsPerCareer, era) {
  const width = new Map();
  for (const rows of rowsPerCareer || []) {
    for (const by of rows || []) {
      for (const [group, list] of by) {
        width.set(group, Math.max(width.get(group) || 0, list.length));
      }
    }
  }
  return gridOrder(era).filter(g => width.has(g))
    .map(g => ({ group: g, n: width.get(g),
      label: gridGroupLabel(g, era), code: gridGroupCode(g, era) }));
}

/**
 * One row of cells: every section's slots in order, padded on the right.
 *
 * `first` marks the opening slot of each section — the only place the grid draws
 * a line. Everywhere else the cells butt together, so a run of the same result
 * reads as one shape.
 */
export function sectionCells(by, sections) {
  const out = [];
  for (const section of sections || []) {
    const list = (by && by.get(section.group)) || [];
    for (let slot = 0; slot < section.n; slot++) {
      const cell = list[slot];
      out.push(cell
        ? { ...cell, section, slot, first: slot === 0 }
        : {
          section, slot, first: slot === 0, group: section.group,
          tmt: null, draw: null, info: null, tier: 'off', rank: LAST,
        });
    }
  }
  return out;
}

/**
 * A whole career as grid rows, newest first.
 *
 * Regroups every tournament by the season it *belongs* to rather than by the
 * `tmtYear` BWF returned it under, which is what moves the delayed 2020 Finals
 * out of the 2021 row. Done over the career as a whole, not season by season,
 * because a tournament can move between rows and one of those rows may not
 * exist yet — or at all.
 */
export function careerRows(seasons, kind, preferred, era) {
  const byYear = new Map();
  for (const s of seasons || []) {
    for (const t of s.tournaments || []) {
      const year = tournamentSeason(t) || s.year;
      const list = byYear.get(year);
      if (list) list.push(t); else byYear.set(year, [t]);
    }
  }
  return [...byYear.keys()].sort((a, b) => b - a).map(year =>
    ({ year, by: seasonResults({ year, tournaments: byYear.get(year) }, kind, preferred, era) }));
}

/**
 * The years a set of careers covers, most recent first, with no gaps in the
 * middle.
 *
 * Takes the bucketed rows rather than the raw seasons, so it counts only years
 * that put something *in the grid*. A player whose first recorded year is a
 * junior season would otherwise open with a row that is blank by construction —
 * every tournament in it was excluded — which reads as a year they did not play
 * rather than a year the grid does not cover.
 */
export function gridYears(rowsPerCareer) {
  const years = new Set();
  for (const rows of rowsPerCareer || []) {
    for (const row of rows || []) if (row.by && row.by.size) years.add(row.year);
  }
  if (!years.size) return [];
  const lo = Math.min(...years), hi = Math.max(...years);
  // Every year between the first and the last, not only the ones with results: a
  // season somebody missed entirely is a fact about the career and should be an
  // empty row, not a row that is not there.
  const out = [];
  for (let y = hi; y >= lo; y--) out.push(y);
  return out;
}

/* ============================ the honours board ============================

   The third view, and the only one that is not organised by season.

   The strip asks "what did this year look like", and the grid asks "what did
   their seasons look like". Both are answers to a question about *time*, and
   both spend most of their area saying that somebody went out in the early
   rounds — which is true, and is most of any career, and is not what anybody
   means when they ask how good a player was.

   This asks the other question: what have they actually done. One row per
   level, every result that cleared a bar, nothing else drawn at all. A career
   collapses to a shape you can hold in your eye, and two of them can be laid
   against each other.

   Two things carry the meaning, and neither of them is position in a row:

   - **Height.** Which row a square is in says what it was worth. The rows are
     the same order as the grid's sections, hardest at the top.
   - **Size.** A row's squares are φ times the *area* of the row below, so the
     ladder is geometric rather than a list. An Olympic gold is not one more
     title; it is worth a great deal more than even a World Championship, and
     the picture should say so without being read.

   ⚠️ φ is applied to **area, not to side**. Ten levels at φ per side is a
   ratio of φ⁹ ≈ 76 between the top row and the bottom, which is not a
   drawing, it is one square and some dust. Per area the side ratio is
   √φ ≈ 1.272 and the range is 8.4, which fits on a screen and still reads as
   a step change at every rung. Area is also the right dimension on its own
   merits: it is what the eye totals up when it judges a block, and worth is
   what the ratio is trying to express.
   ==================================================================== */

/**
 * The bar a result has to clear to be drawn, hardest last.
 *
 * `rank` is compared against `resultRank`, so these are steps from the final
 * and the off-ladder results — a group-stage exit, a qualifying loss — are
 * excluded by arithmetic rather than by a special case.
 */
export const HONOUR_STEPS = [
  { key: 'qf', label: 'QF+', full: 'quarter-final or better', rank: 3 },
  { key: 'sf', label: 'SF+', full: 'semi-final or better',    rank: 2 },
  { key: 'f',  label: 'F+',  full: 'final or better',         rank: 1 },
  { key: 'w',  label: 'W',   full: 'titles only',             rank: 0 },
];

/* The semi-finals. High enough that the board is a list of achievements rather
   than a list of appearances — a quarter-final at a Super 300 is a fortnight's
   work, not an honour — and low enough that a good career still has a shape at
   every level rather than three green squares and eight empty rows. */
export const HONOUR_DEFAULT = 'sf';

export function honourStep(key) {
  return HONOUR_STEPS.find(s => s.key === key)
    || HONOUR_STEPS.find(s => s.key === HONOUR_DEFAULT);
}

export const PHI = (1 + Math.sqrt(5)) / 2;

/* One row up multiplies the *area* by φ, so the side goes up by √φ. See the
   warning above for why this is not φ itself. */
const HONOUR_SIDE_RATIO = Math.sqrt(PHI);

/**
 * Levels that take no rung of their own, and the level whose rung they share.
 *
 * Names its partner rather than meaning "the one above me in `GRID_ORDER`", so
 * that where a level is *listed* and what it is *worth* stay independent. The
 * Continentals are listed above the Super 1000s and sized with them; under the
 * positional rule they would have silently inherited the Tour Finals instead.
 *
 * ⚠️ **The Continental Championships are a peer of the Super 1000, not a step
 * below the Super 750.** Two reasons, and the second is the one that bites:
 *
 * 1. It is what this project already decided. Part 2.2 settled the
 *    Continentals at full weight — "an Asian Championships title is a major" —
 *    and a ladder that ranks them under a Super 750 contradicts the strip.
 * 2. A rung of their own **breaks the Super ladder**. With Continental sitting
 *    between them, Super 1000 → Super 750 was one step and Super 750 → Super
 *    500 was two, so the official five-rung ladder came out unevenly spaced for
 *    a reason that had nothing to do with the Super events. Sharing a rung puts
 *    Super 1000/750/500/300/100 back on five consecutive steps, and listing the
 *    Continentals *above* the Super 1000 leaves the five as an unbroken run of
 *    rows as well as an unbroken run of sizes.
 *
 * Sharing rather than promoting is deliberate. A Continental title is not
 * uniform — the Asian Championships is arguably harder than any Super 1000 and
 * the Oceania one is not — so "about a Super 1000, and we are not going to
 * pretend to know better continent by continent" is the honest claim. Ranking
 * it *above* the Super 1000 would be asserting something about Europe that is
 * not true.
 */
/* ⚠️ The Superseries-era tiers share the rung of the modern tier they are drawn
   over, rather than being handed a ladder of their own. That is what keeps the
   *sizes* identical in both eras: switching vocabulary must not resize an
   Olympic square, or the two readings could not be held against each other at
   all. It also leaves the Super 500's rung simply unused in Superseries mode,
   so the extra size step between Superseries and Grand Prix Gold is drawn
   rather than closed up — which is honest, because that gap was real. */
const SHARES_RUNG = new Map([[11, 23], [8, 23], [2, 24], [3, 26], [4, 27]]);

/* Derived from GRID_ORDER and the map above, never written out. A level added
   to the order gets its own rung automatically, and the two cannot drift.

   Two passes, because a sharer can be listed either side of its partner: the
   rungs are handed out to the levels that earn one, in order, and the sharers
   are then given their partner's. That is also what keeps the five Super levels
   on five consecutive rungs — the Continentals take no rung out of the run
   however they are ordered against it. */
const RUNGS = (() => {
  const rung = new Map();
  let r = -1;
  for (const g of GRID_ORDER) {
    if (SHARES_RUNG.has(g)) continue;
    rung.set(String(g), ++r);
  }
  for (const [g, peer] of SHARES_RUNG) {
    const shared = rung.get(String(peer));
    if (shared != null) rung.set(String(g), shared);
  }
  return { rung, last: Math.max(r, 0) };
})();

/**
 * Which rung of the size ladder a level sits on, counting from the top.
 *
 * Not the same as its place in `GRID_ORDER`: rows are ordered one way and sized
 * another, because two levels can be worth the same without being the same
 * thing.
 */
export function honourRung(group) {
  // Compared as strings: the level ids are numbers in `GRID_ORDER` but they
  // make a round trip through `data-group` on the way back from the DOM, and a
  // lookup silently missing would put a Super 1000 row at the size of the
  // bottom rung rather than failing.
  const r = RUNGS.rung.get(String(group));
  return r == null ? RUNGS.last : r;
}

/**
 * How many times the base size a row's squares are, as a bare number.
 *
 * Unitless on purpose: the app hands it to CSS as `--k` and the zoom slider
 * moves the base underneath it, so changing the size of everything is one
 * custom property and no re-render.
 *
 * Keyed on the level's rung rather than on which rows happen to be on screen,
 * so switching a level off does not resize the ones left behind — a square
 * means the same thing whatever else is showing, which is the whole basis for
 * comparing two boards.
 */
export function honourScale(group) {
  return Math.pow(HONOUR_SIDE_RATIO, RUNGS.last - honourRung(group));
}

/**
 * A whole career as honours: every result at or above the bar, by level.
 *
 * Takes the rows the grid already built, so the Finals reattribution and the
 * junior/team exclusions are settled in one place and cannot disagree between
 * the two views.
 *
 * `entries` counts everything at that level whatever it scored, which is what
 * separates the two ways a row can be empty. "Never won a match that mattered
 * at Super 750" and "never played a Super 750" look identical on a board that
 * only draws what cleared the bar, and they are not remotely the same claim.
 */
export function careerHonours(rows, maxRank) {
  const by = new Map();
  const entries = new Map();

  for (const row of rows || []) {
    for (const [group, list] of (row.by || new Map())) {
      entries.set(group, (entries.get(group) || 0) + list.length);
      for (const cell of list) {
        if (cell.rank > maxRank) continue;
        const kept = { ...cell, year: row.year };
        const bucket = by.get(group);
        if (bucket) bucket.push(kept); else by.set(group, [kept]);
      }
    }
  }

  // Best first, then oldest first — the same tie-break as a grid row, so a
  // board is stable from render to render.
  for (const list of by.values()) {
    list.sort((a, b) => a.rank - b.rank
      || (String(a.tmt.start) < String(b.tmt.start) ? -1
        : String(a.tmt.start) > String(b.tmt.start) ? 1 : 0));
  }
  return { by, entries };
}

/**
 * The rows to draw, hardest first.
 *
 * A level appears if anyone on screen ever *entered* it, not if they placed in
 * it — an empty Super 1000 row is a fact about a career and one of the more
 * eloquent ones. Levels nobody has ever played are left out entirely, because
 * that is a fact about the calendar instead.
 */
export function honourSections(perCareer, era) {
  const present = new Set();
  const most = new Map();
  for (const h of perCareer || []) {
    for (const [group, n] of (h.entries || new Map())) {
      if (n > 0) present.add(group);
    }
    for (const [group, list] of (h.by || new Map())) {
      most.set(group, Math.max(most.get(group) || 0, list.length));
    }
  }
  return gridOrder(era).filter(g => present.has(g)).map(g => ({
    group: g,
    label: gridGroupLabel(g, era),
    // What the gutter shows; `label` is what the tooltip says. The same in
    // World Tour names, where every level's name already fits.
    short: gridGroupShort(g, era),
    code: gridGroupCode(g, era),
    n: most.get(g) || 0,
    scale: honourScale(g),
  }));
}

/* ============================ the tournament now ============================

   The third page: whatever tournament is on, and its order of play, without
   anybody having to pick one.

   `vue-tmt-schedule` hands back three tournaments — the one with live scores,
   the one before it, the one after — each with BWF's own label ("Live Scores!",
   "View Results", "View Draws"). Everything below turns those into "which one
   should be on screen, and which day of it".

   ⚠️ **Today is a parameter, never `new Date()`.** Everything here is decided
   by comparing dates, and a function that reads the clock itself cannot be
   tested against a recorded fixture: the fixture pins August 2026 and the clock
   does not. The app passes the real date in one place.
   ==================================================================== */

/** The date part of any of BWF's timestamps, which are `YYYY-MM-DD HH:MM:SS`. */
export function dayOf(when) {
  const s = String(when || '');
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** Days are compared as strings — ISO dates sort correctly and never drift. */
const within = (day, from, to) => !!(day && from && to && day >= from && day <= to);

/**
 * Which tournament to show, and what state it is in.
 *
 * Preference is live, then whichever of the upcoming pair starts soonest, then
 * the one that just finished. `nextLive` and `nextTmt` are usually the same
 * event but need not be: `nextLive` is the next one with **live scores**, which
 * can be further out than the next one on the calendar.
 *
 * @param {object} schedule  the `vue-tmt-schedule` payload
 * @param {string} today     `YYYY-MM-DD`
 * @returns {{tmt: object, state: 'live'|'upcoming'|'finished'}|null}
 */
export function pickTournament(schedule, today) {
  const s = schedule || {};
  const at = t => (t ? { from: dayOf(t.start_date), to: dayOf(t.end_date) } : null);

  for (const t of [s.nextLive, s.nextTmt, s.previousTmt]) {
    const d = at(t);
    if (d && within(today, d.from, d.to)) return { tmt: t, state: 'live' };
  }

  /* All three slots, not just the two named "next". `previousTmt` is normally
     in the past, but nothing in the payload promises that — and a fixture
     replayed at an earlier pinned date puts a future tournament there, which
     the first version silently skipped. Comparing three is no more work than
     comparing two and makes the function total over any payload. */
  const soonest = [s.nextLive, s.nextTmt, s.previousTmt]
    .filter(t => t && dayOf(t.start_date) && dayOf(t.start_date) > today)
    .sort((a, b) => {
      const x = dayOf(a.start_date), y = dayOf(b.start_date);
      // 0 for equal, so two events starting the same day keep the payload's own
      // order — which puts the one with live scores first.
      return x < y ? -1 : x > y ? 1 : 0;
    })[0];
  if (soonest) return { tmt: soonest, state: 'upcoming' };

  if (s.previousTmt) return { tmt: s.previousTmt, state: 'finished' };
  // Nothing live and nothing ahead: whatever there is beats an empty page.
  const any = [s.nextLive, s.nextTmt].find(Boolean);
  return any ? { tmt: any, state: 'finished' } : null;
}

/** Every day of a tournament, first to last. */
export function tournamentDays(tmt) {
  const from = dayOf(tmt && tmt.start_date);
  const to = dayOf(tmt && tmt.end_date);
  if (!from || !to || to < from) return from ? [from] : [];
  const out = [];
  // Stepped in UTC so a local daylight-saving jump cannot skip or repeat a day.
  for (let t = Date.parse(from + 'T00:00:00Z'); ; t += 86400000) {
    const day = new Date(t).toISOString().slice(0, 10);
    out.push(day);
    if (day >= to || out.length > 60) break;
  }
  return out;
}

/**
 * Which day to open on: today if the tournament is on, otherwise the day with
 * something to show — the last one for a tournament that has finished, the
 * first for one that has not started.
 */
export function defaultDay(tmt, state, today) {
  const days = tournamentDays(tmt);
  if (!days.length) return null;
  if (days.includes(today)) return today;
  return state === 'upcoming' ? days[0] : days[days.length - 1];
}

/* ---------- one match ---------- */

const SIDE_KEYS = ['team1', 'team2'];

function side(team, seed) {
  const t = team || {};
  return {
    country: t.countryCode || '',
    flag: t.countryFlagUrl || '',
    seed: seed == null || seed === '' ? null : String(seed),
    players: ((t.players || []).map(p => ({
      id: p.id != null ? String(p.id) : null,
      name: p.nameDisplay || [p.firstName, p.lastName].filter(Boolean).join(' '),
    }))).filter(p => p.name),
  };
}

/* ⚠️ Not every finished match has a score. `scoreStatus` is 0 Normal,
   1 **Walkover**, 2 **Retired**: a walkover has no games at all and a
   retirement has however many were played. Both were on court at the 2026
   Worlds inside a single day, so this is ordinary rather than exotic — and
   without a word for it a walkover draws as a finished match with a blank
   scoreline, which reads as a bug in the app rather than a fact about the
   match.

   The mark belongs to the side it *happened to* — whoever retired, or did not
   come out at all — which is the side that lost. */
const SCORE_NOTE = {
  1: { short: 'W/O', long: 'Walkover' },
  2: { short: 'RET', long: 'Retired' },
};

/** "2026-08-19 13:00:00" -> "13:00". */
function clockOf(when) {
  const m = String(when || '').match(/\b(\d{2}:\d{2})/);
  return m ? m[1] : '';
}

/**
 * A match, normalised.
 *
 * ⚠️ Status comes from BWF's **single-letter `matchStatus`**, not from
 * `matchStatusValue`. `F` is finished and `O` is "off court" — played out but
 * not yet signed off, arriving with a winner and a full score, so reading it as
 * unplayed puts "Scheduled" on a finished match. `L` and `P` are being played.
 *
 * Confirmed against a live match on 23 August 2026 — the World Championships
 * women's singles final, caught at 8–7 in the first game: `matchStatus: "P"`
 * with `matchStatusValue: "In Progress"`. **Not "Live".** A guess at the
 * long-form spelling would have been wrong for exactly the week it mattered,
 * which is the whole reason the letter is what gets read.
 *
 * Each side carries **its own games**, because that is how a scoreboard is
 * read: a row of numbers beside the name with the winner's game picked out. One
 * joined scoreline cannot say who won which game without the reader doing the
 * arithmetic.
 */
export function parseMatch(m) {
  const raw = m || {};
  const games = (raw.score || [])
    .filter(g => g && (g.home != null || g.away != null))
    .map(g => ({ a: Number(g.home) || 0, b: Number(g.away) || 0 }));
  const winner = Number(raw.winner) || 0;

  const letter = String(raw.matchStatus || '').toUpperCase();
  const done = letter === 'F' || letter === 'O' || winner > 0;
  const playing = !done && (letter === 'L' || letter === 'P' || games.length > 0);

  const known = SCORE_NOTE[Number(raw.scoreStatus)];
  // BWF's own wording where it ships it, so the page agrees with the official
  // result rather than paraphrasing it.
  const note = known
    ? { short: known.short, long: raw.scoreStatusValue || known.long }
    : null;

  const sides = SIDE_KEYS.map((k, i) => {
    const which = i + 1;
    return Object.assign(side(raw[k], raw['team' + which + 'seed']), {
      games: games.map(g => {
        const own = which === 1 ? g.a : g.b;
        const opp = which === 1 ? g.b : g.a;
        return { own, opp, won: own > opp };
      }),
      won: winner === which,
      lost: winner > 0 && winner !== which,
    });
  });

  // BWF's own words for when a match starts: "Starting at 1:00 PM" on the first
  // of a court, "Followed by" on every one after it. Only the first has a real
  // time — the rest are flat 50-minute estimates that on some courts run
  // backwards (Part 4.7), so they are marked rather than stated as fact.
  const oop = raw.oopText || '';

  return {
    id: raw.id != null ? String(raw.id) : '',
    draw: raw.drawName || raw.eventName || '',
    round: raw.roundName || '',
    court: raw.courtName || '',
    courtCode: raw.courtCode != null ? String(raw.courtCode) : '',
    /** Position on court: 1 is first on, 2 follows it. The grid's y-axis. */
    seq: Number(raw.oopRound) || null,
    oop,
    time: clockOf(raw.matchTime),
    /* The venue clock is what BWF prints on the order of play, and it is the
       one that matters at the arena. `utc` is what lets the page also say what
       that is where the reader is sitting, which is the whole question when the
       tournament is eight time zones away. */
    utc: raw.matchTimeUtc || '',
    estimated: !!oop && !/^\s*starting/i.test(oop),
    sides,
    winner,
    status: done ? 'finished' : playing ? 'live' : 'upcoming',
    statusWord: done ? (note ? note.long : 'Finished')
      : playing ? 'Live'
      : raw.matchTime ? 'Scheduled' : 'Not scheduled',
    games,
    note,
    duration: Number(raw.duration) || null,
  };
}

/**
 * `day-matches` is a plain array, already in the order of play.
 *
 * `day` is tagged on rather than read back out of `matchTime`, because a match
 * whose time is not published yet still belongs to the day it was asked for —
 * and once several days are on screen at once, which day a card belongs to is
 * the thing grouping them.
 */
export function parseDayMatches(payload, day) {
  const rows = Array.isArray(payload) ? payload
    : (payload && Array.isArray(payload.results)) ? payload.results
    : (payload && typeof payload === 'object') ? Object.values(payload) : [];
  return rows.filter(r => r && typeof r === 'object' && r.team1)
    .map(r => Object.assign(parseMatch(r), day ? { day } : {}));
}

/**
 * What counts as a match having *moved*.
 *
 * Compared across a refresh so the page can mark what changed while you were
 * looking elsewhere. Deliberately only the things that make it news — the
 * score, the winner, whether it is under way. Not the court or the estimated
 * time, which BWF rewrites constantly through a day and which would light up
 * half the grid every minute for no reason.
 */
export function matchSignature(m) {
  if (!m) return '';
  return [m.winner, m.status, m.games.map(g => g.a + '-' + g.b).join(',')].join('|');
}

/** "2026-08-19" → "Wednesday 19 August". */
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function prettyDay(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return String(day || '');
  const d = new Date(day + 'T00:00:00Z');
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "Court 10" after "Court 2", not before it. */
export function courtOrder(name) {
  const n = parseInt(String(name == null ? '' : name).replace(/\D+/g, ''), 10);
  return Number.isFinite(n) ? n : 9999;
}

/**
 * The day laid out by court: one column per court, matches down it in the
 * order they will be played.
 *
 * ⚠️ The **array order is the order of play** and is preserved as given. Do not
 * sort on the times — Part 4.7.
 */
export function orderOfPlay(matches) {
  const by = new Map();
  for (const m of matches || []) {
    const key = m.court || '—';
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(m);
  }
  return [...by.entries()]
    .map(([court, list]) => ({ court, matches: list }))
    .sort((a, b) => courtOrder(a.court) - courtOrder(b.court));
}

/**
 * The day as a true grid: one column per court, one row per position on court.
 *
 * Row 3 means "third on this court" — which is both true and the way an order
 * of play is read — and it means two matches on the same row really are at the
 * same point in the day. Rows nothing occupies are skipped, so filtering to one
 * draw gives a dense grid rather than sixteen mostly-empty ones.
 *
 * Returns **null** when a grid would be a lie or a waste: if any match is
 * missing its court or its position then the order of play is not out yet, and
 * with a single court a grid is a list with extra machinery. The caller falls
 * back to a plain list.
 *
 * `cells` comes back in **row-major order** — down the day, then across — so a
 * narrow screen that drops the grid and simply stacks the cards still reads in
 * running order.
 */
export function courtGrid(matches) {
  const all = matches || [];
  const placed = all.filter(m => m.court && m.seq != null);
  if (!placed.length || placed.length !== all.length) return null;

  const courts = [...new Set(placed.map(m => m.court))]
    .sort((a, b) => courtOrder(a) - courtOrder(b));
  if (courts.length < 2) return null;

  const rows = [...new Set(placed.map(m => m.seq))].sort((a, b) => a - b);
  const col = new Map(courts.map((c, i) => [c, i + 1]));
  const row = new Map(rows.map((q, i) => [q, i + 2]));   // row 1 is the court header

  return {
    courts,
    rows,
    cells: placed.slice()
      .sort((a, b) => (a.seq - b.seq) || (col.get(a.court) - col.get(b.court)))
      .map(m => ({ match: m, col: col.get(m.court), row: row.get(m.seq) })),
  };
}

/* ============================ the winners' pyramid ============================

   One season's most important titles, stacked: the base is the widest tier and
   the summit is the single greatest one. Sizes come from `honourScale`, so a
   Super 1000 square is the same size here as on the honours board.

   ⚠️ **The Olympics and the World Championships share a row.** Every season has
   one or the other and never neither, so they are the same rung of the calendar
   even though they are not the same prize — the Olympic square is drawn larger.
   (2021 held both: Tokyo was postponed into the same year as the Huelva Worlds.
   The row simply holds two that year, which is why it is a row and not a slot.)

   ⚠️ **No team events, and no regional multi-sport games.** Team events would
   rank a player by the country they were born in. The Asian Games, the
   Commonwealth Games and the European Games would each do the same thing more
   quietly: every one of them is closed to most of the world, so including any
   one of them picks a region. They are in the data and deliberately left out.
   ==================================================================== */

export const PYRAMID_ROWS = [
  { key: 'major',  label: 'Olympics · Worlds', tiers: ['OLY', 20] },
  { key: 'finals', label: 'Tour Finals',       tiers: [22] },
  { key: 's1000',  label: 'Super 1000',        tiers: [23] },
  { key: 's750',   label: 'Super 750',         tiers: [24] },
];

/** Which pyramid row a tier belongs to, or null if it is not on the pyramid. */
export function pyramidRow(tier) {
  const row = PYRAMID_ROWS.find(r => r.tiers.some(t => String(t) === String(tier)));
  return row ? row.key : null;
}

/* Anything junior, para, masters, student or invitational. These are real
   tournaments with real winners and they are not what this chart is about;
   without the reject list "BWF World Junior Championships" reads as the World
   Championships and "Youth Olympic Games" as the Olympics. */
const NOT_SENIOR = /junior|para[- ]|youth|university|student|masters cup|u1[13579]\b|senior championships|invitation/i;

/* A team event under any of its names. `category` says so in the modern era and
   does not in 2014, where the Asian Games team competition is called
   "17th Asian Games Incheon 2014" and the individual one "17th Asian Games
   2014" — the same event, one word apart. */
/* ⚠️ Not a bare `cup`: that was the first version, and it would reject any
   World Tour event that happens to be named one. The team cups are named. */
const TEAM = /\bteam\b|thomas|uber|sudirman/i;

/* ⚠️ Names before categories, for the same reason `gridGroup` does it: the
   category string is not a tier. "World Superseries Premier" holds both the
   Superseries Premier events *and* the Dubai Superseries Finals, and the 2017
   World Championships is filed under "BWF Events" with the continental
   championships and the club championships. */
const PYRAMID_BY_NAME = [
  /* ⚠️ The season-ending final has been called five things. "Dubai World
     Superseries Finals", "HSBC BWF World Tour Finals" — and, in 2008 and 2009,
     "World Super Series **Masters** Finals", which an exact phrase misses. It
     then falls through to the category, which says Superseries Premier, and the
     year's biggest title is quietly drawn as a Super 1000. Match the bracketing
     words with a bounded gap instead of listing the names. */
  [/(super\s*series|world\s*tour).{0,24}\bfinals\b/i, 22],
  [/olympic games/i, 'OLY'],
  [/\bworld championships?\b/i, 20],
];

/* The calendar's `category` is a display string, and it changed when the World
   Tour replaced the Superseries. Both eras land on the same rungs — the same
   mapping the grid already uses. */
const PYRAMID_BY_CATEGORY = [
  [/world tour finals/i, 22],
  [/super 1000/i, 23],
  [/super 750/i, 24],
  [/world superseries premier/i, 23],
  [/world superseries$/i, 24],
];

/**
 * Which rung of the pyramid a calendar entry sits on, or null.
 *
 * @param {{name: string, category: string}} entry  one `vue-grouped-year-tournaments` row
 */
export function pyramidTier(entry) {
  const name = String((entry && entry.name) || '');
  const cat = String((entry && entry.category) || '');
  if (!name) return null;
  if (NOT_SENIOR.test(name) || NOT_SENIOR.test(cat)) return null;
  if (TEAM.test(name) || /team/i.test(cat)) return null;

  for (const [re, tier] of PYRAMID_BY_NAME) if (re.test(name)) return tier;
  for (const [re, tier] of PYRAMID_BY_CATEGORY) if (re.test(cat)) return tier;
  return null;
}

/**
 * One season as rows, summit first.
 *
 * @param {Array<{tier, name, date, w}>} won  that season's titles
 * @param {object} players  id -> {n, c, a}
 * @returns {Array<{key, label, tiles}>} every row, including empty ones — a
 *   season that did not hold a Tour Finals should show a hole where it goes
 *   rather than closing the gap and pretending the pyramid is a shape it is not.
 */
export function pyramidSeason(won, players) {
  const all = won || [];
  return PYRAMID_ROWS.map(row => ({
    key: row.key,
    label: row.label,
    /* Carried even when the row is empty: a season that held no Tour Finals
       still has to be drawn the height a Tour Finals square would have been,
       and the only way to know that is to know the tier. */
    tiers: row.tiers,
    tiles: all
      .filter(t => pyramidRow(t.tier) === row.key)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .map(t => ({
        tier: t.tier,
        name: t.name,
        date: t.date,
        scale: honourScale(t.tier),
        who: (players || {})[String(t.w)] || null,
        id: t.w,
      })),
  }));
}

/** How wide a row is, in the same units the squares are sized in. */
export function pyramidRowWidth(row) {
  return (row.tiles || []).reduce((n, t) => n + t.scale, 0);
}

/**
 * Where a season's pyramid stops tapering.
 *
 * The calendar does not guarantee a pyramid: 2027 holds five Super 1000s and
 * five Super 750s, so the tier above the base is the wider of the two. That is
 * worth showing rather than hiding — it says the elite tier grew — but it is
 * also worth being able to point at.
 */
export function pyramidBulges(rows) {
  const out = [];
  for (let i = 0; i < rows.length - 1; i++) {
    /* ⚠️ Only rows holding more than one title are compared. A row with a single
       square is *always* wider than the single square below it — the Olympics
       outranks the Worlds, the Worlds outranks the Tour Finals — so comparing
       them flags almost every season and says nothing. The interesting bulge is
       the one the calendar causes: a tier with more events than the tier under
       it. */
    if (rows[i].tiles.length < 2 || rows[i + 1].tiles.length < 2) continue;
    const above = pyramidRowWidth(rows[i]);
    const below = pyramidRowWidth(rows[i + 1]);
    if (above > below) out.push({ above: rows[i].key, below: rows[i + 1].key });
  }
  return out;
}

/** The draws present on a day, in the usual MS/WS/MD/WD/XD order. */
const DRAW_ORDER = ['MS', 'WS', 'MD', 'WD', 'XD'];
export function drawsPresent(matches) {
  const seen = new Set((matches || []).map(m => m.draw).filter(Boolean));
  const known = DRAW_ORDER.filter(d => seen.has(d));
  const rest = [...seen].filter(d => !DRAW_ORDER.includes(d)).sort();
  return [...known, ...rest];
}

