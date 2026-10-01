/* What BWF actually lists for the continental championships and the games.
 *
 *   node tools/probe-continental.mjs            2007..this year
 *   node tools/probe-continental.mjs --from 2018
 *
 * One call a season — `vue-grouped-year-tournaments?year=` — and every row whose
 * name sounds continental, printed with the `category` string beside it. The
 * point is to design the classifier on evidence rather than on what the events
 * are called in the abstract: the whole reason `isRegionalGames` matches on the
 * name is that the Asian Games has arrived under four different category ids and
 * under none at all.
 *
 * Prints three things: every candidate row, the distinct category strings each
 * pattern picks up, and a count per season of what the pyramid would gain.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sweepProfiles } from '../tests/browser.mjs';

const API = 'https://extranet-lv.bwfbadminton.com/api/';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEP = String.fromCharCode(1);

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const FROM = Number(arg('--from', 2007));
const TO = Number(arg('--to', new Date().getUTCFullYear()));

/* Deliberately **wider than the rules will be**: anything that might be a
   continental or multi-sport event, so the printout shows what has to be
   excluded as well as what has to be caught. */
const CANDIDATE = /\bgames\b|championships?\b|\bcontinental\b|commonwealth|asia|europ|africa|oceania|americ|pan[\s-]?am/i;

sweepProfiles({ quiet: true });
const b = await launch({ port: 9476, tag: 'continental' });
await b.send('Page.navigate', { url: 'https://bwfworldtour.bwfbadminton.com/' }, b.sessionId);
await b.until('document.readyState === "complete"', { timeout: 40000 });
await b.wait(5000);

async function get(q) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await b.wait(340);
    const out = await b.ev('(async () => { const r = await fetch('
      + JSON.stringify(API) + ' + ' + JSON.stringify(q)
      + ', { headers: { accept: "application/json" } });'
      + ' return r.status + String.fromCharCode(1) + (await r.text()).slice(0, 900000); })()');
    if (typeof out === 'string') {
      try { return JSON.parse(out.slice(out.indexOf(SEP) + 1)); } catch { /* refused */ }
    }
    await b.wait(1200);
  }
  return null;
}

const rows = [];
for (let year = FROM; year <= TO; year++) {
  const j = await get(`vue-grouped-year-tournaments?year=${year}`);
  const all = ((j && j.results) || []).flatMap(m => m.tournaments || []);
  if (!all.length) { console.log(`${year}  nothing`); continue; }
  const hits = all.filter(t => CANDIDATE.test(String(t.name || '')));
  console.log(`\n==== ${year} — ${all.length} tournaments, ${hits.length} candidates ====`);
  for (const t of hits) {
    rows.push({
      year, name: String(t.name || ''), cat: String(t.category || ''),
      code: t.code, id: t.id, start: String(t.start_date || '').slice(0, 10),
      end: String(t.end_date || '').slice(0, 10),
    });
    console.log(`  ${String(t.name).slice(0, 72).padEnd(72)} | ${String(t.category || '').slice(0, 34)}`);
  }
}

fs.writeFileSync(path.join(ROOT, 'tools', 'continental-probe.json'), JSON.stringify(rows, null, 1));
console.log(`\n${rows.length} candidate rows written to tools/continental-probe.json`);

b.close();
process.exit(0);
