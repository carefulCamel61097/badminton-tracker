/* What are the pre-2018 tournament categories actually called?
 *
 * `vue-player-tournaments` ships `tournament_category_id` and no name, so the
 * old ids — 2, 3, 4, 8 — are numbers with no meaning attached. Part 3.2 lists
 * `vue-tournament-categories` and nobody had called it. If it names them, the
 * Superseries-era mapping is BWF's own rather than this project's guess.
 *
 * Also finds the two players the mapping exists for.
 *
 *   node tools/probe-cats.mjs
 */
import { launch, sweepProfiles } from '../tests/browser.mjs';

const API = 'https://extranet-lv.bwfbadminton.com/api/';

sweepProfiles({ quiet: true });
const b = await launch({ port: 9465, tag: 'cats' });
await b.send('Page.navigate', { url: 'https://bwfworldtour.bwfbadminton.com/' }, b.sessionId);
await b.until('document.readyState === "complete"', { timeout: 40000 });
await b.wait(6000);

const get = async path => {
  await b.wait(400);
  const out = await b.ev(`(async () => {
    const r = await fetch(${JSON.stringify(API)} + ${JSON.stringify(path)},
      { headers: { accept: 'application/json' } });
    return r.status + '\\u0001' + (await r.text()).slice(0, 200000);
  })()`);
  if (typeof out !== 'string') return { status: 0, json: null };
  const i = out.indexOf('');
  let json = null;
  try { json = JSON.parse(out.slice(i + 1)); } catch { /* html */ }
  return { status: Number(out.slice(0, i)), json, body: out.slice(i + 1) };
};

for (const [label, range] of [
  ['2016 (Superseries era)', 'startDate=2016-01-01&endDate=2016-12-31'],
  ['2026 (World Tour era)', 'startDate=2026-01-01&endDate=2026-12-31'],
]) {
  const r = await get('vue-tournament-categories?' + range);
  console.log(`\n=== vue-tournament-categories ${label} — HTTP ${r.status} ===`);
  const rows = Array.isArray(r.json) ? r.json
    : (r.json && (r.json.results || r.json.data)) || [];
  if (!Array.isArray(rows) || !rows.length) {
    console.log('  not a list:', JSON.stringify(r.json).slice(0, 400));
    continue;
  }
  for (const c of rows) {
    console.log('  ' + JSON.stringify(c).slice(0, 200));
  }
}

/* The two careers this whole question is about.
   ⚠️ `activeTab=1&page=1`, the same as the app sends. Without them the response
   comes back in a different shape and every search reads as zero rows. */
console.log('\n=== who are they ===');
for (const q of ['lin dan', 'dan lin', 'lee chong wei', 'chong wei']) {
  const r = await get('vue-popular-players?searchKey=' + encodeURIComponent(q)
    + '&activeTab=1&page=1');
  const res = r.json && r.json.results;
  const list = Array.isArray(res) ? res
    : (res && Array.isArray(res.data)) ? res.data
    : (r.json && r.json.pagination && r.json.pagination.data) || [];
  console.log(`  "${q}" -> ${list.length} row(s)`);
  for (const p of list.slice(0, 4)) {
    console.log('     ', p.id, '|', p.name_display || p.name, '|',
      (p.country_model || {}).name || '');
  }
}

b.close();
process.exit(0);
