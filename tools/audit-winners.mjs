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
