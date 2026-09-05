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
import { pyramidTier, PYRAMID_ROWS, canonicalDraw } from '../model.js';

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
/* ⚠️ An optional **wider net**, written to a file of its own so the board's own
   data cannot be changed by accident: `--tier 25` collects the Super 500
   winners into `winners-<CODE>-s500.json`. The pyramid stops at Super 750 on
   purpose — a fifth row would make every season column half as wide again — but
   the share chart can ask whether the answer moves when the net widens.
   Nothing lands on Super 500 before 2018, so it only ever adds to 2018+. */
const TIER = arg('--tier', '');
if (TIER) OUT = path.join(ROOT, 'data', `winners-${CODE}-s${TIER}.json`);
const FROM = Number(arg('--from', TIER ? 2018 : 2007));
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

/**
 * Everybody on one side of a match, reduced to what the pyramid draws.
 *
 * ⚠️ **Every player, not `players[0]`.** A doubles title is won by a pair and
 * the payload carries both — this took the first name listed and dropped the
 * partner, which is fine for the two singles draws and silently wrong for the
 * three that were then unreachable. `teamName` and `linkName` are `null` on
 * every side BWF has ever sent, so a pair's name has to be built from its
 * players and cannot be read off the side.
 */
function peopleOf(side) {
  const list = (side && side.players) || [];
  return list.filter(p => p && p.id != null).map(p => {
    const av = p.avatar || {};
    return {
      id: String(p.id),
      n: p.nameDisplay || p.name_display || '',
      c: p.countryCode || side.countryCode || '',
      /* ⚠️ Two different avatar shapes. `day-matches` says `thumbnailUrl`;
         `vue-player-summary` says `url_cloudinary`. Neither is wrong and only
         one is ever present. */
      a: av.thumbnailUrl || av.url_cloudinary || av.url_thumbnail || av.url_original || '',
      f: side.countryFlagUrl || '',
    };
  });
}

/** Whoever actually won the match — one player or two — or null if nobody did. */
function victor(m) {
  const side = Number(m.winner) === 1 ? m.team1 : Number(m.winner) === 2 ? m.team2 : null;
  const people = side ? peopleOf(side) : [];
  return people.length ? people : null;
}

/**
 * BWF's name for a draw, reduced to MS / WS / MD / WD / XD.
 *
 * ⚠️⚠️ **Through `canonicalDraw`, not an uppercase string compare.** BWF mostly
 * uses the two-letter codes and sometimes does not: the 2010 Denmark Open calls
 * its doubles draws "MD - Men´s Doubles" and "WD - Women´s Doubles" — with a
 * Danish acute accent where an apostrophe would go — and an exact match dropped
 * both finals. The model has known every variant since the season parser was
 * written; the harvest was the one reader that had its own rule.
 */
const drawNameOf = m => canonicalDraw(m.drawName || m.eventName || m.draw);

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

/**
 * The drawId this discipline actually has **at this tournament**.
 *
 * ⚠️⚠️ **Not the `--draw` number.** `drawId` is a position in that tournament's
 * own draw list, and at a Games the group stages come first and push everything
 * along: at London 2012 the XD elimination draw is `15` and `5` is the *men's
 * doubles*, so the fallback below was one bad payload away from filing an MD
 * winner as the XD one. It never did — the endpoint 500s or comes back empty for
 * every Games — but a fallback that can silently answer with the wrong
 * discipline is not a fallback. The same trap the bracket page hit; see
 * HANDOVER 3.4k.
 *
 * `type_id` 0 is the elimination draw and the group stages are 1, so the main
 * draw is the row whose name canonicalises to the discipline code — which it may
 * well not equal: the 2010 Denmark Open lists "WD - Women´s Doubles".
 */
function drawIdFor(payload, code) {
  const rows = (payload && (payload.data || payload.results)) || [];
  const main = (Array.isArray(rows) ? rows : []).find(r =>
    r && Number(r.type_id) === 0 && canonicalDraw(r.name) === code);
  return main ? String(main.code) : null;
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

const wanted = TIER
  ? new Set([String(TIER)])
  : new Set(PYRAMID_ROWS.flatMap(r => r.tiers).map(String));

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
    /* The last day first, then outwards.
       ⚠️⚠️ **Six days, not three.** A tour event plays all five finals on its
       closing day, and the window used to be `end ± 1` on that assumption. **The
       Olympics does not**: London 2012 played the men's singles and doubles on
       the last day, the women's the day before, and the **mixed two days
       earlier still** — outside the window entirely. Paris 2024 spread them over
       four days. The singles finals are always last, which is why the two
       singles boards were complete and this went unnoticed until the doubles
       arrived missing four of five Olympic golds. It costs nothing on a normal
       tournament: the loop stops at the first day that answers, which is the
       first one asked. */
    for (const day of [end, shift(end, -1), shift(end, 1),
      shift(end, -2), shift(end, -3), shift(end, -4)]) {
      const j2 = await get(`tournaments/day-matches?tournamentCode=${t.code}&date=${day}&order=2&court=0`);
      w = winnerFromDay(j2, CODE);
      if (w) break;
    }
    if (!w) {
      // The drawId is this tournament's, not the discipline's — see `drawIdFor`.
      const list = await get(`tournaments/draws?tournament_code=${t.code}`);
      const drawId = drawIdFor(list, CODE);
      if (drawId) {
        const draw = await get(`vue-tournament-draw-data?tmtId=${t.id}&tmtType=1&drawId=${drawId}&isPara=0`);
        w = winnerFromDraw(draw);
      }
    }
    if (!w) { missing.push(t.name); continue; }
    for (const p of w) state.players[p.id] = { n: p.n, c: p.c, a: p.a, f: p.f };
    /* ⚠️ A singles winner stays a bare number and a pair is an array, rather
       than making everything an array and re-harvesting the two singles files
       for a shape change that buys nothing. `titleWinnerIds` in the model reads
       both, so nothing downstream has to know which it got. The order is BWF's,
       because it is the conventional one — man first in the mixed — and the
       model sorts a *copy* when it needs a stable key. */
    won.push({
      tier, id: t.id, name: t.name, date: String(t.start_date).slice(0, 10),
      w: w.length > 1 ? w.map(p => Number(p.id)) : Number(w[0].id),
    });
  }

  state.seasons[year] = won;
  save();

  const byRow = TIER ? `tier ${TIER}` : PYRAMID_ROWS.map(r =>
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
