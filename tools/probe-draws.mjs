/* What does tournaments/draws return across the formats a season contains?
 *
 * The season strip needs the real draw size to say how far a player got, and
 * the shape of this endpoint is not documented anywhere. In particular: does a
 * tournament with qualifying return extra stages, and what does a round-robin
 * event like the Tour Finals report?
 *
 * Read-only, one tournament at a time through a real browser, as everything
 * else here is.
 */
import { launch, sweepProfiles } from '../tests/browser.mjs';

const API = 'https://extranet-lv.bwfbadminton.com/api/';

const TOURNAMENTS = [
  ['Super 1000  Malaysia Open',   '41287386-9043-4062-99C8-3FFBB9B26C1E'],
  ['Super 500   Thailand Open',   '3B8847C8-A4D7-4C65-B3E1-EA2314FD304B'],
  ['Super 100   China Masters',   'AFE8AFF1-6A16-4F3F-8BDC-039B6D3357E5'],
  ['Challenge   Azerbaijan Intl', '1A8E447A-C681-4881-AE97-2FD75E46792A'],
  ['Future      Peru Future',     'BAC66010-40B5-48E7-BB49-75C5C4178D38'],
  ['Continental Asia Champs',     'C69FDCC5-4CCA-4EE1-9E18-9675557C0605'],
  ['Worlds      2026',            'B671FB97-491C-46D3-982F-56525168C3AA'],
  ['Tour Finals',                 'F0D25C8F-6A9A-49DE-97FC-E58E3DB74CF1'],
  ['Team event  Thomas & Uber',   '39A63C50-66C5-4857-9008-00C241339F4D'],
  ['Cont. Team  Asia Team',       '2289A1EB-D46E-475D-B775-4528DC6E6E98'],
];

sweepProfiles({ quiet: true });
const b = await launch({ port: 9461, tag: 'draws' });
await b.send('Page.navigate', { url: 'https://bwfworldtour.bwfbadminton.com/' }, b.sessionId);
await b.until('document.readyState === "complete"', { timeout: 40000 });
await b.wait(6000);

const get = async path => {
  const out = await b.ev(`(async () => {
    const r = await fetch(${JSON.stringify(API)} + ${JSON.stringify(path)},
      { headers: { accept: 'application/json' } });
    return r.status + '\\u0001' + (await r.text()).slice(0, 20000);
  })()`);
  if (typeof out !== 'string') return { status: 0, body: '' };
  const [status, body] = out.split('');
  return { status: Number(status), body };
};

for (const [label, code] of TOURNAMENTS) {
  const r = await get('tournaments/draws?tournament_code=' + code);
  let rows = null;
  try { rows = (JSON.parse(r.body) || {}).data; } catch {}
  if (!Array.isArray(rows)) {
    console.log(`${label.padEnd(26)} HTTP ${r.status}  ${r.body.slice(0, 90)}`);
    continue;
  }
  const summary = rows.map(d =>
    `${d.name}:${d.size}${d.stage_name && d.stage_name !== 'Main Draw' ? '[' + d.stage_name + ']' : ''}`
    + `${d.type !== 'Elimination' ? '(' + d.type + ')' : ''}`).join('  ');
  console.log(`${label.padEnd(26)} HTTP ${r.status}  ${rows.length} rows  ${summary}`);
  // Any field beyond the ten seen so far would change how this is parsed.
  const keys = [...new Set(rows.flatMap(Object.keys))].join(',');
  if (keys !== 'name,type_id,type,code,slug,size,stage_type,stage_name,stage_order') {
    console.log(`${''.padEnd(26)} keys: ${keys}`);
  }
  await b.wait(350);
}

b.close();
