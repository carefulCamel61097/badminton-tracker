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

Search a player by name and get their **whole career**: one row per season, most recent
at the top, and within each row one square per tournament in chronological order.

Stacking the seasons rather than showing one at a time was decided 21 Aug 2026. A career
reads as a shape — the year somebody broke through, the year they were injured — and that
shape is invisible when a year selector shows you one strip at a time.

Each square is a **gauge**: it fills from the bottom in proportion to how far the player
got, and the fill colour ramps green (title) → red (first-round exit). The label repeats
the information as text, so it survives colour blindness. This already exists and works —
see *Part 5*.

New on top of it:

- **Size by tournament weight** (settled — see Part 2)
- **Level filters** — include/exclude Super 1000/750/500/300/100, Challenge, etc.
- **Team-event toggle** — off by default
- **Season filters** — a toggle button per season, so a career can be narrowed to the
  years worth comparing. Nothing says which years a player competed in, so the app walks
  back from the current year until it hits a run of empty ones (one request each).

### 1.1b Career grid (the simpler reading)

*Added 22 Aug 2026, layout revised the same day.* A second view of the same career, opened
as a modal from the season strip, that deliberately throws away everything the strip spends
its detail on.

- **Rows are seasons**, newest at the top, same as the strip.
- **Columns are levels, not tournaments.** Each level gets a **block** of slots, and a
  season's results at that level fill it **left to right, best first**. Four Super 1000
  slots might read `W W W SF` one year and `F QF R16 R32` the next. Unplayed slots pad the
  **right-hand end** of the block.
- **Every cell is the same size** and **flooded with one colour** — no labels, no weight
  sizing, no partial fills. The difficulty is encoded by *which block* a cell is in and how
  far left it sits, never by how big or how full it is.
- Cells **butt against each other**, so runs of the same result merge into one shape. The
  only lines are at the start of each block.
- **Super 100 and above only**, with the junior circuit and the team events out entirely.
- Blocks run **hardest-first**: Olympics, Worlds, Tour Finals, Super 1000, Super 750,
  Continental, Super 500, Super 300, Super 100, then the unmapped pre-2018 era. A toggle
  chip per level; all on by default.
- A **zoom slider** sets the cell size (10–40px, default 20). It lives in `localStorage`,
  not in the hash: a shared link should open at the reader's zoom, not the sender's.
- **Two players side by side**, sharing one set of blocks and one set of rows, with their
  profiles — photograph, flag, age, world ranking, Race standing — above each grid.

Why a second view at all: the strip answers *how did this year go*, and answers it well
enough that the answer takes a moment to read. The grid answers *how did they do at this
level, year after year* at a glance, and it is the only view in which two careers can be
laid over one another.

**The first layout gave every tournament its own column, and it was wrong.** Keyed on the
tidied name, because no id survives an edition. Two problems, which turned out to be one:
a name is not a stable identity ("Japan Open" and "Open Japan"; "Thaihot China Open" and
"China Open"), and 2020–21 is full of one-offs — two Super 1000 Thailand Opens in one
January, the 2020 Finals played in 2021 — so every tier grew a ragged tail of columns one
cell deep. Shi Yu Qi came out 45 columns wide with a Super 1000 tier of five. Sorting
inside a block makes both problems disappear: two Thailand Opens are simply two Super 1000
results, which is what they were, and the same career is 35 cells wide with a Super 1000
block of four.

What it costs is real and worth stating: a cell no longer says *which* tournament without
hovering it, and a column no longer reads down the years as one event, so "this player
never enters the China Open" is no longer visible. What it buys is that every row is
directly comparable, and each block runs green-to-red left to right by construction.

Both grids live in **one** horizontal scroller. Two independently scrolling grids side by
side stop being a comparison the moment either one moves.

The comparison is in the hash (`&g=1&c=87442`), so a side-by-side is a link.

### 1.1c Honours board (what they have actually done)

*Added 22 Aug 2026.* The third view of the same career, and the only one **not organised by
season**. Shares the modal, the level chips, the discipline toggle and the comparison with
the grid; switch between them with the Grid / Honours segmented control.

- **Rows are levels**, hardest at the top, in the same order as the grid's blocks.
- **Only results at or above a bar.** Default **SF+**, with QF+, F+ and W as the other
  settings. Everything below it is simply not drawn — no ground, no ghost, nothing.
  The semi-final is the bar because a quarter-final at a Super 300 is a fortnight's work
  rather than an honour, and because a good career still has a shape at every level at SF+
  — at F+ most of the board is empty rows. Note what it does to the very first row a reader
  sees: SHI Yu Qi lost both his Olympic quarter-finals, so his Olympic row opens **empty**,
  which is the right answer and is exactly why the ghost square has to say `2 entered, none
  at SF+` rather than nothing.
- **Squares are sized by their row**, and the ladder is geometric: each row up has **φ times
  the area** of the row below. See 2.10 for why area and not side.
- **One player: rows centred.** **Two players: mirrored about a centre line**, left player
  right-aligned and reversed, so the *best* results of each meet at the spine.
- An **empty row still appears** if either player has ever entered that level, and its ghost
  square says which kind of empty it is: `26 entered, none at QF+` or `never played at this
  level`. That distinction is the reason the ghost exists at all.
- A **count** sits on the inside of each half, next to the label.
- The **bar is in the hash** (`&th=w`) because it is part of what the board claims; the
  **zoom is not**, for the same reason the grid's is not.

Why a third view: the strip and the grid both spend most of their area saying that somebody
went out early, which is true, and is most of any career, and is not what anybody means when
they ask how good a player is. The board answers *what have they actually done*. Shi Yu Qi
against An Se Young at QF+ is the case that justifies it — his Super 1000 row is a gradient
running out to yellow, hers is a wall of dark green, and no reading of either season strip
gets you there as fast.

### 1.2 Tournament view (auto-following)

Shows whatever tournament is current, switching by itself a few days before a new one
starts. **This is a solved problem** — `vue-tmt-schedule` returns exactly this. See
Part 3.

### 1.3 Bracket view

Port as-is, including the round include/exclude chips. Natural drill-down: click a square
in the season strip → that tournament's bracket with the player's path highlighted.
`pathFor(draw, key)` already does the path highlighting.

### 1.4 Player selection

**Use `vue-popular-players?searchKey=`** — despite the name, it searches BWF's whole
player database, including players with no ranking and none since 2015, in **one call**.

`vue-rankingtable&searchKey=` also searches, and is what this plan originally named, but
only within one ranking category: finding an arbitrary player would mean five calls and
would still miss anyone unranked. The old tool paginated 20 pages to build an index
because it knew about neither.

⚠️⚠️ **It matches a given-name-first form, whichever way BWF displays the name
everywhere else.** AN Se Young is held here as **"Se Young AN"** and SHI Yu Qi as
**"Yu Qi SHI"**, so searching either of them the way the rest of the site writes them —
surname first, which is how anybody would type a Korean or Chinese name — returns
**nothing at all**. This is not a near miss or a ranking problem: zero rows.

The fix is to retry the query **rotated**, first word moved to the end: `an se young`
becomes `se young an`, which is a substring of what BWF holds. Only after that is it
worth falling back to a single word.

⚠️ **A single-word fallback is a last resort, not a first move.** Results come back
**alphabetically by given name**, and `shi` returns **1310 of them across 44 pages** —
led by ". JADESHI" — with SHI Yu Qi nowhere near page one. Broadening the query makes
the answer worse, not better. Whatever does come back needs ordering client-side.

⚠️ `activeTab` does not change any of this; 0, 1, 2 and 3 all behave the same.

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


### 2.5 The gauge measures against the real draw — settled

**Decided 21 Aug 2026.** How full a square is comes from the **real size of that
draw**, fetched per tournament from `tournaments/draws` (Part 3.5), not from an
inference over the player's match record.

```
rounds  = log2(main draw size)          # 32 -> 5, 64 -> 6
fill    = (rounds - stepsFromFinal) / rounds
```

`stepsFromFinal` counts outwards from the final — champion 0, runner-up 1, semi 2,
quarter 3, R16 4, R32 5, R64 6, R128 7 — because **the final is the same round in
every draw whereas "round one" is not**. A quarter-final of a 64-draw fills 3/6 and
a quarter-final of a 32-draw fills 2/5: the honest difference, since one of them had
to win a round the other did not.

**Two stages complicate the ladder, and the payload distinguishes them:**

- **Qualifying** (`stage_type: 2`, `stage_name: "Qualifying"`) is *not* part of it.
  It comes as either a `"MS - Qualification"` draw sized `"16>4"`, or — at the Asian
  Championships — four round-robin groups of three.
- **A round robin that is the main stage** *is* part of it. The season-ending Finals
  run two groups of four into a four-player knockout: a semi-finalist won three group
  matches to get there, and counting only the knockout would score them the same as a
  first-round loser.

⚠️ **Payloads from before about 2019 leave `stage_type` and `stage_name` null**, so
those two cannot always be told apart by what the row says. They can be told apart by
shape: **a main stage has to seat the whole field**, so its groups hold at least as
many players as the knockout that follows. The 2017 Dubai Finals ran 2×4 into a
knockout of 4 — the groups are the event. The 2018 Asian Championships ran 4×3 into a
knockout of 32, which is a side entrance for twelve players, not the tournament.

**The inference is kept as the fallback** for when the extra call fails, so a square
degrades to slightly-wrong rather than blank:

```
fill = wins / (wins + stepsFromFinal)
```

The two agree exactly whenever a player entered the main draw at round one.

#### What this fixed

Measured across the 255 recorded squares that have a draw size: **9 changed, 3.5%**,
and every one was the same bug. The inference counted **qualifying wins as rounds of
the main draw**:

| | record | inferred | real |
|---|---|---|---|
| Thailand Open WS, out in R16 | 3-1 | 43% | **20%** |
| Malaysia Masters MS, out in R32 | 2-1 | 29% | **13%** |
| Malaysia Masters XD, out in QF | 3-1 | 50% | **40%** |

A qualifier who wins two qualifying matches and then loses their first main-draw
match has made a first-round exit. Their record says 2-1, and the inference read that
as two rounds won of seven.

It also fixed **R128**, which had no place on a ladder anchored at R64 and so rendered
as an unknown rather than as a first-round exit.

#### Cost

One call per tournament — about a dozen for a season, 700 bytes each. The strip
therefore renders **immediately** with the inferred fill and is corrected when the
sizes land; for most seasons nothing visibly moves. Draw sizes for a played
tournament are immutable history, so they go in the twelve-hour `localStorage` cache
and the low lane.

### 2.6 The Olympics are their own level — settled

**Decided 21 Aug 2026.** The Olympic Games come back as
`tournament_category_id: 20` — **the same id as the World Championships** — and are
told apart only by the tournament's name. They are given a level of their own,
`OLY`, at full weight, so a square says *Olympics* rather than *Worlds* and there is
a chip to filter by.

⚠️ **The Olympics do not speak the World Tour's language, and this was hiding them
completely.** Both of these were live bugs:

| | World Tour | Olympics |
|---|---|---|
| draw name | `MS` | `Men's Singles`, `Mixed Doubles` |
| placing | `QF` | `Quarterfinals` |

- An unrecognised **draw name** fell through to `kind: 'team'`, so an Olympic result
  was excluded from the singles view *and* the doubles view — it appeared nowhere.
- An unrecognised **placing** rendered as an unknown, which draws as an empty
  square, so even a medal showed as a blank.

Draw names are therefore canonicalised once, at the parse (`canonicalDraw`), and
BWF's own wording is kept alongside for the tooltip. The junior circuit needs the
same treatment: `BS U19` is boys' singles.

⚠️ **A bare `Singles` / `Doubles` — no gender — is a team tie**, and that absence is
how one is recognised. `Men's Singles` is an individual event; `Singles` is a rubber
in a Thomas Cup tie.

Other placings seen in the wild and now handled: `Semifinals`, `Round of 16`,
`Final` (which does not say who *won* it — whoever lost no match did), `Group A`
(going out in a group stage: the earliest exit there is, so it reads red and fills
the minimum), and `-` for some junior events, which means the same as `N/A`.

**Rio 2016 used `MS` and `QF`.** Tokyo 2020 and Paris 2024 use the long forms. Both
spellings have to work, and neither can be assumed from the year.

### 2.7 Dark only — settled

**Decided 22 Aug 2026.** One theme: the predecessor's BWF skin in dark. Roboto,
`#1a1a1a`, BWF red `#df2027`.

The strip is a green-to-red gauge that was judged against that ground, and a
`prefers-color-scheme` flip changes the thing that was tested. It is not a
hypothetical: the pass that shipped both modes put a first-round label in **white on
a near-white box**, because white is right when the fill reaches the middle of the
box and wrong when it fills 13%. The suite now asserts that a light preference
changes nothing, and that no label is white on a box its fill does not reach.

### 2.8 Player identity, and BWF's own images

The heading is the player: **photograph, flag, name at 27px**, then country, season
count and tournament count. A five-digit id in a text box was the previous answer
and it told the reader nothing.

```
vue-player-summary → avatar.url_cloudinary   a square 308px crop, made for this
                     avatar.url_thumbnail    the full-frame original, portrait
                     country_model.flag_name_svg   e.g. "china.svg"
```

Flags are `https://extranet.bwf.sport/docs/flags-svg/{flag_name_svg}`.

⚠️ **Both asset hosts 403 anything that is not a browser**, exactly as the API does,
so a `curl` check of one of these URLs proves nothing — they were verified by loading
them in a real page. The suite asserts `naturalWidth > 0` rather than trusting the
markup.

Images are **hotlinked, not copied**: they are BWF's photographs, the tool credits
BWF, and re-hosting somebody else's pictures would be the worse choice.

The heading also carries **age**, the **BWF World Ranking** and the **Race to Finals**
standing. All three depend on the discipline, so none can be asked before the season
has said which one the player plays.

```
vue-player-summary → date_of_birth "1996-02-28 00:00:00"
vue-player-ranking-current?playerId&isPara=0&rankingEvent={6..10}  → {results: 12} | {results: "-"}
vue-rankingtable?rankId=9&catId={57..61}&searchKey={full name}     → the race row
```

⚠️ **There is no race variant of `vue-player-ranking-current`.** It answers for the
world ranking categories (MS 6, WS 7, MD 8, WD 9, XD 10) and returns `"-"` for
everything else — including the race ids 57–61, which were tried against it and gave
nothing for every player. The race standing has to come out of the ranking *table*.

⚠️ **`vue-rankingtable`'s `searchKey` matches the whole displayed name.** "SHI Yu Qi"
finds exactly one row there — and nothing at all in `vue-popular-players`, which
matches a single token. The two searches take opposite inputs.

⚠️ **A doubles ranking only resolves against `player1_id`**, and in mixed doubles BWF
stores the man as player1 — so asking as Delphine DELRUE returns `"-"`, not her pair's
rank. The app retries through the partner from `vue-player-match-previous` and marks
the figure with an asterisk, because it is the **pair's** number and presenting it as
one player's would be a quiet lie. This is the one thing `loadLastMatch` is still used
for.

⚠️ `Number(null)` is 0 and `Number('')` is 0, so an empty ranking has to be ruled out
*before* the conversion or every unranked player shows as number 0.

Age is counted on the calendar rather than by dividing a millisecond difference —
otherwise anyone born on the 29th of February is a year out.


---

### 2.9 The grid's blocks — settled 22 Aug 2026

**A block is as wide as the most results anyone put in it in any one season.** Derived, not
declared, and that is deliberate: the declared answer moves. The 2026 calendar holds four
Super 1000s and the 2027 one holds five, and January 2021 ran **two** Super 1000 Thailand
Opens back to back in the Bangkok bubble, so Delphine DELRUE's Super 1000 block is five
wide where Shi Yu Qi's is four. Measuring it is the narrowest the grid can be while still
fitting every row.

⚠️ The cost runs both ways, and the Super 750s show it. A level a player never fills
completely is never drawn at full width: somebody who plays three of the four Super 1000s
every year gets a three-slot block, and the fourth is invisible rather than empty. And a
level whose *size changed* gets one width for the whole grid, so an empty slot does not
always mean the same thing. Counting distinct events per year across every recorded career:

```
2018  5   Malaysia, Japan, Denmark, French, Fuzhou China
2019  5   Malaysia, Japan, Denmark, French, Fuzhou China
2023  6   India, Singapore, Japan, China Masters, Denmark, French
2024  6   (same six)
2025  6   (same six)
```

The tier grew from **five to six** somewhere in the reshuffle after 2019. The block is six
wide, so a 2018 row shows an empty sixth slot that means "there were only five that year",
while a 2024 row's empty slot means "they skipped one". Both look identical. Fixing that
means asking BWF what the calendar held — see Part 7.

**The season-ending Finals belongs to the season it concludes, not the year it was
played.** COVID pushed the 2020 edition to 27 January 2021 and BWF files it under
`tmtYear=2021`, so a player who competed in both it and the 2021 edition that December had
*two* Tour Finals in one row — a contradiction, because the Finals is the one event there
is exactly one of per season. BWF's own name still says which edition it is: "HSBC BWF
World Tour Finals 2020 (New Dates)".

⚠️ Deliberately **not** a general "the year in the name wins" rule. Three other events in
the recorded data carry an earlier year than the date they were played on, and all three
stay where they were played:

```
cat 22  tmtYear 2021  start 2021-01-27  HSBC BWF World Tour Finals 2020 (New Dates)   -> moves to 2020
cat OLY tmtYear 2021  start 2021-07-24  Tokyo 2020 Olympic Games Badminton            -> stays
cat 21  tmtYear 2021  start 2021-10-09  Thomas & Uber Cup Finals 2020 (New Dates)     -> stays (team, not in the grid)
cat 74  tmtYear 2023  start 2023-10-02  ASIAN Games 2022 (Individual Event)           -> stays
cat 29  tmtYear 2023  start 2023-12-07  2024 European Team Champs Qualification        -> stays (name year is LATER)
```

The distinction is not the "(New Dates)" marker, which BWF applies inconsistently — the
Asian Games were postponed just as hard and are not marked. It is that the Finals is
**retrospective**: it is the final of a season already played, contested by whoever that
season's results qualified. An Olympics concludes nothing, and saying a player competed at
the Olympics in 2020 would be false. So the rule is scoped to group 22, and it only ever
moves a tournament backwards.

⚠️ **Two Thailand Opens in January 2021 are not one event drawn twice, and must not be
"fixed".** BWF ran the YONEX Thailand Open (12 Jan) and the TOYOTA Thailand Open (19 Jan) a
week apart in the same Bangkok bio-bubble to restart the tour, both category 23. Checked 22
Aug 2026 before touching anything, and all four signals agree they are separate 2021
events:

- Neither name carries a year at all — unlike *every other* Thailand Open in the data
  ("TOYOTA Thailand Open 2018 / 2019 / 2022 / 2023 / 2026"). BWF dropped the year because
  both were 2021 and the sponsor is what tells them apart.
- Neither is marked "(New Dates)" or "(Postponed)". Eleven events in the recorded data are,
  including the Finals — BWF does mark its reschedules.
- 2020 had no Thailand Open to delay. Thailand's only 2020 event was the Princess
  Sirivannavari Thailand **Masters**, category 26, played in January 2020.
- Thailand has never otherwise hosted a category 23. Moving one to 2020 would put a Super
  1000 result in a year that had no such tournament.

A scan for the same event twice in one season, across every recorded career, returns
exactly these two — plus the Finals, which is handled above, plus a junior championship's
team and individual halves. What the two Thailand Opens *did* need was `seasonLabels`:
tidied, both squares read "Thailand Open", so the sponsor is handed back where a label would
otherwise repeat within a row.

⚠️ **Judge that ambiguity after the 24-character clip, not before.** The clip is itself
capable of making two different names identical: both halves of the 2017 Badminton Asia
Junior Championships tidy to strings that differ only at the end and both clip to
"Pembangunan Jaya Raya A…". Comparing the untidied or unclipped names calls those distinct
and leaves two identical squares on screen. Found by the end-to-end check that no row in a
career repeats a label — which is worth keeping for exactly that reason, because the model
test that inspired it only covered the case somebody had already thought of.

**Results sort best-first, by steps from the final.** Champion 0, runner-up 1, out to a
round of 128 at 7, and then the placings with no rung on the ladder, in the order they
deserve: out in the group stage, out in qualifying, a placing we do not recognise, no
individual placing at all. Ties break by date, oldest first, so a row is stable from render
to render. Deliberately *not* `fillFraction`: that needs the real draw size, which is one
extra request per tournament, and the grid is the view that makes no extra requests.

**What is in the grid is decided from the payload, not from the category id.** Three
exclusions and one rescue, in that order:

- *Team events*: every draw is a bare "Singles"/"Doubles" with no gender, so
  `canonicalDraw` returns null. That catches the Suhandinata Cup, the Asia Mixed Team
  Championships and the Asian Games team event, none of which carry the mapped team ids.
- *Junior*: the name says so ("World Junior Championships", "Dutch Junior", "Asia Youth
  U19") or a draw carries the age band ("BS U19"). ⚠️ **`LI NING BWF World Junior
  Championship 2018` is category 20 — the senior World Championships id.** The ids cannot
  be trusted for this even inside the mapped range.
- *Below Super 100*: categories 5, 6 and 7. A Future Series title sorted next to a Super
  1000 title would read as the same result.
- *Rescued by name*: the 2017 World Championships is category **1**, the 2010 and 2012
  Asian Championships are **3** and **1**, and the 2017 Dubai World Superseries Finals is
  **8**. Without a name rule a 2017 Worlds result lands in the unmapped block at the far
  right, and the one block that should hold exactly one cell every year holds none. The
  rule moves nothing but which block a result lands in; the strip keeps weighting by the id
  it was given.

Everything else unmapped stays, grouped as **"Unmapped"** on the right with its own toggle.
Those *are* Super-100-and-above events under Superseries and Grand Prix names, and dropping
them would silently blank the first half of a long career. It is 13 slots wide for Shi Yu
Qi and one click to hide.

**A tournament entered in the other discipline takes no slot.** Under the old
tournament-per-column layout it needed a state of its own, because the column existed
either way. Here the question does not arise, and the legend is one item shorter for it.

---

### 2.10 The honours ladder is φ per *area* — settled 22 Aug 2026

The board's rows are sized geometrically, hardest at the top. The ratio is the golden
ratio, and the dimension it is applied to is **area**, so the sides go up by √φ ≈ 1.272.

⚠️ **Do not "fix" this to φ per side.** `GRID_ORDER` has ten levels. At φ per side the top
row is φ⁹ ≈ **76 times** the side of the bottom one: a 10px Super 100 square puts the
Olympics at 760px, and choosing a base that keeps the Olympics on screen puts Super 100 at
under a pixel. Per area the whole ladder spans 8.7, which fits, and every rung still reads
as a step change.

Area is also the right dimension on the merits. The claim the view makes is *how much* — the
eye totals a block of colour by area, not by edge length — and the argument for the ratio in
the first place was **worth**, not width. It is the same reasoning as the strip's
`side = sqrt(weight)` in 2.1, and the two views agree because of it.

The multipliers, which are pleasant: every second rung is an exact power of φ.

| Level | ×side | at base 7 |
|---|---|---|
| Olympics | 8.719 | 61px |
| Worlds | 6.854 | 48px |
| Tour Finals | 5.388 | 38px |
| Super 1000 | 4.236 | 30px |
| Super 750 | 3.330 | 23px |
| Continental | 2.618 | 18px |
| Super 500 | 2.058 | 14px |
| Super 300 | 1.618 | 11px |
| Super 100 | 1.272 | 9px |
| Unmapped | 1.000 | 7px |

`honourScale` keys on the level's place in `GRID_ORDER`, **not** on which rows happen to be
on screen. Switching a level off must not resize the ones left behind: a square has to mean
the same thing whatever else is showing, which is the entire basis for comparing two boards.

**The widths are computed, not assumed.** `honourHalfUnits` returns the widest half any row
needs *in units of `--hbase`*, and CSS uses it as `minmax(var(--halfw), 1fr)`. Two
consequences worth keeping:

- The unit is a bare multiplier so the **zoom slider keeps working without a re-render** —
  it moves `--hbase` and every row follows.
- The gap between squares is therefore **strictly proportional** (`calc(var(--hs) * .09)`)
  with no `max(1px, …)` floor. A floor would make a row's width a different function of the
  base at the bottom of the board than at the top, and the arithmetic would stop matching
  what was painted.

⚠️ An earlier version sized the halves with a plain `1fr` and clipped. **An Se Young has
twenty Super 1000 results at QF+**, which is wider than half a 1800px modal at any
comfortable base, and the twentieth was silently cut off — the one failure mode a view about
*how much* cannot have. The end-to-end suite now asserts `scrollWidth <= clientWidth` for
every half. The honours default base is **7**, the largest that fits the two longest careers
in the data side by side without the board needing to scroll.

The spine hangs off `.hboard`, not off the scroller, so `left: 50%` stays true when the
board is wider than the modal.

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
GET /vue-tournament-categories?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
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
GET /vue-popular-players?searchKey={text}&activeTab=1&page=1
GET /vue-rankingtable?rankId=2&catId={6..10}&page=1&drawCount=1&doubles={bool}
```
**Player search across the whole database** *(discovered 21 Aug 2026, verified 200)*.
Returns `{results:[{id, slug, name_display, name_display_break, country_model{name,
code_iso3, flag_name_svg}, avatar}], pagination, drawCount}`, 30 per page. Found by
pointing `discover.mjs` at bwfbadminton.com/players/. See the traps in Part 1.4.

The ranking table is the **top-ranked shortcut**: page 1 is the top 15, one call per
discipline. ⚠️ Its rows carry `player1_model`/`player2_model` with only
`{id, slug, name_display_bold}` — the name arrives as **markup**
(`<span class="name-1">Aria</span> <span class="name-2">DINATA</span>`) and has to be
reduced to text before it is shown. The country model here is trimmed to
`{name, flag_name_svg}`, with no `code_iso3`.

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

⚠️ **The Race standing is looked up by *name*, so it depends on a request you may not
have made yet.** There is no race variant of `vue-player-ranking-current`, so the standing
has to come from `vue-rankingtable&searchKey=<display name>` — and the display name arrives
on `vue-player-summary`, which is a separate call the view fires and does not await. Read
the name up front and it is `undefined` about as often as not, and `loadRaceRank` then
returns null without complaining: the Race standing silently disappears from the heading.
Caught 22 Aug 2026 when refactoring the rank lookup to serve two players hoisted that read
by one round trip. Read the name at the moment it is needed, and await the summary if it
still is not there.

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

⚠️ **`match_win` includes qualifying wins, but `position` is a main-draw placing.**
A qualifier who wins two qualifying matches and then loses in R32 comes back as
`{position: "R32", match_win: 2, match_lose: 1}`. Anything that infers how deep a
player got from the match count will credit those two wins as rounds of the main draw
— which is exactly why the gauge uses the real draw size instead. See Part 2.5.

⚠️ **`vue-tournament-categories` returns HTTP 500 for empty dates.** It needs a real
range, and it answers with thirteen *groups* ("HSBC BWF World Tour", "Games",
"Continental Level") rather than a flat id-to-name list, so mapping a
`tournament_category_id` through it is a job of its own.

⚠️⚠️ **A tournament still being played reports the round the player is IN**, as a
round abbreviation rather than a final placing: the 2026 World Championships returned
`"SF"` while it was on. `SF` and `F` are not in the placings table — that spells
finishes as `3rd` and `2nd` — so an unhandled one draws as an empty square, and the
event everybody is currently watching is exactly the one that shows no result. `F`
with no losses is a champion, not a runner-up.

⚠️⚠️ **The Olympics spell draws and placings out in full**: `"Men's Singles"` where the
World Tour says `MS`, `"Quarterfinals"` where it says `QF`. Rio 2016 used the short
forms and Tokyo 2020 and Paris 2024 use the long ones, so the year does not tell you
which. Anything keying off the two-letter codes silently drops Olympic results into
neither singles nor doubles. See Part 2.6.

⚠️ **A draw named bare `Singles` or `Doubles`, with no gender, is a team tie**, not an
individual event. The missing gender is the only signal.

⚠️ **`position` is a placing, not a round.** `"1st"`, `"2nd"`, `"3rd"`, then `"QF"`,
`"R16"`, `"R32"`, `"R64"`, `"Qual…"`, and `"N/A"` for team events.

⚠️ **A bare `R` and a single digit is a group-stage exit, not a round of a draw.**
Every occurrence in the recorded data is a round-robin event: at the season-ending
Finals, groups of four play three matches and anyone who fails to come out of one is
`"R3"` with a 1-2 or 0-3 record; at the Asian Championships, where the groups are the
qualifying stage, it is `"R3"` again. Whether the digit counts matches or places, the
meaning is the same. A single digit is what makes it safe to key on — every knockout
round is `R16` or larger.

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

### 4.4b Record what the app *can* ask for, not what a scroll happens to reach

Ladders load on an `IntersectionObserver`, so only season rows that come into view
cost requests. The recorder drove that by scrolling, which quietly made the fixture
set a function of the window size and the scroll step — jumping to the bottom of a
fifteen-season page skips every row in between, and rows that never intersected were
never recorded.

Nothing failed at record time. It surfaced much later as **fixture misses in a suite
whose window is a different shape**, and looked like a bug in the app. Fixing the
scroll step did not help either, because the shape had changed again.

**The recorder now calls `window.BST.loadLadders(year)` for every season outright.**
That found 76 ladders it had been missing. Where a fixture set depends on lazy loading,
drive the loading directly rather than reproducing the conditions that trigger it.

### 4.4c `captureBeyondViewport` does not photograph the top layer

`Page.captureScreenshot` with `captureBeyondViewport: true` renders the full document
height and **omits the top layer entirely** — a `<dialog>` opened with `showModal()` is
missing from the image, backdrop and all. Everything behind it photographs perfectly, so
the picture looks exactly like a modal that failed to open, and the obvious next move is to
go debugging the app. Cost about ten minutes on 22 Aug 2026; the dialog was open the whole
time, with two cards rendered in it.

Capture a modal **without** `captureBeyondViewport` and clip to the viewport. `shot.mjs`
picks per shot: the season strip needs the whole document, the grid does not.

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

### 4.8 `el.hidden = true` does not hide anything this sheet styles

⚠️ The `hidden` attribute is only a **user-agent** `display: none`, so *any* author rule
that sets `display` outranks it. This sheet sets `display` on nearly everything, so
`el.hidden = true` was a no-op on `.legend` (flex), `.kindwrap` (inline-flex) and
`.gridbody` (flex). Switching the modal to the honours board left the grid's legend and its
explanatory note sitting underneath the board, describing a view that was not on screen —
and would have left the whole grid visible had it been rendered.

Fixed once, next to the box-sizing reset, rather than remembered at every call site:

```css
[hidden] { display: none !important; }
```

Worth knowing before adding any other view that toggles: the symptom is not an error, it is
two things on screen at once, and it is easy to read as a render bug in the new code.

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
3. ~~**Player selection.**~~ **Done 21 Aug 2026.** Type-ahead over
   `vue-popular-players`, debounced, newest-keystroke-wins. Recently-viewed is still open.
3b. ~~**Career grid + compare.**~~ **Done 22 Aug 2026.** The modal grid of Part 1.1b, its
   block model in `model.js` (Part 2.9), a zoom slider, and two careers side by side
   sharing one set of blocks. Built twice: the first layout gave every tournament its own
   column and did not survive 2021 — see 1.1b. The type-ahead was made a factory at this
   point because the comparison needs a second one; the career walk was extracted as
   `walkCareer` for the same reason.
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
- ~~**Should `fillFraction` use the real draw size?**~~ — yes, settled 21 Aug 2026 and
  built. See Part 2.5.
- **Is entry to every Super 750 really compulsory?** Part 2.1 rests the whole weighting on
  it: "a top-15 singles player must enter every Super 1000 and every Super 750", which is
  what makes Super 750 the full-size tier. The recorded data does not obviously agree. AN
  Se Young played six of the six Super 750s in 2025 but five in 2024 (no Japan Open); SHI
  Yu Qi played six in 2023 and five in 2024 (no Denmark Open). Top-ranked players skipping
  one is the norm rather than the exception, which suggests the commitment programme
  permits absences, or is a minimum count rather than a full slate. **Not** acted on: the
  weighting is settled and shipped, and this is an observation about a premise, not a
  measurement of one. Worth checking against BWF's actual regulations before the weighting
  is ever revisited.

- **What are the pre-2019 category ids?** Seasons before about 2018 carry
  `tournament_category_id` values the weighting map does not know: **1, 2, 3, 4, 8,
  10, 13, 16, 33, 35** have all been seen, from the Superseries era, the Grand Prix,
  the Games and the junior circuit. They currently render as "Level 8" at full size,
  which is honest but uninformative, and it means a historical season is drawn without
  any weighting at all. `vue-tournament-categories` is the lead, with the caveat in
  Part 3.6.

  Building the grid (22 Aug 2026) read a lot of them off real names, which is evidence
  rather than a mapping — **do not turn this into weights without checking it against
  more than one career**: **2** Superseries (Korea, French, Japan, Hong Kong, Australian,
  Singapore Opens) · **8** Superseries Premier (All England, Malaysia, Indonesia, China,
  Denmark, and the Dubai Finals) · **3**/**4** Grand Prix Gold and Grand Prix · **1** a
  grab-bag of "Championships", senior and junior together · **10**/**13**/**9**/**12**
  junior · **33** the World Junior Championships **and the Youth Olympic Games** ·
  **35** the World Junior Mixed Team · **16**/**28**/**29**/**74** the Asian, European and
  Mediterranean Games.

  ⚠️ Two of those bite whatever the weights end up being. Category **1** and category
  **33** each hold senior and junior events at once, and `LI NING BWF World Junior
  Championship 2018` sits under **20**, the senior World Championships id. Any rule keyed
  on the id alone will let a junior event through.
- **Does the calendar's `category` string map cleanly onto `tournament_category_id`?**
  Both are in use and the mapping is currently inferred from the level names.
- **Should the grid's block widths come from the calendar rather than from the players?**
  Today a block is as wide as the most anyone on screen played at that level in one season
  (Part 2.9), so a player who never enters all four Super 1000s gets a three-slot block and
  the one they skip is invisible rather than empty.
  `vue-grouped-year-tournaments?year=&category[]=` (Part 3.2) returns the real calendar for
  a year and would make each block as wide as the level actually was **that season** — one
  extra call per season, immutable history, so the 12-hour store covers it. It would also
  make the width vary by row, which is a layout question as much as a data one: a block
  that is four wide in 2026 and five in 2021 no longer lines up down the grid, so either
  every row pads to the widest year or the columns stop being columns. The other blocker is
  the trap in Part 3.2: the level arrives there as a **display string**, not an id, so it
  needs the mapping the question above is about.
