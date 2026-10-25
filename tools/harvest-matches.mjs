/* Every match of every season, for the rating pool.
 *
 *   node tools/harvest-matches.mjs                   2007..now
 *   node tools/harvest-matches.mjs --year 2024       one season, re-harvested
 *   node tools/harvest-matches.mjs --from 2008 --to 2012
 *   node tools/harvest-matches.mjs --no-juniors      senior circuit only
 *   node tools/harvest-matches.mjs --cap 3           three events a season (a smoke test)
 *
 * ⚠️⚠️ **This is a different harvest from the other two, not a wider one.**
 * `harvest-winners.mjs` collects one champion per great title and
 * `harvest-podiums.mjs` four competitors per tournament; both ask a tournament
 * only for its closing days. A rating needs the whole draw, so this walks every
 * day of every event and keeps every decided match — about 180 matches at a
 * World Tour event against the podium harvest's four.
 *
 * ⚠️⚠️ **It writes to `raw/`, which is not committed.** 2024 alone is 275 events
 * and roughly 25,000 matches; twenty seasons is of the order of 350,000, which
 * is tens of megabytes and has no business being fetched by a web page. What
 * ships is the *ratings* computed from this, which are small. The files here are
 * a local artifact, regenerable by re-running the command — the same bargain
 * `.gitignore` already strikes for `tests/fixtures/`.
 *
 * ⚠️ One file per season, for `harvest-podiums.mjs`'s reason: the resume is then
 * trivial (a season on disk is done) and nothing has to hold twenty seasons in
 * memory at once.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sweepProfiles } from '../tests/browser.mjs';
import { eloLevel, eloAdmits } from '../model.js';

const API = 'https://extranet-lv.bwfbadminton.com/api/';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTDIR = path.join(ROOT, 'raw');
const SEP = String.fromCharCode(1);

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const has = flag => process.argv.includes(flag);

const ONE = Number(arg('--year', 0));
const FROM = ONE || Number(arg('--from', 2007));
const TO = ONE || Number(arg('--to', new Date().getUTCFullYear()));
const CAP = Number(arg('--cap', 0));
const JUNIORS = !has('--no-juniors');
const TEAMS = !has('--no-teams');
const FORCE = has('--force') || !!ONE || !!CAP;

/* ⚠️⚠️ **Qualifying is a separate draw, and its name changed.** `MS -
   Qualification` from 2011 on, `MS - Qualifying` in 2007 — measured on the 2007
   and 2011 All England and the 2015/2018/2024 samples. Its rounds are
   `Qual. R32`, `Qual. R16`, `Qual. QF`. A rating wants these matches: they are
   real matches, and they are most of what connects a player entering the
   circuit to the players already on it.

   ⚠️ **A junior draw is `MS-U19`, not `MS`** — no spaces, and the age suffix is
   the only thing that distinguishes it. The U17 circuit presumably says `-U17`;
   the suffix is stripped rather than enumerated so an unseen one still lands on
   the right discipline, and the age is kept as its own field. */
const QUALIF = /qualif/i;
/* ⚠️ Two regexes, not one: the test only has to *find* the word, but stripping
   it has to take the whole word and the separator with it. `/qualif/` alone left
   "MS - ication" behind, which fell through to the `matchTypeValue` rescue and
   so still produced the right answer — a bug that worked, found by checking why
   two events had no qualifying rows at all. */
const QUALIF_STRIP = /[\s-]*qualif\w*/i;
const AGE = /[\s-]*\bU(\d{2})\b/i;
const DISCIPLINES = ['MS', 'WS', 'MD', 'WD', 'XD'];

/**
 * The discipline, the qualifying flag and the age group of one match row.
 *
 * ⚠️ `eventName` first and `drawName` only as a fallback: at a team tie the draw
 * is called "Singles" or "Doubles" with no gender in it, and `eventName` still
 * says `MS`. Measured on the 2024 Thomas & Uber Cup.
 */
function drawOf(m) {
  const draw = String((m && m.drawName) || '');
  const ev = String((m && m.eventName) || '');
  const q = QUALIF.test(draw) ? 1 : 0;
  const age = (draw.match(AGE) || [])[1] || '';
  const clean = s => s.replace(QUALIF_STRIP, '').replace(AGE, '').replace(/[\s-]+$/, '').trim();
  for (const cand of [clean(ev), clean(draw)]) {
    const up = cand.toUpperCase();
    if (DISCIPLINES.includes(up)) return { d: up, q, age };
  }
  /* ⚠️ Fall back to `matchTypeValue`, which spells the discipline out
     ("Mixed Doubles"). It is the only field a team tie's bare "Doubles" draw
     can be told apart by when `eventName` is also missing. */
  const t = String((m && m.matchTypeValue) || '');
  if (/mixed/i.test(t)) return { d: 'XD', q, age };
  if (/women/i.test(t)) return { d: /doubles/i.test(t) ? 'WD' : 'WS', q, age };
  if (/men/i.test(t)) return { d: /doubles/i.test(t) ? 'MD' : 'MS', q, age };
  return null;
}

const idsOf = side => ((side && side.players) || [])
  .filter(p => p && p.id != null).map(p => String(p.id));

const shift = (d, n) => {
  const x = new Date(d + 'T00:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};

/**
 * The score as the winner played it.
 *
 * ⚠️⚠️ **`score` is `home`/`away`, which is team1/team2 and not winner/loser.**
 * Stored from the winner's side so a rating that ever wants the margin does not
 * have to carry the orientation around with it — and so a file read by eye says
 * what it looks like it says. A walkover has no score at all and comes back ''.
 */
function scoreOf(m) {
  let sets = m && m.score;
  if (typeof sets === 'string') { try { sets = JSON.parse(sets); } catch { sets = null; } }
  if (!Array.isArray(sets) || !sets.length) return '';
  const flip = Number(m.winner) === 2;
  return sets
    .filter(s => s && (s.home != null || s.away != null))
    .map(s => (flip ? [s.away, s.home] : [s.home, s.away]).join('-'))
    .join(' ');
}

sweepProfiles({ quiet: true });
const b = await launch({ port: 9480, tag: 'matches' });
await b.send('Page.navigate', { url: 'https://bwfworldtour.bwfbadminton.com/' }, b.sessionId);
await b.until('document.readyState === "complete"', { timeout: 40000 });
await b.wait(5000);

let calls = 0;
async function get(q) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await b.wait(340);
    calls++;
    const out = await b.ev('(async () => { const r = await fetch('
      + JSON.stringify(API) + ' + ' + JSON.stringify(q)
      + ', { headers: { accept: "application/json" } });'
      + ' return r.status + String.fromCharCode(1) + (await r.text()).slice(0, 2500000); })()');
    if (typeof out === 'string') {
      const status = Number(out.slice(0, out.indexOf(SEP)));
      if (status === 404) return null;
      try { return JSON.parse(out.slice(out.indexOf(SEP) + 1)); } catch { /* refused */ }
    }
    await b.wait(1500);
  }
  return null;
}

const rowsOf = j => {
  const r = (j && (j.results || j)) || [];
  if (Array.isArray(r)) return r;
  return r.matches || r.data || [];
};

/**
 * Every decided match of one tournament.
 *
 * ⚠️ **The walk starts a day early and ends a day late.** `start_date` is not
 * always the first day play happened on — qualifying can open the day before —
 * and `end_date` is not always the last, which `harvest-podiums.mjs` already
 * records. ⚠️ And it stops after two consecutive days with nothing on them
 * *once play has been seen*, so a four-day junior event costs five calls rather
 * than the window's full width. Without the "once play has been seen" guard a
 * tournament whose first day BWF has mis-dated would stop before it started.
 */
async function matchesOf(t, players) {
  const start = shift(String(t.start_date).slice(0, 10), -1);
  const end = shift(String(t.end_date).slice(0, 10), 1);
  const seen = new Set();          // match ids, because a re-dated day repeats
  const out = [];
  let days = 0, played = 0, quiet = 0, undecided = 0;

  for (let d = start; d <= end; d = shift(d, 1)) {
    days++;
    const list = rowsOf(await get(`tournaments/day-matches?tournamentCode=${t.code}`
      + `&date=${d}&order=2&court=0`));
    if (!list.length) {
      if (played && ++quiet >= 2) break;
      continue;
    }
    played++; quiet = 0;

    for (const m of list) {
      const key = m.id != null ? String(m.id) : JSON.stringify([m.code, m.drawName, m.roundName]);
      if (seen.has(key)) continue;
      seen.add(key);

      const w = Number(m.winner);
      if (w !== 1 && w !== 2) { undecided++; continue; }
      const draw = drawOf(m);
      if (!draw) continue;

      const won = idsOf(w === 1 ? m.team1 : m.team2);
      const lost = idsOf(w === 1 ? m.team2 : m.team1);
      /* ⚠️ A hollowed row has a winner and no players — HANDOVER 2.14 — so both
         sides are checked rather than trusted. */
      if (!won.length || !lost.length) { undecided++; continue; }

      for (const side of [m.team1, m.team2]) {
        for (const p of (side && side.players) || []) {
          if (p && p.id != null && !players[String(p.id)]) {
            players[String(p.id)] = {
              n: p.nameDisplay || p.name_display || '',
              c: p.countryCode || (side && side.countryCode) || '',
            };
          }
        }
      }

      const row = {
        d: draw.d, r: String(m.roundName || '').trim(),
        t: String(m.matchTime || d).slice(0, 10),
        w: won, l: lost, s: scoreOf(m),
      };
      if (draw.q) row.q = 1;
      if (draw.age) row.age = draw.age;
      /* 0 is "Normal"; anything else is a retirement, a walkover or a
         disqualification, and a rating has to be able to leave those out. */
      if (Number(m.scoreStatus) !== 0) row.x = Number(m.scoreStatus) || 0;
      if (m.isTeamMatch) row.tie = 1;
      out.push(row);
    }
  }
  return { rows: out, days, played, undecided };
}

/* ------------------------------------------------------------------ the run */
fs.mkdirSync(OUTDIR, { recursive: true });
const t0 = Date.now();
let seasons = 0, grandTotal = 0;

for (let year = FROM; year <= TO; year++) {
  const out = path.join(OUTDIR, `matches-${year}.json`);
  if (!FORCE && fs.existsSync(out)) { console.log(`${year}  (already)`); continue; }

  /* ⚠️ No `category[]` filter, the reason both other harvests record: BWF has
     moved the World Championships between categories twice and files the Asian
     Championships under three different ones. The whole calendar is asked for
     and `eloLevel` classifies it here. */
  const j = await get(`vue-grouped-year-tournaments?year=${year}`);
  const all = ((j && j.results) || []).flatMap(m => m.tournaments || []);
  if (!all.length) { console.log(`${year}  nothing on the calendar`); continue; }

  const classified = all.map(t => ({ t, f: eloLevel(t) }));
  let wanted = classified.filter(x => eloAdmits(x.f, { juniors: JUNIORS, team: TEAMS }))
    .sort((a, c) => String(a.t.start_date).localeCompare(String(c.t.start_date)));
  const skipped = classified.length - wanted.length;
  if (CAP) wanted = wanted.slice(0, CAP);

  console.log(`${year}  ${all.length} on the calendar, ${wanted.length} admitted`
    + `, ${skipped} out (para/veteran/university${JUNIORS ? '' : '/junior'})`);

  const players = {};
  const events = [];
  const holes = [];
  let total = 0;

  for (const { t, f } of wanted) {
    const { rows, days, played, undecided } = await matchesOf(t, players);
    total += rows.length;
    events.push({
      id: t.id, code: t.code, name: t.name, cat: t.category || '',
      lv: f.lv, jr: f.jr ? 1 : 0, team: f.team ? 1 : 0,
      start: String(t.start_date).slice(0, 10), end: String(t.end_date).slice(0, 10),
      days, played, m: rows,
    });
    if (!rows.length) holes.push(`${t.name} — no decided match in ${days} days`);
    else if (undecided) holes.push(`${t.name} — ${undecided} row(s) with no usable winner`);
    process.stdout.write(`   ${String(rows.length).padStart(4)}  ${f.lv.padEnd(5)}`
      + `${f.jr ? 'jr ' : '   '}${t.name.slice(0, 54)}\n`);
  }

  const state = {
    generated: new Date().toISOString(),
    season: year,
    kinds: { juniors: JUNIORS, team: TEAMS },
    events: events.length,
    matches: total,
    players,
    holes,
    tournaments: events,
  };
  fs.writeFileSync(out, JSON.stringify(state));
  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(`${year}  → ${events.length} events, ${total} matches, `
    + `${Object.keys(players).length} players, ${kb} KB, ${calls} calls so far`);
  seasons++; grandTotal += total;
}

const mins = Math.round((Date.now() - t0) / 60000);
console.log(`\n${seasons} season(s), ${grandTotal} matches, ${calls} calls, ${mins} min`);
b.close();
