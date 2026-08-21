/* The model, checked against real recorded payloads with no browser involved.
 *
 * Runs in about a second, which is the point: the maths that decides how big a
 * square is and how full it is should not need a 45-second Chrome launch to
 * verify. The end-to-end proof that the app actually reaches BWF and renders
 * this is test_season.mjs.
 *
 * Expectations here were read off the raw fixture by hand, not produced by the
 * parser under test.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  parseSeason, seasonDisciplines, drawFor, drawForKind, dominantDraw,
  kindOf, seasonKinds, defaultKind, seasonLevels,
  positionInfo, fillFraction, boxSize, boxScale, levelLabel, isTeamEvent,
  shortTmtName, surnameOf, levelAbbr, LEVEL, SLOT_W, BOX_H, MIN_LABEL_PX, LEVEL_ORDER,
} from '../model.js';
import { check, eq, near, report } from './check.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX_DIR = path.join(HERE, 'fixtures');
const API = 'https://extranet-lv.bwfbadminton.com/api';

/** Fixtures are keyed by a SHA-1 of the full URL, so ask for one the same way
    the app would and look it up rather than hardcoding a hash. */
function fixture(pathname, params) {
  const url = `${API}/${pathname}?${new URLSearchParams(params)}`;
  const key = crypto.createHash('sha1').update(url).digest('hex').slice(0, 20);
  const raw = JSON.parse(fs.readFileSync(path.join(FIX_DIR, key + '.json'), 'utf8'));
  const body = raw.base64Encoded ? Buffer.from(raw.body, 'base64').toString('utf8') : raw.body;
  return JSON.parse(body);
}

const byCat = (season, cat) => season.find(t => t.cat === cat);

const seasonParams = (playerId, tmtYear) =>
  ({ playerId, isPara: 0, drawCount: 1, activeTab: 0, tmtYear });

/* ============================ SHI Yu Qi, 2026 ============================

   Ten tournaments as recorded, newest first:
     2026-08-17  cat 20  MS R64 0-1   BWF World Championships
     2026-07-21  cat 23  MS QF  2-1   VICTOR China Open
     2026-07-14  cat 24  MS QF  2-1   DAIHATSU Japan Open
     2026-06-02  cat 23  MS R16 1-1   POLYTRON Indonesia Open
     2026-05-26  cat 24  MS R16 1-1   KFF Singapore Open
     2026-05-12  cat 25  MS 3rd 3-1   TOYOTA Thailand Open
     2026-04-24  cat 21  Singles N/A  BWF Thomas & Uber Cup Finals
     2026-04-07  cat 11  MS 1st 5-0   Badminton Asia Championships
     2026-03-03  cat 23  MS R32 0-1   All England Open
     2026-01-06  cat 23  MS 2nd 4-1   PETRONAS Malaysia Open
   ==================================================================== */

console.log('=== parse: SHI Yu Qi 2026 ===');
const raw = fixture('vue-player-tournaments', seasonParams(57945, 2026));
const season = parseSeason(raw);

eq('ten tournaments', season.length, 10);
eq('oldest first', season[0].start, '2026-01-06');
eq('newest last', season[9].start, '2026-08-17');
check('chronological throughout',
  season.every((t, i) => i === 0 || season[i - 1].start <= t.start),
  season.map(t => t.start).join(' '));

const malaysia = season[0];
eq('first is the Malaysia Open', malaysia.name, 'PETRONAS Malaysia Open 2026');
eq('sponsor dropped for the label', malaysia.short, 'Malaysia Open');
eq('level resolved from the category id', malaysia.level, 'Super 1000');
eq('tournament id kept for the drill-down', typeof malaysia.tournamentId, 'number');
check('links back to BWF', /bwfbadminton\.com/.test(malaysia.url), malaysia.url);

const ms = drawFor(malaysia, 'MS');
check('MS draw found', !!ms);
eq('position is a placing, not a round', ms.position, '2nd');
eq('wins carried through', ms.win, 4);

check('a discipline it did not enter returns null, not a fallback',
  drawFor(malaysia, 'WD') === null);

/* ============================ team events ============================ */

console.log('\n=== team events ===');
const team = season.find(t => t.cat === 21);
check('Thomas & Uber Cup is in the parse', !!team, team && team.name);
check('flagged as a team event', team.team === true);
eq('its draw carries no position', team.draws[0].position, 'N/A');
eq('name shortened', team.short, 'Thomas & Uber');
eq('excluded on request', parseSeason(raw, { includeTeam: false }).length, 9);
check('and it is the team one that goes',
  !parseSeason(raw, { includeTeam: false }).some(t => t.team));

/* ============================ disciplines ============================ */

console.log('\n=== disciplines ===');
const ds = seasonDisciplines(season);
eq('MS is the commonest draw', ds[0].name, 'MS');
eq('nine MS entries', ds[0].count, 9);
eq('classified as singles', ds[0].kind, 'singles');
check('a team tie is not offered as a discipline',
  !ds.filter(d => d.kind !== 'team').some(d => d.name === 'SINGLES'),
  JSON.stringify(ds));

/* ============================ singles or doubles ============================

   The only distinction the strip makes. Not partner: a doubles season belongs
   to the player and is shown whole, however many people they played with.
   ======================================================================== */

console.log('\n=== singles / doubles ===');
eq('MS is singles', kindOf('MS'), 'singles');
eq('WS too', kindOf('WS'), 'singles');
eq('MD is doubles', kindOf('MD'), 'doubles');
eq('and XD', kindOf('XD'), 'doubles');
eq('a team tie is neither', kindOf('Singles'), 'team');
eq('nor is nonsense', kindOf(''), 'team');

eq('a singles player gets one kind, so no toggle', seasonKinds(season).length, 1);
eq('opens on singles', defaultKind(season), 'singles');

const shiMS = drawForKind(byCat(season, 23), 'singles', 'MS');
check('the singles draw is found by kind', shiMS && shiMS.name === 'MS', shiMS && shiMS.name);
eq('and no doubles draw is invented',
  drawForKind(byCat(season, 23), 'doubles', 'MD'), null);

/* ============================ Delphine DELRUE, 2026 ============================ */

console.log('\n=== a doubles season ===');
const delrue = parseSeason(fixture('vue-player-tournaments', seasonParams(70762, 2026)));
eq('opens on doubles', defaultKind(delrue), 'doubles');
eq('her doubles draw is XD', dominantDraw(delrue, 'doubles'), 'XD');
check('every doubles tournament is shown, whoever the partner was',
  delrue.filter(t => drawForKind(t, 'doubles', 'XD')).length >= 10,
  String(delrue.filter(t => drawForKind(t, 'doubles', 'XD')).length));
check('and the parse still names no partner anywhere',
  delrue.every(t => (t.draws || []).every(d => !('partner' in d) && !('player' in d))),
  'the season endpoint carries no second player — see HANDOVER 2.4');

// A player entering both MD and XD at one tournament gives "doubles" two draws
// for one square. It resolves to the one they play more of across the season,
// not to whichever BWF happened to list first.
const bothDraws = {
  draws: [
    { name: 'XD', position: 'R16', win: 1, lose: 1 },
    { name: 'MD', position: 'QF', win: 2, lose: 1 },
  ],
};
eq('a both-MD-and-XD entry follows the season, not the array order',
  drawForKind(bothDraws, 'doubles', 'MD').name, 'MD');
eq('and the other way round for a mixed specialist',
  drawForKind(bothDraws, 'doubles', 'XD').name, 'XD');
eq('with no preference it still picks one rather than none',
  drawForKind(bothDraws, 'doubles', null).name, 'XD');

/* ============================ weighting ============================

   Settled in HANDOVER Part 2 against BWF's Top Committed Player Programme:
   Super 750 and above are compulsory entries and share the full 42px box;
   below that, equal steps in *area*; side = sqrt(area).
   ================================================================ */

console.log('\n=== weighting ===');
const h = c => boxSize(c).h;
eq('Super 1000 is full size', h(23), BOX_H);
eq('Super 750 is full size too — it is the compulsory line', h(24), BOX_H);
eq('Worlds full', h(20), BOX_H);
eq('Tour Finals full', h(22), BOX_H);
eq('Continental is full size (settled 21 Aug 2026, not 0.80)', h(11), BOX_H);
near('Super 500 is 0.80 of the area', h(25), 37.6, 0.1);
near('Super 300 is 0.60', h(26), 32.5, 0.1);
near('Super 100 is 0.40', h(27), 26.6, 0.1);
eq('Challenge shares the Super 100 size', h(5), h(27));
eq('Series too', h(6), h(27));
eq('Future Series exists and is mapped', levelLabel(7), 'Future');
eq('Continental is abbreviated for a 52px square', levelAbbr(11), 'Cont.');
eq('but its chip spells it out', levelLabel(11), 'Continental');
eq('a label that already fits is left alone', levelAbbr(23), 'Super 1000');
check('no strip label is longer than the longest that fits',
  LEVEL_ORDER.every(c => levelAbbr(c).length <= 10),
  LEVEL_ORDER.map(c => levelAbbr(c)).join(' | '));
eq('sizing off means every box is full size', boxSize(27, false).h, BOX_H);
check('an unknown category degrades to full size rather than to zero', h(999) === BOX_H);
check('team categories are flagged', isTeamEvent(21) && isTeamEvent(17));
check('the ladder never increases going down',
  [23, 24, 25, 26, 27].every((c, i, a) => i === 0 || h(a[i - 1]) >= h(c)));

// Both dimensions scale by the side, so the box keeps its shape. The slot does
// not scale — that is the whole point of the fixed footprint.
eq('a full box is as wide as its slot', boxSize(23).w, SLOT_W);
near('and both dimensions shrink together',
  boxSize(27).w / boxSize(27).h, SLOT_W / BOX_H, 0.001);
near('the side is the square root of the area', boxScale(25), Math.sqrt(0.8), 0.001);

console.log('\n=== the label floor ===');
eq('a full box labels at 11px', boxSize(23).font, 11);
check('a Super 100 label never goes below 9px', boxSize(27).font >= MIN_LABEL_PX,
  String(boxSize(27).font));
check('nor does anything else — a Challenge QF became unreadable when it did',
  LEVEL_ORDER.every(c => boxSize(c).font >= MIN_LABEL_PX),
  LEVEL_ORDER.map(c => boxSize(c).font.toFixed(1)).join(' '));
check('the chip order is the ladder, not the numeric ids',
  LEVEL_ORDER.indexOf(23) < LEVEL_ORDER.indexOf(25)
  && LEVEL_ORDER.indexOf(11) < LEVEL_ORDER.indexOf(25)
  && LEVEL_ORDER.indexOf(21) > LEVEL_ORDER.indexOf(27),
  LEVEL_ORDER.join(' '));
eq('every mapped level has a chip position', LEVEL_ORDER.length, Object.keys(LEVEL).length);
eq('the levels of this season, in that order',
  seasonLevels(season).join(' '), '20 23 24 11 25 21');

/* ============================ fill ============================ */

console.log('\n=== fill fraction ===');
const fillOf = (tmt, disc) => {
  const d = drawFor(tmt, disc);
  return fillFraction(positionInfo(d && d.position), d);
};
const byName = re => season.find(t => re.test(t.name));

near('a title fills the square (Asian Champs, 1st, 5-0)', fillOf(byName(/Asia Champ/), 'MS'), 1.0);
near('runner-up, 4-1 from R32, is four fifths', fillOf(byName(/Malaysia/), 'MS'), 0.8);
near('a quarter-final, 2-1, is two fifths', fillOf(byName(/China Open/), 'MS'), 0.4);
near('a first-round exit keeps a visible sliver', fillOf(byName(/World Champ/), 'MS'), 0.13);
eq('a team tie has nothing to fill', fillOf(team, 'SINGLES'), 0);
check('every fill is inside [0,1]',
  season.every(t => { const f = fillOf(t, 'MS'); return f >= 0 && f <= 1; }));

console.log('\n=== positions ===');
eq('1st reads as a title', positionInfo('1st').label, 'W');
eq('3rd is a semi-final, not third place', positionInfo('3rd').full, 'Semi-final');
eq('N/A is not a result', positionInfo('N/A').tier, 'na');
eq('qualifying is its own tier', positionInfo('Qualification 2').label, 'Q');
check('an unknown position survives as itself rather than vanishing',
  positionInfo('R128').label === 'R128');

/* ============================ names ============================ */

console.log('\n=== names ===');
eq('sponsor prefix dropped', shortTmtName('PETRONAS Malaysia Open 2026'), 'Malaysia Open');
eq('multi-word sponsor dropped', shortTmtName('BANK OF NINGBO Badminton Asia Championships 2026'), 'Asia Champs');
eq('US is a country, not a sponsor', shortTmtName('YONEX US Open 2026'), 'US Open');
eq('so is USA', shortTmtName('VICTOR USA International 2026'), 'USA Intl');
eq('edition numerals are still stripped', shortTmtName('VICTOR XXIX Slovak Open 2026'), 'Slovak Open');
eq('BWF is implied', shortTmtName('BWF World Championships 2026'), 'World Champs');
eq('leading year handled', shortTmtName('2026 European Championships'), 'European Champs');
eq('the last token is never eaten', shortTmtName('YONEX OPEN'), 'OPEN');
check('a long name is truncated, not dropped', shortTmtName(
  'Some Extremely Long Tournament Name Indeed 2026').length <= 24);

eq('capitalised family name', surnameOf('Thom GICQUEL'), 'GICQUEL');
eq('leading family name', surnameOf('SHI Yu Qi'), 'SHI');
eq('compound surname', surnameOf('Kelly VAN BUITEN'), 'VAN BUITEN');
eq('initials are not the surname', surnameOf('M.R. ARJUN'), 'ARJUN');
eq('no case signal: keep the whole name', surnameOf('THET HTAR THUZAR'), 'THET HTAR THUZAR');

/* ============================ the polymorphic results trap ============================ */

console.log('\n=== results is polymorphic ===');
const paginated = { results: { current_page: 1, data: raw.results, total: 10 } };
eq('a paginated response parses the same', parseSeason(paginated).length, 10);
eq('an empty response is an empty season, not a crash', parseSeason({}).length, 0);
eq('so is a null one', parseSeason(null).length, 0);
eq('and a results-less one', parseSeason({ results: null }).length, 0);

process.exit(report());
