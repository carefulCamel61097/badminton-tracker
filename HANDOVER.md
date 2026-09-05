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

*Added 22 Aug 2026, layout revised the same day.* One of the two readings on the **Compare**
page (1.1d), and one that deliberately throws away everything the strip spends its detail
on.

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
- Blocks run **hardest-first**: Olympics, Worlds, Tour Finals, Continental, Super 1000,
  Super 750, Super 500, Super 300, Super 100, then the unmapped pre-2018 era. A toggle
  chip per level; all on by default. (Continental moved up beside the Super 1000s on
  22 Aug 2026 — see 2.11.)
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
season**. The other reading on the **Compare** page (1.1d). Shares the page, the level chips,
the discipline toggle and the second player with the grid; switch between them with the
Grid / Honours control in the page header.

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

⚠️ **The board is not the landing view, and should not become one.** It was proposed as the
default on 22 Aug 2026 and measured before deciding. It is magnificent for the handful of
players it was built on — both of them world #1 — and it collapses for everyone else.
**Christo POPOV**, a working professional at world MD #22 with eleven recorded seasons, is
**seven squares and eight empty ghost rows** at SF+. That is a true statement about his
career and it reads as a broken page. The strip is the only one of the three that always has
something to say, so it stays the thing a reader lands on; the board is one visible click
away instead of being the first impression. Re-open this only with a shot of a mid-table
career that looks like a view rather than an error.

### 1.1d Two pages: Seasons and Compare

*Restructured 23 Aug 2026.* The app is two pages, switched from a **tab bar of their own**
(`#pageNav`) sitting between the hero and the page body:

- **Seasons** — the strip. The landing page, and the only one that always has something to
  say (see the warning in 1.1c).
- **Compare** — the grid or the board, for one player or two, with the levels, the
  discipline, the bar and the zoom in its own header.

The grid and the board **used to be a modal**, reached by a button labelled "Grid & compare"
that named neither of them. Two things were wrong with that and only one was discoverability:
a modal says *glance and dismiss*, and comparing two careers is a thing you come to the app
to do. It is a page now. `#seasonsPage` and `#comparePage` swap on `hidden`; the hero's
`.seasonsonly` controls — "Size by weight", the discipline toggle — go with the strip,
because they govern a square the compare page does not draw.

⚠️ **The nav is not a segmented control.** It was one, in the top-right corner of the hero,
for about an hour. At that size and in that position it reads as *a setting about the thing
you are looking at*, not as *the other half of the application* — whatever the labels say.
It is now a 16px tab bar with a subtitle under each name, **both tabs outlined in BWF red**
and the active one filled, and it lives outside both page sections so it survives the switch
(the suite asserts that containment). It appears with the hero, because it is about a player.

The outline is on *both* tabs deliberately: outlining only the active one makes the other
look disabled, and the point of the bar is that there are two places to go. Note the focus
ring is `--text`, **not** `--accent` — a red ring 2px outside a red border is no ring at all.

The bar costs about 60px of vertical space, which pushes one season row below the fold on
first paint — the suite's fixture count dropped from 292 to 256 because ladders load for
rows in view. That is the mechanism working, not a regression.

**The empty seat.** With one player loaded, the compare page draws a dashed
`+ Compare with a second player` slot beside them — an empty grid card, or the right-hand
half of the board's profile row. The search that actually loads them stays in the page
header and the seat focuses it, because the body is re-rendered on every season of a career
walk and an input living inside it would lose focus and its value each time.

⚠️ The seat is **not** a career: `.gcard.empty` and `.hhead.empty` are excluded from the
`cards()` and `heads()` test seams by `:not(.empty)`. The first version was not, and every
grid assertion in the suite broke at once on `card.querySelector('.who').textContent`.

With one player the board's **rows stay centred** and only the profile row splits in two.
Right-aligning a single career against a spine to make room for nobody wastes half the width
and looks like a bug rather than an invitation — the seat beside the profile says the same
thing at a fraction of the cost.

### 1.6 The Superseries era, mapped — added 23 Aug 2026

LIN Dan and LEE Chong Wei played almost entirely before the World Tour, and until this their
whole careers sat in the grid's **Unmapped** block: nothing to compare, and a strip that
said "Level 8" all the way down. The four senior pre-2018 categories are now placed on the
modern ladder.

| id | what it was | drawn as | why |
|---|---|---|---|
| 8 | Superseries Premier | Super 1000 | S1000 in 5 of the 6 series that span 2018 |
| 2 | Superseries | Super 750 | the centre of 14 spanning series, which run S1000 to S300 |
| 3 | Grand Prix Gold | Super 300 | S300 in 8, more than every other answer together |
| 4 | Grand Prix | Super 100 | thin evidence, but it sat below Grand Prix Gold |

⚠️ **`tournament_series_id` survives an edition.** Part 1.1b says no id does, and for
`tournament_model.id` that is true — but the *series* id is stable, and 1396 of 1404 recorded
rows carry one. Following a series across the 2018 boundary is what produced the table above:
the same tournaments, not a guess. It is also the identity key the grid's first design needed
and never found. Worth revisiting if column identity ever matters again.

⚠️ **Prize money cannot do this job.** Each old tier's median is about two thirds of the
modern tier it became — Premier $600k against Super 750's $850k — because the World Tour
raised the minimums. Read as dollars it drags every historical result down a rung. Good
evidence of ordering *within* an era, none at all across the boundary.

⚠️ **The name rescues must run before the mapping.** An old id is not always one tier:
category 8 is Superseries Premier **and** the Dubai World Superseries Finals; category 3 is
Grand Prix Gold **and** some Continental Championships. Mapping first put the 2017
season-ending Finals in the Super 1000 block — the id was right and the tournament was not.
Two existing tests caught it immediately.

⚠️ **Four old tiers, five new ones — nothing maps to Super 500.** A pre-2018 career therefore
shows an empty Super 500 row, and its ghost says "never played at this level", which is
literally true and slightly misleading: the tier did not exist. The note under the board says
so. Inventing a fifth old tier to make the rows line up would be making it up.

⚠️ **Before 2011 there was no Premier tier** — all twelve Superseries events were category 2,
so a 2008 All England is drawn a rung below a 2013 one. The coarsest edge of this, and part
of why every translated square is marked.

**The strip never translates.** `LEVEL` gives the old ids their real names — Superseries
Premier, Grand Prix Gold — and only `gridGroup` follows `mapsTo`. On the Seasons page a
Superseries Premier is called a Superseries Premier; the comparison views place it on the
ladder and mark that they did, with a corner cut out of the square and the original tier on
the tooltip.

⚠️ The mark is a **`clip-path`, not a gradient**. The grid has a standing rule that a cell is
never partially filled, enforced by a check that no cell carries a gradient — so the corner is
genuinely cut away rather than shaded, or that check would have had to be weakened.

---

### 1.5 Opening on somebody — added 23 Aug 2026

With no player in the link, the app loads the **world number one in men's singles** rather
than an empty strip. One call to the ranking table, which is already the top-ranked
shortcut's first request and comes out of the 12-hour cache, so a second visit costs nothing.

**Looked up, never hardcoded.** The claim is that it is whoever is number one *now*; an id
written into the source would quietly become a different claim the week they lost the
ranking. It is also guarded on `!state.playerId`, so a reader who searches during the lookup
does not have it snatched back.

---

### 1.2 Tournament view (auto-following) — built 23 Aug 2026

The third page. Shows whatever tournament is current, switching by itself, and nobody
picks anything for it to be right.

- **`vue-tmt-schedule` is the whole spine.** One 1.8 KB call returns `nextLive`,
  `previousTmt` and `nextTmt`, each a full tournament with BWF's own label. `pickTournament`
  turns those into *live* / *upcoming* / *finished* by comparing dates.
- **A day bar** across the tournament's dates, opening on today when it is on, its last day
  when it has finished, its first when it has not started.
- **A real grid**: one column per court, one row per **moment** in the day, so two cards
  level with each other were on court together. Rows nothing occupies are skipped, so
  filtering to one draw gives a dense grid rather than one full of holes.
  ⚠⚠ The rows were positions on court — "row 3 is third on this court" — until 4 September
  2026, and that is only the same thing while every court keeps step. See 3.5a.
  `courtGrid` returns **null** — and the view falls back to a plain list — when a grid would
  be a lie or a waste: any match missing its court or position means the order of play is not
  out, and with one court a grid is a list with extra machinery. Finals day is the second
  case.
  Below 1100px the grid is dropped and the cards stack; `cells` comes back **row-major** so
  that stack still reads down the day rather than down court one and back to the top.
- **The card is a scoreboard**: flag, seed, name, then **that side's own games** as badges
  with the ones they won picked out. Not a joined "21-14 14-21" line — a row of numbers
  beside a name says who won which game without the reader doing arithmetic.
- **Draw chips** (MS/WS/MD/WD/XD) to filter, and a **Refresh** that passes `fresh` so a live
  score is not read out of the five-minute cache.
- Finished matches show the duration and, when there is one, a word for it — see 3.7.
- **Only the first match on a court has a real time.** Everything after it is BWF's
  "Followed by" against a flat 50-minute estimate, so those are prefixed **≈** and carry a
  tooltip saying why, rather than being presented as fact or hidden altogether.

**Following matches.** Click a card to star it. Starred cards stay lit and everything else
recedes, which is what makes a handful of them readable across a whole day. Stars live in
`localStorage` under `bst:starred`, keyed on the **match id** — the `code` is only unique
within one draw, so MS and WD would collide. A "Starred only" filter, a count and a Clear sit
on the day bar; the filter travels in the hash (`so=1`), the stars themselves do not, because
which matches you picked is a fact about you rather than about the tournament.

⚠️ **Dimmed only once something is starred** — a deliberate departure from the predecessor,
which dimmed the day unconditionally. It could afford to: following matches was one of two
views there and the other one was for reading. Here this is the only view of a day, so
dimming by default charges every reader for a feature most have not used, and a uniformly
grey page reads as a rendering fault rather than as a state.

**All days.** The day bar opens with an `All` button that loads every day and groups the
result under one heading each. That is a real request per day, which the predecessor did not
need because it held the whole draw — seven at the queue's 320ms pacing is a couple of
seconds, they land in the cache, and the page redraws as each arrives rather than sitting
blank until the last.

**Live checking.** While the picked tournament is `live` *and* the tab is visible, the scores
are re-asked every 60 seconds, and anything whose `matchSignature` changed is marked for
three minutes. The signature is deliberately narrow — winner, status, score — because BWF
rewrites the estimated times all day and including those would light up half the grid every
minute. A `visibilitychange` handler checks immediately on returning to the tab, which is the
moment that actually matters.

**Both clocks.** The venue time is what BWF prints on the order of play; the reader's own is
shown beside it *only when it differs*, from `matchTimeUtc`. Both 24-hour, so they read as
two readings of one thing rather than two formats.

⚠️ **Not ported: head-to-head.** The predecessor put an H2H button on every card, opening
`h2h/statistics?t1p1=&t2p1=` in a panel. It is a different endpoint and its own view, and it
is the one piece of Follow Matches this page does not have.

⚠️ **`loadCareer` does not write the hash** — only the search picker does. Anything that
selects a player programmatically has to call `writeHash` itself, or it produces a page that
cannot be shared, bookmarked or reloaded. Found because the default player (1.5) left the
address bar empty.

⚠️ **This page has no player**, which makes it the only one that works on a cold open and
the reason the nav is visible before anybody has searched. Two things follow: `writeHash`
must not bail when `state.playerId` is null, and **`window.BST.ready` is the wrong thing for
a suite or a screenshot to wait on** — it is false until a player has loaded, so waiting on
it here is a four-minute timeout rather than a failure. Wait on `BST.tmt.ready()`.

⚠️ **`#now=YYYY-MM-DD` pins what the page believes today is.** Everything on it is decided
by comparing against the calendar BWF returns, so a fixture recorded in August replayed in
December would exercise a different branch every run. The suites and `record.mjs` both pin
it. It is a debugging aid as much as a seam: it is the only way to see what finals day looks
like without waiting for one.

⚠️ Re-decide when that date moves. The first version only picked a tournament when it had
no schedule yet, so changing `now=` in the hash was silently ignored and every screenshot
came out as the same day.

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
Closed; do not re-open without pixels. See **2.11** for where that puts them on the honours
ladder, and why they had to be moved there to keep the two views agreeing.

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

⚠️ **Do not "fix" this to φ per side.** The ladder has nine rungs. At φ per side the top
rung is φ⁸ ≈ **47 times** the side of the bottom one: a 10px Super 100 square puts the
Olympics at 470px, and choosing a base that keeps the Olympics on screen puts Super 100 at
under a pixel. Per area the whole ladder spans 6.9 in side, which fits, and every rung still
reads as a step change.

Area is also the right dimension on the merits. The claim the view makes is *how much* — the
eye totals a block of colour by area, not by edge length — and the argument for the ratio in
the first place was **worth**, not width. It is the same reasoning as the strip's
`side = sqrt(weight)` in 2.1, and the two views agree because of it.

The multipliers, which are pleasant: every second rung is an exact power of φ.

| Rung | Level | ×side | at base 8 |
|---|---|---|---|
| 0 | Olympics | 6.854 | 55px |
| 1 | Worlds | 5.388 | 43px |
| 2 | Tour Finals | 4.236 | 34px |
| 3 | **Continental · Super 1000** | 3.330 | 27px |
| 4 | Super 750 | 2.618 | 21px |
| 5 | Super 500 | 2.058 | 16px |
| 6 | Super 300 | 1.618 | 13px |
| 7 | Super 100 | 1.272 | 10px |
| 8 | Unmapped | 1.000 | 8px |

**A rung is not a place in `GRID_ORDER`.** Rows are *ordered* one way and *sized* another,
because two levels can be worth the same without being the same thing — see 2.11. The rung
map is derived from `GRID_ORDER` plus a one-element `SHARES_RUNG` set, never written out, so
a level added to the order gets its own rung automatically and the two cannot drift.

`honourScale` keys on the rung, **not** on which rows happen to be on screen. Switching a
level off must not resize the ones left behind: a square has to mean the same thing whatever
else is showing, which is the entire basis for comparing two boards.

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
twenty Super 1000 results at QF+**, which is wider than half a 1800px page at any
comfortable base, and the twentieth was silently cut off — the one failure mode a view about
*how much* cannot have. The end-to-end suite now asserts `scrollWidth <= clientWidth` for
every half. The honours default base is **8**, the largest that fits the two longest careers
in the data side by side on a 1440-wide screen — measured at QF+, the *widest* bar, so that
moving the bar can never introduce a scrollbar.

The spine hangs off `.hboard`, not off the scroller, so `left: 50%` stays true when the
board is wider than the page.

### 2.11 The Continentals share the Super 1000 rung — settled 22 Aug 2026

They used to sit between Super 750 and Super 500 in `GRID_ORDER`, and therefore one rung
*below* a Super 750 on the honours ladder. That was wrong twice over.

**It contradicted 2.2.** The Continentals were settled at full weight a day earlier —
"an Asian Championships title is a major" — so the strip and the board were saying different
things about the same event.

**And it broke the Super ladder.** With Continental wedged between them, Super 1000 → Super
750 was one rung and Super 750 → Super 500 was two, so the official five-level ladder came
out unevenly spaced for a reason that had nothing whatever to do with the Super events. This
is the part that is hard to see and easy to reintroduce: *any* level given a rung of its own
inside the Super run does it.

**Sharing rather than promoting is deliberate.** A Continental title is not uniform — the
Asian Championships is arguably harder than any Super 1000, and the Oceania one is not — so
"about a Super 1000, and we are not going to pretend to know better continent by continent"
is the honest claim. Ranking it *above* the Super 1000 would assert something about Europe
that is not true.

`GRID_ORDER` and `LEVEL_ORDER` both moved id 11 to sit **directly before 23**, so the
grid's columns, the strip's chips and the board's rows all agree — and so that the five
Super levels are an unbroken run of *rows* as well as an unbroken run of sizes. Nothing is
listed between Super 1000 and Super 100.

⚠️ `SHARES_RUNG` is a **map naming the partner** (`11 → 23`), not a set meaning "shares with
whatever is above me". Under the positional rule, listing the Continentals above the Super
1000s would have silently handed them the **Tour Finals'** size. Where a level is *listed*
and what it is *worth* have to stay independent, which is the whole reason a rung is not a
place in `GRID_ORDER`.

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
GET /vue-tournament-draws?tmtId={id}&tmtType=1
GET /vue-tournament-draw-data?tmtId={id}&tmtType=1&drawId={from the list}&isPara=0
GET /tournaments/day-matches?tournamentCode={GUID}&date=YYYY-MM-DD&order=1&court=0
GET /h2h/statistics?t1p1={id}&t2p1={id}[&t1p2=&t2p2=]
```

`rankId`: 2 = BWF World Rankings, 9 = HSBC Race to Finals.
Ranking category ids — world: MS 6, WS 7, MD 8, WD 9, XD 10; race: 57/58/59/60/61.
⚠️ **Draw ids are read from `vue-tournament-draws`, never assumed.** MS 1, WS 2, MD 3,
WD 4, XD 5 holds only where there is no qualifying; where there is, the qualifying draws
are numbered into the same sequence and MS is 2, WS is 4, MD is 6. See Part 3.4k.

### 3.4b The ranking archive — *(investigated 23 Aug 2026, `tools/probe-rank.mjs`)*

**The whole weekly ranking archive is reachable, and undated.** `publicationId` on
`vue-rankingtable` is a time machine — the app pins it to 0, which means "this week", and
nobody had tried anything else.

```
GET /vue-rankingtable?rankId=2&catId=6&page=1&publicationId={n}&...  -> that week's table
GET /vue-rankingweek?rankId=2      -> the most recent 60 publications, as (id, date)
GET /vue-rankingdata?rankId=2      -> the current publication, named and dated
```

| id | MS number one |
|---|---|
| 4435 | SHI Yu Qi *(2026-08-18, the current week)* |
| 3842 | Kunlavut VITIDSARN *(2025-07-01)* |
| 590-592 | LIN Dan |
| 593-603 | LEE Chong Wei |

⚠️ **One publication id covers all five categories.** A row carries
`ranking_publication_id` *and* `ranking_category_id`, so once an id is known, MS, WS, MD, WD
and XD are one call each — the expensive part is finding the id, and it is paid once.

⚠️ **`vue-rankingweek` returns 60 rows and ignores everything you add to it** — `year`,
`page`, `count`, `limit`, `startDate`/`endDate` and `tmtYear` all return the same 60. So the
archive is addressable but not *listable*: ids below the last 60 weeks have no date attached
anywhere in the API, and the table rows do not date themselves.

⚠️ **BWF's own site never asks for an old week.** The rankings page calls
`vue-rankingweek?rankId=2`, `vue-rankingdata?rankId=2` and `vue-rankingtable...publicationId=0`
and nothing else; the *player* page asks for no ranking endpoint at all. There is no ranking
history graph anywhere on the site to copy, and no dating endpoint to find.

⚠️ **The id space is ragged and its stride grows with time.** Around id 600 every consecutive
id is a world-ranking publication — one per week. By 1000 the stride is 4, and across the
last 60 weeks it averages 10 with jumps of 46 and 50. Other ranking types (race, para,
junior) take the ids in between, so *stride is not a constant and must never be interpolated*:
multiples of 200 hit at 200/400/600 and missed at every one of 800...4400.

**Dating works by walking, and the walk is verified.** From a dated anchor, scan downwards
for the next id that answers for `rankId=2`; that is the previous week. `probe-rank-walk.mjs`
ran this from 4435 for 59 steps and reproduced **all 60 dated ids exactly**, including both
of the ~50-wide jumps. 597 requests for 60 weeks — about 10 per week now, and far fewer in
the older, denser part of the id space.

⚠️ **Retry once on an empty answer while walking.** An empty body is how this API refuses a
burst (Part 3.1). Without the retry a refusal reads as "no publication at this id" and the
walk silently loses a week — and since every later date is counted backwards from the one
before it, a single lost week shifts *everything older by seven days*.

⚠️ **The floor is between id 80 and id 120.** 1...80 answer with nothing, 120 has LEE Chong
Wei on top. Not yet pinned, and worth pinning before promising any particular start year.

**`vue-player-ranking-highest` says more than it looks.**

```
{"results":{"rank":1,"date":"2012-09-20","total":14}}      LIN Dan
{"results":{"rank":1,"date":"2017-06-01","total":310}}     LEE Chong Wei
{"results":{"rank":1,"date":"2026-08-18","total":102}}     SHI Yu Qi
```

`total` is **weeks spent at that rank** and `date` is a real date. One call per player gives a
dated anchor and a dominance figure without touching the archive at all — and the dates are
independent checkpoints the walk can be validated against. It also states the thing the
Honours board cannot: LIN Dan won far more than LEE Chong Wei and was number one for 14 weeks
to his 310.

### 3.4c An eras chart, built and shelved — *(23 Aug 2026, branch `eras-chart`)*

A fourth page was built on top of 3.4b: one discipline's whole top, week by week,
drawn as a line per player. **It was judged too messy to publish and is not on
main.** Everything is on the branch — the page, the model, 39 new model checks, the
end-to-end coverage, the harvester and 135 weeks of harvested archive. Nothing was
pushed; the live site never had it.

Worth keeping from it, whatever replaces it:

**A dominance era is a reign, not a streak.** Enters on reaching the top N; survives
dips out of ≤ 4 weeks; ends on a longer absence; counts only if it holds ≥ 26 weeks
inside. ⚠️ "Consecutive weeks in the top N" is the rule that fails — BWF ranks on a
rolling 52-week sum, so the order below first place jitters every week and one week at
sixth would sever a decade. The tolerance is also what makes an injury read as two
eras rather than one. `test_model` on the branch pins it from both sides: four weeks
out survives, five splits.

⚠️ **Do not colour lines by a hash of the player id.** Which ids collide has nothing
to do with which lines share a chart; the first attempt put three blues and two greens
side by side. Assign in order of arrival among the reigns actually drawn.

⚠️ **`frozenRuns` needs a generous threshold.** Three unchanged weeks marked half a
normal season — between tournaments the top ten genuinely stands still. Eight is the
default, and it has **never yet been tested against 2020**, which is the freeze it
exists to catch. Unproven.

⚠️ **A hash that moves a setting *within* a page redraws nothing** unless the page is
named in `applyGridHash` — it only re-renders on a change of page, with special cases
per page. Any new page needs its own branch there. Caught by the end-to-end tests, not
by looking.

⚠️ **`MAX_SCAN` in the harvester was 90 and that is too small.** The walk stopped at id
3500 and reported a floor that is not one — id 600 is LEE Chong Wei. An exhaustive scan
found a real gap of more than ninety ids below 3500 with publications resuming by 3100.
500 crosses what is known. ⚠️ A sweep in steps of 10 **aliases** against a stride of
about 9 and reads as a near-empty id space; only an exhaustive scan settles a gap.

⚠️ **Every date older than the most recent 60 weeks is counted, not read.** The
harvester ends by checking itself against anchors it never used —
`vue-player-ranking-highest` gives `{rank, date}` for every player ever seen at number
one — because a drift across a gap would not make the file slightly wrong, it would
make everything below the gap fiction. That check had not run at the point the page was
shelved.

**The unresolved question is legibility, not data.** The archive is reachable and the
reign rule works; a line per player over many years was simply hard to read. Untried
alternatives, in rough order of promise: occupancy lanes (a fixed row per rank, coloured
by who holds it — immune to crowding, but loses trajectory); the number-one band alone;
or restricting to a chosen pair of careers rather than everybody at once.

### 3.4d Winners, and how to find one *(built 24 Aug 2026)*

The pyramid page needs the winner of a tournament. Nothing in the app answered that: every
endpoint it uses is keyed on a player id.

```
GET /vue-grouped-year-tournaments?year=2016        a whole season, one call
GET /tournaments/day-matches?tournamentCode={GUID}&date={last day}&order=2&court=0
```

⚠️⚠️ **`vue-tournament-draw-data` is the trap.** It returns the whole draw, looks like the
right answer, and is 256–407 KB per tournament — but it **returns HTTP 500 for some
tournaments**, including the Paris 2024 Olympics and the 2026 Indonesia Open. The day's
order of play for the tournament's **last day** is 7–14 KB, answers for both, and carries
the winner's avatar as well, so no second call per player. Draw data survives as a fallback
only.

⚠️ **The last day holds more than one final in that discipline.** At the Olympics it holds
the bronze play-off too, and it comes *first*. Match on `roundName === 'Final'`, never on
"the first MS row".

⚠️ **`results["5-0"]` is `{match: {...}}`, not the match.** Reading it as the match finds no
`roundName` anywhere, so every tournament comes back with no winner — which looks exactly
like a tournament that was never played rather than like a bug.

⚠️ **`winner` is 1 or 2, not a player id**, and 0 means nobody.

**Classification: names before categories, again.** The calendar's `category` is a display
string and it has changed twice. Three traps, each caught only because a count looked wrong:

| what | filed under | why it matters |
|---|---|---|
| 2017 World Championships | `BWF Events` | not `Grade 1 – Individual Tournaments` |
| Dubai Superseries Finals | `World Superseries Premier` | the category-8 ambiguity again |
| 2008–09 season-ender | `World Superseries Premier` | named "World Super Series **Masters** Finals" |

That last one is the instructive one: an exact phrase match on "Superseries Finals" misses
"Super Series **Masters** Finals", it then falls through to its category, and the year's
biggest World Tour title is quietly drawn as a Super 1000. The rule now matches the
bracketing words with a bounded gap rather than listing names.

⚠️ **Do not reject on a bare `\bcup\b`** when filtering team events. It was the first
version and it would reject any World Tour event named a cup. The team cups are named
(Thomas, Uber, Sudirman).

⚠️ **The Asian Games is in the data** — as `Multi-Sport Games` (2023, 2026), `Other` (2018)
and `BWF Events` (2014, 2010). Only the *name* is reliable. It is deliberately excluded
along with every other regional games: each is closed to most of the world, so counting one
picks a region.

⚠️ **`pyramidSeason` must carry `tiers` on empty rows.** A season with no Tour Finals is
drawn as the gap a Tour Finals square would have left, and without the tier there is no
height — the whole page throws on the first such season.

### 3.4f What a square was called, and which season it belongs to *(built 4 Sep 2026)*

Three things the pyramid was getting wrong, all of them the same mistake: it was reading
`data/winners-*.json` as if the file were the answer, when the file is BWF's filing.

**The season.** BWF files a tournament under the year it was *played*. The season-ending
Finals is retrospective, so the 2020 edition — played 27 January 2021 — came back under 2021,
and the pyramid drew **two Tour Finals in 2021 and none in 2020**. The career grid has never
had that bug: `tournamentSeason` moves it, on BWF's own name ("HSBC BWF World Tour Finals 2020
(New Dates)"). `winnersSeasons` now applies the same rule on the same evidence. It moves
exactly two titles in twenty seasons — that one and "VICTOR- BWF Superseries Finals 2010",
played 5 January 2011.

⚠️ **Do not generalise it to "the year in the name wins".** Exactly three names in the file
carry an earlier year than the date they were played on; the third is `Tokyo 2020 Olympic
Games Badminton`, and it must stay in 2021. A Finals is the conclusion of a season already
played, contested by the players that season's results qualified, and there is exactly one
per season — two in a column is a contradiction. An Olympics is the conclusion of nothing, and
an Olympic gold drawn in 2020 says somebody won one in a year nobody played one. It is marked
(`pyramidDisplaced` returns `held` rather than `late`) and left where it was won.

**The name of a rung.** A 2013 Super 1000 was a *Superseries Premier* and the page called it a
Super 1000. `pyramidLabel(tier, season)` composes `eraGroup` + `gridGroupLabel` — the honours
board's own tables — rather than adding a fourth list of names, so the two cannot drift.
`SS_LAST_SEASON = 2017` is the only new constant.

⚠️ **2007–2010 had one Superseries rank, not two.** There was no Premier tier before 2011.
Drawn literally that is a twelve-square slab under an empty row, which reads as a harvest bug
however true it is — so `flatSupers(season)` deals those seasons across *both* Super rows,
earlier half on top, **at the one square size**. The equal size is the claim; a larger upper
row would assert a tier that did not exist for another four years. `rowsFor` does it by
overriding the s1000 row's `tiers` to `[24]`, which carries the name and the height together
rather than special-casing either.

### 3.4g Dominance: bars, and why they are packed *(built 4 Sep 2026)*

`pyramidReigns(seasons, players, min)` returns, per player, the **runs of consecutive seasons**
in which they won at least `min` of the titles on the pyramid. `reignLanes` then packs them.

⚠️ **Strictly consecutive, unlike the shelved ranking-based eras chart** (branch `eras-chart`,
README "Dominance eras"). That one had to tolerate dips of up to four weeks because a rolling
52-week points sum jitters and a single week at sixth would sever a decade. A title count does
not jitter, so bridging a gap here would draw a run nobody had — and 2020 held two titles in
the entire season, so it severs every line on the board. That is the honest drawing.

⚠️ **Lanes are packed, and a player keeps one lane for all their runs.** One lane per player is
nine rows for MS at 3+ and fifteen for WS, mostly empty, and the succession disappears into the
white space; packed it is three. The consequence is that a lane means only "these two
overlapped" — which is the claim — and never "this lane is this person".

⚠️ **The band is placed from measured pixels, not from the widths the render asked for.** A
column's declared `min-width` is `widest * unit + 12`, which is what the widest row would be if
its squares butted together; they do not, there is a 3px gap between each pair, and a 2007
column holds twelve. Laying the bars out from that number drifts a full year to the left by the
end of the chart. `renderEraBand` reads `getBoundingClientRect` off the drawn columns, the same
way the bracket places its feeders. Both bands live inside one `.pyrwrap` so they share an
origin and a scrollbar.

### 3.4h Drawing the band *(built 4 Sep 2026)*

Four traps, three of them found by looking at the page.

⚠️ **`.erabar` must not clip.** The name is `position: sticky` so it travels with the scroll
and is readable for the whole of a ten-column run. An `overflow: hidden` ancestor is a scroll
container, and a sticky element inside one sticks to a box that never scrolls — which is to
say it does nothing, silently. `.erafill` (absolute, inset 0) does the clipping instead, and
`.erawho` is clamped with `max-width: calc(100% - 6px)` so a long name in a one-season bar
cannot hang over the neighbouring lane.

⚠️ **A season's block runs to where the *next* column starts**, not to its own right edge.
The columns are 10px apart and stopping at the edge left a dark stripe at every year
boundary, so a nine-season run read as nine bars. Only the last block in a run stops at its
own column, because that is where the run stops.

⚠️ **The intensity ramp is 0.62–0.95, not 0–1.** The wide version made every season boundary
a hard edge and undid the point of closing the gaps.

⚠️ **The badge is balanced by an equal `padding-right` on `.pyrmajor`.** In flow and unbalanced
it centred the badge and the photograph as a pair, pushing every summit photograph half a
badge to the right of its column. Absolute positioning was the other fix and is wrong: 2021
holds two summit tiles side by side, and a mark out of the flow lands on the photograph next
to it.

Colours are assigned per *career* in the band's sort order (first season first), cycling eight
hues, so both of Viktor AXELSEN's eras are the same colour and two players share one only if
eight others opened between them. The BWF red and the live-match teal are deliberately not in
the palette.

### 3.4i Exporting a slice as an image *(built 4 Sep 2026)*

`poster.js` is a fourth module: `posterLayout(file, opts)` places a range of seasons in CSS
pixels and touches no DOM, and `drawPoster` paints that onto a canvas and hands back a PNG
blob. app.js owns only the picker and the download.

⚠️⚠️ **`crossOrigin = 'anonymous'` on every photograph.** Asked of the live site with
`tools/probe-poster.mjs`'s sibling probe: BWF's image host *does* answer a CORS request and
the canvas stays readable. Without the attribute the identical image loads, draws perfectly,
and poisons the canvas — and nothing says so until `toBlob`, at the very last step, so the
symptom is a button that throws after everything looked fine.

⚠️ **The GitHub avatar is the opposite case** and cannot be fetched at all: `github.com/<user>.png`
is a redirect and the redirect drops the header, so `crossOrigin` makes it fail to load
outright. It is committed as `data/avatar.png` and served from our own origin.

⚠️ **`POSTER.unit` is the base of the whole honours ladder, not a tile size.** `honourScale`
is measured from the Super 100 rung and the smallest tier this page draws is already 2.62×
that, so the first attempt at 30 produced a six-season poster 3935px wide. 13 matches the
page's default zoom.

⚠️ **A badged tile reserves the badge's width on both sides.** Same trick as `.pyrmajor`'s
`padding-right`, and 2021 is why: it holds an Olympics and a Worlds side by side, and without
the reserved slot the cup was drawn across the Olympic champion's face.

⚠️ **Chrome silently returns a blank canvas above 16384 device pixels wide.** A twenty-season
export at 2× would hit it, so the density drops to 1 rather than the picture being cut.

⚠️ **The footer height is derived from the legend**, not fixed: the first version had a
54px footer and the third legend line lost its descenders off the bottom edge.

⚠️ **The tier ring colours exist twice** — in `styles.css` for the page and in
`poster.js`'s `TIER_RING` for the canvas — because there is no way to hand one to the other
without a build step. `test_season.mjs` reads the computed colour off a drawn tile and holds
it against the table, so they cannot drift quietly.

### 3.4l The domination score *(built 5 Sep 2026)*

The Winners page's second view — **Board** and **Score** beside the discipline, the same split
the Compare page makes between its grid and its honours board. Prototyped first as
`tools/share.html` — a dummy tool nothing linked to, deleted in the same commit that shipped
this and recoverable from `2c50601..154d9d6` — and promoted once the arguments below had
been settled by looking at it rather than by reasoning about it.

`dominationSeasons(file)` in `model.js` returns `{years, seasons, people}`; `app.js` draws the
SVG and `poster.js` draws the PNG. The metric is a **score out of 100**: 100 is every title on
the board that season with nobody else on it.

**Where the weights come from.** `titleWeight(tier) = φ^(rungs above Super 750)`, read off
`honourRung` — the ladder the photographs are already sized by. Olympics 6.854, Worlds 4.236,
Tour Finals 2.618, Super 1000 1.618, Super 750 1. So the score is not a second ranking; it is
the board's own ranking added up, and the page prints all five numbers.

⚠️ **φ per rung, not √φ, and that was measured.** The squares step by √φ on the *side*, which
steps their *area* by φ — both are "the golden ratio". Over their whole careers, √φ puts LEE
Chong Wei 83 points of accumulated score clear of LIN Dan (313 to 230); φ puts them level (285
to 276), which is the reading the eye already has. Area is also what the eye compares on the
pyramid. Under φ, Lin Dan's 2007 is 56.9 against LCW's best of 43.4.

⚠️ **The half-step Olympics was built and dropped.** An Olympic gold at √φ above a world title
rather than a full rung changes *nothing* in three years out of four, and in the fourth it
moves Beijing 41 → 37. Two ladders to explain, for that.

⚠️ **Counting titles alike was dropped too**, and there is no toggle for either. A control that
offers a reading we do not believe is a question asked for nothing.

⚠️ **A Super 500 net was tried and abandoned.** `PYRAMID_BY_CATEGORY` classifies Super 500 and
`harvest-winners.mjs --tier 25` still collects them, but the answer was no on both sides:
**nothing lands on Super 500 before 2018** — four old tiers became five and that is the one
nothing maps to — so it left 2007–17 at 13–15 titles a season while taking 2023–25 from 12 to
21, and every early season was then scored against a smaller field than every late one. After
2018 it barely reordered the top seasons. It cost comparability and bought nothing.

⚠️ **No era switch, and it would be an empty control twice over.** The compare page needs one
because it holds two careers and the question is which vocabulary to read both in; a view
spanning 2007–2026 cannot pick one. Titles are named per season by `pyramidLabel`, as on the
board. And the switch changes no size anywhere by design (`SHARES_RUNG`), so with the score
being weights over `honourRung` every line would be in exactly the same place in either era.

⚠️ The first port used `levelLabel` and named every title in the modern vocabulary, so hovering
a 2013 China Open on the Score said *Super 1000* while the Board one click away said
*Superseries Premier* — two views of one board disagreeing about what a title was. The ladder
in the note is the one thing that stays modern: those are rungs, not titles.

**The drawing rules, each of which was a bug first.**

⚠️ **A point only where somebody won something, runs broken at every gap.** This data says who
won, not who entered, so a line along the bottom would assert "competed and won nothing" while
knowing only "not in the winners list".

⚠️ **The palette is handed out over the players *drawn*, not all forty-four**, and it is its
own twelve hues rather than `REIGN_COLOURS`. The bands can cycle a fixed list because two bars
of one colour lie far apart on a page; a line chart draws them through each other. Measured
twice: `REIGN_COLOURS` put AXELSEN and KIDAMBI in near-identical blue a season apart, and one
colour per career put LEE Chong Wei, SHI Yu Qi and KIDAMBI all in green.

⚠️ **The y-axis is scaled across both draws and never to the selection.** Fitted to what was on
screen it rescaled on every click, so isolating a player made their line climb the page; and
the men's and women's boards came out at two heights, so switching compared two scales.

⚠️ **Pinning dims the rest instead of removing them.** Drawing only the pinned player re-ran
the palette over a set of one, so picking somebody out *changed their colour* — and it threw
away the context that makes a share chart mean anything. The legend keeps every name too: it
used to shrink, which made isolating a player a one-way door.

⚠️ **Short seasons are two thirds of the median, not a fixed count.** The calendar has held
fifteen of these titles and it has held eight. The fixed "fewer than six" called 2022 normal —
and left the two tables under the chart disagreeing with the axis above them for a while.

⚠️ **A plain `*`, not the pyramid's `⁕` (U+2055).** That glyph has no form in Roboto or in any
of the fallbacks and renders as a small dot — which is what the board above it does, where the
note says asterisk and the page draws a dot. Worth fixing there one day.

⚠️ **A marked year must keep its axis label.** The axis thins to every other year when crowded,
and 2020 and 2022 both fell on the skipped alternate, so the mark was simply not drawn.

⚠️ **The count goes on every strip bar, not only the short ones.** It was the short seasons'
badge, which made a count look like a warning.

⚠️⚠️ **The default clutter bar asked the wrong question.** It was *"is anybody on screen in
every season"*, which any visible player satisfies by winning one thing; the women's bar came
out at 35 on a rule meant to hold the leaders and CHEN Yu Fei was not drawn at all. It now
takes each **finished** season's leader and reads that player's **career peak** — the number
the filter actually reads. MS 45, WS 20.

⚠️ Covering the top **two** of each season collapses to 10, because some season's runner-up
always peaks there. ⚠️ And the season being played is excluded, or the bar collapses every
January.

⚠️ **Controls that belong to one view are hidden in the other, never disabled.** Measured on
the prototype: a ladder picker that was only ever seen greyed out read as a broken page.

**The export** is `drawScorePoster` beside `drawPoster`, sharing `POSTER`, the 16384px density
guard and `drawPosterFoot` — the avatar, the link and the legend strip, which is *provenance*
and must not exist twice. The file is `badminton-score-…` so the two never collide in a
downloads folder.

⚠️ **The crop changes what is shown, never what is counted.** A score is a share of its own
season, and the players, colours and axis are settled over the whole board and then clipped —
the same rule the era bars follow, for the same reason.

⚠️ **The axis height is handed in by the page.** The page scales it across both draws and
`poster.js` is given one file; without the hand-in a men's poster and a women's poster of the
same seasons come back at two scales.

⚠️ **Measure a canvas string before changing the font, not after.** The legend chips took the
name's width with the 12px font already set and drew it at 13px bold, so every long name had
its peak printed through its last two letters.


### 3.4m Exporting the compare page *(built 5 Sep 2026)*

`drawGridPoster` and `drawHonoursPoster`, beside the two above, sharing `POSTER`, the 16384px
density guard and `drawPosterFoot`.

⚠️ **No range picker.** The Winners board exports a span of seasons because that is the shape
of the claim posted from it; a career is not a span, so this draws what is on screen — era,
level chips, round bar, and both players if there are two.

⚠️ **The careers arrive as `careerRows` output.** That is where the Finals reattribution, the
era translation and the junior and team exclusions all settle, and doing any of it twice is
two chances for the picture and the page to disagree about what a career contains.

⚠️⚠️ **`careers()` hands back a fresh object every call**, so the `c.rows` `renderGrid` hangs on
one of them is not there on the next one. The first version of this exported nothing at all,
from a page that was visibly full of squares. `careerGridRows` is now the single place rows
are built, and the render, both exports and the test hook all go through it.

⚠️ **The grid poster draws 20px cells**, not the 16 it started at: at 16 a one-slot block was
narrower than the three letters naming it, and Olympics, Worlds, Tour Finals, Continental and
Regional Games all lost their labels off the front of the band.

⚠️ **`RESULT_COLOURS` is the third table that exists twice** — with `--res-*` in the
stylesheet — for the same reason `TIER_RING` does. `test_season.mjs` reads the computed colour
off a drawn cell and holds it against the table.

⚠️⚠️ **BWF’s flag host does not answer CORS.** Photographs come from `img.bwfbadminton.com`,
which does; flags come from `extranet.bwf.sport`, which does not — so every flag on this
poster failed to load, drew nothing, and printed a CORS error that the suite’s console-hygiene
check caught. Dropped, with the country left in the line under the name. The Winners board’s
flags are on the photograph host and are unaffected.

### 3.4n The doubles draws, and the split square *(built 5 Sep 2026)*

All five draws are on the Winners page. The three doubles ones were absent on a real
objection — a doubles title is won by a *pair*, so one square would have to hold two faces and
would stop meaning what every other square means. **The square is split down the middle**
instead, half a photograph each, and stays exactly the size the ladder says it is.

⚠️ **Each half is the *central band* of its own photograph**, not one player's left ear and
the other's right. `object-fit: cover` in a box half as wide as it is tall matches on height
and crops the sides; `object-position: top center` keeps the crop off the chin, which is the
rule the full square already followed. `drawCoverRect` does the identical thing on canvas, so
the export matches the page.

**The competitor is the pair, everywhere above the square** — one tile, one era bar, one line
on the score, one legend chip — and `winnerOf` returns the same shape for a singles player,
who is simply the one-person case. A season's scores still add to a whole season, which is the
property that splitting a title into two half-titles would have broken.

⚠️ **The key sorts; the drawing order is settled separately.** `titleWinnerKey` sorts a
*copy* of the ids, so a partnership is one competitor however BWF ordered it — keying on the
order as sent would split a pair the first time two payloads disagreed. What order to *draw*
the pair in is a second question and it was got wrong: see 3.4o.

⚠️ Two shapes on disk: a singles `w` is a bare number, a pair is an array. `titleWinnerIds`
reads both, rather than re-harvesting twenty seasons of singles for a shape change that buys
nothing.

⚠️⚠️ **BWF's stand-in for "no photograph" is a photograph.** It serves a generic silhouette,
`profile_male.jpg` / `profile_female.jpg`, and nine winners across the five boards have one —
two of them in the *singles* files, where it had gone unnoticed. On a pair it drew the same
blank twice and read as a rendering fault. `usableAvatar` treats it as no photograph, and does
the same for the two `.tif` avatars BWF serves, which no browser renders. Cleaned in the model
and not at harvest time: the file should keep saying what BWF said, and whether a URL is worth
drawing is a decision about drawing.

⚠️ A dropped photograph leaves a **hole in place**. Every renderer iterates positionally rather
than filtering, because filtering lets the surviving photograph slide across and fill the
square — which says the pair was one person.

#### The harvest, and two bugs it had all along

⚠️⚠️ **`personOf` took `players[0]`.** Correct for the two singles draws and silently wrong for
the three that were then unreachable: the partner was simply dropped.

⚠️⚠️ **The finals-day window was `end ± 1`.** A tour event plays all five finals on its closing
day, and that assumption is what the window encoded. **The Olympics does not**: London 2012
played the men's singles and doubles on the last day, the women's the day before, and the
*mixed two days earlier still*. Paris 2024 spread them over four. The singles finals are
always last, which is why the two singles boards were complete and this was invisible until
the doubles arrived missing four of five Olympic golds — the biggest tile on each board. Now
six days, walked outward, stopping at the first that answers: no extra cost on a normal
tournament, because that is the first day asked.

⚠️⚠️ **`drawId` is not the discipline.** The fallback passed `--draw` (1–5) straight through as
`drawId`, but a drawId is a position in *that tournament's* draw list, and at a Games the
group stages come first and shift everything: at London 2012 the XD elimination draw is `15`
and `5` is the **men's doubles**. It never actually filed a wrong winner — the endpoint 500s
or comes back empty for every Games — but a fallback that can answer with the wrong discipline
is not a fallback. `drawIdFor` now reads `tournaments/draws?tournament_code=` and takes the
row whose `type_id` is 0 (elimination, not a group) and whose name is exactly the code. Same
trap as 3.4k, one endpoint over.

⚠️ Re-harvesting is per season and resumable, so the fix was applied by **deleting the short
seasons** — any season holding fewer titles than the same season in the fullest of the five
files — and re-running each discipline. Everything already on disk was left alone.


### 3.4o One pair, drawn the same way round *(fixed 5 Sep 2026)*

⚠️⚠️ **BWF does not list a partnership the same way twice.** Seven of the 174 pairs across the
three doubles boards appear in *both* orders within their own titles:

| pair | one way | the other |
|---|---|---|
| Kido / Setiawan | 11 | 1 |
| Boe / Mogensen | 15 | 1 |
| Cai / Fu | 13 | 5 |
| Lee Yong Dae / Lee Hyo Jung | 6 | 1 |
| Gao Ling / Zheng Bo | 4 | 4 |
| Pedersen / Rytter Juhl | 3 | 3 |
| Natsir / Marissa | 1 | 1 |

The split square draws the pair in the order the *title* carries, so the same partnership
swapped faces from one square to the next along a single row — and the hover swapped their
names to match. Reported by the user looking at the board, which is the only way this one was
ever going to be found: nothing was wrong about *who* won (`titleWinnerKey` has sorted a copy
of the ids since the pairs arrived), so no existing check could see it.

**`settleWinnerOrder` decides once, at the door.** Each pair takes **the order BWF used most
often for it**; the earliest title breaks a tie.

⚠️ **The obvious rule is wrong here.** "Whichever order the first title carried" — which is
what `winnerRegistry` had documented — gets two of the seven backwards: Cai and Fu's first
title is one of the five against thirteen, and Lee Hyo Jung and Lee Yong Dae's is one against
six. The majority follows BWF's own usual presentation and only three genuine ties (1–1, 3–3,
4–4) ever reach the tie-break.

⚠️ **No convention is imposed on top.** It is tempting to put the man first in the mixed, and
BWF itself does not — GAO Ling / ZHENG Bo is the majority order for that pair while Lee Yong
Dae leads his. The page says what the federation says, consistently, and does not invent a
rule the source does not hold to.

⚠️ Applied in `loadWinners` and **nowhere else**. Not at harvest time: the file on disk keeps
saying what BWF said, the same rule `usableAvatar` follows. Not in each renderer: there are
four that draw a pair (board, era band, score chart, the posters) and a rule that has to be
remembered four times is a rule that will be wrong in one of them. One decision, one place,
and everything downstream is looking at a file where the question does not arise.

⚠️ The tie-break sorts by `date` then by the season key, so a title with no date at all still
lands somewhere fixed. And the majority is taken with a *strictly greater* comparison, with
ties falling through to the earliest title — taking the last equal one would make the answer
depend on Map iteration order, which is insertion order, which is the file.

### 3.4p Picking one competitor out *(built 5 Sep 2026)*

A doubles board is two photographs per square and several hundred squares, and following one
partnership across it by eye is genuinely hard — the user's words were "it is all a bit more
messy". **Click a square and the rest recede.**

**One set and one gesture, wherever a competitor is drawn**: `win.only` was already the score
chart's pin set and the hash's `wp`, so the board's squares, the era band's bars, the chart's
markers and the legend's chips all now call `toggleWinPick` with the same key. They are the
same person keyed the same way; four gestures for one idea would be four things to learn.

⚠️ **The photograph fades and the square does not.** Dimming the whole tile was the obvious
implementation and it deletes the board: `.pyrtile` carries the faint white ground that draws
the pyramid's silhouette, so at 16% the *shape of the season* — which is what the view is for
— went with it. Fading only what is inside leaves twenty grey pyramids standing with the
picked faces lit inside them, which is a far more useful picture. Same reasoning one level
down in the era band: the run's block of colour stays and its face, name and flag recede.

⚠️ The tier marks fade with the face. The Olympic ring and the dashed footnote mark are
siblings-or-shadows of the square, not children, so the first cut left a full-strength gold
ring on a square whose face had gone — which reads as the *mark* being what was selected.

**Additive, and `Esc` is the way back.** Clicking a lit square drops it, so two clicks compare
two rivals; but on a board of several hundred squares "which ones did I click?" is a question
the reader should not have to answer, so Escape clears the lot. It is folded into the existing
Escape branch, which already closes the panels and blurs the search box.

⚠️ **The board is repainted in place, not re-rendered.** A full `renderWinners` throws away
several hundred `<img>` elements and builds new ones, and a fresh `<img>` decodes
asynchronously even when the bytes are in cache — so every click flashed an empty board for a
frame, on a gesture whose entire purpose is to make the picture easier to read.
`repaintWinPick` toggles the classes instead. The render still applies them itself from
`pickedOff`, and must: a board arriving with `wp=` in the link has never been through the
click path. Two paths, one predicate.

⚠️ **The board poster had to learn it too.** `drawScorePoster` has taken `opts.only` since
the score view was built; `drawPoster` had not, so a reader who picked a pair and hit Export
got a picture that disagreed with the screen. Now `posterOpts` passes `only` on both branches
and `posterLayout` hands the drawing a `lit(id)`. Two canvas-specific traps in doing it: the
tier rings and summit badges are drawn *outside* the square and had to be faded explicitly or
a receded photograph kept a full-strength gold ring; and inside an era bar the per-season
shading sets `globalAlpha` and resets it to 1, so the fade there is a **multiplier** rather
than a value it would otherwise wipe out. The foot names who is lit — an export leaves the
page behind, and an unexplained dark board reads as a rendering fault.

⚠️ `setWinView` still clears the pick when the view changes, and that is deliberate rather
than left over. The score chart's `lit()` is `!win.only.size || win.only.has(id)`, so a pick
carried onto a chart that cannot show it — a competitor below the **Show** bar — would dim
*every* line at once. The floor slider clears for the same reason.

### 3.4q Dominators: the score, ranked *(built 5 Sep 2026)*

The chart says who dominated *and when*; `dominationRanking` says who dominated, full stop.
**Two orderings, both always drawn, only the sort moves.**

**Total** is every season's share added up — it rewards staying there. **Peak** is the best
single season — it rewards the year nobody else got a look in. They genuinely disagree, and
that is why both columns are on every row and the sorted one is *marked* rather than being the
only one shown: KIM / SEO are first on peak and eighth on total; LEE Chong Wei is second on
total with the sixth-best peak on the men's board.

⚠️⚠️ **There is no mean, and it is not an omission.** It is the obvious third column and it
would be a lie. The data says who *won*, not who *entered*, so a competitor has a point only
in the seasons they won something — the seasons they played and won nothing are missing from
the divisor rather than sitting in it as zeroes. One good year would out-rank a fifteen-year
career and the number would be describing the hole in the data. Same fact as the broken lines
on the chart, which is worth saying out loud because the obvious fix (add a mean column) will
look reasonable to whoever reads this next.

⚠️⚠️ **The Show bar must not govern this table, and it took a measurement to see why.** The bar
filters on *peak*. A total ranking cut by a peak filter is a different claim: at the men's
singles default the chart holds twelve of the forty-five careers the table does, and
Jan O JORGENSEN — four seasons and twelfth on total — is dropped for a best season of 7.4.
The bar declutters the chart; the ranking is the whole board. Top twenty by default, one
click for all of them.

⚠️ Ranks are **shared on a tie** and the next rank skips, as ranks do. The *order* within a tie
is settled by the other number and then by name, so it does not depend on the order the seasons
happened to be read in.

#### Which forced two guards that should have been there anyway

⚠️⚠️ **A pick the chart cannot draw used to fade every line at once.** `lit` was
`!win.only.size || win.only.has(id)`, so a pick naming somebody the bar had hidden made it
false for everybody — a chart faded to nothing with the cause off screen and nothing to click.
It was already reachable from a link before this table existed. Both `drawScore` and
`renderScoreLegend` now intersect the pick with what they are actually drawing. Exactly the
same shape as the board's blind spot in 3.4p; two views, one bug, found from opposite ends.

⚠️ **Clicking a row below the bar lowers the bar to fit.** The table lists everybody and the
chart does not, so a reader who clicks a name in a ranking and gets nothing has been told a
half-truth. `pickFromRanking` drops the floor to that competitor's peak (rounded down to a
step) and ends `autoFloor` — and it must not go through the slider's own handlers, which clear
the pick when the bar moves, deliberately, so that dragging does not leave a stale selection.

⚠️ `.rkwho`, not `.who`. `.who` is the player card's 23px name heading and it made every row of
this table a headline. Found by looking at the page, which is the only way a CSS name collision
ever is — the third time this repo has hit one, after `.pyrbadge` / `.badge`.

⚠️ `display: flex` on a `<td>` takes the cell out of table layout: the column stopped lining up
with its own header and the blank-photograph placeholder was squeezed to a hairline. The flex
box is a `<span>` inside the cell.

⚠️ `.chiprow > .lbl` is a fixed 58px with `flex: none` — right for the one-word labels every
other chip row has ("Levels", "Day", "Draws"), wrong for a sentence. Left at 58 it overflowed
and printed straight over the link beside it, and `white-space: nowrap` alone only made the
overlap longer.

### 3.4s The pandemic seasons, and the year still running *(built 5 Sep 2026)*

**Which seasons and why.** What is *done* with them is 3.4u — three readings, `full` by
default — and this section is only the argument for the set.

⚠⚠ **`COVID_SEASONS` is 2020, 2021 and 2022, and the test is participation — not the
calendar.** A domination score is a share, so what flatters a winner is a thinner field, not a
shorter tour. Distinct players in the opening rounds of every board event, share Chinese:

| 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 |
|---|---|---|---|---|---|---|---|
| 12.3% | 14.7% | split | **2.3%** | **9.9%** | 13.3% | 14.1% | 12.6% |

**2021 held ten titles — the same as 2018 and 2019 — and eight of its eleven events had
literally no Chinese player**: both Thailand Opens, the All England, the French, both Indonesia
events, both World Tour Finals. Only the Olympics, Denmark and the Worlds had any. No count of
titles can see that, which is the whole argument for a written-down set.

**2020 is split by the shutdown**: the All England on 11 March was a normal 16.1% field, played
days before everything stopped; the October Denmark Open and the January-2021 Finals had none.

**2022 is the weakest case and is in on a judgement** — present everywhere, reduced to about
three quarters of normal, on a calendar cut to eight events from twelve with the Finals moved
out of Guangzhou. The chip exists to be disagreed with.

⚠⚠ **The first version of this argued from hosting** — no Chinese *event* in 2020–22, both
back in 2023 — and that is true and is the wrong test. Hosting is not competing: 2022 hosted
nothing and had Chinese players at all eight tournaments, while 2021's Thailand Opens were
played in Bangkok with none at all. Reported by the user, who asked the question the data could
actually answer.

⚠️ The field counts come from `day-matches`, the same endpoint the winners harvest uses —
three opening days per tournament, distinct player ids by `countryCode`. Measured with a
throwaway probe rather than harvested: it is evidence for a decision, not something the page
reads.

#### The season being played

⚠⚠ **Weighed against the whole year, not against the part of it played.** A share of what has
happened so far makes January's first winner a 100, and in September 2026 it inflated every
score on the board by half again (eight of twelve played, 13.71 of 19.33 by weight). Against
the planned year the numerator grows and the denominator stands still, so a part-played season
is a **lower bound**: it cannot overstate a total, and a peak, being a maximum, cannot be
lowered by it. That property is the whole reason the running year is allowed to count — an
earlier cut left it out entirely, which was the right call *without* a real denominator and
the wrong one with it.

⚠️ **Finished seasons keep what was actually played.** 2020 is a share of three, not of the
nine still on the calendar when it was abandoned; 2021 was planned at fifteen and played ten.
Weighing a cancelled season against its plan would rank everybody as having failed to win
events that never took place. `dominationSeasons` marks a season `forecast` only when it is
both `ongoing` and has a calendar, and that flag — not a `now` argument — is what
`dominationRanking` reads. One place decides what a denominator is.

⚠️ `Math.max(played, plannedMass)`, so a calendar gone stale (an event added since the last
harvest) cannot put a score above 100.

⚠️ **`pt.played` is the planned count, not the played one.** The hover would otherwise read
"2 of 8" beside "3.24 of 19.33 by weight" — two denominators in one sentence. The strip under
the axis says **8/12** for the same reason: it is the one place a reader could not otherwise
see why the line sits low.

⚠️ **The Show bar keeps leaving the running season out of its derivation.** That survives the
better denominator, because the bar is set from *who led each season* and nobody has led a
season still being played, however fairly it is weighed.

⚠️ `tools/harvest-calendar.mjs` writes `planned` into all five files — one call per season,
seconds. **Not a live call**: the score view reads one static file and must keep doing so, or
its numbers would depend on whether a request succeeded. Tiers are stored, not weights: what a
title is worth is `titleWeight`'s decision, and a file holding the arithmetic would freeze the
ladder at the moment it was written.

### 3.4u The third reading: a pandemic season out of a whole year *(built 5 Sep 2026)*

Set aside or counted was a switch, and the user asked the question a switch cannot answer:
*what if 2020–22 were divided by a full schedule instead?* `COVID_MODES` is now three —
`aside`, **`full` (the default)**, `played` — and the chip became a row.

⚠️ **`full` is the default, chosen by the user after all three were built and measured.** The
argument for it: it is the reading that changes the arithmetic **without discarding a result**.
Setting a season aside is a claim about the *competition* — that the field was too thin to
count — and it is a claim this data cannot check season by season. Weighing a short season
against a full one is a claim about the *calendar*, which the file can check and does. The
stronger claim is one click away and the rows it under-counts say so with an asterisk.

⚠️ **What "a full season" is, and where it comes from.** The median mass and title count of
the **finished, non-pandemic seasons of the same era**, era being `SS_LAST_SEASON` — a
Superseries season carried 13–15 of these titles and a World Tour season 10–12, so one figure
for the whole file would weigh 2020 against a calendar that had not existed for three years.
For 2020–22 the pool is 2018, 2019, 2023, 2024, 2025 and the answer is **19.33 by weight,
twelve titles**. Nothing is typed in; `normalSeason` reads it off the file, so it moves if the
board does.

⚠️ **`Math.max`, never downward.** 2021 held 23.80 against a normal 19.33 — an Olympics, a
Worlds and *two* World Tour Finals, the 2020 one having been pushed to January. Substituting
the normal figure there would *raise* every 2021 score, which is the opposite of the point. So
`full` marks 2020 and 2022 and leaves 2021 alone.

⚠⚠ **It is a calendar correction and it cannot see a field, and 2021 is the proof.** The two
things wrong with these seasons are *how many events ran* and *who was in the draw at the ones
that did*; this fixes the first. 2021 — the season with 2.3% Chinese participation, eight of
eleven events with literally nobody — is the one it cannot touch. Measured: AXELSEN's peak
moves off 2022 (85.8) and onto **2021 (67.0)**, a season this option has nothing to say about.
Not a fault to patch. It is why three readings are offered rather than a better single one, and
it is written into `COVID_MODES`' comment so the next person does not "fix" it.

**What it does, measured across all five boards:**

| | set aside | full season | as played |
|---|---|---|---|
| MS total | LCW 285, LIN 276, CHEN 207, … AXELSEN **131** (5th) | LCW 285, LIN 276, **AXELSEN 269** (3rd) | **AXELSEN 315** (1st) |
| MS peak | MOMOTA 78.3 (2019) | MOMOTA 78.3, AXELSEN 67.0 (2021) | AXELSEN 85.8 (2022), ANTONSEN 69.1 (2020) |
| WS peak | AN 64.5 (2025) | AN 64.5; TAI drops to 31.3 (2018) | **TAI 80.9 (2020)** — a three-title season |
| XD total | ZHANG/ZHAO 255, ZHENG/HUANG 252 | **ZHENG/HUANG 311** | ZHENG/HUANG 333 |

That XD row is the argument against `aside` being the only alternative: ZHENG / HUANG are
Chinese, and setting the seasons aside costs *them* 59 points.

⚠️ **`full` moves the chart, and `aside` does not.** `full` changes what a score is a share of,
so the lines, hovers, strip and poster all follow — a table quoting numbers the plot above it
never drew would be worse than either. `aside` is not a denominator: the chart draws what
happened and the ranking omits it. Two of three modes therefore produce an identical chart, and
that asymmetry is deliberate and is said out loud in `#rankWhat`.

⚠️ **The Show bar moves with the default**, being derived: the men's singles opens at 15
rather than 40, because 2020's best season is a 17 once weighed against a whole year rather
than a 69, and the bar's rule is not to drop a season's leader. Twelve lines instead of seven.
Measured across all five boards before the default changed: WS 20 → 20, WD 30 → 20 (same twelve
lines), XD 20 → 20, MD 30 → 20. Only the men's singles moves much, and twelve lines is well
inside what the women's singles already draws at nineteen.

⚠️ **A link with no `wc` means "the current default"**, the same contract `wf` has — absence is
"the derived default", not a frozen value. So links written between 5 September's two commits
carried no `wc`, meant *set aside*, and now open on *full season*. Accepted deliberately: `wc`
records the argument, and a reader opening somebody's link should get the page's current reading
of the seasons rather than one pinned to whatever the sender's build thought.

⚠️ **The model suite's `domMS` and `domWS` are pinned to `{ covid: 'played' }`, said out loud.**
Everything from the ladder to the Show bar's rule to how a ranking is built reads clearest on
the seasons exactly as they happened, and the pandemic reading is a claim laid on top of that
with its own block and its own models. Left implicit, changing the default silently rewrote
fourteen of those checks into questions nobody had asked — including "every finished season adds
to one", which is *false by design* under `full` and had to be generalised to "adds to one, or
to less of one where the season is weighed against more than it held". The remainder is the
feature: it is the part of the year nobody owns.

⚠️ `scoreTop` moves with the mode. Its comment forbids the axis moving *under the reader*, and
that is about selection: `full` is a different measurement, and holding the axis at 90 for a
board whose tallest season is now 78 leaves a tenth of the plot empty.

⚠️ **The calendar was the obvious source for "a full schedule" and it does not work.** BWF's
`vue-grouped-year-tournaments` keeps cancelled events, so the 2020 calendar with them left in
looks like the answer. Measured, it is **nine board events worth 10.85** — against 2019's
16.71 — because the record was rewritten after the fact: the Olympics were moved to 2021 rather
than cancelled, the Aarhus Worlds is not listed at all, and the Finals sit in the 2021
calendar. Reconstructing "what 2020 was meant to be" from that means trusting a document edited
by the thing being measured. The median of the seasons around it is the honest figure.

⚠️ **`wc=1` still parses.** It was the two-state link and it meant *count them*, which is now
`played`; `covidMode` translates it, so old links say what they were written to say.

⚠️ Two poster bugs fell out of this and are fixed here. The score poster marked and shaded on
`thin` alone, so **2021 got no faint column and no asterisk** while the page beside it drew
both — the same union bug fixed on the page's axis one commit earlier, in the other renderer.
And its strip printed `s.total` flat, so an exported 2026 column said "8" beside a line drawn
as a share of twelve. Both now read the page's rule: the union for the column and the year
mark, `thin` for the strip's colour, `played/planned` for its label.

### 3.4t A chosen chip is red — everywhere *(fixed 5 Sep 2026)*

The rule already existed and was written as a **list of five ids**: `#tmtDrawPick`,
`#tmtRounds`, `#years`, `#levels`, `#gridGroups`. Every new chip bar had to remember to join
it, and the ranking's sort did not — it was grey because nobody had added it, not because
anybody had decided. A rule whose own comment argues that "the same affordance has to look the
same everywhere" should not be a list to keep up to date. Now `.chip.on`, agreeing with
`.seg.on`, which has always been the accent.

⚠️ **Two deliberate exceptions survive it, and one of them nearly did not.** `.team` stays a
dashed outline — filling it would hide the dashed border inside its own colour. And
`#tmtDraws`, the day's draw *filter*, stays neutral because it sits directly above the red
`#tmtDrawPick`: a bar of red above a bar of red reads as one control. Generalising the rule
turned that one red, and the only thing that caught it was the check pinning it — written when
the asymmetry was decided, precisely so it would have to be changed on purpose. Worth
remembering the next time a rule here looks like an oversight: this one was not.

### 3.4r Every season named on the axis *(fixed 5 Sep 2026)*

The score chart labelled every *other* year above fourteen seasons, on both the page and the
poster. That was a guess rather than a measurement: the plot is 1118 units wide, which is 59 to
a season over twenty, against a four-digit label of about 27 — they were never going to
collide, and the poster's columns are never narrower than `colMin`, 46px. What the thinning did
instead was make the reader count gaps to place a point, and it had already needed a
special case to stop 2020 and 2022 losing their footnote marks by falling on the skipped
alternate. Every year now, and the suite measures the drawn label boxes to prove they do not
overlap rather than trusting the arithmetic above.


### 3.4j The summit at one size *(built 4 Sep 2026)*

`pyramidScale` is `honourScale` except that `OLY` is drawn at the Worlds size. They share a
row, and on a row of *faces* two sizes read as a layout accident rather than as a ranking —
the gold ring carries the difference instead. It is a pyramid-only override: `honourScale`
still ranks an Olympic gold a rung above a world title, because the honours board is making a
claim about worth and this page is a row of portraits.

⚠️ Which forced the footnote mark off gold. A displaced title is a **dashed outline**, offset
clear of the ring — a footnote and a rank must not share a colour.

⚠️⚠️ **The tier rings were `inset` and therefore invisible.** Every tier had one and none of
them ever showed: an inset box-shadow paints *behind* the element's content, and the content
is a photograph filling the tile. They appeared for the instant before the images arrived and
then vanished, which is how it went unnoticed for as long as the page has existed — and how
it survived a check that held the stylesheet's declared colour against the export's table.
Declarations matched; pixels never did.

The gold Olympic ring is the only one left, drawn *outside* the square, and the suite asserts
`!/inset/` on the computed shadow as well as the colour. The ring is a `box-shadow` rather
than an `outline` because an element has only one outline and the footnote mark needs it —
Tokyo 2020 is Olympic *and* displaced and has to wear both.

⚠️ **The world championship square wore a white ring for exactly one commit.** Ringing both
summit squares made them a matched pair in two liveries rather than a ranking — and white is
the brighter colour on a dark ground, so the square meant to be the plain case read as the
*bigger* prize. `TIER_RING` now holds one entry and `test_season.mjs` asserts the world
championship tile's computed `box-shadow` is literally `none`.

### 3.4e The era switch, and why backwards is a different map *(built 30 Aug 2026)*

The compare page can name its ladder in either vocabulary. `era` is `'wt'` or `'ss'`, it is a
property of the **view** and never of a result, and it changes exactly two things: which
names the rows carry, and which squares are marked as translated.

**Why it was needed.** The forward map (3.4 / Part 7) is right and is the wrong default for
the comparison the tool exists for. Measured off the fixtures:

| | Superseries-era results | World Tour results |
|---|---|---|
| LEE Chong Wei | 116 | 5 |
| LIN Dan | 86 | 41 |

In World Tour names, 116 of Lee Chong Wei's 140 grid cells are notched translations. In
Superseries names, 4 are.

⚠️⚠️ **The reverse map is not the forward map inverted.** Same evidence, same method —
`tournament_series_id` followed across the 2018 boundary — asked the other way:

| modern tier | was | spanning series |
|---|---|---|
| Super 1000 | Superseries Premier ×4 | 4, unanimous |
| Super 750 | Superseries ×4, Premier ×1, GP Gold ×1 | 6 |
| **Super 500** | **GP Gold ×4, Superseries ×3** | **7, split** |
| Super 300 | GP Gold ×8, Grand Prix ×1 | 9 |
| Super 100 | none | — |

The Super 500 does not lack evidence, it has contradictory evidence, and the contradiction is
the finding: **2018 was a split, not a renaming.** One Grand Prix Gold became both a Super
500 and a Super 300, which is also why the forward map has four old tiers and five new ones.

**Decision (30 Aug 2026):** the Super 500 folds **upward into the Superseries**. Chosen by
the owner over relabel-only, with the cost stated: ten of Lin Dan's results move up a rung
against one of Lee Chong Wei's, so the switch does move the comparison and not only its
vocabulary. It is disclosed rather than hidden — those squares carry the ordinary notch and
hovering one says "Super 500, drawn as Superseries", and `mapNoteSS` says it in full under
the board.

⚠️ **The era groups share the rung of the modern tier they are drawn over** (`SHARES_RUNG`),
they are not given a ladder of their own. If they were, the Superseries ladder would be one
rung shorter and *every square on the board would resize when you switched* — the two
readings would stop being two readings of one board. The visible consequence is that the
Super 500's rung stands empty in `ss`, so there is one double size step, between Superseries
and Grand Prix Gold. That is drawn rather than closed up, because the gap is real.

⚠️ **The era ladder is derived, never written out.** `ERA_GRID_ORDER` is `GRID_ORDER` mapped
through `eraGroup` into a `Set`, so a tier added to the order cannot go missing from the era
ladder, and the `Set` is what collapses Super 750 and Super 500 into one row.

⚠️ **The era group ids are BWF's own pre-2018 category ids** (8, 2, 3, 4), so `LEVEL` already
holds their names and abbreviations. There is no second table of labels to drift out of step.
Only the Tour Finals needs an override (`ERA_LABEL` / `ERA_CODE`), because it is the same rung
and the same event under a different name.

⚠️ **The notch is defined by the era, not by the category.** `translatedFrom(cat, era)` marks
the pre-2018 categories in `wt` and the modern ones in `ss` — never "the category differs from
the row it is drawn in", which was the first version and would put a notch on half the majors:
the 2017 World Championships is category 1 and the 2012 Asian Championships category 3, and
that rule calls an Asian Championships a Grand Prix Gold. A test pins the invariant: no square
is a translation in both readings.

⚠️ **Switching era clears `grid.hiddenGroups`.** The level chips are keyed on the group and
the two eras do not share their keys — a hidden Super 750 is `24` and a hidden Superseries is
`2`. Left alone, switching silently un-hides everything and re-hides it on the way back, which
reads as the chips forgetting themselves.

The era travels in the hash as `er=ss` and is read unconditionally, like `v` and `th`: a link
without it is claiming World Tour rather than saying nothing.

### 3.4f How far back BWF actually goes *(measured 30 Aug 2026)*

`YEAR_FLOOR` was 2006 on the belief that "real data reaches back to about 2007". That belief
had never been tested against a career that *started* earlier, and the two this project most
wants to compare both did. `tools/probe-early.mjs` asks BWF directly, one request per
player-year:

| | tournaments | results carrying a position | titles |
|---|---|---|---|
| 2000–2004 | LCW 40, LD 35 | **essentially none** — only the Athens rows | 0, 0 |
| 2005 | 9 each | about half | LCW 1, LD 1 |
| 2006 | LCW 12, LD 10 | **all of them** | LCW 2, LD 6 |

So 2000–2004 is a hole in BWF's records, not in ours: the tournaments are listed and every
`position` is blank, LIN Dan's 2004 All England included. **The floor is now 2005** — the loop
is `year > YEAR_FLOOR`, so 2006 is fetched and 2005 is not. Going lower buys rows that can
only say "Played".

It costs a modern career nothing: `EMPTY_RUN` stops those walks two empty seasons after the
last real one, years above the floor. No test fixture reaches 2006 either, for the same reason.

⚠⚠ **An absent position is the string `"-"`, not an empty one** — and `"N/A"` also occurs.
`tools/probe-early.mjs`, the tool that set this floor, counted both as placed until 4 September
2026. It therefore reported LIN Dan's 2004 as **11/11 placed with no titles in it**: a complete
season in which the reigning All England champion won nothing, which is not a thing that can be
true. Re-measured with the counter fixed, draws carrying a real placing:

| | 2001 | 2002 | 2003 | 2004 | 2005 | 2006 | 2007 |
|---|---|---|---|---|---|---|---|
| LEE Chong Wei | 0/11 | 0/6 | 0/11 | 1/12 | 3/9 | **12/12** | 15/16 |
| LIN Dan | 0/7 | 0/7 | 1/10 | 1/11 | 3/9 | **10/10** | 13/14 |

**2006 is the first season BWF places its results**, and the cliff is sheer. The tournaments
themselves go back to 2001 and further; it is the placings that do not. 2007 onwards never
reaches 100% either and should not — a team event carries no individual position.

`positionInfo` in the model was never fooled by this: it reads `"-"` and `"N/A"` as
`{ label: '-', tier: 'na', full: 'Played' }`. Only the probe was, and it was fooled in the
direction of saying the floor could safely be lowered.

⚠️⚠️ **Before 2007, `tournament_category_id` carries no tier information whatsoever.** In 2006
the **World Championships**, the **All England** and an International Series are all category
**6**, and the Asian Games has no category. Lowering the floor alone therefore *gained almost
nothing* — 7 of LIN Dan's 10 2006 tournaments were dropped as "below Super 100" — which is why
`gridGroup` now reads nothing off an id before `IDS_MEAN_SOMETHING` (2007) and sends whatever
the name rescues have not placed to Unmapped.

Re-measured live on **4 September 2026** across six careers of that era — LIN Dan, LEE Chong
Wei, Taufik HIDAYAT, Peter GADE, ZHANG Ning, XIE Xingfang, seasons 2000-2006:

| id | events | what is in it |
|---|---|---|
| **6** | **77** | Danish Open, China Open, All England, World Championships, a $30k Macau Open, a $3,000 Norwegian International |
| 1 | 5 | the 2004 Olympics — *and* the 2006 Japan and Hong Kong Opens |
| null | 2 | Doha 2006 Asian Games, Thailand Open 2006 |
| 16 | 1 | European Senior Championships 2006 |

85 distinct tournaments, **77 of them one id**, spanning a world title and a three-thousand
dollar satellite. Category 6 is not a tier, it is the absence of one.

### 3.4k Why prize money cannot rescue the pre-2007 seasons *(closed 4 Sep 2026)*

The obvious next move is to derive the tier from the purse, and it does not work. **Do not
try it.**

Until 2007 the circuit was the **IBF World Grand Prix**, whose events were graded **6-star
down to 1-star — and the grade was the prize money**. The 2006 bands, from the season's own
calendar:

| Stars | Purse | 2006 events |
|---|---|---|
| 6 | $250-300k | Korea, China Masters, Indonesia, Hong Kong, China Open |
| 5 | $170-180k | Japan, Singapore, Chinese Taipei, Denmark |
| 4 | $120-125k | Swiss, **All England**, Philippines, Malaysia |
| 3 | $80k | German, Thailand |
| 2 | $50k | New Zealand, Bitburger, Dutch |
| 1 | $30k | U.S. Open, Vietnam, Bulgarian, **Macau** |

⚠⚠ **The money ladder and the prestige ladder are different ladders.** The All England — the
oldest title in the sport — was a **4-star on $125,000**, two rungs below the China Masters.
Deriving a tier from the purse would draw it as a mid-table event on every page of this app,
authoritatively. The mechanism exists (`prize_money` is in the payload for 61% of those 85
tournaments) and the mapping does not, so the answer is Unmapped and the Winners board's 2007
floor — both of which say "no ladder here" rather than inventing one.

⚠️ A second reason, if the first were not enough: **the bands inflate**. The China Open paid
$225k in 2001, $170k in 2002 and $250k by 2005; Hong Kong was a $30k event in 2001 and a $250k
one in 2005. A fixed table of bands would misplace every season it was not built from.

⚠️ One data point worth keeping: **BWF's own record beats Wikipedia here.** Wikipedia's 2006
World Grand Prix table lists the Macau Open at 4-stars / $120,000; BWF's payload for the same
tournament, same dates, says **$30,000**, which is the 1-star band — and badmintonranks.com
independently rates it 1-star. Two against one, and the odd one out is the encyclopedia.

⚠️ **And the sub-World-Tour ids are not believed until 2008** (`BELOW_BELIEVED`). 2007 is the
first Superseries season and ids 2/8/3/4 all mean what they say, so they are still read — but
BWF was still filing Grand Prix events as category 6 that year, and believing it dropped
exactly one title from each career: LIN Dan's German Open, LEE Chong Wei's Philippines Open.
Two constants rather than one, because the evidence genuinely says two different things about
two different years.

⚠️ **A tournament with no `start` is treated as modern.** The rescue is for seasons known to be
old; a missing date is not evidence of age, and the alternative would quietly wave every
malformed row into the grid.

### 3.4g The regional games, which no id can find *(built 30 Aug 2026)*

The Asian, Commonwealth, European, Pan American and African Games have a section, `'GAMES'`,
sharing the Continental rung. They are individual titles — LIN Dan has two Asian Games golds
and LEE Chong Wei none, which is a real difference between the two careers and was previously
buried in "Unmapped".

⚠️⚠️ **Matched by name, before the id.** One tournament, the Asian Games, has arrived as:

| edition | category |
|---|---|
| 2006 | *none at all* |
| 2010, 2014 | 1 |
| 2018 | 16 |
| 2022 (played 2023) | 74 |

and the European Games as **28** (2019) and **11** (2023) — the Continental Championships' own
id. There is no rule over those ids. An id-first order draws the 2023 European Games as a
Continental and the 2019 one as Unmapped.

⚠️ **The team check has to run first, and does.** BWF ships the two editions as separate
tournaments under near-identical names, *both category 16* in 2018, and only the draws tell
them apart — a tie names its draws bare ("Singles"), so `isTeamTournament` catches it. Match
the name before that and every team event lands on the board.

⚠️ **"Olympic Games" contains "Games".** The continents are named one at a time rather than
matching the word; matching it would cost the Olympics their own row.

⚠️ **Sub-regional games are excluded and must be tested first**, because "East Asian Games"
contains "Asian Games". They stay in Unmapped, except the ones BWF also sends with no category
at all — those have nothing to place them by and are not drawn.

**Not an inconsistency with the Winners pyramid**, which still excludes all of them (3.4d). The
pyramid ranks a season across the whole sport, where counting a regional games picks a region;
a career says what one player won.

⚠️ `'GAMES'` is deliberately **not** added to `LEVEL`. `LEVEL` is the strip's table, keyed on
the `cat` a tournament actually arrives with, and a test pins that every key in it has a chip
position in `LEVEL_ORDER`. Nothing ever arrives as `'GAMES'`. Its label lives in
`SECTION_LABEL` beside `'OTHER'`, which is the same kind of thing. (`'OLY'` *is* in `LEVEL`,
because `parseSeason` really does set it as a `cat`.)

### 3.4h Draw names BWF used once *(fixed 30 Aug 2026)*

⚠️ **An unrecognised draw name is read as a team tie**, which removes the result from every
singles view without erroring — the failure mode is a silently shorter career.

`canonicalDraw` required the plural: `/SINGLES/`. BWF has shipped **"Men's Single"**, singular,
exactly once — LIN Dan's 2007 German Open, a title. The final `s` is now optional.

It also required a gender word or a `[BGMW]` prefix, so the junior mixed draws **"XD U19"** and
**"XD-U19"** — five rows — fell through the whole function. `^XD\b` now catches them.

A sweep of every distinct draw name in the fixtures is the way to find these; there are 28 of
them, and after this the only ones that come back null are the bare "Singles"/"Doubles" of a
team tie, which is correct.

### 3.4i The search box: alphabetical, and on the wrong lane *(fixed 3 Sep 2026)*

Reported as "sometimes no suggestions show up, and it is slow". Three separate faults, none
of them the size of the pool:

⚠️⚠️ **`vue-popular-players` orders by given name and returns page one.** It is a
dictionary, not a ranking. Measured with `tools/probe-search.mjs`:

| query | result |
|---|---|
| `viktor` | Viktor AXELSEN at index **13** of 30 |
| `axelsen` | Rikke AXELSEN first |
| `chen`, `an` | CHEN Yu Fei and AN Se Young **absent entirely** |

Re-sorting the reply cannot fix this. The fix is a local roster matched *first*.

⚠️⚠️ **Search was on the `low` lane.** One uncached search issued while a career was loading
took **10 516 ms**, queued behind that career's draw ladders at 320 ms each. Anything a
reader is waiting on belongs in the fast lane however cheap it looks. Now 758 ms.

⚠️ **Nothing was drawn while waiting.** `store.suggestions` stayed null until BWF answered,
and `draw()` hides the list when it is null — so for 0.4–10 s a working search was
indistinguishable from a dead box. There is a `searching` flag now, and a "Searching…" row.

⚠️⚠️ **`pageKey` is the page size**, and `loadTopRanked` was sending a hardcoded 10 under a
comment claiming paging was "hard-locked at 15". It answers 10/15/20/30/50/100, each from
rank 1, and `page` still walks on top of it. **The top 50 of a discipline is one 33KB
request**, so the whole roster is five, not the fifty it would have been.

⚠️ **The roster is fetched on first *focus*, not at boot.** Five requests nobody who never
searches should pay for, and at boot they would compete with the first career load. Cached
12h, so it is once or twice a day.

⚠️ **It augments, never replaces.** The roster is the current top 50 of five tables. LIN Dan
and LEE Chong Wei are in none of them — nor, in September 2026, is Viktor AXELSEN, who has
been out injured and has dropped out of the top 50 of his own discipline. `mergeSuggestions`
keeps BWF's whole answer under the local one.

⚠️ **Matching is word-by-word and order-blind**, because BWF stores names given-name-first
(`Se Young AN`) and displays them surname-first (`AN Se Young`). The consequence is that
`chong wei` matches **MAN Wei Chong**, a real Malaysian doubles player — which is correct,
and cost a test that assumed otherwise.

⚠️ **`const` does not hoist.** `roster`, `openBoxes` and the recents constants live with the
rest of the module state near the top of `app.js`, not beside the search code that uses them:
`wireSearch` is *called* for the compare box several hundred lines above where it is defined,
and declaring them next to it threw `Cannot access 'openBoxes' before initialization` and
took the whole page down before `window.BST` existed.

### 3.4j Two tournaments at once *(fixed 3 Sep 2026)*

`pickTournament` took the **first** of `nextLive` / `nextTmt` / `previousTmt` whose dates
contained today. That order is BWF's, and it is not a ranking: on 3 September 2026 `nextLive`
was the Pontianak Indonesia Masters, a **Super 100**, and `nextTmt` was the LI-NING China
Masters, a **Super 750**, both running 1–6 September. The page opened on the smaller one.

⚠️⚠️ **`vue-tmt-schedule` carries no category and no prize money.** The whole row is id, code,
name, slug, dates, two logo URLs and a label. So the tier comes from:

1. **The name**, for the majors — and this is not an optimisation. A major's `catLogo` is
   **null**, so without it the World Championships ranks below a Super 100.
2. **`catLogo`**, whose filename is the tier: `.../tournament/suffix_750-01.svg`. An
   undocumented URL convention rather than a field, which is why it is second and why
   anything unrecognised falls through instead of being guessed at.

Ranked through `GRID_ORDER`, the project's one ladder, so a tier added there is ranked here
without anybody remembering to. **Ties keep BWF's own order**, which makes this a no-op in
the ordinary week.

⚠️ **Choosing the bigger one makes the other unreachable**, which is a worse page than the
one it replaced. `pickTournament` returns `also` — the live ones it did not pick — and takes
a `wantCode` to pin one; the page draws them as buttons and the choice travels as `t=` in the
hash. A pin naming something not on today is ignored rather than blanking the page.

### 3.4k The brackets, and the drawId that is not the discipline *(built 4 Sep 2026)*

Ported from the predecessor, which had worked out the geometry. Two calls:

```
GET /api/vue-tournament-draws?tmtId=5625&tmtType=1
GET /api/vue-tournament-draw-data?tmtId=5625&tmtType=1&drawId=1&isPara=0
```

⚠️⚠️ **`drawId` is not the discipline, and the predecessor's `{ms:1, ws:2, md:3, wd:4,
xd:5}` is wrong here.** It was right for every tournament that repo ever saw — but it only
ever saw one, a World Championships with no qualifying. Qualification draws are numbered
into the *same* sequence. Measured 4 Sep 2026 with `tools/probe-draw.mjs`:

| tournament | MS | WS | MD | WD | XD |
|---|---|---|---|---|---|
| LI-NING China Masters (no qualifying) | 1 | 2 | 3 | 4 | 5 |
| Pontianak Indonesia Masters | **2** | **4** | **6** | **8** | **10** |
| BWF World Championships | 1 | 2 | 3 | 4 | 5 |

`drawId=1` at the second one is *MS - Qualification*: a real payload, with real matches,
silently answering a different question. The list has to be read.

⚠️ **The two size fields disagree by a factor of two, on purpose.** The list says
`size: 32` — the field. The draw payload says `drawsize: 16` — the number of first-round
*matches*. Neither is wrong; they are different quantities with confusable names.

⚠️ **Draw sizes vary inside one tournament.** At Pontianak the men's singles is a 64 and
every other draw is a 32. Nothing may assume a tournament has one shape, and a round name
from one draw ("R64") may not exist in the next — which is why switching discipline drops
the fold rather than carrying it.

⚠️ **A qualifying draw is not a bracket.** It comes back as a single column of eight cells
all reading "Qual. R16", with `drawendcol` set. `parseDrawList` drops them: one column is a
list, and those matches already appear in the order of play on the day.

⚠️ **Only `matches[]` carries `id`.** The grid cells carry `code`, which is unique within a
draw and **not** across one — MS and WD both have a match `1`. Anything identifying a match
across the tournament, a star above all, needs the id, so the richer object is joined in on
`code` and the cell is then parsed by the same `parseMatch` the order of play uses.

⚠️ **Byes are not a doubles curiosity.** The predecessor's README says they happen when 48
pairs enter a 64 draw and that its singles fields were full. True of a World Championships,
false in general: the men's singles at Pontianak is a 64 draw with **16 byes**. A bye is a
*first-round* cell with one side filled — in any later column the same shape is an ordinary
fixture whose feeder has not been decided, and reading those as byes would call the whole
unplayed half of the draw a walkover.

⚠️ An unplayed bye must not hold the auto-fold on a round that is otherwise finished: the
sixteen byes of a 64 draw never get a winner, so `autoFromCol` skips them.

⚠️ **This endpoint 500s for some tournaments** — Paris 2024 and the 2026 Indonesia Open
are both recorded in Part 3.4d, which is why the winners page reads the last day's order of
play instead. There is no substitute here, because a bracket *is* the draw data, so the
view says the draw could not be loaded and the order of play stays reachable beside it. A
tournament whose draw 500s must not take the page down with it.

**The geometry is inherited whole and re-verified**: `centre(c, r) = (r + 0.5) · 2^c ·
SLOT`. `tools/probe-bracket.mjs` runs the layout over every draw of three real tournaments
and reports the worst deviation of a card from the midpoint of its feeders — **0.000 px**
in all of them, at every fold. `bracketLayout` is a pure function of the parsed draw for
exactly this reason: it is arithmetic, so it is tested as arithmetic.

**Not ported: custom pan and zoom.** The predecessor drove the map with pointer events and
recorded two traps that cost it clicking a card — `setPointerCapture()` retargets the
follow-up `click` to the capturing element, and `preventDefault()` on `pointerdown` can
suppress the compatibility click entirely — plus a capture-phase swallower so releasing a
drag did not open the card underneath. All of it exists to let dragging and clicking
coexist. The fold does what panning was there for (from the QF the rest of the tournament
is 774 × 282), so the scroller is the browser's, the click is an ordinary click, and none
of those traps can return. **This is the one place where not porting something was the
lesson.**

⚠️ **A `dr=` in the hash has to be honoured after the list is already loaded**, not only on
the first fetch. Following a bracket link usually happens while the reader is already on
the page, so applying it inside the "list is empty" branch meant a shared link opened on
whatever was showing before. Caught by the suite, not by looking.

⚠️ **Card width is 230px, and it was found by looking at it.** At 190 the arithmetic was
fine and the names were cut — `Kunlavut VIT…`, `Kodai NARA…`, `Anders ANTON…`. A doubles
pair can be shortened to surnames; a singles player is one name and there is nothing to
shorten, so the card has to fit the longest of them. This is the third time a label has
been found clipped by a screenshot rather than by a test.

### 3.5a A row of the order of play is a moment, not a position *(fixed 4 Sep 2026)*

`courtGrid` laid the day out with **one row per position on court** — row 3 was "third on
this court" — and claimed in its own doc comment that two cards on the same row were
therefore at the same point in the day. That claim holds only while every court keeps step,
and it was found false by a reader looking at the LI-NING China Masters:

```
Court 1   10:00*  10:50  11:45  12:35  13:25  17:00*  17:50  18:40  19:30  20:20
Court 2   10:00*  10:50  11:45  12:35         17:00*  17:50  18:40  19:30
Court 3   11:00*  19:00*
                          (* a time BWF published; the rest are its estimates)
```

Court 3 held two matches all day, each opening a session of its own. Both were
first-and-second **on their court**, so the positional grid put the 11:00 match level with
the 10:00 ones and the **7pm match level with 10:50** — beside a match that had finished
eight hours earlier.

**The fix is not to sort the day by the clock**, and that is why this is harder than it
looks — 4.7 exists precisely because most of those times are not real. What is real is the
*anchor*: BWF publishes a start for the first match of every session and estimates the rest
at a flat 50 minutes, and those estimates run backwards across a session boundary. So:

- a court's day is cut into **runs** at every anchored match;
- runs are placed in the order of their anchors, and each run's matches then take
  consecutive rows, which is the positional rule *inside* a session;
- a run whose anchor falls between two existing rows has a row spliced in for it, and the
  columns beside it are simply empty — because at that moment nothing was on those courts.

On a day where every court starts and breaks together the runs line up and share rows, and
this lands on exactly the grid the positional rule gave. The World Championships fixture
gains one row: courts 3 and 4 came back at 14:10 while courts 1 and 2 played through.

⚠️ **Two anchors within a quarter of an hour are one moment** (`SAME_MOMENT`). At those same
Worlds courts 1 and 2 opened at 9:00 and courts 3 and 4 at 9:10; two half-empty rows would
say something the day did not, and the shortest badminton match is forty minutes. The grace
applies **anchor to anchor only** — a published time never snaps onto an estimated one,
which is what keeps court 3's 11:00 off the 10:50 row.

⚠️ **"Not before 5:00 PM" is an anchor, not an estimate.** It reads like hedging and is not:
it is how BWF opens an afternoon or evening session. `parseMatch` gained `anchored`, and
`estimated` is now simply its negation — so such a card also stopped being marked ≈.

⚠️⚠️ **The grid orders on `matchTimeUtc`, never on `matchTime`.** They disagree. In the
recorded Worlds day the offset between them wanders between 5.00, 5.50 and 6.00 hours on
matches ten minutes apart, and it is the *venue* clock that runs backwards:

```
Court 1 #4  matchTime 11:40   utc 05:40
Court 1 #5  matchTime 11:20   utc 06:20      <- venue goes back, utc does not
```

`matchTimeUtc` was strictly increasing down every court in that payload; `matchTime` was
not. The card still prints the venue clock, because that is what the arena shows, but
nothing may be *ordered* by it. `startAt()` in `model.js` is the only place in the app that
turns a match time into an instant.

⚠️ With no times at all the grid falls back to the old positional layout rather than
inventing an ordering — `positionalGrid`, which is also what the session logic reduces to.

**Seeds.** While in the same view: a seed is drawn `[1]`, never bare. BWF sends the string
`"1"`, and a lone numeral beside a name on a match card is the one thing there that could be
read as something else — a score, a game count, a court. The brackets are punctuation and
live in `app.js`; `sd.seed` stays the string BWF sent. Both `.side` and `.bside` had to widen
their seed column, which is a fixed pixel track in each grid.

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

### 3.6b The schedule fixture is a photograph — *(learned 23 Aug 2026)*

⚠️ **`vue-tmt-schedule` answers "what is on *now*", so re-recording moves it.** Recording two
players mid-session re-ran the tournament pass, and between the morning and the afternoon of
23 August the World Championships finished: `nextLive` went from the Worlds to the Pontianak
Indonesia Masters and the Worlds dropped to `previousTmt`. Four tests that had pinned *which
slot* held the Worlds broke at once.

Pin the **date** with `now=` — that part works — but never assume which slot anything is in.
Find a tournament by its code. The same applies to `day-matches`: the finals-day fixture was
re-recorded *during* the finals, so it now holds three finished matches, one in progress and
one not started. That is better coverage than it had before, and the tests assert invariants
per state rather than counts, because the next re-record will move it again.

**The one thing it settled:** a live match reports `matchStatus: "P"` with
`matchStatusValue: "In Progress"` — **not "Live"**. Caught at 8–7 in the first game of the
women's singles final. Reading the letter rather than the word (3.7) was the right call and
this is the proof.

### 3.7 A match is not always played — *(read 23 Aug 2026)*

`tournaments/day-matches` returns a **plain array already in the order of play** (4.7). Each
match carries `team1`/`team2` (players, country, flag), `team1seed`/`team2seed`, `drawName`,
`roundName`, `courtName`, `oopText`, `duration`, `winner` (1, 2 or 0) and `score`.

`score` is one entry per game: `{set, home, away, lastPointWinner, serve}` — **`home` is
team1 and `away` is team2**, so a scoreline shown winner-first has to flip when `winner` is 2.

⚠️ **`scoreStatusValue` is `Normal`, `Walkover` or `Retired`.** A walkover has `score: []`
and a winner; a retirement has however many games were played. Both happened on a **single
day** of the 2026 Worlds, so this is ordinary rather than exotic. Without a word for it a
walkover draws as a finished match with a blank scoreline, which reads as a bug in the app
rather than a fact about the match — `parseMatch` carries it as `note` and the card shows it.

⚠️ **Status comes from the single-letter `matchStatus`, not from `matchStatusValue`.** The
predecessor learned the four values against a live tournament and they are worth having:

| letter | meaning |
|---|---|
| `F` | finished |
| `O` | **off court** — played out, result not yet signed off. Arrives *with* a winner and a full score, so reading it as unplayed puts "Scheduled" on a finished match |
| `L`, `P` | being played |
| `N` | not started |

`matchStatusValue` has only ever been seen here as `Finished` or `none`, so a guess at how it
spells "live" would fail silently for exactly the week it mattered.

`tournaments/day-matches/courts` and `/players` exist (3.5) but the view needs neither: the
courts come out of the matches, which is also what keeps an unused court off the screen.

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

*(No longer live here — the modal became a page on 23 Aug 2026, see 1.1d — but keep the
lesson: it applies to any `<dialog>`, `popover`, or anything else in the top layer.)*

`node tools/shot.mjs --top "#p=…"` clips to the first 460px at 1.6× — the nav, hero and page
header at a size you can actually read. A whole-page capture squeezes 1600px of document
into one image and the chrome comes out too small to judge; that has twice sent me hunting
for a bug in something that had rendered perfectly.

Capture a top-layer element **without** `captureBeyondViewport` and clip to the viewport.
`shot.mjs`
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

⚠️ Which does not mean the day carries no real times. Every session's **first** match has a
published one — *Starting at 10:00 AM*, or *Not before 5:00 PM* for a session opening
mid-day — and those are exact. `parseMatch` marks them `anchored`, and the grid's rows are
built on them; see 3.5a.

⚠⚠ And `matchTime` and `matchTimeUtc` **disagree**: in the recorded Worlds day the offset
between them wanders between 5.00 and 6.00 hours, and it is the venue clock that runs
backwards while UTC does not. Print `matchTime`, order on `matchTimeUtc`.

### 4.8 `el.hidden = true` does not hide anything this sheet styles

⚠️ The `hidden` attribute is only a **user-agent** `display: none`, so *any* author rule
that sets `display` outranks it. This sheet sets `display` on nearly everything, so
`el.hidden = true` was a no-op on `.legend` (flex), `.kindwrap` (inline-flex) and
`.gridbody` (flex). Switching to the honours board left the grid's legend and its
explanatory note sitting underneath the board, describing a view that was not on screen —
and would have left the whole grid visible had it been rendered.

Fixed once, next to the box-sizing reset, rather than remembered at every call site:

```css
[hidden] { display: none !important; }
```

Worth knowing before adding any other view that toggles: the symptom is not an error, it is
two things on screen at once, and it is easy to read as a render bug in the new code.

---
### 4.9 Stepping a row of chips *(built 5 Sep 2026)*

⚠️ **Up adds the highest that is off; down removes the lowest that is on.** Not "the next one
along from where you last were": a row of chips has **no cursor**, and a key that invented one
would do different things depending on what had been clicked. Working from the ends makes the
two keys exact inverses — every press of down is undone by a press of up — and it walks the
ladder the way somebody narrowing a career actually thinks: drop the small ones, keep the big
ones.

⚠️ **The order walked is read off the chips the page has drawn**, not off `LEVEL_ORDER` or
`gridOrder`. Those are what the row is built *from*, and a key walking the source list would
eventually reach for something not on the bar — the Seasons page keeps a dozen unmapped
Superseries-era ids behind its "N more" menu, and switching one of those on changes the strip
with nothing on screen moving to explain it.

⚠️ **The team events are off by default**, so "the lowest that is on" is not the last chip
drawn. A rule that assumed it was would press a chip that was already off and appear to do
nothing.

⚠️ This takes the page scroller's arrows on the Seasons page and the career grid, which
`README.md` used to promise it never would. The trade is deliberate and is written down
there: the arrows are the only keys that can be *held*, so narrowing a fourteen-level strip is
four taps rather than four aimed clicks.



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
3b. ~~**Career grid + compare.**~~ **Done 22 Aug 2026.** The grid of Part 1.1b, its
   block model in `model.js` (Part 2.9), a zoom slider, and two careers side by side
   sharing one set of blocks. Built twice: the first layout gave every tournament its own
   column and did not survive 2021 — see 1.1b. The type-ahead was made a factory at this
   point because the comparison needs a second one; the career walk was extracted as
   `walkCareer` for the same reason.
4. ~~**Tournament view.**~~ **Done 23 Aug 2026.** `vue-tmt-schedule` drives it, exactly as
   3.2 promised. A day bar across the tournament, one column per court, matches in the order
   of play, draw filters, and a refresh that bypasses the cache. See 1.2 and 3.7 — the one
   surprise was that a finished match need not have a score.
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
