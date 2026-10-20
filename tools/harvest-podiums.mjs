/* Who stood on the podium, season by season — all five disciplines in one pass.
 *
 *   node tools/harvest-podiums.mjs                 2007..this year
 *   node tools/harvest-podiums.mjs --from 2024     a shorter run
 *   node tools/harvest-podiums.mjs --year 2026     one season, re-harvested
 *   node tools/harvest-podiums.mjs --force         ignore the files on disk
 *
 * `harvest-winners.mjs` collects the champion of the pyramid's tiers and
 * nothing else, because the pyramid draws nothing else. The Year view needs the
 * runner-up and both semi-finalists as well, at Super 500 and above, which is
 * one season at a time rather than twenty at once.
 *
 * ⚠️⚠️ **One pass for all five disciplines, not five runs.** `day-matches`
 * answers with the whole day — every draw, every court — so the five-run shape
 * `harvest-winners.mjs` has (`--draw 1`, `--draw 2`, …) fetches each payload
 * five times and throws four fifths of it away each time. At twenty seasons
 * that is four fifths of an hour spent on bytes already in hand.
 *
 * ⚠️ **One file per season**, `data/podium-<year>.json`, because the view shows
 * one season at a time and the depth here is four competitors an event against
 * the pyramid's one. A single file would be megabytes to load in order to draw
 * one year of it. It also makes the resume trivial: a season on disk is done.
 *
 * ⚠️ **Super 500 and above, which costs nothing before 2018.** Four old tiers
 * became five and Super 500 is the one nothing maps to (see `mappedTier`), so
 * `25` only ever adds events from 2018 on: Superseries Premier is Super 1000
 * and Superseries is Super 750, both already on the pyramid, and Grand Prix
 * Gold and Grand Prix map to Super 300 and Super 100, both below the floor. The
 * measured count is 26 events a season from 2018 and 17 before it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, sweepProfiles } from '../tests/browser.mjs';
import {
  pyramidTier, PYRAMID_ROWS, canonicalDraw, isContinentalTier, titleConf,
} from '../model.js';

const API = 'https://extranet-lv.bwfbadminton.com/api/';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEP = String.fromCharCode(1);
const DRAWS = ['MS', 'WS', 'MD', 'WD', 'XD'];

const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const has = flag => process.argv.includes(flag);

const ONE = Number(arg('--year', 0));
const FROM = ONE || Number(arg('--from', 2007));
const TO = ONE || Number(arg('--to', new Date().getUTCFullYear()));
const FORCE = has('--force') || !!ONE;

/* The pyramid's rungs, plus the one tier that exists only to be collected here.
   ⚠️ Derived from `PYRAMID_ROWS` rather than written out, so a rung added to the
   board cannot go missing from the podium files. */
const WANTED = new Set([...PYRAMID_ROWS.flatMap(r => r.tiers).map(String), '25']);

/* ⚠️⚠️ **BWF has three spellings of the same round and they vary by season, not
   by tier.** The 2016 Olympics says `SF` and `QF`; the 2024 Olympics says
   `Semi-finals` and `Quarterfinals`; every tour event in every season from 2007
   to 2026 says `SF`. Measured 20 Oct 2026 across both Olympic forms, the
   Superseries era (2007, 2010, 2014, 2017) and the modern tour.
   An exact compare on any one of them silently drops a Games. */
const IS_FINAL = /^\s*final\s*$/i;
const IS_SEMI = /^\s*(sf|semi[\s-]*finals?)\s*$/i;
/* ⚠️⚠️ **The bronze play-off is `"3/4"`** — not "Bronze", not "3rd place". It is
   the only round name on this endpoint that is not a word, which is why a filter
   written from the obvious vocabulary counts it and never sees it. The other
   spellings are kept because nothing says BWF will not use one. */
const IS_BRONZE = /^\s*(3\s*[/-]\s*4|bronze.*|(3rd|third)[\s/-]*(place|4th)?)\s*$/i;

const roundOf = m => {
  const r = String((m && m.roundName) || '');
  return IS_FINAL.test(r) ? 'f' : IS_SEMI.test(r) ? 's' : IS_BRONZE.test(r) ? 'b' : null;
};

sweepProfiles({ quiet: true });
const b = await launch({ port: 9474, tag: 'podium' });
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
 * Everybody on one side of a match, reduced to what the board draws.
 *
 * ⚠️ Every player, not `players[0]`: a doubles podium place belongs to a pair.
 * The two avatar shapes and the flag-off-the-side rules are
 * `harvest-winners.mjs`'s, measured there and unchanged.
 */
function peopleOf(side) {
  const list = (side && side.players) || [];
  return list.filter(p => p && p.id != null).map(p => {
    const av = p.avatar || {};
    return {
      id: String(p.id),
      n: p.nameDisplay || p.name_display || '',
      c: p.countryCode || side.countryCode || '',
      a: av.thumbnailUrl || av.url_cloudinary || av.url_thumbnail || av.url_original || '',
      f: side.countryFlagUrl || '',
    };
  });
}

/** The two sides as [winner, loser], or null if nobody won it. */
function endsOf(m) {
  const w = Number(m.winner);
  if (w !== 1 && w !== 2) return null;
  const won = peopleOf(w === 1 ? m.team1 : m.team2);
  const lost = peopleOf(w === 1 ? m.team2 : m.team1);
  /* ⚠️ A hollowed row has a winner and no players (HANDOVER 2.14), so the
     emptiness has to be checked on both sides rather than trusted. */
  return won.length && lost.length ? [won, lost] : null;
}

const drawNameOf = m => canonicalDraw(m.drawName || m.eventName || m.draw);

const rowsOf = j => {
  const rows = Array.isArray(j) ? j : ((j && (j.results || j.matches)) || []);
  return Array.isArray(rows) ? rows : (rows.data || []);
};

const shift = (day, n) => {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** One competitor or a pair, as the file stores them. */
const idsOf = people => (people.length > 1
  ? people.map(p => Number(p.id)) : Number(people[0].id));

/**
 * The podium of every draw at one tournament.
 *
 * ⚠️⚠️ **The window is wide and the Olympics is why.** A tour event plays all
 * five finals on its closing day and both semi-final days the day before — two
 * calls, measured on every season from 2007 to 2026. The Olympics spreads its
 * five finals over four days and its bronze play-offs over five, and Paris 2024
 * played the mixed final *four days* before the men's singles. So the walk
 * stops early where it safely can and runs the whole window at a Games.
 *
 * ⚠️ `end+1` is in the list because an `end_date` is not always the last day
 * play happened on, and it is third rather than first so the common case still
 * costs two calls.
 */
async function podiumOf(t, tier) {
  const end = String(t.end_date).slice(0, 10);
  const spread = String(tier) === 'OLY' || String(tier) === 'GAMES';
  const days = [end, shift(end, -1), shift(end, 1),
    shift(end, -2), shift(end, -3), shift(end, -4),
    shift(end, -5), shift(end, -6), shift(end, -7), shift(end, -8)];

  // draw code -> { f: [won, lost], s: [[won,lost], …], b: [won, lost] }
  const got = new Map();
  const take = list => {
    let added = 0;
    for (const m of list) {
      const where = roundOf(m);
      const code = drawNameOf(m);
      if (!where || !code || !DRAWS.includes(code)) continue;
      const ends = endsOf(m);
      if (!ends) continue;
      if (!got.has(code)) got.set(code, { s: [] });
      const g = got.get(code);
      if (where === 's') {
        /* ⚠️ Keyed on the losing side, because a day asked for twice must not
           grow a third semi-finalist. The whole-day payload is re-fetched on a
           retry and `end+1` can repeat `end` at a tournament whose dates BWF
           has since corrected. */
        const key = ends[1].map(p => p.id).sort().join('+');
        if (!g.s.some(x => x[1].map(p => p.id).sort().join('+') === key)) {
          g.s.push(ends); added++;
        }
      } else if (!g[where]) { g[where] = ends; added++; }
    }
    return added;
  };

  /** Every draw that has a final also has both its semi-finals. */
  const complete = () => got.size > 0
    && [...got.values()].every(g => g.f && g.s.length >= 2);

  let quiet = 0;
  for (let i = 0; i < days.length; i++) {
    const j = await get(`tournaments/day-matches?tournamentCode=${t.code}`
      + `&date=${days[i]}&order=2&court=0`);
    const added = take(rowsOf(j));
    if (!spread && complete()) break;
    /* Two days running with nothing new on them means the walk is below the
       semi-finals, and everything this tournament is going to say it has said.
       Without this a tournament missing one final — the 2026 Asian
       Championships mixed doubles is the measured case — walks the whole
       window to learn nothing. */
    quiet = added ? 0 : quiet + 1;
    if (!spread && i >= 2 && quiet >= 2 && got.size) break;
  }

  /* ⚠️⚠️ **The draw route is the only place some finals exist.** The 2026 Asian
     Championships answers four finals on its closing day and ten semi-finals
     the day before: the mixed final is on no day, under `order=1` or `order=2`,
     anywhere in the window. `vue-tournament-draw-data` has it, which is how
     `harvest-winners.mjs` came to record that champion at all. Asked for only
     where a draw is short, because it is 256–407 KB a call and 500s outright at
     some tournaments — including, as the other harvest records, the Paris 2024
     Olympics and the 2026 Indonesia Open. */
  const short = DRAWS.filter(code => {
    const g = got.get(code);
    return g && (!g.f || g.s.length < 2);
  });
  if (short.length) {
    const list = await get(`tournaments/draws?tournament_code=${t.code}`);
    const rows = (list && (list.data || list.results)) || [];
    for (const code of short) {
      /* The drawId is this tournament's own position, not the discipline's —
         at a Games the group stages come first and push everything along. */
      const main = (Array.isArray(rows) ? rows : []).find(r =>
        r && Number(r.type_id) === 0 && canonicalDraw(r.name) === code);
      if (!main) continue;
      const draw = await get(`vue-tournament-draw-data?tmtId=${t.id}`
        + `&tmtType=1&drawId=${main.code}&isPara=0`);
      const res = (draw && draw.results) || {};
      take(Object.values(res)
        /* ⚠️ Each slot wraps its match: `results["5-0"]` is `{match: {…}}`. */
        .map(v => (v && v.match ? v.match : v))
        .filter(m => m && typeof m === 'object')
        .map(m => Object.assign({ drawName: code }, m)));
    }
  }

  /* What the file stores. A draw with no final is left out entirely: the view
     reads an absence against the tournament's end date, which is the only way
     to tell "not played yet" from "BWF has no record of it". */
  const out = {};
  const holes = [];
  for (const code of DRAWS) {
    const g = got.get(code);
    if (!g || !g.f) { if (g) holes.push(`${code}/final`); continue; }
    const row = { w: idsOf(g.f[0]), f: idsOf(g.f[1]) };
    /* ⚠️⚠️ **Where a bronze play-off was played the two semi-final losers are
       not equal and the file must say so.** `sf` is then ordered third-then-
       fourth and `po` marks it; without a play-off the pair share third and the
       order is BWF's, which means nothing. Every Olympics has one in all five
       disciplines — measured at 2016 and 2024 — and a tour event never does. */
    if (g.b) {
      row.sf = [idsOf(g.b[0]), idsOf(g.b[1])];
      row.po = 1;
    } else if (g.s.length >= 2) {
      row.sf = g.s.slice(0, 2).map(x => idsOf(x[1]));
      /* ⚠️⚠️ **A medal can be won without a match being played.** Carolina MARIN
         tore a knee ligament in her Paris 2024 semi-final and withdrew, so the
         women's singles bronze play-off was never played and BWF has no `3/4`
         row for it — Gregoria Mariska TUNJUNG took the bronze by walkover. The
         other four disciplines have one. There is nothing in the payload that
         tells a walkover bronze from a shared third place, so the file says
         what it can prove and the pair are drawn level. Logged so an audit
         sees it rather than silently reading as a tour event.

         ⚠️ **Only at an Olympics.** The regional Games award two bronzes and
         play no play-off — measured across every Asian, European, Pan Am and
         African Games from 2018 to 2023, all five disciplines, not one `3/4`
         row between them. Logging those put sixty expected lines in the
         harvest's output and buried the one case that is a real absence. */
      if (String(tier) === 'OLY') holes.push(`${code}/no play-off row`);
    } else {
      holes.push(`${code}/sf`);
    }
    out[code] = row;
  }
  const people = [];
  for (const g of got.values()) {
    for (const ends of [g.f, g.b, ...g.s]) {
      if (ends) people.push(...ends[0], ...ends[1]);
    }
  }
  return { draws: out, holes, people };
}

for (let year = FROM; year <= TO; year++) {
  const out = path.join(ROOT, 'data', `podium-${year}.json`);
  if (!FORCE && fs.existsSync(out)) { console.log(`${year}  (already)`); continue; }

  /* ⚠️ No `category[]` filter, for the reason the other harvest records: the
     2017 World Championships is filed under "BWF Events" and the categories a
     filter would name have changed twice since. */
  const j = await get(`vue-grouped-year-tournaments?year=${year}`);
  const all = ((j && j.results) || []).flatMap(m => m.tournaments || []);
  if (!all.length) { console.log(`${year}  nothing on the calendar`); continue; }

  const majors = all.map(t => ({ t, tier: pyramidTier(t) }))
    .filter(x => x.tier != null && WANTED.has(String(x.tier)))
    .sort((a, c) => String(a.t.start_date).localeCompare(String(c.t.start_date)));

  const state = { generated: '', season: year, players: {}, events: [], holes: [] };

  /* ⚠️⚠️ **One title per confederation per tier per season**, the trap
     `harvest-winners.mjs` documents at length: BWF lists the same continental
     event twice in six of the twenty seasons, sometimes under two sponsors and
     sometimes as the team edition followed by the individual one with nothing in
     either name to say which is which. Claimed only once a final has been found,
     so the team edition — whose draws are the bare "Singles"/"Doubles" of a tie
     — yields nothing and lets the individual one take the slot. */
  const taken = new Set();
  const slot = (tier, name) =>
    (isContinentalTier(tier) ? `${tier}|${titleConf({ name })}` : null);

  const row = (t, tier, draws) => ({
    tier, id: t.id, name: t.name,
    date: String(t.start_date).slice(0, 10),
    end: String(t.end_date).slice(0, 10),
    draws,
  });

  /* ⚠️⚠️ **An event that yielded nothing is still a column.** The view has to
     draw the hole where a tournament goes and say what the hole is — the
     reader's own requirement — and the two reasons are told apart by the end
     date against today, so nothing has to be stored to say which. Six of the
     2026 season's twenty-seven were simply not played yet when this first ran.

     ⚠️ Held back rather than written straight out, because the one case that is
     *not* a hole is the duplicate continental listing: the team edition comes
     first in the calendar, yields no final in any individual draw, and would
     otherwise be recorded as an empty column standing beside the individual
     championships it is a second listing of. A slot somebody else filled means
     duplicate; a slot nobody filled means the championships really is missing. */
  const empties = [];

  for (const { t, tier } of majors) {
    const key = slot(tier, t.name);
    if (key && taken.has(key)) continue;
    const { draws, holes, people } = await podiumOf(t, tier);
    if (!Object.keys(draws).length) { empties.push({ t, tier, key }); continue; }
    if (key) taken.add(key);
    for (const p of people) state.players[p.id] = { n: p.n, c: p.c, a: p.a, f: p.f };
    state.events.push(row(t, tier, draws));
    for (const h of holes) state.holes.push(`${t.id} ${t.name}: ${h}`);
  }

  for (const { t, tier, key } of empties) {
    if (key && taken.has(key)) {
      state.holes.push(`${t.id} ${t.name}: second listing of a ${key} title`);
      continue;
    }
    state.events.push(row(t, tier, {}));
  }
  state.events.sort((a, c) => String(a.date).localeCompare(String(c.date)));

  state.generated = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(state));

  const today = new Date().toISOString().slice(0, 10);
  const played = state.events.filter(e => Object.keys(e.draws).length);
  const soon = state.events.filter(e => !Object.keys(e.draws).length && e.end >= today);
  const lost = state.events.filter(e => !Object.keys(e.draws).length && e.end < today);
  const full = played.reduce((n, e) =>
    n + DRAWS.filter(c => e.draws[c] && e.draws[c].sf).length, 0);
  console.log(`${year}  ${String(state.events.length).padStart(2)} events  `
    + `${String(full).padStart(3)}/${played.length * 5} full podiums  `
    + `${Object.keys(state.players).length} people`
    + (soon.length ? `  ${soon.length} still to come` : '')
    + (lost.length ? `  ⚠️ ${lost.length} with no record` : '')
    + `  ${calls} calls`
    + (state.holes.length ? `\n      ${state.holes.join('\n      ')}` : ''));
}

console.log(`\n${calls} calls in total`);
b.close();
