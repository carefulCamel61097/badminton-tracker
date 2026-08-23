/* Screenshot the app, so a change to the strip can actually be looked at.
 *
 *   node tools/shot.mjs                          the default pair
 *   node tools/shot.mjs "#p=87442&y=2026"        any hash
 *   node tools/shot.mjs --top "#p=87442"         just the chrome, big enough to read
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
  ['honours', '#p=57945&g=1&v=h'],        // the same career as an honours board
  ['honours2', '#p=57945&g=1&v=h&c=87442'],   // two boards across the spine
  ['tmt', '#pg=tmt&now=2026-08-23'],      // finals day at the Worlds
];

/** The compare and tournament pages are wide; the strip is not. */
/* `[#&]`, not `(^|&)`: the hash arrives with its `#` attached, so `pg=tmt` at
   the front of it is preceded by neither the start of the string nor an `&`. */
const wide = hash => /[#&](g=1|pg=(compare|tmt|winners))/.test(hash);

/* `--top` clips to the first 460px: the chrome — nav, hero, page header — at a
   readable scale. A whole-page capture is 1600px of document squeezed into one
   image and the controls come out too small to judge, which has twice now sent
   me looking for a bug in something that rendered perfectly. */
const TOP_ONLY = process.argv.includes('--top');
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

/* ⚠️ `BST.ready` is about a *player* — it is false until one has loaded — and
   the tournament page has none. Waiting on it there is a four-minute timeout
   per shot, not a failure, which is a slow way to learn this. */
const tmtOnly = hash => /[#&]pg=tmt/.test(hash) && !/[#&]p=\d/.test(hash);
const winOnly = hash => /[#&]pg=winners/.test(hash) && !/[#&]p=\d/.test(hash);

for (const [name, hash] of shots) {
  await b.ev(`location.hash = ${JSON.stringify(hash)}`);
  if (winOnly(hash)) {
    await b.until('!!document.querySelector(".pyrseason")', { timeout: 60000 });
  } else if (tmtOnly(hash)) {
    await b.until('!!window.BST && window.BST.tmt.ready() && window.BST.tmt.pick() !== null',
      { timeout: 120000 });
    await b.wait(600);
  } else {
    await b.until('!!window.BST && window.BST.ready', { timeout: 240000 });
    // Ladders load per row as it scrolls in; give the visible ones a moment.
    await b.wait(2000);
    await b.until('window.BST.ready', { timeout: 120000 });
    // A comparison is a second whole career, and BST.ready knows nothing about it.
    await b.until('window.BST.grid.ready()', { timeout: 240000 });
  }
  await b.wait(400);

  /* ⚠️ `captureBeyondViewport` silently drops the **top layer**, so a <dialog>
     opened with showModal() — the grid — is simply not in the picture, backdrop
     and all. The page behind it photographs perfectly, which is what makes it
     look like the modal failed to open rather than like a capture setting. The
     strip needs the whole document height; the grid fits the viewport, so it is
     captured without it. */
  const r = await b.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: !TOP_ONLY && !wide(hash),
    clip: TOP_ONLY
      ? { x: 0, y: 0, width: 1620, height: 460, scale: 1.6 }
      : wide(hash)
        ? { x: 0, y: 0, width: 1660, height: 1080, scale: 1.5 }
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
