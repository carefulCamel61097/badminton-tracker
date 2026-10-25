/* Glicko-2, checked against Glickman's own worked example before anything of
 * ours is checked at all.
 *
 * ⚠️⚠️ **This is the one file in the project whose expectations are not read off
 * a BWF payload**, because the maths has a published right answer and a rating
 * system that is subtly wrong is a rating system that looks plausible for years.
 * The numbers in the first block are from the example calculation in "Example of
 * the Glicko-2 system" (Glickman, 2013) — v, Δ, σ', φ*, φ', μ' and the two
 * values on the familiar scale. If this block fails, nothing below it means
 * anything.
 */
import { check, eq, near, report } from './check.mjs';
import {
  GLICKO, newCompetitor, ratePeriod, winChance,
  competitorKey, periodOf, ratableMatch, idle, periodsBetween,
} from '../rating.js';

console.log('--- Glickman\'s worked example ---');

/* The paper's player: 1500 with a deviation of 200, against three opponents,
   beating the first and losing to the other two. */
const me = { r: 1500, rd: 200, vol: 0.06 };
const games = [
  { r: 1400, rd: 30, s: 1 },
  { r: 1550, rd: 100, s: 0 },
  { r: 1700, rd: 300, s: 0 },
];
const got = ratePeriod(me, games, { tau: 0.5 });

near('the new rating is the paper\'s', got.r, 1464.06, 0.01);
near('and so is the new deviation', got.rd, 151.52, 0.01);
near('and the volatility barely moves, as it should', got.vol, 0.05999, 0.00001);

/* ⚠️ The deviation *falls* from 200 to 151.5 even though the player lost two of
   three. That is the point of the system and the thing an Elo cannot say:
   three matches are evidence, and evidence reduces uncertainty whichever way the
   results went. */
check('three matches reduce uncertainty regardless of the results',
  got.rd < me.rd, me.rd + ' -> ' + got.rd);

console.log('\n--- what the system does on its own terms ---');

const fresh = newCompetitor();
eq('a new competitor starts at 1500', fresh.r, GLICKO.rating);
eq('with everything still to prove', fresh.rd, GLICKO.rd);
eq('and no matches behind them', fresh.n, 0);

/* ⚠️⚠️ **An idle period widens the deviation and leaves the rating alone.**
   Without this a player who stops for two years returns with the deviation they
   retired on, and a two-year-old number is then treated as current evidence. */
const sat = ratePeriod({ r: 1800, rd: 60, vol: 0.06, n: 40 }, []);
eq('an idle period does not move the rating', sat.r, 1800);
check('but it does widen the deviation', sat.rd > 60, sat.rd);
eq('and it is not a match played', sat.n, 40);

/* ⚠️⚠️ **How fast uncertainty actually grows, measured rather than assumed.** A
   settled competitor on a deviation of 60 who misses a full year comes back on
   about 96 — wider, but nowhere near unknown. That is the volatility doing its
   job: a year out of a sport whose top twenty barely turns over should not erase
   what we knew. My first version of this test asserted the 350 cap after 400
   idle weeks and failed at 217, because the growth is far slower than it looks:
   reaching 350 from 60 takes about 1,100 weeks, which is twenty-one years. */
let drift = { r: 1800, rd: 60, vol: 0.06 };
for (let i = 0; i < 52; i++) drift = ratePeriod(drift, []);
near('a full year away widens a settled deviation to about 96', drift.rd, 96, 1);
eq('and the rating itself is untouched', drift.r, 1800);

for (let i = 0; i < 2000; i++) drift = ratePeriod(drift, []);
/* ⚠️ Capped at the starting deviation. Uncapped, a long enough absence pushes
   past 350 — which says less than "we know nothing", and 350 already means
   that. */
eq('and it never widens past the deviation of somebody unknown',
  Math.round(drift.rd), GLICKO.rd);
eq('however long they are gone, the rating is still theirs', drift.r, 1800);

/* ⚠️⚠️ **The lazy decay has to be exact, not close.** Everything retired sits
   untouched for years and is caught up in one square root when it is next
   needed; if that drifted from the week-by-week answer, every comeback in the
   dataset would be subtly wrong. */
let stepwise = { r: 1700, rd: 45, vol: 0.06, n: 12 };
for (let i = 0; i < 37; i++) stepwise = ratePeriod(stepwise, []);
const atOnce = idle({ r: 1700, rd: 45, vol: 0.06, n: 12 }, 37);
near('thirty-seven idle weeks at once match thirty-seven taken one by one',
  atOnce.rd, stepwise.rd, 1e-9);
eq('and neither moves the rating', atOnce.r, 1700);
eq('nor counts a match', atOnce.n, 12);
eq('no time passing is no change', idle(stepwise, 0).rd, stepwise.rd);
eq('and a week is a week', periodsBetween('2024-01-08', '2024-01-15'), 1);
eq('a year is fifty-two of them', periodsBetween('2024-01-08', '2025-01-06'), 52);
eq('going backwards is not negative time', periodsBetween('2025-01-06', '2024-01-08'), 0);

/* The ordering properties. Deliberately not spot values: those would be this
   implementation checking itself, where these are facts about any Glicko. */
const strong = { r: 2000, rd: 50, vol: 0.06 };
const weak = { r: 1500, rd: 50, vol: 0.06 };
near('two identical competitors are a coin toss', winChance(weak, weak), 0.5, 1e-12);
check('the stronger one is favoured', winChance(strong, weak) > 0.9,
  winChance(strong, weak));
near('and the two chances sum to one',
  winChance(strong, weak) + winChance(weak, strong), 1, 1e-12);
/* ⚠️ **Both deviations, not only the opponent's.** The forecast the prediction
   tests score against has to be less confident when either side is unknown —
   which is exactly where the junior-pool worry lives. */
const unsure = { r: 2000, rd: 300, vol: 0.06 };
check('an uncertain favourite is a less certain favourite',
  winChance(unsure, weak) < winChance(strong, weak),
  winChance(unsure, weak) + ' < ' + winChance(strong, weak));

/* Beating somebody better raises you; losing to somebody worse drops you. */
const beatBetter = ratePeriod(weak, [{ r: 2000, rd: 50, s: 1 }]);
const lostToWorse = ratePeriod(weak, [{ r: 1000, rd: 50, s: 0 }]);
check('beating a better competitor raises the rating', beatBetter.r > weak.r, beatBetter.r);
check('losing to a worse one lowers it', lostToWorse.r < weak.r, lostToWorse.r);
/* ⚠️⚠️ **The asymmetry the reader's junior worry is about.** A result against
   somebody whose rating is barely known moves you less than the same result
   against somebody whose rating is settled — so a closed pool of unknowns
   cannot shunt a well-measured player around. */
const beatUnknown = ratePeriod(weak, [{ r: 2000, rd: 350, s: 1 }]);
check('a win over an unmeasured opponent counts for less than over a measured one',
  beatUnknown.r < beatBetter.r, beatUnknown.r + ' < ' + beatBetter.r);

/* ⚠️⚠️ **Order independence**, which is why opponents are read at their
   start-of-period state. A week whose matches arrive in a different order —
   because a different court finished first — must rate identically. */
const fwd = ratePeriod(weak, games);
const back = ratePeriod(weak, [...games].reverse());
near('a period does not depend on the order its matches arrive in',
  fwd.r, back.r, 1e-9);
near('nor its deviation', fwd.rd, back.rd, 1e-9);

console.log('\n--- applying it to badminton ---');

/* ⚠️ A pair is one competitor whichever order BWF lists them in — the trap
   `podiumKey` already exists for, and the Indonesia Masters is the measured
   case: it lists the same pair both ways round in the slots it puts them in. */
eq('a pair keys the same both ways round',
  competitorKey('WD', ['95106', '61444']), competitorKey('WD', ['61444', '95106']));
check('and a discipline is part of the key, because the five pools never meet',
  competitorKey('MS', ['64032']) !== competitorKey('MD', ['64032']));

/* A week, Monday to Sunday, UTC. */
eq('a Monday is its own period', periodOf('2024-01-08'), '2024-01-08');
eq('and so is the Sunday that closes it', periodOf('2024-01-14'), '2024-01-08');
eq('a Wednesday mid-tournament lands on the same Monday', periodOf('2024-01-10'), '2024-01-08');
/* ⚠️ Monday rather than BWF's Tuesday publication day, so a week holds the
   tournament a Tuesday boundary would cut in half. The 2024 Malaysia Open ran
   Tuesday to Sunday and is one period, not two. */
eq('so a Tuesday-to-Sunday tournament is one period',
  periodOf('2024-01-09'), periodOf('2024-01-14'));
eq('a timestamp is accepted as well as a date', periodOf('2024-01-10 13:00:00'), '2024-01-08');
eq('and nonsense is refused rather than guessed at', periodOf('not a date'), null);

/* ⚠️⚠️ A walkover says nothing about who is better and must not move a rating —
   TUNJUNG's Paris 2024 bronze was won without a match. A retirement is kept:
   somebody trailing 21-11 11-4 who stops was losing, and dropping those would
   delete the record of everyone who plays through injury. */
check('a normal result is ratable',
  ratableMatch({ w: ['1'], l: ['2'], s: '21-15 21-12' }));
check('a walkover is not', !ratableMatch({ w: ['1'], l: ['2'], s: '', x: 4 }));
check('nor is any other status that arrives with no score at all',
  !ratableMatch({ w: ['1'], l: ['2'], s: '', x: 7 }));
check('a retirement with a score is',
  ratableMatch({ w: ['1'], l: ['2'], s: '21-11 11-4', x: 2 }));
/* ⚠️ A hollowed row has a winner and no players — HANDOVER 2.14 — so both sides
   are checked rather than one. */
check('a row with nobody on one side is not', !ratableMatch({ w: ['1'], l: [], s: '21-0' }));
check('and neither is nothing at all', !ratableMatch(null));

process.exit(report());
