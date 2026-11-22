/* Is the winners harvest complete?
 *
 *   node tools/audit-winners.mjs           what is missing, per discipline
 *   node tools/audit-winners.mjs --drop    delete the short seasons, so that
 *                                          `harvest-winners.mjs` re-fetches them
 *
 * ⚠️ **Counting titles per season does not answer this.** A season that is one
 * short looks fine beside a season that is one short in a different tournament,
 * and a missing Olympic gold is a single row in a file of 240. What answers it
 * is the *union of tournament ids* across the five files: every draw plays the
 * same calendar, so a tournament that appears in any file and not in another is
 * a hole in that other one.
 *
 * That is how the doubles boards were found to be missing four of five Olympic
 * golds — the harvest looked for a final on the last day of a tournament and its
 * two neighbours, which is right for a tour event and wrong for a Games, where
 * the five finals are spread over four days. See HANDOVER 3.4n.
 *
 * ⚠️⚠️ **It also answers the other question, which is not "is there a hole" but
 * "has this gone stale".** The union cannot see a tournament that is missing
 * from all five files, and that is the common case: nobody ran the harvest. So
 * the second half of this asks two things the union cannot — how old each file
 * says it is, and whether the planned calendar covers the season being played
 * and the one after it. Added 22 Nov 2026, after the reader found three
 * finished tournaments missing from the Year board and asked, reasonably,
 * whether anything else was quietly in the same state.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CODES = ['MS', 'WS', 'MD', 'WD', 'XD'];
const DROP = process.argv.includes('--drop');

const files = {};
for (const code of CODES) {
  const at = path.join(ROOT, 'data', `winners-${code}.json`);
  if (fs.existsSync(at)) files[code] = JSON.parse(fs.readFileSync(at, 'utf8'));
}
const have = Object.keys(files);
if (have.length < 2) {
  console.log('need at least two harvested files to compare');
  process.exit(0);
}

/* The calendar, as observed: every tournament any discipline recorded, by
   season. Its name comes from whichever file saw it first. */
const calendar = new Map();          // year -> Map(tmtId -> {name, tier})
for (const code of have) {
  for (const [year, list] of Object.entries(files[code].seasons)) {
    if (!calendar.has(year)) calendar.set(year, new Map());
    const season = calendar.get(year);
    for (const t of list) if (!season.has(String(t.id))) season.set(String(t.id), t);
  }
}

const years = [...calendar.keys()].sort();
const short = {};
let holes = 0;

for (const code of have) {
  short[code] = [];
  for (const year of years) {
    const want = calendar.get(year);
    const list = files[code].seasons[year];
    /* A season the file has not harvested at all is not a hole — it is simply
       not done yet, and `--drop` would be a no-op on it. */
    if (!list) continue;
    const got = new Set(list.map(t => String(t.id)));
    const missing = [...want.entries()].filter(([id]) => !got.has(id));
    if (!missing.length) continue;
    short[code].push(year);
    holes += missing.length;
    for (const [, t] of missing) {
      console.log(`${code}  ${year}  missing  ${String(t.tier).padEnd(4)} ${t.name}`);
    }
  }
}

console.log('');
for (const code of have) {
  const total = Object.values(files[code].seasons).flat().length;
  console.log(`${code}  ${String(total).padStart(3)} titles`
    + `  ${Object.keys(files[code].seasons).length} seasons`
    + (short[code].length ? `  short: ${short[code].join(' ')}` : '  complete'));
}
/* ⚠️ "Complete" here means *consistent with the other four*, not right. If every
   discipline missed the same tournament there is nothing to compare against and
   this says nothing — which is exactly the case for a tournament that has been
   played but whose final BWF has not filed for anybody. */
console.log(`\n${holes} hole(s) across ${have.length} disciplines`
  + ' — measured against the union of the five, so a tournament missing from'
  + ' every file cannot be seen here.');

/* ======================= staleness, not holes =======================

   ⚠️⚠️ **Every file here is written by hand and committed**, so the only thing
   that makes the site wrong is nobody having run a harvest. Neither the union
   above nor the test suite can see that: the files are self-consistent and the
   tests pass against them. This is the one place that can say it.
   ================================================================= */

const TODAY = new Date().toISOString().slice(0, 10);
const THIS_SEASON = new Date().getUTCFullYear();
let stale = 0;

console.log('');
for (const code of have) {
  const day = String(files[code].generated || '').slice(0, 10) || '(none)';
  const age = day === '(none)' ? null
    : Math.round((Date.parse(TODAY) - Date.parse(day)) / 86400000);
  const loud = age == null || age > 7;
  if (loud) stale++;
  console.log(`${code}  harvested ${day}`
    + (age == null ? '  ⚠️ the file does not say' : `  ${age} day(s) ago`)
    + (loud && age != null ? '  ⚠️' : ''));
}

/* ⚠️⚠️ **The plan for the season being played, and for the one after it.** An
   ongoing season is scored as a share of its *whole* calendar; with no plan the
   denominator falls back to what has been played so far, and whoever won the
   first title of January reads a flat 100. Measured 22 Nov 2026 by planting one
   January 2027 title: denominator 1 and a score of 100 with no `planned[2027]`,
   denominator 40.81 and a score of 2.5 with it.

   ⚠️ Next year matters as much as this one, because the first title of a year
   arrives before anybody would think to fetch that year's calendar.
   `harvest-calendar.mjs` now always asks for both; this is what checks that it
   did. An **empty** plan counts as missing, because the forecast is switched on
   by `plan.length > 0` and an empty one fails it exactly as an absent one does. */
for (const code of have) {
  const planned = files[code].planned || {};
  const bad = [];
  for (const y of [THIS_SEASON, THIS_SEASON + 1]) {
    const plan = planned[String(y)];
    if (!Array.isArray(plan) || !plan.length) bad.push(y);
  }
  /* And every season that has titles needs one too, because `now=` can be
     pinned to a past year — the e2e does it — and that season is then the
     ongoing one. */
  const unplanned = Object.keys(files[code].seasons)
    .filter(y => !Array.isArray(planned[y]) || !planned[y].length);
  if (!bad.length && !unplanned.length) {
    console.log(`${code}  planned: ${Object.keys(planned).length} season(s),`
      + ` through ${Math.max(...Object.keys(planned).map(Number))}`);
    continue;
  }
  stale++;
  if (bad.length) {
    console.log(`${code}  ⚠️ no planned calendar for ${bad.join(' and ')}`
      + ' — an ongoing season with no plan scores everybody out of what has been'
      + ' played, so the first title of January reads 100.'
      + ' Run: node tools/harvest-calendar.mjs');
  }
  if (unplanned.length) {
    console.log(`${code}  ⚠️ season(s) with titles and no plan: ${unplanned.join(' ')}`);
  }
}

/* ⚠️⚠️ **The podium files, which are the ones that actually went stale.** The
   five winners files hold only the pyramid's tiers, and on 22 Nov 2026 nothing
   at those tiers had been played since the French Open — so they were *correct*
   while three finished Super 500s were missing from the Year board, whose data
   is `data/podium-<year>.json`. An audit that reads only the winners files
   would have reported everything fine on the exact day the reader found it
   broken.

   ⚠️⚠️ The question that catches it is not the date: it is **a tournament that
   has finished and has no podium**. `podiumSeason` already tells the two
   reasons apart and the test is the same one — a harvest that ran on or before
   a tournament's last day cannot have seen the final, so an empty column there
   means nobody asked; later, and BWF really has no record. The first is a
   missing harvest and is loud; the second is a gap in the archive and is not,
   because re-running will not fix it. */
const podiums = fs.readdirSync(path.join(ROOT, 'data'))
  .filter(f => /^podium-\d{4}\.json$/.test(f)).sort();
console.log('');
for (const f of podiums) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
  const day = String(j.generated || '').slice(0, 10) || '';
  const empty = (j.events || []).filter(e => !Object.keys(e.draws || {}).length);
  const done = empty.filter(e => String(e.end) < TODAY);
  /* ⚠️ `<=` on the harvest date, matching `podiumSeason`: a harvest that ran on
     the closing day may have run before the final. The conservative reading
     calls a real gap "unharvested" now and then, which is the better error. */
  const unasked = done.filter(e => day && day <= String(e.end));
  const gone = done.filter(e => !day || day > String(e.end));
  /* A part-filled column counts too: Hong Kong 2026 had three podiums of five
     on its closing day, which is two finals nobody has asked for yet. */
  const part = (j.events || []).filter(e => {
    const k = Object.keys(e.draws || {}).length;
    return k > 0 && k < 5 && day && day <= String(e.end);
  });
  if (!unasked.length && !gone.length && !part.length) continue;
  if (unasked.length || part.length) stale++;
  const bits = [];
  if (unasked.length) bits.push(`⚠️ ${unasked.length} finished, never harvested`);
  if (part.length) bits.push(`⚠️ ${part.length} part-harvested`);
  if (gone.length) bits.push(`${gone.length} with no record in the archive`);
  console.log(`${f}  harvested ${day || '(none)'}  ${bits.join('  ')}`);
  for (const e of [...unasked, ...part]) {
    console.log(`    ⚠️ ${String(e.tier).padEnd(5)} ended ${e.end}  ${e.name}`);
  }
}

console.log('');
if (stale) {
  console.log(`${stale} staleness warning(s). The harvests, in the order they`
    + ' have to run in:');
  console.log('  node tools/harvest-podiums.mjs');
  console.log('  for d in 1 2 3 4 5; do node tools/harvest-winners.mjs --draw $d; done');
  console.log('  node tools/harvest-calendar.mjs');
} else {
  console.log('nothing stale: every file is within a week and every season has a plan.');
}

if (!DROP) {
  if (holes) console.log('re-run with --drop to delete those seasons, then re-harvest');
  process.exit(0);
}

for (const code of have) {
  if (!short[code].length) continue;
  for (const year of short[code]) delete files[code].seasons[year];
  fs.writeFileSync(path.join(ROOT, 'data', `winners-${code}.json`),
    JSON.stringify(files[code]));
  console.log(`dropped ${short[code].length} season(s) from ${code}: ${short[code].join(' ')}`);
}
console.log('\nnow re-run the harvest for each discipline that lost a season.');
