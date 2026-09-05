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
import { pyramidTier, PYRAMID_ROWS } from '../model.js';

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
  /* The same classification the winners harvest uses, so the two cannot drift:
     everything is asked for and named by `pyramidTier`, because the category
     ids have changed twice and a filter on them does not survive. */
  const tiers = all.map(t => pyramidTier(t))
    .filter(t => t != null && wanted.has(String(t)));
  planned[year] = tiers;
  console.log(`${year}  ${String(tiers.length).padStart(2)} on the board`);
}

for (const f of files) {
  const p = path.join(DATA, f);
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  j.planned = planned;
  fs.writeFileSync(p, JSON.stringify(j, null, 1));
  console.log(`wrote ${f}`);
}

b.close();
process.exit(0);
