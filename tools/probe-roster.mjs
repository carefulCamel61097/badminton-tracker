/* Is there a cheap way to get a pool of the players people actually search for?
 *
 * The search endpoint returns page 1 of an *alphabetical* list, so "viktor"
 * puts Viktor AXELSEN at index 13 and "chen" does not contain CHEN Yu Fei at
 * all. A local roster of the top-ranked players, matched before the network is
 * even asked, fixes that — but only if it can be had without a dozen requests.
 *
 * `vue-rankingtable` is hard-locked at 15 rows a page (Part 3.2), so top-30
 * across five disciplines is ten calls. This asks whether anything gives more
 * in one:
 *
 *   1. `vue-popular-players` with no searchKey — the endpoint is *called*
 *      popular players, and the app only ever uses it as a search.
 *   2. Its other tabs.
 *   3. Whether `vue-rankingtable` page 2 really is the next fifteen.
 *
 *   node tools/probe-roster.mjs
 */
import { launch, sweepProfiles } from '../tests/browser.mjs';

const API = 'https://extranet-lv.bwfbadminton.com/api/';
const SEP = String.fromCharCode(1);      // built, not typed — see probe-rank-hole

sweepProfiles({ quiet: true });
const b = await launch({ port: 9477, tag: 'roster' });
await b.send('Page.navigate', { url: 'https://bwfworldtour.bwfbadminton.com/' }, b.sessionId);
await b.until('document.readyState === "complete"', { timeout: 40000 });
await b.wait(4000);

const get = async path => {
  await b.wait(400);
  const out = await b.ev(`(async () => {
    const r = await fetch(${JSON.stringify(API)} + ${JSON.stringify(path)},
      { headers: { accept: 'application/json' } });
    const t = await r.text();
    return r.status + ${JSON.stringify(SEP)} + t.length + ${JSON.stringify(SEP)} + t.slice(0, 300000);
  })()`);
  if (typeof out !== 'string') return { status: 0, bytes: 0, json: null };
  const a = out.indexOf(SEP);
  const c = out.indexOf(SEP, a + 1);
  let json = null;
  try { json = JSON.parse(out.slice(c + 1)); } catch { /* html or empty */ }
  return { status: Number(out.slice(0, a)), bytes: Number(out.slice(a + 1, c)), json };
};

const rowsOf = json => {
  const r = json && json.results;
  if (Array.isArray(r)) return r;
  if (r && Array.isArray(r.data)) return r.data;
  if (json && json.pagination && Array.isArray(json.pagination.data)) return json.pagination.data;
  return [];
};

const nameOf = p => [p.name_display, p.name_first, p.name_last, p.name]
  .filter(Boolean).join(' ').trim() || ('#' + p.id);

console.log('=== 1. vue-popular-players with no search key ===');
for (const tab of [0, 1, 2, 3]) {
  const r = await get(`vue-popular-players?searchKey=&activeTab=${tab}&page=1`);
  const rows = rowsOf(r.json);
  console.log(`  activeTab=${tab}  http ${r.status}  ${String(r.bytes).padStart(7)} bytes`
    + `  ${String(rows.length).padStart(3)} rows`
    + (rows.length ? `  e.g. ${rows.slice(0, 4).map(nameOf).join(', ')}` : ''));
}

console.log('');
console.log('=== 2. does it page? ===');
for (const page of [1, 2, 3]) {
  const r = await get(`vue-popular-players?searchKey=&activeTab=0&page=${page}`);
  const rows = rowsOf(r.json);
  console.log(`  page ${page}  ${String(rows.length).padStart(3)} rows`
    + `  first: ${rows.length ? nameOf(rows[0]) : '-'}`);
}

console.log('');
console.log('=== 3. vue-rankingtable: what does pageKey actually do? ===');
console.log('  pageKey  rows  ranks         bytes');
for (const pageKey of [10, 15, 20, 30, 50, 100]) {
  const r = await get(`vue-rankingtable?rankId=2&catId=6&page=1&drawCount=1`
    + `&searchKey=&publicationId=0&doubles=false&pageKey=${pageKey}`);
  const rows = rowsOf(r.json);
  const ranks = rows.length ? `${rows[0].rank}..${rows[rows.length - 1].rank}` : '-';
  console.log(`  ${String(pageKey).padStart(7)}  ${String(rows.length).padStart(4)}`
    + `  ${ranks.padEnd(12)}  ${String(r.bytes).padStart(7)}`);
}

console.log('');
console.log('=== 4. and does page still work on top of it? ===');
for (const page of [1, 2]) {
  const r = await get(`vue-rankingtable?rankId=2&catId=6&page=${page}&drawCount=1`
    + `&searchKey=&publicationId=0&doubles=false&pageKey=50`);
  const rows = rowsOf(r.json);
  console.log(`  page ${page} at pageKey=50: ${rows.length} rows, ranks `
    + (rows.length ? `${rows[0].rank}..${rows[rows.length - 1].rank}` : '-'));
}

console.log('');
console.log('=== 5. what a roster built from it would actually hold ===');
for (const [catId, code, doubles] of [[6, 'MS', false], [7, 'WS', false], [10, 'XD', true]]) {
  const r = await get(`vue-rankingtable?rankId=2&catId=${catId}&page=1&drawCount=1`
    + `&searchKey=&publicationId=0&doubles=${doubles}&pageKey=50`);
  const rows = rowsOf(r.json);
  const plain = m => String((m && (m.name_display || m.name_display_bold)) || '')
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  const people = [];
  for (const row of rows) {
    for (const m of [row.player1_model, row.player2_model]) {
      if (m && m.id != null && plain(m)) people.push(`${row.rank}. ${plain(m)}`);
    }
  }
  console.log(`  ${code}: ${rows.length} rows -> ${people.length} players, `
    + `${String(r.bytes)} bytes`);
  console.log(`     ${people.slice(0, 6).join(' | ')}`);
  console.log(`     country on row 1: ${JSON.stringify((rows[0] || {}).p1_country_model || null).slice(0, 120)}`);
}

b.close();
process.exit(0);
