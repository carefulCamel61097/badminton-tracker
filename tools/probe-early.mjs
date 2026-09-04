/* Does BWF have anything before 2007?
 *
 * `YEAR_FLOOR = 2006` was set on the belief that "real data reaches back to
 * about 2007". That belief was never tested against a career that *started*
 * before then, and the two careers this project most wants to compare both did:
 * LEE Chong Wei turned professional in 2000, LIN Dan in 2001.
 *
 * It matters because the gap is not symmetric. If BWF holds those seasons, a
 * floor at 2007 quietly deletes more of one career than the other, and the
 * comparison the tool exists for is drawn short.
 *
 *   node tools/probe-early.mjs
 *
 * Read-only: one request per player-year, at the same pace the app uses.
 */
import { launch, sweepProfiles } from '../tests/browser.mjs';

const API = 'https://extranet-lv.bwfbadminton.com/api/';

const WHO = [
  [50152, 'LEE Chong Wei', 2000],
  [50906, 'LIN Dan', 2000],
];
const UNTIL = 2008;

sweepProfiles({ quiet: true });
const b = await launch({ port: 9468, tag: 'early' });

await b.send('Page.navigate', { url: 'https://bwfworldtour.bwfbadminton.com/' }, b.sessionId);
await b.until('document.readyState === "complete"', { timeout: 40000 });
await b.wait(4000);

/* Built rather than typed, for the reason probe-rank-hole.mjs records: a
   literal U+0001 in a source file does not survive every editor and every copy,
   and when it goes missing `indexOf` returns 0, every parse fails, and the
   sweep reports "nothing anywhere" rather than erroring. */
const SEP = String.fromCharCode(1);

const get = async path => {
  await b.wait(400);
  const out = await b.ev(`(async () => {
    const r = await fetch(${JSON.stringify(API)} + ${JSON.stringify(path)},
      { headers: { accept: 'application/json' } });
    return r.status + ${JSON.stringify(SEP)} + (await r.text()).slice(0, 400000);
  })()`);
  if (typeof out !== 'string') return { status: 0, json: null };
  const i = out.indexOf(SEP);
  let json = null;
  try { json = JSON.parse(out.slice(i + 1)); } catch { /* html or empty */ }
  return { status: Number(out.slice(0, i)), json };
};

/* The same query the app builds, so a hit here is a season the app would get. */
const season = (id, year) =>
  `vue-player-tournaments?playerId=${id}&isPara=0&drawCount=1&activeTab=0&tmtYear=${year}`;

for (const [id, who, from] of WHO) {
  console.log(`\n=== ${who} (${id}) ===`);
  console.log('year  http  tmts  placed    W  the titles');
  let total = 0;
  let titles = 0;
  for (let y = from; y <= UNTIL; y++) {
    const { status, json } = await get(season(id, y));
    const results = json && json.results;
    const list = Array.isArray(results) ? results
      : (results && Array.isArray(results.data)) ? results.data : [];
    total += list.length;
    const won = [];
    let placed = 0;
    for (const t of list) {
      for (const d of t.draws || []) {
        /* ⚠️ The interesting number is not the titles, it is how many results
           carry a position at all. A season of tournaments with no position is
           a hole in BWF's records, and lowering the floor into it would add
           rows that say only "Played".

           ⚠⚠ **An absent position is the string `"-"`, not an empty one** — and
           `"N/A"` also occurs. This counted both as placed until 4 Sep 2026,
           which reported LIN Dan's 2004 as 11/11 placed with no titles in it,
           i.e. as a complete season in which the reigning All England champion
           won nothing. `positionInfo` in the model has always read them as
           "Played"; only this line was fooled, and it was fooled in the
           direction of saying the floor could safely be lowered. */
        const raw = d.position == null ? '' : String(d.position).trim();
        const pos = (raw === '-' || raw === 'N/A') ? '' : raw;
        if (pos) placed++;
        // '1st' is BWF's own word for the champion, and the only one needed here.
        if (pos === '1st') won.push(((t.tournament_model || {}).name || '?').trim());
      }
    }
    titles += won.length;
    const draws = list.reduce((n, t) => n + (t.draws || []).length, 0);
    console.log(`${y}  ${String(status).padStart(4)}  ${String(list.length).padStart(4)}`
      + `  ${String(placed).padStart(4)}/${String(draws).padEnd(4)}`
      + `  ${String(won.length).padStart(3)}  ${won.join(' / ')}`);
  }
  console.log(`      ${from}-${UNTIL}: ${total} tournaments, ${titles} titles`);
}

/* ---- and any season in full ----

   Because "LIN Dan won nothing in 2004" is a claim that is plainly false and
   needs looking at rather than believing. What it shows: before 2005 the rows
   are there and `position` is empty, and the categories are junk right up to
   2007 — the 2006 World Championships is filed as category 6, the same id as an
   International Series, and the Asian Games has no category at all.

     node tools/probe-early.mjs 2004 2006      any years you like */

const DETAIL = process.argv.slice(2).map(Number).filter(Boolean);

for (const [id, who] of DETAIL.length ? [[50906, 'LIN Dan'], [50152, 'LEE Chong Wei']] : []) {
  for (const y of DETAIL) {
    const { json } = await get(season(id, y));
    const results = json && json.results;
    const list = Array.isArray(results) ? results
      : (results && Array.isArray(results.data)) ? results.data : [];
    console.log(`
--- ${who} ${y}, every row ---`);
    for (const t of list) {
      const tm = t.tournament_model || {};
      for (const d of t.draws || []) {
        console.log(`  ${String(d.position || '-').padEnd(5)}`
          + ` ${String(d.name || '?').padEnd(10)}`
          + ` cat ${String(tm.tournament_category_id).padEnd(4)}`
          + ` ${String(tm.start_date || '').slice(0, 10)}  ${(tm.name || '?').trim()}`);
      }
    }
  }
}

b.close();
process.exit(0);
