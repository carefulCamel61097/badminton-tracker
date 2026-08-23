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
  shortTmtName, seasonLabels, tidyTmtName, surnameOf, levelAbbr, roundsInDraw,
  mainDrawSize, drawLadder,
  canonicalDraw, isOlympics,
  gridGroup, seasonResults, careerRows, gridSections, sectionCells, gridYears,
  resultRank, tournamentSeason, GRID_ORDER,
  HONOUR_STEPS, HONOUR_DEFAULT, honourStep, honourScale, honourRung,
  careerHonours, honourSections,
  pickTournament, tournamentDays, defaultDay, parseDayMatches, orderOfPlay,
  drawsPresent, courtGrid, courtOrder, dayOf, matchSignature, prettyDay,
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
// Continental now sits with the Super 1000s rather than under the Super 750s —
// see the honours ladder below, and HANDOVER 2.2 for why it is a major.
eq('the levels of this season, in that order',
  seasonLevels(season).join(' '), '20 11 23 24 25 21');
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

console.log('\n=== a bare R and one digit is a group stage ===');
// Every occurrence in the recorded data is a round-robin event: at the Tour
// Finals, groups of four play three matches and anyone who fails to come out of
// one is "R3" with a 1-2 or 0-3 record; at the Asian Championships, where the
// groups are the qualifying stage, it is "R3" again.
eq('R3 is a group exit, not an unknown placing', positionInfo('R3').label, 'Grp');
eq('coloured as the earliest exit there is', positionInfo('R3').tier, 'r1');
check('and BWF\'s own wording is kept for the tooltip',
  /R3/.test(positionInfo('R3').full), positionInfo('R3').full);
eq('the same as a named group', positionInfo('Group B').label, positionInfo('R3').label);
near('filling the minimum, because they got no further',
  fillFraction(positionInfo('R3'), { win: 1, lose: 2 }, 5), 0.13);

// A single digit is what makes this safe: every knockout round is R16 or larger.
eq('R16 is still a round of the draw', positionInfo('R16').label, 'R16');
eq('so is R32', positionInfo('R32').label, 'R32');
eq('and R128', positionInfo('R128').label, 'R128');
check('none of them mistaken for a group',
  ['R16', 'R32', 'R64', 'R128'].every(p => positionInfo(p).label !== 'Grp'));

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

console.log('\n=== a tournament still being played ===');
// BWF reports the round a player is *in* while an event runs — the 2026 World
// Championships came back as "SF" mid-tournament. That is not in the placings
// table, so it rendered as an unknown, which draws as an empty square: the
// event everybody is actually watching was the one showing no result.
eq('a live semi-final is a semi-final', positionInfo('SF').label, 'SF');
eq('on the same rung', positionInfo('SF').steps, 2);
eq('and coloured as one', positionInfo('SF').tier, 'sf');
eq('a live final too', positionInfo('F', { win: 5, lose: 1 }).label, 'F');
eq('and whoever has lost nothing has won it', positionInfo('F', { win: 5, lose: 0 }).label, 'W');
near('so it fills against the ladder rather than reading as nothing',
  fillFraction(positionInfo('SF'), { win: 4, lose: 0 }, 6), 4 / 6);

console.log('\n=== names BWF writes in capitals ===');
eq('a region is not a sponsor', shortTmtName('ASIAN Games 2022 (Individual Event)'), 'ASIAN Games');
eq('and the team event still says so',
  shortTmtName('ASIAN Games 2022 (Team Event) - Non World Ranking'), 'ASIAN Games (Team Event)');
check('nor is a continent', /European/i.test(shortTmtName('EUROPEAN Championships 2026')),
  shortTmtName('EUROPEAN Championships 2026'));

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

/* ---- two events in a season that tidy to the same words ---- */

/* January 2021 ran the YONEX Thailand Open and the TOYOTA Thailand Open a week
   apart in the same Bangkok bubble, and BWF left the year off both because the
   sponsor is what tells them apart. Tidied, they are two squares reading
   "Thailand Open" in one row, which reads as a bug. */
const thaiLabels = seasonLabels([
  { name: 'YONEX Thailand Open', start: '2021-01-12' },
  { name: 'TOYOTA Thailand Open', start: '2021-01-19' },
]);
eq('the sponsor comes back when it is the only difference',
  thaiLabels.join(' / '), 'YONEX Thailand Open / TOYOTA Thailand Open');

eq('and stays away when it is not needed',
  seasonLabels([{ name: 'PETRONAS Malaysia Open 2026', start: '2026-01-06' }])[0],
  'Malaysia Open');
check('a whole season of distinct events is untouched by any of this',
  seasonLabels(season).join('|') === season.map(t => shortTmtName(t.name)).join('|'),
  seasonLabels(season).join(' · '));

eq('the sponsor is reported alongside the tidied name',
  tidyTmtName('PETRONAS Malaysia Open 2026').sponsor, 'PETRONAS');
eq('and is empty when there was none',
  tidyTmtName('Orleans Masters 2021').sponsor, '');

// Same event, same sponsor, twice in a year: the month is all that is left.
const twice = seasonLabels([
  { name: 'Orleans Masters 2021', start: '2021-03-23' },
  { name: 'Orleans Masters 2021', start: '2021-09-23' },
]);
eq('falling back to the month', twice.join(' / '), 'Orleans Masters (03) / Orleans Masters (09)');
check('and the disambiguator is never the part that gets truncated',
  seasonLabels([
    { name: 'DANISA Denmark Open I 2020', start: '2020-10-13' },
    { name: 'DANISA Denmark Open I 2020', start: '2020-11-20' },
  ]).every(l => l.length <= 24 && /\(\d\d\)$/.test(l)),
  seasonLabels([
    { name: 'DANISA Denmark Open I 2020', start: '2020-10-13' },
    { name: 'DANISA Denmark Open I 2020', start: '2020-11-20' },
  ]).join(' / '));

/* The clip itself can make two different names identical, which is a different
   failure from two names that were always the same. Both halves of the 2017
   Badminton Asia Junior Championships tidy to 40-odd characters that differ
   only at the end, and both clip to "Pembangunan Jaya Raya A…". Neither has a
   sponsor and both were played in July, so only the day separates them. */
const juniorHalves = seasonLabels([
  { name: 'Pembangunan Jaya Raya Badminton Asia Junior Championships 2017 ( Team Event )', start: '2017-07-22' },
  { name: 'Pembangunan Jaya Raya Badminton Asia Junior Championships 2017 (Individual Event)', start: '2017-07-26' },
]);
check('two names the clip would flatten together are still told apart',
  juniorHalves[0] !== juniorHalves[1], juniorHalves.join(' / '));
check('and neither outgrows the square',
  juniorHalves.every(l => l.length <= 24), juniorHalves.map(l => l.length).join('/'));

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

/* ============================ the career grid ============================

   Whole careers out of the recorded fixtures, so these are checks against real
   twenty-year data rather than against a hand-built season. Shi Yu Qi is the
   interesting one: his career straddles the 2018 category renumbering, so it
   carries the junior circuit, the Superseries era and the World Tour at once.
   ==================================================================== */

console.log('\n=== the career grid ===');

/** Every recorded season for a player, newest first, the way the app holds them. */
function career(playerId) {
  const out = [];
  for (let year = 2026; year >= 2005; year--) {
    let tournaments;
    try { tournaments = parseSeason(fixture('vue-player-tournaments', seasonParams(playerId, year))); }
    catch { continue; }                       // not recorded, which is not a failure
    if (tournaments.length) out.push({ year, tournaments });
  }
  return out;
}

/** The same bucketing the view does: one Map per season, newest first. */
function rowsOf(seasons) {
  const all = seasons.flatMap(s => s.tournaments);
  const kind = defaultKind(all);
  return careerRows(seasons, kind, dominantDraw(all, kind));
}

const shi = career(57945);
const anSeYoung = career(87442);
const findTmt = (seasons, re) => seasons.flatMap(s => s.tournaments).find(t => re.test(t.name));

check('a whole career comes out of the fixtures', shi.length >= 14, `${shi.length} seasons`);

/* ---- what belongs in the grid at all ---- */

eq('a Super 750 is in the grid, in its own section',
  gridGroup(findTmt(shi, /DAIHATSU Japan Open 2026/)), 24);
eq('the Olympics are the leftmost section',
  gridGroup(findTmt(shi, /Paris 2024 Olympic/)), 'OLY');
eq('a team event is not in the grid at all',
  gridGroup(findTmt(shi, /Thomas & Uber Cup Finals 2026/)), null);
eq('nor is a team event under an unmapped id — its draws are bare "Singles"',
  gridGroup(findTmt(shi, /Asia Team Championships 2016/)), null);
eq('nor is the junior circuit',
  gridGroup(findTmt(shi, /World Junior Championships 2013/)), null);
eq('a junior event filed under the SENIOR Worlds id is still junior',
  gridGroup({ cat: 20, name: 'LI NING BWF World Junior Championship 2018', draws: [{ name: 'MS' }] }), null);
eq('and the age band on a draw gives one away even when the name does not',
  gridGroup({ cat: 3, name: 'Some Asia Cup 2014', draws: [{ name: 'MS', raw: 'BS U19' }] }), null);
eq('a Challenge is below the grid',
  gridGroup({ cat: 5, name: 'Welsh International 2022', draws: [{ name: 'MS' }] }), null);
eq('an unmapped senior id lands in OTHER, not in the bin',
  gridGroup(findTmt(shi, /^Korea Grand Prix Gold$/)), 'OTHER');

/* The 2014 Youth Olympic Games is category 33 with the World Junior
   Championships. It used to be promoted to the Olympics by name alone. */
eq('the Youth Olympics are not the Olympics', isOlympics('2014 Youth Olympic Games'), false);
eq('the Olympics still are', isOlympics('Paris 2024 Olympic Games Badminton Competition'), true);

/* ---- the majors keep one section each, across the id renumbering ---- */

eq('the 2017 Worlds are category 1, and still go in the Worlds section',
  gridGroup(findTmt(shi, /TOTAL BWF World Championships 2017/)), 20);
eq('the 2017 season-ending Finals are category 8, and still go in the Finals section',
  gridGroup(findTmt(shi, /Dubai World Superseries Finals 2017/)), 22);
// Name and category as BWF actually sends them, from a career the roster
// records but this file does not walk.
eq('the 2012 Asian Championships are category 1, and still go in Continental',
  gridGroup({ cat: 1, name: 'Badminton Asia Championships 2012', draws: [{ name: 'MS' }] }), 11);
eq('so does a European Championships under an unmapped id',
  gridGroup({ cat: 3, name: '2016 European Championships', draws: [{ name: 'WS' }] }), 11);
eq('an Open whose name ends in "Championships" is not a continental',
  gridGroup(findTmt(shi, /All England Open Badminton Championships 2026/)), 23);

/* ---- best-first ordering inside a section ---- */

console.log('\n--- results sort best-first ---');

eq('a title is the best there is', resultRank({ steps: 0, tier: 'w' }), 0);
check('a runner-up comes after it',
  resultRank({ steps: 1, tier: 'f' }) > resultRank({ steps: 0, tier: 'w' }));
check('and a round of 128 after that',
  resultRank({ steps: 7, tier: 'r1' }) > resultRank({ steps: 3, tier: 'qf' }));
check('a group-stage exit sorts below every knockout round',
  resultRank({ tier: 'r1' }) > resultRank({ steps: 7, tier: 'r1' }));
check('qualifying below that — they never reached the main draw',
  resultRank({ tier: 'q' }) > resultRank({ tier: 'r1' }));
check('a placing we do not recognise below that again',
  resultRank({ tier: 'unk' }) > resultRank({ tier: 'q' }));

const shiRows = rowsOf(shi);
const anRows = rowsOf(anSeYoung);
const rowFor = year => shiRows.find(r => r.year === year);

for (const row of shiRows) {
  const bad = [];
  for (const [group, list] of row.by) {
    for (let i = 1; i < list.length; i++) {
      if (list[i].rank < list[i - 1].rank) bad.push(`${row.year} ${group}`);
    }
  }
  if (bad.length) check(`${row.year} is sorted`, false, bad.join(', '));
}
check('every section of every season is in best-first order', true,
  `${shiRows.length} seasons checked`);

/* Read off the raw payload by hand, not off the sorter under test:
     2025  Malaysia 1st (Jan) · All England 1st (Mar) · Indonesia 3rd (Jun) · China 1st (Jul)
     2026  Malaysia 2nd (Jan) · All England R32 (Mar) · Indonesia R16 (Jun) · China QF (Jul) */
const s1000of = year => (rowFor(year).by.get(23) || []).map(c => c.info.label);
eq('2025: three Super 1000 titles and a semi, in that order', s1000of(2025).join(' '), 'W W W SF');
eq('2026: a final, then down the ladder', s1000of(2026).join(' '), 'F QF R16 R32');
check('and the order is by result, not by date',
  rowFor(2025).by.get(23).map(c => c.tmt.start).join(' ')
  !== rowFor(2025).by.get(23).map(c => c.tmt.start).slice().sort().join(' '),
  rowFor(2025).by.get(23).map(c => `${c.tmt.start}=${c.info.label}`).join(' '));

check('a tournament entered in the other discipline takes no slot',
  !rowFor(2026).by.get(23).some(c => c.draw.name !== 'MS'),
  rowFor(2026).by.get(23).map(c => c.draw.name).join(' '));

/* ---- which season a tournament belongs to ---- */

console.log('\n--- the delayed Finals goes back where it belongs ---');

/* COVID pushed the 2020 season-ending Finals to 27 January 2021, and BWF files
   it under tmtYear=2021 — so AN Se Young has two Tour Finals in her 2021 row
   unless the edition year in the name is honoured. The Finals is the one event
   there is exactly one of per season. */
const finalsCells = [];
for (const row of anRows) for (const c of row.by.get(22) || []) finalsCells.push({ year: row.year, c });

check('AN Se Young has more than one Finals in her career',
  finalsCells.length >= 5, `${finalsCells.length}`);
check('but never two in one season',
  new Set(finalsCells.map(f => f.year)).size === finalsCells.length,
  finalsCells.map(f => `${f.year}:${f.c.tmt.start}`).join(' '));
check('the delayed one sits in 2020, the season it concludes',
  finalsCells.some(f => f.year === 2020 && f.c.tmt.start.startsWith('2021-01')),
  finalsCells.map(f => `${f.year}<-${f.c.tmt.start}`).join(' '));
check('and the 2021 edition stays in 2021',
  finalsCells.some(f => f.year === 2021 && f.c.tmt.start.startsWith('2021-12')));

eq('a Finals played in its own year does not move',
  tournamentSeason({ cat: 22, name: 'HSBC BWF World Tour Finals 2025', start: '2025-12-17', draws: [{ name: 'MS' }] }), 2025);
eq('one played the January after belongs to the season it closes',
  tournamentSeason({ cat: 22, name: 'HSBC BWF World Tour Finals 2020 (New Dates)', start: '2021-01-27', draws: [{ name: 'MS' }] }), 2020);

/* ⚠️ Deliberately narrow. Three other events in the recorded data carry an
   earlier year than the date they were played on, and all three stay put. */
eq('the Tokyo 2020 Olympics were played in 2021 and belong to 2021',
  tournamentSeason({ cat: 'OLY', name: 'Tokyo 2020 Olympic Games Badminton', start: '2021-07-24', draws: [{ name: 'WS' }] }), 2021);
eq('so do the 2022 Asian Games, held in 2023',
  tournamentSeason({ cat: 74, name: 'ASIAN Games 2022 (Individual Event)', start: '2023-10-02', draws: [{ name: 'MS' }] }), 2023);
eq('and a qualifier named for next year is still played this year',
  tournamentSeason({ cat: 29, name: '2024 European Team Championships Qualification', start: '2023-12-07', draws: [{ name: 'MS' }] }), 2023);

/* ---- section widths ---- */

console.log('\n--- sections are as wide as the busiest season ---');

const shiSections = gridSections([shiRows.map(r => r.by)]);
const sec = group => shiSections.find(s => s.group === group);

eq('the sections run hardest-first, exactly as GRID_ORDER says',
  shiSections.map(s => s.group).join(','),
  GRID_ORDER.filter(g => shiSections.some(s => s.group === g)).join(','));
eq('the leftmost section is the Olympics', shiSections[0].group, 'OLY');
eq('the unmapped era is last', shiSections[shiSections.length - 1].group, 'OTHER');

eq('four Super 1000 slots, which is what the calendar holds', sec(23).n, 4);
eq('six Super 750 slots', sec(24).n, 6);
eq('one Olympics, one Worlds, one Continental, one Finals',
  `${sec('OLY').n}${sec(20).n}${sec(11).n}${sec(22).n}`, '1111');

check('the width is the most he played in any one season', (() => {
  for (const s of shiSections) {
    const most = Math.max(...shiRows.map(r => (r.by.get(s.group) || []).length));
    if (most !== s.n) return false;
  }
  return true;
})());
check('so no season ever overflows its sections',
  shiRows.every(r => [...r.by].every(([g, list]) => list.length <= sec(g).n)));

check('and the whole grid is far narrower than a column per tournament',
  shiSections.reduce((a, s) => a + s.n, 0) < 40,
  `${shiSections.reduce((a, s) => a + s.n, 0)} cells wide`);

/* ⚠️ 2021 really did hold two Super 1000 Thailand Opens, back to back in the
   Bangkok bubble — the kind of thing that made a column-per-tournament layout
   grow a ragged tail. Delphine DELRUE played both. */
const delrueRows = rowsOf(career(70762));
const delrue2021 = delrueRows.find(r => r.year === 2021);
check('two Super 1000s in one January are simply two results',
  (delrue2021.by.get(23) || []).length === 5,
  (delrue2021.by.get(23) || []).map(c => c.tmt.short).join(' | '));

/* ---- the cells of a row ---- */

console.log('\n--- one row of cells ---');

const cells2026 = sectionCells(rowFor(2026).by, shiSections);
eq('one cell per slot, always',
  cells2026.length, shiSections.reduce((a, s) => a + s.n, 0));
check('the first cell of each section is marked, and only those',
  cells2026.filter(c => c.first).length === shiSections.length);

const inSection = g => cells2026.filter(c => c.group === g);
eq('the Worlds cell holds his R64 exit', inSection(20)[0].tier, 'r1');
eq('the Continental cell holds the title', inSection(11)[0].tier, 'w');
check('and it names the tournament, so a cell with no text can still be read',
  /Asia Championships 2026/.test(inSection(11)[0].tmt.name));

const s1000cells = inSection(23);
eq('the Super 1000 block is four cells', s1000cells.length, 4);
check('filled left to right, best first',
  s1000cells.every((c, i) => i === 0 || c.rank >= s1000cells[i - 1].rank),
  s1000cells.map(c => c.tier).join(' '));

const thin = sectionCells(rowFor(2021).by, shiSections);
const thin1000 = thin.filter(c => c.group === 23);
check('a thin season pads on the RIGHT, never in the middle',
  thin1000.findIndex(c => !c.tmt) === -1
  || thin1000.slice(thin1000.findIndex(c => !c.tmt)).every(c => !c.tmt),
  thin1000.map(c => (c.tmt ? c.tier : '·')).join(' '));
eq('and a padded cell is "off", with nothing to name',
  thin1000[thin1000.length - 1].tmt, null);

eq('a year with no season at all is all padding',
  sectionCells(undefined, shiSections).filter(c => c.tier !== 'off').length, 0);

/* ---- two careers share one set of sections ---- */

console.log('\n--- two careers, one set of sections ---');

const both = gridSections([shiRows.map(r => r.by), anRows.map(r => r.by)]);
const bothYears = gridYears([shiRows, anRows]);

check('a shared section is at least as wide as either career needs',
  both.every(s => {
    const mine = shiSections.find(x => x.group === s.group);
    return !mine || s.n >= mine.n;
  }));
check('and wide enough for both, so neither overflows',
  [...shiRows, ...anRows].every(r =>
    [...r.by].every(([g, list]) => list.length <= (both.find(s => s.group === g) || { n: 0 }).n)));
eq('every row is the same width in both grids',
  sectionCells(shiRows[0].by, both).length, sectionCells(anRows[0].by, both).length);

const shiYears = gridYears([shiRows]);
eq('the years run newest first', shiYears[0] > shiYears[shiYears.length - 1], true);
eq('with no gaps in the middle',
  shiYears.length, shiYears[0] - shiYears[shiYears.length - 1] + 1);
check('a season whose every tournament is junior is not a row',
  !shiYears.includes(2012), `2012 was Asia Youth U19 only`);
eq('the years span both careers', bothYears[0], Math.max(shiYears[0], gridYears([anRows])[0]));

eq('nothing to draw is an empty list, not a crash', gridSections([]).length, 0);
eq('and so is a career of nothing', gridYears([[]]).length, 0);
eq('and rows out of nothing', careerRows(null, 'singles', 'MS').length, 0);
eq('a season of nothing buckets to nothing', seasonResults(null, 'singles', 'MS').size, 0);


/* ============================ the honours board ============================

   The other reading of the same rows: no seasons, one row per level, and only
   what cleared the bar. The expectations below were read off the raw payload —
   SHI Yu Qi went out in the quarter-finals at Tokyo 2020 (4-2) and again at
   Paris 2024 (3-1), won the 2025 World Championships 6-0, and has never entered
   a Super 100 in his life; AN Se Young won Paris 2024 6-0 and lost her Tokyo
   quarter-final 6-2.
   ==================================================================== */

console.log('\n=== the honours board ===');

/* ---- the golden ratio, and which dimension it is applied to ---- */

const PHI_ = (1 + Math.sqrt(5)) / 2;
eq('the bottom rung of the ladder is the unit', honourScale('OTHER'), 1);
check('each RUNG up is φ times the AREA of the one below, which is what the eye totals',
  GRID_ORDER.every(g => {
    const area = Math.pow(honourScale(g), 2);
    const rungsUp = honourRung('OTHER') - honourRung(g);
    return Math.abs(area - Math.pow(PHI_, rungsUp)) < 1e-9;
  }));
check('so the sides go up by √φ, not by φ',
  Math.abs(honourScale(23) / honourScale(24) - Math.sqrt(PHI_)) < 1e-9);
/* The whole reason it is area and not side: nine rungs at φ per side is a ratio
   of 47 between the top and the bottom, and a 10px Super 100 square would put
   the Olympics off the screen. Per area it is 6.9, which is a picture. */
near('the Olympics are 6.9 times the side of the bottom rung, not 47',
  honourScale('OLY'), 6.854, 0.001);
check('and the ladder never goes back up as you go down it', GRID_ORDER.every((g, i) =>
  i === 0 || honourScale(GRID_ORDER[i - 1]) >= honourScale(g)));
eq('a level the ladder does not know sits at the bottom rather than vanishing',
  honourScale(999), 1);

/* ---- Continental is a peer of the Super 1000, not a step below the 750 ---- */

/* Settled at full weight in HANDOVER 2.2 — "an Asian Championships title is a
   major" — so a ladder that put it under a Super 750 was contradicting the
   strip it sits next to. */
eq('the Continentals share the Super 1000 rung', honourRung(11), honourRung(23));
/* The sharing names its partner rather than meaning "the level above me", so
   that where a level is listed and what it is worth stay independent — under a
   positional rule, listing the Continentals above the Super 1000s would have
   silently given them the Tour Finals' size instead. */
check('and get it from the Super 1000 itself, not from whatever is listed above',
  honourRung(11) !== honourRung(22) && honourScale(11) !== honourScale(22),
  `CON ${honourScale(11).toFixed(3)} vs WTF ${honourScale(22).toFixed(3)}`);
eq('and therefore the same size', honourScale(11), honourScale(23));
check('which is above the Super 750, where they used to sit',
  honourScale(11) > honourScale(24));
check('and are listed directly above them',
  GRID_ORDER.indexOf(11) === GRID_ORDER.indexOf(23) - 1, GRID_ORDER.join(' '));
/* Listed above rather than below so that the five Super levels are an unbroken
   run of *rows* as well as an unbroken run of sizes. Nothing at all comes
   between Super 1000 and Super 100 now. */
check('so nothing is listed between one Super level and the next',
  GRID_ORDER.slice(GRID_ORDER.indexOf(23), GRID_ORDER.indexOf(27) + 1)
    .join(',') === '23,24,25,26,27',
  GRID_ORDER.join(' '));

/* The reason sharing beats promoting: a rung of its own pushed everything below
   it down one, so the official Super ladder came out unevenly spaced for a
   reason that had nothing to do with the Super events. */
const SUPERS = [23, 24, 25, 26, 27];
check('the five Super levels sit on five consecutive rungs',
  SUPERS.every((g, i) => i === 0 || honourRung(g) === honourRung(SUPERS[i - 1]) + 1),
  SUPERS.map(g => `${g}@${honourRung(g)}`).join(' '));
check('so every step down the Super ladder is the same step',
  SUPERS.every((g, i) => i === 0
    || Math.abs(honourScale(SUPERS[i - 1]) / honourScale(g) - Math.sqrt(PHI_)) < 1e-9),
  SUPERS.map(g => honourScale(g).toFixed(3)).join(' '));
check('and no other level doubles up — sharing is the exception, not the rule',
  (() => {
    const seen = new Map();
    for (const g of GRID_ORDER) {
      const r = honourRung(g);
      seen.set(r, [...(seen.get(r) || []), g]);
    }
    const shared = [...seen.values()].filter(l => l.length > 1);
    return shared.length === 1 && shared[0].length === 2;
  })());

/* ---- the bar ---- */

eq('the default bar is the semi-finals', honourStep(HONOUR_DEFAULT).rank, 2);
eq('and it is one of the four on offer, not a fifth nobody can get back to',
  HONOUR_STEPS.filter(s => s.key === HONOUR_DEFAULT).length, 1);
eq('a bar nobody set falls back to it, rather than showing everything',
  honourStep('nonsense').key, HONOUR_DEFAULT);
eq('and so does no bar at all', honourStep(undefined).key, HONOUR_DEFAULT);
check('the bars are the four rounds that are worth naming, hardest last',
  HONOUR_STEPS.map(s => s.rank).join(' ') === '3 2 1 0');

/* ---- a career as honours ---- */

const shiH = careerHonours(shiRows, 3);
const anH = careerHonours(anRows, 3);

eq('SHI Yu Qi entered two Olympics', shiH.entries.get('OLY'), 2);
eq('and both are honours at QF+', (shiH.by.get('OLY') || []).length, 2);
check('because both were quarter-finals',
  shiH.by.get('OLY').every(c => c.info.label === 'QF'),
  shiH.by.get('OLY').map(c => `${c.year} ${c.info.label}`).join(', '));

const shiWorlds = shiH.by.get(20) || [];
eq('his best Worlds is the 2025 title', shiWorlds[0].info.label, 'W');
eq('and it is first, because a row is sorted best first', shiWorlds[0].year, 2025);
check('with the rest in descending order of how far he got',
  shiWorlds.every((c, i) => i === 0 || c.rank >= shiWorlds[i - 1].rank),
  shiWorlds.map(c => c.info.label).join(' '));
check('and ties broken oldest first, so the row does not reshuffle itself',
  (() => {
    const s1000 = shiH.by.get(23) || [];
    return s1000.every((c, i) => i === 0
      || c.rank > s1000[i - 1].rank
      || String(c.tmt.start) >= String(s1000[i - 1].tmt.start));
  })());

eq('AN Se Young won Paris 2024', (anH.by.get('OLY') || [])[0].info.label, 'W');
eq('and it outranks her Tokyo quarter-final', (anH.by.get('OLY') || [])[1].info.label, 'QF');

/* ---- raising the bar ---- */

const counted = h => [...h.by.values()].reduce((a, l) => a + l.length, 0);
const shiBars = HONOUR_STEPS.map(s => counted(careerHonours(shiRows, s.rank)));
check('raising the bar can only ever remove results',
  shiBars.every((n, i) => i === 0 || n <= shiBars[i - 1]), shiBars.join(' >= '));
check('and what survives is a subset of what was there before',
  (() => {
    const wide = new Set((careerHonours(shiRows, 3).by.get(23) || []).map(c => c.tmt.code));
    return (careerHonours(shiRows, 0).by.get(23) || []).every(c => wide.has(c.tmt.code));
  })());
check('at titles only, nothing below a win is left anywhere',
  [...careerHonours(shiRows, 0).by.values()].every(l => l.every(c => c.info.label === 'W')));

/* The distinction the whole ghost square exists for. Both his Olympics were
   quarter-finals, so at F+ the row is empty — and "went twice and never made a
   final" is not the same claim as "never went", which is what an empty row
   would otherwise be taken for. */
const shiF = careerHonours(shiRows, 1);
eq('at F+ his Olympic row is empty', (shiF.by.get('OLY') || []).length, 0);
eq('but the entry count still says he was there twice', shiF.entries.get('OLY'), 2);

/* And it is empty at the default bar too, which is the first thing anyone
   opening his board sees: two Games, two quarter-finals, no honour by this
   reckoning. The ghost is what stops that reading as "never went". */
const shiDefault = careerHonours(shiRows, honourStep(HONOUR_DEFAULT).rank);
eq('his Olympic row is empty at the default bar as well',
  (shiDefault.by.get('OLY') || []).length, 0);
eq('with both entries still counted', shiDefault.entries.get('OLY'), 2);
check('while AN Se Young keeps her Paris title there',
  (careerHonours(anRows, honourStep(HONOUR_DEFAULT).rank).by.get('OLY') || [])
    .some(c => c.info.label === 'W'));

check('entries never undercount the honours, at any bar',
  HONOUR_STEPS.every(s => {
    const h = careerHonours(shiRows, s.rank);
    return [...h.by].every(([g, list]) => list.length <= h.entries.get(g));
  }));
check('and entries do not move when the bar does',
  HONOUR_STEPS.every(s =>
    careerHonours(shiRows, s.rank).entries.get(23) === shiH.entries.get(23)));

/* ---- the rows to draw ---- */

const shiBoard = honourSections([shiH]);
const bothBoard = honourSections([shiH, anH]);
const groups = b => b.map(s => s.group);

check('the rows run hardest first, in the grid\'s own order',
  (() => {
    const want = GRID_ORDER.filter(g => groups(shiBoard).includes(g));
    return want.join(',') === groups(shiBoard).join(',');
  })(), groups(shiBoard).join(' '));

check('SHI Yu Qi has never entered a Super 100, so he has no such row',
  !groups(shiBoard).includes(27));
check('but comparing him with somebody who has gives them both one',
  groups(bothBoard).includes(27));
eq('and his half of it is empty', (shiH.by.get(27) || []).length, 0);
eq('with nothing entered either — which is the other kind of empty',
  shiH.entries.get(27) || 0, 0);

check('every row either player has appears exactly once',
  new Set(groups(bothBoard)).size === groups(bothBoard).length);
const anBoard = honourSections([anH]);
check('and the shared board is the union of the two',
  [...groups(shiBoard), ...groups(anBoard)].every(g => groups(bothBoard).includes(g)));
eq('and no wider than that union',
  groups(bothBoard).length, new Set([...groups(shiBoard), ...groups(anBoard)]).size);

check('a row carries the size its level earns, not one derived from the board',
  bothBoard.every(s => s.scale === honourScale(s.group)));
check('so switching a level off cannot resize the ones left',
  honourSections([shiH]).find(s => s.group === 23).scale
  === bothBoard.find(s => s.group === 23).scale);

eq('the count on a row is the most either player has, so the two line up',
  bothBoard.find(s => s.group === 23).n,
  Math.max((shiH.by.get(23) || []).length, (anH.by.get(23) || []).length));

/* ---- nothing at all ---- */

eq('a career of nothing is an empty board', honourSections([]).length, 0);
eq('and honours out of nothing is an empty map', careerHonours(null, 3).by.size, 0);
eq('with nothing entered', careerHonours(undefined, 3).entries.size, 0);


/* ============================ the tournament now ============================

   Which tournament to show, which day of it, and one day's order of play.
   Recorded on 23 August 2026 — the last day of the World Championships — so
   the fixtures hold a live tournament, its seven days, and both a day that has
   been played and one that has not.

   ⚠️ Every date below is passed in. Nothing here reads the clock, which is the
   only reason a fixture from August can be replayed in December.
   ==================================================================== */

console.log('\n=== the tournament now ===');

const WORLDS = 'B671FB97-491C-46D3-982F-56525168C3AA';
const dayMatches = (code, date) => fixture('tournaments/day-matches',
  { tournamentCode: code, date, order: 2, court: 0 });

const schedule = fixture('vue-tmt-schedule', { drawCount: 1 });

check('the schedule names all three tournaments',
  !!(schedule.nextLive && schedule.previousTmt && schedule.nextTmt),
  [schedule.nextLive, schedule.previousTmt, schedule.nextTmt]
    .map(t => t && t.name).join(' | '));

/* ---- which one is on ---- */

const on = d => pickTournament(schedule, d);

eq('on the last day of a tournament it is still live', on('2026-08-23').state, 'live');
eq('and it is the one with the live scores', on('2026-08-23').tmt.code, WORLDS);
eq('mid-tournament, the same', on('2026-08-19').state, 'live');
eq('on its first day, the same again', on('2026-08-17').state, 'live');

const before = on('2026-08-15');
eq('a week earlier it has not started', before.state, 'upcoming');
eq('and it is still the tournament being pointed at', before.tmt.code, WORLDS);

const after = on('2026-08-28');
eq('once it is over, the next one is up', after.state, 'upcoming');
eq('which is the one after, not the one just finished',
  after.tmt.name, schedule.nextTmt.name);

/* The far future: nothing in this payload has started, nothing is ahead, so the
   only honest answer left is the one that finished. */
const far = on('2027-06-01');
eq('long afterwards it falls back to the last one played', far.state, 'finished');

eq('a payload with nothing in it is nothing, not a crash',
  pickTournament({}, '2026-08-23'), null);
eq('and neither is no payload at all', pickTournament(null, '2026-08-23'), null);

/* ---- which day ---- */

const worlds = schedule.nextLive;
const days = tournamentDays(worlds);
eq('the Worlds run seven days', days.length, 7);
eq('first', days[0], '2026-08-17');
eq('last', days[6], '2026-08-23');
check('with no gaps and no repeats',
  new Set(days).size === days.length
  && days.every((d, i) => i === 0 || Date.parse(d) - Date.parse(days[i - 1]) === 86400000),
  days.join(' '));

eq('a live tournament opens on today', defaultDay(worlds, 'live', '2026-08-19'), '2026-08-19');
eq('one that has finished opens on its last day',
  defaultDay(worlds, 'finished', '2026-09-30'), '2026-08-23');
eq('one that has not started opens on its first',
  defaultDay(worlds, 'upcoming', '2026-08-01'), '2026-08-17');
eq('a tournament of one day is that day',
  tournamentDays({ start_date: '2026-05-01 00:00:00', end_date: '2026-05-01 00:00:00' }).length, 1);
eq('and one with no dates at all is no days', tournamentDays({}).length, 0);

/* ---- a day that has been played ---- */

const day19 = parseDayMatches(dayMatches(WORLDS, '2026-08-19'), '2026-08-19');
check('a full day of the Worlds is a lot of matches', day19.length > 40, `${day19.length} matches`);
check('every one of them names its draw and round',
  day19.every(m => m.draw && m.round), day19.filter(m => !m.draw || !m.round).length + ' without');
check('and has two sides with somebody on each',
  day19.every(m => m.sides.length === 2 && m.sides.every(s => s.players.length)));

const finished = day19.filter(m => m.status === 'finished');
check('most of a past day has been played', finished.length > 40, `${finished.length} finished`);
check('a finished match has a winner, and it is side 1 or side 2',
  finished.every(m => m.winner === 1 || m.winner === 2));
/* ⚠️ Not "every finished match has two games". Both a walkover and a
   retirement were played on this one day of the Worlds: the walkover has no
   score at all and the retirement has the single game it got to. */
check('and games to show for it, unless it never got that far',
  finished.every(m => m.games.length >= 2 || m.note),
  finished.filter(m => m.games.length < 2)
    .map(m => `${m.draw} ${m.note || '(no note)'} ${m.games.length}g`).join(', '));

const walkover = finished.find(m => m.note && m.note.long === 'Walkover');
check('a walkover is named as one', !!walkover);
eq('with a short form for the card', walkover.note.short, 'W/O');
eq('and has no score whatever', walkover.games.length, 0);
check('a walkover still has a winner', walkover.winner === 1 || walkover.winner === 2);
check('and neither side shows a game', walkover.sides.every(sd => !sd.games.length));

const retired = finished.find(m => m.note && m.note.long === 'Retired');
check('a retirement is named too', !!retired);
eq('with its own short form', retired.note.short, 'RET');
check('and keeps the score it reached', retired.games.length >= 1,
  retired.sides.map(sd => sd.games.map(g => g.own).join('-')).join(' vs '));
check('an ordinary match carries no note at all',
  finished.some(m => !m.note && m.games.length >= 2));

/* Each side carries its own games, which is how a scoreboard is read: a row of
   numbers beside the name. `home`/`away` in the payload are team1/team2, so the
   side that is *not* team1 has to see them the other way round — get that wrong
   and every doubles pair on the right of a card reads their opponent's score. */
const wonBy2 = finished.find(m => m.winner === 2 && m.games.length);
eq('side two sees its own games from its own end',
  wonBy2.sides[1].games.map(g => g.own).join(','),
  wonBy2.games.map(g => g.b).join(','));
eq('and side one sees the same games from the other',
  wonBy2.sides[0].games.map(g => g.own).join(','),
  wonBy2.games.map(g => g.a).join(','));
check('each side reads its opponent as the other one',
  wonBy2.sides[0].games.every((g, i) => g.opp === wonBy2.sides[1].games[i].own));
check('and the winner took more games than they lost',
  wonBy2.sides[1].games.filter(g => g.won).length
  > wonBy2.sides[0].games.filter(g => g.won).length,
  wonBy2.sides.map(sd => sd.games.map(g => g.own).join('-')).join(' vs '));

const wonBy1 = finished.find(m => m.winner === 1 && m.games.length);
check('exactly one side of a finished match is the winner',
  wonBy1.sides.filter(sd => sd.won).length === 1
  && wonBy1.sides.filter(sd => sd.lost).length === 1);

/* ---- the order of play ---- */

const cols = orderOfPlay(day19);
check('a full day uses several courts', cols.length >= 3, cols.map(c => c.court).join(', '));
eq('every match lands on exactly one court',
  cols.reduce((a, c) => a + c.matches.length, 0), day19.length);
check('courts run 1, 2, 3 … not 1, 10, 2',
  cols.every((c, i) => i === 0 || courtOrder(c.court) >= courtOrder(cols[i - 1].court)),
  cols.map(c => c.court).join(' '));
eq('"Court 10" sorts after "Court 2"', courtOrder('Court 10') > courtOrder('Court 2'), true);

/* ⚠️ The array order **is** the order of play (Part 4.7). This is the check
   that stops somebody sorting it by `matchTime` and quietly reversing a court's
   afternoon: within a court, the matches must appear in the order the payload
   gave them. */
check('a court keeps the order the payload gave it, which is the order of play',
  cols.every(c => {
    const wanted = day19.filter(m => m.court === c.court).map(m => m.id);
    return wanted.join(',') === c.matches.map(m => m.id).join(',');
  }));

const first = cols[0].matches[0];
check('the first match on a court says when it starts',
  /^Starting at /.test(first.oop), first.oop);
check('and the ones after it say they follow',
  cols[0].matches.slice(1).every(m => m.oop === 'Followed by' || /^Starting at /.test(m.oop)),
  cols[0].matches.map(m => m.oop).join(' | '));

/* ---- a day that has not been played ---- */

const day23 = parseDayMatches(dayMatches(WORLDS, '2026-08-23'), '2026-08-23');
eq('the last day is the five finals', day23.length, 5);
check('all of them finals', day23.every(m => m.round === 'Final'),
  day23.map(m => m.round).join(' '));
eq('on one court', orderOfPlay(day23).length, 1);
check('none of them played yet when this was recorded',
  day23.every(m => m.status === 'upcoming' && m.winner === 0 && !m.games.length));
check('so neither side shows a game', day23.every(m => m.sides.every(sd => !sd.games.length)));
check('and every one of them says it is scheduled',
  day23.every(m => m.statusWord === 'Scheduled'),
  [...new Set(day23.map(m => m.statusWord))].join(' | '));
eq('the five draws, in the usual order',
  drawsPresent(day23).join(' '), 'MS WS MD WD XD');


/* ---- the grid ---- */

const grid = courtGrid(day19);
check('a full day draws as a real grid', !!grid);
eq('one column per court', grid.courts.length, 4);
eq('every match placed', grid.cells.length, day19.length);

/* Row 3 means "third on this court", so two cards on the same row are at the
   same point in the day. That is the whole claim of the layout. */
check('a row is one position on court, across every court',
  grid.cells.every(c => {
    const others = grid.cells.filter(o => o.row === c.row);
    return others.every(o => o.match.seq === c.match.seq);
  }));
check('and a column is one court',
  grid.cells.every(c => {
    const others = grid.cells.filter(o => o.col === c.col);
    return others.every(o => o.match.court === c.match.court);
  }));
check('no two matches land in the same cell',
  new Set(grid.cells.map(c => c.col + ':' + c.row)).size === grid.cells.length);

/* Row-major, so a narrow screen that drops the grid and stacks the cards still
   reads down the day rather than down court one and then back to the top. */
check('the cells come out row-major, which is running order',
  grid.cells.every((c, i) => i === 0
    || c.row > grid.cells[i - 1].row
    || (c.row === grid.cells[i - 1].row && c.col > grid.cells[i - 1].col)));

eq('the finals are one court, so no grid — a list would say the same thing',
  courtGrid(day23), null);
eq('and nothing at all is no grid either', courtGrid([]), null);

/* An order of play BWF has not published yet has matches but no court, and a
   grid of them would be an invention. */
eq('a day with no courts yet is no grid',
  courtGrid(day19.map(m => ({ ...m, court: '' }))), null);
eq('and so is one where only some matches are placed',
  courtGrid(day19.map((m, i) => (i ? m : { ...m, seq: null }))), null);

/* ---- what counts as having moved ---- */

/* Compared across a refresh to mark what changed while the reader was looking
   elsewhere. Deliberately narrow: BWF rewrites the estimated times through a
   day, and including those would light up half the grid every minute. */
const sample = day19[0];
eq('the same match twice is not news', matchSignature(sample), matchSignature(sample));
check('a changed score is',
  matchSignature(sample) !== matchSignature({ ...sample, games: [{ a: 21, b: 3 }] }));
check('and so is a winner arriving',
  matchSignature(sample) !== matchSignature({ ...sample, winner: 0 }));
check('and a match going from scheduled to being played',
  matchSignature(sample) !== matchSignature({ ...sample, status: 'live' }));
check('but a re-estimated time is not',
  matchSignature(sample) === matchSignature({ ...sample, time: '23:59', oop: 'Followed by' }));
check('nor a court change, which BWF makes all day',
  matchSignature(sample) === matchSignature({ ...sample, court: 'Court 9' }));
eq('nothing has no signature', matchSignature(null), '');

eq('a day reads as a day', prettyDay('2026-08-19'), 'Wednesday 19 August');
eq('and something that is not one is left alone', prettyDay('all'), 'all');

/* ---- which day a match belongs to ---- */

check('every match is tagged with the day it was asked for',
  day19.every(m => m.day === '2026-08-19'), day19[0] && day19[0].day);
check('and the venue clock is carried with a UTC stamp to read it against',
  day19.every(m => !m.time || m.utc), day19[0] && `${day19[0].time} / ${day19[0].utc}`);

/* ---- nothing at all ---- */

eq('no payload is no matches', parseDayMatches(null).length, 0);
eq('an empty one likewise', parseDayMatches([]).length, 0);
eq('and no matches is no courts', orderOfPlay([]).length, 0);
eq('nor any draws', drawsPresent([]).length, 0);
eq('and no grid out of nothing', courtGrid([]), null);

process.exit(report());
