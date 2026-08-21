# Kickoff prompt

Copy the block below into a fresh Claude Code session, started in the new (empty) repo
directory, with `HANDOVER.md` and `tools/` copied in alongside.

Setup before you paste:

```sh
mkdir badminton-tracker && cd badminton-tracker && git init
cp "c:/Users/Thabi/Documents/Ideas/badminton-tracker/HANDOVER.md" .
cp -r "c:/Users/Thabi/Documents/Ideas/badminton-tracker/tools" .
```

---

```
Read HANDOVER.md in full before doing anything. It is the design and engineering brief for
this project, written at the end of its predecessor, and it carries decisions that were
settled by testing — do not re-open them without new evidence.

## What we're building

A general-purpose BWF badminton tool. The centrepiece is a season view: pick a player and
a year, get one square per tournament, chronological, each square a gauge that fills with
how far they got and colour-ramps green (title) to red (first-round exit). Squares are
sized by tournament weight. Later: an auto-following tournament view and a bracket view.

The predecessor was a single-tournament World Championships tracker. It is being retired;
this is not a refactor of it, because its whole spine was one hardcoded tournament and
ours is a player over time.

## Constraints — these are settled, follow them

- **Vanilla JS. No build step, no package.json, no dependencies.** index.html + app.js +
  styles.css, served over http:// (not file://). Node 24 for the test harness, using the
  global WebSocket. This worked well on the last project; keep it.
- **BWF's Cloudflare 403s headless Chrome.** Anything touching the live API must drive a
  real windowed browser, parked offscreen with --window-position=-2400,0. Headless is fine
  for screenshotting local files.
- **Kill Chrome with taskkill /T /F, never chrome.kill().** See HANDOVER 4.2 — this is one
  bug with two symptoms and it cost a day and a full disk last time.
- **Sweep stale %TEMP% profiles at the start of every test run**, older than an hour. See
  HANDOVER 4.3. Put this in from the first commit, not later.
- **API etiquette is not optional.** Serialise requests with a ~320ms gap, cache with a
  5-minute TTL (12 hours for ranking data), never poll faster than ~30s. Credit BWF
  visibly, link back to their tournament pages, carry no BWF logo, and say plainly that
  the tool is unofficial.

## Where things stand

- The API map in HANDOVER Part 3 is verified — every endpoint listed returned 200 as of
  21 Aug 2026. Read Part 3.6 (traps) before writing the client; several of those were
  shipped bugs last time.
- The weighting scheme in Part 2 is decided, including the numbers, the 42px full square,
  the 9px label floor, and the equal-footprint slot. It is grounded in BWF's own player
  commitment rules, not in the Super numbers. Do not substitute your own scale.
- tools/discover.mjs finds BWF endpoints by capturing what their own pages request and
  scanning their JS bundles. It is how Part 3.2 was found. Re-run it against a tournament
  page — nobody has, and it will probably turn up the draw and live-score endpoints.
- tools/bench.html is the interactive test bench the weighting was decided on, with twelve
  real 2026 seasons baked in. Reference implementation for the square rendering.

## First task

Set up the skeleton and the data layer, and prove it end to end:

1. index.html / app.js / styles.css, plus a trivial static server script for local dev.
2. The API client: two-lane priority queue, 320ms pacing, TTL cache, one retry. Port the
   shape from the old project if you can get at it, otherwise build it to the spec above.
3. loadSeason(playerId, year) against
   vue-player-tournaments?playerId&isPara=0&drawCount=1&activeTab=0&tmtYear=YYYY —
   remember the results come back newest-first and a season reads left to right.
4. The test harness (run.mjs + fixture record/replay over CDP's Fetch domain, per
   HANDOVER 4.4), with the profile sweep in place, and one suite that asserts a known
   player's season parses correctly.
5. A page that renders that season as plain text or JSON. No styling yet.

Stop there and show me what you have before building the visual layer.

Ask me if anything in HANDOVER.md is ambiguous rather than guessing. Two things in it are
explicitly still open: the Continental Championships weight, and what a doubles season
strip should mean.
```
