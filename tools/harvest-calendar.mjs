/* What a season was *meant* to hold, not only what it has held so far.
 *
 *   node tools/harvest-calendar.mjs              every season in the files
 *   node tools/harvest-calendar.mjs --from 2024  a shorter run
 *
 * ⚠️ **This exists for one column: the season being played.** A domination score
 * is a share, and until December the denominator of the current year is "the
 * titles played so far" — so in January whoever won the first tournament has
 * taken 100 of the season, and in September 2026 every score on the board is
 * inflated by about half again (eight of the twelve are played, 13.71 of 19.33
 * by weight). Against the *whole year* the numerator only grows and the
 * denominator stands still, so a part-played season becomes a **lower bound** on
 * what it will finish at: it can never overstate anybody, and a peak — which is
 * a maximum — can never be dragged down by it either. That is what makes the
 * year in progress safe to count at all.
 *
 * ⚠️ **Finished seasons keep the titles that were actually played.** 2020's
 * denominator has to be the three that happened, not the fifteen that were
 * planned and cancelled; anything else would rank the pandemic seasons as if
 * everybody had failed to win events that never took place. The planned figure
 * is used for the current year and nowhere else — see `dominationSeasons`.
 *
 * `vue-grouped-year-tournaments?year=` is the same call `harvest-winners.mjs`
 * already makes, and it lists events that have not been played yet: at the time
 * of writing it answers for 2027 as well. One call per season, so this is
 * seconds rather than the minutes the winners take, and it is the reason this
 * is a separate tool — the current year's calendar is the one thing in these
 * files that goes stale, and it can be topped up on its own.
 *
 * ⚠️ Tiers are stored, not weights. What a title is worth is the model's
 * decision (`titleWeight`), and a file holding the arithmetic instead of the
 * facts would freeze the ladder at the moment it was written.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { launch } from '../tests/browser.mjs';
import {
  pyramidTier, PYRAMID_ROWS, isContinentalTier, titleConf,
} from '../model.js';

const API = 'https://extranet-lv.bwfbadminton.com/api/';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');

const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i < 0 ? dflt : args[i + 1];
};
const FROM = Number(argOf('from', 2007));

const files = fs.readdirSync(DATA).filter(f => /^winners-[A-Z]{2}\.json$/.test(f));
if (!files.length) { console.log('no data/winners-*.json to top up'); process.exit(1); }

/* Every season any of the files knows about, so all five end up agreeing. */
const years = new Set();
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
  for (const y of Object.keys(j.seasons || {})) if (Number(y) >= FROM) years.add(Number(y));
}

/* ⚠️⚠️ **The coming season, which no file knows about yet — and a January time
   bomb if it is left out.** The list above is derived from the seasons that have
   *titles* in them, so a year nobody has won anything in is never asked for. But
   the first title of a new year arrives **before** anybody would think to fetch
   that year's calendar, and `dominationSeasons` divides an ongoing season by its
   plan: with no plan the denominator falls back to what has been played, so
   whoever won the first Super 750 of January scores a flat **100**.

   Measured 22 Nov 2026 by planting one January 2027 title: denominator 1 and a
   score of 100 without `planned[2027]`, denominator 40.81 and a score of 2.5
   with it. That is the exact failure the ⚠️⚠️ note in `dominationSeasons` exists
   to prevent, reached by a route it does not cover — it guards a calendar that
   has gone *stale*, not one that was never fetched.

   So this year and next are always asked for. BWF publishes a calendar well
   ahead; where it has nothing yet the request simply answers empty and the
   merge below leaves the file alone. */
const THIS_SEASON = new Date().getUTCFullYear();
for (const y of [THIS_SEASON, THIS_SEASON + 1]) if (y >= FROM) years.add(y);
const wanted = new Set(PYRAMID_ROWS.flatMap(r => r.tiers).map(String));

/* ⚠️ Windowed Chrome on a BWF page, exactly as the winners harvest does: the
   API 403s anything that is not a real browser on their own origin. */
const b = await launch({ port: 9487, tag: 'calendar' });
await b.send('Page.navigate', { url: 'https://bwfworldtour.bwfbadminton.com/' }, b.sessionId);
await b.wait(6000);

const get = path => b.ev(`(async () => {
  const r = await fetch(${JSON.stringify(API)} + ${JSON.stringify(path)},
    { headers: { accept: 'application/json' } });
  return r.ok ? await r.json() : null;
})()`, { awaitPromise: true });

const planned = {};
for (const year of [...years].sort((a, b2) => a - b2)) {
  const j = await get(`vue-grouped-year-tournaments?year=${year}`);
  const all = ((j && j.results) || []).flatMap(m => m.tournaments || []);
  if (!all.length) { console.log(`${year}  nothing`); continue; }
  /* ⚠⚠ **Cancelled events are still on the calendar** and must not be counted.
     BWF leaves them in with "(Cancelled)" appended to the name and, more usefully,
     `status.code === 'cancelled'` — 2020 lists nine of these titles and six of
     them never happened. A denominator that includes them would rank everybody
     as having failed to win events that were called off, which is the exact
     mistake this file exists to avoid; and on the *current* season it would
     deflate every score the moment a tournament was dropped.

     ⚠️ On the `status` field, not the name. The name is where it was noticed —
     the suffix is inconsistent, "2021(Cancelled)" against "2022 (Cancelled)" —
     but a label is not a flag, and BWF gives a real one. */
  const live = all.filter(t => !(t.status && String(t.status.code) === 'cancelled'));
  const dropped = all.length - live.length;
  /* The same classification the winners harvest uses, so the two cannot drift:
     everything is asked for and named by `pyramidTier`, because the category
     ids have changed twice and a filter on them does not survive. */
  /* ⚠️⚠️ **A continental entry carries its confederation** — `"11:AS"` rather
     than `11` — because the chips on the winners page move the *denominator*.
     With Asia alone switched on, the 2026 season a score is a share of holds the
     Badminton Asia Championships and the Asian Games and not the four other
     continental championships beside them, and a bare list of tiers cannot say
     that. See `plannedTier` and `plannedConf`.

     ⚠️ De-duplicated on the same key the winners harvest uses, for the same
     reason: BWF lists the same continental event twice in six of twenty seasons
     and a denominator that counted both would be weighing everybody against a
     year that never existed. */
  const seen = new Set();
  const tiers = [];
  for (const t of live) {
    const tier = pyramidTier(t);
    if (tier == null || !wanted.has(String(tier))) continue;
    if (!isContinentalTier(tier)) { tiers.push(tier); continue; }
    const conf = titleConf(t);
    const key = `${tier}:${conf}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tiers.push(key);
  }
  planned[year] = tiers;
  const off = all.filter(t => t.status && String(t.status.code) === 'cancelled')
    .map(t => pyramidTier(t)).filter(t => t != null && wanted.has(String(t)));
  console.log(`${year}  ${String(tiers.length).padStart(2)} on the board`
    + (off.length ? `   (${off.length} cancelled, not counted)` : '')
    + (dropped && !off.length ? `   [${dropped} cancelled, none on the board]` : ''));
}

for (const f of files) {
  const p = path.join(DATA, f);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  /* ⚠️⚠️ **Merged, not replaced, because `--from` used to be a destroying flag.**
   `j.planned = planned` wrote only the years *this run* asked for, so
   `--from 2026` — the documented way to top up the one season that goes stale —
   silently dropped `planned` for 2007 to 2025. It had no visible effect, which
   is why it survived: a finished season's plan is never read, because
   `dominationSeasons` only forecasts a season that is still being played. It
   would have shown up the moment anything pinned `now=` to a past year, which
   the e2e does.
   ⚠️ Keyed per year, so a season re-asked is overwritten and one not asked for
   is kept. A year BWF has no calendar for never reaches `planned` at all (see
   the `continue` above), so it cannot blank an existing one either. */
  j.planned = Object.assign({}, j.planned || {}, planned);
  /* ⚠️⚠️ **Minified, like every other writer of these files.** `harvest-winners.mjs`
   writes `JSON.stringify(state)` and this wrote `JSON.stringify(j, null, 1)`, so
   whichever harvest ran last decided the format and the other one's next run
   reformatted all five files. That is the 15,000-line data diff of 2 Nov 2026,
   where four winners files had been committed pretty-printed and the next
   harvest put them back — a diff nobody can read, over a change of four titles. */
  fs.writeFileSync(p, JSON.stringify(j));
  console.log(`wrote ${f}`);
}

b.close();
process.exit(0);
