/* Glicko-2 over the harvested matches, week by week.
 *
 *   node tools/rate.mjs                        every season on disk
 *   node tools/rate.mjs --from 2018 --to 2026
 *   node tools/rate.mjs --no-juniors --tag senior-only    (the ablation)
 *   node tools/rate.mjs --tau 0.3
 *
 * Reads `raw/matches-<year>.json` and writes two things, both local:
 *
 *   raw/ratings-<tag>.json    the final state, and the top of each period
 *   raw/forecasts-<tag>.json  one row per rated match: what the model thought
 *                             *before* it, and the flags needed to slice that
 *
 * ⚠️⚠️ **The forecast log is the point, not a by-product.** All three tests the
 * reader asked for need a competitor's rating as it stood *before* a given
 * match, and that number exists exactly once — at the moment the match is rated.
 * Reconstructing it afterwards would mean replaying the whole season to answer
 * one question. So every match leaves a row behind, and the tests are then
 * arithmetic over a file rather than another twenty-minute run:
 *
 *   1. the bias check   — mean (actual − forecast) on anchored vs unanchored
 *                         junior matches, which is the reader's own hypothesis
 *                         stated as something that can come out false
 *   2. the debut test   — a junior's forecast in their first senior matches
 *   3. the ablation     — run twice with --no-juniors and compare log-loss on
 *                         the senior matches both runs share
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GLICKO, newCompetitor, ratePeriod, winChance,
  competitorKey, periodOf, periodsBetween, idle, ratableMatch,
} from '../rating.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'raw');

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const has = flag => process.argv.includes(flag);

const ONE = Number(arg('--year', 0));
const FROM = ONE || Number(arg('--from', 0));
const TO = ONE || Number(arg('--to', 9999));
const TAU = Number(arg('--tau', GLICKO.tau));
const JUNIORS = !has('--no-juniors');
const TEAMS = !has('--no-teams');
const TAG = arg('--tag', JUNIORS ? (TEAMS ? 'all' : 'no-teams') : 'senior-only');
const TOPN = Number(arg('--top', 60));

/* ⚠️⚠️ **How to *rank* a Glicko-2 rating is a real choice, not a detail.** Rank
   on the rating alone and a competitor with ten matches and one good week tops
   the table — which is the reader's junior-inflation worry arriving by the front
   door rather than the back. Rank on a conservative score — the rating less two
   deviations, the usual convention — and a newcomer has to earn certainty before
   they can lead, at the cost of holding a genuinely fast riser back for months.

   Conservative is the default because an over-confident table is the worse of
   the two failures, and **both numbers are stored** so the forecast log can
   settle this by measurement rather than by preference. */
const RANK_BY = arg('--rank', 'safe');
const rankScore = c => (RANK_BY === 'r' ? c.r : c.r - 2 * c.rd);

/* ------------------------------------------------------------ read the files */
const files = fs.existsSync(RAW)
  ? fs.readdirSync(RAW).filter(f => /^matches-\d{4}\.json$/.test(f))
      .map(f => ({ f, year: Number(f.slice(8, 12)) }))
      .filter(x => x.year >= FROM && x.year <= TO)
      .sort((a, b) => a.year - b.year)
  : [];
if (!files.length) {
  console.log(`nothing to rate: no raw/matches-<year>.json in ${FROM}..${TO}.`);
  console.log('run `node tools/harvest-matches.mjs` first.');
  process.exit(1);
}

/* period -> [{disc, w, l, jr, lv, q, tie, ev}] ; one flat pass, then sorted,
   because a tournament can straddle a Sunday and the Finals of one season is
   played in the next. */
const byPeriod = new Map();
const names = new Map();       // player id -> {n, c}
let read = 0, skipped = 0;

for (const { f, year } of files) {
  const j = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
  for (const [id, p] of Object.entries(j.players || {})) if (!names.has(id)) names.set(id, p);
  for (const t of j.tournaments || []) {
    if (t.jr && !JUNIORS) continue;
    if (t.team && !TEAMS) continue;
    for (const m of t.m || []) {
      read++;
      if (!ratableMatch(m)) { skipped++; continue; }
      const key = periodOf(m.t);
      if (!key) { skipped++; continue; }
      if (!byPeriod.has(key)) byPeriod.set(key, []);
      byPeriod.get(key).push({
        disc: m.d, w: m.w, l: m.l,
        jr: t.jr ? 1 : 0, lv: t.lv, q: m.q ? 1 : 0, tie: m.tie ? 1 : 0, ev: t.id,
      });
    }
  }
  process.stdout.write(`read ${year}: ${(j.matches || 0)} matches, ${(j.events || 0)} events\n`);
}

const periods = [...byPeriod.keys()].sort();
console.log(`\n${read} matches read, ${skipped} not ratable, `
  + `${periods.length} rating periods from ${periods[0]} to ${periods[periods.length - 1]}`);

/* --------------------------------------------------------------- rate them */
const state = new Map();       // competitorKey -> {r, rd, vol, n, last, ids, disc}
const forecasts = [];
const tops = [];

const seen = (key, disc, ids, period) => {
  let c = state.get(key);
  if (!c) {
    c = Object.assign(newCompetitor(), { last: period, ids, disc });
    state.set(key, c);
  }
  return c;
};

for (const period of periods) {
  const rows = byPeriod.get(period);

  /* ⚠️⚠️ **Every opponent is read at their start-of-period state, and that is
     Glicko-2's definition rather than a shortcut.** It also makes the week
     order-independent: which court finished first cannot change the answer. So
     the snapshot is taken before a single update is applied. */
  const snap = new Map();
  const take = (disc, ids) => {
    const key = competitorKey(disc, ids);
    if (!snap.has(key)) {
      const c = seen(key, disc, ids, period);
      /* The lazy decay: everything idle since `last` is caught up in one
         square root, exactly as if it had been stepped week by week. */
      const grown = idle(c, periodsBetween(c.last, period));
      snap.set(key, { r: grown.r, rd: grown.rd, vol: grown.vol, n: grown.n });
    }
    return key;
  };

  const games = new Map();     // key -> [{r, rd, s}]
  const push = (key, opp, s) => {
    if (!games.has(key)) games.set(key, []);
    games.get(key).push({ r: opp.r, rd: opp.rd, s });
  };

  for (const m of rows) {
    const wk = take(m.disc, m.w);
    const lk = take(m.disc, m.l);
    /* ⚠️ A competitor cannot play themselves. It happens: a doubles pair listed
       with one id twice is a BWF data fault, and left in it would feed the
       maths a self-match. */
    if (wk === lk) { skipped++; continue; }
    const W = snap.get(wk), L = snap.get(lk);
    forecasts.push([period, m.disc, wk, lk, Number(winChance(W, L).toFixed(5)),
      m.jr, m.lv, m.q, m.tie, Math.round(W.r), Math.round(W.rd),
      Math.round(L.r), Math.round(L.rd), W.n, L.n]);
    push(wk, L, 1);
    push(lk, W, 0);
  }

  for (const [key, list] of games) {
    const c = state.get(key);
    const next = ratePeriod(snap.get(key), list, { tau: TAU });
    c.r = next.r; c.rd = next.rd; c.vol = next.vol; c.n = next.n; c.last = period;
  }

  /* The top of this period, for the view that will eventually draw it. Only
     competitors who have actually played enough to be worth ranking: a 1500
     with a deviation of 350 is not a number, it is an absence of one. */
  const ranked = [...state.values()]
    .filter(c => c.last === period || periodsBetween(c.last, period) <= 52)
    .filter(c => c.n >= 10);
  const byDisc = {};
  for (const d of ['MS', 'WS', 'MD', 'WD', 'XD']) {
    byDisc[d] = ranked.filter(c => c.disc === d)
      /* ⚠️ Decayed to *this* period before ranking, not left as of whenever
         they last played: a table for December must not rank a March rating as
         though it were still fresh. */
      .map(c => ({ c, g: idle(c, periodsBetween(c.last, period)) }))
      .map(x => Object.assign(x, { s: rankScore(x.g) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, TOPN)
      .map(({ c, g, s }) => [c.ids.join('+'), Math.round(g.r), Math.round(g.rd),
        c.n, Math.round(s)]);
  }
  tops.push({ p: period, d: byDisc });
}

/* ------------------------------------------------------------------ write it */
fs.mkdirSync(RAW, { recursive: true });
const players = {};
for (const [id, p] of names) players[id] = p;

const outState = path.join(RAW, `ratings-${TAG}.json`);
fs.writeFileSync(outState, JSON.stringify({
  generated: new Date().toISOString(),
  tag: TAG, tau: TAU, juniors: JUNIORS, teams: TEAMS,
  seasons: files.map(x => x.year),
  periods: periods.length,
  competitors: state.size,
  players,
  /* ⚠️ The column order is the forecast row's, documented once here rather
     than repeated in every reader. */
  rankBy: RANK_BY,
  topColumns: ['ids', 'rating', 'deviation', 'matches', 'rankScore'],
  forecastColumns: ['period', 'disc', 'winnerKey', 'loserKey', 'pWinnerWins',
    'junior', 'level', 'qualifying', 'teamTie',
    'wR', 'wRd', 'lR', 'lRd', 'wN', 'lN'],
  tops,
  final: [...state.entries()].map(([k, c]) =>
    [k, Math.round(c.r * 10) / 10, Math.round(c.rd * 10) / 10,
     Math.round(c.vol * 1e6) / 1e6, c.n, c.last]),
}));

const outFc = path.join(RAW, `forecasts-${TAG}.json`);
fs.writeFileSync(outFc, JSON.stringify(forecasts));

/* ------------------------------------------------------- say what came out */
const nameOf = c => c.ids.map(i => (names.get(i) || {}).n || i).join(' / ');
console.log(`\n${state.size} competitors rated, ${forecasts.length} forecasts logged`);
console.log(`→ ${outState} (${Math.round(fs.statSync(outState).size / 1024)} KB)`);
console.log(`→ ${outFc} (${Math.round(fs.statSync(outFc).size / 1024)} KB)`);

/* The honest scoreboard for the run as a whole: a forecast of 0.5 on everything
   scores 0.6931, so anything above that is worse than knowing nothing.

   ⚠️⚠️ **Ties are counted as ties, and the first version of this did not.**
   `p > 0.5` reported that the favourite won 49.4% of 2022's matches — which would
   mean no skill whatsoever — while the log-loss over the very same forecasts said
   0.6423 against a coin toss's 0.6931. Both cannot be true, and the resolution
   is that a single cold-start season is mostly 1500-against-1500 first meetings
   whose forecast is **exactly** 0.5: every one of those failed a strict `>` and was
   scored as though the favourite had lost. A metric that buries a third of its
   sample in the denominator is worse than no metric, so the coin tosses are now
   counted, excluded from the hit rate, and named. */
let ll = 0, n = 0, hit = 0, toss = 0;
for (const f of forecasts) {
  const raw = f[4];
  const p = Math.min(0.999999, Math.max(1e-6, raw));
  ll += -Math.log(p); n++;
  if (raw === 0.5) toss++;
  else if (raw > 0.5) hit++;
}
const decided = n - toss;
console.log(`\nin-sample log-loss ${(ll / n).toFixed(4)} (a coin toss is 0.6931)`);
console.log(`favourite won ${(100 * hit / Math.max(1, decided)).toFixed(1)}% `
  + `of the ${decided} matches that had one; ${toss} were exact coin tosses `
  + `(${(100 * toss / n).toFixed(1)}% of the sample)`);

const last = periods[periods.length - 1];
for (const d of ['MS', 'WS', 'MD', 'WD', 'XD']) {
  const rows = (tops[tops.length - 1].d[d] || []).slice(0, 10);
  if (!rows.length) continue;
  console.log(`\n=== ${d}, week of ${last} ===  ranked by `
    + (RANK_BY === 'r' ? 'rating' : 'rating minus two deviations'));
  rows.forEach(([ids, r, rd, k, s], i) => {
    const c = state.get(competitorKey(d, ids.split('+')));
    console.log(`  ${String(i + 1).padStart(2)}  ${String(s).padStart(4)}  `
      + `(${String(r).padStart(4)} ±${String(rd).padStart(3)}, ${String(k).padStart(3)} played)`
      + `   ${c ? nameOf(c) : ids}`);
  });
}
