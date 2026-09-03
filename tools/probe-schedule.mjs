/* What does `vue-tmt-schedule` hand back when two tournaments are on at once?
 *
 * `pickTournament` takes the *first* of nextLive / nextTmt / previousTmt whose
 * dates contain today, which is an order BWF chose and not a ranking. In a week
 * with two events running together that shows whichever BWF happened to put
 * first — and the question is whether the payload carries enough to choose the
 * bigger one instead.
 *
 *   node tools/probe-schedule.mjs
 */
import { launch, sweepProfiles } from '../tests/browser.mjs';

const API = 'https://extranet-lv.bwfbadminton.com/api/';
const SEP = String.fromCharCode(1);      // built, not typed — see probe-rank-hole

sweepProfiles({ quiet: true });
const b = await launch({ port: 9479, tag: 'sched' });
await b.send('Page.navigate', { url: 'https://bwfworldtour.bwfbadminton.com/' }, b.sessionId);
await b.until('document.readyState === "complete"', { timeout: 40000 });
await b.wait(4000);

const get = async path => {
  for (let attempt = 0; attempt < 3; attempt++) {
    const j = await getOnce(path);
    if (j && Object.keys(j).length) return j;
  }
  return null;
};

const getOnce = async path => {
  await b.wait(400);
  const out = await b.ev(`(async () => {
    const r = await fetch(${JSON.stringify(API)} + ${JSON.stringify(path)},
      { headers: { accept: 'application/json' } });
    return r.status + ${JSON.stringify(SEP)} + (await r.text()).slice(0, 400000);
  })()`);
  if (typeof out !== 'string') return null;
  try { return JSON.parse(out.slice(out.indexOf(SEP) + 1)); } catch { return null; }
};

const today = new Date().toISOString().slice(0, 10);
console.log('today is ' + today);

const s = await get('vue-tmt-schedule');
console.log('\ntop-level keys: ' + Object.keys(s || {}).join(', '));

for (const slot of ['nextLive', 'nextTmt', 'previousTmt']) {
  const t = s && s[slot];
  console.log(`\n--- ${slot} ---`);
  if (!t) { console.log('  (absent)'); continue; }
  console.log('  keys: ' + Object.keys(t).join(', '));
  console.log(`  name:  ${t.name}`);
  console.log(`  dates: ${String(t.start_date).slice(0, 10)} .. ${String(t.end_date).slice(0, 10)}`);
  console.log(`  category_id: ${t.tournament_category_id}   prize: ${t.prize_money}`);
  console.log(`  live scores: ${t.has_live_scores}   status: ${t.tournament_status}`);
}

console.log('');
console.log('=== the logos, which are the only other field in the payload ===');
for (const slot of ['nextLive', 'nextTmt', 'previousTmt']) {
  const t = s && s[slot];
  if (!t) continue;
  console.log(`  ${slot}:`);
  console.log(`    catLogo: ${t.catLogo}`);
  console.log(`    tmtLogo: ${String(t.tmtLogo).slice(0, 110)}`);
  console.log(`    label:   ${t.label}`);
  console.log(`    tmtLink: ${t.tmtLink}`);
}

console.log('');
console.log('=== what the calendar says about them ===');
const year = today.slice(0, 4);
const cal = await get(`vue-grouped-year-tournaments?year=${year}`);
console.log('  calendar top-level: ' + Object.keys(cal || {}).join(', '));
const res = (cal && cal.results) || [];
console.log('  results is ' + (Array.isArray(res) ? `an array of ${res.length} months` : typeof res));
const flat = (Array.isArray(res) ? res : []).flatMap(m => m.tournaments || []);
console.log(`  ${flat.length} rows`);
if (flat.length) console.log('  one row: ' + JSON.stringify(flat[0]).slice(0, 700));
for (const t of flat) {
  if (!/China Masters|Indonesia Masters/i.test(String(t.name || ''))) continue;
  console.log(`  MATCH  ${t.name}`);
  console.log('         ' + JSON.stringify(t).slice(0, 500));
}

console.log('');
console.log('=== and what tournaments/draws says, which the app already calls ===');
for (const slot of ['nextLive', 'nextTmt']) {
  const t = s && s[slot];
  if (!t) continue;
  const d = await get(`tournaments/draws?tournament_code=${t.code}&drawCount=1`);
  const keys = Object.keys(d || {});
  console.log(`  ${t.name}`);
  console.log(`    keys: ${keys.join(', ').slice(0, 200)}`);
  const tm = (d && (d.tournament || d.tournament_model)) || null;
  if (tm) console.log('    tournament: ' + JSON.stringify({
    cat: tm.tournament_category_id, prize: tm.prize_money, name: tm.name }));
}

b.close();
process.exit(0);
