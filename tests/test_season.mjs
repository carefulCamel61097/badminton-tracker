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

/* ============================ the player search ============================ */

console.log('=== a player is found by name, not by id ===');
check('the page opens on a search box, with no id anywhere',
  await b.ev(`document.getElementById('q').type === 'search'`));
check('and focuses it, because it is the only thing to do first',
  await b.ev(`document.activeElement === document.getElementById('q')`));

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

await b.ev(`document.querySelector('#topList .pl').click()`);
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
  await b.ev(`!document.getElementById('gridModal').hasAttribute('open')`));

/* All three readings are named in the hero. The grid and the board used to be
   behind one button labelled "Grid & compare", which named neither of them. */
const picks = await b.ev(`[...document.querySelectorAll('#viewPick [data-open]')]
  .map(b => b.dataset.open + (b.classList.contains('on') ? '*' : ''))`);
eq('the hero offers all three views by name', picks.join(' '), 'seasons* grid honours');

await b.ev(`document.querySelector('#viewPick [data-open="grid"]').click()`);
check('the grid button opens the grid', await b.ev('window.BST.grid.isOpen()'));
eq('and the hero says so', await b.ev(`window.BST.honours.view()`), 'grid');

const sections = await b.ev('window.BST.grid.sections()');
const gYears = await b.ev('window.BST.grid.years()');
const cards = await b.ev('window.BST.grid.cards()');
const width = sections.reduce((a, s) => a + s.n, 0);

eq('one card, for one player', cards.length, 1);
eq('a row per season', cards[0].years.length, gYears.length);
eq('newest at the top, the same way round as the strip',
  cards[0].years[0] > cards[0].years[cards[0].years.length - 1], true);
eq('a cell per slot per row', cards[0].cells.length, gYears.length * width);

/* The counts the whole redesign was for: a level is as wide as the busiest
   season, not one column per tournament that has ever carried a different name. */
const secN = g => (sections.find(s => String(s.group) === String(g)) || {}).n;
eq('four Super 1000 slots', secN(23), 4);
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
eq('the rightmost is the unmapped era', sections[sections.length - 1].group, 'OTHER');

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
eq('four cells in the Super 1000 block', s1000.length, 4);
eq('three titles then the semi, in that order',
  s1000.map(c => c.tier).join(' '), 'w w w sf');
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

console.log('\n=== levels can be switched out ===');

const gChips = await b.ev(`[...document.querySelectorAll('#gridGroups .chip')].map(c => ({
  group: c.dataset.group, on: c.getAttribute('aria-pressed') === 'true',
  label: c.textContent }))`);
check('every level present has a toggle', gChips.length >= 6, gChips.map(c => c.label).join(' '));
check('and they all start on', gChips.every(c => c.on));
check('the Olympics are one of them', gChips.some(c => c.group === 'OLY'));

await b.ev(`document.querySelector('#gridGroups .chip[data-group="OTHER"]').click()`);
const trimmed = await b.ev('window.BST.grid.cards()');
check('switching the unmapped era off narrows every row',
  trimmed[0].cells.length < cards[0].cells.length,
  `${trimmed[0].cells.length} vs ${cards[0].cells.length}`);
eq('the rows are still all there', trimmed[0].years.length, cards[0].years.length);
check('and the tier band loses that segment',
  !trimmed[0].tiers.includes('OTH'), trimmed[0].tiers.join(' | '));
await b.ev(`document.querySelector('#gridGroups .chip[data-group="OTHER"]').click()`);

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
  await b.ev(`location.hash.includes('c=87442') && location.hash.includes('g=1')`),
  await b.ev('location.hash'));

await b.ev(`document.getElementById('cmpDrop').click()`);
eq('and it can be dropped again', (await b.ev('window.BST.grid.cards()')).length, 1);
check('which takes it back out of the link',
  await b.ev(`!location.hash.includes('c=')`), await b.ev('location.hash'));

await b.ev(`document.getElementById('gridClose').click()`);
check('the grid closes', await b.ev(`!window.BST.grid.isOpen()`));
check('and the strip underneath is untouched', (await squares(2026)).length > 0);

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

check('the board opens straight from a link', await open('#p=57945&g=1&v=h'));
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
check('with the Continental row directly above the first of them',
  board[firstSup - 1] && board[firstSup - 1].group === '11',
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
check('and his empty half says he never entered one, not that he never placed',
  /never played at this level/.test(s100.empty[0] || ''), s100.empty[0]);

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
await b.ev(`document.getElementById('gridClose').click()`);
check('and the modal closes on either view', await b.ev(`!window.BST.grid.isOpen()`));
check('which puts the hero back on the seasons',
  await b.ev(`document.querySelector('#viewPick [data-open="seasons"]')
    .classList.contains('on')`));

/* Straight to the board from the hero, without going through the grid first —
   the whole point of naming it out there. */
await b.ev(`document.querySelector('#viewPick [data-open="honours"]').click()`);
check('the honours button opens the board directly',
  await b.ev(`window.BST.grid.isOpen() && window.BST.honours.view() === 'honours'`));
check('and the hero follows it',
  await b.ev(`document.querySelector('#viewPick [data-open="honours"]')
    .classList.contains('on')`));
check('the slider is pointed at the board, not the grid',
  await b.ev(`Number(document.getElementById('gridZoom').max) === 16`),
  await b.ev(`document.getElementById('gridZoom').max`));
await b.ev(`document.querySelector('#viewPick [data-open="seasons"]').click()`);
check('and seasons closes it again', await b.ev(`!window.BST.grid.isOpen()`));

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

/* ============================ hygiene ============================ */

console.log('\n=== hygiene ===');
const { exceptions, errors } = pageErrors(b.events);
check('no uncaught exceptions', exceptions.length === 0, exceptions.slice(0, 2).join(' | '));
check('no fixture misses', !fx || fx.stats.missed === 0,
  fx ? [...fx.stats.misses].slice(0, 4).join(', ') : 'live');
check('console clean of errors', errors.length === 0, errors.slice(0, 2).join(' | '));

finish(report());
