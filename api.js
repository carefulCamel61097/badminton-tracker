/* The BWF request layer.
 *
 * All data here belongs to BWF. This is an unofficial fan tool: the API is
 * undocumented, unversioned and can change without notice, so every call fails
 * loudly rather than rendering a confident blank page.
 *
 * Etiquette is not optional and is enforced structurally rather than by
 * convention — there is no way to reach the API from this app that bypasses the
 * queue. BWF rate-limits bursts (observed at ~12 rapid requests, which start
 * coming back with empty bodies), so everything is serialised with a 320ms gap
 * and cached.
 */

import { parseSeason } from './model.js';

export const API = 'https://extranet-lv.bwfbadminton.com/api';

/* BWF's asset hosts. Flags and player photographs are served from these and are
   hotlinked rather than copied: they are BWF's images, the tool credits BWF,
   and re-hosting somebody else's photographs would be the worse choice.
   ⚠️ Both 403 a plain HTTP client the same way the API does — they load in a
   browser and nowhere else, so a curl check of one of these URLs means nothing. */
const FLAG_HOST = 'https://extranet.bwf.sport/docs/flags-svg';

/** A country_model to a flag image, or '' if BWF did not name one. */
export function flagUrl(country) {
  const file = country && country.flag_name_svg;
  return file ? `${FLAG_HOST}/${file}` : '';
}

/**
 * The player's photograph. `url_cloudinary` is a square 308px crop made for
 * exactly this; the others are the full-frame original, which is portrait and
 * has to be cropped by CSS.
 */
export function avatarUrl(avatar) {
  if (!avatar) return '';
  return avatar.url_cloudinary || avatar.url_thumbnail || avatar.url_original || '';
}

/** BWF returns some names as markup. Take the text and let the page escape it. */
function plainName(model) {
  const raw = (model && (model.name_display || model.name_display_bold)) || '';
  return String(raw).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

const REQ_GAP_MS = 320;
const CACHE_TTL_MS = 5 * 60 * 1000;
const RANK_TTL_MS = 12 * 60 * 60 * 1000;   // ranking tables move once a week
const CACHE_PREFIX = 'bst:';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ============================ the queue ============================

   Two lanes, not one chain. Background work — a ranking table is paginated 15
   rows at a time and hard-locked there, so an index is dozens of calls — would
   otherwise sit in front of whatever the user just clicked and leave the view
   spinning. Anything the visible view needs goes in the fast lane.
   ================================================================ */

const lanes = { high: [], low: [] };
let laneBusy = false;

function pumpLanes() {
  if (laneBusy) return;
  const job = lanes.high.shift() || lanes.low.shift();
  if (!job) return;
  laneBusy = true;
  job.run().then(job.resolve, job.reject).finally(() => {
    setTimeout(() => { laneBusy = false; pumpLanes(); }, REQ_GAP_MS);
  });
}

function enqueue(run, priority) {
  return new Promise((resolve, reject) => {
    lanes[priority === 'low' ? 'low' : 'high'].push({ run, resolve, reject });
    pumpLanes();
  });
}

/** How much work is outstanding — the status line reads this. */
export function queueDepth() {
  return lanes.high.length + lanes.low.length + (laneBusy ? 1 : 0);
}

/* ============================ the cache ============================

   sessionStorage for most things, so a re-render is free and a reload is
   honest. Ranking data goes to localStorage on a 12-hour TTL because it only
   changes weekly and it is the most expensive thing here to rebuild.
   ================================================================ */

function store(persist) {
  try { return persist ? localStorage : sessionStorage; } catch { return null; }
}

function cacheGet(key, persist, ttl) {
  const s = store(persist);
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    if (!raw) return null;
    const { t, v } = JSON.parse(raw);
    if (Date.now() - t > ttl) return null;
    return v;
  } catch { return null; }
}

function cacheSet(key, value, persist) {
  const s = store(persist);
  if (!s) return;
  try { s.setItem(key, JSON.stringify({ t: Date.now(), v: value })); }
  catch { /* quota — caching is best-effort, never a failure */ }
}

/**
 * Serialised, cached GET. Retries once on an empty body, which is the shape a
 * rate-limit rejection takes here rather than a 429.
 *
 * @param {object} [opts]
 * @param {'high'|'low'} [opts.priority]  lane; defaults to high
 * @param {boolean} [opts.fresh]   skip the cache read but still write, for a
 *   live refresh that is asking precisely because the cached copy is stale
 * @param {boolean} [opts.persist] use the 12-hour localStorage cache
 */
export function getJSON(path, params, opts = {}) {
  const qs = new URLSearchParams(params || {}).toString();
  const url = `${API}/${path}${qs ? '?' + qs : ''}`;
  const key = CACHE_PREFIX + url;
  const ttl = opts.persist ? RANK_TTL_MS : CACHE_TTL_MS;

  const hit = opts.fresh ? null : cacheGet(key, opts.persist, ttl);
  if (hit !== null) return Promise.resolve(hit);

  const run = async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await sleep(1200);
      try {
        const res = await fetch(url, { method: 'GET', mode: 'cors', credentials: 'omit' });
        if (!res.ok) continue;
        const text = await res.text();
        if (!text.trim()) continue;              // rate-limited -> retry once
        const data = JSON.parse(text);
        cacheSet(key, data, opts.persist);
        return data;
      } catch (e) {
        if (attempt) throw e;
      }
    }
    throw new Error('No data from BWF for ' + path);
  };

  return enqueue(run, opts.priority);
}

/* ============================ player ============================ */

/**
 * One player's season, oldest first.
 *
 * drawCount=1 is what makes `results` come back as a plain array rather than a
 * paginated object (Part 3.5); parseSeason tolerates both regardless.
 */
export async function loadSeason(playerId, year, opts = {}) {
  const raw = await getJSON('vue-player-tournaments', {
    playerId, isPara: 0, drawCount: 1, activeTab: 0, tmtYear: year,
  }, opts);
  return parseSeason(raw, opts);
}

/**
 * Who a player id belongs to: name, country and slug.
 *
 * Everything the season needs is in vue-player-tournaments, so this is a
 * nicety — but a strip that never says whose season it is asks the reader to
 * recognise a five-digit id. Rides the low lane and is allowed to fail.
 */
export async function loadPlayer(playerId, opts = {}) {
  const raw = await getJSON('vue-player-summary', {
    playerId, isPara: 0, drawCount: 5,
  }, opts);
  const r = (raw && raw.results) || raw;
  if (!r || r.name_display == null) return null;
  const country = r.country_model || {};
  return {
    id: String(r.id != null ? r.id : playerId),
    name: r.name_display || '',
    slug: r.slug || '',
    country: country.name || '',
    countryCode: country.code_iso3 || '',
    flag: flagUrl(country),
    avatar: avatarUrl(r.avatar),
    born: String(r.date_of_birth || '').slice(0, 10) || null,
    age: ageOn(r.date_of_birth),
  };
}

/**
 * Whole years between a date of birth and today.
 *
 * BWF sends "1996-02-28 00:00:00". Compared as numbers rather than by
 * subtracting milliseconds: a birthday is a calendar event, and dividing by the
 * length of a year gets it wrong for anyone born on the 29th of February.
 */
export function ageOn(dateOfBirth, today = new Date()) {
  const m = String(dateOfBirth || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  let age = today.getFullYear() - y;
  const md = (today.getMonth() + 1) * 100 + today.getDate();
  if (md < mo * 100 + d) age--;
  return age >= 0 && age < 120 ? age : null;
}

/**
 * The ranking categories, which are *not* the draw ids: MS 6, WS 7, MD 8,
 * WD 9, XD 10. rankId 2 is the BWF World Rankings (9 is the Race to Finals).
 */
export const RANKING_CATEGORIES = [
  { id: 6,  race: 57, code: 'MS', label: "Men's singles",   doubles: false },
  { id: 7,  race: 58, code: 'WS', label: "Women's singles", doubles: false },
  { id: 8,  race: 59, code: 'MD', label: "Men's doubles",   doubles: true },
  { id: 9,  race: 60, code: 'WD', label: "Women's doubles", doubles: true },
  { id: 10, race: 61, code: 'XD', label: 'Mixed doubles',   doubles: true },
];

export const rankingFor = drawCode =>
  RANKING_CATEGORIES.find(c => c.code === String(drawCode || '').toUpperCase()) || null;

/**
 * A player's current BWF World Ranking in one discipline, or null.
 *
 * Returns `{results: 12}` for a ranked player and `{results: "-"}` otherwise —
 * including when the discipline is not one they play, so this must never be
 * asked before the discipline is known, nor cached against the player alone.
 *
 * ⚠️ **A doubles ranking only resolves against `player1_id`.** Asking as the
 * other half of the pair returns "-", not the pair's rank, and in mixed doubles
 * BWF stores the man as player1 — so querying by the woman silently yields
 * nothing. The caller has to retry with the partner and label the figure as the
 * pair's; see `loadLastMatch` for where a partner comes from.
 */
export async function loadWorldRank(playerId, rankingEvent, opts = {}) {
  const raw = await getJSON('vue-player-ranking-current', {
    playerId, isPara: 0, rankingEvent,
  }, { priority: 'low', ...opts });
  const v = raw && raw.results;
  // Number(null) is 0 and Number('') is 0, so the empty answers have to be
  // ruled out before the conversion rather than after it. There is no rank 0.
  if (v == null || v === '' || v === '-') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * A player's place in the HSBC Race to Finals, or null.
 *
 * ⚠️ There is no race variant of `vue-player-ranking-current`: it answers for
 * the world ranking categories and returns "-" for everything else, including
 * the race ids. The race standing has to come from the ranking *table*, which
 * `searchKey` can be pointed at.
 *
 * ⚠️ Unlike `vue-popular-players`, this search matches the **whole displayed
 * name** — "SHI Yu Qi" finds exactly one row here and nothing at all there.
 *
 * The row is matched back by id rather than by name, because a search for a
 * common surname returns several and a doubles row holds two players.
 */
export async function loadRaceRank(playerId, name, raceCat, opts = {}) {
  const cat = RANKING_CATEGORIES.find(c => c.race === Number(raceCat));
  if (!name || !cat) return null;

  const raw = await getJSON('vue-rankingtable', {
    rankId: 9, catId: raceCat, page: 1, drawCount: 1,
    searchKey: name, publicationId: 0,
    doubles: cat.doubles, pageKey: 10,
  }, { priority: 'low', persist: true, ...opts });

  const r = raw && raw.results;
  const rows = Array.isArray(r) ? r : (r && Array.isArray(r.data)) ? r.data : [];
  const me = String(playerId);
  const mine = rows.find(row =>
    String(row.player1_id) === me || String(row.player2_id) === me);
  const rank = Number(mine && mine.rank);
  return Number.isFinite(rank) ? rank : null;
}

/**
 * The top of a ranking table, as a shortcut to the players most people arrive
 * looking for.
 *
 * Paging is hard-locked at 15 rows — `per_page`, `limit` and the rest are all
 * ignored — so page 1 is the top 15 and `count` just trims it. Rankings move
 * once a week, which is what the twelve-hour store is for.
 *
 * ⚠️ A doubles row is a *pair*: two players, either of whom might be the one
 * being looked for, so both are returned rather than assuming the first.
 */
export async function loadTopRanked(catId, { count = 10, ...opts } = {}) {
  const cat = RANKING_CATEGORIES.find(c => c.id === Number(catId));
  const raw = await getJSON('vue-rankingtable', {
    rankId: 2, catId, page: 1, drawCount: 1,
    searchKey: '', publicationId: 0,
    doubles: !!(cat && cat.doubles), pageKey: 10,
  }, { priority: 'low', persist: true, ...opts });

  const r = raw && raw.results;
  const rows = Array.isArray(r) ? r : (r && Array.isArray(r.data)) ? r.data : [];

  return rows.slice(0, count).map(row => ({
    rank: row.rank,
    players: [[row.player1_model, row.p1_country_model], [row.player2_model, row.p2_country_model]]
      .filter(([p]) => p && p.id != null)
      .map(([p, c]) => ({
        id: String(p.id),
        name: plainName(p),
        slug: p.slug || '',
        country: (c && c.name) || '',
        flag: flagUrl(c),
      }))
      .filter(p => p.name),
  })).filter(row => row.players.length);
}

/* ============================ tournaments ============================ */

/**
 * A tournament's draws, keyed on its **code** (the GUID) rather than its id —
 * unlike vue-tournament-draw-data, which takes tmtId.
 *
 * This is what lets the season strip say how far a player got against the
 * ladder that tournament actually had, instead of inferring it. Draw sizes for
 * a played tournament are a historical fact and never change, so they get the
 * twelve-hour store rather than the five-minute one, and the low lane: the
 * strip is already on screen by the time these are asked for.
 */
export function loadDraws(tournamentCode, opts = {}) {
  return getJSON('tournaments/draws', {
    tournament_code: tournamentCode,
  }, { priority: 'low', persist: true, ...opts });
}

/**
 * The player's most recent match, which is the only place a **partner** is
 * exposed: the season endpoint names the discipline but never the second
 * player. Returns `{discipline, partner:{id,name}, opponents:[…]}` or null.
 *
 * `results` here is a single match object, not an array — the polymorphic
 * `results` trap wearing a third face.
 */
export async function loadLastMatch(playerId, opts = {}) {
  const raw = await getJSON('vue-player-match-previous', {
    playerId, isPara: 0, drawCount: 5, activeTab: 0,
  }, opts);

  const r = raw && raw.results;
  const m = Array.isArray(r) ? r[0] : r;
  if (!m) return null;

  const who = p => (p && p.id != null ? { id: String(p.id), name: p.name_display || '' } : null);
  const t1 = [who(m.t1p1_player_model), who(m.t1p2_player_model)].filter(Boolean);
  const t2 = [who(m.t2p1_player_model), who(m.t2p2_player_model)].filter(Boolean);

  const me = String(playerId);
  const mine = t1.some(p => p.id === me) ? t1 : t2.some(p => p.id === me) ? t2 : null;
  if (!mine) return null;

  return {
    discipline: String((m.draw_model || {}).name || '').toUpperCase(),
    round: m.round_name || '',
    partner: mine.find(p => p.id !== me) || null,
    opponents: (mine === t1 ? t2 : t1),
  };
}

/**
 * Player search across BWF's whole player database.
 *
 * `vue-rankingtable&searchKey=` also searches, but only within one ranking
 * category, so finding an arbitrary player would mean five calls and would
 * still miss anyone unranked. This endpoint is one call and covers everybody —
 * it returns players with no ranking and none since 2015.
 *
 * ⚠️ It matches a **single name token**, not the displayed name: "delrue" and
 * "axelsen" work, "an se young" and "shi yu qi" both return nothing. So a query
 * with spaces that comes back empty is retried on its longest word, which is
 * usually the surname.
 *
 * Results arrive alphabetically by given name rather than by any measure of
 * relevance, so they are ordered here: whole-word matches first, then names
 * that begin with the query, then the rest.
 */
export async function searchPlayers(query, opts = {}) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];

  const ask = async key => {
    const raw = await getJSON('vue-popular-players', {
      searchKey: key, activeTab: 1, page: 1,
    }, { priority: 'low', persist: true, ...opts });
    const r = raw && raw.results;
    return Array.isArray(r) ? r
      : (r && Array.isArray(r.data)) ? r.data
      : (raw && raw.pagination && Array.isArray(raw.pagination.data)) ? raw.pagination.data
      : [];
  };

  let rows = await ask(q);
  if (!rows.length && /\s/.test(q)) {
    const longest = q.split(/\s+/).sort((a, b) => b.length - a.length)[0];
    if (longest && longest.length >= 2) rows = await ask(longest);
  }

  const needle = q.toLowerCase();
  const players = rows.map(p => {
    const c = p.country_model || {};
    return {
      id: String(p.id),
      name: plainName(p),
      slug: p.slug || '',
      country: c.name || '',
      countryCode: c.code_iso3 || '',
      flag: flagUrl(c),
    };
  }).filter(p => p.id && p.name);

  const score = p => {
    const n = p.name.toLowerCase();
    const words = n.split(/\s+/);
    if (words.includes(needle)) return 0;
    if (words.some(w => w.startsWith(needle))) return 1;
    if (n.startsWith(needle)) return 2;
    return 3;
  };
  return players.sort((a, b) => score(a) - score(b) || a.name.length - b.name.length);
}
