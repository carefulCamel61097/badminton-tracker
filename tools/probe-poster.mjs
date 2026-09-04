/* Draw an export and write it out, so it can actually be looked at.
 *
 *   node tools/probe-poster.mjs             2011-2016, men's singles
 *   node tools/probe-poster.mjs 2007 2026    the whole board
 *   node tools/probe-poster.mjs 2019 2023 WS
 *
 * Writes tests/shots/poster.png (gitignored). The API is replayed from
 * fixtures; the photographs are not — they come from BWF's image host, which is
 * the whole point, since whether that host answers a CORS request is what
 * decides if the export has faces in it or a canvas nobody can read.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from '../serve.mjs';
import { launch, sweepProfiles } from '../tests/browser.mjs';
import { installFixtures } from '../tests/fixtures.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const [from = '2011', to = '2016', kind = 'MS'] = process.argv.slice(2);
const PORT = 8795, DBG = 9472;

sweepProfiles({ quiet: true });
const server = createServer(ROOT);
await new Promise(r => server.listen(PORT, r));

const b = await launch({ port: DBG, tag: 'poster', windowSize: '1400,1000' });
const fx = await installFixtures(b.send, b.sessionId, { quiet: true });
b.on(fx.handle);

await b.send('Page.navigate',
  { url: `http://localhost:${PORT}/#pg=winners${kind === 'MS' ? '' : '&wk=' + kind}` },
  b.sessionId);
await b.until('!!window.BST', { timeout: 40000 });
await b.until('!!document.querySelector(".erabar")', { timeout: 60000 });

const layout = await b.ev(`(() => {
  const L = window.BST.winners.poster(${from}, ${to});
  return JSON.stringify({
    years: L.years.length, from: L.from, to: L.to,
    size: Math.round(L.width) + 'x' + Math.round(L.height),
    lanes: L.lanes, bars: L.bars.length, title: L.title,
    clipped: L.bars.filter(x => x.openLeft || x.openRight)
      .map(x => (x.who || {}).n + ' ' + x.from + '-' + x.to).join('; ') || 'none',
  });
})()`);
console.log(layout);

const out = await b.ev(`window.BST.winners.png(${from}, ${to})`);
if (!out || out.__err) {
  console.log('FAILED: ' + JSON.stringify(out));
} else {
  const file = path.join(ROOT, 'tests', 'shots', 'poster.png');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(out.url.split(',')[1], 'base64'));
  console.log(`${out.type}, ${(out.bytes / 1024).toFixed(0)} KB  ->  tests/shots/poster.png`);
  console.log('would be saved as: ' + await b.ev(
    `window.BST.winners.name({ from: ${from}, to: ${to} })`));
}

b.close();
server.close();
process.exit(0);
