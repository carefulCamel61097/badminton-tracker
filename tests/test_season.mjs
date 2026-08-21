/* End to end: the real page, in a real browser, fetching through the real
 * request layer, rendering a real season.
 *
 * The API is replayed from fixtures rather than hit live — see fixtures.mjs for
 * why — but nothing else is faked. The app has no test-only code path: what is
 * exercised here is exactly what ships.
 */
import { fileURLToPath } from 'node:url';

import { createServer } from '../serve.mjs';
import { launch, pageErrors } from './browser.mjs';
import { installFixtures, fixtureReport } from './fixtures.mjs';
import { check, eq, report } from './check.mjs';

const PORT = 8781, DBG = 9411;
const ROOT = fileURLToPath(new URL('..', import.meta.url));

const server = createServer(ROOT);
await new Promise(r => server.listen(PORT, r));

const b = await launch({ port: DBG, tag: 'season' });

/* FIXTURES=live (run.mjs --live) skips interception altogether and lets the app
   talk to BWF, which is the only way to catch the API changing under us. It is
   slow and its answers move, so it is not the default. */
const LIVE = process.env.FIXTURES === 'live';
const fx = LIVE ? null : await installFixtures(b.send, b.sessionId, { quiet: true });
if (fx) b.on(fx.handle);
if (LIVE) console.log('[live] fixtures bypassed — talking to BWF\n');

const finish = code => {
  console.log('\n' + (fx ? fixtureReport(fx) : 'live: no fixtures used'));
  b.close();
  server.close();
  process.exit(code);
};

/* A suite that dies mid-way must still take Chrome down with it: an orphaned
   browser holds the debugging port and a lock on its profile directory, and the
   next run then fails for a reason that has nothing to do with the code. */
const bail = e => { console.log('EXC ' + (e && e.message ? e.message : e)); finish(1); };
process.on('uncaughtException', bail);
process.on('unhandledRejection', bail);

/** Open a season and wait for the request queue to drain. */
async function open(hash) {
  await b.ev(`location.hash = ${JSON.stringify(hash)}`);
  const ok = await b.until('!!window.BST && window.BST.ready');
  if (!ok) console.log('LOG  timed out waiting for the season to load');
  // The partner lookup rides the low lane behind the season, so give the queue
  // one more drain before reading state that depends on it.
  await b.until('window.BST.ready && !!window.BST.state.lastMatch', { timeout: 8000 });
  return ok;
}

await b.send('Page.navigate', { url: `http://localhost:${PORT}/#p=57945&y=2026` }, b.sessionId);
await b.until('!!window.BST');

/* ============================ SHI Yu Qi, 2026 ============================ */

console.log('=== a singles season loads end to end ===');
const loaded = await open('#p=57945&y=2026');
check('the season loaded', loaded);

const season = await b.ev('window.BST.season()');
check('a season came back', Array.isArray(season), typeof season);
eq('ten tournaments', season.length, 10);
eq('oldest first — a season reads left to right', season[0].start, '2026-01-06');
eq('newest last', season[season.length - 1].start, '2026-08-17');
eq('and the level survived the round trip', season[0].level, 'Super 1000');

const disc = await b.ev('window.BST.state.discipline');
eq('opened on the discipline he plays', disc, 'MS');

const text = await b.ev('window.BST.text()');
check('the page rendered the season', /Malaysia Open/.test(text), text.slice(0, 120));
check('every individual tournament reached the page',
  season.filter(t => !t.team).every(t => text.includes(t.short)),
  season.filter(t => !t.team && !text.includes(t.short)).map(t => t.short).join(', '));
check('the title is shown as a title', /Asia Champs.*\bW\b/.test(text));
check('the Continental box is full size, per the settled weighting',
  /Asia Champs\s+Continental\s+42\.0px/.test(text),
  (text.match(/.*Asia Champs.*/) || [''])[0].slice(0, 90));
check('a Super 500 box is smaller than a Super 1000 one',
  /Thailand Open\s+Super 500\s+37\.6px/.test(text),
  (text.match(/.*Thailand Open.*/) || [''])[0].slice(0, 90));

/* ============================ the team-event toggle ============================ */

console.log('\n=== team events default off ===');
const teamRow = await b.ev('window.BST.season().find(t => t.team)');
check('the season holds the team events, so the toggle can exist',
  !!teamRow, teamRow && teamRow.name);
check('a team tie carries no individual position',
  teamRow && teamRow.draws.every(d => d.position === 'N/A'),
  JSON.stringify(teamRow && teamRow.draws));
check('and it is hidden by default — maximum prominence, zero information',
  !text.includes('Thomas & Uber'));

const servedBefore = fx ? fx.stats.served : 0;
const withTeam = await b.ev(`(() => {
  const box = document.getElementById('includeTeam');
  box.checked = true;
  box.dispatchEvent(new Event('change'));
  return window.BST.text();
})()`);
check('the toggle brings them back', withTeam.includes('Thomas & Uber'));
eq('without costing another request', fx ? fx.stats.served : 0, servedBefore);

await b.ev(`(() => {
  const box = document.getElementById('includeTeam');
  box.checked = false;
  box.dispatchEvent(new Event('change'));
})()`);

/* ============================ a doubles season ============================ */

console.log('\n=== a doubles season is a partnership ===');
await open('#p=70762&y=2026');

const dDisc = await b.ev('window.BST.state.discipline');
eq('opened on XD, not on the last player\'s discipline', dDisc, 'XD');

const last = await b.ev('window.BST.state.lastMatch');
check('the partner was resolved from the last match', !!(last && last.partner), JSON.stringify(last));
eq('and it is the right one', last && last.partner && last.partner.name, 'Thom GICQUEL');
eq('for the right discipline', last && last.discipline, 'XD');

const dText = await b.ev('window.BST.text()');
check('the season renders for the doubles discipline',
  /XD/.test(dText), dText.slice(0, 140));
check('with real results, not a column of blanks',
  (dText.match(/\bXD\b/g) || []).length >= 8,
  String((dText.match(/\bXD\b/g) || []).length));

const status = await b.ev('document.getElementById("status").textContent');
check('and the partner is named on the page', /GICQUEL/.test(status), status);

/* ============================ credit ============================ */

console.log('\n=== attribution ===');
const page = await b.ev('document.body.innerText');
check('says plainly that it is unofficial', /unofficial/i.test(page));
check('credits BWF', /BWF/.test(page));
check('links back to bwfbadminton.com',
  await b.ev(`!!document.querySelector('a[href*="bwfbadminton.com"]')`));
check('carries no BWF logo',
  await b.ev(`![...document.images].some(i => /bwf/i.test(i.src) && /logo/i.test(i.src))`));

/* ============================ hygiene ============================ */

console.log('\n=== hygiene ===');
const { exceptions, errors } = pageErrors(b.events);
check('no uncaught exceptions', exceptions.length === 0, exceptions.slice(0, 2).join(' | '));
// A fixture miss falls through to the live API, which is a slow pass rather
// than a wrong answer — but it means the recorded set has a hole.
check('no fixture misses', !fx || fx.stats.missed === 0, fx ? [...fx.stats.misses].slice(0, 3).join(', ') : 'live');
check('console clean of errors', errors.length === 0, errors.slice(0, 2).join(' | '));

finish(report());
