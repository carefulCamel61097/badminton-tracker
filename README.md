# Badminton Season Tracker

An unofficial fan tool for looking at a badminton player's season: one square per
tournament, chronological, each a gauge showing how far they got, sized by how much the
tournament weighs.

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

## Where things are

| File | What it is |
|---|---|
| `model.js` | Pure logic: levels, weights, positions, fill, name tidying, season parsing. No browser globals, so the tests import it straight into Node |
| `api.js` | The request layer: two-lane queue, 320ms pacing, TTL cache, one retry |
| `app.js` | The page. Currently prints a season as text — the visual layer is next |
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
```

Captures the API requests a BWF page makes and scans its JS bundles for endpoint literals.
It is how Parts 3.2 and 3.5 of `HANDOVER.md` were found.

## Etiquette

Non-negotiable, and enforced in `api.js` rather than by convention:

- every request serialised through one queue with a ~320ms gap
- a 5-minute cache, 12 hours for ranking data
- never poll faster than ~30s, even for live scores
- credit BWF visibly, link back to their tournament pages, carry no BWF logo, and say
  plainly that this is unofficial
