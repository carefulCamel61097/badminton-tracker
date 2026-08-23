/* Can the archive be walked backwards a week at a time?
 *
 * The API dates only the most recent 60 publications. Everything older is
 * reachable by `publicationId` and anonymous. The proposal is to walk down the
 * id space — from each publication, scan downwards for the next id that answers
 * for rankId=2 — and call that the previous week.
 *
 * That is a claim about the data, so it is tested against the one stretch where
 * the truth is known: the 60 dated weeks. If the walk reproduces those 60 ids in
 * order, including the two places where the id jumps by nearly 50, the same walk
 * can be trusted before them. If it invents or skips one, it cannot.
 *
 *   node tools/probe-rank4.mjs [weeksToWalk]
 */
import { launch, sweepProfiles } from '../tests/browser.mjs';

const API = 'https://extranet-lv.bwfbadminton.com/api/';
const NL = String.fromCharCode(10);
const WALK = Number(process.argv[2]) || 59;

sweepProfiles({ quiet: true });
const b = await launch({ port: 9469, tag: 'rank4' });
await b.send('Page.navigate', { url: 'https://bwfworldtour.bwfbadminton.com/' }, b.sessionId);
await b.until('document.readyState === "complete"', { timeout: 40000 });
await b.wait(5000);

let calls = 0;
const get = async path => {
  await b.wait(340);
  calls++;
  const out = await b.ev(`(async () => {
    const r = await fetch(${JSON.stringify(API)} + ${JSON.stringify(path)},
      { headers: { accept: 'application/json' } });
    return r.status + '\u0001' + (await r.text()).slice(0, 200000);
  })()`);
  if (typeof out !== 'string') return null;
  const i = out.indexOf('\u0001');
  try { return JSON.parse(out.slice(i + 1)); } catch { return null; }
};

/* ⚠️ An empty body is how this API refuses a burst (api.js retries once for
   exactly this reason). Without the retry an unlucky refusal reads as "no
   publication here" and the walk silently skips a week. */
const exists = async id => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const j = await get(`vue-rankingtable?rankId=2&catId=6&page=1&drawCount=1`
      + `&searchKey=&publicationId=${id}&doubles=false&pageKey=10`);
    const res = j && j.results;
    const rows = Array.isArray(res) ? res : (res && res.data) || [];
    if (rows.length) {
      const nm = String((rows[0].player1_model || {}).name_display_bold || '')
        .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      return { ok: true, top: nm };
    }
    if (j && j.results !== undefined) return { ok: false };   // a real, empty answer
  }
  return { ok: false };
};

const truth = (await get('vue-rankingweek?rankId=2') || []).slice()
  .sort((a, b) => b.id - a.id);
console.log(`truth: ${truth.length} dated weeks, ${truth[truth.length - 1].id} .. ${truth[0].id}`);

const found = [{ id: truth[0].id, top: '' }];
let id = truth[0].id;
const MAX_SCAN = 80;

for (let step = 0; step < WALK; step++) {
  let next = null;
  for (let k = 1; k <= MAX_SCAN; k++) {
    const r = await exists(id - k);
    if (r.ok) { next = { id: id - k, top: r.top }; break; }
  }
  if (!next) { console.log(`  stopped: nothing within ${MAX_SCAN} below ${id}`); break; }
  found.push(next);
  id = next.id;
}

console.log(NL + `walked ${found.length} publication(s) in ${calls} request(s)`);
const want = truth.slice(0, found.length).map(w => w.id);
const got = found.map(f => f.id);
const same = want.length === got.length && want.every((v, i) => v === got[i]);
console.log('  matches the dated list exactly: ' + (same ? 'YES' : 'NO'));
if (!same) {
  for (let i = 0; i < Math.max(want.length, got.length); i++) {
    if (want[i] !== got[i]) console.log(`    step ${i}: walked ${got[i]}, dated list says ${want[i]}`);
  }
}
console.log(NL + '  the walk, with dates borrowed from the dated list:');
for (let i = 0; i < found.length; i += 6) {
  const t = truth[i] || {};
  console.log(`    ${String(found[i].id).padStart(5)}  ${String(t.date || '?').slice(0, 10)}  ${found[i].top}`);
}

b.close();
process.exit(0);
