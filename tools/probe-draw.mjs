/* What does a World Tour draw look like?
 *
 * The predecessor read `vue-tournament-draw-data` against one tournament only —
 * the World Championships, a full 64 field with no qualifying. A Super 750 is a
 * 32 draw with qualifiers, so before any of that geometry is reused here the
 * questions are: what does `vue-tournament-draws` list, are the drawIds still
 * 1-5, how many columns come back, and what is in a cell.
 *
 *   node tools/probe-draw.mjs
 */
import { launch, sweepProfiles } from '../tests/browser.mjs';

const API = 'https://extranet-lv.bwfbadminton.com/api/';
const SEP = String.fromCharCode(1);      // built, not typed - see probe-rank-hole

sweepProfiles({ quiet: true });
const b = await launch({ port: 9481, tag: 'draw' });
await b.send('Page.navigate', { url: 'https://bwfworldtour.bwfbadminton.com/' }, b.sessionId);
await b.until('document.readyState === "complete"', { timeout: 40000 });
await b.wait(4000);

const getOnce = async path => {
  await b.wait(400);
  const out = await b.ev(`(async () => {
    const r = await fetch(${JSON.stringify(API)} + ${JSON.stringify(path)},
      { headers: { accept: 'application/json' } });
    return r.status + ${JSON.stringify(SEP)} + (await r.text()).slice(0, 900000);
  })()`);
  if (typeof out !== 'string') return null;
  try { return JSON.parse(out.slice(out.indexOf(SEP) + 1)); } catch { return null; }
};
const get = async path => {
  for (let i = 0; i < 3; i++) { const j = await getOnce(path); if (j && Object.keys(j).length) return j; }
  return null;
};

const s = await get('vue-tmt-schedule?drawCount=1');
const slots = ['nextLive', 'nextTmt', 'previousTmt']
  .map(k => s && s[k]).filter(Boolean);
for (const t of slots) console.log(`${t.id}  ${t.name}  ${String(t.start_date).slice(0, 10)}`);

for (const t of slots) {
  console.log('');
  console.log('================ ' + t.name + ' (tmtId ' + t.id + ') ================');
  const list = await get(`vue-tournament-draws?tmtId=${t.id}&tmtType=1`);
  if (!list) { console.log('  no draw list'); continue; }
  console.log('  list keys: ' + Object.keys(list).join(', '));
  const arr = Array.isArray(list) ? list : (list.results || list.draws || list.data || []);
  console.log('  ' + JSON.stringify(arr).slice(0, 1200));
}
b.close();
process.exit(0);
