# Badminton Season Tracker

An unofficial fan tool for looking at a badminton player's whole career: one row per
season with the most recent at the top, one square per tournament within it, each a gauge
showing how far they got and sized by how much the tournament weighs.

**All data comes from [BWF](https://bwfbadminton.com/) and belongs to them. This is not
affiliated with, endorsed by, or connected to BWF.** The API it reads is undocumented and
unofficial and can change without notice.

## Running it

No build step, no dependencies, no `package.json`. It does have to be served over `http://`
rather than opened as a file — ES modules and the request to BWF both refuse a `file://`
origin.

```sh
node serve.mjs          # http://localhost:8080
```

Requires Node 24 for the global `WebSocket` the test harness uses.

## The seasons

Search a player by name — or pick one out of the top ten of any discipline — and their
career stacks up as one row per season, newest first. The heading is the player: BWF's own
photograph, their flag, their name, age, world ranking and place in the Race to Finals.
Within a row, one square per tournament in chronological order. Each is a gauge: it fills
from the bottom by how far the player got, ramping green (title) to red (first-round exit),
and the label inside says the same thing in words so nothing is carried by colour alone.

Where two tournaments in one season tidy to the same words — January 2021 ran the YONEX
Thailand Open and the TOYOTA Thailand Open a week apart in the same Bangkok bubble — the
sponsor is handed back, because that is what BWF is distinguishing them by. Only there;
everywhere else the sponsor stays stripped.

Seasons and tournament levels are both filtered with toggle buttons — a chip per season and
a chip per level. The levels nobody filters by, which is mostly pre-2019 category ids this
project has no name for, sit behind one "N more" menu of checkboxes so they do not crowd out
the ones that matter.

How far they got is measured against that draw's **real ladder**, fetched per tournament:
a quarter-final of a 64-draw fills 3/6 and a quarter-final of a 32-draw fills 2/5. Qualifying
does not count towards it, and a round robin that *is* the main stage does. The strip renders
before those sizes arrive and corrects itself when they land, so nothing waits on them.

Squares are sized by tournament weight, which is settled in `HANDOVER.md` Part 2 against
BWF's own player-commitment rules — Super 750 is the line above which entry is compulsory,
so that and everything above it is full size. The box shrinks inside a fixed 52px slot, so a
lighter event reads as more air rather than as a narrower column, and the round label never
scales below 9px.

Singles or doubles is the only other choice, and the toggle appears only for players who do
both. A doubles season is **not** filtered by partner: every doubles tournament that player
entered is shown, whoever they played it with.

The Olympics are there, under their own level. BWF files them as category 20 — the same id
as the World Championships — and spells their draws and rounds out in full
("Men's Singles", "Quarterfinals") where the World Tour uses codes, which is a good way to
lose them entirely. See `HANDOVER.md` Part 2.6.

## Two pages

**Seasons**, **Compare** and **Tournament**, on a tab bar under the player's name. Seasons is
the strip and is what you land on. Compare holds the grid and the honours board, either of
them for one player or two, and when there is only one it draws an empty dashed seat beside
them — a page called Compare should look like one before anybody has been chosen.
Tournament is the odd one out: it is about a tournament rather than a player, and works
before you have searched for anybody.

## The grid

The seasons again, read the other way round, on the **Compare** page. Rows are
still seasons. Columns are **levels**, not tournaments: each level gets a block of slots,
and a season's results at that level fill it **left to right, best first**. Four Super 1000
slots read `W W W SF` for Shi Yu Qi in 2025 and `F QF R16 R32` in 2026. Unplayed slots pad
the right-hand end of the block.

Every cell is the same size and flooded with one colour — no labels, no weight sizing, no
partial fills. The difficulty is in *which block* a cell is in and how far left it sits, and
cells butt together so runs of the same result merge into one shape. A zoom slider sets the
size; it is a viewing preference and stays out of the link.

Blocks run hardest-first — Olympics, Worlds, Tour Finals, Continental, Super 1000,
Super 750, Super 500, Super 300, Super 100 — then the pre-2018 category ids this project
has no name for, grouped as "Unmapped" on the end. A chip per level switches it in or out.
Below Super 100, the junior circuit and the team events are not in the grid at all.

A block is as wide as **the most anyone on screen played at that level in a single season**.
That is measured rather than declared, because the declared answer moves: four Super 1000s
in 2026, five in 2027, and five in 2021 because that January ran two Super 1000 Thailand
Opens back to back in the Bangkok bubble. The Super 750s grew from five events to six after
2019, so a six-wide block means an empty slot in an old row and a skipped event in a recent
one — see `HANDOVER.md` 2.9.

One thing does not go by the date it was played: **the season-ending Finals belongs to the
season it concludes.** BWF files the COVID-delayed 2020 edition under 2021, which put two
Tour Finals in one row. It is the one event there is exactly one of per season, and BWF's
own name still says which edition it is.

**Compare with…** loads a second whole career and puts it beside the first, sharing one set
of blocks and one set of rows so the two are readable against each other, with each player's
photograph, flag, age, world ranking and Race standing above their grid. The comparison is
in the URL, so it is a link.

See `HANDOVER.md` Part 1.1b for what this layout gives up — a cell no longer says which
tournament without hovering it — and 2.9 for why the first attempt, a column per
tournament, did not survive contact with 2021.

## The honours board

The other reading on the **Compare** page. This one has no seasons in it at all: one row per
level, hardest at the top, holding every result in the career that reached at least a
**semi-final** — the bar moves to QF+, F+ or W. Everything below it is simply not drawn.

The rows are different sizes, and that is the whole idea. Each rung up has **φ times the
area** of the one below, so an Olympic square covers about thirty Super 100 ones and a
career reads as a shape rather than a list. It is the golden ratio applied to area rather
than to side: nine rungs at φ per *side* would make the top row 47 times the bottom, which
is one square and some dust.

The **Continentals share the Super 1000 rung** rather than taking one of their own, and are
listed just above it. An Asian Championships title is a major, and giving it a step to
itself used to push every Super below it down one — so Super 1000 → 750 was a single step
while 750 → 500 was a double, and the official five-level ladder came out unevenly spaced
for a reason that had nothing to do with the Super events. Now the five Supers are an
unbroken run of rows and of sizes, with nothing listed between them. `HANDOVER.md` 2.10 has
the table.

An empty row is a claim too, and there are two different ones. Hovering says which: `26
entered, none at QF+`, or `never played at this level`.

**Compare with…** mirrors the board about a centre line — left player reversed and
right-aligned — so the best results of each meet in the middle and the two shapes face each
other. Shi Yu Qi against An Se Young is the case it was built for: his Super 1000 row runs
out to yellow, hers is a wall of dark green — and at **W** his Olympic row is a ghost while
hers holds Paris.

The bar is in the link because it is part of what the board says. The zoom is not.

The board is deliberately **not** what you land on. It is superb for the very best players
and it collapses for everyone else — a working professional at world #22 is seven squares
and eight empty rows, which is true and looks like a bug. The strip is the only view that
always has something to say, so that is the one a player opens on.

## The tournament

Whatever is on, without picking it. One 1.8 KB call to BWF says which tournament has live
scores, which one just finished and which is next; the page shows the right one and says
which of the three it is.

A day bar runs across the tournament's dates and opens on today — or on the last day if it
is over, the first if it has not started. Below it the order of play, laid out as a grid:
**one column per court, one row per position on that court**. Two cards level with each other
are at the same point in the day; row three means third on. When there is only one court, or
the order of play is not out yet, it falls back to a plain list.

The y-axis is the running order, never the clock. BWF publishes a flat 50-minute estimate per
match and on some courts they run backwards, so only the first match on a court is given a
time as fact. The rest are marked **≈** and carry its own wording — *Followed by*.

Each card is a scoreboard: flag, seed, name, and **that side's own games** as badges with the
ones they won picked out. The winner's name is bold, the loser's dimmed. A **walkover** or a
**retirement** is marked on the side it happened to — the one that lost — because both happen
and a walkover has no score at all to print.

**Refresh** re-asks BWF rather than reading the five-minute cache, which is the point while
a tournament is running. `#now=YYYY-MM-DD` pins what the page thinks today is — useful for
seeing what finals day will look like without waiting for one.

## Who you start on

With nobody in the link, the app opens on the **world number one in men's singles** — looked
up, not hardcoded, so it is whoever holds it today. An empty strip is a worse first
impression than anybody's.

## Where things are

| File | What it is |
|---|---|
| `model.js` | Pure logic: levels, weights, positions, the ladder and fill, name tidying, season parsing. No browser globals, so the tests import it straight into Node |
| `api.js` | The request layer: two-lane queue, 320ms pacing, TTL cache, one retry. Also player search, rankings, and the URLs for BWF's flags and photographs |
| `app.js` | All three pages: the strip with its discipline toggle, level filters and year stepper; the compare page holding the grid, the honours board and the second player; and the tournament page's day bar and order of play |
| `serve.mjs` | Static server for local development |
| `HANDOVER.md` | The design and engineering brief. Read it before changing anything: the weighting, the doubles model and the API traps are all settled there, several of them by testing |

## Tests

```sh
node tests/run.mjs             # everything
node tests/run.mjs unit        # no browser, about ten seconds
node tests/run.mjs --live      # ignore the fixtures, talk to BWF
node tests/record.mjs          # top up the fixture set from the live API
```

The end-to-end suite drives a real windowed Chrome, because BWF's Cloudflare 403s headless
browsers. The API is replayed from `tests/fixtures/` (gitignored, ~7 MB, regenerable with
`record.mjs` — but only while the data is still live). Anything with no fixture falls
through to the network and is reported, so a gap shows up as a slow test rather than a
silent wrong answer.

`tests/run.mjs` sweeps stale Chrome profiles from `%TEMP%` before it starts. Do not remove
that: on the predecessor 467 of them accumulated and took a 238 GB disk to zero bytes free.

## Tools

```sh
node tools/discover.mjs [url…]   # what endpoints does BWF's own frontend call?
node tools/shot.mjs [#hash…]     # screenshot the strip, from fixtures
node tools/probe-draws.mjs       # what tournaments/draws returns per format
```

`discover.mjs` captures the API requests a BWF page makes and scans its JS bundles for
endpoint literals. It is how Parts 3.2 and 3.5 of `HANDOVER.md` were found.

`shot.mjs` renders the app against the recorded fixtures and writes PNGs to
`tests/shots/`, so a change to the strip can be looked at rather than only asserted. Its
defaults cover a singles career, a doubles one, the grid and a two-player comparison; any
`#hash` works, and one carrying `g=1` is captured at the width the compare page needs.
`--top` clips to the chrome — nav, hero, page header — at a scale you can read.

`probe-draws.mjs` reports the stage layout `tournaments/draws` returns for a knockout, a
draw with qualifying, a group stage and a team event — the shapes the ladder has to handle.

## Etiquette

Non-negotiable, and enforced in `api.js` rather than by convention:

- every request serialised through one queue with a ~320ms gap
- a 5-minute cache, 12 hours for ranking data
- never poll faster than ~30s, even for live scores
- credit BWF visibly, link back to their tournament pages, carry no BWF logo, and say
  plainly that this is unofficial
