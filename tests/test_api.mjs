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
function webStorageStub() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
    keys: () => [...m.keys()],       // not part of the real API; for assertions
  };
}
globalThis.sessionStorage = webStorageStub();
globalThis.localStorage = webStorageStub();

const { getJSON, loadSeason, loadLastMatch, loadWorldRank, loadRaceRank, ageOn, API } =
  await import('../api.js');
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
