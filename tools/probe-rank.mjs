/* Is a player's ranking *history* — week by week, year by year — reachable?
 *
 * The project knows a player's rank today (`vue-player-ranking-current`) and
 * their career high (`vue-player-ranking-highest`), and that is all: two
 * numbers, no series. A dominance-era graph needs the line between them.
 *
 * Three questions, in the order that spends the fewest requests:
 *
 *   1. What does BWF's own player page ask for? If it draws a ranking history
 *      anywhere, the endpoint is in its network log and nothing has to be
 *      guessed. This is the same read-only reconnaissance discover.mjs does.
 *   2. `vue-rankingweek` and `vue-rankingdata` are listed in Part 3.2 and have
 *      never been called. If they enumerate the weekly publications, then
 *      `publicationId` — which the app currently pins to 0 — is a time machine.
 *   3. Does `publicationId` actually move the table? A publication id that
 *      returns the same rows as today's would mean it is ignored, which is how
 *      `vue-tournament-categories` turned out to be a dead end.
 *
 *   node tools/probe-rank.mjs        every part
 *   node tools/probe-rank.mjs 37     only parts 3 and 7
 *
 * The walk this turned into is verified separately, in probe-rank-walk.mjs.
 */
import { launch, sweepProfiles } from '../tests/browser.mjs';

const API = 'https://extranet-lv.bwfbadminton.com/api/';
const LIN_DAN = 50906;          // the career this question is really about
const SHI_YU_QI = 57945;        // and one from the current era, for contrast

sweepProfiles({ quiet: true });
const b = await launch({ port: 9466, tag: 'rank' });

const seen = new Set();
b.on(m => {
  if (m.method !== 'Network.requestWillBeSent') return;
  const u = (m.params && m.params.request && m.params.request.url) || '';
  if (u.includes('/api/')) seen.add(u.replace(API, ''));
});
await b.send('Network.enable', {}, b.sessionId);

await b.send('Page.navigate', { url: 'https://bwfworldtour.bwfbadminton.com/' }, b.sessionId);
await b.until('document.readyState === "complete"', { timeout: 40000 });
await b.wait(5000);

const get = async path => {
  await b.wait(400);
  const out = await b.ev(`(async () => {
    const r = await fetch(${JSON.stringify(API)} + ${JSON.stringify(path)},
      { headers: { accept: 'application/json' } });
    return r.status + '\u0001' + (await r.text()).slice(0, 400000);
  })()`);
  if (typeof out !== 'string') return { status: 0, json: null, body: '' };
  const i = out.indexOf('\u0001');
  const body = out.slice(i + 1);
  let json = null;
  try { json = JSON.parse(body); } catch { /* html or empty */ }
  return { status: Number(out.slice(0, i)), json, body };
};

const NL = String.fromCharCode(10);

const shape = v => {
  if (Array.isArray(v)) return `array[${v.length}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).join(', ')}}`;
  return JSON.stringify(v);
};

const ONLY = process.argv.slice(2)[0] || '';
const want = n => !ONLY || ONLY.includes(String(n));

if (want(1)) {
/* ---- 1. what the site itself asks about a player ---- */
console.log('=== 1. BWF\'s own player page ===');
for (const id of [LIN_DAN, SHI_YU_QI]) {
  const s = await get(`vue-player-summary?playerId=${id}&isPara=0&drawCount=5`);
  const r = (s.json && s.json.results) || {};
  const slug = r.slug || '';
  console.log(`  ${id} -> ${r.name_display || '?'} slug=${slug || '(none)'}`);
  if (!slug) continue;
  seen.clear();
  const url = `https://bwfbadminton.com/player/${id}/${slug}/`;
  await b.send('Page.navigate', { url }, b.sessionId);
  await b.wait(11000);
  const title = await b.ev('document.title');
  console.log(`     ${url}\n     title: ${JSON.stringify(title || '')}`);
  for (const u of [...seen].sort()) console.log('       · ' + u);
}

await b.send('Page.navigate', { url: 'https://bwfworldtour.bwfbadminton.com/' }, b.sessionId);
await b.wait(4000);
}

if (want(2)) {
/* ---- 2. the two never-called ranking endpoints ---- */
console.log('\n=== 2. vue-rankingweek / vue-rankingdata ===');
for (const path of ['vue-rankingweek?rankId=2', 'vue-rankingdata?rankId=2',
                    'vue-rankingweek?rankId=2&catId=6', 'vue-home-ranking?drawCount=2']) {
  const r = await get(path);
  console.log(`\n  ${path} -> HTTP ${r.status}  ${shape(r.json)}`);
  const res = r.json && (r.json.results !== undefined ? r.json.results : r.json);
  const rows = Array.isArray(res) ? res : (res && Array.isArray(res.data)) ? res.data : null;
  if (rows) {
    console.log(`    ${rows.length} row(s); first, middle, last:`);
    for (const i of [0, Math.floor(rows.length / 2), rows.length - 1]) {
      if (rows[i] !== undefined) console.log('      ' + JSON.stringify(rows[i]).slice(0, 260));
    }
  } else {
    console.log('    ' + JSON.stringify(res).slice(0, 500));
  }
}

}

/* ---- 3. does publicationId time-travel, and how far ---- */
console.log('\n=== 3. publicationId ===');

const topOf = async (publicationId, catId = 6) => {
  const r = await get(`vue-rankingtable?rankId=2&catId=${catId}&page=1&drawCount=1`
    + `&searchKey=&publicationId=${publicationId}&doubles=false&pageKey=10`);
  const res = r.json && r.json.results;
  const rows = Array.isArray(res) ? res : (res && Array.isArray(res.data)) ? res.data : [];
  const name = row => String((row.player1_model || {}).name_display_bold || '')
    .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return { status: r.status, n: rows.length, top: rows.slice(0, 3).map(name) };
};

for (const id of [0, 4435, 4162, 3842]) {
  const t = await topOf(id);
  console.log(`  publicationId=${String(id).padEnd(5)} HTTP ${t.status} rows=${t.n}  ${t.top.join(' | ')}`);
}

console.log('\n  -- how far back does it go (MS top 1) --');
for (const id of [3500, 3000, 2500, 2000, 1500, 1000, 600, 300, 100, 30, 1]) {
  const t = await topOf(id);
  console.log(`  publicationId=${String(id).padEnd(5)} rows=${String(t.n).padEnd(3)} ${t.top[0] || '(nothing)'}`);
}

/* One player, one week: the cost of a whole career line. */
console.log('\n  -- one row by name, at an old publication --');
for (const id of [0, 4162, 3842]) {
  const r = await get(`vue-rankingtable?rankId=2&catId=6&page=1&drawCount=1`
    + `&searchKey=${encodeURIComponent('SHI Yu Qi')}&publicationId=${id}&doubles=false&pageKey=10`);
  const res = r.json && r.json.results;
  const rows = Array.isArray(res) ? res : (res && Array.isArray(res.data)) ? res.data : [];
  console.log(`  publicationId=${String(id).padEnd(5)} rows=${rows.length} ` +
    rows.slice(0, 2).map(x => `rank ${x.rank} (${x.points || x.total_points || '?'} pts)`).join(' | '));
}

/* ---- 4. can the archive be enumerated, and dated ---- */
console.log(NL + '=== 4. enumerating the archive ===');

/* `vue-rankingweek?rankId=2` returned the most recent 60 and stopped. If it
   takes a year, the whole archive is addressable; if not, publication ids have
   to be walked blind, which is a different and much worse proposition. */
for (const q of ['vue-rankingweek?rankId=2&year=2012',
                 'vue-rankingweek?rankId=2&catId=6&year=2012',
                 'vue-rankingweek?rankId=2&count=500',
                 'vue-rankingweek?rankId=2&page=2',
                 'vue-rankingweek?rankId=2&limit=500',
                 'vue-rankingweek']) {
  const r = await get(q);
  const rows = Array.isArray(r.json) ? r.json : [];
  const first = rows[0], last = rows[rows.length - 1];
  console.log(`  ${q.padEnd(42)} HTTP ${r.status} rows=${rows.length}` +
    (rows.length ? `  ${first.display} .. ${last.display}` : ''));
}

/* What is publication 600, the one with LEE Chong Wei on top? */
console.log(NL + '  -- naming an old publication --');
for (const q of ['vue-rankingdata?rankId=2&publicationId=600',
                 'vue-rankingdata?rankId=2&id=600',
                 'vue-rankingdata?publicationId=600']) {
  const r = await get(q);
  console.log(`  ${q.padEnd(46)} ${JSON.stringify(r.json).slice(0, 220)}`);
}

/* Does a table row date itself? If it does, an id needs no separate lookup. */
console.log(NL + '  -- what a row from 600 carries --');
const r600 = await get('vue-rankingtable?rankId=2&catId=6&page=1&drawCount=1'
  + '&searchKey=&publicationId=600&doubles=false&pageKey=10');
const res600 = r600.json && r600.json.results;
const rows600 = Array.isArray(res600) ? res600 : (res600 && res600.data) || [];
console.log('  top-level keys: ' + Object.keys(r600.json || {}).join(', '));
console.log('  row keys: ' + Object.keys(rows600[0] || {}).join(', '));
console.log('  row 1: ' + JSON.stringify(rows600[0] || {}).slice(0, 400));

/* Where does rankId=2 actually live in the id space? The gaps at 1000-3000
   are the question: other rankings, or holes. */
console.log(NL + '  -- sweeping the id space, MS top 1 --');
for (let id = 200; id <= 4400; id += 200) {
  const t = await topOf(id);
  console.log(`  ${String(id).padStart(4)}  rows=${String(t.n).padEnd(3)} ${t.top[0] || '-'}`);
}

/* ---- 5. how the id space is packed, and what BWF's own page knows ---- */
console.log(NL + '=== 5. the shape of the id space ===');

/* Multiples of 200 hit at 200/400/600 and missed everywhere above, which is
   either a wall or sparsity. A fine sweep tells the two apart: if world-ranking
   publications interleave with para, junior and race ones, the stride is what
   matters and there is no wall at all. */
for (const base of [590, 1000, 3000, 4420]) {
  const hits = [];
  for (let id = base; id < base + 14; id++) {
    const t = await topOf(id);
    if (t.n) hits.push(id + ':' + (t.top[0] || '?'));
  }
  console.log(`  ${base}..${base + 13}  ${hits.length} hit(s)  ${hits.join('  ') || '(none)'}`);
}

console.log(NL + '  -- other spellings of "give me an old week" --');
for (const q of ['vue-rankingweek?rankId=2&tmtYear=2012',
                 'vue-rankingweek?rankId=2&drawCount=1&year=2012',
                 'vue-rankingdata?rankId=2&year=2012',
                 'vue-rankingtable?rankId=2&catId=6&page=1&drawCount=1&searchKey=&year=2012&week=5&publicationId=0&doubles=false&pageKey=10']) {
  const r = await get(q);
  const j = r.json;
  const rows = Array.isArray(j) ? j : (j && j.results && (Array.isArray(j.results) ? j.results : j.results.data)) || [];
  const one = rows[0] ? JSON.stringify(rows[0]).slice(0, 150) : '(no rows)';
  console.log(`  HTTP ${r.status} n=${String(rows.length).padEnd(4)} ${q.slice(0, 70)}`);
  console.log(`      ${one}`);
}

console.log(NL + '  -- what BWFs own rankings page asks --');
seen.clear();
await b.send('Page.navigate',
  { url: 'https://bwfbadminton.com/rankings/' }, b.sessionId);
await b.wait(12000);
console.log('  title: ' + JSON.stringify(await b.ev('document.title') || ''));
for (const u of [...seen].sort()) console.log('    · ' + u.slice(0, 160));

const weeks = await b.ev(`(() => {
  const sels = [...document.querySelectorAll('select')];
  return JSON.stringify(sels.map(s => ({
    n: s.options.length,
    first: s.options[0] && s.options[0].textContent.trim(),
    last: s.options[s.options.length - 1] && s.options[s.options.length - 1].textContent.trim(),
  })));
})()`);
console.log('  selects on the page: ' + weeks);


/* ---- 6. is there any way to ask for a week by its date ---- */
console.log(NL + '=== 6. dating an id, or naming a date ===');

await b.send('Page.navigate', { url: 'https://bwfbadminton.com/rankings/' }, b.sessionId);
await b.wait(12000);
console.log('rankings landing: ' + JSON.stringify(await b.ev('document.title') || ''));
const links = await b.ev(`JSON.stringify([...document.querySelectorAll('a[href*="ranking"]')]
  .map(a => a.getAttribute('href')).filter((v, i, s) => s.indexOf(v) === i).slice(0, 25))`);
console.log('  ranking links: ' + links);
console.log('  api calls:');
for (const u of [...seen].sort()) console.log('    · ' + u.slice(0, 170));

/* The week picker: if it offers more than the 60 `vue-rankingweek` returns,
   there is a route into the archive that this project has not found. */
const sels = await b.ev(`(() => {
  const out = [...document.querySelectorAll('select')].map(s => ({
    name: s.name || s.id || s.className,
    n: s.options.length,
    first: (s.options[0] || {}).textContent,
    last: (s.options[s.options.length - 1] || {}).textContent,
  }));
  return JSON.stringify(out);
})()`);
console.log('  selects: ' + sels);



for (const q of [
  'vue-rankingdata?rankId=2&year=2012&week=5',
  'vue-rankingdata?rankId=2&publicationId=600&drawCount=1',
  'vue-rankingweek?rankId=2&startDate=2012-01-01&endDate=2012-12-31',
  'vue-rankingpublication?rankId=2&publicationId=600',
  'vue-ranking-publication?id=600',
  'vue-rankingdata?rankId=2&slug=bwf-world-rankings-2012-05',
]) {
  const r = await get(q);
  const j = r.json;
  const rows = Array.isArray(j) ? j : (j && j.results) || [];
  const one = Array.isArray(rows) && rows[0] ? JSON.stringify(rows[0]).slice(0, 200) : JSON.stringify(j).slice(0, 200);
  console.log(`  HTTP ${r.status}  ${q}`);
  console.log(`      ${one}`);
}


/* ---- 7. how regular are the publications, and where is the floor ---- */
console.log(NL + '=== 7. the shape of the archive ===');
const dated = (await get('vue-rankingweek?rankId=2')).json || [];
console.log(`  ${dated.length} dated publications`);
const day = s => String(s || '').slice(0, 10);
const byId = dated.slice().sort((a, b) => a.id - b.id);
let prev = null;
const gaps = new Map();
for (const w of byId) {
  if (prev) {
    const dd = (new Date(day(w.date)) - new Date(day(prev.date))) / 86400000;
    const di = w.id - prev.id;
    gaps.set(`${di} ids / ${dd} days`, (gaps.get(`${di} ids / ${dd} days`) || 0) + 1);
  }
  prev = w;
}
console.log('  ' + day(byId[0].date) + ' id ' + byId[0].id
  + '  ->  ' + day(byId[byId.length - 1].date) + ' id ' + byId[byId.length - 1].id);
console.log('  gaps between consecutive publications:');
for (const [k, n] of [...gaps].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(3)} x  ${k}`);

/* Does the career-high endpoint say *when*? One dated anchor per player would
   be worth a great deal. */
console.log(NL + '  -- vue-player-ranking-highest: does it say when? --');
for (const [id, ev] of [[50906, 6], [50152, 6], [57945, 6]]) {
  const r = await get(`vue-player-ranking-highest?playerId=${id}&isPara=0&rankingEvent=${ev}`);
  console.log(`  player ${id}: ${JSON.stringify(r.json).slice(0, 300)}`);
}

/* And how far down does the archive actually go? */
console.log(NL + '  -- the floor --');
for (const id of [1, 2, 3, 5, 10, 20, 40, 60, 80, 120, 160, 200, 260, 320, 400, 480, 560]) {
  const t = await topOf(id);
  console.log(`  ${String(id).padStart(4)}  rows=${String(t.n).padEnd(3)} ${t.top[0] || '-'}`);
}


b.close();
process.exit(0);
