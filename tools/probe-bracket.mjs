/* Does the bracket geometry hold against a real World Tour draw?
 *
 * The predecessor measured the fold against one 64 draw at the World
 * Championships. Every World Tour event is a 32, which is one column shorter,
 * so the numbers that justified folding have to be re-measured here rather than
 * inherited: if a 32 draw already fits on a screen there is nothing to fold.
 *
 *   node tools/probe-bracket.mjs
 */
import { launch, sweepProfiles } from '../tests/browser.mjs';
import {
  parseDrawList, parseDraw, bracketLayout, bracketRounds, autoFromCol, colCount,
} from '../model.js';

const API = 'https://extranet-lv.bwfbadminton.com/api/';
const SEP = String.fromCharCode(1);      // built, not typed - see probe-rank-hole

sweepProfiles({ quiet: true });
const b = await launch({ port: 9484, tag: 'bracket' });
await b.send('Page.navigate', { url: 'https://bwfworldtour.bwfbadminton.com/' }, b.sessionId);
await b.until('document.readyState === "complete"', { timeout: 40000 });
await b.wait(4000);

const getOnce = async path => {
  await b.wait(400);
  const out = await b.ev(`(async () => {
    const r = await fetch(${JSON.stringify(API)} + ${JSON.stringify(path)},
      { headers: { accept: 'application/json' } });
    return r.status + ${JSON.stringify(SEP)} + (await r.text()).slice(0, 2000000);
  })()`);
  if (typeof out !== 'string') return null;
  try { return JSON.parse(out.slice(out.indexOf(SEP) + 1)); } catch { return null; }
};
const get = async p => {
  for (let i = 0; i < 3; i++) { const j = await getOnce(p); if (j && Object.keys(j).length) return j; }
  return null;
};

for (const [tmtId, what] of [[5625, 'LI-NING China Masters (Super 750, 32 draws)'],
                             [5527, 'Pontianak Indonesia Masters (Super 100, mixed sizes)'],
                             [5601, 'BWF World Championships (64 draws)']]) {
  console.log('');
  console.log('================ ' + what + ' ================');
  const list = parseDrawList(await get(`vue-tournament-draws?tmtId=${tmtId}&tmtType=1`));
  console.log('draws: ' + list.map(d => `${d.code}=${d.id}(${d.size})`).join('  '));

  for (const d of list.slice(0, 2)) {
    const draw = parseDraw(await get(
      `vue-tournament-draw-data?tmtId=${tmtId}&tmtType=1&drawId=${d.id}&isPara=0`));
    const rounds = bracketRounds(draw);
    let byes = 0;
    for (const m of draw.cells.values()) if (m.bye) byes++;
    console.log('');
    console.log(`  --- ${d.code} (drawId ${d.id}) ---`);
    console.log(`  cells ${draw.cells.size}  maxCol ${draw.maxCol}  drawsize ${draw.size}`
      + `  byes ${byes}`);
    console.log('  rounds: ' + rounds.map(r => `${r.col}:${r.round}`).join('  '));
    console.log('  auto opens at column ' + autoFromCol(draw)
      + ' (' + ((bracketRounds(draw)[autoFromCol(draw)] || {}).round || '?') + ')');
    console.log('  show from   cards  segments  canvas');
    for (const pick of ['all', ...rounds.slice(1).map(r => r.round)]) {
      const L = bracketLayout(draw, pick);
      console.log(`  ${String(pick).padEnd(11)} ${String(L.cards.length).padStart(5)}`
        + `  ${String(L.lines.length).padStart(8)}  ${Math.round(L.width)} x ${Math.round(L.height)}`);
    }
    // The spacing law, checked rather than assumed: a card in column c must sit
    // at the midpoint of the two that feed it.
    let worst = 0;
    const L = bracketLayout(draw, 'all');
    const at = new Map(L.cards.map(c => [c.match.col + '-' + c.match.row, c.y + c.h / 2]));
    for (let c = 1; c <= draw.maxCol; c++) {
      for (let r = 0; r < colCount(draw, c); r++) {
        const me = at.get(c + '-' + r);
        const f1 = at.get((c - 1) + '-' + (2 * r)), f2 = at.get((c - 1) + '-' + (2 * r + 1));
        if (me == null || f1 == null || f2 == null) continue;
        worst = Math.max(worst, Math.abs(me - (f1 + f2) / 2));
      }
    }
    console.log('  worst deviation from the midpoint of its feeders: ' + worst.toFixed(3) + 'px');
  }
}
b.close();
process.exit(0);
