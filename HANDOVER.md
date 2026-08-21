# Badminton Season Tracker — handover & plan

A general-purpose BWF badminton tool, replacing a single-tournament one. This document
carries everything worth keeping from the predecessor: the verified API map, the traps,
the operational gotchas, and the design decisions already settled by testing.

Written 21 August 2026.

---

## The project this replaces

**`Bmt WC Tool`** — `c:\Users\Thabi\Documents\Ideas\Bmt WC Tool`, published at
<https://carefulcamel61097.github.io/my-world-championships/>, repo
`carefulCamel61097/my-world-championships`.

An unofficial tracker for the BWF World Championships 2026 (17–23 August, New Delhi).
It works and it is finished. Its spine is a single hardcoded tournament:

```js
const TMT = { id: 5601, code: 'B671FB97-…', slug: 'bwf-world-championships-2026',
              dates: ['2026-08-17', …] };
```

Every view hangs off that constant. The new tool's spine is *a player over time*, which
is a different axis — not a refactor. Hence a new repo.

**Do not delete the old repo — archive it.** It costs nothing and it is the only record
of how several of these endpoints behave. Note that `tests/fixtures/` (266 files, 7.3 MB)
is **gitignored and local-only**; it is regenerable with `node tests/record.mjs` but only
while the data is still live.

### What the old tool got right, and what it did not

| Feature | Verdict |
|---|---|
| Season strip (squares) | **Keep** — becomes the centrepiece |
| Bracket view with round include/exclude | **Keep** — becomes the drill-down |
| Follow Matches (schedule) | **Keep, generalised** — auto-follows the current tournament |
| Follow Players | **Drop the view, keep the picker** — its search UI is what player selection needs |
| Predictions + PNG export | Drop. Tournament-specific novelty |
| Presets / selections | Drop |

---

## Part 1 — What we are building

A tool for looking at **any player's season**, and at **whatever tournament is on now**.

### 1.1 Season view (the centrepiece)

Pick a player, pick a year, get one square per tournament in chronological order.

Each square is a **gauge**: it fills from the bottom in proportion to how far the player
got, and the fill colour ramps green (title) → red (first-round exit). The label repeats
the information as text, so it survives colour blindness. This already exists and works —
see *Part 5*.

New on top of it:

- **Size by tournament weight** (settled — see Part 2)
- **Level filters** — include/exclude Super 1000/750/500/300/100, Challenge, etc.
- **Team-event toggle** — off by default
- **Year selector** — the underlying endpoint already takes `tmtYear`

### 1.2 Tournament view (auto-following)

Shows whatever tournament is current, switching by itself a few days before a new one
starts. **This is a solved problem** — `vue-tmt-schedule` returns exactly this. See
Part 3.

### 1.3 Bracket view

Port as-is, including the round include/exclude chips. Natural drill-down: click a square
in the season strip → that tournament's bracket with the player's path highlighted.
`pathFor(draw, key)` already does the path highlighting.

### 1.4 Player selection

`vue-rankingtable` accepts a **`searchKey`** parameter — server-side player search. The old
tool paginated 20 pages to build an index because it did not know this.

---

## Part 2 — Settled design decisions

These were decided by building a test bench against twelve real 2026 seasons and looking
at the result. Do not re-litigate them without looking at pixels.

### 2.1 Tournament weighting

**Basis: BWF's own player-commitment rules**, not the marketing numbers.

> Top Committed Players (top 15 singles / top 10 doubles) must enter: the World Tour Finals
> if qualified; **all Super 1000**; **all Super 750**; and **two of the nine Super 500s**.
> — [Top Committed Player Programme 2026](https://corporate.bwfbadminton.com/news-single/2025/11/20/top-committed-player-programme-2026)

So **Super 750 is the line above which entry is compulsory.** That is the full-size tier —
10 of the 42 events on the 2026 calendar, about a quarter. Below it, equal steps in *area*
down to Super 100.

| `tournament_category_id` | Level | Area | Side | Box @42px |
|---|---|---|---|---|
| 20 | Worlds | 1.00 | 1.00 | 42.0px |
| 22 | Tour Finals | 1.00 | 1.00 | 42.0px |
| 23 | Super 1000 | 1.00 | 1.00 | 42.0px |
| 24 | Super 750 | 1.00 | 1.00 | 42.0px |
| 11 | Continental | 1.00 | 1.00 | 42.0px |
| 25 | Super 500 | 0.80 | 0.89 | 37.6px |
| 26 | Super 300 | 0.60 | 0.77 | 32.5px |
| 27 | Super 100 | 0.40 | 0.63 | 26.6px |
| 5 | Challenge | 0.40 | 0.63 | 26.6px |
| 6 | Series | 0.40 | 0.63 | 26.6px |
| 7 | Future | 0.40 | 0.63 | 26.6px |
| 21 | Team event | 1.00 | 1.00 | hidden by default |
| 17 | Cont. Team | 1.00 | 1.00 | hidden by default |

`side = sqrt(area)`; both box dimensions scale by `side`.

**Rules that fall out of this:**

- **Full square is 42px.** At 30px the entire weight range is only 11px wide and the
  encoding reads as noise. 42px gives 26.6–42px.
- **Every tournament keeps the same 52px column footprint.** The box shrinks *within* the
  slot; lighter events read as more air, not as a narrower column.
- **The round label is floored at 9px, never scaled below it.** Scaling it with the box
  made a Challenge quarter-final unreadable.
- **Sub-World-Tour events share the Super 100 size.** Going smaller costs legibility and
  buys a distinction the strip does not need to make.
- **Size is a user toggle, on by default.** One boolean around `Math.sqrt(W[cat])`.
- **Do not expose a scaling/contrast parameter.** It was tested; exaggerating the ratios
  makes small events illegible. The decision is made — ship one scale.

**Rejected alternatives, with reasons:**

- *Area ∝ the Super number* (Super 500 = half of Super 1000): wrong by a wide margin. A
  Super 100 title is worth roughly 46% of a Super 1000 in ranking points, not 10%.
- *Area ∝ winner's ranking points* (1.00 / 0.92 / 0.77 / 0.58 / 0.46): truthful but too
  compressed — Super 750 lands within ~1.3px of Super 1000, and the bottom four collapse
  into one apparent size.
- *Area ∝ prize money* (1.00 / 0.66 / 0.34 / 0.17 / 0.08, from the calendar's
  `prize_money`): too wide. Super 100 drops to a ~10px box and its label dies.
- *Opacity instead of size*: collides with the green→red result ramp. A dimmed red
  first-round exit reads as a different colour, not a lesser tournament.
- *Varying width, fixed height*: rejected by the user — every tournament should occupy an
  equal area of the strip.

### 2.2 Continental Championships — settled, full size

**Continental Championships (id 11)** — European, Asian, Pan Am — sit outside the World
Tour, so the commitment rules say nothing about them. **Decided 21 Aug 2026: full size
(1.00), not 0.80.** An Asian Championships title is a major, and the strip should say so.
Closed; do not re-open without pixels.

### 2.3 Team events

They carry **no individual position** (BWF returns `"N/A"`), so they render as empty
squares. At full weight they become the largest and emptiest things in the strip — maximum
prominence, zero information. **Default them off**; the toggle exists for when you want
them.

### 2.4 Doubles is a discipline, not a partnership — settled

**Decided 21 Aug 2026.** The strip makes exactly one distinction beyond the player:
**singles or doubles**. There is no partner picker.

- A player with only one kind gets **no toggle at all**, rather than a dead one.
- A player with both — Toma Popov, and 4 of the 36 recorded seasons — gets a
  two-button segmented control. **Ties go to singles**, so a season split evenly
  opens on the simpler view.
- Under `doubles`, **every doubles tournament that player entered is shown**,
  whoever they played it with. A season in which somebody changed partner in
  March is still one season, and reading it whole is the point.

⚠️ **One tournament can give `doubles` two draws** — a player entering both MD and
XD. The square can only show one, and taking whichever BWF listed first makes the
strip inconsistent from event to event. It resolves to the discipline the player
played **more of across that season** (`dominantDraw`).

An earlier draft of this section specified a partner picker defaulting to the most
recent partner. It was dropped as more machinery than the question deserves.

#### What the API does and does not carry

⚠️ **`vue-player-tournaments` carries no partner.** Verified against 36 recorded
seasons: a draw entry is `{event_id, name:"XD", score_player, score_opponent,
match_count, match_win, match_lose, game_*, points_percent, position}` and there is
no second player anywhere in the payload. The discipline is knowable; the partner
is not.

**`vue-player-match-previous` is the only place a partner appears** —
`t1p1_player_model` / `t1p2_player_model` / `t2p1_player_model` /
`t2p2_player_model`, each `{id, slug, name_display, name_display_bold}`, plus
`draw_model {id, name}`. `api.js` keeps `loadLastMatch()` for it, unused by the
season view. It answers "who did they last play with" in one call and nothing more:
there is **no partner history** anywhere, so a per-tournament partner would need
draw data, one call per tournament. Which is a further reason the strip does not
try to filter by one.

⚠️ **It returns `results` as a single match object, not an array**, even at
`drawCount=5`. Another face of the polymorphic-`results` trap in Part 3.6.


---

## Part 3 — The BWF API

Base: `https://extranet-lv.bwfbadminton.com/api`

No auth. Undocumented and unofficial — it can change without notice, so fail gracefully
and say so rather than showing a blank page.

### 3.1 Etiquette (carry this over)

- All data belongs to **BWF**. This is an unofficial fan tool and must say so.
- No BWF logo or wordmark; do not present as official. Borrow layout conventions, not
  identity.
- **Cache aggressively. Do not poll faster than ~30s even for live scores.** Rate limiting
  is real — observed at ~12 rapid requests. The old tool serialises every request through
  a queue with a **320ms gap** and a **5-minute TTL cache**; ranking data gets a 12-hour
  `localStorage` TTL.
- Credit the source visibly and link back to the BWF tournament page.

### 3.2 Endpoints — calendar & scheduling *(discovered 21 Aug 2026, all verified 200)*

These were found by capturing what bwfbadminton.com's own pages request. They are the
backbone of the new tool and were **not** known to the old one.

```
GET /vue-tmt-schedule?drawCount=1
```
Returns `{nextLive, previousTmt, nextTmt, drawCount}`. Each is a full tournament object
(`id, code, name, slug, start_date, end_date, date, tmtLink, tmtLogo, label`) with BWF's
own labels: *"Live Scores!"*, *"View Results"*, *"View Draws"*.
**This single 1.8 KB call implements the auto-following tournament view.**

```
GET /vue-grouped-year-tournaments?year=2026&category[]=20&category[]=21…&category[]=27
```
Full year grouped by month: `{results:[12]{month, monthNo, tournaments[]}, remaining, completed}`.
Works for **future years** (2027 returned 36 events, 0 completed) — the calendar is
published ahead.

⚠️ **The level arrives as a display string here, not an id**: `category:
"HSBC BWF World Tour Super 1000"`. The player endpoint uses numeric
`tournament_category_id`. You need both mappings.

Each entry also carries `prize_money`, `location`, `country`, `flag_url`, `logo`,
`has_live_scores`, `live_status` (`pre`/`post`), `status{}`.

```
GET /vue-tmt-live-scores          → {thisWeek[], nextWeek[]}, each with has_live_scores
GET /match-center/vue-current-live?showpara=0
GET /vue-tournament-categories?startDate=&endDate=   → authoritative level list
GET /vue-tournament-series?startDate=&endDate=       → 205 series
GET /vue-countries
GET /vue-rankingdata?rankId=2 · /vue-rankingweek?rankId=2 · /vue-home-ranking?drawCount=2
```

**2026 calendar composition** (verified): 4 Super 1000, 6 Super 750, 9 Super 500,
10 Super 300, 10 Super 100, 1 Finals, 2 Grade 1 = 42.
**2027**: 5 / 5 / 9 / 8 / 8 / 1 = 36.

### 3.3 Endpoints — player

```
GET /vue-player-tournaments?playerId={id}&isPara=0&drawCount=1&activeTab=0&tmtYear=2026
```
**The season endpoint — the core of the new tool.** Returns `results[]`, **newest first**
(reverse it; a season reads left to right). Each entry:
`{tournament_id, date, location, draws[], tmt_url, tournament_model{id, name, code,
start_date, tournament_category_id, …}}`, and each draw is
`{name:'MS'|'WS'|…, position, match_win, match_lose, …}`.

```
GET /vue-player-summary?playerId={id}&isPara=0&drawCount=5          → bio, avatars, slug
GET /vue-player-ranking-current?playerId={id}&isPara=0&rankingEvent={6..10}
GET /vue-player-ranking-highest?playerId={id}&isPara=0&rankingEvent={6..10}
GET /vue-player-match-previous?playerId={id}&isPara=0&drawCount=5&activeTab=0
```

`rankingEvent` is the **ranking category id** (MS 6, WS 7, MD 8, WD 9, XD 10) — *not* the
draw id. Both ranking endpoints return `"-"` if it does not match the player's discipline,
so never call them before you know the draw, and never cache under the player id alone.

### 3.4 Endpoints — rankings, draws, matches

```
GET /vue-rankingtable?rankId={2|9}&catId={id}&page={n}&drawCount=1
                     &searchKey=&publicationId=0&doubles={bool}&pageKey=10
GET /vue-tournament-draw-data?tmtId={id}&tmtType=1&drawId={1..5}&isPara=0
GET /tournaments/day-matches?tournamentCode={GUID}&date=YYYY-MM-DD&order=1&court=0
GET /h2h/statistics?t1p1={id}&t2p1={id}[&t1p2=&t2p2=]
```

`rankId`: 2 = BWF World Rankings, 9 = HSBC Race to Finals.
Ranking category ids — world: MS 6, WS 7, MD 8, WD 9, XD 10; race: 57/58/59/60/61.
Draw ids: MS 1, WS 2, MD 3, WD 4, XD 5.

### 3.5 Endpoints — the tournament pages *(discovered 21 Aug 2026, all verified 200)*

Part 3.2 was found by pointing `discover.mjs` at the calendar, home and rankings
pages. Nobody had pointed it at a *tournament* page. These are what that turned up.

```
GET /tournaments/draws?tournament_code={GUID}
```
→ `{data:[5]}`, one entry per draw:
`{name:'MS', type_id:0, type:'Elimination', code:'1', slug:'ms', size:'32',
stage_type:1, stage_name:'Main Draw', stage_order:1}`.

⚠️ Keyed on the tournament **code** (the GUID), *not* its id — unlike
`vue-tournament-draw-data`, which takes `tmtId`. The `code` field here is the draw
id that endpoint wants, so this is the honest way to enumerate a tournament's draws
instead of assuming all five exist.

**`size` is the real draw size** — Malaysia Open MS is 32, the World Championships
MS is 64. `fillFraction` currently *infers* the entry round from exit depth minus
matches played; with this it would not have to. Worth revisiting when the strip is
built, at the cost of one extra call per tournament.

```
GET /tournaments/day-matches/players?tournamentCode={GUID}&date=YYYY-MM-DD
```
→ `{players[], countries[]}`, about 32 KB. Every entrant that day with
`nameDisplay`, `firstName`, `lastName`, `initials`, `nameShort`, `slug`,
`countryCode`, `countryFlagUrl`, `avatar`. A tournament-scoped player index in one
call, where the predecessor paginated the ranking table.

```
GET /tournaments/day-matches/courts?tournamentCode={GUID}&date=YYYY-MM-DD
```
→ `[{code:'1', name:'Court 1'}, …]`

```
GET /vue-tournament-organizations
```
→ the six confederations: BWF 1, Badminton Asia 2, Badminton Europe 4, Badminton
Confederation of Africa 6, Badminton Pan Am 8, Badminton Oceania 13. Which is who
runs a Continental Championships.

⚠️ BWF's own page calls `day-matches` with **`order=2`**, not the `order=1` recorded
in 3.4. The array order is still the order of play (4.7); `order` selects which
ordering the server applies before sending it.

**Still not found: a per-match live-score endpoint** beyond
`match-center/vue-current-live`. The `/draws/` and `/live/` sub-paths of the
championship site 404 — the results page *is* the tournament view, and it loads
`tournaments/draws` plus `day-matches`.

`vue-tmt-schedule` was re-verified live while the World Championships were running:
`nextLive` was the Worlds labelled *"Live Scores!"*, `previousTmt` the Korea Masters
*"View Results"*, `nextTmt` the Pontianak Indonesia Masters *"View Draws"*. It does
what 3.2 says it does.

### 3.6 API traps — read before writing a client

⚠️ **`results` is polymorphic.** A plain array when `drawCount` is passed, a paginated
object (`{current_page, data, …}`) otherwise. Handle both.

⚠️ **Ranking paging is hard-locked at 15 rows.** `per_page`, `perPage`, `limit`,
`pageSize`, `size`, `count` are all ignored; `drawCount` changes the response *shape*, not
the row count. MS is 143 pages / 2131 rows. **There is no bulk ranking fetch** — but
`searchKey` means you rarely need one.

⚠️ **A doubles ranking only resolves against `player1_id`.** Asking with the other half
returns `"-"`, not the pair's rank. In mixed doubles BWF stores the man as `player1`, so
querying by the woman silently yields nothing. Retry with the partner's id and label the
figure as belonging to the pair.

⚠️ **`h2h/statistics` requires both sides** — one id returns HTTP 500. It also returns
`ranking.team1`/`ranking.team2` free, so a head-to-head gives you both players' rankings
with no extra request.

⚠️⚠️ **`h2h/statistics` mixes two frames of reference.** `stats.*` and `ranking.*` are
oriented to *your query* — swap `t1p1`/`t2p1` and they swap with you. But
`matches[].result.winner` and `matches[].progress.games[]` stay oriented to **that match's
own draw**. Reading `result.winner` as "team1 is who I asked about" credits about half of
all past meetings to the loser. This was a real shipped bug.

⚠️ **`position` is a placing, not a round.** `"1st"`, `"2nd"`, `"3rd"`, then `"QF"`,
`"R16"`, `"R32"`, `"R64"`, `"Qual…"`, and `"N/A"` for team events.

⚠️ **`matchStatus` has a fourth value beyond `F`/`N`/`P`**: `O` = "Off court".

⚠️ **`tournament_category_id: 7` (Future Series) exists** and was missing from the old
tool's level map. Full set seen in real data: 5, 6, 7, 11, 17, 20, 21, 22, 23, 24, 25, 26, 27.

---

## Part 4 — Operational lessons

### 4.1 BWF blocks headless Chrome

Cloudflare 403s headless Chrome and serves real ones. **Every test that touches the live
API must drive a windowed browser.** Park it offscreen with
`--window-position=-2400,0`. Headless is fine for screenshotting local files.

### 4.2 Chrome outlives `kill()` on Windows

The process we spawn is a *launcher*, not the browser. `chrome.kill()` reaps the launcher
and leaves the real browser running, which then holds:

1. the remote-debugging port — the next run cannot attach, and
2. a lock on its `--user-data-dir` — so the cleanup `rmSync` fails **silently**.

Take the whole tree down:

```js
spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
```

These are one bug with two symptoms. The port symptom was misdiagnosed as a "transient
flake" three times before the second symptom forced the real diagnosis.

### 4.3 Throwaway profiles will fill the disk

Every suite launches Chrome on a fresh `%TEMP%` profile (~50 MB) and deletes it on exit.
Any run that crashes — or whose Chrome survives, per 4.2 — leaves one behind. **467 of
them accumulated and took a 238 GB disk to zero bytes free**, which surfaces as unrelated
commands dying with *No space left on device*.

**Sweep stale profiles at the start of every run, older than an hour so a concurrent run
is not sabotaged.** Do not rely on every exit path being taken.

### 4.4 Fixture record/replay

Suites against the live API took ~45s each just to load, ~14 minutes across a regression,
and the answers changed underneath as the tournament progressed. The fix:

- Intercept with **CDP's `Fetch` domain**, not a local proxy, so the app needs no
  test-only code path and what is exercised is exactly what ships.
- **Record**: pause at the *response* stage, save the body, let the request continue.
- **Replay**: pause at the *request* stage, fulfil from disk. **Anything with no fixture
  falls through to the live API and is reported** — a gap shows up as a slow test rather
  than a silent wrong answer.
- Key on a SHA-1 of the full URL.

Result: 16 suites in 10 minutes.

### 4.5 Name handling

BWF names need real work: sponsor prefixes, edition numerals, and surname extraction for
display. The old tool has a dedicated test suite for it.

⚠️ **Known bug, carried over, not yet fixed.** The sponsor stripper drops consecutive
leading all-caps tokens. `"YONEX US Open 2026"` loses `YONEX` (right) and then `US`
(wrong), rendering as just **`"Open"`**. Stripping `VI` and `XXIX` *is* correct — those are
edition numerals. Fix with a small allow-list (`US`, `USA`, `UAE`, `UK`), not a rewrite.

### 4.6 Bracket geometry

Cells are placed by a spacing law — column `c`, row `r` sits at `(r + 0.5) · 2^c`. To show
only the later rounds you must **re-lay-out the tree from the chosen round**; merely
hiding the early columns leaves the surviving cards flung to the corners of an equally
tall canvas. Filtering rounds is a layout change, not a visibility change.

### 4.7 Order of play

The **array order from `day-matches` is the order of play.** Do not sort by `matchTime` —
BWF spaces the estimates a flat 50 minutes apart and they are not real.

---

## Part 5 — What to port from the old repo

Roughly 35–40% of `app.js` (3894 lines) is reusable, and it is the expensive 40% — it
encodes API behaviour that cost real time to learn.

| From | Lines | What it is |
|---|---|---|
| `tests/run.mjs`, `fixtures.mjs`, `record.mjs` | ~570 | The whole harness. Take verbatim |
| `app.js` API layer | 75–205 | Two-lane queue, 320ms pacing, TTL cache, retry |
| `app.js` name helpers | 268–420 | Team keys, surnames, `shortTmtName` |
| `app.js` season strip | 1698–1885 | `loadSeason`, `positionInfo`, `fillFraction`, `seasonStrip` |
| `app.js` bracket | 1890–2560 | Layout, round chips, zoom/pan, `pathFor` |
| `app.js` rank index | 843–936 | Becomes the player picker — but use `searchKey` now |
| `app.js` picker | 3383–3510 | Name/country search UI |
| `README.md` §3 | — | The full API investigation. Mine it |

**Do not port:** draw loading tied to a fixed 5-draw tournament, day-matches/live refresh
as written, predictions, PNG export, presets.

### Stack

Vanilla JS, no build step, **no `package.json` and no dependencies**. `index.html` +
`app.js` + `styles.css`, served over `http://` (not `file://`). Node 24 for the harness,
using the global `WebSocket`. Deployed on GitHub Pages. This worked well — keep it.

---

## Part 6 — Build order

1. ~~**Skeleton + API client.**~~ **Done 21 Aug 2026.** The two-lane queue, the cache, the
   retry and the name helpers, with the harness and the stale-profile sweep in from the
   first commit.
2. ~~**Season view.**~~ **Done 21 Aug 2026.** The strip, the year stepper, the Part 2
   weighting, the level filters, the team toggle and the singles/doubles toggle. Geometry
   is asserted off the laid-out DOM in `tests/test_season.mjs`, not off the model, so a
   stylesheet cannot quietly override the settled sizes.
3. **Player selection.** `vue-rankingtable` with `searchKey`, plus recently-viewed.
4. **Tournament view.** `vue-tmt-schedule` drives it. Results when a tournament is
   finished, draws when the next one is up, live scores while it runs.
5. **Bracket + drill-down.** Port the bracket; wire season square → that tournament's
   bracket with the player's path lit.
6. **Harness throughout.** Port `run.mjs` at step 1, not step 6 — with the stale-profile
   sweep from 4.3 in place from the first commit.

---

## Part 7 — Open questions

- ~~**Continental Championships weight**~~ — settled at full size. See Part 2.2.
- ~~**Doubles seasons**~~ — settled. See Part 2.4.
- ~~**How far back do seasons go?**~~ — tested 21 Aug 2026. `tmtYear` accepts **any**
  year and returns an empty `results` array rather than an error for one it has nothing
  for, so an empty season is never distinguishable from an out-of-range year by the
  response alone — the view has to say both. Real data reaches back to at least **2007**
  (CHOU Tien Chen, id 34810: 3 tournaments in 2007, 0 in 2006). SHI Yu Qi returns 9 for
  2014 and 0 for 2010, which is his career rather than the floor of the data.
- ~~**Is there a draw/live endpoint we still have not found?**~~ — run 21 Aug 2026
  against two tournament pages. It found `tournaments/draws`,
  `day-matches/players`, `day-matches/courts` and `vue-tournament-organizations`;
  see Part 3.5. A per-match live-score endpoint beyond `match-center/vue-current-live`
  is still not among them.
- **Should `fillFraction` use the real draw size?** `tournaments/draws` gives `size`
  per draw (Part 3.5), which would replace the inference from exit depth minus
  matches played — at one extra call per tournament. Decide when the strip is built.
- **Does the calendar's `category` string map cleanly onto `tournament_category_id`?**
  Both are in use and the mapping is currently inferred from the level names.
