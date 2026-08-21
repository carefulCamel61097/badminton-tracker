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
  };
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
      name: String(p.name_display || '').replace(/\s+/g, ' ').trim(),
      slug: p.slug || '',
      country: c.name || '',
      countryCode: c.code_iso3 || '',
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
