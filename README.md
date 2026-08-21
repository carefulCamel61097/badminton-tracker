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
photograph, their flag, and their name.
Within a row, one square per tournament in chronological order. Each is a gauge: it fills
from the bottom by how far the player got, ramping green (title) to red (first-round exit),
and the label inside says the same thing in words so nothing is carried by colour alone.

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

## Where things are

| File | What it is |
|---|---|
| `model.js` | Pure logic: levels, weights, positions, the ladder and fill, name tidying, season parsing. No browser globals, so the tests import it straight into Node |
| `api.js` | The request layer: two-lane queue, 320ms pacing, TTL cache, one retry. Also player search, rankings, and the URLs for BWF's flags and photographs |
| `app.js` | The season view: the strip, the discipline toggle, the level filters, the year stepper |
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
`tests/shots/`, so a change to the strip can be looked at rather than only asserted.

`probe-draws.mjs` reports the stage layout `tournaments/draws` returns for a knockout, a
draw with qualifying, a group stage and a team event — the shapes the ladder has to handle.

## Etiquette

Non-negotiable, and enforced in `api.js` rather than by convention:

- every request serialised through one queue with a ~320ms gap
- a 5-minute cache, 12 hours for ranking data
- never poll faster than ~30s, even for live scores
- credit BWF visibly, link back to their tournament pages, carry no BWF logo, and say
  plainly that this is unofficial
