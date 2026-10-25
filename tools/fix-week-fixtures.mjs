/* Rebuild the two fixtures that cannot be re-recorded.
 *
 *   node tools/fix-week-fixtures.mjs              TMT_DAY, or 2026-08-23
 *   node tools/fix-week-fixtures.mjs 2026-10-25
 *
 * ⚠️⚠️ **`vue-tmt-schedule` and `vue-tmt-live-scores` only ever answer "now".**
 * The e2e is pinned to a fixed week through `now=` / `TMT_DAY`, so recording
 * either of them captures whatever week the recorder happened to run in, and a
 * fixture from the wrong week is worse than no fixture: the page opens on a
 * tournament that was not on. HANDOVER and the recorder both record the trap —
 * `node tests/record.mjs` with no arguments refreshes everything, and that is
 * the run which moves the page's whole world.
 *
 * ⚠️ It happened again on 25 Oct 2026, and this script is the recovery the note
 * prescribes: `vue-grouped-year-tournaments?year=` **is** retrospective, so a
 * year list plus a date rebuilds both answers for any past week.
 *
 * Only the week arithmetic and `has_live_scores` are ours; every field in the
 * rows is BWF's own.
 */
import { launch, sweepProfiles } from '../tests/browser.mjs';
import { writeFixture } from '../tests/fixtures.mjs';
import {
  scheduleFromYear, scheduleOff, scheduleSlot, scheduleGroup,
  onSeniorCircuit, GRID_ORDER,
} from '../model.js';

const API = 'https://extranet-lv.bwfbadminton.com/api';
const DAY = process.argv[2] || process.env.TMT_DAY || '2026-08-23';
if (!/^\d{4}-\d{2}-\d{2}$/.test(DAY)) {
  console.log(`not a date: ${DAY}`);
  process.exit(1);
}

const stakesOf = t => {
  const g = scheduleGroup(scheduleSlot(t));
  const i = g == null ? -1 : GRID_ORDER.indexOf(g);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
};
const day = s => String(s || '').slice(0, 10);
const shift = (d, k) => {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + k);
  return x.toISOString().slice(0, 10);
};

sweepProfiles({ quiet: true });
const b = await launch({ port: 9496, tag: 'fixweek', windowSize: '1200,900' });
await b.send('Page.navigate', { url: 'https://bwfworldtour.bwfbadminton.com/' }, b.sessionId);
await b.until('document.readyState === "complete"', { timeout: 40000 });
await b.wait(5000);

/* ⚠️ Two years, because a January week reaches back into December and the
   e2e's pin could move. Costs one extra call and removes a whole class of
   off-by-a-year emptiness. */
const years = [...new Set([Number(DAY.slice(0, 4)) - 1, Number(DAY.slice(0, 4))])];
let rows = [];
for (const y of years) {
  await b.wait(340);
  const raw = await b.ev(`(async () => {
    const r = await fetch(${JSON.stringify(API + '/vue-grouped-year-tournaments?year=')} + ${y},
      { headers: { accept: 'application/json' } });
    return await r.text();
  })()`);
  try {
    rows = rows.concat(((JSON.parse(raw) || {}).results || [])
      .flatMap(m => m.tournaments || []));
  } catch { /* a year that answers nothing is not a failure */ }
}
console.log(`${rows.length} calendar rows for ${years.join(' + ')}`);
if (!rows.length) { console.log('nothing to build from'); b.close(); process.exit(1); }

/* ---- vue-tmt-schedule: the three slots, exactly as the CORS fallback does ---- */
const slots = scheduleFromYear(rows, DAY);
const slotsUrl = `${API}/vue-tmt-schedule?drawCount=1`;
writeFixture(slotsUrl, JSON.stringify(Object.assign({ drawCount: 1 }, slots)));
console.log('\nvue-tmt-schedule');
for (const k of ['nextLive', 'nextTmt', 'previousTmt']) {
  const t = slots[k];
  console.log(`  ${k.padEnd(12)}${t ? day(t.start_date) + '->' + day(t.end_date) + '  ' + t.name : '(null)'}`);
}

/* ---- vue-tmt-live-scores: this week and the next ---- */
const dow = (new Date(DAY + 'T00:00:00Z').getUTCDay() + 6) % 7;   // Monday = 0
const mon = shift(DAY, -dow);
const weekOf = (from, to) => rows
  .filter(t => !scheduleOff(t) && onSeniorCircuit(t))
  .filter(t => day(t.start_date) <= to && day(t.end_date) >= from)
  .map(t => Object.assign({}, t, { has_live_scores: true }))
  .sort((a, c) => stakesOf(a) - stakesOf(c));

const thisWeek = weekOf(mon, shift(mon, 6));
const nextWeek = weekOf(shift(mon, 7), shift(mon, 13));
const liveUrl = `${API}/vue-tmt-live-scores`;
writeFixture(liveUrl, JSON.stringify({ thisWeek, nextWeek }));

console.log(`\nvue-tmt-live-scores   week of ${mon}`);
console.log(`  thisWeek (${thisWeek.length})`);
for (const t of thisWeek) console.log(`     ${day(t.start_date)}->${day(t.end_date)}  ${t.name}`);
console.log(`  nextWeek (${nextWeek.length})`);
for (const t of nextWeek.slice(0, 6)) console.log(`     ${day(t.start_date)}->${day(t.end_date)}  ${t.name}`);

b.close();
