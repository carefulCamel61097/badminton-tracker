/* The season strip, end to end: the real page in a real browser, fetching
 * through the real request layer, and measured off the geometry the browser
 * actually laid out rather than off the numbers the app meant to use.
 *
 * That distinction is the point of this suite. HANDOVER Part 2 settles the
 * weighting in pixels — a 42px full square, a 52px slot, a 9px label floor —
 * and a strip can satisfy every unit test while a stylesheet quietly overrides
 * the width. So the checks here read getBoundingClientRect().
 *
 * The API is replayed from fixtures; nothing else is faked, and the app has no
 * test-only code path.
 */
import { fileURLToPath } from 'node:url';

import { createServer } from '../serve.mjs';
import { launch, pageErrors } from './browser.mjs';
import { installFixtures, fixtureReport } from './fixtures.mjs';
import { check, eq, near, report } from './check.mjs';

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

async function open(hash) {
  await b.ev(`location.hash = ${JSON.stringify(hash)}`);
  const ok = await b.until('!!window.BST && window.BST.ready');
  if (!ok) console.log('LOG  timed out loading ' + hash);
  return ok;
}

const squares = () => b.ev('window.BST.squares()');
const find = (list, re) => list.find(s => re.test(s.name));

await b.send('Page.navigate', { url: `http://localhost:${PORT}/#p=57945&y=2026` }, b.sessionId);
await b.until('!!window.BST');

/* ============================ the strip renders ============================ */

console.log('=== SHI Yu Qi, 2026 ===');
check('the season loaded', await open('#p=57945&y=2026'));

let sq = await squares();
eq('nine squares — the tenth is a team event, hidden by default', sq.length, 9);
eq('one square per tournament shown', sq.length, (await b.ev('window.BST.visible()')).length);

const season = await b.ev('window.BST.season()');
check('drawn oldest first, left to right',
  sq.map(s => s.name).join('|') === season.filter(t => !t.team).map(t => t.short).join('|'),
  sq.map(s => s.name).join(' '));

console.log('\n=== the strip says whose season it is ===');
const heading = await b.ev('document.getElementById("stripWho").textContent');
check('the player is named, not left as an id', /SHI Yu Qi/.test(heading), heading);
check('with their country', /CHN/.test(heading), heading);
check('and the year and discipline', /2026 · singles/.test(heading), heading);

/* ============================ geometry ============================ */

console.log('\n=== the box is sized by weight, the slot is not ===');
check('every slot is 52px wide, whatever the tournament weighed',
  sq.every(s => s.slot === 52), [...new Set(sq.map(s => s.slot))].join(', '));

const malaysia = find(sq, /Malaysia/);      // Super 1000
const asia = find(sq, /Asia Champs/);       // Continental
const thailand = find(sq, /Thailand/);      // Super 500
const worlds = find(sq, /World Champs/);    // Worlds

eq('a Super 1000 box is the full 52 wide', malaysia.w, 52);
eq('and the full 42 tall', malaysia.h, 42);
eq('Continental is full size too — settled 21 Aug 2026, and here it is in pixels',
  `${asia.w}x${asia.h}`, '52x42');
near('a Super 500 box is sqrt(0.80) of that', thailand.h, 37.6, 0.2);
near('and narrows by the same factor', thailand.w, 46.5, 0.2);
check('so a Super 500 is visibly smaller than a Super 1000',
  malaysia.h - thailand.h >= 4, `${malaysia.h} vs ${thailand.h}`);
check('but still occupies an equal share of the strip',
  thailand.slot === malaysia.slot, `${thailand.slot} vs ${malaysia.slot}`);

check('no label is ever smaller than 9px',
  sq.every(s => s.font >= 9), sq.map(s => s.font).join(' '));
check('a full-size box labels at 11px', malaysia.font === 11, String(malaysia.font));

console.log('\n=== the level fits under the square ===');
check('nothing under a square is truncated',
  await b.ev(`[...document.querySelectorAll('#strip .lv')]
    .every(e => e.scrollWidth <= e.clientWidth + 1)`),
  await b.ev(`[...document.querySelectorAll('#strip .lv')]
    .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.textContent).join(', ')`));
eq('Continental is abbreviated to fit', asia.level, 'Cont.');
check('but the filter chip, which has room, spells it out',
  await b.ev(`document.querySelector('#levels .chip[data-cat="11"]').textContent.includes('Continental')`));

/* ============================ the gauge ============================ */

console.log('\n=== the gauge fills by how far he got ===');
eq('a title fills the square', asia.pct, '100%');
eq('and reads as a title', asia.label, 'W');
eq('runner-up is four fifths', malaysia.pct, '80%');
eq('a semi-final, three of five', thailand.pct, '60%');
eq('a first-round exit keeps a visible sliver', worlds.pct, '13%');
eq('and says which round it was', worlds.label, 'R64');

console.log('\n=== the colour ramp, with the label saying the same thing ===');
eq('a title is the green end', asia.tier, 'w');
eq('a semi-final sits below it', thailand.tier, 'sf');
eq('a first-round exit is the red end', worlds.tier, 'r1');
check('every square carries a text label as well as a colour',
  sq.every(s => s.label.length > 0), sq.map(s => s.label || '∅').join(' '));

console.log('\n=== each square links back to BWF ===');
check('every square is a link', sq.every(s => /^https?:/.test(s.href)),
  sq.filter(s => !/^https?:/.test(s.href)).map(s => s.name).join(', '));
check('to bwfbadminton.com', sq.every(s => s.href.includes('bwfbadminton.com')));

/* ============================ the size toggle ============================ */

console.log('\n=== size is a toggle, on by default ===');
check('it starts on', await b.ev('document.getElementById("sized").checked') === true);
await b.ev(`(() => {
  const t = document.getElementById('sized');
  t.checked = false; t.dispatchEvent(new Event('change'));
})()`);
const flat = await squares();
check('turned off, every box is full size', flat.every(s => s.w === 52 && s.h === 42),
  [...new Set(flat.map(s => `${s.w}x${s.h}`))].join(', '));
check('and the slots did not move', flat.every(s => s.slot === 52));
check('the results are unchanged — only the sizing went',
  flat.map(s => s.label).join('') === sq.map(s => s.label).join(''));
await b.ev(`(() => {
  const t = document.getElementById('sized');
  t.checked = true; t.dispatchEvent(new Event('change'));
})()`);

/* ============================ level filters ============================ */

console.log('\n=== level filters ===');
const chips = await b.ev(`[...document.querySelectorAll('#levels .chip')].map(c => ({
  cat: c.dataset.cat, text: c.textContent.trim().replace(/\\s+/g, ' '),
  on: c.getAttribute('aria-pressed') === 'true',
  dashed: getComputedStyle(c).borderStyle === 'dashed',
}))`);
eq('one chip per level in the season', chips.length, 6);
check('the team-event chip is dashed — it is a different sort of thing',
  chips.find(c => c.cat === '21').dashed);
check('and it is the only one that starts off',
  chips.filter(c => !c.on).map(c => c.cat).join() === '21',
  chips.map(c => `${c.cat}:${c.on}`).join(' '));

const servedBefore = fx ? fx.stats.served : 0;
await b.ev(`document.querySelector('#levels .chip[data-cat="23"]').click()`);
const noS1000 = await squares();
eq('turning off Super 1000 drops its four tournaments', noS1000.length, 5);
check('and none of them is a Super 1000',
  !noS1000.some(s => s.level === 'Super 1000'), noS1000.map(s => s.level).join(', '));
eq('the count says how many of how many',
  (await b.ev('document.getElementById("stripCount").textContent')).trim(),
  '5 of 10 tournaments');
eq('filtering costs no requests', fx ? fx.stats.served : 0, servedBefore);
await b.ev(`document.querySelector('#levels .chip[data-cat="23"]').click()`);

console.log('\n=== team events ===');
await b.ev(`document.querySelector('#levels .chip[data-cat="21"]').click()`);
const withTeam = await squares();
eq('switching them on adds the team tie', withTeam.length, 10);
const team = find(withTeam, /Thomas/);
eq('which has no individual position to show', team.pct, '0%');
eq('and says so rather than looking like a first-round exit', team.tier, 'na');
eq('with a placeholder label, not a blank', team.label, '-');
await b.ev(`document.querySelector('#levels .chip[data-cat="21"]').click()`);

/* ============================ singles and doubles ============================ */

console.log('\n=== a player who plays both ===');
check('loaded', await open('#p=72885&y=2026'));

const kinds = await b.ev(`[...document.querySelectorAll('#kindWrap .seg')].map(s => ({
  kind: s.dataset.kind, on: s.getAttribute('aria-pressed') === 'true',
  text: s.textContent.trim().replace(/\\s+/g, ' '),
}))`);
eq('two disciplines, so a toggle appears', kinds.length, 2);
eq('singles first', kinds[0].kind, 'singles');
eq('eleven of each — an exact tie', kinds.map(k => k.text).join(' | '), 'singles 11 | doubles 11');
check('and a tie opens on singles', kinds[0].on, JSON.stringify(kinds));

const asSingles = await squares();
const beforeToggle = fx ? fx.stats.served : 0;
await b.ev(`document.querySelector('#kindWrap [data-kind="doubles"]').click()`);
const asDoubles = await squares();
eq('the toggle costs no request — both draws were already loaded',
  fx ? fx.stats.served : 0, beforeToggle);
check('and the strip changes',
  asSingles.map(s => s.label).join('') !== asDoubles.map(s => s.label).join(''),
  `${asSingles.map(s => s.label).join(' ')}  ->  ${asDoubles.map(s => s.label).join(' ')}`);
check('same tournaments, different results — a doubles season is not filtered by partner',
  asSingles.map(s => s.name).join('|') === asDoubles.map(s => s.name).join('|'),
  asDoubles.map(s => s.name).join(' '));

console.log('\n=== a player with one discipline gets no dead toggle ===');
check('loaded', await open('#p=57945&y=2026'));
eq('no segmented control at all',
  await b.ev(`document.querySelectorAll('#kindWrap .seg').length`), 0);

/* ============================ the year ============================ */

console.log('\n=== stepping through the years ===');
check('2018 loads', await open('#p=57945&y=2018'));
eq('eighteen tournaments that season',
  (await b.ev('window.BST.season()')).length, 18);
await b.ev(`document.getElementById('yearPrev').click()`);
await b.until('!!window.BST && window.BST.ready');
eq('the arrow steps back a year', await b.ev(`document.getElementById('year').value`), '2017');

console.log('\n=== a year with nothing in it says why ===');
check('2005 loads without error', await open('#p=57945&y=2005'));
eq('no squares', (await squares()).length, 0);
const why = await b.ev(`document.getElementById('empty').textContent`);
check('the empty state names the year', /2005/.test(why), why);
check('and does not leave you guessing whether it is a bug',
  /may not reach back|did not compete/i.test(why), why);
check('no error was raised — an empty year is not a failure',
  await b.ev('window.BST.state.error') === null);

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
check('no fixture misses', !fx || fx.stats.missed === 0,
  fx ? [...fx.stats.misses].slice(0, 3).join(', ') : 'live');
check('console clean of errors', errors.length === 0, errors.slice(0, 2).join(' | '));

finish(report());
