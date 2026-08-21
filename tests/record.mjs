/* Fill the fixture set by driving one wide session against the live API.
 *
 *   node tests/record.mjs                 the default roster
 *   node tests/record.mjs 57945 87442     specific players
 *   node tests/record.mjs --years 2024,2025,2026
 *
 * Politeness matters more here than anywhere else in the project: this is the
 * one script whose whole job is to make real requests. It drives the app rather
 * than fetching directly, so every call still goes through the same serialised,
 * 320ms-paced queue that ships — recording is not an excuse to burst.
 *
 * Anything a suite later asks for and this did not record simply falls through
 * to the network on replay and is reported, so this does not have to be perfect
 * on the first pass.
 */
import { fileURLToPath } from 'node:url';

import { createServer } from '../serve.mjs';
import { launch } from './browser.mjs';
import { installFixtures, fixtureCount } from './fixtures.mjs';

const PORT = 8810, DBG = 9420;
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/* The roster the suites actually click on: a singles career, a player who
   plays both disciplines, an Olympic champion, and a veteran whose career
   reaches back into the Superseries era. */
const DEFAULT_PLAYERS = [
  57945,   // SHI Yu Qi        MS
  87442,   // AN Se Young      WS
  70762,   // Delphine DELRUE  XD, second-named
  68544,   // Thom GICQUEL     XD, first-named
  81599,   // LIU Sheng Shu    WD
  59880,   // TAN Ning         WD
];

const args = process.argv.slice(2);
const yearArg = args.indexOf('--years');
const years = yearArg >= 0 ? args[yearArg + 1].split(',') : [null];   // null = the whole career
// Skip the value belonging to --years, or `--years 2017` records a season for
// the player with id 2017 as well. Guarded on yearArg >= 0: indexOf returns -1
// when the flag is absent, and -1 + 1 is the first real argument.
const players = args
  .filter((a, i) => /^\d+$/.test(a) && !(yearArg >= 0 && i === yearArg + 1))
  .map(Number);
const roster = args.includes('--searches') ? []
  : players.length ? players : DEFAULT_PLAYERS;

const server = createServer(ROOT);
await new Promise(r => server.listen(PORT, r));

const b = await launch({ port: DBG, tag: 'record', windowSize: '1600,1100' });
const fx = await installFixtures(b.send, b.sessionId, { record: true });
b.on(fx.handle);

const finish = code => {
  console.log(`\n${fixtureCount()} fixtures on disk`);
  b.close();
  server.close();
  process.exit(code);
};
const bail = e => { console.log('EXC ' + (e && e.message ? e.message : e)); finish(1); };
process.on('uncaughtException', bail);
process.on('unhandledRejection', bail);

console.log(`recording ${roster.length} player(s) × ${years.length} year(s)`
  + `  — ${fixtureCount()} fixtures to start\n`);

// With --searches there is no roster, and `#p=undefined` would send the app
// walking twenty years for a player who does not exist.
await b.send('Page.navigate',
  { url: `http://localhost:${PORT}/` + (roster[0] ? `#p=${roster[0]}` : '') }, b.sessionId);
const up = await b.until('!!window.BST', { timeout: 40000 });
if (!up) bail(new Error('the app never initialised — is Chrome being served the page?'));

for (const player of roster) {
  for (const year of years) {
    process.stdout.write(`  ${player}${year ? ' ' + year : ''} … `);
    const before = fixtureCount();

    await b.ev(`location.hash = '#p=${player}'`);
    // A career is one request per year, so this can take a couple of minutes.
    const ok = await b.until('!!window.BST && window.BST.ready', { timeout: 240000 });

    // Ladders load only for rows that have scrolled into view, so walk the page
    // to the bottom and let every row ask.
    let last = -1;
    for (let i = 0; i < 40; i++) {
      await b.ev('window.scrollTo(0, document.body.scrollHeight)');
      await b.until('window.BST.ready', { timeout: 240000 });
      const got = await b.ev('window.BST.state.draws.size');
      if (got === last) break;
      last = got;
    }

    const err = await b.ev('window.BST.state.error');
    const n = await b.ev('(window.BST.seasons() || []).length');
    const t = await b.ev('(window.BST.seasons() || []).reduce((a, s) => a + s.tournaments.length, 0)');
    console.log(`${ok ? '' : 'timeout '}${n} seasons, ${t} tournaments, `
      + `+${fixtureCount() - before} fixtures${err ? '  [' + err.slice(0, 60) + ']' : ''}`);
  }
}

/* The player search the suites type into. Driven through the real input rather
   than called directly, so what is recorded is the request the app makes. */
const QUERIES = ['axelsen', 'shi', 'delrue', 'popov', 'an se young'];
process.stdout.write(`  searches (${QUERIES.length}) … `);
{
  const before = fixtureCount();
  for (const q of QUERIES) {
    // Clear first: the wait below is for suggestions to *become* non-null, and
    // the previous query has left them non-null already. Without this every
    // query but the last is overtaken before its request is ever made.
    await b.ev(`(() => {
      const i = document.getElementById('q');
      i.value = '';
      i.dispatchEvent(new Event('input'));
    })()`);
    await b.until('window.BST.suggestions() === null', { timeout: 10000 });

    await b.ev(`(() => {
      const i = document.getElementById('q');
      i.value = ${JSON.stringify(q)};
      i.dispatchEvent(new Event('input'));
    })()`);
    await b.until('window.BST.suggestions() !== null', { timeout: 30000 });
    await b.wait(400);
  }
  console.log(`+${fixtureCount() - before} fixtures`);
}

finish(0);
