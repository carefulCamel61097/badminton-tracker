/* Screenshot the app, so a change to the strip can actually be looked at.
 *
 *   node tools/shot.mjs                          the default pair
 *   node tools/shot.mjs "#p=87442&y=2026"        any hash
 *
 * Writes PNGs to tests/shots/ (gitignored). The API is replayed from fixtures,
 * so this is fast, offline and shows the same seasons every time — which is
 * what makes two shots comparable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from '../serve.mjs';
import { launch, sweepProfiles } from '../tests/browser.mjs';
import { installFixtures } from '../tests/fixtures.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = path.join(ROOT, 'tests', 'shots');
const PORT = 8797, DBG = 9457;

const DEFAULTS = [
  ['career', '#p=57945'],                 // a singles career
  ['doubles', '#p=72885&k=doubles'],      // a player who plays both
  ['grid', '#p=57945&g=1'],               // the same career as a grid
  ['compare', '#p=57945&g=1&c=87442'],    // two careers side by side
];

/** The grid is a modal and needs the width; the strip does not. */
const wide = hash => /(^|&)g=1/.test(hash);

const args = process.argv.slice(2).filter(a => a.startsWith('#'));
const shots = args.length ? args.map((h, i) => [`shot${i + 1}`, h]) : DEFAULTS;

fs.mkdirSync(SHOTS, { recursive: true });
sweepProfiles({ quiet: true });

const server = createServer(ROOT);
await new Promise(r => server.listen(PORT, r));

const b = await launch({ port: DBG, tag: 'shot', windowSize: '1680,1200' });
const fx = await installFixtures(b.send, b.sessionId, { quiet: true });
b.on(fx.handle);

await b.send('Page.navigate', { url: `http://localhost:${PORT}/${shots[0][1]}` }, b.sessionId);
await b.until('!!window.BST', { timeout: 40000 });

for (const [name, hash] of shots) {
  await b.ev(`location.hash = ${JSON.stringify(hash)}`);
  await b.until('!!window.BST && window.BST.ready', { timeout: 240000 });
  // Ladders load per row as it scrolls in; give the visible ones a moment.
  await b.wait(2000);
  await b.until('window.BST.ready', { timeout: 120000 });
  // A comparison is a second whole career, and BST.ready knows nothing about it.
  await b.until('window.BST.grid.ready()', { timeout: 240000 });
  await b.wait(400);

  const r = await b.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: true,
    clip: wide(hash)
      ? { x: 0, y: 0, width: 1660, height: 1000, scale: 1.5 }
      : { x: 0, y: 0, width: 1000, height: 900, scale: 2 },
  }, b.sessionId);

  const file = path.join(SHOTS, name + '.png');
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log(`${hash}  ->  ${path.relative(ROOT, file)}`);
}

if (fx.stats.missed) {
  console.log(`\n${fx.stats.missed} request(s) had no fixture and went live:`);
  for (const u of fx.stats.misses) console.log('  ' + u);
}

b.close();
server.close();
process.exit(0);
