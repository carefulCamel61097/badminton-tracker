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
  pyramidTier, pyramidSeason, pyramidBulges, pyramidRow, PYRAMID_ROWS,
  pyramidLabel, pyramidTitleSeason, pyramidSeasonMarks, winnersSeasons,
  pyramidReigns, reignLanes, reignStep, REIGN_STEPS, REIGN_DEFAULT,
  titleWinnerIds, titleWinnerKey, winnerOf, pairName, winnerRegistry, usableAvatar,
  settleWinnerOrder,
  flatSupers, PREMIER_FROM, pyramidScale,
  parseSeason, seasonDisciplines, drawFor, drawForKind, dominantDraw,
  kindOf, seasonKinds, defaultKind, seasonLevels,
  positionInfo, fillFraction, boxSize, boxScale, levelLabel, isTeamEvent,
  shortTmtName, seasonLabels, tidyTmtName, surnameOf, levelAbbr, roundsInDraw,
  mainDrawSize, drawLadder,
  canonicalDraw, isOlympics,
  gridGroup, seasonResults, careerRows, gridSections, sectionCells, gridYears,
  resultRank, tournamentSeason, GRID_ORDER,
  ERAS, ERA_DEFAULT, ERA_GRID_ORDER, eraKey, eraGroup, gridOrder,
  gridGroupLabel, gridGroupCode, gridGroupShort,
  HONOUR_STEPS, HONOUR_DEFAULT, honourStep, honourScale, honourRung,
  careerHonours, honourSections,
  pickTournament, scheduleGroup, tournamentDays, defaultDay, parseDayMatches, orderOfPlay,
  nameScore, rosterMatches, mergeSuggestions,
  parseDrawList, parseDraw, bracketRounds, autoFromCol, fromCol, resolvedRound,
  bracketLayout, SLOT,
  drawsPresent, courtGrid, courtOrder, dayOf, matchSignature, prettyDay,
  LEVEL, SLOT_W, BOX_H, MIN_LABEL_PX, LEVEL_ORDER,
  titleWeight, dominationSeasons, thinSeasons, shortSeasonWhy,
  bestScoreFloor, SCORE_FLOOR_STEP,
  dominationRanking, rankMode, RANK_MODES, RANK_DEFAULT,
  COVID_SEASONS, isCovidSeason, COVID_MODES, COVID_DEFAULT, covidMode, normalSeason,
} from '../model.js';
import {
  posterLayout, scorePosterLayout, gridPosterLayout, honoursPosterLayout,
  tileSlot, POSTER, REIGN_COLOURS, SCORE_COLOURS, RESULT_COLOURS, TIER_RING,
} from '../poster.js';
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

/* ⚠️ Counted against the payload rather than written down. This is a live
   recording of a season still being played, so it grows: it was ten
   tournaments when this was written and eleven by September, and four checks
   failed for a reason that had nothing to do with the code. */
eq('every tournament in the payload comes through', season.length, raw.results.length);
check('there are enough of them to be worth checking', season.length >= 10, season.length);
eq('oldest first', season[0].start, '2026-01-06');
check('and the last is the latest', season[season.length - 1].start
  === season.map(t => t.start).sort().pop());
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
eq('excluded on request', parseSeason(raw, { includeTeam: false }).length,
  season.filter(t => !t.team).length);
check('and it is the team one that goes',
  !parseSeason(raw, { includeTeam: false }).some(t => t.team));

/* ============================ disciplines ============================ */

console.log('\n=== disciplines ===');
const ds = seasonDisciplines(season);
eq('MS is the commonest draw', ds[0].name, 'MS');
eq('one MS entry per tournament that had an MS draw', ds[0].count,
  season.filter(t => t.draws.some(d => d.name === 'MS')).length);
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
/* 99 rather than 8: the Superseries-era ids all have names and chip positions
   now, so an id nobody has ever seen is what tests the fallback. */
eq('a category with no chip position is listed anyway, not dropped',
  seasonLevels([{ cat: 23 }, { cat: 99 }, { cat: 3 }, { cat: 25 }]).join(' '), '23 25 3 99');
eq('and it gets a name rather than a blank chip', levelLabel(99), 'Level 99');
eq('abbreviated under the square', levelAbbr(99), 'Lv 99');
eq('an unmapped level keeps full size — a guess would shrink it wrongly',
  boxSize(99).h, BOX_H);

/* ---- the Superseries era ---- */

eq('a Superseries Premier is named, not numbered', levelLabel(8), 'Superseries Premier');
eq('and fits under a square', levelAbbr(8), 'SS Prem');
eq('Superseries', levelLabel(2), 'Superseries');
eq('Grand Prix Gold', levelLabel(3), 'Grand Prix Gold');
eq('Grand Prix', levelLabel(4), 'Grand Prix');
eq('every old tier has a chip position like any other',
  LEVEL_ORDER.filter(c => [8, 2, 3, 4].includes(c)).length, 4);

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
eq('a paginated response parses the same', parseSeason(paginated).length, season.length);
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
/* A Grand Prix Gold is drawn where a Super 300 is drawn, so careers either
   side of 2018 can be laid against each other at all. */
eq('a Grand Prix Gold is drawn as a Super 300',
  gridGroup(findTmt(shi, /^Korea Grand Prix Gold$/)), 26);
eq('a senior id with no mapping at all still lands in OTHER',
  gridGroup({ cat: 99, name: 'Some Invented Open 2015', draws: [{ name: 'MS' }] }), 'OTHER');

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

/* ---- the multi-sport games, which no id can find ----

   BWF has filed one tournament, the Asian Games, under four different category
   ids and under none at all, and the 2023 European Games under the Continental
   Championships' own id. Every case below is a real row out of the recorded
   payloads, not an invented one. */

console.log('\n--- the regional games ---');

const games = (name, cat, draw = 'MS', start = '2018-08-23') =>
  gridGroup({ cat, name, start, draws: [{ name: draw, raw: draw }] });

eq('the Asian Games as category 1 (2010)',
  games('Guangzhou 2010 Asian Games', 1, 'MS', '2010-11-13'), 'GAMES');
eq('as category 1 again but a different name (2014)',
  games('17th Asian Games 2014', 1, 'MS', '2014-09-24'), 'GAMES');
eq('as category 16 (2018)',
  games('Asian Games 2018 ( Individual Event)', 16, 'WS', '2018-08-23'), 'GAMES');
eq('as category 74 (2022, played 2023)',
  games('ASIAN Games 2022 (Individual Event)', 74, 'MS', '2023-10-02'), 'GAMES');
eq('and with no category at all (2006)',
  games('Doha 2006 Asian Games', null, 'MS', '2006-11-30'), 'GAMES');
eq('the Commonwealth Games', games('2018 Commonwealth Games', 16), 'GAMES');
eq('the European Games as category 28', games('European Games 2019', 28, 'XD'), 'GAMES');
/* ⚠️ The name has to be tried before the id, not after it. BWF filed this one
   under 11 — the Continental Championships — so an id-first rule would draw the
   2023 European Games as a Continental and the 2019 one as Unmapped. */
eq('and as category 11, which is the Continentals own id',
  games('2023 European Games', 11, 'MS', '2023-06-26'), 'GAMES');

/* ⚠️ The team editions are separate tournaments under near-identical names, and
   they stay out. They are caught by their *draws* — a tie names them bare — so
   this holds whatever id they carry, which is just as well: the 2018 team and
   individual editions are both category 16. */
eq('the Asian Games team event is still not on the board',
  games('Asian Games 2018 (Team Event)', 16, 'Singles'), null);
eq('nor the Commonwealth Games team event',
  games('Glasgow 2014 Commonwealth Games - Mixed Team Event', 1, 'Singles'), null);
eq('nor the non-ranking one', games('ASIAN Games 2022 (Team Event) - Non World Ranking', 29, 'Singles'), null);

/* ⚠️ "Olympic Games" contains "Games". The continents are named one by one
   rather than matching the word, or the Olympics would lose their own row. */
eq('the Olympics are not a regional games',
  gridGroup({ cat: 'OLY', name: 'Paris 2024 Olympic Games', start: '2024-07-27',
    draws: [{ name: 'MS' }] }), 'OLY');
eq('and the Youth Olympics are still junior',
  games('2014 Youth Olympic Games', 33), null);

/* Sub-regional games are a slice of one continent and stay where they were. An
   East Asian Games title and an Asian Games title are not the same claim.
   ⚠️ "East Asian Games" contains "Asian Games", so this is only true because
   the sub-regional names are tested first. */
/* This one BWF sends with no category *and* a name nothing recognises, which
   leaves literally nothing to place it by, so it is not drawn at all. Unchanged
   behaviour, pinned here because it is the one sub-regional games that differs
   from the one below and the difference is the missing id, not the name. */
eq('the East Asian Games, which arrive with no category either, are not drawn',
  games('Hong Kong 2009 East Asian Games', null, 'MS', '2009-12-11'), null);
eq('and the Mediterranean Games',
  games('Tarragona 2018 Mediterranean Games', 16, 'WD', '2018-06-23'), 'OTHER');

eq('a regional games is drawn the size of a Continental',
  honourScale('GAMES'), honourScale(11));
eq('and is named rather than left as an id', gridGroupLabel('GAMES'), 'Regional Games');
eq('with a short form for the gutter, like the long era names',
  gridGroupShort('GAMES'), 'Games');

/* ---- before the Superseries, the id means nothing ----

   Verified live on 30 Aug 2026 (tools/probe-early.mjs): in 2006 the World
   Championships, the All England and an International Series are all category
   6. Reading that id as a tier dropped seven of LIN Dan's ten 2006 tournaments,
   an All England title among them. */

console.log('\n--- BWF categories before 2007 ---');

const old2006 = (name, cat = 6) =>
  gridGroup({ cat, name, start: '2006-03-08', draws: [{ name: 'MS' }] });

eq('the 2006 World Championships, filed as an International Series',
  old2006('BWF World Championships 2006'), 20);
eq('the 2006 All England, filed the same way, is unmapped rather than gone',
  old2006('YONEX ALL ENGLAND OPEN 2006'), 'OTHER');
eq('and so is a 2006 Open under a different useless id',
  old2006('Yonex Japan Open 2006', 1), 'OTHER');
eq('a 2006 Continental is still rescued by its name',
  old2006('Badminton Asia Championships 2006'), 11);

/* ⚠️ 2007 is the first Superseries season and its ids are mostly right, so they
   are still read. Only the feeder-circuit ids are not believed yet: BWF was
   still filing Grand Prix events as category 6 that year, which dropped a title
   from each of the two careers this all exists for. */
const in2007 = (name, cat) =>
  gridGroup({ cat, name, start: '2007-10-12', draws: [{ name: 'MS' }] });

eq('a 2007 Superseries is read from its id, which is right',
  in2007('HONG KONG SUPER SERIES 2007', 2), 24);
eq('a 2007 Superseries Premier likewise', in2007('YONEX All England 2007', 8), 23);
eq('but a 2007 event filed below the World Tour is unmapped, not dropped',
  in2007('YONEX German Open 2007', 6), 'OTHER');
eq('and the same for the other career it cost a title',
  in2007('Philippines Open  2007', 6), 'OTHER');
/* From 2008 the feeder ids are believed again, which is what keeps the grid to
   Super 100 and above. */
eq('a 2008 International Series is below the grid and out',
  gridGroup({ cat: 6, name: 'Some International Series 2008', start: '2008-05-01',
    draws: [{ name: 'MS' }] }), null);
/* ⚠️ And a tournament with no date at all is treated as modern rather than as
   pre-2007 — the rescue is for seasons known to be old, not for missing data. */
eq('a tournament with no date is not given the benefit of the doubt',
  gridGroup({ cat: 6, name: 'Welsh International 2022', draws: [{ name: 'MS' }] }), null);

/* ---- draw names BWF only used once ---- */

console.log('\n--- draw names ---');

/* ⚠️ An unrecognised draw name is read as a *team tie*, which removes the
   result from every singles view without erroring. BWF shipped "Men's Single",
   singular, exactly once — LIN Dan's 2007 German Open, a title. */
eq('the singular is still a singles draw', canonicalDraw("Men's Single"), 'MS');
eq('shouting, as BWF also sends it', canonicalDraw("MEN'S SINGLE"), 'MS');
eq('and the plural still works', canonicalDraw("Men's Singles"), 'MS');
eq('a singular doubles too', canonicalDraw("Men's Double"), 'MD');
/* The junior mixed draws carry no gender word and no "doubles", so they fell
   through the whole function. */
eq('a junior mixed draw with a space', canonicalDraw('XD U19'), 'XD');
eq('and with a hyphen', canonicalDraw('XD-U19'), 'XD');
/* ⚠️ Still a team tie, which is the whole reason the fallback exists: a tie
   names its draws with no gender because the *tie* is the competitor. */
eq('a bare Singles is still a team tie', canonicalDraw('Singles'), null);
eq('and a bare Doubles', canonicalDraw('Doubles'), null);

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
/* He no longer *has* an Unmapped block: his one unmapped result was the 2018
   Asian Games, which now has a section that says so. When there is one it is
   last, which the GRID_ORDER check above already pins. */
check('his Asian Games is a section that names it, not the Unmapped heap',
  shiSections.some(x => x.group === 'GAMES') && !shiSections.some(x => x.group === 'OTHER'),
  shiSections.map(x => x.code).join(' '));

/* Five, not four. 2017 ran five Superseries Premier events and they are drawn
   where the Super 1000s are, so the block is as wide as the widest season
   anybody here played — which is the rule, not an exception to it. */
eq('five Super 1000 slots once the Premier era is counted', sec(23).n, 5);
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
eq('the Super 1000 block is five cells', s1000cells.length, 5);
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
/* Two levels share that rung now — the Continentals and the regional
   multi-sport games — and both are listed immediately above it, so the run of
   five Super rows below is still unbroken. */
check('and are listed directly above them, contiguously',
  GRID_ORDER.slice(GRID_ORDER.indexOf(11), GRID_ORDER.indexOf(23)).join(' ') === '11 GAMES',
  GRID_ORDER.join(' '));
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
    // One rung, shared by three: Super 1000, Continental, Regional Games.
    return shared.length === 1 && shared[0].length === 3;
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

/* He has one now: a Grand Prix is drawn where a Super 100 is drawn. Before the
   era mapping his whole junior-and-Grand-Prix past sat in Unmapped, which is
   what made a career like LIN Dan's incomparable. */
check('SHI Yu Qi has a Super 100 row, by way of the Grand Prix he played',
  groups(shiBoard).includes(27));
check('and every result in it came from before the World Tour',
  (shiH.entries.get(27) || 0) > 0
  && (careerRows(shi, 'singles', null)
    .flatMap(r => [...(r.by.get(27) || [])]).every(c => c.from)),
  careerRows(shi, 'singles', null)
    .flatMap(r => [...(r.by.get(27) || [])]).map(c => c.from).join(', '));

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
/* Which of the two upcoming slots wins is not worth pinning: they can start on
   the same day, and the schedule fixture moves every time it is re-recorded.
   What matters is that it is ahead of the reader, not behind them. */
check('and it is one that has not been played yet',
  dayOf(after.tmt.start_date) > '2026-08-28', dayOf(after.tmt.start_date));
check('picked from what the payload actually offers',
  [schedule.nextLive, schedule.nextTmt, schedule.previousTmt]
    .some(t => t && t.code === after.tmt.code));

/* The far future: nothing in this payload has started, nothing is ahead, so the
   only honest answer left is the one that finished. */
const far = on('2027-06-01');
eq('long afterwards it falls back to the last one played', far.state, 'finished');

eq('a payload with nothing in it is nothing, not a crash',
  pickTournament({}, '2026-08-23'), null);
eq('and neither is no payload at all', pickTournament(null, '2026-08-23'), null);

/* ======================== matching a name as it is typed ========================

   ⚠️ **BWF's search is alphabetical, not relevant.** `vue-popular-players`
   returns page 1 of a list ordered by given name, so measured on 3 September
   2026: "viktor" put Viktor AXELSEN at index 13 of 30, "chen" did not contain
   CHEN Yu Fei and "an" did not contain AN Se Young — the reigning world number
   ones, absent from their own names. Nothing done to the answer fixes that;
   they are not in it. So the top of each ranking table is matched locally
   first, and this is that matching.
   ==================================================================== */

console.log('\n=== matching a typed name ===');

/* Real names, in the two forms BWF uses for the same people: the ranking tables
   say "AN Se Young", the search endpoint says "Se Young AN". */
const ROSTER = [
  { id: '1', name: 'AN Se Young', rank: 1 },
  { id: '2', name: 'Jonatan CHRISTIE', rank: 1 },
  { id: '3', name: 'CHEN Yu Fei', rank: 4 },
  { id: '4', name: 'CHOU Tien Chen', rank: 4 },
  { id: '5', name: 'Anders ANTONSEN', rank: 5 },
  { id: '6', name: 'SHI Yu Qi', rank: 6 },
  { id: '7', name: 'Akane YAMAGUCHI', rank: 3 },
  { id: '8', name: 'Kunlavut VITIDSARN', rank: 3 },
];
const hit = q => rosterMatches(ROSTER, q).map(p => p.name);

eq('a surname finds its owner', hit('christie').join(), 'Jonatan CHRISTIE');
eq('and a given name does too', hit('akane').join(), 'Akane YAMAGUCHI');
eq('a prefix is enough', hit('vitid').join(), 'Kunlavut VITIDSARN');

/* ⚠️ Word by word and in any order, because the same player is stored both ways
   round. A reader types the name as the site displays it; BWF's search holds
   the other one. */
eq('surname first, as the site writes it', hit('an se young').join(), 'AN Se Young');
eq('given name first, as BWF stores it', hit('se young an').join(), 'AN Se Young');
eq('two words out of three', hit('se young').join(), 'AN Se Young');
eq('and the words need not be adjacent', hit('shi qi').join(), 'SHI Yu Qi');

/* ⚠️ The rank is the tie-break, which is the entire reason for holding a
   roster rather than sorting BWF's answer harder: "an" matches three of these
   and the world number one has to be the first of them. */
eq('an ambiguous prefix puts the highest-ranked first',
  hit('an')[0], 'AN Se Young');
check('without dropping the others', hit('an').length >= 2, hit('an').join(' | '));
eq('a whole word beats a prefix of a longer one',
  hit('chen')[0], 'CHEN Yu Fei');
check('and CHOU Tien Chen is still offered', hit('chen').includes('CHOU Tien Chen'));

eq('a name nobody here has finds nobody', hit('axelsen').length, 0);
eq('one letter is not a query', hit('a').length, 0);
eq('and neither is nothing', hit('').length, 0);
eq('an empty roster is empty, not a crash', rosterMatches([], 'chen').length, 0);
eq('and so is no roster at all', rosterMatches(null, 'chen').length, 0);

eq('a name scores -1 when it does not match', nameScore('CHEN Yu Fei', 'axelsen'), -1);
check('an exact whole-name match outscores a partial one',
  nameScore('CHEN Yu Fei', 'chen yu fei') > nameScore('CHEN Yu Fei', 'ch'));

/* ---- and then BWF's answer underneath ---- */

/* ⚠️ **Local first, never local only.** The roster is the current top of five
   ranking tables. LIN Dan and LEE Chong Wei are retired and in none of them,
   and they are the comparison this whole project was built for. */
const REMOTE = [
  { id: '3', name: 'CHEN Yu Fei' },        // already local, must not double up
  { id: '90', name: 'Dan LIN' },
  { id: '91', name: 'Chong Wei LEE' },
];
const merged = mergeSuggestions(rosterMatches(ROSTER, 'chen'), REMOTE);
eq('the local matches come first', merged[0].name, 'CHEN Yu Fei');
check('and everybody BWF found is still there',
  merged.some(p => p.id === '90') && merged.some(p => p.id === '91'),
  merged.map(p => p.name).join(' | '));
eq('a player in both lists appears once',
  merged.filter(p => p.id === '3').length, 1);
eq('nothing local is still BWF alone',
  mergeSuggestions([], REMOTE).map(p => p.id).join(), '3,90,91');
eq('nothing at all is nothing', mergeSuggestions(null, null).length, 0);
check('the list is capped', mergeSuggestions(
  Array.from({ length: 40 }, (_, i) => ({ id: 'x' + i, name: 'P' + i })), REMOTE).length === 12);

/* ---- two at once, which BWF does more often than the three slots suggest ----

   Every row below is the real `vue-tmt-schedule` payload of 3 September 2026,
   when the page opened on a Super 100 while a Super 750 was running beside it.
   The slots are named for what they are to BWF — `nextLive` is the one it is
   streaming — and BWF streams several at a time, so the order is not a ranking.

   ⚠️ The payload carries **no category and no prize money**: id, code, name,
   slug, dates, two logo URLs and a label. The tier has to come out of the
   `catLogo` filename, and out of the name for the majors, whose catLogo is
   null. */

console.log('\n--- two tournaments at once ---');

const LOGO = 'https://bwfbadminton.com/wp-content/themes/fansite-2020/'
  + 'assets/images/tournament/';
const sched = (name, code, suffix, from, to) => ({
  name, code, start_date: from + ' 00:00:00', end_date: to + ' 00:00:00',
  catLogo: suffix == null ? null : `${LOGO}suffix_${suffix}-01.svg`,
});

const INDO = sched('POLYTRON Pontianak Indonesia Masters 2026', 'IND-CODE',
  100, '2026-09-01', '2026-09-06');
const CHINA = sched('LI-NING China Masters 2026', 'CHN-CODE',
  750, '2026-09-01', '2026-09-06');
const WCH = sched('BWF World Championships 2026', 'WCH-CODE',
  null, '2026-08-17', '2026-08-23');

eq('a Super 750 is read off its category logo', scheduleGroup(CHINA), 24);
eq('and a Super 100', scheduleGroup(INDO), 27);
/* ⚠️ A major has no category logo at all, so without the name it would rank
   below everything — the World Championships behind a Super 100. */
eq('a major has no logo and is found by name', scheduleGroup(WCH), 20);
eq('the Olympics too',
  scheduleGroup(sched('Paris 2024 Olympic Games', 'X', null, '2024-07-27', '2024-08-05')), 'OLY');
eq('the season-ending Finals as well',
  scheduleGroup(sched('HSBC BWF World Tour Finals 2026', 'X', null, '2026-12-16', '2026-12-20')), 22);
eq('and something with neither is simply unknown',
  scheduleGroup(sched('Some Invitational 2026', 'X', null, '2026-05-01', '2026-05-03')), null);
eq('as is nothing at all', scheduleGroup(null), null);

/* The bug, exactly as it was: BWF's own order put the Super 100 first. */
const twoOn = pickTournament(
  { nextLive: INDO, nextTmt: CHINA, previousTmt: WCH }, '2026-09-03');
eq('with two on at once the bigger one is shown', twoOn.tmt.code, 'CHN-CODE');
eq('and it is live', twoOn.state, 'live');
eq('the other is offered rather than hidden',
  twoOn.also.map(t => t.code).join(','), 'IND-CODE');

/* ⚠️ Otherwise choosing the bigger one would make the smaller one unreachable,
   which is a worse page than the one this replaced. */
const pinned = pickTournament(
  { nextLive: INDO, nextTmt: CHINA, previousTmt: WCH }, '2026-09-03', 'IND-CODE');
eq('a pin reaches the smaller one', pinned.tmt.code, 'IND-CODE');
eq('and then the bigger one is the one on offer',
  pinned.also.map(t => t.code).join(','), 'CHN-CODE');
eq('a pin naming something not on today is ignored', pickTournament(
  { nextLive: INDO, nextTmt: CHINA }, '2026-09-03', 'WCH-CODE').tmt.code, 'CHN-CODE');
eq('and so is a pin naming nothing at all', pickTournament(
  { nextLive: INDO, nextTmt: CHINA }, '2026-09-03', 'no-such-code').tmt.code, 'CHN-CODE');

/* The ordinary week: one thing on, and nothing to choose between. */
const alone = pickTournament({ nextLive: CHINA, previousTmt: WCH }, '2026-09-03');
eq('one tournament on its own is still the one shown', alone.tmt.code, 'CHN-CODE');
eq('with nothing else offered', alone.also.length, 0);

/* ⚠️ Ties keep BWF's own order, which is what makes this change a no-op
   wherever the tier cannot separate them — including two events neither of
   which has a recognisable tier. */
const tied = pickTournament({
  nextLive: sched('Alpha Open 2026', 'A', 500, '2026-09-01', '2026-09-06'),
  nextTmt: sched('Beta Open 2026', 'B', 500, '2026-09-01', '2026-09-06'),
}, '2026-09-03');
eq('two of the same size keep the payload order', tied.tmt.code, 'A');
const unknown = pickTournament({
  nextLive: sched('Alpha Invitational', 'A', null, '2026-09-01', '2026-09-06'),
  nextTmt: sched('Beta Invitational', 'B', null, '2026-09-01', '2026-09-06'),
}, '2026-09-03');
eq('and so do two the ladder cannot place', unknown.tmt.code, 'A');

/* A major running against a World Tour event is the case the name rescue is
   for: null catLogo must not mean "smallest". */
const majorWeek = pickTournament({
  nextLive: sched('SOME Super 1000 2026', 'S1000', 1000, '2026-08-17', '2026-08-23'),
  nextTmt: WCH,
}, '2026-08-20');
eq('a World Championships outranks a Super 1000', majorWeek.tmt.code, 'WCH-CODE');

/* The same choice one week earlier, before either has started. */
const ahead = pickTournament(
  { nextLive: INDO, nextTmt: CHINA }, '2026-08-25');
eq('two starting the same day: the bigger is up next too', ahead.tmt.code, 'CHN-CODE');
eq('and it has not started', ahead.state, 'upcoming');
eq('every answer carries the same shape, so no caller checks for it',
  [twoOn, pinned, alone, ahead, pickTournament({ previousTmt: WCH }, '2027-01-01')]
    .every(x => Array.isArray(x.also)), true);

/* ---- which day ---- */

/* ⚠️ Found by name, not by slot. `vue-tmt-schedule` answers "what is on *now*",
   so which of its three slots holds the Worlds moves every time the fixture is
   re-recorded — they were `nextLive` when this was written and `previousTmt`
   within the hour. */
const worlds = [schedule.nextLive, schedule.previousTmt, schedule.nextTmt]
  .find(t => t && t.code === WORLDS);
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
/* Recorded while the finals were being played, so this one day holds all three
   states at once — which is better coverage than a day that had not started.
   Asserted as invariants rather than as counts, because re-recording moves it. */
eq('every match is in exactly one of the three states',
  day23.filter(m => ['finished', 'live', 'upcoming'].includes(m.status)).length, day23.length);

const done23 = day23.filter(m => m.status === 'finished');
const live23 = day23.filter(m => m.status === 'live');
const soon23 = day23.filter(m => m.status === 'upcoming');
check('with at least one already played', done23.length > 0,
  day23.map(m => `${m.draw}:${m.status}`).join(' '));
check('a finished one has a winner and the games to show for it',
  done23.every(m => (m.winner === 1 || m.winner === 2) && m.games.length >= 2));
check('one not started has neither', soon23.every(m => !m.winner && !m.games.length));

/* ⚠️ BWF spells a live match **"In Progress"**, not "Live" — caught here on the
   day. This is why `parseMatch` reads the single letter `P` rather than the
   long-form value: a guess at that string would have been wrong. */
check('one being played has a score but no winner yet',
  live23.every(m => m.winner === 0 && m.games.length >= 1),
  live23.map(m => `${m.draw} ${m.games.map(g => g.a + '-' + g.b).join(',')}`).join(' | '));
check('and is called Live whatever BWF calls it',
  live23.every(m => m.statusWord === 'Live'),
  live23.map(m => m.statusWord).join(' | '));
check('a match not started shows no games on either side',
  soon23.every(m => m.sides.every(sd => !sd.games.length)));
check('and says it is scheduled',
  soon23.every(m => m.statusWord === 'Scheduled'),
  [...new Set(soon23.map(m => m.statusWord))].join(' | '));
eq('the five draws, in the usual order',
  drawsPresent(day23).join(' '), 'MS WS MD WD XD');


/* ---- the grid ---- */

const grid = courtGrid(day19);
check('a full day draws as a real grid', !!grid);
eq('one column per court', grid.courts.length, 4);
eq('every match placed', grid.cells.length, day19.length);

check('a column is one court',
  grid.cells.every(c => {
    const others = grid.cells.filter(o => o.col === c.col);
    return others.every(o => o.match.court === c.match.court);
  }));
check('no two matches land in the same cell',
  new Set(grid.cells.map(c => c.col + ':' + c.row)).size === grid.cells.length);

/* ⚠️ A court's cards only ever move **down** the page. Whatever the rows are
   built on, the running order of a court is the one thing the layout may never
   reorder — Part 4.7. */
const downTheCourt = g => g.courts.every(court => {
  const mine = g.cells.filter(c => c.match.court === court).sort((a, b) => a.row - b.row);
  return mine.every((c, i) => i === 0 || c.match.seq > mine[i - 1].match.seq);
});
check('and a court is read downwards, in the order of play', downTheCourt(grid));

/* Rows run forwards through the day. A row's own instant is the earliest match
   on it, so this is the check that a card can never appear above one that was
   on court before it. */
const rowClock = g => g.rows.map(r => r.at);
const clockLine = g => rowClock(g)
  .map(t => (t == null ? '—' : new Date(t).toISOString().slice(11, 16))).join(' ');
check('the rows run forwards through the day',
  rowClock(grid).every((t, i) => i === 0 || t >= rowClock(grid)[i - 1]), clockLine(grid));

/* Row-major, so a narrow screen that drops the grid and stacks the cards still
   reads down the day rather than down court one and then back to the top. */
check('the cells come out row-major, which is running order',
  grid.cells.every((c, i) => i === 0
    || c.row > grid.cells[i - 1].row
    || (c.row === grid.cells[i - 1].row && c.col > grid.cells[i - 1].col)));

/* ⚠️ Courts 1 and 2 opened at 9:00 that day and courts 3 and 4 at 9:10 — a
   published ten-minute stagger. Two half-empty rows at the top of the grid would
   say something the day did not, and a badminton match runs forty minutes at its
   shortest, so anchors that close together are read as one moment. */
eq('a ten-minute stagger at the start is still one row',
  new Set(grid.cells.filter(c => c.match.seq === 1).map(c => c.row)).size, 1);

/* ⚠️ But a genuine break is not. Courts 3 and 4 came back at 14:10 while courts
   1 and 2 played straight through, so that restart is a row of its own with two
   empty columns beside it — which is the whole point: a row is a moment, and at
   that moment nothing was happening on courts 1 and 2. */
const restart = grid.cells.find(c => c.match.court === 'Court 3' && c.match.anchored
  && c.match.seq > 1);
check('a court that comes back from a break gets its own row', !!restart,
  restart ? `Court 3 #${restart.match.seq} at ${restart.match.time} on row ${restart.row}`
    : 'no restart in the fixture');
eq('and it is shared only with the other court that broke',
  grid.cells.filter(c => c.row === restart.row).map(c => c.match.court).join(', '),
  'Court 3, Court 4');

eq('the finals are one court, so no grid — a list would say the same thing',
  courtGrid(day23), null);
eq('and nothing at all is no grid either', courtGrid([]), null);

/* An order of play BWF has not published yet has matches but no court, and a
   grid of them would be an invention. */
eq('a day with no courts yet is no grid',
  courtGrid(day19.map(m => ({ ...m, court: '' }))), null);
eq('and so is one where only some matches are placed',
  courtGrid(day19.map((m, i) => (i ? m : { ...m, seq: null }))), null);

/* ---- a court that keeps its own hours ---- */

/* ⚠️⚠️ The day that broke the positional grid, transcribed from
   `tournaments/day-matches` for the LI-NING China Masters on **4 September
   2026** — quarter-finals, three courts, venue clock UTC+8. Court 3 held two
   matches all day and each carried a published time of its own: 11:00 in the
   morning and 19:00 at night. Both were first-and-second *on their court*, so a
   grid whose rows are positions drew the 7pm match level with a 10:50 one that
   had finished eight hours earlier.

   Written out rather than recorded: the live day is a week of the calendar and
   what is being pinned here is a shape. */
const CHINA_QF = [
  ['Court 1', 1, '02:00', 'Starting at 10:00 AM'], ['Court 1', 2, '02:50', 'Followed by'],
  ['Court 1', 3, '03:45', 'Followed by'], ['Court 1', 4, '04:35', 'Followed by'],
  ['Court 1', 5, '05:25', 'Followed by'],
  ['Court 1', 6, '09:00', 'Not before 5:00 PM'], ['Court 1', 7, '09:50', 'Followed by'],
  ['Court 1', 8, '10:40', 'Followed by'], ['Court 1', 9, '11:30', 'Followed by'],
  ['Court 1', 10, '12:20', 'Followed by'],
  ['Court 2', 1, '02:00', 'Starting at 10:00 AM'], ['Court 2', 2, '02:50', 'Followed by'],
  ['Court 2', 3, '03:45', 'Followed by'], ['Court 2', 4, '04:35', 'Followed by'],
  ['Court 2', 5, '09:00', 'Not before 5:00 PM'], ['Court 2', 6, '09:50', 'Followed by'],
  ['Court 2', 7, '10:40', 'Followed by'], ['Court 2', 8, '11:30', 'Followed by'],
  ['Court 3', 1, '03:00', 'Starting at 11:00 AM'],
  ['Court 3', 2, '11:00', 'Starting at 7:00 PM'],
];
const chinaQF = parseDayMatches(CHINA_QF.map((row, i) => ({
  id: 900 + i, drawName: 'MS', roundName: 'Quarter Final',
  courtName: row[0], oopRound: row[1], oopText: row[3],
  matchTime: '2026-09-04 ' + row[2] + ':00', matchTimeUtc: '2026-09-04 ' + row[2] + ':00',
  matchStatus: 'S',
  team1: { players: [{ id: 1, nameDisplay: 'A' }] },
  team2: { players: [{ id: 2, nameDisplay: 'B' }] },
})), '2026-09-04');
eq('the day reads back whole', chinaQF.length, 20);

/* ⚠️ "Not before 5:00 PM" is a **published** time, not a 50-minute estimate. It
   reads like hedging and is not: it is how BWF opens an afternoon session, and
   both the grid's rows and the card's ≈ mark turn on the difference. */
eq('a session opening mid-day counts as a published time',
  chinaQF.filter(m => m.anchored).length, 6);
eq('and only "Followed by" is an estimate',
  [...new Set(chinaQF.filter(m => m.estimated).map(m => m.oop))].join(), 'Followed by');

const china = courtGrid(chinaQF);
const rowOf = (g, court, seq) => {
  const c = g.cells.find(x => x.match.court === court && x.match.seq === seq);
  return c ? c.row : null;
};
check('court three keeps its own hours without losing the grid', !!china);
eq('every match still placed', china.cells.length, chinaQF.length);
check('and read downwards on every court', downTheCourt(china));

/* The bug, stated the way the reader found it. */
check('a court that starts an hour later is not drawn level with the rest',
  rowOf(china, 'Court 3', 1) !== rowOf(china, 'Court 1', 1),
  'court 3 opens on row ' + rowOf(china, 'Court 3', 1)
    + ', court 1 on ' + rowOf(china, 'Court 1', 1));
check('it lands after the 10:50 matches and before the 11:45 ones',
  rowOf(china, 'Court 3', 1) > rowOf(china, 'Court 1', 2)
    && rowOf(china, 'Court 3', 1) < rowOf(china, 'Court 1', 3),
  [rowOf(china, 'Court 1', 2), rowOf(china, 'Court 3', 1), rowOf(china, 'Court 1', 3)].join(' '));
check('and its 7pm match sits with the evening, not with the morning',
  rowOf(china, 'Court 3', 2) > rowOf(china, 'Court 1', 8),
  '7pm on row ' + rowOf(china, 'Court 3', 2)
    + ', the 18:40 match on ' + rowOf(china, 'Court 1', 8));
check('the rows still run forwards through the day',
  rowClock(china).every((t, i) => i === 0 || t >= rowClock(china)[i - 1]), clockLine(china));
/* Two rows more than the ten positions on court one: the two moments court
   three had to itself, and nothing else. */
eq('which costs exactly the two rows court three needed', china.rows.length, 12);

/* ⚠️ The fallback. With no times there is nothing to place a session against,
   so the grid goes back to being positional rather than inventing an order. */
const timeless = courtGrid(chinaQF.map(m => ({ ...m, utc: '' })));
eq('a day with no times falls back to one row per position on court',
  timeless.rows.length, 10);
check('and still places everything',
  timeless.cells.length === chinaQF.length && downTheCourt(timeless));

/* ============================ the Superseries era ============================

   The whole point of the mapping: LIN Dan and LEE Chong Wei played almost
   entirely before the World Tour existed, and until their categories were
   placed on the modern ladder their careers had nothing to compare against.
   ==================================================================== */

console.log('\n=== careers from before the World Tour ===');

const lin = career(50906);          // LIN Dan
const lcw = career(50152);          // LEE Chong Wei
check('LIN Dan has a career recorded', lin.length > 8, `${lin.length} seasons`);
check('and LEE Chong Wei', lcw.length > 8, `${lcw.length} seasons`);

const linRows = careerRows(lin, 'singles', null);
const lcwRows = careerRows(lcw, 'singles', null);
const cellsOf = rows => rows.flatMap(r => [...r.by.values()].flat());
const linCells = cellsOf(linRows);

check('most of it is from before 2018 and had to be translated',
  linCells.filter(c => c.from).length > 60,
  `${linCells.filter(c => c.from).length} of ${linCells.length} mapped`);

/* Before this, everything he did sat in one Unmapped block. */
const linGroups = new Set(linRows.flatMap(r => [...r.by.keys()]));
check('he now has Super 1000 results', linGroups.has(23));
check('and Super 750', linGroups.has(24));
check('and Super 300', linGroups.has(26));
check('rather than one undifferentiated heap',
  !linGroups.has('OTHER') || linCells.filter(c => c.group === 'OTHER').length < 10,
  `${linCells.filter(c => c.group === 'OTHER').length} still unmapped`);

/* Each translated cell says what it actually was, which is what the notch and
   the tooltip in the view are drawn from. */
const froms = new Set(linCells.filter(c => c.from).map(c => c.from));
check('and each one remembers the tier it really was',
  [...froms].every(f => /Superseries|Grand Prix/.test(f)), [...froms].join(', '));

check('a Superseries Premier lands on the Super 1000 row',
  linCells.some(c => c.from === 'Superseries Premier' && c.group === 23));
check('a Superseries on the Super 750 row',
  linCells.some(c => c.from === 'Superseries' && c.group === 24));
check('a Grand Prix Gold on the Super 300 row',
  linCells.some(c => c.from === 'Grand Prix Gold' && c.group === 26));

/* ⚠️ Nothing maps to Super 500: four old tiers, five new ones. */
check('nothing of his lands on Super 500 by way of the mapping',
  !linCells.some(c => c.from && c.group === 25),
  linCells.filter(c => c.from && c.group === 25).map(c => c.from).join(', '));

/* A modern result is never marked — the notch has to mean something. */
const shiCells = cellsOf(careerRows(shi, 'singles', null));
check('a World Tour result carries no mark at all',
  shiCells.filter(c => c.tmt && Number(c.tmt.cat) >= 22 && Number(c.tmt.cat) <= 27)
    .every(c => !c.from));

/* And the two eras can finally be laid against each other. */
const bothSections = gridSections([linRows, careerRows(shi, 'singles', null)].map(r => r.map(x => x.by)));
check('LIN Dan and SHI Yu Qi share a set of blocks',
  bothSections.some(x => x.group === 23) && bothSections.some(x => x.group === 26),
  bothSections.map(x => x.code).join(' '));

const linH = careerHonours(linRows, honourStep('w').rank);
check('and his titles land on rows that mean something',
  (linH.by.get(23) || []).length + (linH.by.get(24) || []).length > 5,
  `S1000 ${(linH.by.get(23) || []).length}, S750 ${(linH.by.get(24) || []).length}`);
const lcwH = careerHonours(lcwRows, honourStep('w').rank);
check('and so do LEE Chong Wei titles',
  (lcwH.by.get(23) || []).length + (lcwH.by.get(24) || []).length > 5,
  `S1000 ${(lcwH.by.get(23) || []).length}, S750 ${(lcwH.by.get(24) || []).length}`);

/* ======================= and read the other way round =======================

   The same two careers in Superseries names. LIN Dan against LEE Chong Wei is
   the comparison this exists for, and in World Tour names every square on both
   boards is a translation into a structure neither of them ever played in.
   ==================================================================== */

console.log('\n=== the era switch ===');

eq('World Tour is the default', ERA_DEFAULT, 'wt');
eq('and junk falls back to it', eraKey('1987'), 'wt');
eq('as does nothing at all', eraKey(null), 'wt');
eq('but a real era is kept', eraKey('ss'), 'ss');
eq('there are two of them', ERAS.length, 2);

/* ---- the two ladders ---- */

eq('the era ladder is derived, not written out',
  ERA_GRID_ORDER.join(' '), 'OLY 20 22 11 GAMES 8 2 3 4 OTHER');
eq('and gridOrder hands back the right one',
  gridOrder('wt').join(' '), GRID_ORDER.join(' '));

check('every World Tour tier has somewhere to land in the other era',
  GRID_ORDER.every(g => ERA_GRID_ORDER.includes(eraGroup(g, 'ss'))),
  GRID_ORDER.map(g => g + '->' + eraGroup(g, 'ss')).join(' '));

eq('the Super 750 and the Super 500 share the Superseries row',
  eraGroup(24, 'ss') + ' ' + eraGroup(25, 'ss'), '2 2');
eq('which is the one row the two ladders do not agree about',
  GRID_ORDER.length - ERA_GRID_ORDER.length, 1);

check('nothing moves at all in World Tour mode',
  GRID_ORDER.every(g => eraGroup(g, 'wt') === g));
check('and the majors move in neither',
  ['OLY', 20, 22, 11, 'OTHER'].every(g => eraGroup(g, 'ss') === g));

/* ---- names ---- */

eq('a Super 1000 row is a Superseries Premier row',
  gridGroupLabel(eraGroup(23, 'ss'), 'ss'), 'Superseries Premier');
eq('a Super 750 row is a Superseries row',
  gridGroupLabel(eraGroup(24, 'ss'), 'ss'), 'Superseries');
eq('a Super 300 row is a Grand Prix Gold row',
  gridGroupLabel(eraGroup(26, 'ss'), 'ss'), 'Grand Prix Gold');
/* The one row that keeps its rung and changes its name. */
eq('and the Tour Finals were the Superseries Finals',
  gridGroupLabel(22, 'ss'), 'Superseries Finals');
eq('which is not what the other era calls them',
  gridGroupLabel(22, 'wt'), 'Tour Finals');
eq('every era row fits the three characters over a column',
  ERA_GRID_ORDER.map(g => gridGroupCode(g, 'ss')).join(' '),
  'OLY WCH SSF CON GMS SSP SS GPG GP OTH');
check('and no era row falls back to its bare id',
  ERA_GRID_ORDER.every(g => !/^\d+$/.test(gridGroupCode(g, 'ss'))));

/* ⚠️ **Twelve**, not the fourteen the arithmetic gives: the row's count sits in
   the gutter beside the label. Set at 14 first, and "Regional Games" went out
   with its last letter shaved off — caught by a screenshot, which is twice now
   that this number has been wrong in the same direction. */
const GUTTER = 12;
check('every level fits the honours gutter in either era',
  [...GRID_ORDER, ...ERA_GRID_ORDER].every(g =>
    gridGroupShort(g, 'wt').length <= GUTTER && gridGroupShort(g, 'ss').length <= GUTTER),
  [...GRID_ORDER, ...ERA_GRID_ORDER].map(g => gridGroupShort(g, 'ss'))
    .filter(t => t.length > GUTTER).join(' | ') || 'all fit');
/* The regional games is the only World Tour section whose name does not fit;
   every tier's does, which is why the era switch is where this mattered. */
eq('and nothing else is shortened that did not need to be',
  GRID_ORDER.filter(g => gridGroupShort(g, 'wt') !== gridGroupLabel(g, 'wt')).join(' '),
  'GAMES');
eq('the tooltip still carries the whole name',
  gridGroupLabel(8, 'ss'), 'Superseries Premier');
eq('while the gutter carries a form of it that fits',
  gridGroupShort(8, 'ss'), 'SS Premier');

/* ---- sizes ----

   The load-bearing check. Switching vocabulary must not resize an Olympic
   square: if it did, the two readings would not be two readings of one board,
   and nothing could be held against anything. */

check('an era row is exactly the size of the modern row it is drawn over',
  [[23, 8], [24, 2], [26, 3], [27, 4]].every(pair =>
    honourScale(pair[0]) === honourScale(pair[1])),
  [[23, 8], [24, 2], [26, 3], [27, 4]]
    .map(pair => pair[0] + ':' + honourScale(pair[0]).toFixed(3)
      + ' ' + pair[1] + ':' + honourScale(pair[1]).toFixed(3)).join('  '));
check('and the majors are the same size in both',
  ['OLY', 20, 22, 11].every(g => honourScale(g) === honourScale(eraGroup(g, 'ss'))));

/* The Super 500's rung is not reassigned, it is left standing empty — so the
   step from Superseries down to Grand Prix Gold is twice every other step,
   which is the shape of a tier having split rather than been renamed. */
near('the empty Super 500 rung leaves a double step',
  honourScale(2) / honourScale(3), honourScale(23) / honourScale(25), 1e-9);
near('while every other step on the era ladder is a single one',
  honourScale(8) / honourScale(2), honourScale(23) / honourScale(24), 1e-9);

/* ---- the careers ---- */

const linSS = careerRows(lin, 'singles', null, 'ss');
const lcwSS = careerRows(lcw, 'singles', null, 'ss');
const linSSCells = cellsOf(linSS);
const lcwSSCells = cellsOf(lcwSS);
const lcwCells = cellsOf(lcwRows);

eq('switching era loses no result of LIN Dan', linSSCells.length, linCells.length);
eq('nor gains LEE Chong Wei one', lcwSSCells.length, lcwCells.length);

const ssGroups = new Set(linSS.flatMap(r => [...r.by.keys()]));
check('his Superseries Premiers are on a Superseries Premier row', ssGroups.has(8));
check('his Superseries on a Superseries row', ssGroups.has(2));
check('his Grand Prix Golds on a Grand Prix Gold row', ssGroups.has(3));
check('and no row on the board is called Super anything',
  ![23, 24, 25, 26, 27].some(g => ssGroups.has(g)), [...ssGroups].join(' '));

/* ---- the notch, which has to keep meaning one thing ---- */

check('now it is the modern results that are marked',
  linSSCells.filter(c => c.from).every(c => /^Super \d+$/.test(c.from)),
  [...new Set(linSSCells.filter(c => c.from).map(c => c.from))].join(', '));
check('and a Superseries Premier is simply a Superseries Premier',
  linSSCells.filter(c => c.tmt && String(c.tmt.cat) === '8').every(c => !c.from),
  linSSCells.filter(c => c.tmt && String(c.tmt.cat) === '8').length + ' of them');

/* Symmetric, and that is the whole claim: a square is a translation in exactly
   one of the two readings, never in both. The two lists are built from the same
   career in the same order, so they line up index for index. */
check('no result is a translation in both readings at once',
  linCells.every((c, i) => !(c.from && linSSCells[i] && linSSCells[i].from)),
  linCells.filter((c, i) => c.from && linSSCells[i] && linSSCells[i].from).length
  + ' marked twice');
check('and a result on the tier ladder is a translation in one of them',
  linCells.filter((c, i) => c.tmt
    && [2, 3, 4, 8, 23, 24, 25, 26, 27].includes(Number(c.tmt.cat)))
    .length > 100);

/* ---- the Super 500, which is the cost of reading it this way ---- */

const wt500 = linCells.filter(c => c.group === 25);
check('LIN Dan really does have Super 500 results', wt500.length >= 8, wt500.length + '');
const ss500 = linSSCells.filter(c => c.from === 'Super 500');
eq('and in Superseries names every one of them is marked', ss500.length, wt500.length);
check('each folded up into the Superseries row rather than left loose',
  ss500.every(c => c.group === 2), [...new Set(ss500.map(c => c.group))].join(' '));
check('so it is drawn a rung higher than it was, which the notch admits to',
  honourScale(2) > honourScale(25));

/* LEE Chong Wei retired before the World Tour was two seasons old, which is the
   case the switch exists for: read this way his board stops being a translation
   almost entirely. */
check('LEE Chong Wei has barely anything left to translate',
  lcwSSCells.filter(c => c.from).length < lcwCells.filter(c => c.from).length / 10,
  lcwSSCells.filter(c => c.from).length + ' marked, against '
  + lcwCells.filter(c => c.from).length + ' in World Tour names');

/* ---- and the blocks a comparison is drawn on ---- */

const ssSections = gridSections([linSS, lcwSS].map(r => r.map(x => x.by)), 'ss');
eq('the two of them share one era ladder, hardest first',
  ssSections.map(x => x.code).join(' '),
  ERA_GRID_ORDER.filter(g => ssSections.some(x => x.group === g))
    .map(g => gridGroupCode(g, 'ss')).join(' '));
check('with a Superseries Premier block on it',
  ssSections.some(x => x.code === 'SSP'), ssSections.map(x => x.code).join(' '));

const ssH = honourSections([careerHonours(linSS, honourStep('w').rank),
  careerHonours(lcwSS, honourStep('w').rank)], 'ss');
check('and an honours board that names its rows the same way',
  ssH.length > 0 && ssH.every(r => r.label === gridGroupLabel(r.group, 'ss')),
  ssH.map(r => r.label).join(' | '));

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

/* ============================ the winners' pyramid ============================ */

/* ⚠️ The calendar's `category` is a display string and it has changed twice.
   Every one of these is a real row from `vue-grouped-year-tournaments`. */
const tierOf = (name, category) => pyramidTier({ name, category });

eq('a modern World Championships',
  tierOf('BWF World Championships 2026', 'Grade 1 – Individual Tournaments'), 20);
eq('the Olympics, which shares its category with the Worlds',
  tierOf('Paris 2024 Olympic Games Badminton Competition', 'Grade 1 – Individual Tournaments'), 'OLY');
eq('a Super 1000', tierOf('PETRONAS Malaysia Open 2026', 'HSBC BWF World Tour Super 1000'), 23);
eq('a Super 750', tierOf('DAIHATSU Japan Open 2026', 'HSBC BWF World Tour Super 750'), 24);
eq('the Tour Finals', tierOf('HSBC BWF World Tour Finals 2026', 'HSBC BWF World Tour Finals'), 22);

/* ⚠️ The two traps, both real. The 2017 World Championships is filed under
   "BWF Events" with the club championships; the Dubai Superseries Finals is
   filed under "World Superseries Premier" with the Superseries Premier events
   — the same category-8 ambiguity `gridGroup` already has to survive. This is
   why names are matched before categories. */
eq('the 2017 Worlds, filed under BWF Events',
  tierOf('TOTAL BWF World Championships 2017', 'BWF Events'), 20);
eq('the Superseries Finals, filed as a Superseries Premier',
  tierOf('Dubai World Superseries Finals 2017', 'World Superseries Premier'), 22);

/* The season-ending final has been called five things across twenty years, and
   in 2008 and 2009 it was the "World Super Series **Masters** Finals" — which
   an exact phrase misses. It then fell through to its category, which says
   Superseries Premier, and the year's biggest World Tour title was drawn as a
   Super 1000. Matching the bracketing words with a bounded gap catches all of
   them without catching the team cups. */
eq('the 2008 Masters Finals',
  tierOf('World Super Series Masters Finals 2008', 'World Superseries Premier'), 22);
eq('and 2009, shouting',
  tierOf('YONEX-SUNRISE BWF WORLD SUPER SERIES MASTERS FINALS 2009', 'World Superseries Premier'), 22);
eq('the 2010 edition, which was played in January 2011',
  tierOf('VICTOR- BWF Superseries Finals 2010', 'World Superseries Premier'), 22);
eq('while an actual Superseries Premier is drawn where a Super 1000 is',
  tierOf('YONEX All England 2017', 'World Superseries Premier'), 23);
eq('and a Superseries where a Super 750 is',
  tierOf('DAIHATSU YONEX Japan Open 2017', 'World Superseries'), 24);

/* Team events are out — they would rank a player by the country they were born
   in, which is the one thing this chart must not do. */
eq('Thomas & Uber Cup', tierOf('BWF Thomas & Uber Cup Finals 2026', 'Grade 1 – Team Tournaments'), null);
eq('Sudirman Cup', tierOf('TotalEnergies BWF Sudirman Cup Finals 2023', 'Grade 1 – Team Tournaments'), null);
eq('an Asian Games team event', tierOf('Asian Games 2018 (Team Event)', 'Other'), null);
/* ⚠️ But not by the word "cup" alone: a World Tour event may be named one. */
eq('a Super 750 that happens to be called a cup',
  tierOf('YONEX German Cup 2026', 'HSBC BWF World Tour Super 750'), 24);

/* Regional multi-sport games are out too, and deliberately. Each is closed to
   most of the world, so including any one of them picks a region — the Asian
   Games would hand a tile to players LEE Chong Wei could not beat and delete
   the Commonwealth Games golds he did win. */
eq('the Asian Games', tierOf('20th Asian Games Aichi-Nagoya 2026 (Individual)', 'Multi-Sport Games'), null);
eq('the Commonwealth Games', tierOf('2018 Commonwealth Games', 'Other'), null);
eq('the European Games', tierOf('2023 European Games', 'Continental Individual Championships'), null);
eq('a continental championship', tierOf('2026 European Championships', 'Continental Individual Championships'), null);

/* Junior, para and student events share names with the real ones. */
eq('the junior Worlds', tierOf('BWF World Junior Championships 2010', 'BWF Events'), null);
eq('the para Worlds', tierOf('BWF Para-Badminton World Championships 2017', 'Para-Badminton'), null);
eq('the Youth Olympics',
  tierOf('Youth Olympic Games Dakar 2026', 'Grade 1 – Individual Junior Tournaments'), null);
eq('the university games',
  tierOf('13th World University Badminton Championship-Individual Event', 'BWF Events'), null);

/* ---- a season, laid out ---- */

const pyWho = { 1: { n: 'A ONE' }, 2: { n: 'B TWO' }, 3: { n: 'C THREE' } };
const pySeason = [
  { tier: 24, name: 'Japan Open', date: '2026-08-20', w: 2 },
  { tier: 20, name: 'Worlds', date: '2026-08-25', w: 1 },
  { tier: 23, name: 'Malaysia Open', date: '2026-01-06', w: 1 },
  { tier: 24, name: 'India Open', date: '2026-01-16', w: 3 },
  { tier: 22, name: 'Tour Finals', date: '2026-12-11', w: 1 },
];
const pyRows = pyramidSeason(pySeason, pyWho);
eq('four rows, summit first', pyRows.map(r => r.key).join(' '), 'major finals s1000 s750');
eq('the summit holds the Worlds', pyRows[0].tiles.length, 1);
eq('and knows who won it', pyRows[0].tiles[0].who.n, 'A ONE');
eq('the base holds both Super 750s', pyRows[3].tiles.length, 2);
eq('in the order they were played',
  pyRows[3].tiles.map(t => t.name).join(' '), 'India Open Japan Open');

/* Sizes come from the honours ladder, so a Super 1000 square is the same size
   here as it is there. */
near('a Super 750 tile', pyRows[3].tiles[0].scale, honourScale(24));

/* ⚠️ **Except at the summit.** The Olympics outranks the Worlds on the honours
   ladder and is drawn the *same size* here, because they share a row and two
   faces on one line at two different sizes read as a layout accident rather
   than as a ranking. The gold ring is what tells them apart; `pyramidScale` is
   what makes them match, and it must not leak back into `honourScale`. */
eq('an Olympic square is drawn at the Worlds size',
  pyramidSeason([{ tier: 'OLY', name: 'Games', date: '2028-07-01', w: 1 }],
    pyWho, 2028)[0].tiles[0].scale, pyRows[0].tiles[0].scale);
check('while the honours ladder still ranks it above',
  honourScale('OLY') > honourScale(20),
  `${honourScale('OLY').toFixed(3)} vs ${honourScale(20).toFixed(3)}`);
eq('and every other tier is unchanged by it',
  [22, 23, 24].map(t => pyramidScale(t) === honourScale(t)).join(), 'true,true,true');

/* ⚠️ An empty row is kept. A season with no Tour Finals should show a hole
   where it goes, not close the gap and pretend the shape is different. */
const pyThin = pyramidSeason([{ tier: 23, name: 'One', date: '2026-01-01', w: 1 }], pyWho);
eq('every row is present even when nothing filled it', pyThin.length, 4);
eq('the empty ones are simply empty', pyThin[0].tiles.length, 0);
/* ⚠️ And an empty row still has to know its tier: the gap it leaves is drawn
   the height the missing square would have been, and without this the whole
   page throws on the first season that never held a Tour Finals. */
check('an empty row still carries its tier',
  pyThin.every(r => Array.isArray(r.tiers) && r.tiers.length > 0),
  JSON.stringify(pyThin.map(r => r.tiers)));

/* ⚠️ The calendar does not guarantee a pyramid. 2027 holds five Super 1000s and
   five Super 750s, so the tier above the base is the wider of the two. Worth
   showing rather than hiding — it says the elite tier grew. */
const pyFlat = pyramidSeason([
  ...Array.from({ length: 5 }, (_, i) => ({ tier: 23, name: 'K' + i, date: '2027-0' + (i + 1) + '-01', w: 1 })),
  ...Array.from({ length: 5 }, (_, i) => ({ tier: 24, name: 'S' + i, date: '2027-0' + (i + 1) + '-08', w: 2 })),
], pyWho);
check('a season where the tier above the base is wider is reported',
  pyramidBulges(pyFlat).some(b => b.above === 's1000' && b.below === 's750'),
  JSON.stringify(pyramidBulges(pyFlat)));
check('and a properly tapering season is not', pyramidBulges(pyramidSeason([
  ...Array.from({ length: 4 }, (_, i) => ({ tier: 23, name: 'K' + i, date: '2026-0' + (i + 1) + '-01', w: 1 })),
  ...Array.from({ length: 6 }, (_, i) => ({ tier: 24, name: 'S' + i, date: '2026-0' + (i + 1) + '-08', w: 2 })),
], pyWho)).length === 0);

eq('nothing at all is four empty rows', pyramidSeason([], {}).length, 4);

/* ---- which season a title belongs to, and which ladder names it ----

   Checked against the committed harvest rather than against invented rows: the
   whole point of the rule is which of BWF's real names it moves, and there are
   exactly three in twenty seasons. A made-up fixture cannot fail the way the
   file can.
   ==================================================================== */


console.log('\n=== who won it: one player, or a pair ===');

/* ⚠️ Two shapes on disk, on purpose: a singles winner is a bare number, as the
   two singles files have always had it, and a pair is an array. Re-harvesting
   twenty seasons of singles for a shape change that buys nothing would have been
   the alternative. Both are read, so nothing downstream knows which it got. */
eq('a singles winner is one id', JSON.stringify(titleWinnerIds({ w: 25831 })), '["25831"]');
eq('a pair is two', JSON.stringify(titleWinnerIds({ w: [68544, 70762] })), '["68544","70762"]');
eq('and nobody is nobody', titleWinnerIds({ w: null }).length, 0);
eq('as is a title with no winner at all', titleWinnerIds({}).length, 0);

/* ⚠️ **The key sorts; the name does not.** BWF lists a pair in the conventional
   order — the man first in the mixed — with no promise it does so twice the same
   way, and a key that trusted the order would split a partnership in half the
   first time two payloads disagreed. */
eq('a pair keys the same however it was ordered',
  titleWinnerKey({ w: [70762, 68544] }), titleWinnerKey({ w: [68544, 70762] }));
eq('and a singles key is just the id', titleWinnerKey({ w: 25831 }), '25831');
check('a pair and one of its players are different competitors',
  titleWinnerKey({ w: [68544, 70762] }) !== titleWinnerKey({ w: 68544 }));

const pairPlayers = {
  68544: { n: 'Thom GICQUEL', c: 'FRA', a: 'gic.jpg', f: 'fra.png' },
  70762: { n: 'Delphine DELRUE', c: 'FRA', a: 'del.jpg', f: 'fra.png' },
};
const duo = winnerOf(pairPlayers, ['68544', '70762']);
eq('a pair is named by its surnames', duo.n, 'GICQUEL / DELRUE');
eq('and keeps both people', duo.people.length, 2);
/* ⚠️ `a` is the first face and `faces` is all of them, so everything that only
   ever had room for one photograph keeps working untouched. */
eq('the first face is still where it always was', duo.a, 'gic.jpg');
eq('and both are there for anything that can split a square',
  JSON.stringify(duo.faces), '["gic.jpg","del.jpg"]');

const solo = winnerOf({ 1: { n: 'LIN Dan', c: 'CHN', a: 'lin.jpg' } }, ['1']);
eq('a single player keeps their whole name, not a surname', solo.n, 'LIN Dan');
eq('and is a pair of one rather than a special case', solo.people.length, 1);
eq('with one face', JSON.stringify(solo.faces), '["lin.jpg"]');
/* ⚠️⚠️ BWF's stand-in for "no photograph" **is a photograph** — a generic
   silhouette. On a singles square that is merely uninformative; in a pair it
   draws the same blank twice and reads as a rendering fault, so it is treated as
   no photograph and the initials take over. Two winners also carry a `.tif`
   avatar, which no browser renders at all. */
eq('the generic male silhouette is not a photograph',
  usableAvatar('https://img.bwfbadminton.com/image/upload/assets/players/thumbnail/profile_male.jpg'), '');
eq('nor the female one',
  usableAvatar('https://img.bwfbadminton.com/image/upload/assets/players/thumbnail/profile_female.jpg'), '');
eq('nor a .tif, which no browser renders',
  usableAvatar('https://img.bwfbadminton.com/image/upload/v1/thumbnail/67172.tif'), '');
eq('a real thumbnail is left alone',
  usableAvatar('https://img.bwfbadminton.com/x/thumbnail/50906.jpg'),
  'https://img.bwfbadminton.com/x/thumbnail/50906.jpg');

/* ⚠️ A dropped photograph leaves a **hole in place**, not a shorter list: the
   half it belonged to still has to be drawn, with initials, or the other
   photograph slides across and the square says the pair was one person. */
const halfLit = winnerOf({
  1: { n: 'A PLAYER', a: 'https://x/thumbnail/profile_male.jpg' },
  2: { n: 'B PLAYER', a: 'real.jpg' },
}, ['1', '2']);
eq('a pair with one usable photograph keeps two people', halfLit.people.length, 2);
eq('and two face slots, one of them empty',
  JSON.stringify(halfLit.faces), '["","real.jpg"]');
eq('while the single-photograph consumers get the one that exists',
  halfLit.a, 'real.jpg');

eq('somebody the file has never heard of is still drawn',
  winnerOf({}, ['999']).n, '#999');
eq('and nobody at all is null', winnerOf({}, []), null);

/* ---- one order per pair, across the whole file ----

   ⚠️ **BWF does not list a partnership the same way twice**, and the split
   square draws it in the order the title carries — so the same pair swapped
   faces from one square to the next along a single row, and the hover swapped
   their names with them. `settleWinnerOrder` decides once, at the door. */

const flipped = {
  players: {
    1: { n: 'Markis KIDO' }, 2: { n: 'Hendra SETIAWAN' },
    3: { n: 'CAI Yun' }, 4: { n: 'FU Haifeng' },
    5: { n: 'LIN Dan' },
  },
  seasons: {
    2007: [
      { tier: 20, name: 'Worlds', date: '2007-08-13', w: [1, 2] },
      { tier: 24, name: 'Early', date: '2007-05-01', w: [4, 3] },
      { tier: 24, name: 'Solo', date: '2007-06-01', w: 5 },
    ],
    2008: [
      { tier: 'OLY', name: 'Games', date: '2008-08-17', w: [2, 1] },
      { tier: 24, name: 'Later', date: '2008-09-01', w: [3, 4] },
      { tier: 23, name: 'Later still', date: '2008-10-01', w: [3, 4] },
    ],
  },
};
const settled = settleWinnerOrder(flipped);
const orderOf = (year, name) => titleWinnerIds(
  settled.seasons[year].find(t => t.name === name)).join(',');

/* Kido and Setiawan: two titles, one each way, so the earliest breaks the tie
   and the Worlds in August 2007 is earlier than the Games in August 2008. */
eq('a pair split evenly takes the order of its earliest title',
  orderOf(2007, 'Worlds'), '1,2');
eq('and the later title is turned round to match', orderOf(2008, 'Games'), '1,2');

/* ⚠️ Cai and Fu: **the majority wins, not the first title.** The obvious rule —
   whichever order the first title carried — is wrong on the real data twice
   over: Fu and Cai's first title is one of five against thirteen the other way,
   and Lee Hyo Jung and Lee Yong Dae's is one against six. */
eq('a pair listed one way more often takes that order',
  orderOf(2008, 'Later'), '3,4');
eq('even in the title that was listed first', orderOf(2007, 'Early'), '3,4');

eq('a singles winner is left exactly as it was',
  JSON.stringify(settled.seasons[2007].find(t => t.name === 'Solo').w), '5');
eq('and nothing is added or lost',
  Object.values(settled.seasons).flat().length,
  Object.values(flipped.seasons).flat().length);

/* ⚠️ The file on disk keeps saying what BWF said — the same rule `usableAvatar`
   follows. Which way round to draw a pair is a decision about drawing. */
eq('the file handed in is not touched',
  JSON.stringify(flipped.seasons[2008][0].w), '[2,1]');
eq('a singles file comes straight back',
  settleWinnerOrder({ seasons: { 2007: [{ tier: 24, w: 5 }] } }).seasons[2007][0].w, 5);
check('and a file with no seasons at all does not throw',
  !!settleWinnerOrder({}), 'returned something');

/* Over the real files: every pair, every title, one order. This is the check
   that would have caught it. */
for (const code of ['MS', 'WS', 'MD', 'WD', 'XD']) {
  const p = path.join(HERE, '..', 'data', `winners-${code}.json`);
  if (!fs.existsSync(p)) continue;
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  const done = settleWinnerOrder(raw);
  const order = new Map();
  const clashes = [];
  for (const list of Object.values(done.seasons)) {
    for (const t of list || []) {
      const key = titleWinnerKey(t), ids = titleWinnerIds(t).join(',');
      if (!order.has(key)) order.set(key, ids);
      else if (order.get(key) !== ids) clashes.push(`${key}: ${order.get(key)} vs ${ids}`);
    }
  }
  check(`every ${code} competitor is listed one way`, !clashes.length,
    clashes.slice(0, 3).join(' · '));
  /* And it changed nothing about *who* won, which was never in doubt: the key
     has been sorted since the day the pairs arrived. */
  const before = Object.values(raw.seasons).flat().map(titleWinnerKey).sort().join('|');
  const after = Object.values(done.seasons).flat().map(titleWinnerKey).sort().join('|');
  eq(`and ${code} still has exactly the same winners`, after, before);
}

/* The two that a first-title rule gets backwards, named, so the rule cannot be
   quietly simplified back to the wrong one. */
const mdOrderPath = path.join(HERE, '..', 'data', 'winners-MD.json');
if (fs.existsSync(mdOrderPath)) {
  const md = settleWinnerOrder(JSON.parse(fs.readFileSync(mdOrderPath, 'utf8')));
  const players = md.players;
  const named = new Set();
  for (const list of Object.values(md.seasons)) {
    for (const t of list || []) {
      named.add(titleWinnerIds(t).map(i => (players[i] || {}).n).join(' / '));
    }
  }
  check('CAI Yun leads FU Haifeng, as BWF usually has it',
    named.has('CAI Yun / FU Haifeng') && !named.has('FU Haifeng / CAI Yun'),
    [...named].filter(n => /CAI Yun|FU Haifeng/.test(n)).join(' · '));
  check('and Kido leads Setiawan, which is the way round they were named',
    named.has('Markis KIDO / Hendra SETIAWAN')
    && !named.has('Hendra SETIAWAN / Markis KIDO'),
    [...named].filter(n => /KIDO|SETIAWAN/.test(n)).join(' · '));
}

/* ---- the same three views, over a doubles board ---- */

const mdPath = path.join(HERE, '..', 'data', 'winners-MD.json');
if (fs.existsSync(mdPath)) {
  const md = JSON.parse(fs.readFileSync(mdPath, 'utf8'));
  const mdSeasons = winnersSeasons(md);

  check('every men’s doubles title was won by two people',
    Object.values(md.seasons).flat().every(t => titleWinnerIds(t).length === 2),
    `${Object.values(md.seasons).flat().length} titles`);

  /* The square is what let the doubles onto the board at all: it holds the pair
     and stays the size the ladder says it is. */
  const mdRows = pyramidSeason(mdSeasons.byYear.get(2018), md.players, 2018);
  const mdTiles = mdRows.flatMap(r => r.tiles);
  check('a doubles square carries two faces', mdTiles.every(t => t.who.faces.length === 2),
    JSON.stringify(mdTiles[0] && mdTiles[0].who.faces));
  eq('and is exactly the size a singles square of that tier is',
    mdTiles[0].scale, pyramidScale(mdTiles[0].tier));

  /* ⚠️ The competitor is the **pair**, so a partnership gets one bar and one
     line, and a partner change starts another. Checked by counting: if the key
     were a player, every doubles season would hold twice as many winners as it
     holds titles. */
  const dom = dominationSeasons(md);
  for (const s of dom.seasons) {
    check(`${s.year} has no more winners than it had titles`,
      s.by.size <= s.total, `${s.by.size} winners, ${s.total} titles`);
  }
  let sums = 0;
  for (const s of dom.seasons) {
    if (!s.total) continue;
    let n = 0;
    for (const p of dom.people) {
      const pt = p.pts.find(q => q.year === s.year);
      if (pt) n += pt.score;
    }
    /* ⚠️ A **finished** season adds to exactly one. The season being played
       does not, and must not: it is weighed against the whole year, so the
       titles still to come are the part nobody owns yet. */
    if (s.forecast) { if (n > 1 + 1e-9) sums++; }
    else if (Math.abs(n - 1) > 1e-9) sums++;
  }
  eq('and a doubles season still adds up to one whole season', sums, 0);

  check('every line on the chart is named for a pair',
    dom.people.every(p => p.who.people.length === 2 && / \/ /.test(p.who.n)),
    dom.people[0] && dom.people[0].who.n);

  /* ⚠️ A partnership is one bar, not two — the bug the pair key exists to stop
     is a band with a lane for each half of every pair. */
  const mdLanes = reignLanes(pyramidReigns(mdSeasons, md.players, 3));
  check('a dominant pair takes one bar between them',
    mdLanes.every(p => p.who && p.who.people.length === 2),
    mdLanes.map(p => p.who.n).join(' | '));
  check('and the band is far shorter than one lane per player',
    Math.max(...mdLanes.map(p => p.lane)) + 1 < mdLanes.length,
    `${Math.max(...mdLanes.map(p => p.lane)) + 1} lanes for ${mdLanes.length} pairs`);
} else {
  console.log('  (no men’s doubles harvested on this machine — skipped)');
}


console.log('\n=== the winners file, put back into its seasons ===');

const winMS = JSON.parse(fs.readFileSync(
  path.join(HERE, '..', 'data', 'winners-MS.json'), 'utf8'));
const winSeasons = winnersSeasons(winMS);

eq('every season from the first to the last', winSeasons.years.length,
  winSeasons.years[winSeasons.years.length - 1] - winSeasons.years[0] + 1);
eq('oldest first', winSeasons.years[0], 2007);
eq('and no title is lost on the way',
  winSeasons.years.reduce((n, y) => n + winSeasons.byYear.get(y).length, 0),
  Object.values(winMS.seasons).reduce((n, l) => n + l.length, 0));

const finals = y => (winSeasons.byYear.get(y) || []).filter(t => String(t.tier) === '22');

/* ⚠️ The one that matters: BWF files the delayed Finals under the year it was
   *played*, which put two of them in 2021 and none in 2020 — and disagreed with
   the career grid, which has moved it for as long as `tournamentSeason` has
   existed. One project, two views, one answer. */
eq('the 2020 Tour Finals is in the 2020 season', finals(2020).length, 1);
eq('and it is the one BWF named 2020', finals(2020)[0].name,
  'HSBC BWF World Tour Finals 2020 (New Dates)');
eq('so 2021 is left with exactly one Finals', finals(2021).length, 1);
eq('the same rule catches the 2010 Superseries Finals', finals(2010).length, 1);
check('which was played in January 2011', finals(2010)[0].date.startsWith('2011'),
  finals(2010)[0].date);
eq('and 2011 keeps only its own', finals(2011).length, 1);

/* ⚠️ And the one it must *not* move. A Finals is retrospective — the conclusion
   of a season already played — and an Olympics is not the conclusion of
   anything, so drawing Tokyo in 2020 would say somebody won an Olympic gold in
   a year nobody played one. */
check('the Tokyo 2020 Olympics stays in 2021, where it was won',
  (winSeasons.byYear.get(2021) || []).some(t => t.tier === 'OLY'),
  (winSeasons.byYear.get(2021) || []).map(t => t.tier).join(' '));
check('and 2020 has no Olympics at all',
  !(winSeasons.byYear.get(2020) || []).some(t => t.tier === 'OLY'));

eq('a title played in its own season moves nowhere',
  pyramidTitleSeason({ tier: 23, name: 'YONEX All England Open 2020', date: '2020-03-11' }, 2020),
  2020);
/* Only ever backwards: a qualifier played in December for next year's event was
   still played in the season it was played in. */
eq('and a name that looks *forward* is left alone',
  pyramidTitleSeason({ tier: 22, name: 'Something Finals 2027', date: '2026-12-01' }, 2026),
  2026);

const marks = pyramidSeasonMarks(winSeasons);
eq('three seasons carry an asterisk, and no more',
  [...marks.keys()].sort((a, b) => a - b).join(' '), '2010 2020 2021');
check('2020 says its Finals was played the following January',
  /played in 2021/.test(marks.get(2020).join(' ')), marks.get(2020).join(' '));
check('2021 says its Olympics was the 2020 event',
  /2020 event, held in 2021/.test(marks.get(2021).join(' ')), marks.get(2021).join(' '));

/* ---- what a square was called at the time ---- */

eq('a Super 1000 in 2023 is a Super 1000', pyramidLabel(23, 2023), 'Super 1000');
eq('and the same rung in 2013 is a Superseries Premier',
  pyramidLabel(23, 2013), 'Superseries Premier');
eq('a Super 750 in 2013 is a Superseries', pyramidLabel(24, 2013), 'Superseries');
eq('the Finals is named for its era too', pyramidLabel(22, 2013), 'Superseries Finals');
/* ⚠️ 2017 is the last Superseries season and 2018 the first World Tour one, so
   the cutover is the one place the names can be off by a year. */
eq('2017 still speaks Superseries', pyramidLabel(24, 2017), 'Superseries');
eq('2018 speaks World Tour', pyramidLabel(24, 2018), 'Super 750');
eq('the majors are called the same thing in both', pyramidLabel(20, 2009),
  pyramidLabel(20, 2025));

const py2013 = pyramidSeason(winSeasons.byYear.get(2013), winMS.players, 2013);
eq('the row names follow the season as well', py2013.map(r => r.label).join(' / '),
  'Olympics · Worlds / Superseries Finals / Superseries Premier / Superseries');
eq('and so do the tiles', py2013[2].tiles[0].level, 'Superseries Premier');

/* ⚠️ Before 2011 there was no Premier tier at all: the twelve Superseries were
   one rank. Drawn literally that is a slab under an empty row, which reads as a
   harvest that missed something — so those seasons are dealt across both Super
   rows, **at the one size**. The equal size is the claim; a larger upper row
   would assert a tier that did not exist for another four years. */
for (const y of [2007, 2008, 2009, 2010]) {
  const rows = pyramidSeason(winSeasons.byYear.get(y), winMS.players, y);
  /* ⚠️ Not a fixed 6,6. An odd number of Superseries deals the spare one to the
     *lower* row — 2010 ran thirteen — so what is checked is that both rows are
     filled and differ by at most one, rather than a count that a recovered
     title moves. It moved: the 2010 French Open was missing from every board
     until `canonicalDraw` reached the harvest. */
  const dealt = rows.slice(2).map(r => r.tiles.length);
  check(`${y} fills both Super rows`,
    dealt[0] > 0 && dealt[1] > 0 && dealt[1] - dealt[0] >= 0 && dealt[1] - dealt[0] <= 1,
    dealt.join(','));
  eq(`and ${y} calls both of them Superseries`,
    rows.slice(2).map(r => r.label).join(), 'Superseries,Superseries');
  eq(`and draws both at the one size`,
    rows[2].tiles[0].scale, rows[3].tiles[0].scale);
  /* Date order still runs left to right and top to bottom: the upper row is the
     first half of the season, not a selection out of it. */
  check(`and the upper row is the earlier half of ${y}`,
    rows[2].tiles[rows[2].tiles.length - 1].date <= rows[3].tiles[0].date,
    rows[2].tiles[rows[2].tiles.length - 1].date + ' then ' + rows[3].tiles[0].date);
}
check('and nothing is lost in the dealing', [2007, 2008, 2009, 2010].every(y => {
  const rows = pyramidSeason(winSeasons.byYear.get(y), winMS.players, y);
  const drawn = rows.flatMap(r => r.tiles).length;
  return drawn === (winSeasons.byYear.get(y) || []).length;
}));

/* 2011 is the season the split becomes real, and from then on the two rows are
   different tiers at different sizes again. */
const py2011 = pyramidSeason(winSeasons.byYear.get(2011), winMS.players, 2011);
eq('2011 has a Premier row of its own', py2011[2].label, 'Superseries Premier');
check('drawn larger than the Superseries below it',
  py2011[2].tiles[0].scale > py2011[3].tiles[0].scale);
check('flatSupers knows where the line is',
  flatSupers(2010) && !flatSupers(2011) && !flatSupers(2026) && !flatSupers(null),
  `${flatSupers(2010)} ${flatSupers(2011)}`);

/* ============================ dominance ============================ */

console.log('\n=== the runs of seasons somebody dominated ===');

const reigns3 = pyramidReigns(winSeasons, winMS.players, 3);
const reignName = id => (winMS.players[id] || {}).n || id;
const reignLCW = reigns3.find(r => reignName(r.id) === 'LEE Chong Wei');
check('LEE Chong Wei cleared three titles in every season from 2007', !!reignLCW);
eq('as one unbroken run', reignLCW.runs.length, 1);
eq('from 2007', reignLCW.runs[0].from, 2007);
eq('to 2016', reignLCW.runs[0].to, 2016);
eq('and the run counts every title in it', reignLCW.runs[0].total,
  reignLCW.runs[0].years.reduce((n, y) => n + y.n, 0));

/* ⚠️ Strictly consecutive. LIN Dan won one title in 2010 between two dominant
   stretches, and closing that gap would draw a five-year era he did not have —
   which is the whole difference between this and the ranking version, where a
   dip of a fortnight is noise and had to be tolerated. */
const linDan = reigns3.find(r => reignName(r.id) === 'LIN Dan');
eq('LIN Dan has two runs, not one', linDan.runs.length, 2);
eq('and the gap is the season he did not clear the bar',
  `${linDan.runs[0].to} then ${linDan.runs[1].from}`, '2009 then 2011');

check('the band is sorted by the season a career opens',
  reigns3.every((r, i) => i === 0 || r.first >= reigns3[i - 1].first),
  reigns3.map(r => r.first).join(' '));

/* Raising the bar can only ever remove seasons from a run, never add them. */
const reigns5 = pyramidReigns(winSeasons, winMS.players, 5);
check('a higher bar is a subset of a lower one',
  reigns5.every(r => {
    const same = reigns3.find(o => o.id === r.id);
    return same && r.runs.every(run => run.years.every(y =>
      same.runs.some(o => o.years.some(z => z.year === y.year && z.n === y.n))));
  }));
check('and it never draws more players', reigns5.length <= reigns3.length,
  `${reigns5.length} at 5+, ${reigns3.length} at 3+`);
check('every year in every run really did clear the bar',
  reigns5.every(r => r.runs.every(run => run.years.every(y => y.n >= 5))));

/* ⚠️ 2020 held two titles in the whole season, so nobody can clear three and
   every line on the board is severed by it. That is the honest drawing of a
   year that did not happen, and a rule that bridged gaps would hide it. */
check('nothing spans 2020', reigns3.every(r => r.runs.every(run =>
  !(run.from < 2020 && run.to > 2020))),
  reigns3.flatMap(r => r.runs.map(x => x.from + '-' + x.to)).join(' '));

eq('an empty board draws nothing',
  pyramidReigns({ years: [], byYear: new Map() }, {}, 3).length, 0);

/* ---- packing the lanes ---- */

const lanes3 = reignLanes(reigns3);
eq('every player keeps a lane', lanes3.length, reigns3.length);
check('a player has one lane for all of their runs',
  lanes3.every(p => Number.isInteger(p.lane) && p.lane >= 0));

/* ⚠️ The lane is the whole vertical claim: two bars in different lanes at the
   same year means those two overlapped. If a lane ever held two runs that
   overlap, the picture would be saying the opposite of what happened. */
const byLane = new Map();
for (const p of lanes3) for (const r of p.runs) {
  (byLane.get(p.lane) || byLane.set(p.lane, []).get(p.lane)).push({ ...r, id: p.id });
}
let clashes = 0;
for (const runs of byLane.values()) {
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      if (runs[i].from <= runs[j].to && runs[j].from <= runs[i].to) clashes++;
    }
  }
}
eq('no lane ever holds two runs that overlap', clashes, 0);

/* Packed rather than one row each: fifteen women cleared three titles in a
   season and the band is three rows deep, which is what makes the succession
   visible instead of a fifteen-row diagonal of white space. */
check('and the band is far shorter than one lane per player',
  Math.max(...lanes3.map(p => p.lane)) + 1 < lanes3.length / 2,
  `${Math.max(...lanes3.map(p => p.lane)) + 1} lanes for ${lanes3.length} players`);

/* ⚠️ Viktor AXELSEN dominated in 2017 and again in 2021–23 with three fallow
   seasons between. Both bars have to be in *his* lane, or the band says two
   different people did it. */
const axelsen = lanes3.filter(p => reignName(p.id) === 'Viktor AXELSEN');
eq('one entry for a career with two eras, not two', axelsen.length, 1);
eq('and both of his runs sit in the same lane', axelsen[0].runs.length, 2);



/* ============================ the export's geometry ============================

   `posterLayout` touches no DOM, so where a poster puts things can be checked
   here rather than by decoding a picture. The drawing itself is end-to-end, in
   test_season.mjs, because the one thing that can go wrong at the very last
   step — a canvas that drew perfectly and then will not be read back — only
   happens in a browser.
   ==================================================================== */


/* ============================ the domination score ============================ */

console.log('\n=== what one title is worth ===');

/* ⚠️ These five numbers are the whole of the metric, so they are written out
   rather than derived from the same expression the model uses — a test that
   recomputes `Math.pow(PHI_, ...)` proves only that Math.pow is deterministic. */
near('a Super 750 is the unit', titleWeight(24), 1);
near('a Super 1000 is φ of one', titleWeight(23), 1.618);
near('the Tour Finals is φ²', titleWeight(22), 2.618);
near('a world title is φ³', titleWeight(20), 4.236);
near('and an Olympic gold is φ⁴', titleWeight('OLY'), 6.854);
/* The claim the note makes out loud, checked. */
check('which is about seven Super 750s',
  Math.round(titleWeight('OLY') / titleWeight(24)) === 7,
  String(titleWeight('OLY')));

/* ⚠️ The Olympics has always outranked the World Championships here. What makes
   them look equal is `pyramidScale`, which draws an Olympic square at the Worlds
   size and lets the gold ring carry the difference — a decision about a row of
   faces, never a claim about worth. */
check('the Olympics outweighs the Worlds, whatever the board draws',
  titleWeight('OLY') > titleWeight(20));
eq('though the board draws them the same size',
  pyramidScale('OLY'), pyramidScale(20));

/* ⚠️ Every step is the same one. The half-step variant — an Olympic gold √φ
   above a world title rather than a full rung — was built and dropped, and this
   is what says it stayed dropped. */
const ladder = ['OLY', 20, 22, 23, 24].map(titleWeight);
check('and every rung is the same step',
  ladder.slice(1).every((w, i) => Math.abs(ladder[i] / w - PHI_) < 1e-9),
  ladder.map(w => w.toFixed(3)).join(' / '));

console.log('\n=== a season as a share of itself ===');

const domMS = dominationSeasons(winMS);

eq('the same seasons the board draws', domMS.years.length, winSeasons.years.length);
check('every season is a full one', domMS.seasons.every(s =>
  s.total === winSeasons.byYear.get(s.year).length));

/* The definition, checked directly: a season's scores are shares of that season
   and nothing else, so they add to one wherever anybody won anything. */
let sums = 0;
let msRunning = null;
for (const s of domMS.seasons) {
  if (!s.total) continue;
  let n = 0;
  for (const p of domMS.people) {
    const pt = p.pts.find(q => q.year === s.year);
    if (pt) n += pt.score;
  }
  /* ⚠⚠ A **finished** season adds to exactly one — a share is a share of
     something. The season still being played is weighed against the *whole*
     year instead, so what it adds to is how much of the year has been won so
     far: everything still to come belongs to nobody yet. That is the property
     that makes a part-played season safe to rank on — it can only go up. */
  if (s.forecast) msRunning = n;
  else if (Math.abs(n - 1) > 1e-9) sums++;
}
eq('every finished season’s scores add up to a whole season', sums, 0);
check('and the season being played adds up to less, with more to come',
  msRunning === null || (msRunning > 0 && msRunning < 1),
  msRunning === null ? 'no season in progress' : msRunning.toFixed(3));

/* ⚠️ A player has a point only in the seasons they *won* something. There is no
   column in this data saying who entered, so a zero would be a claim the model
   cannot support — and a line drawn along the bottom would make it. */
check('nobody has a point they did not win anything in',
  domMS.people.every(p => p.pts.every(pt => pt.n > 0 && pt.score > 0)));
check('and the points are in order', domMS.people.every(p =>
  p.pts.every((pt, i) => i === 0 || pt.year > p.pts[i - 1].year)));

/* Ordered the way the era bands order their lanes — by the season a career
   opens — because the colours are handed out along this list and the two views
   should tell the same story in the same sequence. */
check('careers are listed in the order they open', domMS.people.every((p, i) =>
  i === 0 || p.pts[0].year >= domMS.people[i - 1].pts[0].year));

/* ⚠️ Read off the recorded harvest by hand: 2022 held eight of these titles and
   Viktor AXELSEN won six of them, including the Worlds. Six of eight by count is
   75; by weight it is 85.8, and the gap between those two numbers is the whole
   reason the score is weighted. */
const ax2022 = domMS.people.find(p => p.who.n === 'Viktor AXELSEN')
  .pts.find(pt => pt.year === 2022);
eq('AXELSEN won six of the eight titles of 2022', ax2022.n, 6);
eq('out of a season that held eight', ax2022.played, 8);
near('which is 75 by count', (ax2022.n / ax2022.played) * 100, 75, 0.05);
near('and 85.8 once the Worlds is weighted', ax2022.score * 100, 85.8, 0.05);

/* ⚠️ LIN Dan against LEE Chong Wei is what settled the steepness. On the gentler
   √φ ladder LCW finishes 86 points clear; on φ they finish level, which is the
   reading the eye already has — LCW won more of them, LIN Dan won the big ones.
   Both totals are checked, because "level" is the claim and either one drifting
   would break it silently. */
const scoreCareer = name => domMS.people.find(p => p.who.n === name)
  .pts.reduce((n, pt) => n + pt.score * 100, 0);
near('LEE Chong Wei’s seasons add to 285', scoreCareer('LEE Chong Wei'), 285, 1);
near('LIN Dan’s add to 276, which is level with him', scoreCareer('LIN Dan'), 276, 1);
near('and Lin Dan’s 2007 stands well above LCW’s 2010',
  domMS.people.find(p => p.who.n === 'LIN Dan').pts.find(pt => pt.year === 2007).score * 100,
  56.9, 0.1);

console.log('\n=== the seasons with a hole in them ===');

const thinMS = thinSeasons(domMS.seasons);
/* ⚠️ Two thirds of the median, not a fixed count. The calendar has held fifteen
   of these titles and it has held eight, so "fewer than six" means one thing in
   2013 and another in 2022 — and the fixed rule called 2022 a normal season. */
eq('the median season is fourteen titles', thinMS.median, 14);
check('2020 was short', thinMS.set.has(2020));
check('and so was 2022, which a fixed count of six would have missed',
  thinMS.set.has(2022), `${domMS.seasons.find(s => s.year === 2022).total} titles`);
check('but 2018 and 2019, at ten, were not',
  !thinMS.set.has(2018) && !thinMS.set.has(2019));
eq('an empty board has no short seasons', thinSeasons([]).set.size, 0);

eq('2020 is named for what happened to it', shortSeasonWhy(2020, 2026), 'Covid');
eq('and 2022 as well', shortSeasonWhy(2022, 2026), 'Covid');
eq('2019 needs no reason', shortSeasonWhy(2019, 2026), '');
/* The season being played is short because it is not finished, which is a
   different fact and gets a different word. */
eq('the season being played is ongoing, not Covid', shortSeasonWhy(2026, 2026), 'ongoing');
eq('and so is one in the future', shortSeasonWhy(2027, 2026), 'ongoing');

console.log('\n=== the default clutter bar ===');

/* ⚠️⚠️ The rule is "hide as much as possible without dropping anybody who ever
   *led* a season", and it is the leader's **peak** that has to clear the bar,
   because the bar filters on a career's best year. Asking either half of that
   wrongly put the women's default at 35 and drew CHEN Yu Fei not at all. */
const floorMS = bestScoreFloor(domMS, 2026);
const domWS = dominationSeasons(JSON.parse(fs.readFileSync(
  path.join(HERE, '..', 'data', 'winners-WS.json'), 'utf8')));
const floorWS = bestScoreFloor(domWS, 2026);
eq('the men’s board settles at 40', floorMS, 40);
eq('the women’s at 20', floorWS, 20);

/** Whoever led each finished season, and whether the bar still draws them. */
function leadersHeld(model, floor, now) {
  for (const s of model.seasons) {
    if (!s.total || s.year >= now) continue;
    let lead = null;
    for (const p of model.people) {
      const pt = p.pts.find(q => q.year === s.year);
      if (pt && (!lead || pt.score > lead.score)) lead = { score: pt.score, peak: p.peak };
    }
    if (lead && lead.peak * 100 < floor - 1e-9) return false;
  }
  return true;
}
for (const [name, model, floor] of [['men', domMS, floorMS], ['women', domWS, floorWS]]) {
  check(`the ${name}’s bar still draws every season’s leader`,
    leadersHeld(model, floor, 2026));
  check(`and one step higher would drop one of them`,
    !leadersHeld(model, floor + SCORE_FLOOR_STEP, 2026),
    `at ${floor + SCORE_FLOOR_STEP}`);
}

/* ⚠️ The season being played is left out of the sum. In January it is one
   tournament and one winner, whose whole career may peak at 12 — and the bar
   would collapse to 10 every New Year. Proved by asking the same question with
   the ongoing season counted. */
const naive = bestScoreFloor(
  { seasons: domMS.seasons, people: domMS.people }, 2027);
check('counting the part-played season would drag the bar down',
  naive < floorMS, `${naive} against ${floorMS}`);

eq('nothing to draw is a bar of nothing',
  bestScoreFloor({ seasons: [], people: [] }, 2026), 0);


console.log('\n=== the dominators, ranked ===');

/* Two honest orderings and no third. The chart says who dominated *and when*;
   this says who dominated, full stop. */

const rankModel = {
  years: [2020, 2021, 2022],
  seasons: [],
  people: [
    { id: 'long', who: { n: 'LONG' }, peak: 0.3,
      pts: [{ year: 2020, score: 0.3, n: 3 }, { year: 2021, score: 0.3, n: 3 },
        { year: 2022, score: 0.3, n: 3 }] },
    { id: 'sharp', who: { n: 'SHARP' }, peak: 0.8,
      pts: [{ year: 2021, score: 0.8, n: 8 }] },
    { id: 'small', who: { n: 'SMALL' }, peak: 0.1,
      pts: [{ year: 2022, score: 0.1, n: 1 }] },
  ],
};

const byTotal = dominationRanking(rankModel, 'total');
const byPeak = dominationRanking(rankModel, 'peak');

eq('total is every season added up',
  byTotal.map(r => r.who.n).join(','), 'LONG,SHARP,SMALL');
eq('and it is the sum, not an average',
  Number(byTotal[0].total.toFixed(6)), 0.9);
eq('peak is the best single season',
  byPeak.map(r => r.who.n).join(','), 'SHARP,LONG,SMALL');
/* ⚠️ The two orderings **disagree**, which is the whole reason both are drawn.
   On the real boards: KIM / SEO are first on peak and eighth on total, and LEE
   Chong Wei is second on total with only the sixth-best season. */
check('so the two orderings are not the same ranking',
  byTotal.map(r => r.id).join() !== byPeak.map(r => r.id).join(),
  `${byTotal.map(r => r.id)} vs ${byPeak.map(r => r.id)}`);

eq('a rank is given whichever way it is sorted', byPeak[0].rank, 1);
eq('the year of the peak comes with it, because 80 in 2021 is a claim',
  byPeak[0].peakYear, 2021);
eq('and how many seasons it took', byTotal[0].seasons, 3);
eq('and how many titles', byTotal[0].titles, 9);

/* ⚠️ Ranks are **shared on a tie** rather than put in an order the numbers do
   not support — and the next rank skips, as ranks do. */
const rankTied = dominationRanking({ people: [
  { id: 'a', who: { n: 'AAA' }, peak: 0.5, pts: [{ year: 2020, score: 0.5, n: 1 }] },
  { id: 'b', who: { n: 'BBB' }, peak: 0.5, pts: [{ year: 2021, score: 0.5, n: 1 }] },
  { id: 'c', who: { n: 'CCC' }, peak: 0.2, pts: [{ year: 2021, score: 0.2, n: 1 }] },
] }, 'total');
eq('two equal careers share a rank', rankTied.map(r => r.rank).join(','), '1,1,3');
eq('and the tie is broken for *order* by the other number, then the name',
  rankTied.map(r => r.id).join(','), 'a,b,c');

eq('an unknown mode falls back rather than throwing',
  dominationRanking(rankModel, 'mean').map(r => r.id).join(),
  byTotal.map(r => r.id).join());
eq('and nothing at all ranks nothing', dominationRanking(null, 'total').length, 0);
eq('the modes on offer are exactly two',
  RANK_MODES.map(m => m.key).join(','), 'total,peak');
/* ⚠️ **And there is deliberately no mean.** This data says who *won*, not who
   *entered*, so the seasons a competitor played and won nothing are missing
   from the divisor rather than sitting in it as zeroes: SHARP would average 80
   against LONG's 30 on one season's evidence. The number would be describing
   the hole in the data rather than the players. */
check('and a mean is not one of them',
  !RANK_MODES.some(m => /mean|average/i.test(m.key + m.label)),
  RANK_MODES.map(m => m.label).join(','));

/* ---- over a real board ---- */

const rankMS = dominationRanking(domMS, 'total');
eq('every competitor on the board is ranked, whatever the bar above is set to',
  rankMS.length, domMS.people.length);

/* ⚠⚠ **The season being played counts only because it has a whole-year
   denominator.** With one it is a *lower bound* — the numerator grows, the
   denominator stands still — so it can never overstate a total and, a peak
   being a maximum, can never lower one either. Without one it is a share of
   however much has happened, which in January is one tournament and a score of
   100, and it is left out instead. */
const running = domMS.seasons.filter(s => s.ongoing);
check('the board has a season still being played', running.length === 1,
  JSON.stringify(running.map(s => s.year)));
check('and it is weighed against the whole year', running[0].forecast,
  `${running[0].played} played of ${running[0].planned} planned`);
check('which is more than has been played', running[0].planned > running[0].played,
  `${running[0].played} / ${running[0].planned}`);
check('so somebody ranked has their last season in it',
  rankMS.some(r => r.last === running[0].year),
  JSON.stringify(rankMS.filter(r => r.last === running[0].year).map(r => r.who.n)));

/* Strip the calendar out and the same season stops counting, because now it is
   a share of a part-played year. This is the guard, not the timetable. */
const noPlan = dominationSeasons({ ...winMS, planned: undefined });
const rankNoPlan = dominationRanking(noPlan, 'total');
check('with no calendar in the file the running season is left out',
  rankNoPlan.length < rankMS.length, `${rankMS.length} → ${rankNoPlan.length}`);
check('and nobody ranked is dated in it',
  rankNoPlan.every(r => r.last < running[0].year),
  JSON.stringify(rankNoPlan.filter(r => r.last >= running[0].year).map(r => r.who.n)));

/* ---- the pandemic seasons ---- */

/* ⚠️ Off by default on the page, and this is why: leaving them in put Viktor
   AXELSEN top of *both* orderings, on 184 of his 315 points — and TAI Tzu Ying
   top of the women's peak on an 81 taken in a season that held three titles. */
const rankNoCovid = dominationRanking(domMS, 'total', { skip: COVID_SEASONS });
eq('with the pandemic seasons out, LEE Chong Wei leads the men on total',
  rankNoCovid[0].who.n, 'LEE Chong Wei');
eq('and LIN Dan is second', rankNoCovid[1].who.n, 'LIN Dan');
eq('with them in, it is Viktor AXELSEN', rankMS[0].who.n, 'Viktor AXELSEN');
const axeIn = rankMS.find(r => /AXELSEN/.test(r.who.n));
const axeOut = rankNoCovid.find(r => /AXELSEN/.test(r.who.n));
check('most of whose total came from them',
  axeIn.total - axeOut.total > axeOut.total,
  `${(axeIn.total * 100).toFixed(0)} → ${(axeOut.total * 100).toFixed(0)}`);
eq('and the three seasons are counted as dropped', axeOut.dropped, 3);
/* ⚠️ A career that exists only inside the skipped seasons is dropped, not
   shown at zero: a row saying somebody dominated nothing is worse than no row. */
check('a career made only of skipped seasons leaves the table',
  rankNoCovid.length < rankMS.length,
  `${rankMS.length} → ${rankNoCovid.length}`);
check('and nobody is left in it with nothing to rank',
  rankNoCovid.every(r => r.total > 0 && r.seasons > 0));
/* The peak season's own numbers, because a career total is the wrong fact
   beside a peak: what a peak *means* is how much of that year it took. */
const peakNoCovid = dominationRanking(domMS, 'peak', { skip: COVID_SEASONS });
check('a peak carries the season it was taken in and what it held',
  peakNoCovid[0].peakTitles > 0 && peakNoCovid[0].peakPlayed > peakNoCovid[0].peakTitles,
  `${peakNoCovid[0].who.n}: ${peakNoCovid[0].peakTitles} of ${peakNoCovid[0].peakPlayed}`
  + ` in ${peakNoCovid[0].peakYear}`);
eq('and the peak is recomputed over what is left, not taken from the career',
  peakNoCovid.find(r => /AXELSEN/.test(r.who.n)).peak,
  Math.max(...domMS.people.find(p => /AXELSEN/.test(p.who.n)).pts
    .filter(pt => !COVID_SEASONS.has(pt.year)).map(pt => pt.score)));

/* The set itself: named from the tournament list, not from a count. */
eq('the pandemic seasons are 2020, 2021 and 2022',
  [...COVID_SEASONS].sort().join(','), '2020,2021,2022');
check('2021 is one of them though it held as many titles as 2019',
  isCovidSeason(2021), 'no Chinese event, a Bangkok bubble, an Olympics a year late');
check('and 2018 is not, though it held ten as well', !isCovidSeason(2018),
  'the World Tour restructure is a change to the ladder, not to the season');

/* ---- the third reading: weighed against a full season ---- */

/* ⚠️ Neither counting them nor dropping them. 2020 held three of these titles,
   so one of them is a third of the year for a reason that is arithmetical before
   it is competitive; `full` divides by what a season of the era was worth
   instead. See `COVID_MODES`. */
const domFull = dominationSeasons(winMS, { now: 2026, covid: 'full' });
const seasonOf = (m, y) => m.seasons.find(s => s.year === y);
const asPlayed = dominationSeasons(winMS, { now: 2026 });

eq('the three readings are set aside, full season and as played',
  COVID_MODES.map(m => m.key).join(','), 'aside,full,played');
eq('and the default is to set them aside', COVID_DEFAULT, 'aside');
eq('an unknown key falls back to the default', covidMode('nonsense').key, 'aside');
/* ⚠️ Links written before there were three readings carry `wc=1`, and it meant
   "count them" — which is now a named mode rather than a boolean. */
eq('wc=1 from an older link still means what it was written to mean',
  covidMode('1').key, 'played');

near('2020 was worth 5.24 as it was played', seasonOf(asPlayed, 2020).mass, 5.24, 0.01);
near('and is weighed against 19.33 — a full World Tour season',
  seasonOf(domFull, 2020).mass, 19.33, 0.01);
check('which the season says of itself', seasonOf(domFull, 2020).whole);
eq('and the strip says both numbers, three of a notional twelve',
  `${seasonOf(domFull, 2020).played}/${seasonOf(domFull, 2020).planned}`, '3/12');
/* ⚠️ **Never downward.** 2021 held the Olympics, the Worlds and two World Tour
   Finals — 23.80 against a normal 19.33 — and substituting the normal figure
   would *raise* every 2021 score, which is the opposite of the point. */
near('2021 held more than a normal season and is left exactly alone',
  seasonOf(domFull, 2021).mass, seasonOf(asPlayed, 2021).mass, 1e-9);
check('so it is not marked as weighed against a whole year',
  !seasonOf(domFull, 2021).whole, '23.80 against a normal 19.33');
eq('and no season outside the pandemic is touched either',
  domFull.seasons.filter(s => s.whole).map(s => s.year).join(','), '2020,2022');
/* ⚠️ The season being played keeps its own denominator, which comes from the
   harvested calendar — a different mechanism for a different reason. */
check('the running season is still weighed against its calendar',
  seasonOf(domFull, 2026).forecast && !seasonOf(domFull, 2026).whole);

/* ⚠️ **The era matters.** A Superseries season carried thirteen to fifteen of
   these titles and a World Tour season ten to twelve, so one figure for the
   whole file would weigh 2020 against a calendar that had not existed for three
   years. Nothing is hard-coded: it is read off the seasons the file holds. */
const normModern = normalSeason(asPlayed.seasons, 2020);
const normOld = normalSeason(asPlayed.seasons, 2012);
near('a full World Tour season is worth 19.33', normModern.mass, 19.33, 0.01);
eq('and holds twelve titles', normModern.count, 12);
check('a Superseries season was worth more', normOld.mass > normModern.mass,
  `${normOld.mass.toFixed(2)} against ${normModern.mass.toFixed(2)}`);
check('and held more of them', normOld.count > normModern.count,
  `${normOld.count} against ${normModern.count}`);

/* What it does to the argument, which is the whole reason it exists. */
const rankFull = dominationRanking(domFull, 'total');
eq('on the full-season reading LEE Chong Wei still leads', rankFull[0].who.n, 'LEE Chong Wei');
const axeFull = rankFull.find(r => /AXELSEN/.test(r.who.n));
check('and Viktor AXELSEN lands between the two other readings',
  axeFull.total > axeOut.total && axeFull.total < axeIn.total,
  `${(axeOut.total * 100).toFixed(0)} < ${(axeFull.total * 100).toFixed(0)}`
  + ` < ${(axeIn.total * 100).toFixed(0)}`);
eq('with nothing dropped from his career', axeFull.dropped, 0);
/* ⚠️ **A calendar correction cannot see a field.** 2021 is untouched by `full`,
   and 2021 is the most compromised season on the board — eight of its eleven
   events with no Chinese player in the draw. So his peak moves off 2022 and onto
   a season this option has nothing to say about. That is what the option means,
   and it is why all three are offered rather than one. */
const peakFull = dominationRanking(domFull, 'peak').find(r => /AXELSEN/.test(r.who.n));
eq('his peak moves to the season the full-season reading cannot touch',
  peakFull.peakYear, 2021);
const peakPlayedAxe = dominationRanking(asPlayed, 'peak').find(r => /AXELSEN/.test(r.who.n));
eq('where as played it was 2022', peakPlayedAxe.peakYear, 2022);
check('and it is lower than the as-played peak', peakFull.peak < peakPlayedAxe.peak,
  `${(peakFull.peak * 100).toFixed(1)} against ${(peakPlayedAxe.peak * 100).toFixed(1)}`);
/* ⚠️ A career that lives only inside those seasons is kept, not dropped: `full`
   counts them. Only `aside` removes anybody. */
eq('nobody leaves the table on the full-season reading',
  rankFull.length, dominationRanking(asPlayed, 'total').length);
check('the leader is the leader on total', rankMS[0].who.n, rankMS[0].who.n);
/* ⚠️ The bar filters on **peak**, so a total ranking cut by it is a different
   claim: at the men's singles default of 40 it would leave seven names. This is
   why the table is not governed by it. */
const msFloor = bestScoreFloor(domMS) / 100;
check('and the bar would have cut most of them',
  rankMS.filter(r => r.peak >= msFloor).length < rankMS.length / 2,
  `${rankMS.filter(r => r.peak >= msFloor).length} of ${rankMS.length} clear ${msFloor * 100}`);
check('including somebody well up the total ranking',
  rankMS.slice(0, 10).some(r => r.peak < msFloor),
  rankMS.slice(0, 10).map(r => `${r.who.n} ${(r.peak * 100).toFixed(1)}`).join(' · '));

/* A career's total is its own points and nobody else's. */
const rankLcw = rankMS.find(r => /LEE Chong Wei/.test(r.who.n));
const rankLcwPts = domMS.people.find(p => p.id === rankLcw.id).pts;
const peakYearOf = pts => pts.reduce((a, b) => (b.score > a.score ? b : a), pts[0]).year;
eq('a total is that career’s seasons and no others',
  rankLcw.total.toFixed(6),
  rankLcwPts.reduce((n, pt) => n + pt.score, 0).toFixed(6));
eq('and its peak is the best of them',
  rankLcw.peak, Math.max(...rankLcwPts.map(pt => pt.score)));
eq('taken in the season it was actually taken in',
  rankLcw.peakYear, peakYearOf(rankLcwPts));

console.log('\n=== a slice of the board, laid out for export ===');

const posterOf = (from, to, extra) => posterLayout(winMS,
  { from, to, kind: 'MS', min: '3', eras: true, ...extra });

const slice = posterOf(2011, 2016);
eq('exactly the seasons asked for', slice.years.join(' '),
  '2011 2012 2013 2014 2015 2016');
eq('and it says so', slice.title, 'Men’s singles · 2011–2016');
check('with a width to match', slice.width > 900 && slice.width < 2600, slice.width);
check('and a sane height', slice.height > 300 && slice.height < 900, slice.height);

/* ⚠️ Clamped to what was harvested rather than trusted. A link or a stale select
   can ask for 1999, and a poster of an empty range is a blank rectangle. */
const all = posterOf(1990, 2200);
eq('a range wider than the data is clamped to the data', `${all.from}–${all.to}`,
  `${winSeasons.years[0]}–${winSeasons.years[winSeasons.years.length - 1]}`);
eq('and a backwards one draws nothing rather than throwing',
  posterOf(2016, 2011).years.length, 0);

/* ---- a picked board, exported ----

   ⚠️ The pick goes into the picture, because it *is* the picture. An export of
   a board with one competitor followed across it is a different claim from an
   export of the board — the same rule the score poster follows with its pins
   and the compare poster follows with its chips: an export draws what is on
   screen. */

const litIds = L => L.columns.flatMap(c => c.rows.flatMap(r => r.tiles))
  .filter(t => L.lit(t.id)).map(t => t.id);
const allIds = L => L.columns.flatMap(c => c.rows.flatMap(r => r.tiles)).map(t => t.id);

check('with nothing picked, every square is lit',
  litIds(slice).length === allIds(slice).length, `${litIds(slice).length}`);

const lcwId = slice.columns.flatMap(c => c.rows.flatMap(r => r.tiles))
  .find(t => t.who && t.who.n === 'LEE Chong Wei').id;
const onePick = posterOf(2011, 2016, { only: [lcwId] });
check('a pick lights that competitor and nobody else',
  [...new Set(litIds(onePick))].join(','), lcwId);
eq('and nothing has left the board',
  allIds(onePick).length, allIds(slice).length);
/* Named at the foot, so a reader who gets this in a feed is not looking at an
   unexplained dark board. */
check('the foot says who is lit',
  onePick.legend.some(l => /^Lit: LEE Chong Wei$/.test(l)),
  onePick.legend.join(' | '));
check('and says nothing about it when nothing is picked',
  !slice.legend.some(l => /^Lit:/.test(l)), slice.legend.join(' | '));

/* The pick is by the same key the page pins on, so a link and its export agree. */
eq('two picks light two competitors',
  new Set(litIds(posterOf(2011, 2016,
    { only: [lcwId, allIds(slice).find(id => id !== lcwId)] }))).size, 2);
/* ⚠️ A pick for somebody who is not in the crop must not black the whole thing
   out — it lights nothing, and every square correctly reads as not-picked
   rather than the layout throwing. */
check('a pick nobody in the crop matches does not throw',
  posterOf(2011, 2016, { only: ['nobody'] }).columns.length === 6);

/* ---- the bars ---- */

const barsIn = L => L.bars.map(b => `${(b.who || {}).n} ${b.from}-${b.to}`);
check('a run that runs off the left of the crop is still drawn',
  barsIn(slice).includes('LEE Chong Wei 2007-2016'), barsIn(slice).join(' | '));
const cut = slice.bars.find(b => (b.who || {}).n === 'LEE Chong Wei');
check('and marked as cut, so its corner can say there is more of it',
  cut.openLeft === true && cut.openRight === false,
  `openLeft ${cut.openLeft} openRight ${cut.openRight}`);
eq('with only the seasons in range drawn',
  cut.years.map(y => y.year).join(' '), '2011 2012 2013 2014 2015 2016');
check('and its left edge on the first column',
  Math.abs(cut.x - slice.columns[0].x) < 0.01, `${cut.x} vs ${slice.columns[0].x}`);
check('and its right edge on the last',
  Math.abs((cut.x + cut.w)
    - (slice.columns[5].x + slice.columns[5].w)) < 0.01);
check('a run entirely outside the crop is left out',
  !barsIn(slice).some(b => /SHI Yu Qi/.test(b)), barsIn(slice).join(' | '));

/* ⚠️ Lanes, colours and the shading scale are all worked out over the **whole**
   board and then cropped. An export of 2011–2016 that recoloured CHEN Long
   because LEE Chong Wei happened to be cut off would not be the picture the
   sender was looking at. */
const whole = posterOf(2007, 2026);
const colourOf = (L, name) => (L.bars.find(b => (b.who || {}).n === name) || {}).colour;
for (const who of ['LEE Chong Wei', 'CHEN Long', 'Kento MOMOTA']) {
  eq(`${who} is the same colour cropped as uncropped`,
    colourOf(slice, who) || colourOf(posterOf(2015, 2019), who),
    colourOf(whole, who));
}
eq('and the shading is scaled to the whole board, not the crop',
  posterOf(2019, 2020).peak, whole.peak);
check('every bar has a lane the whole board agreed on',
  slice.bars.every(b => {
    const same = whole.bars.find(o => o.id === b.id);
    return same && same.lane === b.lane;
  }));

/* ---- the space a summit mark takes ---- */

/* ⚠️ 2021 is the only season holding an Olympics and a Worlds at once, and it is
   the case that catches this: a mark drawn beside a photograph has to be given
   room on *both* sides, or the second one lands on the first one's face. */
const slot = t => tileSlot(t);
const py2021 = pyramidSeason(winSeasons.byYear.get(2021), winMS.players, 2021);
const majors = py2021[0].tiles;
eq('2021 holds two summit titles', majors.length, 2);
check('and each is given room for its mark on both sides',
  majors.every(t => slot(t).pad > 0 && slot(t).w === slot(t).side + slot(t).pad * 2),
  JSON.stringify(majors.map(t => slot(t))));
check('so the second mark starts after the first photograph ends',
  slot(majors[0]).w + POSTER.tileGap > slot(majors[0]).side + slot(majors[1]).pad,
  `${slot(majors[0]).w} + ${POSTER.tileGap} vs ${slot(majors[1]).pad}`);
/* A Super 750 takes no mark and therefore no padding — otherwise every base row
   would be padded by a mark that is not there. */
check('a square with no mark takes no room for one',
  slot(py2021[3].tiles[0]).pad === 0);

/* ---- what the picture says about itself ---- */

/* ⚠️ **One ring on the whole board**, and it is the Olympic one. There used to be
   one per tier and not one of them was visible: they were inset, and an inset
   shadow paints behind the photograph filling the tile. The world championship
   square then had a white one for a day, which read as the *brighter* of the two
   beside the gold and so quietly outranked it. The summit row is one marked
   square and one plain one. */
eq('exactly one tier is ringed', Object.keys(TIER_RING).join(), 'OLY');
eq('and it is gold', TIER_RING.OLY.colour, '#ffd24a');
eq('the world championship square is not ringed', TIER_RING[20], undefined);

check('the legend explains the squares', /square is a title/.test(slice.legend[0]),
  slice.legend.join(' / '));
check('and the bars', slice.legend.some(l => /3\+ of them/.test(l)),
  slice.legend.join(' / '));
check('the footnote is only explained where one is drawn',
  !slice.legend.some(l => /dashed/.test(l))
    && posterOf(2019, 2021).legend.some(l => /dashed/.test(l)),
  posterOf(2019, 2021).legend.join(' / '));
/* ⚠️ Three separate statements, so three capitals. Run on in lower case they
   read as one sentence broken across three lines. */
check('every legend line opens with a capital',
  posterOf(2019, 2021).legend.every(l => /^[A-Z]/.test(l)),
  posterOf(2019, 2021).legend.join(' / '));
/* And the dashed outline is named, not shown: leading with the ⁕ made the line
   look like an explanation of a small dot rather than of a dashed square. */
check('and the footnote line says "dashed" rather than opening with a glyph',
  posterOf(2019, 2021).legend.every(l => !/^⁕/.test(l)),
  posterOf(2019, 2021).legend.join(' / '));
check('and the bar line goes when the band is off',
  !posterOf(2011, 2016, { eras: false }).legend.some(l => /spans/.test(l)));
eq('with no band, no bars', posterOf(2011, 2016, { eras: false }).bars.length, 0);
check('and a shorter picture for it',
  posterOf(2011, 2016, { eras: false }).height < slice.height);

/* ============================ the bracket ============================

   The geometry is arithmetic, so it is checked here rather than by looking at
   it: a card in column c must sit at the midpoint of the two that feed it, at
   every fold, in every draw size. That property is what makes the picture read
   as a tree, and it is the one a wrong constant would quietly break.
   ==================================================================== */

console.log('\n=== the draws at a tournament ===');

/* ⚠️ Real ids, from `vue-tournament-draws` on 4 September 2026. The
   qualification draws are numbered into the *same* sequence as the main draws,
   which is why the discipline cannot be turned into a drawId by counting: at
   this tournament MS is 2 and WS is 4. */
const WITH_QUAL = { results: [
  { value: '1', text: 'MS - Qualification', qualification: 1, size: 16, slug: 'ms-qualification', doubles: false },
  { value: '2', text: 'MS', qualification: 0, size: 64, slug: 'ms', doubles: false },
  { value: '3', text: 'WS - Qualification', qualification: 1, size: 16, slug: 'ws-qualification', doubles: false },
  { value: '4', text: 'WS', qualification: 0, size: 32, slug: 'ws', doubles: false },
  { value: '5', text: 'MD - Qualification', qualification: 1, size: 16, slug: 'md-qualification', doubles: true },
  { value: '6', text: 'MD', qualification: 0, size: 32, slug: 'md', doubles: true },
] };
const NO_QUAL = { results: [
  { value: '1', text: 'MS', qualification: 0, size: 32, slug: 'ms', doubles: false },
  { value: '2', text: 'WS', qualification: 0, size: 32, slug: 'ws', doubles: false },
] };

const withQual = parseDrawList(WITH_QUAL);
eq('qualifying draws are not brackets and are left out', withQual.length, 3);
eq('and the main draws keep the ids BWF gave them',
  withQual.map(d => d.code + '=' + d.id).join(' '), 'MS=2 WS=4 MD=6');
eq('a tournament without qualifying numbers them from one',
  parseDrawList(NO_QUAL).map(d => d.code + '=' + d.id).join(' '), 'MS=1 WS=2');
eq('the field size is the one a reader recognises', withQual[0].size, 64);
check('and doubles is carried through', parseDrawList(WITH_QUAL)[2].doubles);
eq('no payload is no draws', parseDrawList(null).length, 0);
eq('and neither is a shape nobody expected', parseDrawList({ results: 'nope' }).length, 0);

/* ---- a whole draw ---- */

console.log('\n=== reading a bracket ===');

/** A draw of `size` first-round matches, with `played` rounds decided. */
function fakeDraw(size, played, opts = {}) {
  const results = {};
  const matches = [];
  const rounds = ['R32', 'R16', 'QF', 'SF', 'Final'];
  const off = rounds.length - (Math.log2(size) + 1);
  let n = 0;
  for (let c = 0; size >> c; c++) {
    for (let r = 0; r < (size >> c); r++) {
      const code = String(++n);
      const bye = c === 0 && opts.byes && r < opts.byes;
      const decided = c < played;
      const m = {
        code,
        roundName: rounds[off + c],
        winner: decided ? 1 : 0,
        matchStatus: decided ? 'F' : 'N',
        team1: { countryCode: 'DEN', players: [{ id: 'a' + code, nameDisplay: 'A' + code }] },
        team2: bye ? {}
          : { countryCode: 'JPN', players: [{ id: 'b' + code, nameDisplay: 'B' + code }] },
        score: decided ? [{ set: 1, home: 21, away: 15 }, { set: 2, home: 21, away: 17 }] : [],
      };
      results[c + '-' + r] = { match: m };
      // Only the flat list carries the id, which is the whole reason it exists.
      matches.push(Object.assign({ id: 'id-' + code }, m));
    }
  }
  return { results, matches, drawsize: size };
}

const d32 = parseDraw(fakeDraw(16, 0));          // a 32 field: 16 first-round matches
eq('every cell in the grid is read', d32.cells.size, 31);
eq('and the tree is as deep as the draw', d32.maxCol, 4);
eq('the rounds come back outermost first',
  bracketRounds(d32).map(r => r.round).join(' '), 'R32 R16 QF SF Final');

/* ⚠️ The join on `code` is the point: only `matches[]` has `id`, and the id is
   what a star is keyed on. Without the join every bracket card would be
   unstarrable — and worse, `code` is unique only *within* a draw, so keying on
   it would have MS and WD starring each other's matches. */
eq('a cell carries the id from the flat list, not just its code',
  d32.cells.get('0-0').id, 'id-1');
eq('and its code as well', d32.cells.get('0-0').code, '1');

const byes = parseDraw(fakeDraw(32, 0, { byes: 16 }));
eq('a 64 draw is one column deeper', byes.maxCol, 5);
eq('a first-round cell with one side empty is a bye',
  [...byes.cells.values()].filter(m => m.bye).length, 16);
check('and it is not read as a fixture waiting to be played',
  byes.cells.get('0-0').bye && byes.cells.get('0-0').sides[1].players.length === 0);
/* ⚠️ Only in the first round. Every later cell has an empty side too, right up
   until its feeders finish — reading those as byes would call the whole
   unplayed half of the draw a walkover. */
check('a later empty cell is a fixture, not a bye', !byes.cells.get('4-0').bye);

eq('an empty payload is an empty draw', parseDraw(null).cells.size, 0);
eq('and asks for no columns', parseDraw({}).maxCol, 0);

/* ---- folding ---- */

console.log('\n=== folding away the rounds that are over ===');

eq('a draw nobody has played opens at the first round', autoFromCol(parseDraw(fakeDraw(16, 0))), 0);
eq('once the first round is done it opens at the second',
  autoFromCol(parseDraw(fakeDraw(16, 1))), 1);
eq('and at the quarter-finals when it is', autoFromCol(parseDraw(fakeDraw(16, 2))), 2);

/* ⚠️ An unplayed bye is not a match, and must not hold the view on a round that
   is otherwise finished — the sixteen byes of a 64 draw never get a winner. */
const halfPlayed = parseDraw(fakeDraw(32, 1, { byes: 16 }));
eq('an unplayed bye does not hold the view back', autoFromCol(halfPlayed), 1);

/* However finished a draw is, one card is not a bracket. */
const done = parseDraw(fakeDraw(16, 5));
eq('a finished draw stops short of the final', autoFromCol(done), 2);
eq('which reads as the quarter-finals', resolvedRound(done, null), 'QF');

eq('"all" is honoured', fromCol(d32, 'all'), 0);
eq('a named round is found', fromCol(d32, 'QF'), 2);
eq('a round this draw does not have is ignored rather than blanking it',
  fromCol(d32, 'R64'), 0);
eq('and folding never goes past the semi-finals', fromCol(d32, 'Final'), 3);
eq('the first round reads back as "all"', resolvedRound(d32, 'all'), 'all');
eq('a fold reads back as its own round', resolvedRound(d32, 'QF'), 'QF');

/* ---- geometry ---- */

console.log('\n=== the shape of a bracket ===');

/** Every card must sit at the midpoint of the two that feed it. */
function worstDrift(draw, pick) {
  const L = bracketLayout(draw, pick);
  const at = new Map(L.cards.map(c => [c.match.col + '-' + c.match.row, c.y + c.h / 2]));
  let worst = 0;
  for (const [k, mid] of at) {
    const [c, r] = k.split('-').map(Number);
    const f1 = at.get((c - 1) + '-' + (2 * r));
    const f2 = at.get((c - 1) + '-' + (2 * r + 1));
    if (f1 == null || f2 == null) continue;
    worst = Math.max(worst, Math.abs(mid - (f1 + f2) / 2));
  }
  return worst;
}

const big = parseDraw(fakeDraw(32, 0));
eq('a 64 draw is 63 cards', bracketLayout(big, 'all').cards.length, 63);
eq('and 124 connector segments', bracketLayout(big, 'all').lines.length, 124);
eq('with a column heading each', bracketLayout(big, 'all').labels.length, 6);
eq('every card sits between its feeders', worstDrift(big, 'all'), 0);
eq('and still does once the tree is folded', worstDrift(big, 'QF'), 0);
eq('and at every other fold', ['R32', 'R16', 'SF'].map(r => worstDrift(big, r)).join(), '0,0,0');

/* ⚠️ The measured reason folding exists. Hiding columns would have left the
   gaps — the spacing law doubles them every round — so the tree is re-laid out
   from the chosen round instead. Numbers from a real 64 draw, 4 September 2026. */
const shape = pick => {
  const L = bracketLayout(big, pick);
  return `${L.cards.length} ${L.lines.length} ${Math.round(L.width)}x${Math.round(L.height)}`;
};
eq('all of it is a wall', shape('all'), '63 124 1548x1906');
eq('from the last 32 it halves', shape('R32'), '31 60 1290x978');
eq('from the last 16 again', shape('R16'), '15 28 1032x514');
eq('and from the quarter-finals it is a picture', shape('QF'), '7 12 774x282');

const folded = bracketLayout(big, 'QF');
check('a fold is a real bracket, connectors and all', folded.lines.length > 0);
eq('the folded column becomes column zero', folded.from, 3);
eq('and its cards sit one slot apart',
  Math.round(folded.cards[1].y - folded.cards[0].y), SLOT);
/* ⚠️ The measurement the whole fold exists for: unfolded, the same four
   quarter-final cards sit **eight slots apart**, because they still have to
   line up with thirty-two first-round matches. That gap is geometry, not
   rendering, which is why hiding the early columns would not have closed it. */
const qfIn = pick => bracketLayout(big, pick).cards.filter(c => c.match.round === 'QF');
eq('unfolded, the quarter-finals sit eight slots apart',
  Math.round(qfIn('all')[1].y - qfIn('all')[0].y), 8 * SLOT);
eq('and folded to them, one slot apart',
  Math.round(qfIn('QF')[1].y - qfIn('QF')[0].y), SLOT);

eq('nothing to draw is nothing, not a crash', bracketLayout(null, 'all').cards.length, 0);
eq('and it asks for no canvas', bracketLayout(parseDraw({}), 'all').width, 0);


console.log('\n=== the compare page, laid out for export ===');

/** A career as the compare exports want it: an identity, and the rows. */
const asPoster = (name, seasons) => ({
  id: name, name, meta: '', avatar: '', rows: rowsOf(seasons),
});
const shiPost = asPoster('SHI Yu Qi', shi);
const anPost = asPoster('AN Se Young', anSeYoung);

/* ---- the grid ---- */

const gOne = gridPosterLayout([shiPost], { era: 'wt', hidden: [] });
const gTwo = gridPosterLayout([shiPost, anPost], { era: 'wt', hidden: [] });

eq('one card per career', gTwo.careers.length, 2);
check('two careers make a wider picture than one',
  gTwo.width > gOne.width * 1.8, `${gTwo.width} against ${gOne.width}`);

/* ⚠️ The widths and the seasons are measured across **both** careers, exactly as
   the page measures them, so the two grids line up in the picture the way they
   line up on screen. Measured separately they would not. */
eq('and both are drawn over one set of seasons',
  gTwo.years.join(','), gridYears([shiPost.rows, anPost.rows]).join(','));
eq('on one set of blocks',
  gTwo.sections.map(s => String(s.group)).join(','),
  gridSections([shiPost.rows, anPost.rows].map(rows => rows.map(r => r.by)), 'wt')
    .map(s => String(s.group)).join(','));

/* ⚠️ The picture is what is on screen, chips included — the Winners board
   exports a range of seasons because that is the shape of the claim posted from
   it, and a career is not a range. */
const gHidden = gridPosterLayout([shiPost, anPost], { era: 'wt', hidden: ['25', '26', '27'] });
eq('a switched-off level is out of the picture',
  gHidden.sections.some(s => String(s.group) === '25'), false);
eq('but still in the row it was switched off from',
  gHidden.all.some(s => String(s.group) === '25'), true);
check('so the picture is narrower', gHidden.width < gTwo.width,
  `${gHidden.width} against ${gTwo.width}`);

/* The era switch renames the blocks and re-marks the translated squares, and it
   is a property of the view — so it has to reach the picture. */
const gSS = gridPosterLayout([shiPost, anPost], { era: 'ss', hidden: [] });
check('the era switch reaches the picture',
  gSS.sections.map(s => s.code).join(',')
    !== gTwo.sections.map(s => s.code).join(','),
  gSS.sections.map(s => s.code).join(' '));

eq('nothing to draw is a picture of nothing, not a crash',
  gridPosterLayout([], { era: 'wt', hidden: [] }).careers.length, 0);

/* ---- the honours board ---- */

const hTwo = honoursPosterLayout([shiPost, anPost], { era: 'wt', hidden: [], bar: 'sf' });
const hOne = honoursPosterLayout([shiPost], { era: 'wt', hidden: [], bar: 'sf' });

/* ⚠️ Two careers mirror about a spine and one does not, which is what decides
   the width — so the layout has to know which it is drawing. */
eq('two careers mirror', hTwo.two, true);
eq('one does not', hOne.two, false);
check('and the mirrored board is the wider of the two',
  hTwo.width > hOne.width, `${hTwo.width} against ${hOne.width}`);

/* Every row is sized by what its level is worth, on the ladder the page uses —
   the whole claim of the view, so it must not be redrawn here from something
   else. */
const hRow = g => hTwo.rows.find(r => String(r.section.group) === String(g));
check('a Super 1000 row is φ taller in area than a Super 750 one',
  Math.abs((hRow(23).side / hRow(24).side) ** 2 - PHI_) < 1e-6,
  `${hRow(23).side} / ${hRow(24).side}`);
check('and the Worlds row towers over the Super 100 one',
  hRow(20).side > hRow(27).side * 3,
  `${hRow(20).side} vs ${hRow(27).side}`);

/* The round bar is what the board is *about*, so raising it is not a filter on
   the picture, it is a different picture. */
const hTitles = honoursPosterLayout([shiPost, anPost], { era: 'wt', hidden: [], bar: 'w' });
check('titles only is a narrower board than semi-finals and up',
  hTitles.width < hTwo.width, `${hTitles.width} against ${hTwo.width}`);
check('and the legend says which bar it was drawn at',
  hTitles.legend[0].includes(honourStep('w').label), hTitles.legend[0]);

eq('a switched-off level is out of this picture too',
  honoursPosterLayout([shiPost, anPost],
    { era: 'wt', hidden: ['27'], bar: 'sf' }).sections
    .some(s => String(s.group) === '27'), false);

/* ---- the ramp ----

   ⚠️ These ten colours are also in `styles.css` as `--res-*`, because the page
   paints with CSS and the export paints with canvas. `test_season.mjs` reads
   the computed colour off a drawn cell and holds it against this table; here we
   only check that the table covers every result the model can produce, so a new
   rank cannot arrive with no colour and be drawn as "did not play". */
const everyTier = new Set([...cellsOf(shiPost.rows), ...cellsOf(anPost.rows)]
  .map(c => c.tier));
for (const t of everyTier) {
  check(`the ramp has a colour for ${t}`, !!RESULT_COLOURS[t], RESULT_COLOURS[t]);
}
eq('and one for a slot nobody played', RESULT_COLOURS.off, '#292929');

console.log('\n=== a slice of the score, laid out for export ===');

const scoreWhole = scorePosterLayout(winMS, { from: 2007, to: 2026, kind: 'MS', floor: 45 });
const scoreCrop = scorePosterLayout(winMS, { from: 2011, to: 2016, kind: 'MS', floor: 45 });

eq('the crop holds the seasons asked for', scoreCrop.years.join(','),
  '2011,2012,2013,2014,2015,2016');
eq('and says so in its title', scoreCrop.title, 'Men’s singles · 2011–2016');
eq('a range wider than the board is clamped to the board',
  scorePosterLayout(winMS, { from: 1990, to: 2100, kind: 'MS', floor: 45 }).years.length,
  winSeasons.years.length);

/* ⚠️ The crop changes what is shown, never what is counted. A score is a share
   of its own season, so cropping leaves every number where it was — and the
   players, their colours and the axis are settled over the whole career and
   then clipped. An export of six seasons that recoloured CHEN Long because LEE
   Chong Wei fell off the left would not be the picture the sender saw. */
eq('the same people, in the same colours',
  scoreCrop.shown.map(p => p.who.n + '=' + p.colour).join(' '),
  scoreWhole.shown.map(p => p.who.n + '=' + p.colour).join(' '));
eq('and the same axis', scoreCrop.top, scoreWhole.top);

/* ⚠️ Handed in, because the page scales the axis across both draws and this
   file is given one of them. Without it a men's export and a women's export of
   the same seasons come back at two different scales. */
eq('an axis height given by the caller is the one used',
  scorePosterLayout(winMS, { from: 2007, to: 2026, kind: 'MS', floor: 45, top: 1 }).top, 1);

/* The bar and the pins are what a shared chart is *about*, so the picture is
   drawn to the same reading the page was on. */
eq('a lower bar draws more people',
  scorePosterLayout(winMS, { from: 2007, to: 2026, kind: 'MS', floor: 20 }).shown.length
    > scoreWhole.shown.length, true);
const pinnedLayout = scorePosterLayout(winMS,
  { from: 2007, to: 2026, kind: 'MS', floor: 45, only: [scoreWhole.shown[0].id] });
eq('a pin lights one and leaves the rest drawn',
  pinnedLayout.shown.filter(p => pinnedLayout.lit(p.id)).length, 1);
eq('with everybody still in the picture',
  pinnedLayout.shown.length, scoreWhole.shown.length);

check('a wide board is drawn wider than a narrow one',
  scoreWhole.width > scoreCrop.width, scoreWhole.width + ' vs ' + scoreCrop.width);


process.exit(report());
