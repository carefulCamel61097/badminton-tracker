/* The three tests, run over the forecast log.
 *
 *   node tools/rate-report.mjs                      the default run
 *   node tools/rate-report.mjs --tag all --vs senior-only    adds the ablation
 *
 * The reader's own hypothesis, in their words: *"what might happen is that the
 * juniors who don't play the adult tournaments end up with a higher elo rating
 * than the juniors who do, even though the juniors that do are clearly better
 * and that's why they play the adult tournaments."*
 *
 * ⚠️⚠️ **Every test here is stated so that it can come out false.** A diagnostic
 * that can only confirm the thing it was built to look for is not a test, and
 * the temptation with a rating system is overwhelming because every output looks
 * plausible. So each section prints the number, the sample it came from, and a
 * standard error — and the standard error is computed from the model's *own*
 * claim about each match, which is what makes it a test of the model rather
 * than a summary of it.
 *
 * ⚠️ Reads only `raw/`. Nothing here touches the network or the committed data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'raw');

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const TAG = arg('--tag', 'all');
const VS = arg('--vs', '');

/* The column order `rate.mjs` writes, named once. */
const C = {
  period: 0, disc: 1, w: 2, l: 3, p: 4, jr: 5, lv: 6, q: 7, tie: 8,
  wR: 9, wRd: 10, lR: 11, lRd: 12, wN: 13, lN: 14,
};

function load(tag) {
  const fc = path.join(RAW, `forecasts-${tag}.json`);
  const st = path.join(RAW, `ratings-${tag}.json`);
  if (!fs.existsSync(fc)) {
    console.log(`no raw/forecasts-${tag}.json — run \`node tools/rate.mjs --tag ${tag}\` first.`);
    process.exit(1);
  }
  return {
    rows: JSON.parse(fs.readFileSync(fc, 'utf8')),
    state: fs.existsSync(st) ? JSON.parse(fs.readFileSync(st, 'utf8')) : null,
  };
}

const { rows, state } = load(TAG);
const names = (state && state.players) || {};
const nameOf = key => String(key).split(':')[1].split('+')
  .map(i => (names[i] || {}).n || i).join(' / ');

console.log(`forecasts: ${rows.length} rows, tag "${TAG}"`);
if (state) console.log(`periods ${state.periods}, competitors ${state.competitors}, `
  + `seasons ${state.seasons[0]}..${state.seasons[state.seasons.length - 1]}, tau ${state.tau}`);

/* =============================================================== calibration

   Before any of the three: is the model's confidence worth anything at all? A
   forecast of 0.70 should be right about 70% of the time. If this table is
   crooked, every residual below it is measuring the crookedness rather than the
   thing it names. */
console.log('\n================ calibration ================');
const BUCKETS = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.01];
const bins = BUCKETS.slice(0, -1).map(() => ({ n: 0, won: 0, sum: 0 }));
let ll = 0, brier = 0, tosses = 0;
for (const r of rows) {
  const p = r[C.p];
  ll += -Math.log(Math.min(0.999999, Math.max(1e-6, p)));
  brier += (1 - p) * (1 - p);
  /* ⚠️⚠️ **An exact 0.5 has no favourite and must not be bucketed.** The first
     version of this read `favWon = p >= 0.5`, which scores every coin toss as a
     win for a favourite that does not exist — and since a cold-start season is
     nearly a quarter coin tosses, the 0.50-0.55 bucket came out at 83.6% actual
     against 50.9% forecast and looked like catastrophic miscalibration. The same
     mistake as the hit rate in `rate.mjs`, found the same way: a number too
     large to be true. */
  if (p === 0.5) { tosses++; continue; }
  /* ⚠️ Folded onto the favourite's side rather than the winner's. Scored from
     the winner's side every bucket would read 100% by construction. */
  const fav = Math.max(p, 1 - p);
  const favWon = p > 0.5 ? 1 : 0;
  let i = BUCKETS.findIndex((b, k) => fav >= b && fav < BUCKETS[k + 1]);
  if (i < 0) i = 0;
  bins[i].n++; bins[i].won += favWon; bins[i].sum += fav;
}
console.log('  forecast     said   actually   n        gap');
for (let i = 0; i < bins.length; i++) {
  const b = bins[i];
  if (!b.n) continue;
  const said = b.sum / b.n, act = b.won / b.n;
  console.log(`  ${BUCKETS[i].toFixed(2)}-${Math.min(1, BUCKETS[i + 1]).toFixed(2)}  `
    + `${(100 * said).toFixed(1).padStart(6)}%  ${(100 * act).toFixed(1).padStart(7)}%  `
    + `${String(b.n).padStart(7)}  ${((act - said) * 100 >= 0 ? '+' : '')}`
    + `${((act - said) * 100).toFixed(1).padStart(5)} pts`);
}
console.log(`  log-loss ${(ll / rows.length).toFixed(4)} (coin toss 0.6931), `
  + `Brier ${(brier / rows.length).toFixed(4)} (coin toss 0.2500)`);
console.log(`  ${tosses} of ${rows.length} forecasts were exactly 0.5 `
  + `(${(100 * tosses / rows.length).toFixed(1)}%) and are left out of the buckets, `
  + `having no favourite to score`);

/* ============================================= the burn-in

   The reader's question: start in 2007 but do not *show* 2007, because the
   early years are a warm-up while the ratings get going. Right in principle,
   and the length is a thing to measure rather than pick — so this prints, per
   season, the three numbers that say whether the ratings have settled yet.

   ⚠️⚠️ **A cold start is visible as coin tosses, not as bad forecasts.** Every
   competitor begins at 1500 with a deviation of 350, so their first meeting is
   *exactly* 0.5 — a forecast carrying no information at all. 2007 is nearly all
   of those; by the time the share has fallen to its floor the pool has learnt
   who everybody is, and that is where the warm-up ends. Log-loss alone is a
   poorer signal because it keeps improving slowly for other reasons.

   ⚠️ **And the median deviation of the people being ranked is the plainest
   version of the same thing.** A pool whose top twenty still carry ±150 does not
   have a ranking yet; one carrying ±70 does. */
console.log('\n================ the burn-in ================');
console.log('  season   matches   coin tosses   log-loss   mean gap   median ± of top 20');
const seasons = new Map();
for (const r of rows) {
  const y = r[C.period].slice(0, 4);
  if (!seasons.has(y)) seasons.set(y, { n: 0, toss: 0, ll: 0, gap: 0, gapN: 0 });
  const s = seasons.get(y);
  const p = r[C.p];
  s.n++;
  s.ll += -Math.log(Math.min(0.999999, Math.max(1e-6, p)));
  if (p === 0.5) s.toss++;
  else { s.gap += Math.abs(Math.max(p, 1 - p) - (p > 0.5 ? 1 : 0)); s.gapN++; }
}
/* The median deviation among the competitors each season's last table ranked.
   ⚠️ Read from the stored tops rather than recomputed, so it is the same number
   the eventual view would draw. */
const rdBySeason = new Map();
for (const t of (state && state.tops) || []) {
  const y = t.p.slice(0, 4);
  const all = [];
  for (const d of ['MS', 'WS', 'MD', 'WD', 'XD']) {
    for (const row of (t.d[d] || []).slice(0, 20)) all.push(row[2]);
  }
  if (all.length) rdBySeason.set(y, all);
}
const median = a => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const burn = [];
for (const [y, s] of [...seasons].sort()) {
  const rd = median(rdBySeason.get(y) || []);
  burn.push({ y, toss: s.toss / s.n, ll: s.ll / s.n, rd });
  console.log(`  ${y}   ${String(s.n).padStart(7)}   `
    + `${(100 * s.toss / s.n).toFixed(1).padStart(9)}%   `
    + `${(s.ll / s.n).toFixed(4).padStart(8)}   `
    + `${(100 * s.gap / Math.max(1, s.gapN)).toFixed(1).padStart(7)}%   `
    + `${rd == null ? '    -' : ('±' + String(rd).padStart(4))}`);
}
/* ⚠️⚠️ **The verdict is read off the log-loss, and the first version of this read
   it off the coin-toss share — which measures the wrong thing.** On the full
   twenty seasons that share falls 19.1% -> 9.8% between 2007 and 2008 and then
   *rises again* to 11.6% by 2018, because it does not track the cold start once
   the cold start is over: it tracks how many competitors are **new**, and the
   circuit grew from 86 events a season to 281. Trusting it put the end of the
   warm-up at 2014, which would have thrown away six good seasons.

   Log-loss has no such confound. It is 0.6517 in 2007, 0.5958 in 2008, and then
   sits between 0.556 and 0.598 for the remaining eighteen with no trend — so
   the warm-up is **one season**, and the reader's instinct to rate 2007 without
   showing it is exactly the right size of fix.

   ⚠️ The coin-toss column is kept because it is the clearest picture of *why* a
   cold start hurts; it is just not the thing to threshold on. */
if (burn.length > 2) {
  const lls = burn.map(b => b.ll).sort((a, b) => a - b);
  const mid = lls[Math.floor(lls.length / 2)];
  const settled = burn.find(b => b.ll <= mid * 1.05);
  const floor = Math.min(...burn.map(b => b.toss));
  console.log(`\n  median season log-loss ${mid.toFixed(4)}; `
    + `the first season within 5% of it is ${settled ? settled.y : '?'}`);
  console.log(`  — so the warm-up runs to `
    + `${settled ? Number(settled.y) - 1 : '?'}, and seasons from `
    + `${settled ? settled.y : '?'} are worth showing.`);
  console.log(`  ⚠️ the coin-toss share bottoms at ${(100 * floor).toFixed(1)}% but `
    + `rises again as the circuit grows, so it is not what the verdict uses.`);
}

/* ====================================================== who is anchored

   "Anchored" means: this competitor appears in at least one senior match
   somewhere in the dataset. Read off the log itself rather than the calendar,
   because what matters to a rating is whether senior-level information ever
   reached them, not what the event was called. */
const anchored = new Set();
const jrCount = new Map();
const firstSenior = new Map();
for (const r of rows) {
  for (const key of [r[C.w], r[C.l]]) {
    if (!r[C.jr]) {
      anchored.add(key);
      if (!firstSenior.has(key)) firstSenior.set(key, r[C.period]);
    } else {
      jrCount.set(key, (jrCount.get(key) || 0) + 1);
    }
  }
}
console.log(`\n${anchored.size} competitors have at least one senior match; `
  + `${[...jrCount.keys()].filter(k => !anchored.has(k)).length} are junior-only`);

/** mean(actual − forecast) with the standard error the model itself implies. */
function residual(samples) {
  let sum = 0, varSum = 0, n = 0;
  for (const { p, won } of samples) { sum += won - p; varSum += p * (1 - p); n++; }
  if (!n) return null;
  return { n, mean: sum / n, se: Math.sqrt(varSum) / n };
}
const verdict = r => {
  if (!r) return 'no sample';
  const z = r.mean / r.se;
  const sign = r.mean >= 0 ? '+' : '';
  return `${sign}${(100 * r.mean).toFixed(2)} pts  ±${(100 * r.se).toFixed(2)}  `
    + `(z = ${z.toFixed(1)}, n = ${r.n})  ${Math.abs(z) < 2 ? 'no detectable bias' : 'BIAS'}`;
};

/* ============================================= 1. the bias check

   Junior matches with an anchored player on one side and an unanchored player
   on the other. If unanchored ratings are inflated, the model over-predicts the
   unanchored side and this comes out negative. */
console.log('\n================ 1. the bias check ================');
console.log('junior matches, one side anchored and one side not,');
console.log('scored from the UNANCHORED side. Negative = they are over-rated.');
/* ⚠️⚠️ **A control has to pick its side without looking at the result, and the
   first version of this did not.** It scored both controls as
   `{ p, won: 1 }` — the winner's side — which makes the residual `1 - p` every
   time and therefore positive by construction: they printed +42.7 and +48.1
   points and I nearly read that as the model being broken. The sides are now
   picked by **key order**, which is fixed before any match is played and cannot
   know who won. A calibrated model then reads ~0, and that is what makes a
   non-zero number in the line above mean something. */
const sideByKey = r => (r[C.w] < r[C.l]
  ? { p: r[C.p], won: 1 }
  : { p: 1 - r[C.p], won: 0 });
const mixed = [];
const bothAnch = [];
const neither = [];
for (const r of rows) {
  if (!r[C.jr]) continue;
  const wA = anchored.has(r[C.w]), lA = anchored.has(r[C.l]);
  if (wA && lA) { bothAnch.push(sideByKey(r)); continue; }
  if (!wA && !lA) { neither.push(sideByKey(r)); continue; }
  /* ⚠️ Valid as it stands: "which side is unanchored" is settled by who they
     played against all season, not by this match's result. */
  mixed.push(wA ? { p: 1 - r[C.p], won: 0 } : { p: r[C.p], won: 1 });
}
console.log('  unanchored vs anchored   ' + verdict(residual(mixed)));
console.log('  (control) both anchored  ' + verdict(residual(bothAnch)));
console.log('  (control) neither        ' + verdict(residual(neither)));
console.log('  ⚠️ the controls are scored from whichever side sorts first, which is');
console.log('     independent of the result, so a calibrated model reads ~0 there.');
console.log('     That is what makes the first line mean something.');

/* ============================================= 2. the debut test

   The strongest of the three, because the ground truth is real senior results.
   A junior's first ten senior matches, sliced by how much junior-only form they
   brought with them. If junior ratings are inflated, debutants underperform
   their forecast, and the ones with more junior form underperform more. */
console.log('\n================ 2. the debut test ================');
console.log('first 10 senior matches, scored from the DEBUTANT\'S side,');
console.log('split by how many junior matches they had already played.');
const SLICES = [[0, 0], [1, 20], [21, 60], [61, 1e9]];
const buckets = SLICES.map(() => []);
const perKey = new Map();
for (const r of rows) {
  if (r[C.jr]) continue;
  for (const [key, p, won] of [[r[C.w], r[C.p], 1], [r[C.l], 1 - r[C.p], 0]]) {
    /* ⚠️⚠️ **`jrCount.has(key)` was here, and it made the control impossible.**
       The 0-junior slice is the whole point of the comparison — players who came
       straight into senior badminton — and requiring a junior match to exist
       excluded every one of them, so the slice printed "no sample" and the test
       had nothing to be measured against. */
    if (firstSenior.get(key) !== undefined) {
      const seen = perKey.get(key) || 0;
      if (seen >= 10) continue;
      perKey.set(key, seen + 1);
      const jn = jrCount.get(key) || 0;
      const i = SLICES.findIndex(([a, b]) => jn >= a && jn <= b);
      if (i >= 0) buckets[i].push({ p, won });
    }
  }
}
SLICES.forEach(([a, b], i) => {
  const label = b >= 1e9 ? `${a}+` : (a === b ? String(a) : `${a}-${b}`);
  console.log(`  ${label.padEnd(8)} junior matches first   ${verdict(residual(buckets[i]))}`);
});
console.log('  ⚠️ a slice growing more negative as the junior count rises is the');
console.log('     reader\'s hypothesis coming out TRUE.');

/* ============================================= 3. the ablation */
console.log('\n================ 3. the ablation ================');
if (!VS) {
  console.log('  skipped: pass --vs <tag> with a second run to compare.');
  console.log('  e.g.  node tools/rate.mjs --no-juniors --tag senior-only');
  console.log('        node tools/rate-report.mjs --tag all --vs senior-only');
} else {
  const other = load(VS);
  /* ⚠️ Compared only on the matches both runs rated, keyed on the match's own
     identity. A run that admits junior events rates strictly more matches, and
     comparing a log-loss over different samples compares nothing. */
  const key = r => r[C.period] + '|' + r[C.disc] + '|' + r[C.w] + '|' + r[C.l];
  const mine = new Map();
  for (const r of rows) if (!r[C.jr]) mine.set(key(r), r[C.p]);
  let n = 0, a = 0, b = 0, aFav = 0, bFav = 0;
  for (const r of other.rows) {
    if (r[C.jr]) continue;
    const k = key(r);
    if (!mine.has(k)) continue;
    const pa = Math.min(0.999999, Math.max(1e-6, mine.get(k)));
    const pb = Math.min(0.999999, Math.max(1e-6, r[C.p]));
    a += -Math.log(pa); b += -Math.log(pb); n++;
    if (pa > 0.5) aFav++;
    if (pb > 0.5) bFav++;
  }
  if (!n) console.log('  no shared senior matches — are the two runs over the same seasons?');
  else {
    console.log(`  on the ${n} senior matches both runs rated:`);
    console.log(`     with juniors  (${TAG})  log-loss ${(a / n).toFixed(4)}, `
      + `favourite right ${(100 * aFav / n).toFixed(1)}%`);
    console.log(`     without       (${VS})  log-loss ${(b / n).toFixed(4)}, `
      + `favourite right ${(100 * bFav / n).toFixed(1)}%`);
    const d = (b - a) / n;
    console.log(`  ⚠️ junior data ${d > 0 ? 'HELPS' : 'HURTS'} by `
      + `${Math.abs(d).toFixed(4)} nats a match`
      + `${Math.abs(d) < 0.002 ? ' — which is inside the noise, so: no effect' : ''}`);
  }
}

/* ------------------------------------------------- the eyeball check

   Not a test. The names at the top of a rating are the one diagnostic that
   needs no statistics: if they are wrong, nothing above matters. */
if (state && state.tops && state.tops.length) {
  const last = state.tops[state.tops.length - 1];
  console.log(`\n================ the top of ${last.p} ================`);
  for (const d of ['MS', 'WS']) {
    const list = (last.d[d] || []).slice(0, 8);
    if (!list.length) continue;
    console.log(`  ${d}`);
    list.forEach(([ids, r, rd, k, s], i) => {
      const key = d + ':' + ids.split('+').sort().join('+');
      const jn = jrCount.get(key) || 0;
      console.log(`   ${String(i + 1).padStart(2)}  ${String(s).padStart(4)} `
        + `(${r} ±${rd}, ${k} played${jn ? `, ${jn} junior` : ''})`
        + `${anchored.has(key) ? '' : '  ⚠️ NEVER PLAYED A SENIOR MATCH'}`
        + `   ${nameOf(key)}`);
    });
  }
}
console.log('');
