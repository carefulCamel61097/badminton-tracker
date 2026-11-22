/* Did a harvest *improve* the files, or quietly hollow them out?
 *
 *   node tools/verify-harvest.mjs            compare the working tree to HEAD
 *   node tools/verify-harvest.mjs --ref X    compare to some other commit
 *
 * ⚠️⚠️ **The failure an unattended harvest has to be protected from.** These
 * harvests ask BWF a few hundred questions and believe the answers. If the
 * calendar call succeeds and the `day-matches` calls do not — a rate limit part
 * way through, a Cloudflare challenge, a network blip — `harvest-podiums.mjs`
 * finds a final for nothing, and every tournament of the season becomes an
 * *empty column*. It then writes that file out and reports it calmly:
 * "37 events, 0/185 full podiums". Run by hand that is obvious. Run by a
 * schedule that commits and pushes, it replaces a good season with holes and
 * deploys them.
 *
 * ⚠️ So the rule is one-way: a harvest may add and may fill, and may never lose.
 * Anything that *would* lose is a failed run, not a new truth — BWF does not
 * retract finals. Nothing here decides what is correct; it only refuses to
 * believe a file got smaller.
 *
 * ⚠️ `harvest-winners.mjs` cannot trip this, because it merges `had.concat(new)`
 * and a title already recorded is carried over untouched. `harvest-podiums.mjs`
 * rebuilds a season from scratch, which is exactly why it can. Both are checked
 * anyway: the one that cannot fail today is the one that changes next.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const argOf = (name, dflt) => {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const REF = argOf('ref', 'HEAD');

/** A file as the comparison commit has it, or null if it is new. */
function atRef(rel) {
  const r = spawnSync('git', ['show', `${REF}:${rel}`],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}

const now = rel => {
  const at = path.join(ROOT, rel);
  if (!fs.existsSync(at)) return null;
  try { return JSON.parse(fs.readFileSync(at, 'utf8')); } catch { return null; }
};

const problems = [];
const notes = [];
const DRAWS = ['MS', 'WS', 'MD', 'WD', 'XD'];

/* ---- the podium files: events, and how many podiums are filled ---- */

/** Every draw at every event that has a champion. The thing a bad run loses. */
const podiumCount = j => (j.events || []).reduce((n, e) =>
  n + DRAWS.filter(c => (e.draws || {})[c] && (e.draws || {})[c].w != null).length, 0);

for (const f of fs.readdirSync(path.join(ROOT, 'data')).sort()) {
  if (!/^podium-\d{4}\.json$/.test(f)) continue;
  const rel = `data/${f}`;
  const was = atRef(rel);
  const is = now(rel);
  if (!is) { problems.push(`${rel}  is missing or unparseable now`); continue; }
  if (!was) { notes.push(`${rel}  new file, ${podiumCount(is)} podiums`); continue; }

  const a = podiumCount(was);
  const b = podiumCount(is);
  if (b < a) problems.push(`${rel}  podiums ${a} -> ${b}  (lost ${a - b})`);

  /* ⚠️ Counted *and* named. A run that lost one column and gained another nets
     to zero and is still a loss, so the ids are compared as a set. */
  const gone = (was.events || []).map(e => String(e.id))
    .filter(id => !(is.events || []).some(e => String(e.id) === id));
  if (gone.length) problems.push(`${rel}  ${gone.length} event(s) no longer present: ${gone.join(' ')}`);

  /* And a column that had a champion and now does not, which is the shape of a
     part-failed run that kept the column. */
  const hollow = [];
  for (const e of was.events || []) {
    const after = (is.events || []).find(x => String(x.id) === String(e.id));
    if (!after) continue;
    for (const c of DRAWS) {
      const had = (e.draws || {})[c];
      const got = (after.draws || {})[c];
      if (had && had.w != null && !(got && got.w != null)) hollow.push(`${e.id}/${c}`);
    }
  }
  if (hollow.length) {
    problems.push(`${rel}  ${hollow.length} podium(s) hollowed: ${hollow.slice(0, 8).join(' ')}`
      + (hollow.length > 8 ? ' …' : ''));
  }
  if (b > a) notes.push(`${rel}  podiums ${a} -> ${b}  (+${b - a})`);
}

/* ---- the winners files: titles per season, and the planned calendar ---- */

for (const code of DRAWS) {
  const rel = `data/winners-${code}.json`;
  const was = atRef(rel);
  const is = now(rel);
  if (!is) { problems.push(`${rel}  is missing or unparseable now`); continue; }
  if (!was) { notes.push(`${rel}  new file`); continue; }

  let lost = 0;
  let gained = 0;
  for (const [year, list] of Object.entries(was.seasons || {})) {
    const after = (is.seasons || {})[year];
    if (!Array.isArray(after)) { problems.push(`${rel}  season ${year} disappeared`); continue; }
    if (after.length < list.length) {
      problems.push(`${rel}  ${year}: titles ${list.length} -> ${after.length}`);
      lost++;
    } else if (after.length > list.length) gained += after.length - list.length;
    const missing = list.map(t => String(t.id))
      .filter(id => !after.some(t => String(t.id) === id));
    if (missing.length) problems.push(`${rel}  ${year}: title(s) dropped: ${missing.join(' ')}`);
  }
  /* ⚠️ `planned` is keyed per year and merged, so a year vanishing means the
     merge broke — which it did once, when `--from` assigned instead of merging
     and silently dropped 2007 to 2025. */
  for (const year of Object.keys(was.planned || {})) {
    const after = (is.planned || {})[year];
    if (!Array.isArray(after) || !after.length) {
      problems.push(`${rel}  planned[${year}] lost`);
    }
  }
  if (gained) notes.push(`${rel}  +${gained} title(s)`);
  if (!lost && !gained) notes.push(`${rel}  unchanged`);
}

for (const n of notes) console.log('   ' + n);
console.log('');
if (!problems.length) {
  console.log(`PASS  nothing lost against ${REF}.`);
  process.exit(0);
}
for (const p of problems) console.log('FAIL  ' + p);
console.log('');
console.log(`${problems.length} regression(s) against ${REF}. A harvest may add and may`
  + ' fill; it may never lose. This is a failed run, not a new truth — BWF does'
  + ' not retract finals. Do not commit this; re-run the harvest.');
process.exit(1);
