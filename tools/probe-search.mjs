/* Why is the search box slow, and sometimes silent?
 *
 * Three things are being blamed and only measurement separates them:
 *
 *   1. BWF's endpoint itself — how long does one `vue-popular-players` take,
 *      and how big is the answer?
 *   2. The rotation — a name typed surname-first costs *three* sequential
 *      calls, each behind the 320ms pacing gap.
 *   3. The queue — search rides the **low** lane, so it sits behind every
 *      draw ladder the career on screen is still fetching. This is the one that
 *      cannot be seen from a stopwatch on an idle page, and is the one a user
 *      actually hits: you land on a player, then type.
 *
 *   node tools/probe-search.mjs
 *
 * Live, on purpose: the fixtures cannot say what BWF's latency is.
 */
import { launch, sweepProfiles } from '../tests/browser.mjs';
import { createServer } from '../serve.mjs';
import { fileURLToPath } from 'node:url';

const PORT = 8795, DBG = 9475;
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const QUERIES = [
  ['axelsen', 'a surname, one word, matches directly'],
  ['viktor', 'a given name'],
  ['an se young', 'surname first — needs the rotation'],
  ['shi yu qi', 'the same, and a very common first syllable'],
  ['lee', 'three letters, thousands of matches'],
  ['momota', 'a retired player, still in the database'],
  ['zzzzz', 'nothing at all'],
];

const server = createServer(ROOT);
await new Promise(r => server.listen(PORT, r));
sweepProfiles({ quiet: true });
const b = await launch({ port: DBG, tag: 'search', windowSize: '1400,1000' });

/* The app itself, so this measures the real api.js — its queue, its pacing and
   its cache — rather than a bare fetch that has none of them. */
await b.send('Page.navigate', { url: `http://localhost:${PORT}/#pg=tmt` }, b.sessionId);
await b.until('!!window.BST && window.BST.ready', { timeout: 300000 });

const time = async q => JSON.parse(await b.ev(`(async () => {
  const t = performance.now();
  const depth0 = window.BST.queueDepth ? window.BST.queueDepth() : -1;
  const rows = await window.BST.search(${JSON.stringify(q)});
  return JSON.stringify({
    ms: Math.round(performance.now() - t),
    n: rows.length,
    first: rows.length ? rows[0].name : '',
    depth0,
  });
})()`));

console.log('=== one search, idle queue, cold cache ===');
console.log('query           ms     hits  first result           what it is');
for (const [q, why] of QUERIES) {
  const r = await time(q);
  console.log(`${q.padEnd(15)}${String(r.ms).padStart(5)}  ${String(r.n).padStart(5)}`
    + `  ${(r.first || '-').padEnd(22)} ${why}`);
}

console.log('\n=== the same searches again, warm cache ===');
for (const [q] of QUERIES) {
  const r = await time(q);
  console.log(`${q.padEnd(15)}${String(r.ms).padStart(5)}  ${String(r.n).padStart(5)}`);
}

/* ---- where in the answer is the player you meant? ---- */

console.log('');
console.log('=== ordering: BWF alone, against the local roster ===');
await b.ev(`void window.BST.roster.load()`);
await b.until(`window.BST.roster.state.asked && !window.BST.roster.state.loading`,
  { timeout: 120000 });
console.log('  roster holds ' + await b.ev('window.BST.roster.state.players.length') + ' players');
console.log('');
console.log('  query      BWF alone (index of the obvious answer)   local, instantly');
for (const [q, want] of [['axelsen', 'AXELSEN'], ['viktor', 'Viktor AXELSEN'],
  ['chen', 'CHEN'], ['an se young', 'AN Se Young'], ['momota', 'MOMOTA']]) {
  const r = JSON.parse(await b.ev(`(async () => {
    const t0 = performance.now();
    const local = window.BST.roster.local(${JSON.stringify(q)});
    const localMs = Math.round((performance.now() - t0) * 1000) / 1000;
    const remote = await window.BST.search(${JSON.stringify(q)});
    return JSON.stringify({
      localMs, local: local.slice(0, 2).map(x => x.name),
      at: remote.findIndex(x => x.name.includes(${JSON.stringify(want)})),
      n: remote.length,
    });
  })()`));
  console.log(`  ${q.padEnd(12)} ${(r.at < 0 ? 'NOT IN THE FIRST ' + r.n : 'index ' + r.at).padEnd(28)}`
    + ` ${r.localMs}ms  ${r.local.join(' | ') || '(none)'}`);
}

console.log('');
console.log('=== typing while a career is loading ===');
await b.send('Page.navigate', { url: `http://localhost:${PORT}/#p=50152` }, b.sessionId);
await b.until('!!window.BST', { timeout: 120000 });
await b.wait(1200);

const during = JSON.parse(await b.ev(`(async () => {
  const depth = window.BST.queueDepth();
  const t = performance.now();
  const rows = await window.BST.search('ginting');
  return JSON.stringify({ depth, ms: Math.round(performance.now() - t), n: rows.length });
})()`));
console.log(`  queue depth when the key was pressed: ${during.depth}`);
console.log(`  one uncached search took:             ${during.ms} ms`);
console.log(`  (it was 10516 ms on the low lane)`);

b.close();
server.close();
process.exit(0);
