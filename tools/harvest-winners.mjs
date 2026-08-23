/* Who won the titles that matter, season by season.
 *
 *   node tools/harvest-winners.mjs                 2007..this year, men's singles
 *   node tools/harvest-winners.mjs --from 2015     a shorter run
 *   node tools/harvest-winners.mjs --draw 2        women's singles
 *
 * The app is player-centric — every endpoint it uses is keyed on a player id.
 * A pyramid of winners asks the opposite question, so the data has to come from
 * somewhere else:
 *
 *   `vue-grouped-year-tournaments?year=` is a whole season in one call, and
 *   `tournaments/day-matches?tournamentCode=&date=` is one day's order of play.
 *   Asked for a tournament's **last day**, it holds that tournament's final.
 *
 * About thirteen calls a season, so twenty years is a few minutes rather than
 * the half-hour the ranking archive took. It still happens here and once, and
 * the result is committed.
 *
 * ⚠️ **The obvious route is the wrong one.** `vue-tournament-draw-data` returns
 * the whole draw and looks like the right answer, but it is 256–407 KB per
 * tournament and it **returns HTTP 500 for some of them** — including the Paris
 * 2024 Olympics and the 2026 Indonesia Open, which is to say including the
 * single most important tile on the board. The day's order of play is 7–14 KB,
 * answers for both, and carries the winner's avatar as well. Draw data is kept
 * only as a fallback.
 *
 * ⚠️ **The last day holds more than one men's singles match.** At the Olympics
 * it holds the bronze play-off too, and it comes first. Match on the round name.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sweepProfiles } from '../tests/browser.mjs';
import { pyramidTier, PYRAMID_ROWS } from '../model.js';

const API = 'https://extranet-lv.bwfbadminton.com/api/';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/* One file per discipline. A single `winners.json` was the first shape and it
   is a foot-gun: the resume check starts over when the discipline differs, so
   harvesting WS would silently wipe MS. */
let OUT = path.join(ROOT, 'data', 'winners.json');
const SEP = String.fromCharCode(1);

const DRAWS = { 1: 'MS', 2: 'WS', 3: 'MD', 4: 'WD', 5: 'XD' };

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const DRAW = Number(arg('--draw', 1));
const CODE = DRAWS[DRAW] || 'MS';
OUT = path.join(ROOT, 'data', `winners-${CODE}.json`);
const FROM = Number(arg('--from', 2007));
const TO = Number(arg('--to', new Date().getUTCFullYear()));

sweepProfiles({ quiet: true });
const b = await launch({ port: 9474, tag: 'winners' });
await b.send('Page.navigate', { url: 'https://bwfworldtour.bwfbadminton.com/' }, b.sessionId);
await b.until('document.readyState === "complete"', { timeout: 40000 });
await b.wait(5000);

let calls = 0;
async function get(q) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await b.wait(340);
    calls++;
    const out = await b.ev('(async () => { const r = await fetch('
      + JSON.stringify(API) + ' + ' + JSON.stringify(q)
      + ', { headers: { accept: "application/json" } });'
      + ' return r.status + String.fromCharCode(1) + (await r.text()).slice(0, 900000); })()');
    if (typeof out === 'string') {
      try { return JSON.parse(out.slice(out.indexOf(SEP) + 1)); } catch { /* refused */ }
    }
    await b.wait(1200);
  }
  return null;
}

/** A player row from either payload, reduced to what the pyramid draws. */
function personOf(side) {
  const p = side && side.players && side.players[0];
  if (!p || p.id == null) return null;
  const av = p.avatar || {};
  return {
    id: String(p.id),
    n: p.nameDisplay || p.name_display || '',
    c: p.countryCode || side.countryCode || '',
    /* ⚠️ Two different avatar shapes. `day-matches` says `thumbnailUrl`;
       `vue-player-summary` says `url_cloudinary`. Neither is wrong and only one
       is ever present. */
    a: av.thumbnailUrl || av.url_cloudinary || av.url_thumbnail || av.url_original || '',
    f: side.countryFlagUrl || '',
  };
}

/** Whoever actually won the match, or null if nobody did. */
function victor(m) {
  const side = Number(m.winner) === 1 ? m.team1 : Number(m.winner) === 2 ? m.team2 : null;
  return side ? personOf(side) : null;
}

const drawNameOf = m => String(m.drawName || m.eventName || m.draw || '').trim().toUpperCase();

/**
 * The winner of one discipline, from a day's order of play.
 *
 * ⚠️ `winner` is 1 or 2, not a player id, and 0 means nobody — a final that was
 * never played has to come back null rather than as the first name listed.
 */
function winnerFromDay(payload, code) {
  const rows = Array.isArray(payload) ? payload
    : (payload && (payload.results || payload.matches)) || [];
  const list = Array.isArray(rows) ? rows : (rows.data || []);
  const final = list.find(m => drawNameOf(m) === code && /^final$/i.test(String(m.roundName || '')));
  return final ? victor(final) : null;
}

/** The same answer out of the full draw, for tournaments the day route misses. */
function winnerFromDraw(payload) {
  const res = (payload && payload.results) || {};
  const entries = Object.entries(res)
    /* ⚠️ Each slot wraps its match: `results["5-0"]` is `{match: {...}}`. */
    .map(([k, v]) => [k, v && v.match ? v.match : v])
    .filter(([, m]) => m && typeof m === 'object');
  const found = entries.find(([, x]) => /^final$/i.test(String(x.roundName || '')));
  return found ? victor(found[1]) : null;
}

/** The day before / after, because an end date is not always the finals day. */
function shift(day, n) {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* Resume: a season already on disk is not asked for again. */
let state = { generated: '', discipline: CODE, players: {}, seasons: {} };
if (fs.existsSync(OUT)) {
  try {
    const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    if (prev.discipline === CODE) state = prev;
    console.log(`resuming: ${Object.keys(state.seasons).length} season(s) on disk`);
  } catch { /* start over */ }
}

const save = () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  state.generated = new Date().toISOString().slice(0, 10);
  state.discipline = CODE;
  fs.writeFileSync(OUT, JSON.stringify(state));
};

const wanted = new Set(PYRAMID_ROWS.flatMap(r => r.tiers).map(String));

for (let year = FROM; year <= TO; year++) {
  if (state.seasons[year]) { console.log(`${year}  (already)`); continue; }

  /* ⚠️ No `category[]` filter. The 2017 World Championships is filed under
     "BWF Events" and the categories a filter would name have changed twice
     since; asking for everything and classifying by name is what survives. */
  const j = await get(`vue-grouped-year-tournaments?year=${year}`);
  const all = ((j && j.results) || []).flatMap(m => m.tournaments || []);
  if (!all.length) { console.log(`${year}  nothing`); continue; }

  const majors = all
    .map(t => ({ t, tier: pyramidTier(t) }))
    .filter(x => x.tier != null && wanted.has(String(x.tier)));

  const won = [];
  const missing = [];
  for (const { t, tier } of majors) {
    const end = String(t.end_date).slice(0, 10);
    let w = null;
    /* The last day first, then either side of it: a tournament that ran a day
       long or short in the calendar still has a finals day somewhere near. */
    for (const day of [end, shift(end, -1), shift(end, 1)]) {
      const j2 = await get(`tournaments/day-matches?tournamentCode=${t.code}&date=${day}&order=2&court=0`);
      w = winnerFromDay(j2, CODE);
      if (w) break;
    }
    if (!w) {
      const draw = await get(`vue-tournament-draw-data?tmtId=${t.id}&tmtType=1&drawId=${DRAW}&isPara=0`);
      w = winnerFromDraw(draw);
    }
    if (!w) { missing.push(t.name); continue; }
    state.players[w.id] = { n: w.n, c: w.c, a: w.a, f: w.f };
    won.push({ tier, id: t.id, name: t.name, date: String(t.start_date).slice(0, 10), w: Number(w.id) });
  }

  state.seasons[year] = won;
  save();

  const byRow = PYRAMID_ROWS.map(r =>
    `${r.key} ${won.filter(x => r.tiers.some(t => String(t) === String(x.tier))).length}`).join('  ');
  console.log(`${year}  ${String(won.length).padStart(2)} titles   ${byRow}`
    + (missing.length ? `   no final for: ${missing.join('; ')}` : ''));
}

save();
console.log(`\nwrote ${path.relative(ROOT, OUT)} — ${CODE},`
  + ` ${Object.keys(state.seasons).length} seasons,`
  + ` ${Object.keys(state.players).length} players, ${calls} requests`);

b.close();
process.exit(0);
