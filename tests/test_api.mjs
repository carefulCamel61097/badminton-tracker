/* The request layer, against a stubbed fetch. No browser, no network.
 *
 * What is checked here is mostly *etiquette*, which is the part of this project
 * that is not allowed to regress quietly: BWF's API is undocumented, unowned by
 * us, and rate-limits bursts at around a dozen rapid requests. A change that
 * accidentally parallelises the queue would still pass every other suite and
 * would still look fine locally — right up until BWF started refusing us.
 */

// sessionStorage does not exist in Node, and api.js is written to degrade to an
// uncached client when it is missing. Give it one so the cache can be tested.
/* @W@ `length` and `key(i)` are here because they are part of the real thing,
   and the season evictor walks the store with them. A stub that only did
   get/set/remove would have made a cache that cannot find what to drop look
   like one that works.

   `cap` is the other half: a real store throws when it is full, and swallowing
   that quietly is the failure the season cache is written against. */
function webStorageStub() {
  const m = new Map();
  const s = {
    cap: Infinity,                   // not part of the real API; for assertions
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      const would = [...m].reduce((n, [kk, vv]) =>
        n + (kk === k ? 0 : kk.length + String(vv).length), 0) + k.length + String(v).length;
      if (would > s.cap) {
        const e = new Error('QuotaExceededError');
        e.name = 'QuotaExceededError';
        throw e;
      }
      m.set(k, String(v));
    },
    removeItem: k => m.delete(k),
    clear: () => { m.clear(); s.cap = Infinity; },
    keys: () => [...m.keys()],       // not part of the real API; for assertions
    key: i => [...m.keys()][i],
  };
  Object.defineProperty(s, 'length', { get: () => m.size });
  return s;
}
globalThis.sessionStorage = webStorageStub();
globalThis.localStorage = webStorageStub();

const { getJSON, loadSeason, loadLastMatch, loadWorldRank, loadRaceRank, ageOn, API,
  seasonTtl, seasonsHeld, forgetSeasons } = await import('../api.js');
const { check, eq, report } = await import('./check.mjs');

/* ============================ the fetch stub ============================ */

const calls = [];                 // {url, at}
let responder = () => ({ ok: true, body: '{"results":[]}' });

globalThis.fetch = async url => {
  calls.push({ url, at: Date.now() });
  const r = responder(url, calls.length);
  return {
    ok: r.ok !== false,
    text: async () => (r.body === undefined ? '{}' : r.body),
  };
};

const reset = () => { calls.length = 0; sessionStorage.clear(); localStorage.clear(); };

/* ============================ URLs ============================ */

console.log('=== requests are built the way BWF expects ===');
reset();
await loadSeason(57945, 2025);
eq('one request', calls.length, 1);
eq('the season endpoint, with the year as a parameter',
  calls[0].url,
  `${API}/vue-player-tournaments?playerId=57945&isPara=0&drawCount=1&activeTab=0&tmtYear=2025`);
check('drawCount=1 is sent, which is what makes results a plain array',
  /drawCount=1/.test(calls[0].url));

reset();
await loadSeason(57945, 2026);
check('a different year is a different request, not a cache hit',
  /tmtYear=2026/.test(calls[0].url), calls[0].url);

/* ============================ serialisation and pacing ============================ */

console.log('\n=== requests are serialised and paced ===');
reset();
const t0 = Date.now();
await Promise.all([
  getJSON('a', { n: 1 }),
  getJSON('b', { n: 2 }),
  getJSON('c', { n: 3 }),
]);
eq('all three went out', calls.length, 3);
const gaps = calls.slice(1).map((c, i) => c.at - calls[i].at);
check('never two at once — each waits for the one before',
  gaps.every(g => g >= 300), 'gaps: ' + gaps.join(', ') + 'ms');
check('the whole burst took at least two gaps',
  Date.now() - t0 >= 640, `${Date.now() - t0}ms`);

/* ============================ lanes ============================ */

console.log('\n=== the fast lane goes first ===');
reset();
const seen = [];
const tag = p => getJSON(p, {}).then(() => seen.push(p));
const first = tag('busy');           // occupies the lane immediately
await new Promise(r => setTimeout(r, 10));
const low = getJSON('background', {}, { priority: 'low' }).then(() => seen.push('background'));
const high = getJSON('clicked', {}, { priority: 'high' }).then(() => seen.push('clicked'));
await Promise.all([first, low, high]);
eq('what the user clicked jumps the background work',
  seen.join(' > '), 'busy > clicked > background');

/* ============================ the cache ============================ */

console.log('\n=== the cache ===');
reset();
await getJSON('cached', { x: 1 });
await getJSON('cached', { x: 1 });
eq('an identical request is served from the cache', calls.length, 1);

await getJSON('cached', { x: 1 }, { fresh: true });
eq('a fresh request goes to the network anyway', calls.length, 2);
await getJSON('cached', { x: 1 });
eq('and repopulates the cache for everyone else', calls.length, 2);

reset();
await getJSON('perishable', {});
await getJSON('ranked', {}, { persist: true });
check('ranking data goes to the store that survives a reload',
  localStorage.keys().some(k => k.includes('ranked')), localStorage.keys().join(', '));
check('and ordinary data does not clutter it',
  !localStorage.keys().some(k => k.includes('perishable')), localStorage.keys().join(', '));
check('which is where it lives instead',
  sessionStorage.keys().some(k => k.includes('perishable')));
await getJSON('ranked', {}, { persist: true });
eq('a persisted request is cached too', calls.length, 2);

/* =================== the seasons a reader has already paid for ===========

   A career is one request per year, and twenty of those twenty-one answers are
   never going to change again. This is the cache that stops asking for them.
   ==================================================================== */

console.log('\n=== a finished season is kept, and kept parsed ===');

const YEAR = new Date().getFullYear();
const SEASON = JSON.stringify({ results: [{
  tournament_id: 7, tmt_url: 'https://bwfbadminton.com/x',
  draws: [{ name: 'MS', position: '1st', match_win: 5, match_lose: 0 }],
  tournament_model: { id: 7, name: 'Some Open 2012', tournament_category_id: 23,
    start_date: '2012-03-05 00:00:00', end_date: '2012-03-10 00:00:00' },
}] });

reset();
responder = () => ({ ok: true, body: SEASON });
const kept = await loadSeason(50152, 2012);
eq('the season came back', kept.length, 1);
eq('one request for it', calls.length, 1);
const again = await loadSeason(50152, 2012);
eq('and the second reader pays nothing', calls.length, 1);
eq('for the same season', again.length, 1);
eq('parsed, not raw, so the strip can use it as it stands', again[0].name, 'Some Open 2012');
eq('with its result intact', again[0].draws[0].position, '1st');

/* ⚠️⚠️ **It has to survive the tab closing**, which is the whole point: a career
   is twenty-one serialised requests and a reader who comes back tomorrow should
   not pay for them a second time. sessionStorage would not do. */
check('it lives in the store that survives a reload',
  localStorage.keys().some(k => k.startsWith('bst:s:50152:2012')),
  localStorage.keys().join(', '));

/* ⚠️ And the payload it was parsed out of is *not* also kept. Measured over the
   recorded fixtures, the raw form is nine to ten times the size of the parsed
   one and nothing ever reads it twice, so storing both would fill a budget with
   the copy nobody looks at. */
check('and the raw payload is not kept anywhere',
  !localStorage.keys().some(k => k.includes('vue-player-tournaments'))
  && !sessionStorage.keys().some(k => k.includes('vue-player-tournaments')),
  [...localStorage.keys(), ...sessionStorage.keys()].join(', '));

/* An empty year is an answer too, and a career walk asks a lot of them: a player
   who retired in 2020 is asked about six years they never played. */
reset();
responder = () => ({ ok: true, body: '{"results":[]}' });
eq('a year the player did not play comes back empty', (await loadSeason(50152, 2011)).length, 0);
eq('and that is worth keeping as much as a full one', calls.length, 1);
await loadSeason(50152, 2011);
eq('so it is not asked twice', calls.length, 1);

console.log('\n=== the season being played now is not ===');

/* ⚠️ The one season that can still change. Everything else here has no expiry
   at all, because a time-to-live is a guess at how long a fact stays true and a
   finished season does not stop being true. */
eq('a finished season is kept for ever', seasonTtl(2012, YEAR), null);
eq('and last season too', seasonTtl(YEAR - 1, YEAR), null);
check('the running one gets a short life', seasonTtl(YEAR, YEAR) > 0);
check('and so does one somehow in the future', seasonTtl(YEAR + 1, YEAR) > 0);

reset();
responder = () => ({ ok: true, body: SEASON });
await loadSeason(50152, YEAR);
await loadSeason(50152, YEAR);
eq('it is still cached within its few minutes', calls.length, 1);

/* `fresh` is the way past a stored season without waiting for one, the same
   escape the rest of the request layer offers.

   ⚠️ Counted with `calls.length = 0` rather than `reset()`, which also clears
   the store — a check that empties the cache and then finds it empty is not
   checking anything. */
reset();
await loadSeason(50152, 2012);
calls.length = 0;
await loadSeason(50152, 2012);
eq('a stored season answers', calls.length, 0);
await loadSeason(50152, 2012, { fresh: true });
eq('and fresh overrules it', calls.length, 1);
calls.length = 0;
await loadSeason(50152, 2012);
eq('and leaves a fresher copy behind it', calls.length, 0);

console.log('\n=== a stored season answers every caller ===');

/* ⚠️⚠️ The team ties are stored and filtered on the way out. A copy written by a
   caller that did not want them would quietly hide them from one that does. */
reset();
responder = () => ({ ok: true, body: JSON.stringify({ results: [
  { tournament_id: 1, draws: [{ name: 'MS', position: '1st', match_win: 5, match_lose: 0 }],
    tournament_model: { id: 1, name: 'An Open 2013', tournament_category_id: 23,
      start_date: '2013-03-05 00:00:00' } },
  { tournament_id: 2, draws: [{ name: 'SINGLES', position: 'N/A', match_win: 2, match_lose: 1 }],
    tournament_model: { id: 2, name: 'Thomas Cup 2013', tournament_category_id: 21,
      start_date: '2013-05-05 00:00:00' } },
] }) });
const withTies = await loadSeason(50152, 2013);
eq('the first caller sees the team tie', withTies.length, 2);
const without = await loadSeason(50152, 2013, { includeTeam: false });
eq('and one that asked for none does not', without.length, 1);
eq('without a second request', calls.length, 1);
const withTiesAgain = await loadSeason(50152, 2013);
eq('and the tie is still there for the next reader', withTiesAgain.length, 2);

console.log('\n=== a full store makes room rather than giving up ===');

/* ⚠️⚠️ **The failure this is written against.** `cacheSet` swallows a quota
   error, which is right for a five-minute copy of one payload and wrong for a
   season that never expires: the store would fill once and every career after
   it would go uncached for ever, with nothing to say so. So a failed write
   drops the oldest quarter and tries again. */
reset();
responder = () => ({ ok: true, body: SEASON });
for (const year of [2001, 2002, 2003, 2004]) await loadSeason(60000, year);
const before = seasonsHeld();
eq('four seasons held', before.seasons, 4);
check('and it can say how much that is', before.bytes > 0, before.bytes + ' bytes');

// Room for about three of them, so the fifth cannot simply be added.
localStorage.cap = Math.round(before.bytes * 0.8);
await loadSeason(60000, 2005);
const after = seasonsHeld();
check('the newest season was stored anyway',
  localStorage.keys().some(k => k.startsWith('bst:s:60000:2005')),
  localStorage.keys().join(', '));
check('by dropping some of the oldest rather than giving up',
  after.seasons <= before.seasons && after.seasons >= 2, after.seasons + ' held');
check('and what went is what had been stored longest',
  !localStorage.keys().some(k => k.startsWith('bst:s:60000:2001')),
  localStorage.keys().join(', '));

/* ⚠️⚠️ **One round of eviction is not enough.** Dropping a quarter of a
   store that is a hair too full leaves it a hair too full, and the season that
   prompted the eviction is the one that goes missing. Squeezed to the width of
   a single season, the newest still has to land. */
localStorage.cap = Math.round(before.bytes / 3);
await loadSeason(60000, 2006);
check('however tight it gets, the season just read is the one kept',
  localStorage.keys().some(k => k.startsWith('bst:s:60000:2006')),
  localStorage.keys().join(', '));

localStorage.cap = Infinity;

console.log('\n=== and there is a way to drop the lot ===');

/* ⚠️ BWF does occasionally correct an old result, and a cache with no expiry
   needs an answer to that which is not "wait for a release". */
reset();
responder = () => ({ ok: true, body: SEASON });
await loadSeason(60000, 2007);
const dropped = forgetSeasons();
check('every stored season goes', dropped > 0, dropped + ' dropped');
eq('and the store says so', seasonsHeld().seasons, 0);
reset();
await loadSeason(60000, 2007);
eq('so the next read asks BWF again', calls.length, 1);

/* ⚠️ It takes the seasons and nothing else. The ranking tables live in the same
   store on a twelve-hour life and are not this cache's to throw away. */
reset();
await getJSON('ranked-too', {}, { persist: true });
forgetSeasons();
check('the ranking cache is left alone',
  localStorage.keys().some(k => k.includes('ranked-too')), localStorage.keys().join(', '));

/* ============================ rate limiting ============================ */

console.log('\n=== a rate-limit rejection is retried, not surfaced ===');
reset();
responder = (url, n) => (n === 1 ? { ok: true, body: '' } : { ok: true, body: '{"results":[1]}' });
const recovered = await getJSON('flaky', {});
eq('it tried twice', calls.length, 2);
check('and got the answer', Array.isArray(recovered.results));
check('the retry waited rather than hammering',
  calls[1].at - calls[0].at >= 1000, `${calls[1].at - calls[0].at}ms`);

reset();
responder = () => ({ ok: true, body: '' });
let failure = null;
try { await getJSON('dead', {}); } catch (e) { failure = e; }
check('a request that never comes back throws', !!failure, failure && failure.message);
check('and names the endpoint, so a broken one is identifiable',
  failure && /dead/.test(failure.message), failure && failure.message);
eq('after exactly one retry — no unbounded loop', calls.length, 2);

reset();
responder = (url, n) => (n === 1 ? { ok: false } : { ok: true, body: '{"ok":1}' });
await getJSON('http500', {});
eq('a bad status is retried the same way', calls.length, 2);

responder = () => ({ ok: true, body: '{"results":[]}' });

/* ============================ age ============================ */

console.log('\n=== age ===');
const on = (dob, ymd) => ageOn(dob, new Date(ymd + 'T12:00:00Z'));
eq('BWF sends a datetime, not a date', on('1996-02-28 00:00:00', '2026-08-22'), 30);
eq('the day before a birthday is still the year before', on('1996-08-23', '2026-08-22'), 29);
eq('the birthday itself counts', on('1996-08-22', '2026-08-22'), 30);
// Subtracting milliseconds and dividing by 365.25 gets this wrong: it is a
// calendar question, so it is answered on the calendar.
eq('born on a leap day, before the 29th', on('2004-02-29', '2026-02-28'), 21);
eq('and on the 1st of March', on('2004-02-29', '2026-03-01'), 22);
eq('nothing usable gives nothing', ageOn(null), null);
eq('and neither does junk', ageOn('not a date'), null);

/* ============================ rankings ============================ */

console.log('\n=== the world ranking ===');
reset();
responder = () => ({ ok: true, body: '{"results":12}' });
eq('a rank comes back as a number', await loadWorldRank(57945, 6), 12);
eq('asked of the current-ranking endpoint',
  calls[0].url,
  `${API}/vue-player-ranking-current?playerId=57945&isPara=0&rankingEvent=6`);

reset();
responder = () => ({ ok: true, body: '{"results":"-"}' });
eq('a dash is not a ranking', await loadWorldRank(70762, 10), null);
reset();
responder = () => ({ ok: true, body: '{"results":null}' });
eq('nor is nothing', await loadWorldRank(70762, 10), null);

console.log('\n=== the race to finals ===');
// There is no race variant of the current-ranking endpoint — it answers for the
// world categories and returns "-" for everything else — so the standing comes
// out of the ranking table instead.
const raceRow = (p1, p2, rank) => ({
  rank, player1_id: p1, player2_id: p2,
  player1_model: { id: p1, name_display_bold: '<span>A</span>' },
  player2_model: p2 ? { id: p2, name_display_bold: '<span>B</span>' } : null,
});

reset();
responder = () => ({ ok: true, body: JSON.stringify({ results: [raceRow(57945, null, 20)] }) });
eq('the race standing is read off the table', await loadRaceRank(57945, 'SHI Yu Qi', 57), 20);
check('searched on the whole displayed name, which this endpoint accepts',
  /searchKey=SHI\+Yu\+Qi/.test(calls[0].url), calls[0].url);
check('against the race board, not the world one',
  /rankId=9&catId=57/.test(calls[0].url), calls[0].url);

reset();
responder = () => ({ ok: true, body: JSON.stringify({
  results: [raceRow(11111, 22222, 3), raceRow(68544, 70762, 5), raceRow(33333, null, 9)] }) });
eq('the right row is found by id, not by position', await loadRaceRank(68544, 'GICQUEL', 61), 5);
eq('including when the player is the second half of the pair',
  await loadRaceRank(70762, 'DELRUE', 61), 5);
eq('and somebody not in the table has no standing',
  await loadRaceRank(99999, 'NOBODY', 61), null);

reset();
eq('no name means no search', await loadRaceRank(57945, '', 57), null);
eq('and no request either', calls.length, 0);

responder = () => ({ ok: true, body: '{"results":[]}' });

/* ============================ the partner lookup ============================ */

console.log('\n=== the partner comes from the last match ===');

// The real payload: results is a single match object, not an array, and the
// player asked about may be on either side of it.
const match = t2 => ({
  results: {
    round_name: 'SF',
    draw_model: { id: 50894, name: 'XD' },
    t1p1_player_model: { id: 65267, name_display: 'FENG Yan Zhe' },
    t1p2_player_model: { id: 89426, name_display: 'HUANG Dong Ping' },
    t2p1_player_model: { id: 68544, name_display: 'Thom GICQUEL' },
    t2p2_player_model: { id: t2, name_display: 'Delphine DELRUE' },
  },
});

reset();
responder = () => ({ ok: true, body: JSON.stringify(match(70762)) });
const second = await loadLastMatch(70762);
eq('a single-object results is understood', second && second.discipline, 'XD');
eq('the partner is the other half of *my* pair', second.partner.name, 'Thom GICQUEL');
eq('and the opponents are the other pair', second.opponents.length, 2);
check('opponents are not my partner',
  !second.opponents.some(p => p.id === second.partner.id),
  JSON.stringify(second.opponents));

reset();
const firstNamed = await loadLastMatch(68544);
eq('asking as the first-named half works too', firstNamed.partner.name, 'Delphine DELRUE');

reset();
eq('a player who is not in the match yields nothing rather than a wrong partner',
  await loadLastMatch(99999), null);

reset();
responder = () => ({ ok: true, body: '{"results":null}' });
eq('and so does an empty one', await loadLastMatch(70762), null);

process.exit(report());
