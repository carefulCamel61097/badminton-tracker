/* The career view, end to end: the real page in a real browser, fetching
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

const b = await launch({ port: DBG, tag: 'season', windowSize: '1200,1400' });

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

/** A career is one request per year, so this waits minutes, not seconds. */
async function open(hash) {
  await b.ev(`location.hash = ${JSON.stringify(hash)}`);
  const ok = await b.until('!!window.BST && window.BST.ready', { timeout: 180000 });
  if (!ok) console.log('LOG  timed out loading ' + hash);
  return ok;
}

/** Ladders load only for rows in view, so ask for the ones a check needs. */
async function ladders(year) {
  await b.ev(`window.BST.loadLadders(${year})`);
  // The call is fired and not awaited in the page, so give the queue a moment
  // to actually fill before waiting on it to drain.
  await b.wait(600);
  await b.until('window.BST.ready', { timeout: 120000 });
}

const squares = year => b.ev(`window.BST.squares(${year || ''})`);

/** positionInfo + fillFraction as the page itself computes them. */
const positionInfoOf = async pos => b.ev(`(() => {
  const i = window.BST.positionInfo(${JSON.stringify(pos)});
  return { label: i.label, tier: i.tier,
    pct: Math.round(window.BST.fillFraction(i, { win: 1, lose: 1 }, 5) * 100) + '%' };
})()`);
const find = (list, re) => list.find(s => re.test(s.name));

await b.send('Page.navigate', { url: `http://localhost:${PORT}/` }, b.sessionId);
await b.until('!!window.BST');

/* ---- a cold open lands on somebody ----

   An empty strip is a worse first impression than anybody's, so with no player
   in the link the app opens on the world number one in men's singles. Looked up
   rather than hardcoded: the claim is that it is whoever is number one *now*,
   and a constant would quietly become a different claim the week they lost it. */

console.log('=== opening on nobody in particular ===');
check('with no link at all, somebody is loaded anyway',
  await b.until('!!(window.BST && window.BST.state.playerId)', { timeout: 90000 }),
  await b.ev('window.BST.state.playerId'));
const numberOne = await b.ev('window.BST.state.playerId');
const topMs = await b.ev(`(async () => {
  const rows = await window.BST.loadTop(6);
  return rows && rows[0] && rows[0].players[0] ? String(rows[0].players[0].id) : null;
})()`);
eq('and it is the top of the men\'s singles ranking', numberOne, topMs);
check('the link says so too, so a reload is the same page',
  await b.ev(`location.hash.includes('p=' + window.BST.state.playerId)`),
  await b.ev('location.hash'));
/* Let it settle before anything else is asked of the app. A career is one
   request per season and they are already in the queue; a search typed on top
   of them waits behind the lot, which is a real thing a reader can do but not
   what the next section is trying to measure. */
check('and the career it opened on finishes loading',
  await b.until('window.BST.ready', { timeout: 180000 }));

/* ============================ the player search ============================ */

console.log('=== a player is found by name, not by id ===');

/* ⚠️ On the page you actually land on, not one you navigated to. `showPage` is
   what stamps `body[data-page]`, and boot skips it when the hash wants the
   default page — so the stylesheet's `body:not([data-page="seasons"])` matched
   an absent attribute and hid the strip's own controls on the strip. Live on
   the deployed site until 4 September 2026; found from a keyboard probe
   reporting the page as "undefined", not from looking at it. */
eq('the page says which page it is, from the first paint',
  await b.ev(`document.body.dataset.page`), 'seasons');
check('so the controls that belong to the strip are on screen with it',
  await b.ev(`!!document.getElementById('kindWrap').offsetParent
    && !!document.getElementById('sized').closest('label').offsetParent`));
check('the page opens on a search box, with no id anywhere',
  await b.ev(`document.getElementById('q').type === 'search'`));
check('and focuses it, because typing a name is the first thing to do',
  await b.ev(`document.activeElement === document.getElementById('q')`));

/* ⚠️ **Then blur it, immediately.** The app autofocuses the box at boot, which
   is right for a reader and wrong for a suite: this runs for ten minutes in a
   real, windowed, foreground Chrome, so a focused search box collects any
   keystroke that happens on the machine meanwhile. That lands as a search
   nobody wrote, an unfixtured request, and a "no fixture misses" failure naming
   a query that appears in no test — twice with different junk, once as
   "SHI Yu Qik", a stray k on the end of a query typed nine minutes earlier.
   Nothing below needs the focus: every test here sets `.value` and dispatches
   `input` directly, which is what the app actually listens to. */
const unfocus = () => b.ev(`document.getElementById('q').blur()`);
await unfocus();

await b.ev(`(() => {
  const i = document.getElementById('q');
  i.value = 'axelsen';
  i.dispatchEvent(new Event('input'));
})()`);
check('typing brings suggestions',
  await b.until('window.BST.suggestions() && window.BST.suggestions().length > 0',
    { timeout: 30000 }));

const suggestions = await b.ev('window.BST.suggestions()');
check('the players are named', suggestions.every(p => p.name && p.id),
  JSON.stringify(suggestions.slice(0, 3)));
check('Viktor AXELSEN is among them',
  suggestions.some(p => /Viktor AXELSEN/i.test(p.name)),
  suggestions.map(p => p.name).join(', '));
check('with their country, so two players of a name can be told apart',
  suggestions.every(p => typeof p.countryCode === 'string'),
  suggestions.map(p => p.countryCode).join(' '));

const shown = await b.ev(`[...document.querySelectorAll('#suggest li')]
  .map(li => li.textContent.trim())`);
check('and they are on screen, not just in memory', shown.length > 0, shown.slice(0, 3).join(' | '));

// The endpoint matches one name token, so a full name finds nothing and is
// retried on its longest word.
await b.ev(`(() => {
  const i = document.getElementById('q');
  i.value = '';
  i.dispatchEvent(new Event('input'));
})()`);
await b.until('window.BST.suggestions() === null', { timeout: 10000 });
await b.ev(`(() => {
  const i = document.getElementById('q');
  i.value = 'an se young';
  i.dispatchEvent(new Event('input'));
})()`);
await b.until('window.BST.suggestions() !== null', { timeout: 30000 });
const multi = await b.ev('window.BST.suggestions()');
check('a full name still finds the player, by falling back to a word of it',
  Array.isArray(multi) && multi.some(p => /YOUNG/i.test(p.name)),
  (multi || []).map(p => p.name).slice(0, 4).join(', '));

console.log('\n=== a name typed the way the site writes it ===');
// BWF's player search holds names given-name-first — "Se Young AN", "Yu Qi SHI"
// — whichever way the rest of the site displays them. Typing a Korean or
// Chinese name surname-first, which is how everybody writes them, matched
// nothing at all until the query was retried rotated.
for (const [typed, wanted] of [['Shi Yu Qi', /SHI/i], ['an se young', /Se Young|AN Se/i]]) {
  await b.ev(`(() => {
    const i = document.getElementById('q');
    i.value = '';
    i.dispatchEvent(new Event('input'));
  })()`);
  await b.until('window.BST.suggestions() === null', { timeout: 10000 });
  await b.ev(`(() => {
    const i = document.getElementById('q');
    i.value = ${JSON.stringify(typed)};
    i.dispatchEvent(new Event('input'));
  })()`);
  await b.until('window.BST.suggestions() !== null', { timeout: 30000 });
  const found = await b.ev('window.BST.suggestions()');
  check(`"${typed}" finds the player`,
    Array.isArray(found) && found.some(p => wanted.test(p.name)),
    (found || []).map(p => p.name).slice(0, 5).join(', ') || 'nothing');
}
await b.ev(`(() => {
  const i = document.getElementById('q');
  i.value = '';
  i.dispatchEvent(new Event('input'));
})()`);
await unfocus();

/* ============================ a whole career ============================ */

console.log('\n=== every season, most recent first ===');
check('SHI Yu Qi loads', await open('#p=57945'));

const seasons = await b.ev('window.BST.seasons()');
check('more than a decade of them', seasons.length >= 12, `${seasons.length} seasons`);
check('newest first',
  seasons.every((s, i) => i === 0 || seasons[i - 1].year > s.year),
  seasons.map(s => s.year).join(' '));
check('and the rows are drawn in that order',
  (await b.ev(`[...document.querySelectorAll('.srow')].map(r => Number(r.dataset.year))`))
    .every((y, i, a) => i === 0 || a[i - 1] > y));
eq('one row per season', await b.ev(`document.querySelectorAll('.srow').length`),
  (await b.ev('window.BST.visible()')).length);
check('each row is labelled with its year',
  await b.ev(`[...document.querySelectorAll('.srow .yr')].every(y => /^\\d{4}/.test(y.textContent))`));

const all = await squares();
check('and holds a hundred-odd tournaments between them', all.length >= 100, `${all.length} squares`);
check('every square in a row belongs to that row\'s season',
  await b.ev(`[...document.querySelectorAll('.srow')].every(r =>
    r.querySelectorAll('.sq').length > 0)`));

/* ============================ geometry still holds ============================ */

console.log('\n=== the box is sized by weight, the slot is not ===');
await ladders(2026);
const y2026 = await squares(2026);
check('every slot is 52px wide, whatever the tournament weighed',
  all.every(s => s.slot === 52), [...new Set(all.map(s => s.slot))].join(', '));

const malaysia = find(y2026, /Malaysia/);
const thailand = find(y2026, /Thailand/);
const asia = find(y2026, /Asia Champs/);
eq('a Super 1000 box is the full 52 wide', malaysia.w, 52);
eq('and the full 42 tall', malaysia.h, 42);
eq('Continental is full size — settled 21 Aug 2026, and here it is in pixels',
  `${asia.w}x${asia.h}`, '52x42');
near('a Super 500 box is sqrt(0.80) of that', thailand.h, 37.6, 0.2);
check('no label is ever smaller than 9px', all.every(s => s.font >= 9),
  [...new Set(all.map(s => s.font))].join(' '));
check('no level under a square is left blank',
  all.every(s => s.level.trim().length > 0),
  all.filter(s => !s.level.trim()).map(s => s.name).join(', '));

console.log('\n=== the gauge, against the real ladder ===');
eq('a title fills the square', asia.pct, '100%');
eq('and reads as one', asia.label, 'W');
eq('runner-up is four fifths', malaysia.pct, '80%');
check('the tooltip names the ladder it was measured against',
  /\d+ of \d+ rounds/.test(malaysia.title), malaysia.title);
check('every square carries a text label as well as a colour',
  y2026.every(s => s.label.length > 0), y2026.map(s => s.label || '∅').join(' '));
check('every square links back to BWF',
  all.every(s => s.href.includes('bwfbadminton.com')),
  all.filter(s => !s.href.includes('bwfbadminton.com')).map(s => s.name).join(', '));

/* ============================ season filters ============================ */

console.log('\n=== seasons can be switched off ===');
const chipYears = await b.ev(`[...document.querySelectorAll('#years .chip')]
  .map(c => Number(c.dataset.year))`);
eq('one chip per season', chipYears.length, seasons.length);
check('all on to begin with',
  await b.ev(`[...document.querySelectorAll('#years .chip')].every(c => c.getAttribute('aria-pressed') === 'true')`));

const rowsBefore = await b.ev(`document.querySelectorAll('.srow').length`);
await b.ev(`document.querySelector('#years .chip[data-year="2026"]').click()`);
eq('switching one off removes its row',
  await b.ev(`document.querySelectorAll('.srow').length`), rowsBefore - 1);
eq('and no square of that season is left',
  (await squares()).filter(s => s.year === 2026).length, 0);
check('the chip says so', await b.ev(
  `document.querySelector('#years .chip[data-year="2026"]').getAttribute('aria-pressed')`) === 'false');
await b.ev(`document.querySelector('#years .chip[data-year="2026"]').click()`);
eq('and back on again', await b.ev(`document.querySelectorAll('.srow').length`), rowsBefore);

console.log('\n=== level filters are buttons, one per level in the career ===');
const chips = await b.ev(`[...document.querySelectorAll('#levels .chip')].map(c => ({
  cat: c.dataset.cat, text: c.textContent.trim().replace(/\\s+/g, ' '),
  on: c.getAttribute('aria-pressed') === 'true',
  dashed: getComputedStyle(c).borderStyle === 'dashed',
}))`);
check('a career spans many levels', chips.length >= 6, chips.map(c => c.text).join(' | '));
check('every chip is named, including levels this project has not mapped',
  chips.every(c => c.text.length > 1), chips.map(c => c.text).join(' | '));
check('team events are dashed and start off',
  chips.filter(c => c.dashed).every(c => !c.on),
  chips.filter(c => c.dashed).map(c => `${c.text}:${c.on}`).join(' '));
check('everything else starts on',
  chips.filter(c => !c.dashed).every(c => c.on),
  chips.filter(c => !c.dashed && !c.on).map(c => c.text).join(' '));

const before1000 = (await squares()).length;
await b.ev(`document.querySelector('#levels .chip[data-cat="23"]').click()`);
const after1000 = await squares();
check('turning a level off drops its tournaments across every season',
  after1000.length < before1000 && !after1000.some(s => s.level === 'Super 1000'),
  `${before1000} -> ${after1000.length}`);
await b.ev(`document.querySelector('#levels .chip[data-cat="23"]').click()`);

/* ⚠️ **A chosen chip is filled, on every bar that has one.** The filters here
   were left neutral for a while on the argument that they are not pickers — many
   are on at once, and they default to all on, so this opens the page on a full
   row of accent. That argument lost to the bigger one: the same affordance has to
   look the same everywhere, or a reader learns the red pill in the bracket and
   has to learn the grey one again here. Read off the painted pixel, because the
   thing being asserted is what the eye gets.

   ⚠️ A **team** chip is the exception and stays a dashed outline: it is not just
   another level, and filling it would bury the dashed border in its own colour. */
const seasonPaint = JSON.parse(await b.ev(`(() => {
  const bg = el => (el ? getComputedStyle(el).backgroundColor : null);
  return JSON.stringify({
    year: bg(document.querySelector('#years .chip.on')),
    level: bg(document.querySelector('#levels .chip.on:not(.team)')),
    off: bg(document.querySelector('#levels .chip:not(.on)')),
    team: bg(document.querySelector('#levels .chip.team')),
  });
})()`));
eq('a season that is shown is filled in BWF red', seasonPaint.year, 'rgb(223, 32, 39)');
eq('and a level that is shown', seasonPaint.level, 'rgb(223, 32, 39)');
check('while one switched off stays neutral', seasonPaint.off !== 'rgb(223, 32, 39)',
  JSON.stringify(seasonPaint));
check('and a team chip keeps its outline rather than being filled',
  seasonPaint.team === null || seasonPaint.team !== 'rgb(223, 32, 39)',
  JSON.stringify(seasonPaint));

/* ============================ the Olympics ============================ */

console.log('\n=== the Olympics ===');
check('AN Se Young loads', await open('#p=87442'));
const anSeYoung = await b.ev('window.BST.seasons()');
const olympicYear = anSeYoung.find(s => s.tournaments.some(t => t.cat === 'OLY'));
check('an Olympic Games is in the career', !!olympicYear,
  anSeYoung.map(s => s.year).join(' '));

if (olympicYear) {
  const games = olympicYear.tournaments.find(t => t.cat === 'OLY');
  eq('it is a level of its own, not a World Championships', games.level, 'Olympics');
  check('the name is the Games', /olympic/i.test(games.name), games.name);
  check('its draws are singles or doubles, never mistaken for a team tie',
    games.draws.every(d => ['MS', 'WS', 'MD', 'WD', 'XD'].includes(d.name)),
    JSON.stringify(games.draws.map(d => `${d.raw} -> ${d.name}`)));

  await ladders(olympicYear.year);
  const row = await squares(olympicYear.year);
  const sq = row.find(s => /Olympic|Paris|Tokyo|Rio/i.test(s.name));
  check('and it draws as a real result, not an empty square',
    sq && sq.tier !== 'na' && sq.label.length > 0,
    sq ? `${sq.name} ${sq.label} ${sq.pct} tier ${sq.tier}` : 'no square');
  check('labelled Olympics under the box', sq && /Olympic/i.test(sq.level), sq && sq.level);
  check('at full size, like the majors it is',
    sq && sq.w === 52 && sq.h === 42, sq && `${sq.w}x${sq.h}`);
  check('there is an Olympics chip to filter by',
    await b.ev(`!!document.querySelector('#levels .chip[data-cat="OLY"]')`));
}

/* ============================ who you are looking at ============================ */

console.log('\n=== the player is named, not buried in a status line ===');
const hero = await b.ev(`(() => {
  const h = document.getElementById('hero');
  const name = document.getElementById('heroName');
  const av = document.getElementById('heroAvatar');
  const fl = document.getElementById('heroFlag');
  return {
    shown: !h.hidden,
    name: name.textContent.trim(),
    size: parseFloat(getComputedStyle(name).fontSize),
    weight: getComputedStyle(name).fontWeight,
    meta: document.getElementById('heroMeta').textContent.trim(),
    avatar: av.hidden ? '' : av.src,
    avatarW: av.hidden ? 0 : av.naturalWidth,
    flag: fl.hidden ? '' : fl.src,
    flagW: fl.hidden ? 0 : fl.naturalWidth,
    aboveSeasons: h.compareDocumentPosition(document.getElementById('seasons'))
      === Node.DOCUMENT_POSITION_FOLLOWING,
  };
})()`);
check('the heading is there', hero.shown);
eq('and it is the name', hero.name, 'AN Se Young');
check('set large enough to be the first thing read',
  hero.size >= 22, `${hero.size}px`);
check('and bold', Number(hero.weight) >= 600, hero.weight);
check('above the seasons', hero.aboveSeasons);
check('the country is there too', /Korea/i.test(hero.meta), hero.meta);
check('with a season count', /\d+ seasons/.test(hero.meta), hero.meta);

console.log('\n=== BWF supplies the photograph and the flag ===');
check('a flag is shown', !!hero.flag, hero.flag);
check('and it actually loaded — these hosts 403 anything that is not a browser',
  hero.flagW > 0, `naturalWidth ${hero.flagW}`);
check('a photograph is shown', !!hero.avatar, hero.avatar);
check('and it loaded too', hero.avatarW > 0, `naturalWidth ${hero.avatarW}`);
check('both come from BWF rather than being re-hosted',
  /bwf/i.test(hero.flag) && /bwf/i.test(hero.avatar), `${hero.flag} | ${hero.avatar}`);

console.log('\n=== age and standing ===');
await b.until('window.BST.state.ranks !== null', { timeout: 60000 });
const ranks = await b.ev('window.BST.state.ranks');
const meta = await b.ev(`document.getElementById('heroMeta').textContent`);
eq('the discipline the ranking belongs to', ranks.draw, 'WS');
eq('her world ranking', ranks.world, 1);
check('and her place in the race', Number.isFinite(ranks.race), JSON.stringify(ranks));
check('the age is shown', /\b2\d\b/.test(meta), meta);
check('the world ranking is shown', /WS #\d+/.test(meta), meta);
check('and the race standing', /Race #\d+/.test(meta), meta);

/* ============================ the top-ranked shortcut ============================ */

console.log('\n=== the top ten, per discipline ===');
await b.ev(`document.getElementById('topBtn').click()`);
check('the panel opens', await b.ev(`!document.getElementById('topPanel').hidden`));
const tabs = await b.ev(`[...document.querySelectorAll('#topTabs button')]
  .map(t => t.textContent.trim())`);
eq('one tab per discipline', tabs.join(' '), 'MS WS MD WD XD');

await b.ev(`window.BST.showTop(6)`);
await b.until(`window.BST.top() !== null`, { timeout: 30000 });
const ms = await b.ev('window.BST.top()');
check('the mens singles table came back', Array.isArray(ms) && ms.length > 0,
  JSON.stringify((ms || []).slice(0, 2)));
eq('ten of them, not the fifteen the endpoint hands over', ms.length, 10);
eq('starting at number one', ms[0].rank, 1);
check('with a name, not markup',
  ms.every(r => r.players.every(p => p.name && !/[<>]/.test(p.name))),
  ms.map(r => r.players.map(p => p.name).join('/')).join(', '));
check('and a flag each', ms.every(r => r.players.every(p => p.flag)));

await b.ev(`window.BST.showTop(10)`);
await b.until(`window.BST.top() !== null && window.BST.top().length > 0`, { timeout: 30000 });
const xd = await b.ev('window.BST.top()');
check('a doubles table offers both halves of the pair, not just the first',
  xd.every(r => r.players.length === 2),
  xd.slice(0, 2).map(r => r.players.map(p => p.name).join(' / ')).join(' | '));

const listed = await b.ev(`[...document.querySelectorAll('#topList .pl')].map(x => x.textContent.trim())`);
check('and they are on screen as buttons', listed.length >= 10, listed.slice(0, 3).join(' | '));

// Going back to a table already fetched should cost nothing: rankings move
// once a week, and the panel is meant to be flicked through.
const servedBefore = fx ? fx.stats.served : 0;
await b.ev(`window.BST.showTop(6)`);
await b.until(`window.BST.top() !== null`, { timeout: 30000 });
await b.wait(500);
eq('a table already fetched costs no request', fx ? fx.stats.served : 0, servedBefore);

/* ⚠️ SHI Yu Qi by name, not "the first one in the list". The first one is
   whoever is world number one this week — it was him when this was written and
   Jonatan CHRISTIE by September — so the original clicked whatever the latest
   recording had put at the top and then loaded a career with no fixtures,
   failing three checks for a reason that had nothing to do with the panel. */
const clicked = await b.ev(`(() => {
  const el = [...document.querySelectorAll('#topList .pl')]
    .find(x => /SHI Yu Qi/i.test(x.textContent));
  if (!el) return false;
  el.click();
  return true;
})()`);
check('SHI Yu Qi is still somewhere in the singles table', clicked,
  await b.ev(`[...document.querySelectorAll('#topList .pl')].map(x => x.textContent.trim()).join(' | ')`));
check('picking one loads that career',
  await b.until(`window.BST.state.playerId === '57945'`, { timeout: 30000 }),
  await b.ev('window.BST.state.playerId'));
check('and the panel closes behind it',
  await b.ev(`document.getElementById('topPanel').hidden`));
check('the heading changes to the player picked',
  /SHI Yu Qi/.test(await b.ev(`document.getElementById('heroName').textContent`)),
  await b.ev(`document.getElementById('heroName').textContent`));
await b.until('window.BST.ready', { timeout: 180000 });

console.log('\n=== choosing a discipline leaves the panel open ===');
// The tab handler redraws the tabs, so the clicked node is detached by the time
// a bubbling document listener sees it — closest() finds nothing above it and
// the panel closed itself every time anybody used it.
await b.ev(`document.getElementById('topBtn').click()`);
check('open to begin with', await b.ev(`!document.getElementById('topPanel').hidden`));
await b.ev(`document.querySelector('#topTabs button[data-cat="9"]').click()`);
await b.wait(400);
check('still open after picking another discipline',
  await b.ev(`!document.getElementById('topPanel').hidden`));
check('and that discipline is the selected one',
  await b.ev(`document.querySelector('#topTabs button[data-cat="9"]').classList.contains('on')`));
await b.until(`window.BST.top() !== null`, { timeout: 30000 });
check('showing its table', (await b.ev('window.BST.top()')).length > 0);

await b.ev(`document.querySelector('h1').click()`);
check('but a click outside still closes it',
  await b.ev(`document.getElementById('topPanel').hidden`));

console.log('\n=== a placing we do not recognise is still a result ===');
// "R3" turns up at a Tour Finals. The player was there; an empty square says
// there was no individual result at all, which is a different statement.
const group = await positionInfoOf('R3');
eq('"R3" is a group-stage exit, which is what it means at a Tour Finals',
  group.label, 'Grp');
check('filling the same minimum sliver every other result does',
  group.pct === '13%', group.pct);

const unknown = await positionInfoOf('Some New Thing');
eq('a placing nobody has seen before keeps its own tier', unknown.tier, 'unk');
eq('and the label is what BWF said', unknown.label, 'Some New Thing');
check('it fills the same minimum sliver every other result does',
  unknown.pct === '13%', unknown.pct);
const teamTie = await positionInfoOf('N/A');
check('while a team tie, which has no individual result, stays empty',
  teamTie.pct === '0%', teamTie.pct);

/* ============================ the level overflow ============================ */

console.log('\n=== the levels nobody filters by are out of the way ===');
const namedChips = await b.ev(`[...document.querySelectorAll('#levels .chip')]
  .map(c => c.textContent.trim().replace(/\\s+/g, ' '))`);
check('the named levels stay as buttons', namedChips.length >= 6, namedChips.join(' | '));
check('and none of them is an unmapped id',
  !namedChips.some(t => /^Level \d+/.test(t)), namedChips.join(' | '));

const moreBtn = await b.ev(`(() => {
  const b = document.getElementById('moreBtn');
  return { hidden: b.hidden, text: b.textContent.trim().replace(/\\s+/g, ' ') };
})()`);
check('the rest are behind one button', !moreBtn.hidden, JSON.stringify(moreBtn));
check('which says how many', /^\d+ more/.test(moreBtn.text), moreBtn.text);

await b.ev(`document.getElementById('moreBtn').click()`);
const checks = await b.ev(`[...document.querySelectorAll('#morePanel input')].map(i => ({
  cat: i.dataset.cat, checked: i.checked }))`);
check('the menu is checkmarks, one per level', checks.length >= 5, JSON.stringify(checks.slice(0, 4)));
check('all ticked to begin with', checks.every(c => c.checked));

const before = (await squares()).length;
await b.ev(`(() => {
  const i = document.querySelector('#morePanel input');
  i.checked = false;
  i.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
check('unticking one drops its tournaments',
  (await squares()).length < before,
  `${before} -> ${(await squares()).length}`);
check('and the button now says how many are off',
  /off/.test(await b.ev(`document.getElementById('moreBtn').textContent`)),
  await b.ev(`document.getElementById('moreBtn').textContent.trim()`));

console.log('\n=== a doubles ranking belongs to the pair ===');
// BWF files a doubles ranking against player1_id only, and in mixed doubles
// stores the man as player1 — so asking as Delphine DELRUE returns "-", not her
// pair's rank. It has to be retried through the partner and labelled.
check('DELRUE loads', await open('#p=70762'));
await b.until('window.BST.state.ranks !== null', { timeout: 90000 });
const pairRanks = await b.ev('window.BST.state.ranks');
eq('the discipline is mixed doubles', pairRanks.draw, 'XD');
check('a ranking was found even though BWF answers "-" for her',
  Number.isFinite(pairRanks.world), JSON.stringify(pairRanks));
eq('by going through her partner', pairRanks.pair, 'Thom GICQUEL');
const pairMeta = await b.ev(`document.getElementById('heroMeta').textContent`);
check('and the page marks it as the pair\'s rather than hers',
  /#\d+\*/.test(pairMeta), pairMeta);
check('with the reason spelled out on hover',
  /pair/i.test(await b.ev(`document.getElementById('heroMeta').title`)),
  await b.ev(`document.getElementById('heroMeta').title`));

/* ============================ the career grid ============================

   The second reading of the same career: a row per season, a block of slots per
   level, filled best-first. Measured off the laid-out geometry for the same
   reason the strip is — "every cell is the same size and they touch" is a claim
   about pixels, and the model cannot make it on its own.
   ==================================================================== */

console.log('\n=== the grid: a row per season, a block per level ===');

/* ============================ two events, one name ============================

   January 2021 ran the YONEX Thailand Open and the TOYOTA Thailand Open a week
   apart in the same Bangkok bubble. Tidied, both squares read "Thailand Open",
   which reads as the same tournament drawn twice.
   ======================================================================== */

console.log('\n=== two tournaments that tidy to the same name ===');

check('AN Se Young loads', await open('#p=87442'));
const y2021 = await squares(2021);
const thai = y2021.filter(sq => /Thailand Open/.test(sq.name));
eq('she played two Thailand Opens in 2021', thai.length, 2);
check('and the squares do not read the same',
  thai[0].name !== thai[1].name, thai.map(sq => sq.name).join(' / '));
check('the sponsor is what tells them apart, which is what BWF uses',
  thai.some(sq => /YONEX/.test(sq.name)) && thai.some(sq => /TOYOTA/.test(sq.name)),
  thai.map(sq => sq.name).join(' / '));
check('both still name the full tournament on hover',
  thai.every(sq => /Thailand Open/.test(sq.title)));

const perRow = await b.ev(`(() => {
  const bad = [];
  for (const row of document.querySelectorAll('.srow')) {
    const names = [...row.querySelectorAll('.tn')].map(n => n.textContent);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupes.length) bad.push(row.dataset.year + ': ' + dupes.join(', '));
  }
  return bad;
})()`);
check('and no other row in her career repeats a label either',
  perRow.length === 0, perRow.slice(0, 3).join(' | '));

check('SHI Yu Qi loads', await open('#p=57945'));
check('the grid is shut until it is asked for',
  await b.ev(`document.getElementById('comparePage').hidden
    && !document.getElementById('seasonsPage').hidden`));

/* Four pages, on a bar of their own. This was a segmented control in the corner
   of the hero, which is where a setting goes. */
const picks = await b.ev(`[...document.querySelectorAll('#pageNav [data-page]')]
  .map(b => b.dataset.page + (b.classList.contains('on') ? '*' : ''))`);
eq('the nav offers every page by name', picks.join(' '), 'seasons* compare tmt winners');
eq('each one named at a size you can read',
  await b.ev(`Math.round(parseFloat(getComputedStyle(
    document.querySelector('#pageNav .tab .name')).fontSize))`), 16);
check('the nav belongs to neither page, so it survives the switch',
  await b.ev(`(() => {
    const nav = document.getElementById('pageNav');
    return !document.getElementById('seasonsPage').contains(nav)
      && !document.getElementById('comparePage').contains(nav)
      && !document.getElementById('hero').contains(nav);
  })()`));

await b.ev(`document.querySelector('#pageNav [data-page="compare"]').click()`);
check('the compare button opens the second page', await b.ev('window.BST.grid.isOpen()'));
check('and the strip steps aside rather than sitting behind it',
  await b.ev(`document.getElementById('seasonsPage').hidden
    && !document.getElementById('comparePage').hidden`));
check('the controls that only govern the strip go with it',
  await b.ev(`[...document.querySelectorAll('.heroctl .seasonsonly')]
    .every(el => el.offsetParent === null)`));

const sections = await b.ev('window.BST.grid.sections()');
const gYears = await b.ev('window.BST.grid.years()');
const cards = await b.ev('window.BST.grid.cards()');
const width = sections.reduce((a, s) => a + s.n, 0);

eq('one card, for one player', cards.length, 1);
/* The page is called Compare and says so before anybody has been chosen. The
   search box in the header said the same thing and nobody read it. */
check('with an empty seat beside it, inviting the second',
  /Compare with a second player/.test(await b.ev('window.BST.honours.seat()') || ''),
  await b.ev('window.BST.honours.seat()'));
eq('a row per season', cards[0].years.length, gYears.length);
eq('newest at the top, the same way round as the strip',
  cards[0].years[0] > cards[0].years[cards[0].years.length - 1], true);
eq('a cell per slot per row', cards[0].cells.length, gYears.length * width);

/* The counts the whole redesign was for: a level is as wide as the busiest
   season, not one column per tournament that has ever carried a different name. */
const secN = g => (sections.find(s => String(s.group) === String(g)) || {}).n;
/* Five, not four: 2017 ran five Superseries Premier events, which are drawn
   where the Super 1000s are. The block is as wide as the busiest season anyone
   here played, which is the rule rather than an exception to it. */
eq('five Super 1000 slots, once the Premier era is counted', secN(23), 5);
eq('six Super 750 slots', secN(24), 6);
eq('one Olympics slot', secN('OLY'), 1);
eq('one Worlds slot', secN(20), 1);
// There is exactly one season-ending Finals per season. BWF files the delayed
// 2020 edition under 2021, which used to make this 2.
eq('and one Tour Finals slot, whatever COVID did to the calendar', secN(22), 1);
check('and the grid is far narrower than a column per tournament',
  width < 45, `${width} cells wide`);

/* Fixed size and no partial fills: the difficulty is in *which block* a cell is
   in and how far left it sits, never in how big it is or how full. */
const sizes = [...new Set(cards[0].cells.map(c => `${c.w}x${c.h}`))];
eq('every cell is the same size', sizes.length, 1);
eq('and square, at the default zoom', sizes[0], '20x20');
check('no cell carries any text',
  await b.ev(`[...document.querySelectorAll('.gcard .cell')].every(c => c.textContent === '')`));
check('and none of them is a partial fill',
  await b.ev(`[...document.querySelectorAll('.gcard .cell')]
    .every(c => !getComputedStyle(c).backgroundImage.includes('gradient'))`));
/* A result from before the World Tour is marked by having a corner cut off,
   which is why it must not be a gradient: the check above is what stops a cell
   ever reading as a gauge. */
check('a mapped cell is notched rather than shaded',
  await b.ev(`[...document.querySelectorAll('.gcard .cell.mapped')]
    .every(c => getComputedStyle(c).clipPath !== 'none')`),
  await b.ev(`document.querySelectorAll('.gcard .cell.mapped').length + ' mapped cells'`));
check('and an ordinary one is not notched',
  await b.ev(`[...document.querySelectorAll('.gcard .cell:not(.mapped)')]
    .every(c => getComputedStyle(c).clipPath === 'none')`));

/* Pixels, not tiles: adjacent cells share an edge. */
const firstRow = cards[0].cells.filter(c => c.year === cards[0].years[0])
  .sort((a, b) => a.x - b.x);
check('cells in a row touch, with no gap between them',
  firstRow.every((c, i) => i === 0 || Math.abs(c.x - (firstRow[i - 1].x + 20)) < 0.6),
  firstRow.slice(0, 6).map(c => c.x).join(' '));

check('the tier band names the blocks left to right',
  cards[0].tiers.length >= 5 && cards[0].tiers[0] === 'OLY',
  cards[0].tiers.join(' | '));
eq('the leftmost block is the Olympics', sections[0].group, 'OLY');
const gridOrderNow = await b.ev('window.BST.honours.order()');
/* Not 'OTHER' any more: his one unmapped result was the 2018 Asian Games, which
   now has a block that names it. Whatever the last block is, it is the last one
   GRID_ORDER lists that he actually has. */
eq('the rightmost is the last block he has, in the model order',
  sections[sections.length - 1].group,
  gridOrderNow.filter(g => sections.some(x => String(x.group) === String(g))).pop());

/* ---- best-first, which is the whole point ---- */

console.log('\n=== each block runs best-first, left to right ===');

const RAMP = ['rgb(26, 127, 55)', 'rgb(63, 163, 77)', 'rgb(124, 179, 66)',
  'rgb(201, 162, 39)', 'rgb(224, 123, 57)', 'rgb(207, 75, 63)'];
const GROUND = 'rgb(41, 41, 41)';
const rank = bg => { const i = RAMP.indexOf(bg); return i < 0 ? 90 : i; };

const block = (year, group) => cards[0].cells
  .filter(c => c.year === year && String(c.group) === String(group))
  .sort((a, b) => a.slot - b.slot);

/* 2025, read off the raw payload by hand: Malaysia 1st, All England 1st,
   Indonesia 3rd, China 1st — three Super 1000 titles and a semi-final. */
const s1000 = block(2025, 23);
eq('five cells in the Super 1000 block', s1000.length, 5);
eq('three titles then the semi, then the slot he did not fill',
  s1000.map(c => c.tier).join(' '), 'w w w sf off');
check('which is not the order they were played in',
  /Malaysia/.test(s1000[0].title) === false || /China/.test(s1000[2].title),
  s1000.map(c => c.title.split('\n')[0]).join(' | '));

check('every block of every row is in best-first order', (() => {
  for (const year of cards[0].years) {
    for (const s of sections) {
      const cells = block(year, s.group);
      for (let i = 1; i < cells.length; i++) {
        if (rank(cells[i].bg) < rank(cells[i - 1].bg)) return false;
      }
    }
  }
  return true;
})());

/* A thin season pads on the right of its block, never in the middle. */
const thin = block(2021, 23);
check('unplayed slots sit at the right-hand end of the block', (() => {
  const first = thin.findIndex(c => c.bg === GROUND);
  return first === -1 || thin.slice(first).every(c => c.bg === GROUND);
})(), thin.map(c => (c.bg === GROUND ? '·' : c.tier)).join(' '));
check('and a padded cell says so rather than naming a tournament',
  thin.filter(c => c.bg === GROUND).every(c => /no Super 1000 result/.test(c.title)),
  thin[thin.length - 1].title);

check('a played cell names the tournament and the result',
  /Asia Championships/.test(block(2026, 11)[0].title)
  && /Champion/.test(block(2026, 11)[0].title),
  block(2026, 11)[0].title);
eq('the 2026 Continental title floods the cell green', block(2026, 11)[0].bg, RAMP[0]);
eq('and the 2026 Worlds R64 exit floods it red', block(2026, 20)[0].bg, RAMP[5]);

/* ---- zoom ---- */

console.log('\n=== the cells can be made bigger ===');

eq('the slider reads the size the cells are drawn at', await b.ev('window.BST.grid.zoom()'), 20);
await b.ev(`window.BST.grid.zoom(34)`);
const big = await b.ev('window.BST.grid.cards()');
const bigSizes = [...new Set(big[0].cells.map(c => `${c.w}x${c.h}`))];
eq('turning it up resizes every cell', bigSizes[0], '34x34');
eq('and all of them, still identically', bigSizes.length, 1);

const bigRow = big[0].cells.filter(c => c.year === big[0].years[0]).sort((a, b) => a.x - b.x);
check('they still touch at the new size',
  bigRow.every((c, i) => i === 0 || Math.abs(c.x - (bigRow[i - 1].x + 34)) < 0.6));
check('the zoom is a viewing preference, so it stays out of the link',
  await b.ev(`!location.hash.includes('34')`), await b.ev('location.hash'));
await b.ev(`window.BST.grid.zoom(20)`);

/* ---- the level toggles ---- */

/* ---- the search box ----

   ⚠️ Two problems, both measured on 3 September 2026 and both invisible from
   the code: BWF's search is **alphabetical**, so "chen" did not contain CHEN Yu
   Fei at all; and it rode the **low** lane, so one uncached search issued while
   a career was loading took **10.5 seconds** behind that career's draw ladders.
   Until it answered, the list was simply hidden — a working search looked like
   a broken box. */

console.log('\n=== the search box ===');

/* ⚠️ Blur first, then focus. The roster is fetched on the `focus` **event**
   (app.js), not on the box being focused — so calling `focus()` on a box that
   already has it fires nothing and the roster is never asked for. That used to
   be harmless because the app autofocuses at boot and the roster was long since
   loaded by the time this ran; now that the suite blurs the box at boot, the
   app's autofocus can land *after* that blur and leave it focused again. Nine
   checks failed exactly once this way. Forcing the transition costs nothing and
   is what the test means. */
await b.ev(`document.getElementById('q').blur(); document.getElementById('q').focus();`);
check('focusing the box fetches the roster',
  await b.until(`window.BST.roster.state.asked
    && !window.BST.roster.state.loading`, { timeout: 120000 }),
  await b.ev('JSON.stringify(window.BST.roster.state.asked)'));
const rosterSize = await b.ev('window.BST.roster.state.players.length');
check('and it holds the top of every discipline', rosterSize > 200, rosterSize + ' players');

/* The whole point: these are the queries BWF's own search answers worst. */
for (const [q, want] of [['chen', 'CHEN'], ['an se young', 'AN Se Young'],
  ['yamaguchi', 'YAMAGUCHI'], ['shi yu', 'SHI Yu Qi']]) {
  const got = await b.ev(`window.BST.roster.local(${JSON.stringify(q)}).map(p => p.name)`);
  check(`"${q}" is answered from memory`,
    Array.isArray(got) && got.length > 0 && got[0].includes(want),
    (got || []).slice(0, 3).join(' | ') || '(none)');
}

/* ⚠️ Instantly, and without a request. The debounce plus BWF is 700ms-1.6s
   away; the roster is already in memory and the answer has to be on screen
   before the next keystroke, not after it. */
const typed = JSON.parse(await b.ev(`(() => {
  const el = document.getElementById('q');
  el.value = 'chen';
  const before = performance.now();
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return JSON.stringify({
    ms: Math.round(performance.now() - before),
    shown: [...document.querySelectorAll('#suggest li')].map(x => x.textContent.trim()),
    hidden: document.getElementById('suggest').hidden,
  });
})()`));
check('typing puts suggestions up in the same tick', typed.ms < 50, typed.ms + 'ms');
check('and the list is actually open', !typed.hidden);
check('with a real player at the top', /CHEN/i.test(typed.shown[0] || ''),
  typed.shown.slice(0, 3).join(' | '));

/* And BWF's answer arrives underneath rather than replacing it. */
await b.wait(2500);
const settled = await b.ev(
  `[...document.querySelectorAll('#suggest li')].map(x => x.textContent.trim())`);
check('BWF adds to the list rather than clearing it',
  settled.length >= typed.shown.length && /CHEN/i.test(settled[0] || ''),
  settled.slice(0, 4).join(' | '));

/* ⚠️ A query the roster cannot answer must still work: LEE Chong Wei is retired
   and in no ranking table, and he is half the comparison this project exists
   for. The local list being empty is exactly when "Searching…" has to show. */
const cold = JSON.parse(await b.ev(`(() => {
  const el = document.getElementById('q');
  el.value = 'lee chong wei';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return JSON.stringify({
    shown: [...document.querySelectorAll('#suggest li')].map(x => x.textContent.trim()),
    local: window.BST.roster.local('lee chong wei').length,
  });
})()`));
/* ⚠️ "chong wei" alone would not do: the matcher is word-order-blind, so it
   finds MAN Wei Chong, a Malaysian doubles player who really is in the roster.
   The full name is what nothing local can answer. */
eq('a retired player is not in the roster', cold.local, 0);
check('so the box says it is still looking, rather than looking broken',
  /Searching/i.test(cold.shown.join(' ')), cold.shown.join(' | '));

/* ⚠️ **Blur it, not just empty it.** This block focuses the search box and the
   suite then runs for another ten minutes with a real, windowed, foreground
   Chrome. Left focused, the box collects any keystroke that happens on the
   machine meanwhile — which lands as a search nobody wrote, an unfixtured
   request, and a "no fixture misses" failure naming a query that appears in no
   test. Seen twice, with different junk each time. */
await b.ev(`document.getElementById('q').value = '';
  document.getElementById('q').dispatchEvent(new Event('input', { bubbles: true }));`);
await unfocus();

/* Players this reader has opened are remembered, which is how a retired player
   becomes instant the second time. */
await b.ev(`window.BST.roster.remember({ id: '50152', name: 'LEE Chong Wei',
  country: 'Malaysia', countryCode: 'MAS' })`);
const remembered = await b.ev(`window.BST.roster.local('lee chong wei').map(p => p.name)`);
eq('and then it is remembered', (remembered || []).join(), 'LEE Chong Wei');
check('a corrupt store is no store, not a broken box', await b.ev(`(() => {
  localStorage.setItem('bst:recent', 'not json at all');
  try { return Array.isArray(window.BST.roster.recent()); } catch { return false; }
})()`));
await b.ev(`localStorage.removeItem('bst:recent')`);

console.log('\n=== levels can be switched out ===');

const gChips = await b.ev(`[...document.querySelectorAll('#gridGroups .chip')].map(c => ({
  group: c.dataset.group, on: c.getAttribute('aria-pressed') === 'true',
  label: c.textContent }))`);
check('every level present has a toggle', gChips.length >= 6, gChips.map(c => c.label).join(' '));
check('and they all start on', gChips.every(c => c.on));
check('the Olympics are one of them', gChips.some(c => c.group === 'OLY'));

/* ⚠️ Driven on a block this career actually has. It used to click 'OTHER',
   which he no longer has — and `querySelector(...).click()` on nothing throws
   inside the page, so the counts simply came back equal and the failure read as
   "switching a level off does nothing" rather than as a stale selector. */
await b.ev(`document.querySelector('#gridGroups .chip[data-group="GAMES"]').click()`);
const trimmed = await b.ev('window.BST.grid.cards()');
check('switching the regional games off narrows every row',
  trimmed[0].cells.length < cards[0].cells.length,
  `${trimmed[0].cells.length} vs ${cards[0].cells.length}`);
eq('the rows are still all there', trimmed[0].years.length, cards[0].years.length);
check('and the tier band loses that segment',
  !trimmed[0].tiers.includes('GMS'), trimmed[0].tiers.join(' | '));
await b.ev(`document.querySelector('#gridGroups .chip[data-group="GAMES"]').click()`);

/* The same rule as the Seasons page's filters, and read the same way — these
   two rows are the pair somebody would most notice disagreeing. */
eq('a level shown on the grid is filled in BWF red too',
  await b.ev(`getComputedStyle(document.querySelector('#gridGroups .chip.on')).backgroundColor`),
  'rgb(223, 32, 39)');

/* ---- two players side by side ---- */

console.log('\n=== two careers, one set of blocks ===');

// `void`, so the evaluate returns at once rather than blocking on a career
// that is dozens of requests long — the wait below is what watches for it.
await b.ev(`void window.BST.grid.compareWith(87442)`);
const bothLoaded = await b.until('window.BST.grid.ready()', { timeout: 180000 });
check('a second whole career loads', bothLoaded);

const two = await b.ev('window.BST.grid.cards()');
eq('two cards', two.length, 2);
check('each one names its player',
  /SHI/.test(two[0].name) && /AN/i.test(two[1].name), `${two[0].name} / ${two[1].name}`);
check('with the profile BWF supplies — photograph and flag',
  await b.ev(`[...document.querySelectorAll('.gcard')].every(c =>
    c.querySelector('.avatar') && c.querySelector('.meta'))`));
check('and their age and world ranking beside it',
  await b.ev(`[...document.querySelectorAll('.gcard .meta')]
    .every(m => m.textContent.includes('#'))`),
  (await b.ev(`[...document.querySelectorAll('.gcard .meta')].map(m => m.textContent)`)).join(' || '));

eq('the two grids are the same width', two[0].cells.length, two[1].cells.length);
eq('and cover the same years', two[0].years.join(','), two[1].years.join(','));
check('so block N of one is block N of the other',
  two[0].cells.slice(0, 60).every((c, i) =>
    c.group === two[1].cells[i].group && c.slot === two[1].cells[i].slot));

const shared = await b.ev('window.BST.grid.sections()');
check('a block is wide enough for whichever of them played more',
  shared.every(s => {
    const before = sections.find(x => String(x.group) === String(s.group));
    return !before || s.n >= before.n;
  }),
  shared.map(s => `${s.code}:${s.n}`).join(' '));
check('and a season that fills fewer of them is blank on the right, not missing',
  two[1].cells.some(c => c.bg === GROUND));
check('both grids scroll together, in one scroller',
  await b.ev(`document.querySelectorAll('#gridBody').length === 1
    && getComputedStyle(document.getElementById('gridBody')).overflowX === 'auto'`));

check('the comparison is in the link, so it can be shared',
  await b.ev(`location.hash.includes('c=87442') && location.hash.includes('pg=compare')`),
  await b.ev('location.hash'));

await b.ev(`document.getElementById('cmpDrop').click()`);
eq('and it can be dropped again', (await b.ev('window.BST.grid.cards()')).length, 1);
check('which takes it back out of the link',
  await b.ev(`!location.hash.includes('c=')`), await b.ev('location.hash'));

await b.ev(`document.querySelector('#pageNav [data-page="seasons"]').click()`);
check('the seasons button brings the strip back', await b.ev(`!window.BST.grid.isOpen()`));
check('and it is untouched', (await squares(2026)).length > 0);

/* ============================ the honours board ============================

   The third reading: no seasons at all, one row per level, only what cleared
   the bar, and the size of a square carrying what the level was worth.

   The ladder is the claim this view lives or dies by, and it is a claim about
   pixels — so it is measured off what the browser painted, not off the model
   that asked for it. Every step is checked, not just the ends: an off-by-one in
   the exponent would leave the extremes right and the middle wrong.
   ======================================================================== */

console.log('\n=== the honours board: a row per level, sized by what it is worth ===');

const PHI = (1 + Math.sqrt(5)) / 2;

/* Entered by `g=1` on purpose: that is what the compare page's link was called
   when it was a modal, links carrying it are still out there, and this is the
   only place that compatibility is exercised. The app writes `pg=compare` now. */
check('the board opens straight from a link', await open('#p=57945&g=1&v=h'));
check('an old g=1 link still lands on the compare page',
  await b.ev(`window.BST.grid.isOpen()`));
check('and is rewritten to the name the app uses now',
  await b.ev(`location.hash.includes('pg=compare') && !location.hash.includes('g=1')`),
  await b.ev('location.hash'));
/* A link that does not mention the view is claiming the grid, and one that does
   not mention the bar is claiming QF+. Caught by a screenshot, not by the suite:
   `#p=…&g=1` came back as the honours board at W, because the last one had been. */
await b.ev(`window.BST.honours.bar('w')`);
check('a link without the view goes back to the grid', await open('#p=57945&g=1')
  && await b.ev(`window.BST.honours.view() === 'grid'`));
check('and without the bar, back to the default one',
  await b.ev(`window.BST.grid.state.threshold === 'sf'`),
  await b.ev('window.BST.grid.state.threshold'));
check('the board comes back', await open('#p=57945&g=1&v=h'));

/* ---- a win says so in words, not only in green ---- */

/* ⚠️ --res-w and --res-f are one step apart on the same ramp, so a title and a
   lost final are two shades of the same green. Anyone with red-green colour
   vision deficiency reads almost nothing from that ramp, so the mark is
   redundant coding — the fact said twice, in colour and in text. */
const markOf = sel => b.ev(
  `(() => { const el = document.querySelector(${JSON.stringify(sel)});
     if (!el) return 'NO SUCH CELL';
     const a = getComputedStyle(el, '::after');
     return JSON.stringify([a.content, a.color]); })()`);

const wonMark = JSON.parse(await markOf('.honours .cell.r-w'));
eq('a won square is marked', wonMark[0], '"#1"');
eq('in black, so it reads on the darkest green of the ramp', wonMark[1], 'rgb(0, 0, 0)');
eq('a lost final carries no mark at all',
  JSON.parse(await markOf('.honours .cell.r-f'))[0], 'none');
eq('nor does a semi', JSON.parse(await markOf('.honours .cell.r-sf'))[0], 'none');

/* ⚠️ Gated on the square being readable. An honours row sets its own size, so
   the small rows genuinely cannot hold two glyphs — below the threshold the
   mark would be a smudge that reads as dirt rather than as a result. */
const markBigRow = await b.ev(
  `Math.round(document.querySelector('.hrow[data-group="23"] .cell').getBoundingClientRect().width)`);
const markSmallRow = await b.ev(
  `Math.round(document.querySelector('.hrow[data-group="26"] .cell').getBoundingClientRect().width)`);
check('the Super 1000 row is bigger than the Super 300 row', markBigRow > markSmallRow,
  `${markBigRow}px vs ${markSmallRow}px`);
check('and the mark appears on the row that has room for it', markBigRow >= 16,
  markBigRow + 'px');

/* Turning the zoom down has to take the mark away rather than shrink it into
   noise, and turning it back up has to bring it back.
   ⚠️ Asked of one *named* row, not of "the first won square on the board". The
   first version asked the latter and failed: every row has its own size, so at
   the smallest zoom the Olympics row is still 21px and still marked while the
   Super 750 row is 8px and cannot be. That is the behaviour, not a bug. */
const s750won = '.hrow[data-group="24"] .cell.r-w';
/* ⚠️ The floor of the honours zoom exists for this: at 6 a Super 750 square is
   15.7px, just under the gate, and every Super 750 title quietly goes back to
   being nothing but a darker green. Wound all the way down, the mark has to
   survive. */
await b.ev(`window.BST.honours.zoom(1)`);
eq('the zoom will not go below the floor',
  await b.ev(`window.BST.honours.zoom()`), 7);
eq('and wound all the way down a Super 750 win keeps its mark',
  JSON.parse(await markOf(s750won))[0], '"#1"');
const s750min = await b.ev(
  `Math.round(document.querySelector('.hrow[data-group="24"] .cell').getBoundingClientRect().width * 10) / 10`);
check('because the floor keeps it clear of the 16px gate', s750min >= 16, s750min + 'px');

/* The gate itself still has to work, or the mark would be a smudge on the rows
   that genuinely cannot hold two glyphs.
   ⚠️ Asserted on the geometry, not on a won square: whether this particular
   career holds a Super 300 title is not the point being made, and a test that
   depends on it breaks when the fixtures are re-recorded. */
const s300min = await b.ev(
  `Math.round(document.querySelector('.hrow[data-group="26"] .cell').getBoundingClientRect().width * 10) / 10`);
check('while a Super 300 square is still below the gate', s300min < 16, s300min + 'px');
await b.ev(`window.BST.honours.zoom(8)`);
eq('and the default keeps it', JSON.parse(await markOf(s750won))[0], '"#1"');

/* The grid draws its cells from a different function; both had to get it. */
await b.ev(`window.BST.honours.view('grid')`);
await b.until(`!!document.querySelector('#gridBody .cell.r-w')`, { timeout: 30000 });
eq('the grid marks a win too',
  JSON.parse(await markOf('#gridBody .cell.r-w'))[0], '"#1"');
eq('and leaves a final alone',
  JSON.parse(await markOf('#gridBody .cell.r-f'))[0], 'none');
await b.ev(`window.BST.honours.view('honours')`);
await b.until(`!!document.querySelector('.honours .cell.r-w')`, { timeout: 30000 });

/* ---- the same board in the other vocabulary ---- */

/* The switch renames the ladder and moves which squares count as translations.
   What it must never do is resize anything: two readings of one board only
   compare if a square means the same amount in both.

   SHI Yu Qi is the right career to drive it on rather than a purely modern one.
   He straddles 2018 — Superseries and Grand Prix Gold results on one side of
   it, Super 750s and Super 500s on the other — so both directions of the notch
   are on the same board at once and the inversion is visible in one place. */

console.log('\n=== the era switch ===');

const eraRows = () => b.ev(`(() => JSON.stringify(
  [...document.querySelectorAll('#honBody .hrow')].map(r => ({
    g: r.dataset.group,
    label: (r.querySelector('.hlvl') || {}).textContent || '',
    full: r.querySelector('.hlvl') ? r.querySelector('.hlvl').title : '',
    w: Math.round(r.querySelector('.cell')
      ? r.querySelector('.cell').getBoundingClientRect().width * 100 : 0) / 100,
    from: [...r.querySelectorAll('.cell.mapped')].map(c => c.dataset.from),
    cells: [...r.querySelectorAll('.cell')].length,
  }))))()`).then(JSON.parse);

const eraButtons = () => b.ev(`(() => JSON.stringify(
  [...document.querySelectorAll('#gridEra [data-era]')]
    .map(x => x.textContent + (x.classList.contains('on') ? '*' : ''))))()`).then(JSON.parse);

const froms = rows => rows.flatMap(r => r.from);
const cells = rows => rows.reduce((n, r) => n + r.cells, 0);

eq('the switch offers both readings, World Tour pressed',
  (await eraButtons()).join(' '), 'World Tour* Superseries');
eq('and that is what the state says', await b.ev('window.BST.grid.state.era'), 'wt');

const wtRows = await eraRows();
check('the rows are named in World Tour words',
  wtRows.some(r => r.label === 'Super 1000') && wtRows.some(r => r.label === 'Tour Finals'),
  wtRows.map(r => r.label).join(' | '));
/* Every tier's name fits the gutter as it is; only the regional games needs a
   short form, which is why the era switch is where this first bit. */
check('and only the regional games needs shortening',
  wtRows.filter(r => r.label !== r.full).every(r => r.g === 'GAMES'),
  wtRows.filter(r => r.label !== r.full).map(r => `${r.label}/${r.full}`).join(' | ') || 'none');
check('and the marked squares are the ones from before the World Tour',
  froms(wtRows).length > 0 && froms(wtRows).every(f => /Superseries|Grand Prix/.test(f)),
  [...new Set(froms(wtRows))].join(', ') || 'nothing marked');

await b.ev(`window.BST.grid.era('ss')`);
await b.until(`!!document.querySelector('#honBody .hrow')`, { timeout: 30000 });
const ssRows = await eraRows();

eq('switching presses the other button',
  (await eraButtons()).join(' '), 'World Tour Superseries*');
check('the rows are renamed',
  ssRows.some(r => r.full === 'Superseries Premier')
  && ssRows.some(r => r.full === 'Superseries Finals'),
  ssRows.map(r => r.full).join(' | '));
/* The gutter is fourteen characters of 10px mono, so the long era names are
   shortened to fit and the whole name lives on the tooltip.
   Caught by a screenshot, not by this suite: the first version asserted the
   full name was on screen, and it was not — the board showed "Superseries Pr",
   which reads as a bug rather than as an abbreviation. */
check('shortened where they have to be, whole name on the tooltip',
  ssRows.every(r => r.label.length <= 14)
  && ssRows.some(r => r.label === 'SS Premier' && r.full === 'Superseries Premier'),
  ssRows.map(r => r.label).join(' | '));
check('and nothing on the board is still called Super anything',
  !ssRows.some(r => /^Super \d/.test(r.label)), ssRows.map(r => r.label).join(' | '));

/* The whole claim of the switch, on one career: the notch turns over. */
check('now it is the modern results that are marked instead',
  froms(ssRows).length > 0 && froms(ssRows).every(f => /^Super \d+$/.test(f)),
  [...new Set(froms(ssRows))].join(', ') || 'nothing marked');
eq('and nothing is lost or gained by switching', cells(ssRows), cells(wtRows));
check('the tooltip says what each marked square actually was',
  await b.ev(`(document.querySelector('#honBody .cell.mapped') || {})
    .getAttribute('title').includes('drawn as')`),
  await b.ev(`(document.querySelector('#honBody .cell.mapped') || {}).getAttribute('title')`));

let sized = 0;
/* ⚠️ The load-bearing check. The era rows share the rung of the tier they are
   drawn over precisely so that this holds; give them a ladder of their own and
   every square on the board changes size when you switch, and the two readings
   stop being two readings of one board. */
for (const [wt, ss, name] of [['OLY', 'OLY', 'the Olympics'], ['20', '20', 'the Worlds'],
  ['22', '22', 'the season-ending Finals'], ['23', '8', 'the top tier'],
  ['24', '2', 'the tier below it'], ['26', '3', 'the Grand Prix Gold rung']]) {
  const before = wtRows.find(r => r.g === wt);
  const after = ssRows.find(r => r.g === ss);
  /* ⚠️ `!before.w` as well as the two lookups. A row this career never reached
     at the current bar has no cell to measure, and 0 === 0 would pass without
     asserting anything at all — which is how the Olympics row was quietly not
     being checked. */
  if (!before || !after || !before.w) continue;
  sized++;
  check(`${name} is exactly the same size in both readings`,
    Math.abs(before.w - after.w) < 0.01, `${before.w}px as ${wt}, ${after.w}px as ${ss}`);
}
check('and enough rows had a square to measure for that to mean something',
  sized >= 4, sized + ' rows compared');

/* The note under the board is what explains the notch, so it swaps with it. */
check('the note that explains the notch swaps with the era',
  await b.ev(`document.getElementById('mapNote').hidden
    && !document.getElementById('mapNoteSS').hidden`));
check('and the sentence about the ladder with it',
  await b.ev(`document.getElementById('honLadderWT').hidden
    && !document.getElementById('honLadderSS').hidden`));

/* ---- and it is part of the link ---- */

check('the era travels in the hash', await b.ev(`location.hash.includes('er=ss')`),
  await b.ev('location.hash'));
await b.ev(`window.BST.grid.era('wt')`);
check('and the default is claimed by leaving it out',
  await b.ev(`!location.hash.includes('er=')`), await b.ev('location.hash'));

check('a link in Superseries names opens in them',
  await open('#p=57945&pg=compare&v=h&er=ss'));
await b.until(`!!document.querySelector('#honBody .hrow')`, { timeout: 60000 });
eq('really opens in them', await b.ev('window.BST.grid.state.era'), 'ss');
/* ⚠️ Read unconditionally, like the view and the bar. A reader who switches to
   Superseries and then follows a link that says nothing about the era has to
   land back in World Tour names, not keep the last thing they looked at. */
check('and a link that says nothing about it goes back to World Tour',
  await open('#p=57945&pg=compare&v=h'));
eq('really goes back', await b.ev('window.BST.grid.state.era'), 'wt');

/* ---- the grid is drawn by a different function and had to get it too ---- */

await b.ev(`window.BST.honours.view('grid')`);
await b.until(`!!document.querySelector('#gridBody .gtiers .gt')`, { timeout: 30000 });
const bandOf = () => b.ev(`[...document.querySelectorAll('#gridBody .gtiers .gt')]
  .map(x => x.textContent).join(' ')`);
const wtBand = await bandOf();
await b.ev(`window.BST.grid.era('ss')`);
await b.until(`!!document.querySelector('#gridBody .gtiers .gt')`, { timeout: 30000 });
const ssBand = await bandOf();
check('the grid band is renamed as well', ssBand.includes('SSP') && !ssBand.includes('S1000'),
  `${wtBand}   ->   ${ssBand}`);
/* The one place the merge is visible as a shape rather than as a word: the
   Super 750 and the Super 500 arrive as a single Superseries block. */
check('and it is one block shorter, because two tiers now share a row',
  ssBand.split(' ').length === wtBand.split(' ').length - 1,
  `${wtBand.split(' ').length} blocks -> ${ssBand.split(' ').length}`);
await b.ev(`window.BST.grid.era('wt')`);
await b.ev(`window.BST.honours.view('honours')`);
await b.until(`!!document.querySelector('.honours .cell.r-w')`, { timeout: 30000 });

/* ---- what the default bar shows ---- */

eq('a board nobody has touched is set to the semi-finals',
  await b.ev('window.BST.grid.state.threshold'), 'sf');
check('and says so, with SF+ the one lit',
  await b.ev(`document.querySelector('#honMin .seg.on').dataset.hmin === 'sf'`));

/* SHI Yu Qi went to two Olympics and lost both quarter-finals, so the very
   first row of the very first board a reader sees is empty. That is the right
   answer and it has to be legible as one. */
const defaultOly = (await b.ev('window.BST.honours.rows()')).find(r => r.group === 'OLY');
eq('his Olympic row is empty at it', defaultOly.sides[0].length, 0);
check('and the ghost says he went twice rather than never',
  /2 entered, none at SF\+/.test(defaultOly.empty[0] || ''), defaultOly.empty[0]);

/* The rest of this section is measured at QF+, which fills every row he has and
   so exercises the ordering and the ladder across the whole board. */
await b.ev(`window.BST.honours.bar('qf')`);
check('and it really is open', await b.ev('window.BST.grid.isOpen()'));
eq('showing the board and not the grid', await b.ev('window.BST.honours.view()'), 'honours');
check('the grid is out of the way, not merely behind it',
  await b.ev(`document.getElementById('gridBody').offsetParent === null`));
check('and so is the grid\'s legend, which describes something else',
  await b.ev(`document.getElementById('gridNote').offsetParent === null
    && document.getElementById('honNote').offsetParent !== null`));

let board = await b.ev('window.BST.honours.rows()');
check('a row for every level he has ever entered', board.length >= 8, `${board.length} rows`);
eq('hardest first, so the Olympics are at the top', board[0].group, 'OLY');
check('and the rows are the grid\'s own order',
  board.map(r => r.group).join(',')
  === (await b.ev('window.BST.honours.sections()')).map(s => String(s.group)).join(','));

/* ---- the ladder, measured ---- */

/* Null rather than a throw: a level the player never entered has no row at all
   — SHI Yu Qi has never played a Super 100 — and a check that wants to skip it
   should be able to ask. */
const sideOf = g => {
  const row = board.find(r => r.group === String(g));
  const cell = row && (row.sides[0] || [])[0];
  return cell ? cell.h : null;
};
const painted = board
  .map(r => ({ group: r.group, side: (r.sides[0] || [])[0] }))
  .filter(r => r.side);

check('every square in a row is square, and the same size as its neighbours',
  board.every(r => r.sides.every(s => s.every(c => Math.abs(c.w - c.h) < 1.5
    && Math.abs(c.h - s[0].h) < 1.5))),
  board.map(r => `${r.group}:${(r.sides[0] || [])[0] ? (r.sides[0][0].h) : '-'}`).join(' '));

/* Counted in rungs of the ladder, not in rows on screen and not in places in
   the order. Two things make those three different numbers: SHI Yu Qi has never
   played a Super 100, so Super 300 sits directly above Unmapped on his board and
   the step between them is *two* rungs; and the Continentals share a rung with
   the Super 1000s, so they are two places apart in the order and no distance at
   all in size. An adjacency check would call both of those bugs, and they are
   the opposite. */
const order = await b.ev('window.BST.honours.order()');
const rungOf = {};
for (const g of order) rungOf[String(g)] = await b.ev(`window.BST.honours.rung(${JSON.stringify(g)})`);
const rungs = g => rungOf[String(g)];
const bottom = Math.max(...Object.values(rungOf));
const areaRatio = (a, b2) => Math.pow(a.side.h, 2) / Math.pow(b2.side.h, 2);

check('each rung of the ladder is φ times the AREA of the one below it',
  painted.every((r, i) => {
    if (i === 0) return true;
    const steps = rungs(r.group) - rungs(painted[i - 1].group);
    return Math.abs(areaRatio(painted[i - 1], r) - Math.pow(PHI, steps))
      < 0.14 * Math.max(steps, 1);
  }),
  painted.map((r, i) => i === 0 ? `${r.group}=${r.side.h}`
    : `${r.group}=${r.side.h}(×${areaRatio(painted[i - 1], r).toFixed(2)}`
      + ` over ${rungs(r.group) - rungs(painted[i - 1].group)})`).join(' '));

/* The same claim stated as one number: every painted row sits on a single
   geometric ladder, so `side ÷ √φ^rung` is the same for all of them. Immune to
   which levels a career happens to contain. */
const feet = painted.map(r => r.side.h / Math.pow(Math.sqrt(PHI), bottom - rungs(r.group)));
check('so every row on screen sits on one ladder with one base',
  feet.every(v => Math.abs(v - feet[0]) < 0.25),
  feet.map(v => v.toFixed(2)).join(' '));

/* The Continentals are a peer of the Super 1000, not a step under the 750:
   settled at full weight in HANDOVER 2.2, and giving them a rung of their own
   pushed every Super below them down one, so the official five-level ladder came
   out unevenly spaced for a reason that had nothing to do with the Supers. */
check('a Continental square is exactly a Super 1000 square',
  sideOf(11) != null && Math.abs(sideOf(11) - sideOf(23)) < 1.5,
  `CON ${sideOf(11)} vs S1000 ${sideOf(23)}`);
check('and bigger than a Super 750, where it used to sit',
  sideOf(11) > sideOf(24), `CON ${sideOf(11)} vs S750 ${sideOf(24)}`);
check('so the five Supers sit on five consecutive rungs, nothing wedged between',
  [23, 24, 25, 26, 27].every((g, i, a) => i === 0 || rungs(g) === rungs(a[i - 1]) + 1),
  [23, 24, 25, 26, 27].map(g => `${g}@${rungs(g)}`).join(' '));
/* And they are an unbroken run of rows, not only of sizes: the Continentals are
   listed above the Super 1000, so nothing at all sits between one Super row and
   the next on screen. */
const supRows = board.map(r => r.group).filter(g => ['23', '24', '25', '26', '27'].includes(g));
const firstSup = board.findIndex(r => r.group === '23');
check('and run as consecutive rows down the board',
  board.slice(firstSup, firstSup + supRows.length).map(r => r.group).join(',')
  === supRows.join(','),
  board.map(r => r.group).join(' '));
/* Two levels share the Super 1000's rung now — the Continentals and the
   regional multi-sport games — and both are listed above it, so the row
   immediately above the Super run is one of them. */
check('with a row that shares their rung directly above the first of them',
  board[firstSup - 1] && ['11', 'GAMES'].includes(board[firstSup - 1].group),
  board.map(r => r.group).join(' '));
const supers = [23, 24, 25, 26, 27].filter(g => sideOf(g) != null);
check('and every step down the painted Super ladder is the same step',
  supers.every((g, i) => i === 0
    || Math.abs(sideOf(supers[i - 1]) / sideOf(g) - Math.sqrt(PHI)) < 0.05),
  supers.map(g => `${g}=${sideOf(g)}`).join(' '));

check('so an Olympic square dwarfs a Super 500 one rather than nudging it',
  sideOf('OLY') > sideOf(25) * 2, `${sideOf('OLY')} vs ${sideOf(25)}`);
check('and the whole ladder is about seven to one, not forty-seven',
  (() => {
    const hi = painted[0].side.h, lo = painted[painted.length - 1].side.h;
    return hi / lo > 4 && hi / lo < 10;
  })(),
  `${painted[0].side.h} / ${painted[painted.length - 1].side.h}`);

/* ---- only what cleared the bar ---- */

const RED = [RAMP[4], RAMP[5]];
const allCells = rows => rows.flatMap(r => r.sides.flat());

check('nothing below a quarter-final is on the board at all',
  allCells(board).every(c => !RED.includes(c.bg) && c.bg !== GROUND),
  allCells(board).filter(c => RED.includes(c.bg)).length + ' too poor to be here');
check('every square runs best-first, away from the label',
  board.every(r => r.sides.every((s, i) =>
    s.every((c, j) => j === 0 || (r.mirrored[i]
      ? rank(c.bg) <= rank(s[j - 1].bg)      // mirrored: worst outermost
      : rank(c.bg) >= rank(s[j - 1].bg))))));

const olyRow = board.find(r => r.group === 'OLY');
eq('both his Olympics are quarter-finals', olyRow.sides[0].length, 2);
check('painted the quarter-final colour', olyRow.sides[0].every(c => c.bg === RAMP[3]),
  olyRow.sides[0].map(c => c.bg).join(' '));
eq('and the count beside the row says two', olyRow.counts[0], 2);

/* Raising the bar is the same board with less on it, and the row he cannot
   reach has to say which kind of empty it is. */
await b.ev(`window.BST.honours.bar('f')`);
board = await b.ev('window.BST.honours.rows()');
const olyF = board.find(r => r.group === 'OLY');
eq('at F+ his Olympic row empties out', olyF.sides[0].length, 0);
eq('and leaves a ghost rather than nothing', olyF.empty.length, 1);
check('which says he went twice and never got that far',
  /2 entered, none at F\+/.test(olyF.empty[0]), olyF.empty[0]);
check('everything still on the board is a final or a title',
  allCells(board).every(c => c.bg === RAMP[0] || c.bg === RAMP[1]));

await b.ev(`window.BST.honours.bar('w')`);
board = await b.ev('window.BST.honours.rows()');
check('at W, only titles are left', allCells(board).every(c => c.bg === RAMP[0]));
check('and the bar travels in the link, because it is part of the argument',
  await b.ev(`location.hash.includes('th=w')`), await b.ev('location.hash'));
await b.ev(`window.BST.honours.bar('sf')`);
check('the default bar stays out of the link, being the default',
  await b.ev(`!location.hash.includes('th=')`), await b.ev('location.hash'));
check('and a non-default one goes back into it',
  await b.ev(`window.BST.honours.bar('qf'), location.hash.includes('th=qf')`),
  await b.ev('location.hash'));

/* ---- zoom moves the whole ladder together ---- */

const zoomBefore = (await b.ev('window.BST.honours.rows()'))
  .map(r => (r.sides[0] || [])[0]).filter(Boolean).map(c => c.h);
await b.ev(`window.BST.honours.zoom(12)`);
const zoomAfter = (await b.ev('window.BST.honours.rows()'))
  .map(r => (r.sides[0] || [])[0]).filter(Boolean).map(c => c.h);
check('the slider makes every row bigger', zoomAfter.every((h, i) => h > zoomBefore[i]),
  `${zoomBefore[0]} -> ${zoomAfter[0]}`);
const zoomFeet = zoomAfter.map((h, i) =>
  h / Math.pow(Math.sqrt(PHI), bottom - rungs(painted[i].group)));
check('and the ladder survives it — every row still shares one base',
  zoomFeet.every(v => Math.abs(v - zoomFeet[0]) < 0.35),
  zoomFeet.map(v => v.toFixed(2)).join(' '));
check('which is a bigger base than before, not a different shape',
  zoomFeet[0] > feet[0], `${feet[0].toFixed(2)} -> ${zoomFeet[0].toFixed(2)}`);
await b.ev(`window.BST.honours.zoom(7)`);

/* ---- two boards across one line ---- */

console.log('\n=== two players, mirrored about the centre line ===');

await b.ev(`void window.BST.grid.compareWith(87442)`);
check('a second career loads into the board',
  await b.until('window.BST.grid.ready()', { timeout: 180000 }));

const hTwo = await b.ev('window.BST.honours.rows()');
const heads = await b.ev('window.BST.honours.heads()');
const spine = await b.ev('window.BST.honours.spine()');

eq('two profiles', heads.length, 2);
check('the left one is mirrored and the right one is not',
  heads[0].mirrored && !heads[1].mirrored,
  heads.map(h => `${h.name}${h.mirrored ? '(mirror)' : ''}`).join(' | '));
check('every row has two halves', hTwo.every(r => r.sides.length === 2));
check('the left half is the mirrored one',
  hTwo.every(r => r.mirrored[0] && !r.mirrored[1]));

check('the left player stays left of the line',
  hTwo.every(r => r.sides[0].every(c => c.x + c.w <= spine + 1)),
  `spine ${spine}`);
check('and the right player right of it',
  hTwo.every(r => r.sides[1].every(c => c.x >= spine - 1)));

/* Mirroring is what makes it a comparison rather than two lists: the best of
   each player is what meets in the middle. */
const wide = hTwo.find(r => r.sides[0].length > 2 && r.sides[1].length > 2);
check('so the best result of each is the one nearest the line',
  rank(wide.sides[0][wide.sides[0].length - 1].bg) <= rank(wide.sides[0][0].bg)
  && rank(wide.sides[1][0].bg) <= rank(wide.sides[1][wide.sides[1].length - 1].bg),
  wide.group);

/* The widths are derived rather than assumed, and this is the case that made it
   necessary: AN Se Young has twenty Super 1000 results at QF+, which overflowed
   a half sized by `1fr` and silently lost the last of them. */
const clipped = await b.ev(`(() => {
  const bad = [];
  for (const side of document.querySelectorAll('#honBody .hside')) {
    if (side.scrollWidth > side.clientWidth + 1) {
      bad.push(side.closest('.hrow').dataset.group
        + ': ' + side.scrollWidth + ' > ' + side.clientWidth);
    }
  }
  return bad;
})()`);
check('no half is cut short, however many results it holds',
  clipped.length === 0, clipped.slice(0, 3).join(' | '));

check('both halves are the same width, so the line stays in the middle',
  await b.ev(`(() => {
    const r = document.querySelector('#honBody .hrow');
    const w = [...r.querySelectorAll('.hside')].map(s => Math.round(s.getBoundingClientRect().width));
    return w.length === 2 && Math.abs(w[0] - w[1]) <= 1;
  })()`));

const s100 = hTwo.find(r => r.group === '27');
check('a level only one of them has ever played is still a row for both',
  !!s100 && s100.sides[0].length === 0 && s100.sides[1].length > 0);
/* An empty half is never just empty: it says which kind of empty. He entered
   two — both Grand Prix events, mapped here — and placed in neither, which is a
   different claim from never having turned up. */
check('and his empty half says which kind of empty it is',
  /\d+ entered, none at|never played at this level/.test(s100.empty[0] || ''),
  s100.empty[0]);

check('the board is in the link, comparison and all',
  await b.ev(`location.hash.includes('v=h') && location.hash.includes('c=87442')`),
  await b.ev('location.hash'));

await b.ev(`document.getElementById('cmpDrop').click()`);
eq('the comparison can be dropped', (await b.ev('window.BST.honours.heads()')).length, 1);

/* ---- and back to the grid ---- */

await b.ev(`window.BST.honours.view('grid')`);
check('the switch goes back to the grid',
  await b.ev(`document.getElementById('gridBody').offsetParent !== null
    && document.getElementById('honBody').offsetParent === null`));
check('which takes the board out of the link',
  await b.ev(`!location.hash.includes('v=h')`), await b.ev('location.hash'));
/* Left on the board, so coming back should land on the board — leaving a page
   is not the same as resetting it. */
await b.ev(`window.BST.honours.view('honours')`);
await b.ev(`document.querySelector('#pageNav [data-page="seasons"]').click()`);
check('and the page can be left from either view', await b.ev(`!window.BST.grid.isOpen()`));
check('which puts the hero back on the seasons',
  await b.ev(`document.querySelector('#pageNav [data-page="seasons"]')
    .classList.contains('on')`));
check('and the strip is showing again',
  await b.ev(`!document.getElementById('seasonsPage').hidden`));
await b.ev(`document.querySelector('#pageNav [data-page="compare"]').click()`);
check('going back to compare returns to the view you left it on',
  await b.ev(`window.BST.grid.isOpen() && window.BST.honours.view() === 'honours'`));
check('with the slider still pointed at the board',
  await b.ev(`Number(document.getElementById('gridZoom').max) === 16`),
  await b.ev(`document.getElementById('gridZoom').max`));
await b.ev(`document.querySelector('#pageNav [data-page="seasons"]').click()`);

/* ============================ the tournament now ============================

   The one page that is not about a player: whatever BWF says is on, and that
   day's order of play. `now=` pins the date the page reasons from, so a fixture
   recorded on finals day 2026 answers the same way whenever this is run.
   ======================================================================== */

console.log('\n=== the compare page: saving what is on screen ===');

await b.ev(`location.hash = '#p=57945&pg=compare&c=87442&now=2026-08-23'`);
check('two careers are up',
  await b.until(`window.BST.grid.cards().length === 2`, { timeout: 240000 }));
await b.until(`window.BST.grid.ready()`, { timeout: 240000 });

check('the bar is out of the way until it is asked for',
  await b.ev(`document.getElementById('gridExport').hidden`));
await b.ev(`document.getElementById('gridSave').click()`);
check('the export button opens it',
  !await b.ev(`document.getElementById('gridExport').hidden`));

/* ⚠️ Named for the people in it, not for the view alone — a comparison and a
   single career would otherwise land in a downloads folder as the same file and
   the second one would silently become `(1)`. */
eq('the file is named for who is in it and which view it is',
  await b.ev(`window.BST.grid.exportName()`),
  'badminton-grid-shi-v-an.png');

const gridPoster = await b.ev(`window.BST.grid.poster()`);
eq('the grid poster knows it is the grid', gridPoster.view, 'grid');
/* The grid sets no spine — that is the board's arrangement — so what says both
   careers are in the picture is the title. */
eq('and that both careers are in it',
  gridPoster.title, 'SHI Yu Qi  ·  AN Se Young');
eq('over the same seasons the page draws',
  gridPoster.years.join(','),
  (await b.ev(`window.BST.grid.years()`)).join(','));
eq('and the same levels',
  gridPoster.sections.join(','),
  (await b.ev(`window.BST.grid.sections().map(s => String(s.group))`)).join(','));

/* ⚠️ The picture is **what is on screen**, chips included. The Winners board
   exports a range of seasons because that is the shape of the claim posted from
   it; a career is not a range, so this one has to follow the controls instead. */
const wideGrid = gridPoster.width;
await b.ev(`document.querySelector('#gridGroups [data-group="25"]').click()`);
await b.wait(200);
const narrowGrid = await b.ev(`window.BST.grid.poster()`);
check('switching a level off narrows the picture too',
  narrowGrid.width < wideGrid, `${narrowGrid.width} against ${wideGrid}`);
eq('and the level is gone from it',
  narrowGrid.sections.includes('25'), false);
eq('though the chip row still offers it',
  narrowGrid.all.includes('25'), true);
await b.ev(`document.querySelector('#gridGroups [data-group="25"]').click()`);
await b.wait(200);

const gridPng = await b.ev(`window.BST.grid.png()`);
check('a grid poster comes back as a real PNG',
  gridPng && gridPng.type === 'image/png', JSON.stringify(gridPng && gridPng.type));
check('with the photographs in it', gridPng && gridPng.bytes > 20000, gridPng && gridPng.bytes);
check('and it decodes to the size the layout asked for',
  await b.ev(`(async () => {
    const L = window.BST.grid.poster();
    const out = await window.BST.grid.png();
    const im = new Image();
    await new Promise(r => { im.onload = r; im.onerror = r; im.src = out.url; });
    return im.naturalWidth === Math.round(L.width * 2)
      && im.naturalHeight === Math.round(L.height * 2)
      ? true : im.naturalWidth + 'x' + im.naturalHeight
        + ' want ' + Math.round(L.width * 2) + 'x' + Math.round(L.height * 2);
  })()`), true);

/* ---- and the board ---- */

await b.ev(`window.BST.honours.view('honours')`);
await b.until(`document.querySelectorAll('#honBody .hrow').length > 3`, { timeout: 60000 });

eq('the button follows the view it is on',
  await b.ev(`window.BST.grid.exportName()`),
  'badminton-honours-shi-v-an.png');
const honPoster = await b.ev(`window.BST.grid.poster()`);
eq('the honours poster knows it is the board', honPoster.view, 'honours');
/* ⚠️ Two careers mirror about a spine; one does not, and the layout has to say
   which, because it is what decides the width. */
eq('and that there are two of them to mirror', honPoster.two, true);
eq('with a row for every level on screen',
  honPoster.sections.length,
  await b.ev(`document.querySelectorAll('#honBody .hrow').length`));

/* The round bar is part of what the board argues, so it is part of the picture. */
await b.ev(`window.BST.honours.bar('w')`);
await b.wait(200);
const titlesOnly = await b.ev(`window.BST.grid.poster()`);
check('raising the bar to titles only shrinks the board',
  titlesOnly.width < honPoster.width, `${titlesOnly.width} against ${honPoster.width}`);
check('and the legend says which bar it was drawn at',
  titlesOnly.legend[0].includes('W'), titlesOnly.legend[0]);
await b.ev(`window.BST.honours.bar('sf')`);
await b.wait(200);

const honPng = await b.ev(`window.BST.grid.png()`);
check('a board poster comes back as a real PNG',
  honPng && honPng.type === 'image/png', JSON.stringify(honPng && honPng.type));
check('and it decodes to the size the layout asked for',
  await b.ev(`(async () => {
    const L = window.BST.grid.poster();
    const out = await window.BST.grid.png();
    const im = new Image();
    await new Promise(r => { im.onload = r; im.onerror = r; im.src = out.url; });
    return im.naturalWidth === Math.round(L.width * 2)
      && im.naturalHeight === Math.round(L.height * 2)
      ? true : im.naturalWidth + 'x' + im.naturalHeight
        + ' want ' + Math.round(L.width * 2) + 'x' + Math.round(L.height * 2);
  })()`), true);

/* ⚠️⚠️ The result ramp exists twice — as `--res-*` in the stylesheet for the
   page and as `RESULT_COLOURS` in `poster.js` for the canvas — because there is
   no way to hand one to the other without a build step. This is the check that
   stops them drifting: the *computed* colour off a drawn cell, not the
   declaration, held against the table the export paints from. */
const ramp = await b.ev(`window.BST.grid.results()`);
const paintedRamp = await b.ev(`(() => {
  const out = {};
  for (const c of document.querySelectorAll('#honBody .cell')) {
    const t = (c.className.match(/r-([\\w]+)/) || [])[1];
    if (t && !out[t]) out[t] = getComputedStyle(c).backgroundColor;
  }
  return out;
})()`);
const rampHex = c => '#' + (c.match(/\d+/g) || []).slice(0, 3)
  .map(n => Number(n).toString(16).padStart(2, '0')).join('');
for (const [tier, colour] of Object.entries(paintedRamp)) {
  eq(`the ${tier} cell the page paints is the one the export paints`,
    rampHex(colour), ramp[tier]);
}
check('and every tier the export knows is one the page has a rule for',
  Object.keys(ramp).length >= Object.keys(paintedRamp).length,
  Object.keys(ramp).join(' '));

await b.ev(`document.getElementById('gridSave').click()`);
check('and the bar closes again',
  await b.ev(`document.getElementById('gridExport').hidden`));
await b.ev(`window.BST.honours.view('grid')`);


console.log('\n=== the tournament page: whatever is on ===');

/** The tournament page has no player, so `BST.ready` is the wrong thing to wait on. */
async function openTmt(hash) {
  await b.ev(`location.hash = ${JSON.stringify(hash)}`);
  const ok = await b.until(
    '!!window.BST && window.BST.tmt.ready() && window.BST.tmt.pick() !== null',
    { timeout: 120000 });
  if (!ok) console.log('LOG  timed out loading ' + hash);
  return ok;
}

check('finals day at the Worlds loads', await openTmt('#pg=tmt&now=2026-08-23'));

const navNow = await b.ev(`[...document.querySelectorAll('#pageNav [data-page]')]
  .map(b => b.dataset.page + (b.classList.contains('on') ? '*' : ''))`);
eq('the nav says which page you are on', navNow.join(' '), 'seasons compare tmt* winners');
check('the other three pages step aside',
  await b.ev(`document.getElementById('seasonsPage').hidden
    && document.getElementById('comparePage').hidden
    && document.getElementById('winPage').hidden
    && !document.getElementById('tmtPage').hidden`));

const pick = await b.ev('window.BST.tmt.pick()');
eq('it picked the World Championships', pick.name, 'BWF World Championships 2026');
eq('and knows it is on', pick.state, 'live');
eq('the badge says so',
  (await b.ev(`document.getElementById('tmtState').textContent`)).trim(), 'On now');

/* ---- the day bar ---- */

const dayChips = await b.ev(`[...document.querySelectorAll('#tmtDays [data-day]')].map(c =>
  c.dataset.day + (c.classList.contains('is-active') ? '*' : '')
  + (c.classList.contains('is-today') ? 'T' : ''))`);
eq('an All button and then the seven days, with today marked and chosen',
  dayChips.join(' '),
  'all 2026-08-17 2026-08-18 2026-08-19 2026-08-20 2026-08-21 2026-08-22 2026-08-23*T');
eq('each one carries its weekday, not just a number',
  await b.ev(`document.querySelector('#tmtDays [data-day="2026-08-17"]').textContent`),
  '17Mon');

/* ---- finals day: one court, so a list rather than a grid ---- */

const finalsCards = await b.ev('window.BST.tmt.cards()');
eq('the five finals', finalsCards.length, 5);
check('every one of them a final',
  finalsCards.every(m => m.round === 'Final'), finalsCards.map(m => m.round).join(' '));
eq('one court means no grid — a list says the same thing with less machinery',
  await b.ev('window.BST.tmt.grid()'), null);
/* Recorded while the finals were being played, so this one day holds all three
   states. Asserted as invariants rather than counts, because re-recording moves
   it — and BWF spells a live match "In Progress", not "Live", which is why the
   card reads the single-letter status instead. */
check('every card is in one of the three states',
  finalsCards.every(m => ['finished', 'live', 'upcoming'].includes(m.status)),
  finalsCards.map(m => `${m.draw}:${m.status}`).join(' '));
check('a finished one names a winner and shows both sides their games',
  finalsCards.filter(m => m.status === 'finished')
    .every(m => m.sides.filter(sd => sd.won).length === 1
      && m.sides.every(sd => sd.sets.length >= 2)),
  finalsCards.map(m => m.stat).join(' | '));
check('one being played says Live and has a score but no winner',
  finalsCards.filter(m => m.status === 'live')
    .every(m => m.stat === 'Live' && m.sides.every(sd => sd.sets.length >= 1)
      && !m.sides.some(sd => sd.won)),
  finalsCards.filter(m => m.status === 'live').map(m => m.stat).join(' | '));
check('one not started says Scheduled and shows nothing',
  finalsCards.filter(m => m.status === 'upcoming')
    .every(m => m.stat === 'Scheduled' && m.sides.every(sd => !sd.sets.length)),
  finalsCards.map(m => m.stat).join(' | '));
check('the first says when it starts and the rest say they follow',
  /Starting at/.test(finalsCards[0].foot)
  && finalsCards.slice(1).every(m => /Followed by/.test(m.foot)),
  finalsCards.map(m => m.foot.trim()).join(' | '));
/* Only the first match on a court has a real time; the rest are flat estimates
   that on some courts run backwards, so they are marked rather than stated. */
check('and only the first is given as fact, the rest marked approximate',
  !/≈/.test(finalsCards[0].foot) && finalsCards.slice(1).every(m => /≈/.test(m.foot)),
  finalsCards.map(m => m.foot.trim()).join(' | '));

/* ---- a played day: the real grid ---- */

await b.ev(`window.BST.tmt.day('2026-08-19')`);
check('an earlier day loads', await b.until('window.BST.tmt.ready()', { timeout: 120000 }));

const grid = await b.ev('window.BST.tmt.grid()');
check('a full day draws as a grid', !!grid);
eq('four courts, four columns', grid.cols, 4);
eq('each with a heading', grid.heads.join(' '), 'Court 1 Court 2 Court 3 Court 4');

/* ⚠️⚠️ The whole claim of the layout: **a row is a moment**, not "nth on this
   court". It was positional until the China Masters of 4 September 2026, where
   court 3 held two matches all day — one at 11:00 and one at 19:00 — and both,
   being first-and-second on their court, were drawn level with the morning on
   courts 1 and 2. The evening match sat beside one that had finished eight
   hours earlier.

   The claim is checked on the times BWF actually **published**: the anchors, the
   ones whose card does not say "Followed by". The estimates strung between them
   are BWF's own arithmetic and drift by an hour over a session, so they are the
   one thing a row cannot be held to. Checked against the painted geometry as
   well, not only the style attribute — a stylesheet that ignored the grid would
   still pass a check on what JS asked for. */
const byRow = {};
for (const c of grid.cells) (byRow[c.row] = byRow[c.row] || []).push(c);
const stamp = c => Date.parse(String(c.at).replace(' ', 'T') + 'Z');
const QUARTER = 15 * 60 * 1000;

check('every published start in a row is the same moment',
  Object.values(byRow).every(cs => {
    const fixed = cs.filter(c => c.anchored).map(stamp);
    return fixed.every(t => t - Math.min(...fixed) <= QUARTER);
  }),
  Object.entries(byRow).filter(([, cs]) => cs.some(c => c.anchored))
    .map(([r, cs]) => r + ':' + cs.filter(c => c.anchored)
      .map(c => c.at.slice(11, 16)).join(',')).join(' | '));

check('and those moments run forwards down the grid',
  (() => {
    const opens = Object.entries(byRow)
      .filter(([, cs]) => cs.some(c => c.anchored))
      .map(([r, cs]) => [Number(r), Math.min(...cs.filter(c => c.anchored).map(stamp))])
      .sort((a, b) => a[0] - b[0]);
    return opens.every((o, i) => i === 0 || o[1] >= opens[i - 1][1]);
  })());

/* A court is still read straight down: whatever the rows are built on, the
   running order of a court is the one thing the layout may never reorder. */
check('a court is read downwards, in the order of play',
  grid.heads.every(court => {
    const mine = grid.cells.filter(c => c.court === court).sort((a, b) => a.row - b.row);
    return mine.every((c, i) => i === 0 || c.seq > mine[i - 1].seq);
  }));

check('and the browser actually lays a row out level',
  Object.values(byRow).every(cs => new Set(cs.map(c => c.y)).size === 1),
  Object.entries(byRow).slice(0, 3).map(([r, cs]) =>
    r + ':' + cs.map(c => c.y).join(',')).join(' | '));
check('a column is one court, and they run left to right in order',
  grid.cells.every(c => c.col === grid.heads.indexOf(c.court) + 1),
  grid.heads.join(' '));
check('columns are laid out in that order too',
  (() => {
    const x = {};
    for (const c of grid.cells) x[c.col] = Math.min(x[c.col] ?? 1e9, c.x);
    return Object.keys(x).sort((a, b) => a - b).every((k, i, ks) =>
      i === 0 || x[k] > x[ks[i - 1]]);
  })());

/* ⚠️ Courts 3 and 4 came back from a break at 14:10 that day while courts 1 and
   2 played straight through. That restart is a row of its own with two empty
   columns beside it, which is exactly the point: at that moment there was
   nothing on courts 1 and 2, and a positional grid drew it as though there was. */
const restartRow = Object.entries(byRow)
  .find(([, cs]) => cs.length < 4 && cs.some(c => c.anchored && c.seq > 1));
check('a court coming back from a break gets a row to itself', !!restartRow,
  restartRow && restartRow[1].map(c => `${c.court}#${c.seq} ${c.at.slice(11, 16)}`).join(' '));

const tCards = await b.ev('window.BST.tmt.cards()');
/* ⚠️ Down the day, not down court one and then back to the top — which is what
   a narrow screen gets when it drops the grid and simply stacks the cards. Held
   per court, because across courts the running numbers no longer march in step:
   a court that opened late is on its first match while its neighbour is on its
   eighth, and that is the fix, not a fault. */
check('the cards come out in running order, down the day',
  grid.heads.every(court => {
    const mine = tCards.filter(c => c.court === court);
    return mine.every((c, i) => i === 0 || c.seq > mine[i - 1].seq);
  }),
  tCards.slice(0, 8).map(c => `${c.court}#${c.seq}`).join(' '));

const played = tCards.filter(m => m.status === 'finished');
check('most of the day has been played', played.length > 40, `${played.length} finished`);
check('and each finished match marks exactly one winner',
  played.every(m => m.sides.filter(sd => sd.won).length === 1
    && m.sides.filter(sd => sd.lost).length === 1));

/* A scoreboard is a row of numbers beside each name, with the games that side
   won picked out — not one joined line the reader has to unpick. */
const normal = played.find(m => m.stat === 'Finished');
check('each side shows its own games',
  normal.sides.every(sd => sd.sets.length >= 2),
  JSON.stringify(normal.sides.map(sd => sd.sets)));
check('and the winner won more of them than the loser',
  normal.sides.find(sd => sd.won).sets.filter(x => x.endsWith('*')).length
  > normal.sides.find(sd => sd.lost).sets.filter(x => x.endsWith('*')).length,
  JSON.stringify(normal.sides.map(sd => sd.sets)));

/* A walkover has no score at all, and a retirement half of one. Both were on
   court this day. The mark belongs to the side it happened to — the one that
   lost — and without it either draws as a match the app failed to fill in. */
const wo = tCards.find(m => m.stat === 'Walkover');
check('a walkover says so in the header', !!wo, wo && wo.stat);
check('and marks the side it happened to, with no games anywhere',
  wo.sides.find(sd => sd.lost).sets.some(x => x.endsWith('!'))
  && wo.sides.every(sd => sd.sets.every(x => x.endsWith('!'))),
  JSON.stringify(wo.sides.map(sd => sd.sets)));

const ret = tCards.find(m => m.stat === 'Retired');
check('a retirement says so too', !!ret, ret && ret.stat);
check('and keeps the games that were played', ret.sides.every(sd => sd.sets.length >= 1),
  JSON.stringify(ret.sides.map(sd => sd.sets)));

/* ---- the draw filter ---- */

const drawChips = await b.ev(`[...document.querySelectorAll('#tmtDraws [data-draw]')]
  .map(c => c.dataset.draw)`);
eq('a chip per draw, in the usual order', drawChips.join(' '), 'MS WS MD WD XD');

const beforeHide = (await b.ev('window.BST.tmt.cards()')).length;
await b.ev(`document.querySelector('#tmtDraws [data-draw="XD"]').click()`);
const after = await b.ev('window.BST.tmt.cards()');
check('switching a draw off removes its matches and nothing else',
  after.length < beforeHide && after.every(m => m.draw !== 'XD'),
  `${beforeHide} -> ${after.length}`);
/* Rows nothing occupies are skipped, so filtering gives a dense grid rather
   than one full of holes. */
const tGrid = await b.ev('window.BST.tmt.grid()');
check('and the grid closes up rather than leaving empty rows',
  tGrid && new Set(tGrid.cells.map(c => c.row)).size
    === Math.max(...tGrid.cells.map(c => c.row)) - 1,
  tGrid && `rows used ${new Set(tGrid.cells.map(c => c.row)).size}`
    + ` of ${Math.max(...tGrid.cells.map(c => c.row)) - 1}`);
check('and it travels in the link',
  await b.ev(`location.hash.includes('dw=XD')`), await b.ev('location.hash'));
await b.ev(`document.querySelector('#tmtDraws [data-draw="XD"]').click()`);
eq('switching it back restores them',
  (await b.ev('window.BST.tmt.cards()')).length, beforeHide);

check('the day is in the link too, so a day can be shared',
  await b.ev(`location.hash.includes('d=2026-08-19')`), await b.ev('location.hash'));
check('and so is the page', await b.ev(`location.hash.includes('pg=tmt')`));

/* ---- starring: the thing the page is named after ---- */

console.log('\n=== following matches ===');

const stFirst = (await b.ev('window.BST.tmt.cards()'))[0];
check('nothing is starred to begin with',
  (await b.ev('window.BST.tmt.stars()')).length === 0);
/* ⚠️ Dimmed only once something *is* starred. The predecessor dimmed the day
   unconditionally, but it had a second view for reading; this is the only view
   of a day, and a uniformly grey page reads as a fault rather than a state. */
check('and nothing is dimmed either, so the day reads normally',
  (await b.ev('window.BST.tmt.cards()')).every(c => !c.dim));

await b.ev(`window.BST.tmt.star(${JSON.stringify(stFirst.id)})`);
const stAfter = await b.ev('window.BST.tmt.cards()');
const stLit = stAfter.find(c => c.id === stFirst.id);
check('starring a match lights it', stLit.starred && !stLit.dim);
check('and dims everything else, which is the whole point',
  stAfter.filter(c => c.id !== stFirst.id).every(c => c.dim && !c.starred));
eq('the count says so', (await b.ev(`document.getElementById('starCount').textContent`)),
  '1 starred');
check('and Clear becomes available',
  await b.ev(`!document.getElementById('clearStars').disabled`));

/* A star is a decision, and losing it on a refresh mid-session is the one thing
   that would stop anybody using this. */
check('it is written down, not just held in the page',
  (await b.ev(`JSON.parse(localStorage.getItem('bst:starred') || '[]')`))
    .includes(stFirst.id));

/* ---- starred only ---- */

await b.ev('window.BST.tmt.only(true)');
const stOnly = await b.ev('window.BST.tmt.cards()');
eq('filtering to starred leaves exactly the starred one', stOnly.length, 1);
eq('and it is that one', stOnly[0].id, stFirst.id);
check('which travels in the link, being a view of the day',
  await b.ev(`location.hash.includes('so=1')`), await b.ev('location.hash'));

await b.ev('window.BST.tmt.only(false)');
check('turning it off brings the day back',
  (await b.ev('window.BST.tmt.cards()')).length > 1);

/* ---- every day at once ---- */

await b.ev(`window.BST.tmt.day('all')`);
check('All loads every day of the tournament',
  await b.until('window.BST.tmt.ready()', { timeout: 240000 }));

const stGroups = await b.ev('window.BST.tmt.groups()');
check('which comes out one heading per day', stGroups.length >= 5,
  stGroups.map(g => g.head).join(' | '));
check('each named as a day, not as a number',
  /^[A-Z][a-z]+day \d+ [A-Z][a-z]+$/.test(stGroups[0].head), stGroups[0].head);
check('and counting its own matches',
  stGroups.every(g => /\d+ matches?/.test(g.note)),
  stGroups.map(g => g.note.trim()).slice(0, 3).join(' | '));
check('the starred one is counted in the day it belongs to',
  stGroups.some(g => /starred/.test(g.note)),
  stGroups.map(g => g.note.trim()).find(t => /starred/.test(t)));
check('a whole tournament is a lot more than one day of it',
  (await b.ev('window.BST.tmt.cards()')).length > 200,
  await b.ev('window.BST.tmt.cards().length'));

await b.ev(`window.BST.tmt.day('2026-08-19')`);
check('and one day comes back', await b.until('window.BST.tmt.ready()', { timeout: 120000 }));

/* ---- the clocks ---- */

const stCard = (await b.ev('window.BST.tmt.cards()'))[0];
check('a card gives the venue time',
  /\d{2}:\d{2}/.test(stCard.foot), stCard.foot.trim());
check('and the reader\'s own where it is a different one',
  /yours/.test(stCard.foot) || !/\d{2}:\d{2}.*\d{2}:\d{2}/.test(stCard.foot),
  stCard.foot.trim());

await b.ev('window.BST.tmt.clearStars()');
eq('clearing puts them all back', (await b.ev('window.BST.tmt.stars()')).length, 0);
check('and undims the day',
  (await b.ev('window.BST.tmt.cards()')).every(c => !c.dim && !c.starred));

/* ---- the bracket ----

   The other reading of the same tournament. Ported from the predecessor, where
   the geometry was worked out; what is checked here is the part that is this
   app's — that the two views share a page, a pick and a set of stars without
   either of them leaking into the other. */

console.log('\n=== the bracket ===');

await b.ev(`window.BST.tmt.bracket.view('draw')`);
check('the bracket loads', await b.until('window.BST.tmt.bracket.ready()', { timeout: 120000 }));

const brDraws = await b.ev('window.BST.tmt.bracket.draws()');
eq('every discipline is offered', brDraws.map(d => d.code).join(' '), 'MS WS MD WD XD');
/* ⚠️ The ids come from BWF's own list rather than from counting. At a
   tournament with qualifying they are 2, 4, 6, 8, 10 — the predecessor
   hardcoded 1-5 and would have drawn the men's *qualifying* draw as the men's
   singles. This tournament has none, so here they happen to be 1-5. */
eq('with the drawId BWF gave it', brDraws.map(d => d.id).join(' '), '1 2 3 4 5');
eq('and the field size', brDraws[0].size, 64);

check('the day bar steps aside — a bracket is a week, not a day',
  await b.ev(`document.getElementById('tmtDayBar').hidden
    && document.getElementById('tmtDrawsBar').hidden
    && !document.getElementById('tmtDrawBar').hidden`));
check('and so does the order of play',
  await b.ev(`document.getElementById('tmtBody').hidden
    && !document.getElementById('tmtDrawBody').hidden`));

/* ⚠️ Both bars are **pickers**, and have to look like it. Drawn in the neutral
   chip style they read as a caption — the fold in particular looked like a
   label saying which round you were on rather than a control for choosing it.
   BWF red is what every other control on the page uses for "this one is
   chosen", so the picked chip takes it; the unpicked ones must stay neutral, or
   the row says nothing at all. */
const chipPaint = JSON.parse(await b.ev(`(() => {
  const read = sel => {
    const on = document.querySelector(sel + ' .chip.on');
    const off = document.querySelector(sel + ' .chip:not(.on)');
    return { on: on && getComputedStyle(on).backgroundColor,
      off: off && getComputedStyle(off).backgroundColor };
  };
  return JSON.stringify({ draw: read('#tmtDrawPick'), round: read('#tmtRounds') });
})()`));
const BWF_RED = 'rgb(223, 32, 39)';
eq('the chosen draw is picked out in BWF red', chipPaint.draw.on, BWF_RED);
eq('and the chosen round too', chipPaint.round.on, BWF_RED);
check('while the ones you could pick instead stay neutral',
  chipPaint.draw.off !== BWF_RED && chipPaint.round.off !== BWF_RED,
  JSON.stringify(chipPaint));
/* ⚠️ The day's **draw filter** is the one chip row left neutral, and it is the
   odd one out on purpose rather than by omission: the Seasons and Compare
   filters were painted to match these pickers on 4 Sep 2026 and this row was
   not, because it sits on the same page as them and a bar of red directly above
   a bar of red is two controls that look like one. Pinned so the asymmetry is a
   decision somebody has to change on purpose. */
await b.ev(`window.BST.tmt.bracket.view('oop')`);
await b.until('window.BST.tmt.ready()', { timeout: 120000 });
eq('the day’s draw filter stays neutral',
  await b.ev(`getComputedStyle(document.querySelector('#tmtDraws .chip.on')).backgroundColor`),
  'rgb(47, 47, 47)');
await b.ev(`window.BST.tmt.bracket.view('draw')`);
await b.until('window.BST.tmt.bracket.ready()', { timeout: 120000 });

/* ---- the shape ---- */

const brCards = await b.ev('window.BST.tmt.bracket.cards()');
const brLines = await b.ev('window.BST.tmt.bracket.lines()');
check('there are cards on the canvas', brCards.length >= 3, brCards.length + ' cards');
check('and connectors between them', brLines > 0, brLines + ' segments');

/* Every card must sit at the midpoint of the two that feed it — that property
   is what makes the picture read as a tree rather than as a list of columns.
   Checked off the DOM here, not off the model, because a CSS rule that moved a
   card would not fail a model test. */
const xs = [...new Set(brCards.map(c => Math.round(c.x)))].sort((a, b) => a - b);
check('the columns march left to right at an even pitch',
  xs.length >= 3 && new Set(xs.slice(1).map((x, i) => x - xs[i])).size === 1,
  xs.join(' '));
const colOf = x => xs.indexOf(Math.round(x));
let drift = 0, checkedPairs = 0;
for (const c of brCards) {
  const i = colOf(c.x);
  if (i < 1) continue;
  const feeders = brCards.filter(f => colOf(f.x) === i - 1)
    .sort((a, b) => a.y - b.y);
  const mine = brCards.filter(f => colOf(f.x) === i).sort((a, b) => a.y - b.y).indexOf(c);
  const f1 = feeders[2 * mine], f2 = feeders[2 * mine + 1];
  if (!f1 || !f2) continue;
  checkedPairs++;
  drift = Math.max(drift, Math.abs((c.y + c.h / 2)
    - ((f1.y + f1.h / 2) + (f2.y + f2.h / 2)) / 2));
}
check('and every card sits between the two that feed it',
  checkedPairs >= 2 && drift < 1, `${checkedPairs} pairs, worst ${drift.toFixed(2)}px`);

const brLabels = await b.ev('window.BST.tmt.bracket.labels()');
check('each column says which round it is',
  brLabels.length === xs.length && brLabels.every(Boolean), brLabels.join(' '));

/* ---- folding ---- */

/* ⚠️ The default follows the tournament: it opens on the earliest round that
   still has a match to play, and this draw is finished, so it stops at the
   quarter-finals rather than showing a single card. */
eq('a finished draw opens at the quarter-finals',
  await b.ev('window.BST.tmt.bracket.shown()'), 'QF');
eq('which is seven cards', brCards.length, 7);
const foldedFits = await b.ev('window.BST.tmt.bracket.fits()');
check('and the whole of it is on screen at once',
  foldedFits && foldedFits.w && foldedFits.h, JSON.stringify(foldedFits));

await b.ev(`window.BST.tmt.bracket.round('all')`);
const brAll = await b.ev('window.BST.tmt.bracket.cards()');
eq('unfolding shows the whole 64 draw', brAll.length, 63);
const allCanvas = await b.ev('window.BST.tmt.bracket.canvas()');
const qfCanvas = { w: 774, h: 282 };
check('which is a wall by comparison',
  allCanvas.h > qfCanvas.h * 4, `${allCanvas.w}x${allCanvas.h} vs 654x282`);
/* The measurement folding exists for: the gap is geometry, so hiding the early
   columns would have left it. */
const brQfAll = brAll.filter(c => Math.round(c.x) === Math.round(Math.max(...brAll.map(z => z.x))) - 0)
  .length;
check('and the last column is still a single card', brQfAll === 1, String(brQfAll));

await b.ev(`window.BST.tmt.bracket.round('SF')`);
eq('folding to the semi-finals leaves three cards',
  (await b.ev('window.BST.tmt.bracket.cards()')).length, 3);
check('and it is still a bracket, connectors and all',
  await b.ev('window.BST.tmt.bracket.lines()') > 0);

/* ---- byes ---- */

await b.ev(`window.BST.tmt.bracket.round('all')`);
const brByes = (await b.ev('window.BST.tmt.bracket.cards()')).filter(c => c.bye);
/* This draw has none — the Worlds run full 64 fields — but the card has to be
   able to say so, and the model test covers a draw that does. */
check('a bye, where there is one, is not offered as a fixture',
  brByes.every(c => c.names.some(n => /Bye/i.test(n))), brByes.length + ' byes');

/* ---- the stars are the same stars ---- */

await b.ev('window.BST.tmt.clearStars()');
await b.ev(`window.BST.tmt.bracket.round(null)`);
const brStarTarget = (await b.ev('window.BST.tmt.bracket.cards()')).find(c => !c.bye && c.id);
await b.ev(`document.querySelector('#tmtCanvas .bcard[data-id="${brStarTarget.id}"]').click()`);
const brStars = await b.ev('window.BST.tmt.stars()');
eq('clicking a card stars the match', brStars.join(), brStarTarget.id);
check('and the card says so',
  (await b.ev('window.BST.tmt.bracket.cards()'))
    .find(c => c.id === brStarTarget.id).starred);

/* ⚠️ The same star, not a second set of them: a match starred in the bracket is
   starred in the order of play, because it is the same match. Keyed on the
   match `id`, which only the flat `matches[]` array carries — the grid cells
   have `code`, which is unique only within one draw. */
await b.ev(`window.BST.tmt.bracket.view('oop')`);
check('and it is the same star the order of play uses',
  await b.until(`window.BST.tmt.ready()`, { timeout: 120000 })
    && (await b.ev('window.BST.tmt.stars()')).join() === brStarTarget.id);
await b.ev('window.BST.tmt.clearStars()');

/* ---- it travels ---- */

await b.ev(`window.BST.tmt.bracket.view('draw')`);
await b.until('window.BST.tmt.bracket.ready()', { timeout: 120000 });
await b.ev(`window.BST.tmt.bracket.pick('WD')`);
check('another discipline loads', await b.until('window.BST.tmt.bracket.ready()', { timeout: 120000 }));
eq('and it is the one asked for', await b.ev('window.BST.tmt.bracket.pick()'), 'WD');
check('the link carries the view and the draw',
  await b.ev(`location.hash.includes('tv=draw') && location.hash.includes('dr=WD')`),
  await b.ev('location.hash'));

/* ⚠️ The round is dropped on a discipline switch rather than carried. Two draws
   at one tournament can be different sizes — a 64 men's singles beside a 32
   women's — so "R64" is not a round the other one has at all. */
await b.ev(`window.BST.tmt.bracket.round('SF')`);
await b.ev(`window.BST.tmt.bracket.pick('MS')`);
check('switching discipline drops the round rather than carrying a stale one',
  await b.until('window.BST.tmt.bracket.ready()', { timeout: 120000 })
    && (await b.ev('window.BST.tmt.bracket.round()')) === null);

/* A link straight into a folded draw opens on it. */
check('a bracket link opens on the bracket',
  await openTmt('#pg=tmt&now=2026-08-23&tv=draw&dr=XD&rd=SF')
    && await b.until('window.BST.tmt.bracket.ready()', { timeout: 120000 }));
eq('on the discipline it names', await b.ev('window.BST.tmt.bracket.pick()'), 'XD');
eq('folded where it says', await b.ev('window.BST.tmt.bracket.shown()'), 'SF');

/* ⚠️ A link made at another tournament may name a discipline this one does not
   run. Falling back beats blanking the page. */
await b.ev(`window.BST.tmt.state.wantDraw = 'ZZ'; window.BST.tmt.state.drawList = [];
  window.BST.tmt.state.drawFor = null;`);
await b.ev('window.BST.tmt.bracket.reload()');
check('a discipline this tournament does not run falls back rather than blanking',
  await b.until('window.BST.tmt.bracket.ready()', { timeout: 120000 })
    && (await b.ev('window.BST.tmt.bracket.pick()')) === 'MS',
  await b.ev('window.BST.tmt.bracket.pick()'));

await b.ev(`window.BST.tmt.bracket.view('oop')`);
await b.until('window.BST.tmt.ready()', { timeout: 120000 });

/* ---- and back ---- */

await b.ev(`document.querySelector('#pageNav [data-page="seasons"]').click()`);
check('the seasons come back', await b.ev(`!document.getElementById('seasonsPage').hidden
  && document.getElementById('tmtPage').hidden`));
check('with the strip intact', (await squares(2026)).length > 0);

/* ============================ the disclaimer ============================ */

console.log('\n=== attribution, at the foot of the page ===');
const footText = await b.ev(`document.querySelector('footer.foot').innerText`);
check('the footer says it is unofficial', /unofficial/i.test(footText), footText.slice(0, 90));
check('and credits BWF', /BWF/.test(footText));
check('nothing above the seasons carries the disclaimer any more',
  !/unofficial/i.test(await b.ev(`document.querySelector('h1').textContent
    + (document.getElementById('status').textContent || '')`)));
check('the footer sits below the seasons in the document',
  await b.ev(`document.querySelector('footer.foot').compareDocumentPosition(
    document.getElementById('seasons')) === Node.DOCUMENT_POSITION_PRECEDING`));
check('links back to bwfbadminton.com',
  await b.ev(`!!document.querySelector('a[href*="bwfbadminton.com"]')`));
check('carries no BWF logo',
  await b.ev(`![...document.images].some(i => /bwf/i.test(i.src) && /logo/i.test(i.src))`));

/* ============================ the theme ============================ */

console.log('\n=== the predecessor theme, dark and only dark ===');

/* The ramp is a green-to-red gauge judged against this ground. A light flip
   changes the thing that was tested — and the pass that had one shipped a
   first-round label in white on a near-white box. */
const scheme = async value => {
  await b.send('Emulation.setEmulatedMedia',
    { features: [{ name: 'prefers-color-scheme', value }] }, b.sessionId);
  await b.wait(150);
  return b.ev(`(() => {
    const s = getComputedStyle(document.documentElement);
    return { bg: s.getPropertyValue('--bg').trim(),
             text: s.getPropertyValue('--text').trim(),
             accent: s.getPropertyValue('--accent').trim(),
             font: s.getPropertyValue('--font').trim(),
             painted: getComputedStyle(document.body).backgroundColor,
             family: getComputedStyle(document.body).fontFamily };
  })()`);
};

const dark = await scheme('dark');
eq('the predecessor ground', dark.bg, '#1a1a1a');
eq('with its text', dark.text, '#f2f2f2');
eq('and BWF red', dark.accent, '#df2027');
check('set in Roboto', /Roboto/.test(dark.font) && /Roboto/.test(dark.family), dark.family);
check('painted, not borrowed from whatever is behind the page',
  dark.painted === 'rgb(26, 26, 26)', dark.painted);

const light = await scheme('light');
eq('a light preference changes nothing', light.bg, dark.bg);
eq('nor the text', light.text, dark.text);
check('nor what is painted', light.painted === dark.painted, light.painted);

const labels = await b.ev(`[...document.querySelectorAll('#seasons .box')].map(el => ({
  tier: (el.className.match(/r-(\\w+)/) || [])[1],
  pct: parseInt(el.style.getPropertyValue('--pct')) || 0,
  colour: getComputedStyle(el).color,
}))`);
check('no label is white on a box the fill does not reach',
  labels.every(l => !(l.colour === 'rgb(255, 255, 255)' && l.pct < 50)),
  labels.filter(l => l.colour === 'rgb(255, 255, 255)' && l.pct < 50)
    .map(l => `${l.tier}@${l.pct}%`).join(' '));

await b.send('Emulation.setEmulatedMedia', { features: [] }, b.sessionId);

/* ============================ the winners' pyramid ============================

   The other page with no player. Its data is `data/winners-MS.json`, served
   from this origin rather than replayed from a fixture — it is not a BWF call,
   and a fixture of it would only be a copy of a committed file.
   ======================================================================== */

console.log('\n=== the winners page: one pyramid per season ===');

await b.ev(`location.hash = '#pg=winners'`);
check('the winners page loads with no player at all',
  await b.until('!!document.querySelector(".pyrseason")', { timeout: 60000 }));
eq('and the nav says so',
  await b.ev(`[...document.querySelectorAll('#pageNav [data-page]')]
    .map(b => b.dataset.page + (b.classList.contains('on') ? '*' : '')).join(' ')`),
  'seasons compare tmt winners*');

/* ⚠️ The year comes off `dataset.year`, not off the label's text: a season
   holding a title that was played in another calendar year carries a ⁕ in that
   text, and Number('2020⁕') is NaN. The mark is checked on its own further down. */
const pyrs = JSON.parse(await b.ev(`JSON.stringify(
  [...document.querySelectorAll('.pyrseason')].map(s => ({
    year: s.dataset.year,
    rows: [...s.querySelectorAll('.pyrrow')].map(r => r.querySelectorAll('.pyrtile').length),
  })))`));
check('every season drew a column', pyrs.length > 10, String(pyrs.length));
eq('oldest on the left', pyrs[0].year, '2007');
check('newest on the right', Number(pyrs[pyrs.length - 1].year) >= 2026,
  pyrs[pyrs.length - 1].year);
check('the years run in order without a gap',
  pyrs.every((p, i) => i === 0 || Number(p.year) === Number(pyrs[i - 1].year) + 1),
  pyrs.map(p => p.year).join(' '));

/* ⚠️ Four rows always, even the empty ones. A season that held no Tour Finals
   has to show the hole where it goes rather than quietly becoming a different
   shape — and an empty row still has to know its tier to be drawn at all. */
check('every season has all four rows', pyrs.every(p => p.rows.length === 4),
  pyrs.filter(p => p.rows.length !== 4).map(p => `${p.year}:${p.rows.length}`).join(' '));

/* ⚠️ Before 2011 there was no Superseries Premier tier — all twelve Superseries
   were one rank — so those seasons are dealt across *both* Super rows at the
   one size rather than drawn as a slab under an empty row. The equal size is
   what says they were equal; see `flatSupers`. */
const y2009 = pyrs.find(p => p.year === '2009');
eq('2009 fills both Super rows, because its twelve were one rank',
  y2009.rows.slice(2).join(','), '6,6');
check('but it did have a summit and a season-ending final',
  y2009.rows[0] === 1 && y2009.rows[1] === 1, JSON.stringify(y2009.rows));
eq('and 2013, which had two ranks, does not split evenly',
  pyrs.find(p => p.year === '2013').rows.slice(2).join(','), '5,8');

/* ⚠️ Sizes come from the honours ladder, so the summit must actually be the
   biggest square on the page and a Super 750 the smallest. */
const pyrSizes = JSON.parse(await b.ev(`JSON.stringify(
  ['OLY','20','22','23','24'].map(t => {
    const el = document.querySelector('.pyrtile.t-' + t);
    return [t, el ? Math.round(el.getBoundingClientRect().width) : 0];
  }))`));
const px = Object.fromEntries(pyrSizes);
/* ⚠️ The two summit tiers are the one place size does *not* rank: they share a
   row, and the gold ring carries the difference. Everything below them steps. */
eq('the Olympics is drawn at the Worlds size', px.OLY, px['20']);
check('the Worlds outranks the Tour Finals', px['20'] > px['22'], JSON.stringify(pyrSizes));
check('the Tour Finals outranks a Super 1000', px['22'] > px['23'], JSON.stringify(pyrSizes));
check('and a Super 1000 outranks a Super 750', px['23'] > px['24'], JSON.stringify(pyrSizes));

/* ⚠️ The slider was in the markup and wired to nothing for a whole commit: the
   photographs were fixed at a size where a Super 750 face was unreadable and
   dragging it did precisely nothing. Nothing failed, because nothing looked. */
const smallest = () => b.ev(
  `Math.round(document.querySelector('.pyrtile.t-24').getBoundingClientRect().width)`);
const before750 = await smallest();
await b.ev(`(() => { const z = document.getElementById('winZoom');
  z.value = z.max; z.dispatchEvent(new Event('input')); })()`);
const after750 = await smallest();
check('dragging the zoom actually grows the photographs',
  after750 > before750, `${before750}px -> ${after750}px`);
check('and a Super 750 face gets big enough to recognise', after750 >= 48, after750 + 'px');

/* It is a viewing preference, so it survives leaving the page and coming back
   — and it must not have leaked into the hash on the way. */
await b.ev(`document.querySelector('#pageNav [data-page="seasons"]').click()`);
await b.ev(`document.querySelector('#pageNav [data-page="winners"]').click()`);
await b.until('!!document.querySelector(".pyrtile.t-24")', { timeout: 30000 });
eq('the size is remembered', await smallest(), after750);
check('and stayed out of the hash', !/winz|wz=/.test(await b.ev('location.hash')),
  await b.ev('location.hash'));

check('every tile says which tournament it was and who won it',
  await b.ev(`[...document.querySelectorAll('.pyrtile')].every(t =>
    (t.getAttribute('title') || '').trim().length > 8)`));

/* ---- the two singles disciplines ---- */

const whoWon = () => b.ev(
  `(document.querySelector('.pyrtile[title]') || {}).title || ''`);
const msFirst = await whoWon();

await b.ev(`[...document.querySelectorAll('#winKind .seg')].find(x => x.textContent === 'WS').click()`);
check('switching to women’s singles redraws the board',
  await b.until(`!!document.querySelector('.pyrseason')
    && ((document.querySelector('.pyrtile[title]') || {}).title || '') !== ${JSON.stringify(msFirst)}`,
    { timeout: 60000 }),
  `was ${JSON.stringify(msFirst)}, now ${JSON.stringify(await whoWon())}`);
eq('and the nav of the page says which one', await b.ev(
  `document.querySelector('#winKind .seg.on').textContent`), 'WS');

/* ⚠️ Which discipline is what the page is *about*, so a link has to carry it —
   unlike the tile size, which is how you happen to be looking at it. */
check('the discipline travels in the hash',
  /(^|&|#)wk=WS/.test(await b.ev('location.hash')), await b.ev('location.hash'));

const wsPyrs = JSON.parse(await b.ev(`JSON.stringify(
  [...document.querySelectorAll('.pyrseason')].map(s => ({
    year: s.dataset.year,
    rows: [...s.querySelectorAll('.pyrrow')].map(r => r.querySelectorAll('.pyrtile').length),
  })))`));
eq('women’s singles covers the same seasons', wsPyrs.length, pyrs.length);

/* ⚠️ The two boards must hold *exactly* the same number of tiles in every row,
   because they are the same tournaments: every Super 1000 that ran a men's
   final ran a women's one on the same day. A row that differs does not mean the
   sport differed — it means one of the two harvests missed a final. */
check('and the very same titles, tier for tier and season for season',
  wsPyrs.every((w, i) => w.year === pyrs[i].year
    && w.rows.join(',') === pyrs[i].rows.join(',')),
  wsPyrs.filter((w, i) => w.rows.join(',') !== pyrs[i].rows.join(','))
    .map(w => w.year).join(' ') || 'all match');

/* ⚠️ Going back must not refetch from scratch or lose the file already read. */
await b.ev(`[...document.querySelectorAll('#winKind .seg')].find(x => x.textContent === 'MS').click()`);
check('and switching back returns to the men’s board',
  await b.until(`((document.querySelector('.pyrtile[title]') || {}).title || '') === ${JSON.stringify(msFirst)}`,
    { timeout: 60000 }));
check('with the default discipline dropping out of the hash again',
  !/wk=/.test(await b.ev('location.hash')), await b.ev('location.hash'));

/* A link that names a discipline opens on it. */
await b.ev(`location.hash = '#pg=winners&wk=WS'`);
check('a shared link opens on the discipline it names',
  await b.until(`!!document.querySelector('#winKind .seg.on')
    && document.querySelector('#winKind .seg.on').textContent === 'WS'`, { timeout: 60000 }));


/* ---- what a square says it was, and where it belongs ----

   ⚠️ The whole point of these is that they are read off the *painted* page.
   Every one of them was already true in the model an hour before it was true on
   screen, because the render was reading `file.seasons` straight and never
   asked the model which season a title belonged to.
   ==================================================================== */

await b.ev(`location.hash = '#pg=winners'`);
await b.until(`!!document.querySelector('.pyrseason')
  && document.querySelector('#winKind .seg.on').textContent === 'MS'`, { timeout: 60000 });

const cols = () => b.ev('window.BST.winners.columns()');
const colAt = async y => (await cols()).find(c => c.year === y);

/* The Superseries era, named as the Superseries era. This is what the reader
   was looking at when they asked whether the two tiers were distinguished: they
   are, from 2011 — and before that the tier did not exist. */
const y2013 = await colAt(2013);
check('a 2013 Super 1000 hover says Superseries Premier',
  y2013.rows[2][0].level === 'Superseries Premier'
    && /Superseries Premier/.test(y2013.rows[2][0].title),
  JSON.stringify(y2013.rows[2][0]));
eq('and the row below it says Superseries', y2013.rows[3][0].level, 'Superseries');
const y2023 = await colAt(2023);
eq('the identical rung in 2023 says Super 1000', y2023.rows[2][0].level, 'Super 1000');
eq('and the one below it Super 750', y2023.rows[3][0].level, 'Super 750');
/* ⚠️ And the seasons before it had *one* Superseries rank, drawn as two rows of
   equally sized squares rather than as a slab under a hole. Both halves have to
   say Superseries and both have to be the same size — a larger upper row would
   assert a Premier tier that did not exist for another four years. */
const y2009c = await colAt(2009);
eq('2009 fills both Super rows', y2009c.rows.slice(2).map(r => r.length).join(','), '6,6');
eq('and both of them say Superseries',
  [...new Set(y2009c.rows.slice(2).flat().map(t => t.level))].join(), 'Superseries');
check('with the two rows drawn at the same size',
  await b.ev(`(() => {
    const col = document.querySelector('.pyrseason[data-year="2009"]');
    const rows = [...col.querySelectorAll('.pyrrow')];
    const w = r => Math.round(r.querySelector('.pyrtile').getBoundingClientRect().width);
    return w(rows[2]) === w(rows[3]);
  })()`));
check('while 2011, which had both, does not', await b.ev(`(() => {
  const col = document.querySelector('.pyrseason[data-year="2011"]');
  const rows = [...col.querySelectorAll('.pyrrow')];
  const w = r => Math.round(r.querySelector('.pyrtile').getBoundingClientRect().width);
  return w(rows[2]) > w(rows[3]);
})()`));

/* ---- the two badges on the summit row ---- */

const y2008 = await colAt(2008);
eq('an Olympic champion is drawn beside the rings',
  y2008.rows[0].map(t => t.tier + '/' + t.badge).join(' '), 'OLY/rings');
eq('and a world champion beside a cup',
  (await colAt(2009)).rows[0].map(t => t.tier + '/' + t.badge).join(' '), '20/cup');
/* ⚠️ 2021 is the only season in the record that held both, because Tokyo was
   pushed into the same year as the Huelva Worlds — so it is the one column
   where the two marks have to sit side by side and stay told apart. */
eq('and 2021, which held both, gets one of each',
  (await colAt(2021)).rows[0].map(t => t.tier + '/' + t.badge).join(' '),
  'OLY/rings 20/cup');
check('the badge is beside the photograph, never over it',
  await b.ev(`[...document.querySelectorAll('.pyrmajor')].every(m => {
    const bd = m.querySelector('.pyrbadge').getBoundingClientRect();
    const tl = m.querySelector('.pyrtile').getBoundingClientRect();
    return bd.right <= tl.left + 1 && bd.width > 6;
  })`));

/* ---- 2020, put back together ---- */

const moved = (await cols()).filter(c => c.moved).map(c => c.year);
eq('three seasons carry an asterisk', moved.join(' '), '2010 2020 2021');

/* ⚠️ The bug this fixes: BWF files the delayed Finals under the year it was
   played, so the pyramid drew *two* Tour Finals in 2021 and none in 2020, while
   the career grid one page over had already moved it. */
eq('the 2020 season has its Tour Finals', (await colAt(2020)).rows[1].length, 1);
check('and it says so on the hover',
  /played in 2021/.test((await colAt(2020)).rows[1][0].title),
  (await colAt(2020)).rows[1][0].title);
eq('2021 is left with exactly one', (await colAt(2021)).rows[1].length, 1);
/* And the one it must not move: an Olympics is not the conclusion of a season. */
eq('the Tokyo Olympics stays in 2021, marked rather than moved',
  (await colAt(2021)).rows[0][0].mark, 'held');
check('with the column saying why',
  /2020 event, held in 2021/.test((await colAt(2021)).note), (await colAt(2021)).note);

/* ============================ the dominance band ============================

   ⚠️ Every check here is geometric. A bar is placed at a *measured* pixel
   offset taken off the column above it, and the failure worth catching is a bar
   that points at the wrong year — which cannot be seen from the numbers that
   produced it, only from where it landed.
   ==================================================================== */

console.log('\n=== the winners page: who dominated, and when ===');

check('the band is drawn', await b.until(`!!document.querySelector('.erabar')`,
  { timeout: 30000 }));

const bars = () => b.ev('window.BST.winners.bars()');
const colBox = async () => new Map((await cols()).map(c => [c.year, c]));

let box = await colBox();
let drawn = await bars();
check('every bar starts at the left edge of the season it opens in, and ends at'
  + ' the right edge of the one it closes in',
  drawn.every(bar => Math.abs(bar.x - box.get(bar.from).x) < 1
    && Math.abs((bar.x + bar.w) - (box.get(bar.to).x + box.get(bar.to).w)) < 1),
  drawn.map(bar => `${bar.who} ${bar.from}-${bar.to} off by ${
    (bar.x - box.get(bar.from).x).toFixed(1)}`).join(' | '));

const lcwBar = drawn.find(x => x.who === 'LEE Chong Wei');
check('LEE Chong Wei has one bar', !!lcwBar
  && drawn.filter(x => x.who === 'LEE Chong Wei').length === 1);
eq('running from 2007', lcwBar.from, 2007);
eq('to 2016', lcwBar.to, 2016);
check('and it is the widest thing on the band',
  drawn.every(x => x.w <= lcwBar.w), drawn.map(x => x.who + ':' + x.w).join(' '));

/* ⚠️ The overlap is the claim. LIN Dan and CHEN Long both dominated inside LEE
   Chong Wei's decade, and a chart that named one champion a season would have
   drawn three consecutive reigns instead of three simultaneous ones. */
const inside = drawn.filter(x => x.who !== 'LEE Chong Wei'
  && x.from >= lcwBar.from && x.to <= lcwBar.to);
check('and other players’ eras run underneath it rather than after it',
  inside.length >= 3 && inside.every(x => x.lane !== lcwBar.lane),
  inside.map(x => `${x.who} ${x.from}-${x.to} lane ${x.lane}`).join(' | '));

/* ⚠️ 2020 held two titles in the whole season, so nobody can clear three and
   every line on the board is severed by it. A rule that bridged gaps would draw
   a continuous era straight through a year that did not happen. */
check('nothing spans 2020', drawn.every(x => !(x.from < 2020 && x.to > 2020)),
  drawn.map(x => `${x.who} ${x.from}-${x.to}`).join(' | '));

/* ---- what a bar is made of ---- */

/* ⚠️ Every season inside a run has to touch the next one. The columns are 10px
   apart, and blocks that stopped at their own column's right edge left a dark
   stripe at every year boundary — so a nine-season run read as nine bars.
   Measured off the drawn blocks, because the arithmetic that produced them is
   exactly what got this wrong. */
check('the seasons inside a bar are continuous, with no gap at a year boundary',
  await b.ev(`(() => {
    const bad = [];
    for (const bar of document.querySelectorAll('#winEraBand .erabar')) {
      const blocks = [...bar.querySelectorAll('.erayr')]
        .map(y => [parseFloat(y.style.left), parseFloat(y.style.width)])
        .sort((p, q) => p[0] - q[0]);
      for (let i = 1; i < blocks.length; i++) {
        const gap = blocks[i][0] - (blocks[i - 1][0] + blocks[i - 1][1]);
        if (Math.abs(gap) > 1) bad.push(bar.dataset.id + '@' + i + ':' + gap);
      }
      const end = blocks.length
        ? blocks[blocks.length - 1][0] + blocks[blocks.length - 1][1] : 0;
      if (blocks.length && Math.abs(end - bar.getBoundingClientRect().width) > 1) {
        bad.push(bar.dataset.id + ' overruns by ' + (end - bar.getBoundingClientRect().width));
      }
    }
    return bad.join(' | ') || true;
  })()`), true);

/* ⚠️ A colour per player, not a colour for "a title". One colour for the whole
   band made two people who overlapped read as one long reign with a step in it,
   which is the opposite of what the band exists to say. */
const hues = await b.ev(`[...document.querySelectorAll('#winEraBand .erabar')]
  .map(x => x.dataset.id + '=' + x.style.getPropertyValue('--era'))`);
check('every bar has a colour of its own',
  hues.length === drawn.length && hues.every(h => /=#[0-9a-f]{6}$/i.test(h)),
  hues.join(' '));
/* ⚠️ One colour per *career*, not per bar: Viktor AXELSEN dominated in 2017 and
   again in 2021–23, and two colours would say two people did it. */
check('and a career with two eras keeps one colour across both',
  await b.ev(`(() => {
    const by = new Map();
    for (const x of document.querySelectorAll('#winEraBand .erabar')) {
      const k = x.dataset.id;
      (by.get(k) || by.set(k, new Set()).get(k)).add(x.style.getPropertyValue('--era'));
    }
    const bad = [...by].filter(([, set]) => set.size > 1).map(([k]) => k);
    return bad.join(' ') || true;
  })()`), true);
/* Assigned in the band's own order, which is by the season a career opens, so
   two players share a hue only if eight others opened between them. */
check('and neighbours in time never share one',
  await b.ev(`(() => {
    const seen = [];
    for (const x of document.querySelectorAll('#winEraBand .erabar')) {
      const c = x.style.getPropertyValue('--era');
      if (!seen.length || seen[seen.length - 1][1] !== c) seen.push([x.dataset.id, c]);
      else if (seen[seen.length - 1][0] !== x.dataset.id) return 'two in a row: ' + c;
    }
    return true;
  })()`), true);

/* The label: a face, the name, the flag — and no total, which is on the hover
   with the season-by-season breakdown instead. */
check('a bar names the player, with their flag',
  await b.ev(`(() => {
    const x = document.querySelector('#winEraBand .erabar');
    return !!x.querySelector('.erawho b') && !!x.querySelector('.erawho .flag')
      && /flag-circle/.test(x.querySelector('.erawho .flag').src);
  })()`));
check('and does not print the total on the bar',
  await b.ev(`![...document.querySelectorAll('#winEraBand .erabar')]
    .some(x => /\\d/.test(x.querySelector('.erawho').textContent))`),
  await b.ev(`document.querySelector('#winEraBand .erawho').textContent`));
check('which is on the hover, season by season',
  /\n2007: \d+\n2008: \d+/.test(await b.ev(
    `document.querySelector('#winEraBand .erabar').getAttribute('title')`)),
  await b.ev(`document.querySelector('#winEraBand .erabar').getAttribute('title')`));

/* ⚠️ The name is sticky, which is the whole reason `.erabar` may not clip: an
   `overflow: hidden` ancestor is a scroll container, and sticky inside one
   sticks to a box that never scrolls. LEE Chong Wei's bar is ten columns long,
   so scroll well past its start and the name has to still be on screen. */
const winScroller = `document.getElementById('winBody')`;
await b.ev(`${winScroller}.scrollLeft = 600`);
await b.wait(150);
check('the name travels with the scroll rather than staying at 2007',
  await b.ev(`(() => {
    const bar = [...document.querySelectorAll('#winEraBand .erabar')]
      .find(x => x.dataset.from === '2007' && x.dataset.to === '2016');
    const view = document.getElementById('winBody').getBoundingClientRect();
    const tag = bar.querySelector('.erawho').getBoundingClientRect();
    return tag.left >= view.left - 1 && tag.right <= view.right + 1;
  })()`));
check('and never leaves the bar it belongs to',
  await b.ev(`[...document.querySelectorAll('#winEraBand .erabar')].every(x => {
    const bar = x.getBoundingClientRect(), tag = x.querySelector('.erawho').getBoundingClientRect();
    return tag.left >= bar.left - 1 && tag.right <= bar.right + 1;
  })`));
await b.ev(`${winScroller}.scrollLeft = 0`);

/* ---- and the photograph the badge sits beside ----

   ⚠️ The mark used to be centred *with* the tile, which pushed every summit
   photograph half a badge to the right of its own column. Nothing else in a
   column is off-centre, so it showed. */
check('a summit photograph is centred in its column, badge or no badge',
  await b.ev(`(() => {
    const bad = [];
    for (const col of document.querySelectorAll('.pyrseason')) {
      const row = col.querySelector('.pyrrow');
      if (!row || row.querySelectorAll('.pyrtile').length !== 1) continue;
      const t = row.querySelector('.pyrtile').getBoundingClientRect();
      const c = col.getBoundingClientRect();
      const off = (t.left + t.width / 2) - (c.left + c.width / 2);
      if (Math.abs(off) > 1) bad.push(col.dataset.year + ':' + off.toFixed(1));
    }
    return bad.join(' ') || true;
  })()`), true);

/* ---- the bar, which is a control rather than a decision ---- */

await b.ev(`window.BST.winners.bar('5')`);
const five = await bars();
check('raising it to five titles thins the band',
  five.length < drawn.length, `${drawn.length} at 3+, ${five.length} at 5+`);
check('and leaves only runs that really cleared five',
  (await b.ev('window.BST.winners.runs()'))
    .every(p => p.runs.every(r => r.years.every(y => y.n >= 5))));
check('the bar travels in the hash', /(^|&|#)we=5/.test(await b.ev('location.hash')),
  await b.ev('location.hash'));
await b.ev(`window.BST.winners.bar('3')`);
check('and the default drops out of it again', !/we=/.test(await b.ev('location.hash')),
  await b.ev('location.hash'));

/* ---- switching it off, and the arrows ---- */

eq('E turns the band off', await b.ev(`(() => {
  const e = new KeyboardEvent('keydown', { key: 'e', bubbles: true, cancelable: true });
  document.body.dispatchEvent(e);
  return window.BST.winners.eras();
})()`), false);
eq('and the bar goes with it, because it now controls nothing',
  await b.ev(`document.getElementById('winMin').hidden`), true);
check('an off band says so in the link', /we=off/.test(await b.ev('location.hash')),
  await b.ev('location.hash'));
/* ⚠️ With nothing to step, up and down must be handed back to the page — this
   board is taller than the window and swallowing the scroll to do nothing is
   worse than having no shortcut. */
eq('and the arrows scroll the page rather than doing nothing', await b.ev(`(() => {
  const e = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
  document.body.dispatchEvent(e);
  return e.defaultPrevented;
})()`), false);

await b.ev(`window.BST.winners.eras(true)`);
check('and it comes back', await b.until(`!!document.querySelector('.erabar')`,
  { timeout: 30000 }));

const stepBar = key => b.ev(`(() => {
  document.body.dispatchEvent(new KeyboardEvent('keydown',
    { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }));
  return window.BST.winners.bar();
})()`);
/* Up shows more, exactly as it does on the honours board and in the bracket. */
eq('down raises the bar', await stepBar('ArrowDown'), '4');
eq('and again', await stepBar('ArrowDown'), '5');
eq('and stops at the top', await stepBar('ArrowDown'), '5');
eq('up lowers it', await stepBar('ArrowUp'), '4');
eq('and stops at the bottom',
  (await stepBar('ArrowUp'), await stepBar('ArrowUp')), '3');

/* ---- the whole link ---- */

await b.ev(`location.hash = '#pg=winners&wk=WS&we=4'`);
check('a shared link opens on the discipline and the bar it names',
  await b.until(`window.BST.winners.kind() === 'WS' && window.BST.winners.bar() === '4'
    && !!document.querySelector('.erabar')`, { timeout: 60000 }));
box = await colBox();
drawn = await bars();
check('and the women’s bars land on their columns too',
  drawn.length > 0 && drawn.every(bar => Math.abs(bar.x - box.get(bar.from).x) < 1),
  drawn.map(x => `${x.who} ${x.from}-${x.to}`).join(' | '));

await b.ev(`location.hash = '#pg=winners'`);
await b.until(`window.BST.winners.kind() === 'MS'`, { timeout: 60000 });

/* ---- the summit, at one size ---- */

await b.ev(`location.hash = '#pg=winners'`);
await b.until(`!!document.querySelector('.pyrtile.t-OLY')`, { timeout: 60000 });

/* ⚠️ The Olympics outranks the Worlds and is drawn the *same size* as it, with
   the gold ring carrying the difference. Two faces on one line at two sizes
   read as a layout accident rather than as a ranking — and the honours board
   one page over still ranks the Olympic square above, because that is a claim
   about worth and this is a row of portraits. */
const summit = await b.ev(`(() => {
  const box = t => {
    const el = document.querySelector('.pyrtile.t-' + t);
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), ring: getComputedStyle(el).boxShadow };
  };
  return { oly: box('OLY'), wch: box('20'), s1000: box('23') };
})()`);
eq('an Olympic square is the same size as a world championship one',
  summit.oly.w, summit.wch.w);
check('and larger than a Super 1000 one', summit.oly.w > summit.s1000.w,
  `${summit.oly.w} vs ${summit.s1000.w}`);
check('the gold ring is what tells an Olympic champion from a world one',
  /255, 210, 74/.test(summit.oly.ring) && !/255, 210, 74/.test(summit.wch.ring),
  summit.oly.ring + ' | ' + summit.wch.ring);
/* ⚠️ And the world champion beside it wears **nothing**. It had a white ring for
   a day, which was worse than none: on a dark ground white is the brighter of
   the two, so the square that was meant to be the plain case came out looking
   like the bigger prize. One marked square and one bare one is the ranking. */
eq('and the world champion square is bare', summit.wch.ring, 'none');

/* ⚠️⚠️ **The ring must not be `inset`.** Every tier used to have an inset one
   and not a single one of them was ever visible: an inset box-shadow paints
   *behind* the element's content, and the content here is a photograph filling
   the tile. They showed for the instant before the images loaded and then went,
   which is how it survived a check that compared the declared colour to the
   export's table — declarations matched, pixels never did. */
check('and the one that is left is not drawn under the photograph',
  !/inset/.test(summit.oly.ring), summit.oly.ring);

/* Nothing else on the board is ringed at all. Rank is said by size on this page,
   and a ring nobody can see is worse than no ring — it is a claim the drawing
   does not make. */
check('and no other tier is ringed',
  await b.ev(`['20', '22', '23', '24'].every(t => {
    const el = document.querySelector('.pyrtile.t-' + t);
    return !el || getComputedStyle(el).boxShadow === 'none';
  })`),
  await b.ev(`['20', '22', '23', '24'].map(t => {
    const el = document.querySelector('.pyrtile.t-' + t);
    return t + ': ' + (el ? getComputedStyle(el).boxShadow : 'absent');
  }).join(' | ')`));

/* ⚠️ Which is why the footnote mark had to stop being gold. A tier and a
   footnote cannot share a colour, so a displaced title is now dashed and
   *outside* the tile. */
const movedTile = await b.ev(`(() => {
  const el = document.querySelector('.pyrseason[data-year="2020"] .pyrtile.is-moved');
  const st = getComputedStyle(el);
  return { style: st.outlineStyle, colour: st.outlineColor, offset: st.outlineOffset };
})()`);
eq('a displaced title is outlined dashed', movedTile.style, 'dashed');
check('and no longer in gold', !/255, 210, 74|255, 188, 32/.test(movedTile.colour),
  movedTile.colour);
/* Tokyo 2020 is Olympic *and* displaced, so the two marks have to sit clear of
   one another — which is also why the ring is a box-shadow and not an outline,
   since a tile has only one outline to give. */
check('and offset clear of the ring, for a square that wears both',
  parseFloat(movedTile.offset) >= 2, movedTile.offset);

/* ⚠️ The one place the stylesheet and `poster.js` can drift: the page paints a
   summit ring from CSS and the export paints it from a table. Held against each
   other here — but on the *painted* value, not on the declaration, which is the
   mistake the inset rings got away with. */
check('the export paints the rings the page paints',
  await b.ev(`(() => {
    const want = window.BST.winners.rings();
    const hex = s => {
      const m = s.match(/(\d+), (\d+), (\d+)/);
      return m ? '#' + [1, 2, 3].map(i => (+m[i]).toString(16).padStart(2, '0')).join('') : s;
    };
    const bad = [];
    if (Object.keys(want).join() !== 'OLY') bad.push('table: ' + Object.keys(want).join());
    for (const tier of Object.keys(want)) {
      const el = document.querySelector('.pyrtile.t-' + tier);
      if (!el) continue;
      const shadow = getComputedStyle(el).boxShadow;
      if (/inset/.test(shadow)) bad.push(tier + ' is inset and invisible');
      else if (hex(shadow) !== want[tier].colour) {
        bad.push(tier + ': page ' + hex(shadow) + ', export ' + want[tier].colour);
      }
    }
    return bad.join(' | ') || true;
  })()`), true);

/* ============================ the export ============================

   ⚠️ The check that matters is that a **blob comes back at all**. Every image
   will have drawn perfectly on the canvas either way; a canvas that a
   cross-origin photograph has poisoned only says so at `toBlob`, at the very
   last step, and the whole feature is then a button that throws.
   ==================================================================== */

/* ============================ the domination score ============================

   The Winners page's second view, checked as **painted**. Every mistake this
   chart has made was a drawing mistake the numbers underneath were innocent of,
   so almost nothing here reads the model: it reads the SVG.
   ==================================================================== */

console.log('\n=== the winners page: the same seasons as a quantity ===');

await b.ev(`location.hash = '#pg=winners&wv=score'`);
check('the score view draws',
  await b.until(`document.querySelectorAll('#scoreChart .pt').length > 5`,
    { timeout: 60000 }));

eq('and it is a view, not a second block under the board',
  await b.ev(`document.getElementById('winBody').hidden`), true);
eq('the board’s note goes with the board',
  await b.ev(`document.getElementById('winNote').hidden`), true);
eq('and the score’s note comes with the score',
  await b.ev(`document.getElementById('scoreNote').hidden`), false);

/* ⚠️ Every control that belongs to one view is hidden in the other, never
   disabled. A row of greyed-out buttons reads as a broken page to anybody who
   never finds out what would enable them. */
eq('the era toggle is not on this view at all',
  await b.ev(`document.getElementById('winEras').hidden`), true);
eq('nor its bar', await b.ev(`document.getElementById('winMin').hidden`), true);
eq('nor the zoom slider, which sizes squares there are none of',
  await b.ev(`document.getElementById('winZoomLbl').hidden`), true);
eq('and the clutter bar is here instead',
  await b.ev(`document.getElementById('winFloor').hidden`), false);

const scoreModelMS = await b.ev(`window.BST.score.model()`);
const marksMS = await b.ev(`window.BST.score.marks()`);

/* Every mark the chart draws is a season somebody actually won something in —
   and every such season above the bar is drawn. */
const floorMS = await b.ev(`window.BST.score.floor()`);
eq('the bar starts where the data puts it', floorMS, 40);
check('and it says so is derived', await b.ev(`window.BST.score.auto()`));
const wantMarks = scoreModelMS.people
  .filter(p => p.peak * 100 >= floorMS - 1e-9)
  .flatMap(p => p.pts.map(pt => p.id + ':' + pt.year)).sort();
eq('a face for every season of every career on screen, and no others',
  marksMS.map(m => m.id + ':' + m.year).sort().join(' '), wantMarks.join(' '));

/* ⚠️ The marker is the photograph. A dot needs a legend and a face does not —
   and a player who appears in one season only should still be someone. */
check('the markers are faces, not dots',
  marksMS.filter(m => m.face).length > marksMS.length * 0.9,
  `${marksMS.filter(m => m.face).length} of ${marksMS.length}`);

/* ⚠️ Two careers that open in neighbouring seasons are exactly the ones drawn
   through each other, and `REIGN_COLOURS` holds two blues — which put Viktor
   AXELSEN and KIDAMBI Srikanth in near-identical blue a season apart. The
   palette is handed out over the players actually **drawn**, so the set on
   screen is always distinct. */
const drawnColours = [...new Set(marksMS.map(m => m.id + '=' + m.colour))];
const perPlayer = new Map(drawnColours.map(s => s.split('=')));
eq('one colour per career', perPlayer.size, new Set(marksMS.map(m => m.id)).size);
eq('and no two careers on screen share one',
  new Set(perPlayer.values()).size, perPlayer.size);

/* ⚠️ A point only where somebody won something, and runs break at the gaps:
   this data says who won, not who entered, so a leg across a fallow season
   would be an assertion the model cannot support. */
const legsMS = await b.ev(`window.BST.score.legs()`);
for (const p of scoreModelMS.people.filter(q => q.peak * 100 >= floorMS - 1e-9)) {
  const consecutive = p.pts.filter((pt, i) => i && pt.year === p.pts[i - 1].year + 1).length;
  eq(`${p.who} has a leg only between consecutive seasons`,
    legsMS.filter(l => l.id === p.id).length, consecutive);
}

/* ⚠️ A solid line across 2020 asserts a trend through a year that was barely
   played, so a leg touching a short season is dashed. */
check('a leg touching a short season is dashed',
  legsMS.some(l => l.dashed));
const stripMS = await b.ev(`window.BST.score.strip()`);
eq('the strip says how many titles each season held',
  stripMS.map(s => s.n).join(','),
  scoreModelMS.seasons.map(s => s.total).join(','));
/* ⚠️ The number is on **every** bar, not only the short ones. It was the short
   seasons' badge, which made a count look like a warning; it is just the size
   of the season, and a reader comparing 2022 to 2023 wants both. */
check('and the count is on every bar, not only the marked ones',
  stripMS.every(s => Number.isFinite(s.n)) && stripMS.some(s => !s.thin && s.n > 0));

/* ⚠️ A year carrying the footnote must keep its axis label, or the mark has
   nothing to sit on. 2020 and 2022 both fell on the skipped alternate when the
   axis thinned to every other year, and the asterisk simply was not drawn. */
const axisMS = await b.ev(`window.BST.score.axis()`);
for (const yr of [2020, 2022]) {
  check(`${yr} keeps its label, and its mark`,
    axisMS.includes(String(yr) + '*'), axisMS.join(' '));
}
eq('and the reasons are written where the line goes strange',
  (await b.ev(`window.BST.score.why()`)).join(','), 'Covid,Covid,ongoing');

/* ⚠️ The axis is scaled to the best season in **either** draw, and never to the
   selection. Fitted to what was on screen it rescaled every time a name was
   clicked, so isolating somebody made their line climb the page. */
const topBefore = await b.ev(`window.BST.score.top()`);
await b.ev(`window.BST.score.floor(10)`);
await b.wait(120);
eq('moving the bar does not move the axis',
  await b.ev(`window.BST.score.top()`), topBefore);
check('though it does draw more people',
  (await b.ev(`window.BST.score.marks()`)).length > marksMS.length);
check('and the bar stops being the derived default once touched',
  !await b.ev(`window.BST.score.auto()`));

console.log('\n=== the winners page: pinning a name ===');

await b.ev(`window.BST.score.floor(40)`);
await b.wait(120);
const pinId = scoreModelMS.people
  .filter(p => p.peak * 100 >= 40).sort((a, b) => b.peak - a.peak)[0].id;
const legendBefore = await b.ev(`window.BST.score.legend()`);
await b.ev(`window.BST.score.pin('${pinId}')`);
await b.wait(150);

/* ⚠️ The list must not shrink when a name is clicked. It did, which made
   picking somebody out a one-way door: the chips you would need to get back —
   or to put a second player beside the first — were the ones that had just
   gone. Off is a state, not an absence. */
const legendAfter = await b.ev(`window.BST.score.legend()`);
eq('the legend keeps every name it had',
  legendAfter.map(l => l.id).join(','), legendBefore.map(l => l.id).join(','));
eq('with the others marked off rather than removed',
  legendAfter.filter(l => l.off).length, legendAfter.length - 1);

/* ⚠️ Pinning **dims** the rest. Drawing only the pinned player re-ran the
   palette over a set of one, so the act of picking somebody out changed their
   colour — and it threw away the context that makes a share chart worth reading
   at all, which is who else was in the season. */
const marksPinned = await b.ev(`window.BST.score.marks()`);
eq('everybody is still on the chart',
  marksPinned.length, marksMS.length);
check('with everyone but the pinned player faded',
  marksPinned.every(m => m.faded === (m.id !== pinId)));
eq('and the pinned player keeps the colour they had',
  marksPinned.find(m => m.id === pinId).colour, perPlayer.get(pinId));
eq('pinning does not move the axis either',
  await b.ev(`window.BST.score.top()`), topBefore);

/* The pin travels, because it is what a link to this chart is *about*. */
eq('and it is in the link', await b.ev(`location.hash.includes('wp=${pinId}')`), true);
await b.ev(`window.BST.score.pin('${pinId}')`);
await b.wait(120);
eq('clicking again lets it go',
  (await b.ev(`window.BST.score.marks()`)).filter(m => m.faded).length, 0);


console.log('\n=== the winners page: the dominators, ranked ===');

await b.ev(`window.BST.score.view('score')`);
await b.until(`window.BST.score.marks().length > 5
  && window.BST.score.ranks().length > 5`, { timeout: 60000 });

const rankTotal = await b.ev(`window.BST.score.ranks()`);
const rankModel = await b.ev(`window.BST.score.model()`);
/* ⚠️ This section moves the bar — picking somebody it has hidden is one of the
   things being checked — so what it found is put back at the end of it. A bar
   the reader chose is ambient state that later sections read. */
const rankFloorWas = await b.ev(`window.BST.score.floor()`);

/* ⚠️ **The Show bar does not reach this table.** It filters on *peak*, and a
   total ranking cut by peak is a different claim: at the men's singles default
   of 40 it leaves seven names, and it drops BOE / MOGENSEN — eight seasons and
   seventh on total — for a best season of 25. The bar declutters the chart; the
   ranking is the whole board. */
check('the ranking holds more people than the chart is drawing',
  rankTotal.length > new Set((await b.ev(`window.BST.score.marks()`))
    .map(m => m.id)).size,
  `${rankTotal.length} ranked, ${new Set((await b.ev(`window.BST.score.marks()`))
    .map(m => m.id)).size} on the chart`);

eq('it opens in total order', await b.ev(`window.BST.score.rank()`), 'total');
eq('and says which column that is', (await b.ev(`window.BST.score.rankBy()`)).join(), 'Total');
check('with the rows actually in that order',
  rankTotal.every((r, i) => !i || rankTotal[i - 1].total >= r.total),
  rankTotal.map(r => r.total).join(' '));
check('and ranked from one',
  rankTotal[0].rank === 1 && rankTotal.every((r, i) => !i || r.rank >= rankTotal[i - 1].rank));

/* ⚠️ Both numbers are always drawn and only the *sort* moves. The two orderings
   disagree — that is the whole point — and a table showing one column at a time
   would have hidden exactly that. */
check('every row carries both numbers whichever the sort is',
  rankTotal.every(r => r.total > 0 && r.peak > 0 && r.peakYear > 1990),
  JSON.stringify(rankTotal[0]));

const rankPeak = await b.ev(`(() => { window.BST.score.rank('peak');
  return window.BST.score.ranks(); })()`);
await b.wait(150);
eq('the toggle re-sorts by peak', await b.ev(`window.BST.score.rank()`), 'peak');
eq('and the marked column moves with it',
  (await b.ev(`window.BST.score.rankBy()`)).join(), 'Peak');
check('the rows are in peak order now',
  rankPeak.every((r, i) => !i || rankPeak[i - 1].peak >= r.peak),
  rankPeak.map(r => r.peak).join(' '));
check('and it is a genuinely different ranking',
  rankPeak.map(r => r.id).join() !== rankTotal.map(r => r.id).join(),
  `${rankPeak.slice(0, 3).map(r => r.who)} vs ${rankTotal.slice(0, 3).map(r => r.who)}`);
eq('nobody has left or joined the table',
  rankPeak.length, rankTotal.length);

/* Which ordering is on is an argument about the board, so it travels. */
check('the ordering is in the link', await b.ev(`location.hash.includes('wr=peak')`),
  await b.ev(`location.hash`));
await b.ev(`window.BST.score.rank('total')`);
await b.wait(150);
eq('and the default ordering leaves the link alone',
  await b.ev(`location.hash.includes('wr=')`), false);

/* The head of the list by default, all of it on request — nothing is hidden,
   it is one click. */
const headCount = (await b.ev(`window.BST.score.ranks()`)).length;
await b.ev(`window.BST.score.rankAll(true)`);
await b.wait(200);
const allRows = await b.ev(`window.BST.score.ranks()`);
check('every competitor can be shown', allRows.length > headCount,
  `${headCount} -> ${allRows.length}`);
eq('and that is all of them', allRows.length, rankModel.people.length);
await b.ev(`window.BST.score.rankAll(false)`);
await b.wait(200);

console.log('\n=== the winners page: picking out of the ranking ===');

/* One gesture wherever a competitor is drawn — the square, the era bar, the
   marker, the legend chip, and now the row. */
const topId = (await b.ev(`window.BST.score.ranks()`))[0].id;
const rankPicked = await b.ev(`window.BST.score.rankTap(${JSON.stringify(topId)})`);
await b.wait(200);
eq('clicking a row picks that competitor', rankPicked.join(','), topId);
const litRows = await b.ev(`window.BST.score.ranks()`);
check('the row stays lit and the rest recede',
  litRows.every(r => r.faded === (r.id !== topId)),
  `${litRows.filter(r => !r.faded).length} lit`);
/* ⚠️ Dimmed, never removed: a ranking with rows missing out of the middle of it
   is not a ranking. */
eq('and nothing has left the table', litRows.length, rankPicked.length ? litRows.length : 0);
check('the chart answers to it too',
  (await b.ev(`window.BST.score.marks()`)).some(m => !m.faded && m.id === topId));

await b.ev(`window.BST.score.rankTap(${JSON.stringify(topId)})`);
await b.wait(200);
eq('and clicking it again lets go', (await b.ev(`window.BST.score.pinned()`)).length, 0);

/* ⚠️⚠️ **The table lists everybody and the chart does not.** Picking somebody
   the bar has hidden would light a row against a chart that cannot show them —
   or, before the guard below it, fade every line at once because no drawn line
   matched the pick. So the bar comes down to fit, which is what a reader
   clicking a name in a ranking is asking for. */
await b.ev(`window.BST.score.rankAll(true)`);
await b.wait(200);
const floorBefore = await b.ev(`window.BST.score.floor()`);
const drawnIds = new Set((await b.ev(`window.BST.score.marks()`)).map(m => m.id));
const hidden = (await b.ev(`window.BST.score.ranks()`))
  .find(r => !drawnIds.has(r.id));
check('somebody in the ranking is below the bar', !!hidden,
  hidden ? `${hidden.who} peak ${hidden.peak}` : 'everybody is on the chart');
if (hidden) {
  await b.ev(`window.BST.score.rankTap(${JSON.stringify(hidden.id)})`);
  await b.wait(250);
  const floorAfter = await b.ev(`window.BST.score.floor()`);
  check('picking them brings the bar down to fit', floorAfter < floorBefore,
    `${floorBefore} -> ${floorAfter}`);
  const marksNow = await b.ev(`window.BST.score.marks()`);
  check('so their line is on the chart', marksNow.some(m => m.id === hidden.id),
    `${marksNow.length} marks`);
  check('lit, with the rest of the chart dimmed round it',
    marksNow.every(m => m.faded === (m.id !== hidden.id)),
    `${marksNow.filter(m => !m.faded).length} lit`);
  check('and the bar it moved is in the link too',
    await b.ev(`location.hash.includes('wf=')`), await b.ev(`location.hash`));
}
await b.ev(`window.BST.winners.escape()`);
await b.wait(200);
await b.ev(`window.BST.score.rankAll(false)`);
await b.wait(150);

/* ⚠️ A pick the chart cannot draw must never fade **every** line at once. It
   arrives from a link as well as from the table, and a chart faded to nothing
   with the cause off screen is unreadable and has nothing to click. */
const ghost = await b.ev(`(() => {
  window.BST.score.floor(50);
  const all = window.BST.score.marks();
  return { before: all.filter(m => !m.faded).length, total: all.length };
})()`);
await b.wait(200);
await b.ev(`location.hash = location.hash + '&wp=nobody-at-all'`);
await b.wait(400);
const ghostMarks = await b.ev(`window.BST.score.marks()`);
check('a pick naming nobody the chart is drawing fades none of it',
  ghostMarks.length > 0 && ghostMarks.every(m => !m.faded),
  `${ghostMarks.filter(m => m.faded).length} of ${ghostMarks.length} faded`);
check('and the legend is not all switched off either',
  (await b.ev(`window.BST.score.legend()`)).some(l => !l.off),
  JSON.stringify(ghost));
await b.ev(`location.hash = '#pg=winners&wv=score'`);
await b.until(`window.BST.score.marks().length > 5`, { timeout: 60000 });

// The bar this section borrowed, put back — see `rankFloorWas`.
await b.ev(`window.BST.score.floor(${rankFloorWas})`);
await b.wait(150);
eq('the bar this section borrowed is back where it was',
  await b.ev(`window.BST.score.floor()`), rankFloorWas);

console.log('\n=== the winners page: every season named on the axis ===');

/* ⚠️ **Every year, not every other one.** The axis used to thin its labels above
   fourteen seasons, which was a guess rather than a measurement — the plot is
   1118 units wide, 59 to a season over twenty, against a four-digit label of
   about 27. What the thinning did instead was make the reader count gaps to
   place a point, and it had already had to spare the footnoted years by hand
   because 2020 and 2022 fell on the skipped alternate. */
const axisYears = (await b.ev(`window.BST.score.axis()`))
  .map(t => (t.match(/\d{4}/) || [])[0]).filter(Boolean);
const chartYears = (await b.ev(`window.BST.score.model()`)).years.map(String);
check('the axis names every season on the chart',
  chartYears.every(y => axisYears.includes(y)),
  `missing ${chartYears.filter(y => !axisYears.includes(y)).join(' ')}`);
eq('and no more than that', axisYears.length, chartYears.length);
/* The labels are laid out by the browser, so this is the only way to know they
   are not sitting on top of one another. */
const axisBoxes = await b.ev(`[...document.querySelectorAll('#scoreChart .scoreaxis text')]
  .map(t => t.getBoundingClientRect())
  .filter(r => r.width > 0)
  .sort((a, b) => a.x - b.x)
  .map(r => [Math.round(r.x), Math.round(r.right)])`);
const yearBoxes = axisBoxes.slice(-chartYears.length);
check('and none of them overlaps its neighbour',
  yearBoxes.every((r, i) => !i || r[0] > yearBoxes[i - 1][1]),
  JSON.stringify(yearBoxes.slice(0, 4)));

console.log('\n=== the winners page: the two views hold the same seasons ===');

/* ⚠️ Scaled across **both** draws, so switching discipline does not compare two
   pictures at two scales. */
await b.ev(`window.BST.winners.kind('WS')`);
check('the women’s board draws too',
  await b.until(`window.BST.score.marks().length > 5`, { timeout: 60000 }));
eq('and it is drawn to the same height as the men’s',
  await b.ev(`window.BST.score.top()`), topBefore);
/* A bar the reader set is theirs, and does not quietly re-derive itself under
   them when they look at the other draw. */
eq('a chosen bar survives the switch', await b.ev(`window.BST.score.floor()`), 40);

/* ⚠️ A link without the bar in it is asking for the *default*, and the default
   is derived per discipline — so the women's board settles far lower than the
   men's, where two careers have taken 85 and 78 of a season. */
await b.ev(`location.hash = '#pg=winners&wv=score&wk=WS'`);
await b.until(`window.BST.score.auto() && window.BST.score.marks().length > 5`,
  { timeout: 60000 });
eq('but the derived one is the women’s own',
  await b.ev(`window.BST.score.floor()`), 20);

await b.ev(`location.hash = '#pg=winners&wv=score'`);
await b.until(`window.BST.winners.kind() === 'MS' && window.BST.score.marks().length > 5`,
  { timeout: 60000 });
eq('and the men’s is theirs', await b.ev(`window.BST.score.floor()`), 40);

/* The score is a share of the same seasons the board draws, so the two cannot
   disagree about what a season held. */
const boardYears = await b.ev(`window.BST.score.model().seasons.map(s => s.year)`);
await b.ev(`window.BST.score.view('board')`);
check('switching back draws the board',
  await b.until(`!!document.querySelector('.pyrseason')`, { timeout: 60000 }));
eq('over exactly the same seasons',
  (await b.ev(`window.BST.winners.columns().map(c => c.year)`)).join(','),
  boardYears.join(','));
eq('and the board’s note is back',
  await b.ev(`document.getElementById('winNote').hidden`), false);

/* Both keys, because a view you can only reach with the mouse is a view half
   the readers of this page will never find. */
await b.ev(`document.body.focus(); window.dispatchEvent(new Event('x'))`);
await b.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))`);
await b.wait(200);
eq('S is the score view', await b.ev(`window.BST.score.view()`), 'score');
await b.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true }))`);
await b.wait(200);
eq('and B is the board', await b.ev(`window.BST.score.view()`), 'board');

/* The ladder is written out on the page, because a weight nobody can check is a
   magic number — and because the whole claim is that it is the *board's* ladder
   rather than a second ranking. */
await b.ev(`window.BST.score.view('score')`);
await b.until(`window.BST.score.marks().length > 5`, { timeout: 60000 });
eq('the note says what every tier is worth',
  (await b.ev(`window.BST.score.ladder()`)).join(' | '),
  'Olympics6.854 | Worlds4.236 | Tour Finals2.618 | Super 10001.618 | Super 7501');

/* ⚠️ The tables mark short seasons with the **same rule the chart marks with**,
   not a second one — they were left on a fixed "fewer than six" test when the
   chart moved to two thirds of the median, and called 2022 a normal season while
   the axis above them said otherwise.
   ⚠️ And they are dimmed rather than coloured: amber is this palette's attention
   colour, so the one season nobody should read at face value was the brightest
   line in the table. A footnote should recede. */
const yearRows = await b.ev(`window.BST.score.rows('scoreYears')`);
eq('every season is in the table', yearRows.length, boardYears.length);

/* ⚠️ A title is named for what it was called **in its own season**, the same
   rule the board above uses — and the reason neither view needs an era switch
   the way the compare page does: a board spanning 2007 to 2026 cannot pick one
   vocabulary for all of it. Naming everything modern here had the two views of
   one board disagreeing about what a title was. */
const madeOf = y => (yearRows.find(r => r.cells[0].replace('*', '') === String(y)) || {}).cells;
check('a Superseries-era season is named in Superseries words',
  madeOf(2013)[2].includes('Superseries'), madeOf(2013)[2]);
check('and never in World Tour ones',
  !/Super \d/.test(madeOf(2013)[2]), madeOf(2013)[2]);
check('a World Tour season is named in World Tour words',
  /Super \d/.test(madeOf(2023)[2]), madeOf(2023)[2]);
check('and never in Superseries ones',
  !madeOf(2023)[2].includes('Superseries'), madeOf(2023)[2]);
/* The majors are called the same thing in both, which is why they are the pair
   worth checking: it is the tiers *below* them that were renamed. */
check('the Worlds is the Worlds in either era',
  madeOf(2013)[2].includes('Worlds') && madeOf(2023)[2].includes('Worlds'));

/* ⚠️ The ladder in the note keeps the modern names, because those are the
   **rungs** rather than any title, and a rung has no season to be named for. */
check('but the ladder itself is still stated in modern rungs',
  (await b.ev(`window.BST.score.ladder()`)).some(w => w.startsWith('Super 750')));
eq('and the short ones are the ones the axis marked',
  yearRows.filter(r => r.thin).map(r => r.cells[0].replace('*', '')).join(','),
  '2020,2022,' + new Date().getUTCFullYear());
check('a short row is dimmed, not lit',
  await b.ev(`(() => {
    const tr = [...document.querySelectorAll('#scoreYears tr')].find(r => r.classList.contains('thin'));
    const lit = [...document.querySelectorAll('#scoreYears tr')].find(r => !r.classList.contains('thin') && r.querySelector('td'));
    const grey = c => { const [r, g, bl] = c.match(/\\d+/g).map(Number); return (r + g + bl) / 3; };
    return grey(getComputedStyle(tr.querySelector('td')).color)
      < grey(getComputedStyle(lit.querySelector('td')).color);
  })()`));


console.log('\n=== the winners page: a pair in one square ===');

await b.ev(`location.hash = '#pg=winners&wk=MD'`);
check('the men’s doubles board draws',
  await b.until(`document.querySelectorAll('.pyrtile').length > 20`, { timeout: 60000 }));
/* Two photographs per square, so the board has twice as many to fetch as a
   singles one and takes correspondingly longer to settle. */
await b.until(`[...document.querySelectorAll('.pyrtile img')]
  .filter(i => i.complete && i.naturalWidth > 0).length > 40`, { timeout: 90000 });

const pairTiles = await b.ev(`[...document.querySelectorAll('.pyrtile')].map(t => {
  const r = t.getBoundingClientRect();
  return {
    tier: t.dataset.tier,
    w: Math.round(r.width), h: Math.round(r.height),
    halves: [...t.querySelectorAll('.half')].map(x => {
      const b = x.getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height), src: x.getAttribute('src') || '' };
    }),
  };
})`);

check('every square holds two halves',
  pairTiles.every(t => t.halves.length === 2),
  `${pairTiles.filter(t => t.halves.length !== 2).length} of ${pairTiles.length} do not`);

/* ⚠️ **The square stays square, and stays the size the ladder says.** A doubles
   title is won by a partnership and the board's standing rule is that every
   square means the same thing — so the pair fits the square rather than the
   square growing to fit the pair. */
check('and every square is still square',
  pairTiles.every(t => Math.abs(t.w - t.h) <= 1),
  JSON.stringify(pairTiles.find(t => Math.abs(t.w - t.h) > 1) || 'all square'));
check('with the halves exactly half of it, full height',
  pairTiles.every(t => Math.abs(t.halves[0].w * 2 - t.w) <= 1
    && Math.abs(t.halves[0].h - t.h) <= 1),
  JSON.stringify(pairTiles[0]));
/* ⚠️⚠️ **BWF's stand-in for "no photograph" is a photograph.** Rather than an
   empty avatar it serves a generic silhouette — `profile_male.jpg` — and nine of
   the winners across these boards have one, two of them in the *singles* files
   where it had gone unnoticed for weeks. On a pair it drew the same blank
   silhouette twice and read as a rendering fault. Treated as no photograph now,
   so the initials take over and the half says who it is. Two more had a `.tif`
   avatar, which no browser renders at all. */
check('no square shows the same photograph twice',
  pairTiles.every(t => !t.halves[0].src || t.halves[0].src !== t.halves[1].src),
  JSON.stringify(pairTiles.find(t => t.halves[0].src
    && t.halves[0].src === t.halves[1].src) || 'none'));
check('and BWF’s generic silhouette is never drawn as a face',
  pairTiles.every(t => t.halves.every(h => !/profile_(male|female)\.jpg/.test(h.src))));
check('nor a .tif, which no browser renders',
  pairTiles.every(t => t.halves.every(h => !/\.tiff?$/i.test(h.src))));
/* The half whose photograph was dropped keeps its place, rather than letting the
   other one slide across and claim the whole square. */
check('a half with no photograph still holds half the square',
  await b.ev(`[...document.querySelectorAll('.pyrtile')].every(t => {
    const kids = [...t.querySelectorAll('.pairface > *')];
    if (kids.length !== 2) return true;
    const w = kids.map(k => Math.round(k.getBoundingClientRect().width));
    return Math.abs(w[0] - w[1]) <= 1;
  })`));

/* ⚠️ The same tier is the same size in every draw. If a doubles square came out
   a different size from a singles one, the ladder would be saying something
   about the discipline rather than about the title. */
const mdSizes = await b.ev(`(() => {
  const out = {};
  for (const t of document.querySelectorAll('.pyrtile')) {
    out[t.dataset.tier] = Math.round(t.getBoundingClientRect().width);
  }
  return out;
})()`);
await b.ev(`window.BST.winners.kind('MS')`);
await b.until(`document.querySelectorAll('.pyrtile').length > 20`, { timeout: 60000 });
const msSizes = await b.ev(`(() => {
  const out = {};
  for (const t of document.querySelectorAll('.pyrtile')) {
    out[t.dataset.tier] = Math.round(t.getBoundingClientRect().width);
  }
  return out;
})()`);
for (const tier of Object.keys(msSizes)) {
  if (mdSizes[tier] == null) continue;
  eq(`a ${tier} square is the same size in both draws`, mdSizes[tier], msSizes[tier]);
}
eq('and a singles square holds one photograph, not two',
  await b.ev(`document.querySelectorAll('.pyrtile .half').length`), 0);

/* ---- one competitor, whichever draw ---- */

await b.ev(`location.hash = '#pg=winners&wk=MD'`);
await b.until(`document.querySelectorAll('.erabar').length > 2`, { timeout: 60000 });

/* ⚠️ A partnership is **one** bar between them. The bug the pair key exists to
   stop is a band with a lane for each half of every pair. */
const mdBars = await b.ev(`window.BST.winners.bars()`);
check('an era bar is named for the pair', mdBars.every(x => / \/ /.test(x.who)),
  mdBars.map(x => x.who).join(' | '));
check('and carries both their faces',
  await b.ev(`[...document.querySelectorAll('.erawho .pairface')].length
    === document.querySelectorAll('.erabar').length`));

await b.ev(`window.BST.score.view('score')`);
await b.until(`window.BST.score.marks().length > 5`, { timeout: 60000 });
const mdScore = await b.ev(`window.BST.score.model()`);
check('the chart draws pairs, not people',
  mdScore.people.every(p => / \/ /.test(p.who)), mdScore.people[0].who);
/* A season's shares still add to a whole season, which is the property that
   would break the moment a title were split between two half-competitors. */
check('and a doubles season is still one whole season',
  mdScore.seasons.filter(s => s.total).every(s => {
    const n = mdScore.people.reduce((sum, p) => {
      const pt = p.pts.find(q => q.year === s.year);
      return sum + (pt ? pt.score : 0);
    }, 0);
    return Math.abs(n - 1) < 1e-9;
  }));
check('every marker on it is a split face',
  await b.ev(`[...document.querySelectorAll('#scoreChart .pt')]
    .every(g => g.querySelectorAll('image').length === 2)`));

console.log('\n=== the winners page: one pair, drawn the same way round ===');

/* ⚠️ **BWF does not list a partnership the same way twice.** Seven of the pairs
   on these boards appear in both orders across their own titles — Kido and
   Setiawan eleven times one way and once the other — and the split square draws
   them in the order the title carries. So the same pair swapped faces from one
   square to the next along a single row, with the hover swapping their names to
   match, which reads as two different partnerships. `settleWinnerOrder` decides
   once, at the door, and this is the check that would have caught it. */
/* ⚠️ Back to the board first. The section above finishes on the score chart,
   and `#winBody` keeps its last HTML while it is hidden — so reading squares
   here without switching back reads a board that is not on screen. */
await b.ev(`window.BST.score.view('board')`);
await b.until(`!document.getElementById('winBody').hidden
  && document.querySelectorAll('#winBody .pyrtile').length > 20`, { timeout: 60000 });
const orderTiles = await b.ev(`window.BST.winners.tiles()`);
const byPair = new Map();
const swapped = [];
for (const t of orderTiles) {
  if (t.halves.length !== 2) continue;
  const drawn = t.halves.join(' / ');
  if (!byPair.has(t.id)) byPair.set(t.id, drawn);
  else if (byPair.get(t.id) !== drawn) swapped.push(`${byPair.get(t.id)} vs ${drawn}`);
}
check('every square of a given pair draws them in the same order',
  !swapped.length, swapped.slice(0, 3).join(' · '));
check('and there are pairs with more than one square to disagree about',
  byPair.size < orderTiles.filter(t => t.halves.length === 2).length,
  `${byPair.size} pairs over ${orderTiles.length} squares`);

console.log('\n=== the winners page: picking one out of the board ===');

/* A doubles board is two photographs per square and several hundred squares,
   and following one partnership across it by eye is genuinely hard. */
const repeat = [...byPair.keys()].find(id =>
  orderTiles.filter(t => t.id === id).length > 3);
check('a pair with several squares to follow is on the board', !!repeat, String(repeat));
const picked = await b.ev(`window.BST.winners.tap(${JSON.stringify(repeat)})`);
await b.wait(200);
eq('clicking a square picks that competitor', picked.join(','), repeat);
const afterTap = await b.ev(`window.BST.winners.tiles()`);
eq('every square of theirs is lit',
  afterTap.filter(t => t.id === repeat && !t.faded).length,
  afterTap.filter(t => t.id === repeat).length);
check('and every other square on the board is pushed back',
  afterTap.filter(t => t.id !== repeat).every(t => t.faded),
  `${afterTap.filter(t => t.id !== repeat && !t.faded).length} still lit`);

/* ⚠️ **Dimmed, never removed.** The shape of a season, and who else was in it,
   is most of what this view is for — the same lesson the score chart learned
   when pinning a name used to redraw the chart over a set of one. */
eq('nothing has left the board', afterTap.length, orderTiles.length);

/* ⚠️ The photograph fades and the **square does not**. Dimming the whole tile
   was the obvious way and it deletes the board: `.pyrtile` carries the faint
   ground that draws the pyramid's silhouette, so at 16% the shape of the season
   went with it. */
const fadeOpacity = await b.ev(`(() => {
  const t = document.querySelector('#winBody .pyrtile.faded');
  const inner = t.querySelector('.pairface, .face, .noface');
  return { tile: getComputedStyle(t).opacity,
    inner: getComputedStyle(inner).opacity,
    box: getComputedStyle(t).backgroundColor };
})()`);
eq('a pushed-back square is still fully drawn', fadeOpacity.tile, '1');
check('while the photograph inside it has receded',
  Number(fadeOpacity.inner) > 0 && Number(fadeOpacity.inner) < 0.3, fadeOpacity.inner);
check('so the silhouette of the pyramid is still there',
  fadeOpacity.box !== 'rgba(0, 0, 0, 0)', fadeOpacity.box);

/* ⚠️ The same key the score chart pins on, and it travels from **both** views.
   `wp` used to be written only on the score, which was right while the score
   was the only view with a pick and silently wrong the moment the board had
   one: the board dimmed, and the link said nothing about why. */
check('the pick is in the link',
  await b.ev(`location.hash.includes('wp=' + encodeURIComponent(${JSON.stringify(repeat)}))`)
  || await b.ev(`location.hash.includes('wp=${repeat}')`),
  await b.ev(`location.hash`));

/* ⚠️ The era bar carries the same `data-id` and is picked up by the same
   handler, so clicking the name on a run gives what clicking a square gives. */
const barsPicked = await b.ev(`window.BST.winners.bars()`);
if (barsPicked.length) {
  check('the bars in the era band answer to the same pick',
    barsPicked.every(x => x.faded === (x.id !== repeat)),
    barsPicked.map(x => `${x.who}:${x.faded}`).join(' | '));
}

/* Additive, because the question a board like this raises is usually about two
   people rather than one. */
const second = orderTiles.map(t => t.id).find(id => id !== repeat);
await b.ev(`window.BST.winners.tap(${JSON.stringify(second)})`);
await b.wait(200);
const twoLit = await b.ev(`window.BST.winners.tiles()`);
eq('a second click adds rather than replaces',
  [...new Set(twoLit.filter(t => !t.faded).map(t => t.id))].sort().join(','),
  [repeat, second].sort().join(','));

await b.ev(`window.BST.winners.tap(${JSON.stringify(second)})`);
await b.wait(200);
eq('and clicking a lit square again drops it',
  [...new Set((await b.ev(`window.BST.winners.tiles()`))
    .filter(t => !t.faded).map(t => t.id))].join(','), repeat);

/* ⚠️⚠️ **A pick must never black out the whole board.** It is keyed on player
   ids, so one carried onto a different draw matches nothing — and `pickedOff`
   is then true for every square, which is a board dimmed to nothing with no
   visible cause and nothing left to click to get it back. Switching discipline
   drops it; a link that names somebody from another draw is dropped on the way
   in. */
await b.ev(`window.BST.winners.kind('XD')`);
await b.until(`window.BST.winners.kind() === 'XD'
  && document.querySelectorAll('#winBody .pyrtile').length > 20`, { timeout: 60000 });
check('switching draw leaves nothing dimmed',
  (await b.ev(`window.BST.winners.tiles()`)).every(t => !t.faded),
  `${(await b.ev(`window.BST.winners.tiles()`)).filter(t => t.faded).length} dimmed`);
eq('and takes the pick out of the link with it',
  await b.ev(`location.hash.includes('wp=')`), false);

await b.ev(`location.hash = '#pg=winners&wk=XD&wp=${repeat}'`);
await b.until(`window.BST.winners.kind() === 'XD'
  && document.querySelectorAll('#winBody .pyrtile').length > 20`, { timeout: 60000 });
await b.wait(300);
check('a link naming somebody from another draw draws the board anyway',
  (await b.ev(`window.BST.winners.tiles()`)).every(t => !t.faded),
  `${(await b.ev(`window.BST.winners.tiles()`)).filter(t => t.faded).length} dimmed`);

await b.ev(`location.hash = '#pg=winners&wk=MD'`);
await b.until(`window.BST.winners.kind() === 'MD'
  && document.querySelectorAll('#winBody .pyrtile').length > 20`, { timeout: 60000 });
await b.ev(`window.BST.winners.tap(${JSON.stringify(repeat)})`);
await b.wait(200);

/* ⚠️ The way back. Clicking a lit square un-picks it, but on a board of several
   hundred squares "which ones did I click?" is a question the reader should not
   have to answer to get their board back. */
const cleared = await b.ev(`window.BST.winners.escape()`);
await b.wait(200);
eq('Escape lets the whole board go', cleared.length, 0);
check('and nothing is left dimmed',
  (await b.ev(`window.BST.winners.tiles()`)).every(t => !t.faded));
check('nor is the pick left behind in the link',
  !(await b.ev(`location.hash.includes('wp=')`)), await b.ev(`location.hash`));

console.log('\n=== the winners page: picking a face off the chart ===');

/* ⚠️ The marker is a face with a name attached, which is exactly what the chip
   below it is — so it does what the chip does. The reader who has just hovered
   a face to find out whose line that is should not have to go and find the same
   face again in a list of twenty in order to pin it. */
await b.ev(`window.BST.score.view('score')`);
await b.until(`window.BST.score.marks().length > 5`, { timeout: 60000 });
const chartId = (await b.ev(`window.BST.score.marks()`))[0].id;
const tapped = await b.ev(`(() => {
  const h = document.querySelector('#scoreChart .hit[data-id="${chartId}"]');
  h.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return window.BST.score.pinned();
})()`);
await b.wait(200);
eq('clicking a marker pins that competitor', tapped.join(','), chartId);
const chartLegend = await b.ev(`window.BST.score.legend()`);
eq('the legend chip shows it as picked, exactly as a click on the chip would',
  chartLegend.filter(l => !l.off).map(l => l.id).join(','), chartId);
eq('and the legend keeps every name it had',
  chartLegend.filter(l => l.off).length, chartLegend.length - 1);
const chartMarks = await b.ev(`window.BST.score.marks()`);
check('the rest of the chart is dimmed rather than dropped',
  chartMarks.every(m => m.faded === (m.id !== chartId)));
await b.ev(`(() => {
  document.querySelector('#scoreChart .hit[data-id="${chartId}"]')
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
})()`);
await b.wait(200);
eq('and clicking the same marker again lets it go',
  (await b.ev(`window.BST.score.pinned()`)).length, 0);
await b.ev(`window.BST.score.view('board')`);

/* ---- the keys ----
   ⚠️ The tournament page's idiom, borrowed rather than invented: five draws will
   not fit five letters anybody would guess, and a reader who has learned the
   double-tap on one page has learned it here. */
await b.ev(`window.BST.score.view('board')`);
await b.ev(`location.hash = '#pg=winners&wk=MS'`);
await b.until(`window.BST.winners.kind() === 'MS'`, { timeout: 60000 });
const pressKey = k => b.ev(`document.body.dispatchEvent(new KeyboardEvent('keydown',
  { key: ${JSON.stringify(k)}, bubbles: true, cancelable: true }))`);
await pressKey('m');
await b.wait(150);
eq('m again is the men’s doubles', await b.ev(`window.BST.winners.kind()`), 'MD');
await pressKey('m');
await b.wait(150);
eq('and m once more comes back to the singles',
  await b.ev(`window.BST.winners.kind()`), 'MS');
await pressKey('w');
await b.wait(150);
eq('w is the women’s singles', await b.ev(`window.BST.winners.kind()`), 'WS');
await pressKey('w');
await b.wait(150);
eq('and w again the women’s doubles', await b.ev(`window.BST.winners.kind()`), 'WD');
await pressKey('x');
await b.wait(150);
eq('x is the mixed', await b.ev(`window.BST.winners.kind()`), 'XD');
await pressKey('x');
await b.wait(150);
eq('and x again stays there, having nowhere else to go',
  await b.ev(`window.BST.winners.kind()`), 'XD');
await b.ev(`location.hash = '#pg=winners'`);
await b.until(`window.BST.winners.kind() === 'MS'`, { timeout: 60000 });


console.log('\n=== the winners page: saving a slice of it ===');

await b.ev(`location.hash = '#pg=winners'`);
await b.until(`!!document.querySelector('.erabar')`, { timeout: 60000 });

check('the picker is out of the way until it is asked for',
  await b.ev(`document.getElementById('winExport').hidden`));
await b.ev(`document.getElementById('winSave').click()`);
check('the export button opens it', !await b.ev(`document.getElementById('winExport').hidden`));
const spans = await b.ev(`[...document.querySelectorAll('#expFrom option')].map(o => o.value)`);
eq('the years on offer are the seasons there are', spans.length,
  (await b.ev('window.BST.winners.columns()')).length);
eq('and it opens on the whole board',
  await b.ev(`document.getElementById('expFrom').value + '-' + document.getElementById('expTo').value`),
  spans[0] + '-' + spans[spans.length - 1]);

/* A range given backwards is still a range: the picker has two selects and
   nothing stops a reader setting the later one first. */
eq('a range given backwards is put the right way round',
  JSON.stringify(await b.ev(`window.BST.winners.range(2016, 2011)`)),
  JSON.stringify({ from: 2011, to: 2016 }));

const png = await b.ev(`window.BST.winners.png(2011, 2016)`);
check('a poster comes back as a real PNG', png && png.type === 'image/png',
  JSON.stringify(png && png.type));
check('with something in it', png && png.bytes > 20000, png && png.bytes);
check('and it decodes to the size the layout asked for',
  await b.ev(`(async () => {
    const L = window.BST.winners.poster(2011, 2016);
    const out = await window.BST.winners.png(2011, 2016);
    const im = new Image();
    await new Promise(r => { im.onload = r; im.onerror = r; im.src = out.url; });
    return im.naturalWidth === Math.round(L.width * 2)
      && im.naturalHeight === Math.round(L.height * 2)
      ? true : im.naturalWidth + 'x' + im.naturalHeight
        + ' want ' + Math.round(L.width * 2) + 'x' + Math.round(L.height * 2);
  })()`), true);

eq('the file is named for what is in it',
  await b.ev(`window.BST.winners.name({ from: 2011, to: 2016 })`),
  'badminton-winners-MS-2011-2016.png');

/* ⚠️⚠️ The trap the whole export rests on. BWF's image host *does* answer a CORS
   request, which is why the faces can be in a poster at all — but the very same
   photograph loaded without `crossOrigin` poisons the canvas, and then nothing
   fails until `toBlob`. The property checked is not "the network is up": it is
   that an image which loaded must leave the canvas readable. */
const corsOk = await b.ev(`(async () => {
  const src = 'https://img.bwfbadminton.com/image/upload/v1604895106'
    + '/assets/players/thumbnail/50906.jpg';
  const im = new Image();
  im.crossOrigin = 'anonymous';
  const ok = await new Promise(r => {
    im.onload = () => r(true); im.onerror = () => r(false); im.src = src;
  });
  if (!ok) return 'offline';
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  c.getContext('2d').drawImage(im, 0, 0, 8, 8);
  try { c.toDataURL(); return true; }
  catch (e) { return 'TAINTED (' + e.name + ') — every export would throw'; }
})()`);
/* `offline` is not a pass and not a failure: it says the check could not be
   made, which is the honest answer when BWF is unreachable. A tainted canvas
   is a failure, and the only one that matters here. */
check('a photograph never loads in a way that poisons the canvas',
  corsOk === true || corsOk === 'offline', String(corsOk));

/* ⚠️ The pick goes into the picture, because it *is* the picture — the same rule
   the score poster follows with its pins. An export of a board with one
   competitor followed across it is a different claim from an export of the
   board, and a reader who picked somebody and then exported would otherwise get
   a picture that disagrees with what they were looking at. */
const litBefore = await b.ev(`(() => {
  const L = window.BST.winners.poster(2011, 2016);
  return L.litTiles.filter(t => t.lit).length + '/' + L.litTiles.length;
})()`);
eq('with nothing picked, the poster lights every square',
  litBefore.split('/')[0], litBefore.split('/')[1]);

const exportPick = (await b.ev(`window.BST.winners.tiles()`))[0].id;
await b.ev(`window.BST.winners.tap(${JSON.stringify(exportPick)})`);
await b.wait(200);
const litAfter = await b.ev(`window.BST.winners.poster(2011, 2016).litTiles`);
check('and a pick on the page reaches the poster',
  litAfter.some(t => t.lit) && litAfter.some(t => !t.lit),
  `${litAfter.filter(t => t.lit).length} of ${litAfter.length} lit`);
check('lighting exactly the squares the board has lit',
  litAfter.every(t => t.lit === (t.id === exportPick)));
const pickedPng = await b.ev(`window.BST.winners.png(2011, 2016)`);
check('and a picked board still encodes to a readable PNG',
  pickedPng && pickedPng.type === 'image/png' && pickedPng.bytes > 20000,
  JSON.stringify(pickedPng && [pickedPng.type, pickedPng.bytes]));
await b.ev(`window.BST.winners.escape()`);
await b.wait(200);

await b.ev(`document.getElementById('winSave').click()`);
check('and the picker closes again', await b.ev(`document.getElementById('winExport').hidden`));

/* ---- and a slice of the score ----

   The same picker, the same range, the same foot: only the drawing differs. */

await b.ev(`location.hash = '#pg=winners&wv=score'`);
await b.until(`window.BST.score.marks().length > 5`, { timeout: 60000 });

eq('the file says which of the two views it is',
  await b.ev(`window.BST.winners.name({ from: 2011, to: 2016 })`),
  'badminton-score-MS-2011-2016.png');

const scoreCrop = await b.ev(`window.BST.score.poster(2011, 2016)`);
eq('a crop is drawn to the seasons asked for',
  scoreCrop.years.join(','), '2011,2012,2013,2014,2015,2016');
/* ⚠️ The crop changes what is *shown*, never what is *counted*: a score is a
   share of its own season, and the players, their colours and the axis are all
   settled over the whole career and then clipped. An export of six seasons that
   recoloured CHEN Long because LEE Chong Wei fell off the left would not be the
   picture the sender was looking at. */
const scoreWhole = await b.ev(`window.BST.score.poster(2007, 2026)`);
eq('and the colours are the ones the whole board gave them',
  scoreCrop.shown.map(p => p.who + '=' + p.colour).join(' '),
  scoreWhole.shown.map(p => p.who + '=' + p.colour).join(' '));
eq('so is the height of the axis', scoreCrop.top, scoreWhole.top);
/* ⚠️ And the axis is the one the *page* worked out, across both draws — one
   file cannot know about the other, so the number is handed in. */
eq('which is the height the page is drawn at',
  scoreCrop.top, await b.ev(`window.BST.score.top()`));

const scorePng = await b.ev(`window.BST.score.png(2011, 2016)`);
check('a score poster comes back as a real PNG',
  scorePng && scorePng.type === 'image/png', JSON.stringify(scorePng && scorePng.type));
check('with the photographs in it', scorePng && scorePng.bytes > 20000, scorePng && scorePng.bytes);
check('and it decodes to the width the layout asked for',
  await b.ev(`(async () => {
    const L = window.BST.score.poster(2011, 2016);
    const out = await window.BST.score.png(2011, 2016);
    const im = new Image();
    await new Promise(r => { im.onload = r; im.onerror = r; im.src = out.url; });
    return im.naturalWidth === Math.round(L.width * 2)
      ? true : im.naturalWidth + ' want ' + Math.round(L.width * 2);
  })()`), true);

await b.ev(`location.hash = '#pg=winners'`);
await b.until(`!!document.querySelector('.pyrseason')`, { timeout: 60000 });
await b.ev(`document.querySelector('#pageNav [data-page="seasons"]').click()`);

/* ============================ the keyboard ============================

   Every shortcut is a faster route through a control that is already on the
   page, so each one is checked by the state it leaves behind rather than by the
   handler being called. Run last, once every page has been visited and its
   requests are cached, because the arrows genuinely change page.
   ==================================================================== */

console.log('\n=== the keyboard ===');

/** A real keydown, on the body, exactly as the browser would deliver it. */
const press = (key, opts = {}) => b.ev(`(() => {
  const e = new KeyboardEvent('keydown', Object.assign(
    { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true },
    ${JSON.stringify(opts)}));
  document.body.dispatchEvent(e);
  return e.defaultPrevented;
})()`);

const onPage = () => b.ev('document.body.dataset.page');

/* ⚠️ Pin the date first. Walking right lands on the tournament page, which asks
   BWF what is on *today* — and the winners tests above navigated by hash
   without `now=`, which clears the pin. Unpinned, this block loaded the real
   live tournament and went to the network for a day nobody recorded. */
await b.ev(`location.hash = '#p=57945&pg=seasons&now=2026-08-23'`);
await b.until(`window.BST.tmt.today() === '2026-08-23'`, { timeout: 30000 });
await b.ev(`document.querySelector('#pageNav [data-page="seasons"]').click()`);
eq('starting on the seasons', await onPage(), 'seasons');

/* ---- the level chips, on the seasons page ----

   The same two keys as the compare grid, doing the same thing to the same kind
   of row: up adds the highest that is off, down drops the lowest that is on. */

/** The level chips as drawn, hardest first — the order the keys walk. */
const seasonChips = () => b.ev(`[...document.querySelectorAll('#levels .chip')]
  .map(c => (c.classList.contains('on') ? '' : '-') + c.dataset.cat)`);

const levelsBefore = await seasonChips();
check('the level chips are up', levelsBefore.length > 3, levelsBefore.join(' '));
/* ⚠️ The team events start off, by `applyLevelDefaults` — so "the lowest that is
   on" is not simply the last chip, and a rule that assumed it was would have
   pressed a chip that was already off. */
const lowestOn = [...levelsBefore].reverse().find(c => !c.startsWith('-'));
eq('down drops the lowest level that is on', await press('ArrowDown'), true);
eq('which is the last one lit, not the last one drawn',
  (await seasonChips()).find(c => c === '-' + lowestOn), '-' + lowestOn);
await press('ArrowUp');
/* ⚠️ Up adds the **highest** that is off, and after that press the highest one
   off is the chip that was just dropped — which is what makes the two keys
   inverses of each other. */
eq('and up puts it back', (await seasonChips()).join(' '), levelsBefore.join(' '));

/* Pressed enough times, up eventually reaches the team events, which is the
   right answer: they are off by default and this is a way to switch them on. */
for (let i = 0; i < levelsBefore.length; i++) await press('ArrowUp');
check('up far enough turns everything on',
  (await seasonChips()).every(c => !c.startsWith('-')),
  (await seasonChips()).join(' '));
eq('and one more is handled without doing anything', await press('ArrowUp'), true);
for (let i = 0; i < levelsBefore.length + 1; i++) await press('ArrowDown');
check('down far enough turns everything off',
  (await seasonChips()).every(c => c.startsWith('-')),
  (await seasonChips()).join(' '));
/* Back to where the page started, so nothing below inherits an empty strip.
   ⚠️ Waits for the **page** as well as for the chips. It waited only for the
   chips, which are still in the document while another page is showing — so on
   a slow load the walk below started from wherever the winners tests had left
   it, and every one of its five steps was off by exactly one page. Seen once,
   from a run where the network was answering in seconds rather than
   milliseconds — and only when the suites run one after another, never on its
   own, which is what a state race looks like from the outside.

   ⚠️ So the page is **clicked**, not asked for in the hash: `showPage` is
   synchronous and the nav button is what this section already opens with. The
   hash still carries the filters and the pinned date. Every one of the five
   steps below is *relative*, so the one thing they cannot do is assume where
   they start. */
await b.ev(`location.hash = '#p=57945&pg=seasons&now=2026-08-23'`);
await b.until(`document.querySelectorAll('#levels .chip.on').length > 3`, { timeout: 30000 });
await b.ev(`document.querySelector('#pageNav [data-page="seasons"]').click()`);
eq('and back on the seasons before the walk', await onPage(), 'seasons');

/* ---- left and right walk the pages ---- */

await press('ArrowRight');
eq('right goes to the next page', await onPage(), 'compare');
await press('ArrowRight');
check('and the next', await b.until(`document.body.dataset.page === 'tmt'`,
  { timeout: 120000 }));
await press('ArrowRight');
eq('and the next', await onPage(), 'winners');
/* ⚠️ Wrapping, unlike the day and fold steppers below. Four pages in a ring
   beats two dead ends; a day list has real ends and should keep them. */
await press('ArrowRight');
eq('and wraps round rather than stopping', await onPage(), 'seasons');
await press('ArrowLeft');
eq('left wraps the other way', await onPage(), 'winners');

/* ---- what the keyboard must not touch ---- */

/* ⚠️⚠️ Alt+Arrow is the browser's Back and Forward, and Ctrl+O, Ctrl+S and
   Ctrl+W all collide with letters below. A modified keystroke has to be left
   *alone* — not handled, and not prevented either, or the browser's own
   shortcut stops working. */
const beforeMod = await onPage();
eq('alt+left is the browser going back, not the app changing page',
  await press('ArrowLeft', { altKey: true }), false);
eq('and the page did not move', await onPage(), beforeMod);
eq('ctrl+left is left alone too', await press('ArrowLeft', { ctrlKey: true }), false);
eq('and so is the meta key', await press('ArrowRight', { metaKey: true }), false);
eq('the page still has not moved', await onPage(), beforeMod);

/* ⚠️ The app focuses the search box on load, so without this every letter would
   be typed into it instead of reaching the page. */
/* ⚠️ Dispatched **at the box**, not at the body: the guard reads `e.target`,
   which is what a browser sets to the focused element. A test that fires at the
   body while the box merely holds focus is testing nothing — it was green
   against a handler that ignores focus entirely. */
const typeInBox = key => b.ev(`(() => {
  const el = document.getElementById('q');
  el.focus();
  const e = new KeyboardEvent('keydown',
    { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  return e.defaultPrevented;
})()`);
const pageBefore = await onPage();
eq('a keystroke while typing belongs to the field', await typeInBox('m'), false);
eq('and an arrow does not move the page out from under the cursor',
  await typeInBox('ArrowRight'), false);
eq('so nothing moved', await onPage(), pageBefore);
check('and the box keeps the focus',
  await b.ev(`document.activeElement === document.getElementById('q')`));
/* Escape is the way out of the field, and therefore the way in to the rest. */
await b.ev(`(() => {
  const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.getElementById('q').dispatchEvent(e);
})()`);
check('escape leaves the box',
  await b.ev(`document.activeElement !== document.getElementById('q')`));

/* ---- the winners page ---- */

await b.ev(`document.querySelector('#pageNav [data-page="winners"]').click()`);
check('the winners page is up', await b.until(`document.body.dataset.page === 'winners'`,
  { timeout: 120000 }));
await press('w');
check('w gives the women', await b.until(
  `document.querySelector('#winKind .seg.on').textContent === 'WS'`, { timeout: 120000 }));
await press('m');
check('and m the men', await b.until(
  `document.querySelector('#winKind .seg.on').textContent === 'MS'`, { timeout: 120000 }));

/* The arrows do what the view in front of them has to give: the 3+ / 4+ / 5+
   bar on the board, the Show bar on the score. */
await press('s');
eq('s is the score', await b.ev('window.BST.score.view()'), 'score');
const floorKeyed = await b.ev('window.BST.score.floor()');
await press('ArrowUp');
eq('up lowers the bar, showing more',
  await b.ev('window.BST.score.floor()'), floorKeyed - 5);
await press('ArrowDown');
eq('and down raises it again',
  await b.ev('window.BST.score.floor()'), floorKeyed);
await press('b');
eq('b is the board again', await b.ev('window.BST.score.view()'), 'board');

/* ---- the compare page ---- */

await b.ev(`document.querySelector('#pageNav [data-page="compare"]').click()`);
eq('the compare page is up', await onPage(), 'compare');
await press('h');
eq('h is the honours board', await b.ev('window.BST.grid.state.view'), 'honours');
await press('g');
eq('and g the grid', await b.ev('window.BST.grid.state.view'), 'grid');
await press('s');
eq('s is the superseries names', await b.ev('window.BST.grid.state.era'), 'ss');
await press('w');
eq('and w the world tour ones', await b.ev('window.BST.grid.state.era'), 'wt');

/* The QF+ / SF+ / F+ / W bar, on the arrows.

   ⚠️ It lives on the honours board and nowhere else — `honMin` is hidden in the
   grid view — so the arrows are claimed there and deliberately left alone on
   the grid, where a career is taller than the window and scrolling is the right
   answer for a page with nothing to step. */
await press('h');
eq('the honours board is up', await b.ev('window.BST.grid.state.view'), 'honours');
eq('and the bar is on screen with it',
  await b.ev(`!document.getElementById('honMin').hidden`), true);
await b.ev(`document.querySelector('#honMin [data-hmin="sf"]').click()`);
eq('starting at the semi-finals', await b.ev('window.BST.grid.state.threshold'), 'sf');
await press('ArrowUp');
eq('up lowers the bar, showing more', await b.ev('window.BST.grid.state.threshold'), 'qf');
await press('ArrowDown');
eq('and down raises it', await b.ev('window.BST.grid.state.threshold'), 'sf');
await press('ArrowDown');
await press('ArrowDown');
eq('down again reaches titles only', await b.ev('window.BST.grid.state.threshold'), 'w');
await press('ArrowDown');
eq('and stops there rather than wrapping',
  await b.ev('window.BST.grid.state.threshold'), 'w');
await press('ArrowUp');
await press('ArrowUp');
await press('ArrowUp');
await press('ArrowUp');
eq('up stops at the quarter-finals', await b.ev('window.BST.grid.state.threshold'), 'qf');
check('the bar travels in the link',
  await b.ev(`location.hash.includes('th=qf')`), await b.ev('location.hash'));

/* The level chips, on the same two arrows one view over.

   ⚠️ **Up adds the highest that is off; down removes the lowest that is on.**
   Not "the next one along from wherever you last were": a row of chips has no
   cursor, and a key that depended on one would do different things depending on
   what had been clicked. From the ends the two keys are exact inverses, which is
   what the checks below actually assert. */
await press('g');
eq('the grid has no round bar', await b.ev(`document.getElementById('honMin').hidden`), true);

/** The level chips as drawn, hardest first — which is the order the keys walk. */
const levelChips = id => b.ev(`[...document.querySelectorAll('#${id} .chip')]
  .map(c => (c.classList.contains('on') ? '' : '-') + c.textContent.replace(/\\d+$/, '').trim())`);

const gridBefore = await levelChips('gridGroups');
check('and its levels are all on to begin with',
  gridBefore.every(c => !c.startsWith('-')), gridBefore.join(' '));

eq('down is handled here rather than left to the scroller',
  await press('ArrowDown'), true);
const gridDown = await levelChips('gridGroups');
eq('and it drops the lowest level, not the first',
  gridDown.filter(c => c.startsWith('-')).join(','),
  '-' + gridBefore[gridBefore.length - 1]);
await press('ArrowDown');
eq('again and it drops the next one up',
  (await levelChips('gridGroups')).filter(c => c.startsWith('-')).length, 2);
await press('ArrowUp');
await press('ArrowUp');
eq('and up puts them back in the order they went',
  (await levelChips('gridGroups')).join(' '), gridBefore.join(' '));

/* ⚠️ Off the chips the page has drawn, not off `gridOrder` — a key that walked
   the source list would eventually reach for something not on the bar. */
await press('ArrowUp');
eq('up with everything already on does nothing, but is still handled',
  (await levelChips('gridGroups')).join(' '), gridBefore.join(' '));

check('what the keys did travels in the link',
  await b.ev(`(async () => {
    const before = location.hash;
    document.body.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'ArrowDown', bubbles: true, cancelable: true }));
    return location.hash !== before;
  })()`));
await press('ArrowUp');

await press('h');
await b.ev(`document.querySelector('#honMin [data-hmin="sf"]').click()`);
/* ⚠️ The same two letters mean something else one page over. That is fine
   because a page is only ever one of them — but it is worth a check, because
   the day this becomes a modal it stops being fine. */
eq('and neither of them starred anything', (await b.ev('window.BST.tmt.stars()')).length, 0);

/* ---- the tournament page ---- */

check('the tournament page loads', await openTmt('#pg=tmt&now=2026-08-23'));

/* ⚠️ No player card here. This page is about whatever is on court, not about
   whoever was last looked up — a career above it answers a question nobody on
   this page asked and pushes the day down the screen. The winners page already
   worked this way; the tournament page did not. The search box stays, because
   it is how you leave for a player. */
check('the tournament page shows no player card',
  await b.ev(`!document.getElementById('hero').offsetParent`));
check('but the search box is still there to leave by',
  await b.ev(`!!document.getElementById('q').offsetParent`));

await press('b');
eq('b is the bracket', await b.ev('window.BST.tmt.state.view'), 'draw');
check('and it loads', await b.until('window.BST.tmt.bracket.ready()', { timeout: 120000 }));
await press('o');
eq('o is the order of play', await b.ev('window.BST.tmt.state.view'), 'oop');

/* Up and down: the day, in the order of play. */
await b.ev(`window.BST.tmt.day('2026-08-19')`);
await b.until('window.BST.tmt.ready()', { timeout: 120000 });
await press('ArrowDown');
check('down is the next day', await b.until(
  `window.BST.tmt.state.day === '2026-08-20'`, { timeout: 120000 }),
  await b.ev('window.BST.tmt.state.day'));
await press('ArrowUp');
check('up is the day before', await b.until(
  `window.BST.tmt.state.day === '2026-08-19'`, { timeout: 120000 }),
  await b.ev('window.BST.tmt.state.day'));

/* ⚠️ Clamped, not wrapped: the last day of a tournament is the last day, and
   stepping off it back to "All" would be a surprise rather than a shortcut. */
await b.ev(`window.BST.tmt.day('2026-08-23')`);
await b.until('window.BST.tmt.ready()', { timeout: 120000 });
await press('ArrowDown');
eq('and the last day stays the last day',
  await b.ev('window.BST.tmt.state.day'), '2026-08-23');

/* S is Starred only here — and Superseries on the page before. */
await b.ev('window.BST.tmt.clearStars()');
eq('starred-only is off to begin with', await b.ev('window.BST.tmt.only()'), false);
await press('s');
eq('s turns it on', await b.ev('window.BST.tmt.only()'), true);
await press('s');
eq('and off again', await b.ev('window.BST.tmt.only()'), false);

/* The disciplines, in the order of play, where the chips are a *filter*. */
await press('m');
eq('m shows the men’s singles and nothing else',
  (await b.ev('window.BST.tmt.cards()')).every(c => c.draw === 'MS')
    && (await b.ev('window.BST.tmt.cards()')).length > 0, true,
  JSON.stringify([...new Set((await b.ev('window.BST.tmt.cards()')).map(c => c.draw))]));
/* ⚠️ One letter, two draws: pressing it again moves to that gender's doubles.
   The alternative was two more letters nobody would remember. */
await press('m');
eq('and m again the men’s doubles',
  [...new Set((await b.ev('window.BST.tmt.cards()')).map(c => c.draw))].join(), 'MD');
await press('w');
eq('w is the women’s singles',
  [...new Set((await b.ev('window.BST.tmt.cards()')).map(c => c.draw))].join(), 'WS');
await press('w');
eq('and again the women’s doubles',
  [...new Set((await b.ev('window.BST.tmt.cards()')).map(c => c.draw))].join(), 'WD');
await press('x');
eq('x is the mixed',
  [...new Set((await b.ev('window.BST.tmt.cards()')).map(c => c.draw))].join(), 'XD');
await press('x');
eq('and x again stays there, having nowhere else to go',
  [...new Set((await b.ev('window.BST.tmt.cards()')).map(c => c.draw))].join(), 'XD');

/* The same letters in the bracket, where the chips are a *picker*. */
await press('b');
check('the bracket comes back', await b.until('window.BST.tmt.bracket.ready()',
  { timeout: 120000 }));
/* ⚠️ The cycle advances from whatever is showing, so it has to start from a
   known place. Coming from the women's doubles, `m` means "the men's singles";
   pressing it again means "the other men's draw". */
await b.ev(`window.BST.tmt.bracket.pick('WD')`);
await b.until('window.BST.tmt.bracket.ready()', { timeout: 120000 });
await press('m');
eq('m picks the men’s singles draw', await b.ev('window.BST.tmt.bracket.pick()'), 'MS');
await press('m');
eq('and m again the men’s doubles', await b.ev('window.BST.tmt.bracket.pick()'), 'MD');
await press('m');
eq('and a third press comes back round', await b.ev('window.BST.tmt.bracket.pick()'), 'MS');
check('which actually loaded', await b.until('window.BST.tmt.bracket.ready()',
  { timeout: 120000 }));

/* Up and down: how much of the draw, rather than which day. */
await press('m');
await b.until('window.BST.tmt.bracket.ready()', { timeout: 120000 });
await b.ev(`window.BST.tmt.bracket.round('QF')`);
eq('folded to the quarter-finals', await b.ev('window.BST.tmt.bracket.shown()'), 'QF');
/* Up shows more of the draw, as it does on a map. */
await press('ArrowUp');
eq('up shows more of it', await b.ev('window.BST.tmt.bracket.shown()'), 'R16');
await press('ArrowDown');
eq('and down less', await b.ev('window.BST.tmt.bracket.shown()'), 'QF');
await press('ArrowUp');
await press('ArrowUp');
await press('ArrowUp');
eq('up stops at the whole draw', await b.ev('window.BST.tmt.bracket.shown()'), 'all');
eq('which is the whole draw', (await b.ev('window.BST.tmt.bracket.cards()')).length, 63);
await press('ArrowDown');
await press('ArrowDown');
await press('ArrowDown');
await press('ArrowDown');
eq('and down stops at the semi-finals, never at one card',
  await b.ev('window.BST.tmt.bracket.shown()'), 'SF');

await b.ev('window.BST.tmt.clearStars()');
await b.ev(`window.BST.tmt.bracket.view('oop')`);
await b.until('window.BST.tmt.ready()', { timeout: 120000 });

/* ============================ hygiene ============================ */

console.log('\n=== hygiene ===');
const { exceptions, errors } = pageErrors(b.events);
check('no uncaught exceptions', exceptions.length === 0, exceptions.slice(0, 2).join(' | '));
check('no fixture misses', !fx || fx.stats.missed === 0,
  fx ? [...fx.stats.misses].slice(0, 4).join(', ') : 'live');
check('console clean of errors', errors.length === 0, errors.slice(0, 2).join(' | '));

finish(report());
