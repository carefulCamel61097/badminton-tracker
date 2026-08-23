/* Who won a tournament, and what did a season hold?
 *
 * The app is entirely player-centric: every endpoint it uses is keyed on a
 * player id. A pyramid of winners asks the opposite question — given a
 * tournament, who won it — and nothing in the project answers that yet.
 *
 * Two things to establish before harvesting anything:
 *
 *   1. `vue-grouped-year-tournaments` returns a whole season in one call
 *      (HANDOVER 3.2). Does it carry the Olympics and the Asian Games, and what
 *      does it call them? ⚠️ The level arrives here as a *display string*, not
 *      the numeric id the player endpoint uses.
 *   2. `vue-tournament-draw-data?drawId=1` is the men's singles draw. Does it
 *      name a winner outright, or does the final have to be found and read?
 *
 *   node tools/probe-winners.mjs
 */
import { launch, sweepProfiles } from '../tests/browser.mjs';

const API = 'https://extranet-lv.bwfbadminton.com/api/';
const NL = String.fromCharCode(10);
const SEP = String.fromCharCode(1);

/* Every category the project knows, plus the range around them, because the
   whole question is what the year endpoint calls the events that are not on
   the World Tour at all. */
const CATS = [2, 3, 4, 5, 6, 7, 8, 11, 17, 20, 21, 22, 23, 24, 25, 26, 27]
  .map(c => 'category[]=' + c).join('&');

sweepProfiles({ quiet: true });
const b = await launch({ port: 9472, tag: 'winners' });
await b.send('Page.navigate', { url: 'https://bwfworldtour.bwfbadminton.com/' }, b.sessionId);
await b.until('document.readyState === "complete"', { timeout: 40000 });
await b.wait(5000);

async function get(q) {
  await b.wait(360);
  const out = await b.ev('(async () => {'
    + '  const r = await fetch(' + JSON.stringify(API) + ' + ' + JSON.stringify(q) + ','
    + '    { headers: { accept: "application/json" } });'
    + '  return r.status + String.fromCharCode(1) + (await r.text()).slice(0, 600000);'
    + '})()');
  if (typeof out !== 'string') return { status: 0, json: null };
  const i = out.indexOf(SEP);
  try { return { status: Number(out.slice(0, i)), json: JSON.parse(out.slice(i + 1)) }; }
  catch { return { status: Number(out.slice(0, i)), json: null }; }
}

/* ---- 1. what a season holds, and what it calls it ---- */
const seasons = {};
for (const year of [2026, 2024, 2023, 2017]) {
  const r = await get(`vue-grouped-year-tournaments?year=${year}&${CATS}`);
  const months = (r.json && r.json.results) || [];
  const all = months.flatMap(m => m.tournaments || []);
  seasons[year] = all;
  console.log(`${NL}=== ${year}: ${all.length} tournaments (HTTP ${r.status}) ===`);
  const byCat = new Map();
  for (const t of all) {
    const k = t.category || '(none)';
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k).push(t);
  }
  for (const [cat, list] of [...byCat].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(list.length).padStart(2)}  ${cat}`);
    if (list.length <= 2) for (const t of list) console.log(`        ${t.name}`);
  }
}

/* Is the Olympics in there at all, and under what name? And the Asian Games? */
console.log(`${NL}=== the events that are not World Tour ===`);
for (const [year, all] of Object.entries(seasons)) {
  const odd = all.filter(t => /olymp|asian games|commonwealth|european games|pan am/i.test(t.name || ''));
  console.log(`  ${year}: ${odd.length ? odd.map(t => `${t.name} [${t.category}]`).join(' | ') : 'none found by name'}`);
}

/* ⚠️ Two gaps the summary above hides. The Asian Games did not turn up in 2023
   by name, and 2017 came back with no World Championships and no Superseries
   Finals at all — either of which would quietly cost a season its summit. */
console.log(`${NL}=== the continental bucket, named ===`);
for (const year of [2026, 2024, 2023]) {
  const list = (seasons[year] || []).filter(t => /Continental Individual/i.test(t.category || ''));
  console.log(`  ${year}:`);
  for (const t of list) console.log(`     ${t.start_date.slice(0, 10)}  ${t.name}`);
}

console.log(`${NL}=== what 2017 is missing, and where it hides ===`);
const r17 = await get('vue-grouped-year-tournaments?year=2017');
const all17 = ((r17.json && r17.json.results) || []).flatMap(m => m.tournaments || []);
console.log(`  with no category filter at all: ${all17.length} tournaments`);
const cats17 = new Map();
for (const t of all17) cats17.set(t.category || '(none)', (cats17.get(t.category || '(none)') || 0) + 1);
for (const [c, n] of [...cats17].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(3)}  ${c}`);
for (const t of all17.filter(t => /world championship|superseries finals|dubai/i.test(t.name || ''))) {
  console.log(`    -> ${t.name} [${t.category}] id=${t.id}`);
}

/* What fields does one entry actually carry? The pyramid needs an id to ask
   for a draw with, and a date to sort a season by. */
const sample = (seasons[2026] || [])[0];
console.log(`${NL}  one entry's keys: ${Object.keys(sample || {}).join(', ')}`);
console.log(`  sample: ${JSON.stringify(sample).slice(0, 400)}`);

/* ---- 2. does a draw name its winner ---- */
console.log(`${NL}=== reading a winner out of a draw ===`);
const worlds = (seasons[2026] || []).find(t => /world championships/i.test(t.name || ''))
  || (seasons[2026] || [])[0];
console.log(`  asking about: ${worlds && worlds.name} (id ${worlds && worlds.id})`);

const d = await get(`vue-tournament-draw-data?tmtId=${worlds.id}&tmtType=1&drawId=1&isPara=0`);
const res = d.json && d.json.results;
console.log(`  HTTP ${d.status}; results is ${Array.isArray(res) ? 'array[' + res.length + ']'
  : res && typeof res === 'object' ? '{' + Object.keys(res).join(', ') + '}' : JSON.stringify(res)}`);
const blob = JSON.stringify(d.json || {});
console.log(`  payload is ${(blob.length / 1024).toFixed(0)} KB`);
console.log(`  mentions "winner": ${/\"winner\"/.test(blob)}; "round": ${/\"round/.test(blob)}`);

/* Dig for the final: the match whose round says so. */
const finals = [];
(function walk(node, depth) {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) return node.forEach(n => walk(n, depth + 1));
  if (typeof node !== 'object') return;
  const rn = String(node.round_name || node.roundName || '');
  if (/^final$/i.test(rn)) finals.push(node);
  for (const v of Object.values(node)) walk(v, depth + 1);
})(d.json, 0);
console.log(`  matches whose round_name is "Final": ${finals.length}`);
if (finals[0]) {
  const f = finals[0];
  console.log('  keys: ' + Object.keys(f).join(', '));
  console.log('  ' + JSON.stringify(f).slice(0, 600));
}

b.close();
process.exit(0);
