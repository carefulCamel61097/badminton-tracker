/* What endpoints does BWF's own frontend call?
 *
 *   node tools/discover.mjs                      the default page set
 *   node tools/discover.mjs https://…/draws/     specific pages
 *
 * Two public sources: the live network traffic a page generates, and the string
 * literals in the site's published JS bundles, which name endpoints the current
 * page happens not to hit. This is how the calendar and scheduling endpoints in
 * HANDOVER Part 3.2 were found.
 *
 * Headful Chrome throughout — Cloudflare 403s headless. The literal extraction
 * runs inside the page so multi-MB bundles never cross the CDP wire.
 *
 * This is read-only reconnaissance of a public site: it visits pages a browser
 * would visit anyway, one at a time, and fetches the scripts those pages
 * already loaded. It does not log in, guess at URLs, or probe anything.
 */
import { launch, sweepProfiles } from '../tests/browser.mjs';

const DBG = 9401;

/* The calendar, home and rankings pages were covered when Part 3.2 was written.
   The tournament pages were not, and are the likely home of the draw and
   live-score endpoints the project still has not found: a results page for a
   finished event, and one for whatever is running now. */
const DEFAULT_PAGES = [
  'https://bwfworldchampionships.bwfbadminton.com/results/5601/bwf-world-championships-2026',
  'https://bwfworldtour.bwfbadminton.com/tournament/5227/petronas-malaysia-open-2026/',
  'https://bwfbadminton.com/calendar/',
];

const pages = process.argv.slice(2).filter(a => /^https?:/.test(a));
const PAGES = pages.length ? pages : DEFAULT_PAGES;

sweepProfiles({ quiet: true });
const b = await launch({ port: DBG, tag: 'discover', windowSize: '1280,900' });

const netUrls = new Set();
const scripts = new Set();

b.on(m => {
  if (m.method !== 'Network.requestWillBeSent') return;
  const u = (m.params && m.params.request && m.params.request.url) || '';
  if (u.includes('/api/') || u.includes('extranet')) netUrls.add(u);
  if (/\.js($|\?)/.test(u) && !/gtm|analytics|googletag|facebook|hotjar/i.test(u)) {
    scripts.add(u.split('?')[0]);
  }
});

await b.send('Network.enable', {}, b.sessionId);

for (const url of PAGES) {
  process.stdout.write('visiting ' + url + ' … ');
  await b.send('Page.navigate', { url }, b.sessionId);
  await b.wait(12000);
  const title = await b.ev('document.title');
  console.log(JSON.stringify(title || ''));
}

console.log(`\n=== live API requests (${netUrls.size}) ===`);
const seen = [...netUrls].sort();
for (const u of seen) console.log('  ' + u.replace(/^https?:\/\//, ''));

console.log(`\n=== endpoint shapes ===`);
const shapes = new Set(seen.map(u => u.replace(/^https?:\/\/[^/]+\/api\//, '').split('?')[0]));
for (const s of [...shapes].sort()) console.log('  ' + s);

console.log(`\n=== scanning ${scripts.size} JS bundles for endpoint literals ===`);

/* Runs in the page, not here: some of these bundles are several megabytes and
   there is no reason to move them over the debugging socket. */
async function scan(urls) {
  const out = {};
  for (const u of urls) {
    try {
      const t = await (await fetch(u)).text();
      const hits = t.match(/["'`][a-z0-9][a-z0-9\-_\/]{4,70}["'`]/gi) || [];
      for (let h of hits) {
        h = h.slice(1, -1);
        if (!/[-\/]/.test(h)) continue;
        if (/\.(js|css|png|jpg|jpeg|svg|woff2?|gif|webp|mp4|ico|json)$/i.test(h)) continue;
        if (/^(https?|data|blob|_|--)/.test(h)) continue;
        if (h.startsWith('//')) continue;
        out[h] = (out[h] || 0) + 1;
      }
    } catch (e) { out['FETCH_FAIL ' + u] = 1; }
  }
  return JSON.stringify(out);
}

const expr = `(${scan.toString()})(${JSON.stringify([...scripts])})`;
const raw = await b.ev(expr);
let lits = {};
try { lits = JSON.parse(raw || '{}'); }
catch (e) { console.log('scan failed:', e.message, String(raw).slice(0, 300)); }

const KEY = /calendar|schedule|tournament|event|player|ranking|match|result|draw|live|country|team|h2h|stat/i;

/* The bundles are Vuetify, so a bare keyword match returns a hundred CSS class
   names — v-calendar-weekly__head, select2-result-label — and buries the four
   literals worth reading. An endpoint has a path separator or the site's own
   `vue-` prefix; a class name has neither. */
const looksLikeEndpoint = k =>
  (k.includes('/') || /^(vue-|api)/.test(k))
  && !/^v-|^ui-|^select2-|^[a-z]+-(state|events?)$/.test(k);

const cands = Object.keys(lits)
  .filter(k => KEY.test(k) && k.length < 60 && looksLikeEndpoint(k))
  .sort();
console.log(`(${Object.keys(lits).length} literals total, ${cands.length} endpoint-ish)\n`);

// Anything already in HANDOVER Part 3 is known; the point of this run is what
// is not.
const KNOWN = /vue-tmt-schedule|vue-grouped-year-tournaments|vue-tmt-live-scores|vue-current-live|vue-tournament-categories|vue-tournament-series|vue-countries|vue-rankingdata|vue-rankingweek|vue-home-ranking|vue-player-|vue-rankingtable|vue-tournament-draw-data|day-matches|h2h\/statistics/;
for (const k of cands) console.log((KNOWN.test(k) ? '     ' : '  NEW') + '  ' + k);

b.close();
