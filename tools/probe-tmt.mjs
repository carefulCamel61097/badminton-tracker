/* What do the tournament-page endpoints actually return, today?
 *
 * Part 3.2 says `vue-tmt-schedule` is the whole auto-following view and Part
 * 3.5 lists the day-matches family, but neither has been read by this project's
 * own code yet — the shapes below are what step 4 of the build order has to
 * parse. Read-only, a handful of requests through a real browser, as everything
 * else here is.
 *
 *   node tools/probe-tmt.mjs
 */
import { launch, sweepProfiles } from '../tests/browser.mjs';

const API = 'https://extranet-lv.bwfbadminton.com/api/';

sweepProfiles({ quiet: true });
const b = await launch({ port: 9463, tag: 'tmt' });
await b.send('Page.navigate', { url: 'https://bwfworldtour.bwfbadminton.com/' }, b.sessionId);
await b.until('document.readyState === "complete"', { timeout: 40000 });
await b.wait(6000);

/** One request, through the page, paced like the app's own queue. */
const get = async path => {
  await b.wait(400);
  const out = await b.ev(`(async () => {
    const r = await fetch(${JSON.stringify(API)} + ${JSON.stringify(path)},
      { headers: { accept: 'application/json' } });
    return r.status + '\\u0001' + (await r.text()).slice(0, 400000);
  })()`);
  if (typeof out !== 'string') return { status: 0, json: null, body: '' };
  const i = out.indexOf('');
  const status = Number(out.slice(0, i));
  const body = out.slice(i + 1);
  let json = null;
  try { json = JSON.parse(body); } catch { /* an HTML error page */ }
  return { status, json, body };
};

const keys = o => (o && typeof o === 'object' ? Object.keys(o).join(', ') : typeof o);
const line = (...a) => console.log(...a);

/* ---- 1. the spine: which tournament is now? ---- */

line('\n=== vue-tmt-schedule?drawCount=1 ===');
const sched = await get('vue-tmt-schedule?drawCount=1');
line('HTTP', sched.status, '·', sched.body.length, 'bytes');
line('top-level keys:', keys(sched.json));
for (const slot of ['nextLive', 'previousTmt', 'nextTmt']) {
  const t = sched.json && sched.json[slot];
  if (!t) { line(`  ${slot}: (absent)`); continue; }
  line(`  ${slot}: ${t.name}`);
  line(`      ${t.start_date} → ${t.end_date}  label=${JSON.stringify(t.label)}`);
  line(`      id=${t.id} code=${t.code}`);
  line(`      keys: ${keys(t)}`);
}

/* ---- 2. the tournament that is on, or the one just finished ---- */

const live = (sched.json && (sched.json.nextLive || sched.json.previousTmt)) || null;
if (!live) { line('\nno tournament to probe'); b.close(); process.exit(0); }
line(`\n--- probing: ${live.name} (${live.start_date.slice(0, 10)} → ${live.end_date.slice(0, 10)}) ---`);

line('\n=== tournaments/draws?tournament_code= ===');
const draws = await get('tournaments/draws?tournament_code=' + live.code);
line('HTTP', draws.status);
for (const d of ((draws.json || {}).data) || []) {
  line(`  ${String(d.name).padEnd(5)} size=${String(d.size).padEnd(4)}`
    + ` code=${d.code} ${d.stage_name} ${d.type}`);
}

/* The last day of the tournament, which today is the finals. */
const day = String(live.end_date).slice(0, 10);

line(`\n=== tournaments/day-matches/courts?date=${day} ===`);
const courts = await get(`tournaments/day-matches/courts?tournamentCode=${live.code}&date=${day}`);
line('HTTP', courts.status, '·', JSON.stringify(courts.json).slice(0, 300));

line(`\n=== tournaments/day-matches?date=${day}&order=2 ===`);
const dm = await get(`tournaments/day-matches?tournamentCode=${live.code}&date=${day}&order=2&court=0`);
line('HTTP', dm.status, '·', dm.body.length, 'bytes');
line('top-level keys:', keys(dm.json));

/* Find the array of matches wherever it lives, and describe one. */
const findMatches = o => {
  if (Array.isArray(o)) {
    if (o.length && o[0] && typeof o[0] === 'object'
        && ('match_id' in o[0] || 'matchId' in o[0] || 'winner' in o[0] || 'team1' in o[0])) return o;
    for (const v of o) { const r = findMatches(v); if (r) return r; }
    return null;
  }
  if (o && typeof o === 'object') {
    for (const v of Object.values(o)) { const r = findMatches(v); if (r) return r; }
  }
  return null;
};
const matches = findMatches(dm.json);
line('matches found:', matches ? matches.length : 0);
if (matches && matches.length) {
  line('match keys:', keys(matches[0]));
  line('\nfirst match, trimmed:');
  const m = matches[0];
  for (const [k, v] of Object.entries(m)) {
    const s = v && typeof v === 'object' ? JSON.stringify(v) : String(v);
    line(`  ${k.padEnd(22)} ${s.length > 220 ? s.slice(0, 220) + '…' : s}`);
  }
}

line(`\n=== tournaments/day-matches/players?date=${day} ===`);
const pl = await get(`tournaments/day-matches/players?tournamentCode=${live.code}&date=${day}`);
line('HTTP', pl.status, '·', pl.body.length, 'bytes', '· keys:', keys(pl.json));
const plist = (pl.json || {}).players;
if (Array.isArray(plist) && plist.length) {
  line('players:', plist.length, '· first:', JSON.stringify(plist[0]).slice(0, 260));
}

/* ---- 3. a day that has actually been played ----

   Today's finals have not started, so `score` is `[]` and `winner` is 0 for
   every one of them. Nothing above says what a finished match looks like, and
   the view cannot be written without that. */

const done = sched.json && sched.json.previousTmt;
if (done) {
  const dday = String(done.end_date).slice(0, 10);
  line(`\n--- a completed day: ${done.name}, ${dday} ---`);
  const fin = await get(`tournaments/day-matches?tournamentCode=${done.code}&date=${dday}&order=2&court=0`);
  line('HTTP', fin.status, '·', fin.body.length, 'bytes');
  const fm = findMatches(fin.json) || [];
  line('matches:', fm.length);
  const played = fm.find(m => m.winner) || fm[0];
  if (played) {
    line('\nwinner =', played.winner, '· matchStatusValue =', played.matchStatusValue,
      '· scoreStatusValue =', played.scoreStatusValue, '· duration =', played.duration);
    line('roundName =', played.roundName, '· drawName =', played.drawName,
      '· court =', played.courtName, '· oopText =', JSON.stringify(played.oopText));
    line('score:', JSON.stringify(played.score));
    line('team1:', JSON.stringify(played.team1).slice(0, 300));
    line('team2:', JSON.stringify(played.team2).slice(0, 300));
    line('matches[]:', JSON.stringify(played.matches).slice(0, 200));
  }
  const statuses = [...new Set(fm.map(m => `${m.matchStatusValue}/${m.scoreStatusValue}/w${m.winner}`))];
  line('\nstatuses seen:', statuses.join('  '));
  const oop = [...new Set(fm.map(m => m.oopText))];
  line('oopText seen:', JSON.stringify(oop));
  const courts = [...new Set(fm.map(m => m.courtName))];
  line('courts seen:', JSON.stringify(courts));
}

b.close();
process.exit(0);
