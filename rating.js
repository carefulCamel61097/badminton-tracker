/* Glicko-2, and the decisions about how to apply it to badminton.
 *
 * Settled with the reader 21 Oct 2026, after one correction: the rating
 * deviation is **not** an extra column alongside an Elo number. It feeds back
 * into the update — a rating moves further when its own uncertainty is high and
 * less when the *opponent's* is high — and that feedback is the whole reason to
 * use Glicko-2 here. It is what stops a junior with three matches dragging a
 * three-hundred-match senior around, and what stops a newcomer sitting at the
 * default for a year. Strip it and you keep the bookkeeping and lose the
 * mechanism.
 *
 * ⚠️ So these ratings are not Elo's, and a view that shows them should not call
 * them Elo. badmintonranks.com publishes "Elo"; this will differ from theirs for
 * that reason as well as every other.
 *
 * The maths is Glickman's, unchanged, and `tests/test_rating.mjs` checks it
 * against the worked example in his own paper before it checks anything of ours.
 */

/* ⚠️ `tau` constrains how fast volatility may move, and Glickman says 0.3–1.2
   with smaller values for a system where form does not swing much. 0.5 is the
   middle of what he recommends and is where every reference implementation
   starts. It is the one constant here that genuinely wants tuning against the
   held-out prediction tests rather than reasoning. */
export const GLICKO = {
  rating: 1500,
  rd: 350,
  vol: 0.06,
  tau: 0.5,
  /* 173.7178 = 400/ln(10). Glicko-2 works on a scale where one unit is one
     logistic point; the 1500/350 numbers people recognise are that scale
     stretched by this. */
  scale: 173.7178,
  eps: 1e-6,
};

export const newCompetitor = (o = {}) => ({
  r: o.r != null ? o.r : GLICKO.rating,
  rd: o.rd != null ? o.rd : GLICKO.rd,
  vol: o.vol != null ? o.vol : GLICKO.vol,
  n: o.n || 0,
});

const g = phi => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
const E = (mu, muJ, phiJ) => 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/**
 * One rating period for one competitor.
 *
 * `games` is `[{ r, rd, s }, …]` — the opponent as they were **at the start of
 * the period**, and `s` of 1 for a win, 0 for a loss, 0.5 for a draw that
 * badminton does not have but the maths allows.
 *
 * ⚠️⚠️ **Opponents are read at the start of the period, not updated within it.**
 * That is Glicko-2's definition and not a shortcut: every competitor in a period
 * is rated against everyone else's pre-period state, so the result does not
 * depend on the order the matches are fed in. An implementation that updated as
 * it went would give a different answer for the same week depending on which
 * court finished first.
 *
 * @param {{r:number, rd:number, vol:number}} me
 * @param {Array<{r:number, rd:number, s:number}>} games
 * @param {{tau?:number}} [opts]
 */
export function ratePeriod(me, games, opts = {}) {
  const tau = opts.tau != null ? opts.tau : GLICKO.tau;
  const S = GLICKO.scale;
  const mu = (me.r - GLICKO.rating) / S;
  const phi = me.rd / S;

  /* ⚠️ A competitor who did not play still changes: uncertainty grows by the
     volatility. Without this a player who stops for two years comes back with
     the deviation they retired on, and the rating is then treated as current
     evidence when it is two years stale. */
  if (!games.length) {
    const grown = Math.sqrt(phi * phi + me.vol * me.vol);
    /* ⚠️ Capped at the starting deviation. Glickman does not cap it; left
       uncapped a long absence pushes past 350, which says less than "we know
       nothing", which is what 350 already means. */
    return { r: me.r, rd: Math.min(GLICKO.rd, S * grown), vol: me.vol, n: me.n || 0 };
  }

  let v = 0;      // 1 / estimated variance
  let dSum = 0;   // Σ g(φj)(sj − E)
  for (const o of games) {
    const muJ = (o.r - GLICKO.rating) / S;
    const phiJ = o.rd / S;
    const gj = g(phiJ);
    const e = E(mu, muJ, phiJ);
    v += gj * gj * e * (1 - e);
    dSum += gj * (o.s - e);
  }
  v = 1 / v;
  const delta = v * dSum;

  /* Step 5: the new volatility, by Illinois-variant regula falsi — Glickman's
     own procedure, converging on ln(σ'²). */
  const a = Math.log(me.vol * me.vol);
  const f = x => {
    const ex = Math.exp(x);
    const d2 = delta * delta;
    const pv = phi * phi + v + ex;
    return (ex * (d2 - phi * phi - v - ex)) / (2 * pv * pv) - (x - a) / (tau * tau);
  };

  let A = a;
  let B;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  /* ⚠️ Bounded, not `while (…)`. The loop is guaranteed to converge on
     well-formed input and a NaN anywhere in the input would otherwise spin
     forever — and this runs over hundreds of thousands of matches where one bad
     row must not hang the whole harvest. */
  for (let i = 0; i < 100 && Math.abs(B - A) > GLICKO.eps; i++) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else { fA = fA / 2; }
    B = C; fB = fC;
  }
  const vol2 = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + vol2 * vol2);
  const phi2 = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const mu2 = mu + phi2 * phi2 * dSum;

  return {
    r: S * mu2 + GLICKO.rating,
    rd: S * phi2,
    vol: vol2,
    n: (me.n || 0) + games.length,
  };
}

/**
 * Several idle periods at once, in closed form.
 *
 * ⚠️⚠️ **Why this exists rather than looping `ratePeriod(me, [])`.** Decaying
 * every known competitor every week is O(competitors — periods): a hundred
 * thousand competitors over a thousand weeks is a hundred million updates, and
 * almost all of them are for people who retired years ago. Idle periods only
 * widen phi and never touch the rating or the volatility, so k of them are
 * exactly one square root — which means the decay can be applied lazily, when a
 * competitor next plays or is read out, with no approximation at all.
 *
 * ⚠️ The cap does not break the equivalence: growth is monotonic, so capping
 * each step and capping once give the same answer.
 */
export function idle(me, periods) {
  const k = Number(periods) || 0;
  if (k <= 0) return { r: me.r, rd: me.rd, vol: me.vol, n: me.n || 0 };
  const S = GLICKO.scale;
  const phi = me.rd / S;
  const grown = Math.sqrt(phi * phi + k * me.vol * me.vol);
  return { r: me.r, rd: Math.min(GLICKO.rd, S * grown), vol: me.vol, n: me.n || 0 };
}

/** How many whole rating periods lie between two period keys. */
export function periodsBetween(from, to) {
  const a = new Date(from + 'T00:00:00Z').getTime();
  const b = new Date(to + 'T00:00:00Z').getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / (7 * 86400000)));
}

/**
 * The chance the first competitor beats the second, both uncertainties counted.
 *
 * ⚠️ **Both deviations, not just the opponent's.** This is the number the
 * prediction tests score against, and a forecast that ignored its own
 * uncertainty would be overconfident exactly where the reader's junior-pool
 * worry lives.
 */
export function winChance(a, b) {
  const S = GLICKO.scale;
  const mu = (a.r - GLICKO.rating) / S;
  const muJ = (b.r - GLICKO.rating) / S;
  const phi = Math.sqrt((a.rd * a.rd + b.rd * b.rd)) / S;
  return 1 / (1 + Math.exp(-g(phi) * (mu - muJ)));
}

/* ------------------------------------------------------------ applying it

   ⚠️⚠️ **A pair is one competitor.** The reader's own framing — "elo ratings of
   players and pairs" — and the only choice that survives contact with the data:
   the same two people are one entity whichever order BWF lists them in, which
   is the trap `podiumKey` already exists for. A per-player doubles rating would
   need a partnership model, and nothing in this data says how to split the
   credit for a win between two people on the same side of the net.

   ⚠️⚠️ **Five pools, not one.** MS, WS, MD, WD and XD never play each other, so
   a single pool would hold five disconnected graphs whose numbers are not
   comparable — the very failure the junior-pool question was about, except
   guaranteed rather than possible. Keyed by discipline throughout.
*/
export const competitorKey = (discipline, ids) =>
  discipline + ':' + [...ids].map(String).sort().join('+');

/**
 * The rating period a date falls in: the Monday of its week, UTC.
 *
 * ⚠️⚠️ **A week, because Glicko-2 is defined over periods and badminton has an
 * obvious one.** Glickman wants enough games per period to estimate a variance —
 * he suggests 10 to 15 — and a badminton week gives an active competitor five to
 * seven. Shorter than that (per match) and the period machinery does nothing;
 * longer (per month) and two tournaments' form gets averaged into one update.
 *
 * ⚠️ And a week is **BWF's own cadence**: the world ranking is published weekly,
 * so a weekly rating lines up with the thing it is going to be compared against
 * without anybody having to interpolate. Monday rather than BWF's Tuesday
 * publication, so a week contains the tournament that a Tuesday would split.
 */
export function periodOf(date) {
  const d = new Date(String(date).slice(0, 10) + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return null;
  const dow = (d.getUTCDay() + 6) % 7;      // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/**
 * Should this match move a rating?
 *
 * ⚠️⚠️ **A walkover must not.** `scoreStatus` is 0 for a normal result and
 * anything else is a retirement, a walkover or a disqualification; the harvest
 * stores it as `x`. A walkover has no score at all and says nothing about who is
 * better — Carolina MARIN's Paris 2024 bronze was won without a match being
 * played. ⚠️ A **retirement** is the harder case and is admitted: a player who
 * retires at 21-11 11-4 down was losing, and discarding those would quietly
 * delete the results of everyone who plays through injury.
 */
export function ratableMatch(m) {
  if (!m || !Array.isArray(m.w) || !Array.isArray(m.l)) return false;
  if (!m.w.length || !m.l.length) return false;
  /* 4 is "Walkover" in BWF's own enumeration; the retirement codes keep a
     score and are kept. ⚠️ Measured on 2024 and 2015: the only statuses that
     arrive with an empty score are walkovers, so an empty score is checked too
     rather than trusting one magic number. */
  if (m.x === 4) return false;
  if (m.x && !m.s) return false;
  return true;
}
