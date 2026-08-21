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
  shortTmtName, surnameOf, levelAbbr, roundsInDraw, mainDrawSize, drawLadder,
  canonicalDraw, isOlympics,
  LEVEL, SLOT_W, BOX_H, MIN_LABEL_PX, LEVEL_ORDER,
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

/** A recorded tournaments/draws payload, by tournament code. */
const draws = code => fixture('tournaments/draws', { tournament_code: code });

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
eq('a category with no chip position is listed anyway, not dropped',
  seasonLevels([{ cat: 23 }, { cat: 8 }, { cat: 3 }, { cat: 25 }]).join(' '), '23 25 3 8');
eq('and it gets a name rather than a blank chip', levelLabel(8), 'Level 8');
eq('abbreviated under the square', levelAbbr(8), 'Lv 8');
eq('an unmapped level keeps full size — a guess would shrink it wrongly',
  boxSize(8).h, BOX_H);

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

/* ============================ the real ladder ============================

   `fillFraction` used to infer how deep a draw was from the exit round and the
   number of matches played. That inference cannot see past R64, and it counts
   qualifying wins as rounds of the main draw. tournaments/draws gives the real
   thing, and these payloads are recorded from it.
   ==================================================================== */

console.log('\n=== rounds in a draw ===');
eq('a 32-draw takes five rounds to win', roundsInDraw(32), 5);
eq('a 64-draw, six', roundsInDraw(64), 6);
eq('a 16-draw, four', roundsInDraw(16), 4);
eq('a four-player knockout, two', roundsInDraw(4), 2);
eq('sizes arrive as strings', roundsInDraw('32'), 5);
check('an odd size rounds up rather than failing', roundsInDraw(48) === 6, String(roundsInDraw(48)));
eq('nothing usable gives nothing', roundsInDraw(null), null);
eq('and neither does a single entrant', roundsInDraw(1), null);

console.log('\n=== the main draw, out of all the stages ===');
const malaysiaDraws = draws('41287386-9043-4062-99C8-3FFBB9B26C1E');   // Super 1000
const thailandDraws = draws('3B8847C8-A4D7-4C65-B3E1-EA2314FD304B');   // Super 500, has qualifying
const asiaDraws = draws('C69FDCC5-4CCA-4EE1-9E18-9675557C0605');       // Continental, group qualifying
const finalsDraws = draws('F0D25C8F-6A9A-49DE-97FC-E58E3DB74CF1');     // groups into a knockout of four
const sideEntry = draws('3F48544D-A795-4401-9AFE-23A5532931B9');       // unmarked groups into a 32-draw
const europeDraws = draws('25A4DDB1-A76C-4A9C-B486-B5E9588D8C4A');     // Continental, 64-draw

eq('a Super 1000 runs 32', mainDrawSize(malaysiaDraws, 'MS'), 32);
eq('the World-level draws run 64', mainDrawSize(europeDraws, 'MS'), 64);
eq('the qualifying draw is not mistaken for the main one',
  mainDrawSize(thailandDraws, 'MS'), 32);
eq('a discipline that is not there gives nothing',
  mainDrawSize(malaysiaDraws, 'ZZ'), null);
eq('and neither does an empty payload', mainDrawSize(null, 'MS'), null);

// Sizes differ between disciplines of the same tournament — the 2026 China
// Masters ran MS at 64 and WS at 32 — so this is asked per draw, never once
// per tournament.
const mixed = { data: [
  { name: 'MS', type: 'Elimination', size: '64', stage_name: 'Main Draw' },
  { name: 'WS', type: 'Elimination', size: '32', stage_name: 'Main Draw' },
] };
eq('MS and WS are asked separately', mainDrawSize(mixed, 'MS'), 64);
eq('and can disagree', mainDrawSize(mixed, 'WS'), 32);

console.log('\n=== the ladder, including the stages before the knockout ===');
eq('a straight knockout is just its rounds', drawLadder(malaysiaDraws, 'MS'), 5);
eq('a qualifying draw does not lengthen it', drawLadder(thailandDraws, 'MS'), 5);
eq('nor do qualifying groups', drawLadder(asiaDraws, 'MS'), 5);
eq('a 64-draw is six', drawLadder(europeDraws, 'MS'), 6);

// Two groups of four into a knockout of four: the group *is* the tournament,
// and a semi-finalist had to win three group matches to reach it.
eq('a round-robin main stage does lengthen it', drawLadder(finalsDraws, 'MS'), 5);

// Four small groups into a 32-draw is a side entrance for twelve players, not
// the tournament. These older payloads say nothing about their stage, so the
// difference is read off the shape: a main stage seats the whole field.
eq('unmarked groups too small to be the field are a side entrance',
  drawLadder(sideEntry, 'MS'), 5);

eq('a payload with no such draw gives nothing', drawLadder(malaysiaDraws, 'ZZ'), null);

console.log('\n=== fill, against the real ladder ===');
const fill = (pos, win, lose, rounds) =>
  Math.round(fillFraction(positionInfo(pos), { position: pos, win, lose }, rounds) * 100);

eq('a title fills it', fill('1st', 5, 0, 5), 100);
eq('a runner-up in a 32-draw is four fifths', fill('2nd', 4, 1, 5), 80);
eq('a semi-final, three fifths', fill('3rd', 3, 1, 5), 60);
eq('a first-round exit keeps its sliver', fill('R32', 0, 1, 5), 13);

// The point of the exercise: the same placing is a different achievement in a
// different draw, because one of them had to win a round the other did not.
eq('a quarter-final of a 32-draw is two of five', fill('QF', 2, 1, 5), 40);
eq('a quarter-final of a 64-draw is three of six', fill('QF', 3, 1, 6), 50);
eq('and of a 16-draw, one of four', fill('QF', 1, 1, 4), 25);

console.log('\n=== what the inference got wrong ===');
// A qualifier who wins two qualifying matches and then loses in R32 has made a
// first-round exit. Their match record says 2-1, and reading the ladder off
// that says they won two rounds of seven.
eq('the inference credited qualifying wins as main-draw rounds',
  fill('R32', 2, 1, null), 29);
eq('the real ladder calls it what it is', fill('R32', 2, 1, 5), 13);

eq('a qualifier who then reaches the last 16 won one round, not three',
  fill('R16', 3, 1, 5), 20);
eq('where the inference said three of seven', fill('R16', 3, 1, null), 43);

// R128 has no place on a ladder anchored at R64, so the inference had nothing
// to say about it at all.
eq('R128 is a round now', positionInfo('R128').label, 'R128');
eq('and reads as a first-round exit, not as an unknown', positionInfo('R128').tier, 'r1');
eq('filling accordingly', fill('R128', 0, 1, 7), 13);

console.log('\n=== the fallback, for when the extra call fails ===');
eq('no ladder means the old inference, not an empty square',
  fill('2nd', 4, 1, null), 80);
eq('a title still fills', fill('1st', 5, 0, null), 100);
eq('a first-round exit still shows', fill('R64', 0, 1, null), 13);
eq('and an unplayed team tie is still nothing', fill('N/A', 4, 1, null), 0);
check('the two agree whenever a player entered at round one',
  [['1st', 5, 0], ['2nd', 4, 1], ['3rd', 3, 1], ['QF', 2, 1], ['R16', 1, 1], ['R32', 0, 1]]
    .every(([p, w, l]) => fill(p, w, l, 5) === fill(p, w, l, null)),
  [['1st', 5, 0], ['2nd', 4, 1], ['3rd', 3, 1], ['QF', 2, 1], ['R16', 1, 1], ['R32', 0, 1]]
    .map(([p, w, l]) => `${p}:${fill(p, w, l, 5)}/${fill(p, w, l, null)}`).join(' '));

/* ============================ how BWF spells things ============================

   The World Tour uses two-letter draw codes and short placings. The Olympics do
   not, and neither did badminton before about 2015. Every variant below was
   read off a live response.
   ======================================================================== */

console.log('\n=== draw names ===');
eq('the World Tour code passes through', canonicalDraw('MS'), 'MS');
eq('the Olympics spell it out', canonicalDraw("Men's Singles"), 'MS');
eq('and for the women', canonicalDraw("Women's Singles"), 'WS');
eq('mixed doubles', canonicalDraw('Mixed Doubles'), 'XD');
eq("men's doubles", canonicalDraw("Men's Doubles"), 'MD');
eq("women's doubles", canonicalDraw("Women's Doubles"), 'WD');
eq('a curly apostrophe is the same name', canonicalDraw('Men’s Singles'), 'MS');
eq('the junior circuit fields boys', canonicalDraw('BS U19'), 'MS');
eq('and girls', canonicalDraw('GD U17'), 'WD');

// A team tie names no gender, because the tie is the competitor rather than the
// player, and that is exactly how one is recognised.
eq('a bare "Singles" is a team tie', canonicalDraw('Singles'), null);
eq('as is a bare "Doubles"', canonicalDraw('Doubles'), null);
eq('nothing at all is nothing', canonicalDraw(''), null);

console.log('\n=== and what that means for the toggle ===');
eq('an Olympic singles entry is singles', kindOf("Men's Singles"), 'singles');
eq('an Olympic mixed entry is doubles', kindOf('Mixed Doubles'), 'doubles');
eq('a team tie is neither', kindOf('Singles'), 'team');
check('so an Olympic result is not dropped from both views at once',
  kindOf("Men's Singles") !== 'team' && kindOf('Mixed Doubles') !== 'team');

console.log('\n=== placings ===');
eq('the Olympics write quarter-finals out', positionInfo('Quarterfinals').label, 'QF');
eq('with the same ladder position', positionInfo('Quarterfinals').steps, 3);
eq('semi-finals too', positionInfo('Semifinals').label, 'SF');
eq('hyphenated', positionInfo('Semi-Finals').label, 'SF');
eq('and the rounds', positionInfo('Round of 16').label, 'R16');
eq('deeper ones as well', positionInfo('Round of 32').steps, 5);

// "Final" does not say who won it. Whoever lost no match did.
eq('a finalist who lost a match is the runner-up',
  positionInfo('Final', { win: 4, lose: 1 }).label, 'F');
eq('one who lost none is the champion',
  positionInfo('Final', { win: 5, lose: 0 }).label, 'W');
eq('with no record to go on, assume they lost it', positionInfo('Final').label, 'F');

console.log('\n=== group stages ===');
eq('going out in a group is not an unknown placing', positionInfo('Group A').label, 'Grp');
eq('and reads as the earliest exit there is', positionInfo('Group B').tier, 'r1');
check('with no ladder position, so it fills the minimum',
  positionInfo('Group A').steps === undefined);
near('which is the sliver', fillFraction(positionInfo('Group A'), { win: 1, lose: 2 }, 5), 0.13);

console.log('\n=== a dash is not a result ===');
eq('BWF writes "-" for some junior events', positionInfo('-').tier, 'na');
eq('same as N/A', positionInfo('N/A').tier, 'na');

console.log('\n=== the Olympics are not the World Championships ===');
check('recognised by name', isOlympics('Paris 2024 Olympic Games Badminton Competition'));
check('however they are written', isOlympics('Tokyo 2020 Olympic Games Badminton')
  && isOlympics('Rio 2016 Olympic Games'));
check('a World Championships is not one', !isOlympics('BWF World Championships 2026'));
check('and neither is the Youth Olympic qualifier of a name', !isOlympics('Malaysia Open 2026'));

// Both come back as category 20, so the name is the only thing telling them
// apart, and the strip should not label an Olympics "Worlds".
eq('they get a level of their own', levelLabel('OLY'), 'Olympics');
eq('at full weight', boxSize('OLY').h, BOX_H);
eq('while 20 stays the World Championships', levelLabel(20), 'Worlds');
check('and the Olympics lead the chip order', LEVEL_ORDER[0] === 'OLY');

const olympicSeason = parseSeason({ results: [{
  tournament_id: 1, tmt_url: 'https://bwfbadminton.com/x',
  draws: [{ name: "Men's Singles", position: 'Quarterfinals', match_win: 3, match_lose: 1 }],
  tournament_model: { id: 1, name: 'Paris 2024 Olympic Games Badminton Competition',
    tournament_category_id: 20, start_date: '2024-07-27 00:00:00' },
}] });
eq('an Olympic entry parses to its own level', olympicSeason[0].cat, 'OLY');
eq('labelled as such', olympicSeason[0].level, 'Olympics');
eq('with a canonical draw code', olympicSeason[0].draws[0].name, 'MS');
eq('and BWF’s own wording kept for the tooltip',
  olympicSeason[0].draws[0].raw, "Men's Singles");
eq('so it lands in the singles view', defaultKind(olympicSeason), 'singles');
eq('and fills against the ladder rather than blanking',
  Math.round(fillFraction(positionInfo('Quarterfinals'), olympicSeason[0].draws[0], 5) * 100), 40);

/* ============================ names ============================ */

console.log('\n=== names ===');
eq('sponsor prefix dropped', shortTmtName('PETRONAS Malaysia Open 2026'), 'Malaysia Open');
eq('multi-word sponsor dropped', shortTmtName('BANK OF NINGBO Badminton Asia Championships 2026'), 'Asia Champs');
eq('US is a country, not a sponsor', shortTmtName('YONEX US Open 2026'), 'US Open');
eq('so is USA', shortTmtName('VICTOR USA International 2026'), 'USA Intl');
eq('edition numerals are still stripped', shortTmtName('VICTOR XXIX Slovak Open 2026'), 'Slovak Open');
eq('BWF is implied', shortTmtName('BWF World Championships 2026'), 'World Champs');
eq('leading year handled', shortTmtName('2026 European Championships'), 'European Champs');
eq('a sponsor that IS the name is kept — "Open" alone names nothing',
  shortTmtName('HYLO Open 2022'), 'HYLO Open');
eq('so is this one', shortTmtName('YONEX OPEN'), 'YONEX OPEN');
eq('a sponsor at the end goes too',
  shortTmtName('Denmark Open 2022 presented by VICTOR'), 'Denmark Open');
eq('a year in the middle is still a year',
  shortTmtName('Malaysia Open 2021 something'), 'Malaysia Open something');
eq('scheduling notes are dropped',
  shortTmtName('TotalEnergies BWF Thomas & Uber Cup Finals 2020 (New Dates)'), 'Thomas & Uber');
check('but a cancellation is not — it changes what the square means',
  /\(Cancell/.test(shortTmtName('Singapore Open 2021 (Cancelled)')),
  shortTmtName('Singapore Open 2021 (Cancelled)'));
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
