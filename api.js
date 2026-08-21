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

/** Bio, avatars and slug. */
export function loadPlayer(playerId, opts = {}) {
  return getJSON('vue-player-summary', {
    playerId, isPara: 0, drawCount: 5,
  }, opts);
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
 * Server-side player search. The predecessor paginated twenty ranking pages to
 * build a local index because it did not know `searchKey` existed.
 *
 * rankId 2 = BWF World Rankings, 9 = HSBC Race to Finals. Ranking category ids
 * are MS 6, WS 7, MD 8, WD 9, XD 10 — these are *not* the draw ids.
 */
export function searchPlayers(searchKey, catId, opts = {}) {
  return getJSON('vue-rankingtable', {
    rankId: 2, catId, page: 1, drawCount: 1,
    searchKey, publicationId: 0,
    doubles: catId >= 8, pageKey: 10,
  }, { persist: true, ...opts });
}
