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

/* The roster the suites actually click on. A singles player, a doubles pair
   (both halves — a doubles ranking only resolves against player1_id), and a
   couple of others for variety in tournament level and season length. */
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
const years = yearArg >= 0 ? args[yearArg + 1].split(',') : ['2026'];
const players = args.filter(a => /^\d+$/.test(a)).map(Number);
const roster = players.length ? players : DEFAULT_PLAYERS;

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

await b.send('Page.navigate', { url: `http://localhost:${PORT}/#p=${roster[0]}&y=${years[0]}` }, b.sessionId);
const up = await b.until('!!window.BST', { timeout: 40000 });
if (!up) bail(new Error('the app never initialised — is Chrome being served the page?'));

for (const player of roster) {
  for (const year of years) {
    process.stdout.write(`  ${player} ${year} … `);
    const before = fixtureCount();

    await b.ev(`location.hash = '#p=${player}&y=${year}'`);
    // The season, then the partner lookup behind it on the low lane. If a
    // player has no recorded match the second never resolves, so this waits on
    // the queue draining rather than on the data arriving.
    const ok = await b.until('!!window.BST && window.BST.ready', { timeout: 60000 });
    await b.wait(2500);

    const err = await b.ev('window.BST.state.error');
    const n = await b.ev('(window.BST.season() || []).length');
    console.log(`${ok ? '' : 'timeout '}${n} tournaments, `
      + `+${fixtureCount() - before} fixtures${err ? '  [' + err.slice(0, 60) + ']' : ''}`);
  }
}

finish(0);
