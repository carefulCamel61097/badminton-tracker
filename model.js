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
};

/**
 * Chip order for the level filters: the majors, then the World Tour ladder,
 * then everything below it, then the team events last because they are off by
 * default. Not the numeric order of the ids, which is arbitrary.
 */
export const LEVEL_ORDER = ['OLY', 20, 22, 23, 24, 11, 25, 26, 27, 5, 6, 7, 21, 17];

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

export function shortTmtName(name) {
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
export const GRID_ORDER = ['OLY', 20, 22, 23, 24, 11, 25, 26, 27, 'OTHER'];

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
  for (const [re, group] of MAJOR_BY_NAME) if (re.test(name)) return group;

  if (BELOW_GRID.has(g)) return null;
  return 'OTHER';
}

export function gridGroupLabel(group) {
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
  OTHER: 'OTH',
};

export function gridGroupCode(group) {
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
export function seasonResults(season, kind, preferred) {
  const by = new Map();

  for (const tmt of (season && season.tournaments) || []) {
    const group = gridGroup(tmt);
    if (group == null) continue;
    const draw = drawForKind(tmt, kind, preferred);
    if (!draw) continue;
    const info = positionInfo(draw.position, draw);
    const cell = { group, tmt, draw, info, tier: info.tier, rank: resultRank(info) };
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
export function gridSections(rowsPerCareer) {
  const width = new Map();
  for (const rows of rowsPerCareer || []) {
    for (const by of rows || []) {
      for (const [group, list] of by) {
        width.set(group, Math.max(width.get(group) || 0, list.length));
      }
    }
  }
  return GRID_ORDER.filter(g => width.has(g))
    .map(g => ({ group: g, n: width.get(g), label: gridGroupLabel(g), code: gridGroupCode(g) }));
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
 * The years a set of careers covers, most recent first, with no gaps in the
 * middle.
 *
 * Counts only seasons that put something *in the grid*. A player whose first
 * recorded year is a junior season would otherwise open with a row that is blank
 * by construction — every tournament in it was excluded — which reads as a year
 * they did not play rather than a year the grid does not cover.
 */
export function gridYears(careers) {
  const years = new Set();
  for (const seasons of careers || []) {
    for (const s of seasons || []) {
      if ((s.tournaments || []).some(t => gridGroup(t) != null)) years.add(s.year);
    }
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
