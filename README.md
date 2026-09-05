# Badminton Season Tracker

### → [carefulcamel61097.github.io/badminton-tracker](https://carefulcamel61097.github.io/badminton-tracker/)

It runs there. Nothing to install.

| | |
|---|---|
| [Seasons](https://carefulcamel61097.github.io/badminton-tracker/#p=57945) | a career, one row per season |
| [Compare](https://carefulcamel61097.github.io/badminton-tracker/#p=57945&pg=compare&v=h&c=87442) | two honours boards facing each other |
| [Tournament](https://carefulcamel61097.github.io/badminton-tracker/#pg=tmt) | whatever BWF has on this week |
| [Winners](https://carefulcamel61097.github.io/badminton-tracker/#pg=winners) | every season's biggest titles, as faces |

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
node serve.mjs          # http://localhost:8090
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

**A chip that is on is filled in BWF red**, here and on the compare grid and in the bracket
bars. These filters default to *all* on, so both rows open red — which was the argument for
leaving them neutral, and it lost to the bigger one: the same affordance has to look the same
on every page, or a reader learns the red pill in one place and the grey one in another. Team
events are the exception and stay a dashed outline, because they are not just another level.
The tournament page's own draw filter stays neutral too, since it sits directly under the day
bar and a second row of red there reads as one control rather than two.

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

## Four pages

**Seasons**, **Compare**, **Tournament** and **Winners**, on a tab bar under the player's
name. Seasons is the strip and is what you land on. Compare holds the grid and the honours
board, either of them for one player or two, and when there is only one it draws an empty
dashed seat beside them — a page called Compare should look like one before anybody has been
chosen.

The last two are not about a player at all and work before you have searched for anybody:
Tournament follows whatever BWF has on this week, and Winners is every season's biggest
titles at once.

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

Blocks run hardest-first — Olympics, Worlds, Tour Finals, Continental, Regional Games,
Super 1000, Super 750, Super 500, Super 300, Super 100 — then the category ids this project
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

### Exporting a comparison

**Export**, beside the zoom, draws whichever of the two views is up — the grid or the board,
one career or two — to a PNG at twice the screen's density, with the link and a legend on it.
Download it, or **Copy** it straight to the clipboard where the browser allows that.

⚠️ **No range picker here, unlike the Winners board.** That one exports a span of seasons
because "2011 to 2016" is the shape of the claim somebody posts from it. A career is not a
span, so this one draws **what is on screen**: the era switch, the level chips, the round bar
and both players if there are two. Switch Super 500 off and it leaves the picture; raise the
board to **W** and the picture is titles only.

Drawn from the model like every other export, at its own fixed size rather than at the zoom
slider's. The grid's squares are 20px in a poster — bigger than the file started at, because
at 16 a one-slot block was narrower than the three letters naming it and Olympics, Worlds,
Tour Finals, Continental and Regional Games all lost their labels off the front of the band.

⚠️ **The result ramp exists twice** — as `--res-*` in `styles.css` for the page and as
`RESULT_COLOURS` in `poster.js` for the canvas — because the page paints with CSS and the
export paints with canvas and there is no way to hand one to the other without a build step.
The suite reads the *computed* colour off a drawn cell and holds it against the table, so the
two cannot drift quietly. The `#1` on a title and the notch on a translated square are drawn
too, by the same rules and at the same gates: the mark only appears once the square is 16px,
because below that the glyphs stop being a word and start looking like dirt.

⚠️ **No flags on this one.** Measured: BWF serves player photographs from
`img.bwfbadminton.com`, which answers a CORS request, and country flags from
`extranet.bwf.sport`, which does not — so every flag failed to load, printed a CORS error and
drew nothing. The Winners board's flags come out of the harvested file and are on the
photograph host, which is why those are fine and these are not. The country is in the line
under the name anyway.

The file is named for the people in it — `badminton-grid-shi-v-an.png` — because a comparison
and a single career would otherwise land in a downloads folder as the same file and the second
one would silently become `(1)`.


## The tournament

Whatever is on, without picking it. **No player card sits above it**, the same as the
winners page: this page is about what is on court, not about whoever was last looked up, so
a career here would answer a question nobody asked and push the day down the screen. The
search box stays, because it is how you leave for a player. One 1.8 KB call to BWF says which tournament has live
scores, which one just finished and which is next; the page shows the right one and says
which of the three it is.

A day bar runs across the tournament's dates and opens on today — or on the last day if it
is over, the first if it has not started. Below it the order of play, laid out as a grid:
**one column per court, one row per moment in the day**. Two cards level with each other were
on court together. When there is only one court, or the order of play is not out yet, it
falls back to a plain list.

⚠️ **A row is a moment, not "nth on this court".** It was positional until the China
Masters of 4 September 2026, where court 3 held two matches all day — one at 11:00 and one at
19:00 — and both, being first-and-second on their court, were drawn level with the morning on
courts 1 and 2. The evening match sat beside one that had finished eight hours earlier.

Which is *not* the same as sorting the day by the clock, and that is why this is harder than
it looks. Only some times are real: BWF publishes a start for the first match of every
session — *Starting at 10:00 AM*, or *Not before 5:00 PM* when a session opens mid-day — and
then strings a flat 50-minute estimate through the rest, which on some courts runs backwards.
So the day is cut into sessions at its **published** times, those are placed against each
other in order, and inside a session position on court is still the row. A court that opens
its own session gets a row to itself and the columns beside it are simply empty there. On a
day where every court starts and breaks together this lands on exactly the grid the old rule
gave. Two published starts within a quarter of an hour count as one moment — courts opening
ten minutes apart is a stagger, not a different part of the day.

Estimated times are marked **≈** and carry BWF's own wording, *Followed by*. A published
one never is, however it is phrased.

Each card is a scoreboard: flag, seed, name, and **that side's own games** as badges with the
ones they won picked out. A seed is written `[1]`, never bare — a lone numeral beside a name
on a scoreboard is the one thing there that could be read as something else. The winner's
name is bold, the loser's dimmed. A **walkover** or a
**retirement** is marked on the side it happened to — the one that lost — because both happen
and a walkover has no score at all to print.

**Click a match to star it.** Starred matches stay lit and the rest recede, so a handful of
them read at a glance across a whole day. There is a *Starred only* filter, a count and a
Clear, and the stars are remembered between visits. Nothing is dimmed until you have starred
something — a uniformly grey page looks broken rather than filtered.

**All** on the day bar loads every day of the tournament at once, one heading per day.

While a tournament is on, the scores are re-checked every minute and anything that moved is
marked for a few minutes after — and immediately when you come back to the tab, which is when
it matters. **Refresh** asks now. Times are given at the venue and, where it differs, where
you are. `#now=YYYY-MM-DD` pins what the page thinks today is, useful for seeing what finals
day will look like without waiting for one.

### The bracket

The other reading of the same tournament. The order of play answers *what is on court
today*; the draw answers *where is this all heading*, which no single day's fixtures can.
**Order of play / Bracket** switches between them and the choice travels in the link.

It is the predecessor's map view: feeders on the left, the Final on the right, elbow
connectors between, every card sitting at the midpoint of the two that feed it. Positions
are computed rather than walked —

```
centre(c, r) = (r + 0.5) · 2^c · SLOT        SLOT = card height + gap
left(c)      = c · (card width + connector width)
```

— so each column is a doubling of the one before it.

**Folding away the rounds that are over.** By the quarter-finals a full bracket is mostly
empty space: the spacing law means every round doubles the gap between its cards, so four
quarter-final cards sit **sixteen slots apart** because they still have to line up with
thirty-two first-round matches nobody is looking at any more. Hiding the early columns
would not have helped — the gaps are the geometry, not the drawing. So the tree is
*re-laid out* from the round you pick, which becomes the new column zero and puts its
cards one slot apart again. It stays a real bracket, connectors and all, just a smaller
one:

| Show from | Cards | Segments | Canvas |
|---|---|---|---|
| All | 63 | 124 | 1548 × 1906 |
| R32 | 31 | 60 | 1290 × 978 |
| R16 | 15 | 28 | 1032 × 514 |
| QF | 7 | 12 | 774 × 282 |

From the quarter-finals the whole rest of the tournament is on screen with no scrolling at
all. **The default follows the tournament**, like the day bar: it opens on the earliest
round that still has a match to play, and stops at the quarter-finals however finished the
draw is, because one card is not a bracket.

**A draw is one discipline by definition**, so the bracket picks exactly one rather than
filtering several, and it says the field size beside each — `MS 64`, `WS 32`. Both bars are
pickers rather than filters — exactly one draw, exactly one round — and the chosen chip is
filled in BWF red, which is what a chosen chip looks like everywhere now. The draw ids
come from BWF's own list rather than from counting: at a tournament with qualifying they
run 2, 4, 6, 8, 10, and asking for `1` gets you the men's *qualifying* draw, which is a
real payload quietly answering a different question.

**Byes are drawn, not invented.** A first-round cell with one side filled and the other
empty is a player already through, not a fixture — it gets a dashed card reading *Bye*
rather than "v TBD". This is not a doubles curiosity: the men's singles at the Pontianak
Indonesia Masters is a 64 draw with **sixteen** of them.

A doubles pair is written `SURNAME / SURNAME`, because four names do not fit a card and one
pair is one competitor; singles keep the full name, and hovering any card gives the full
form either way. **Clicking a card stars the match** — the same star the order of play
uses, on the same match, because it is the same match.

**Scrolling is the browser's.** The predecessor drove pan and zoom from pointer events and
recorded two traps it cost: `setPointerCapture` retargets the follow-up click, so cards
never received it, and `preventDefault()` on `pointerdown` can suppress the click entirely.
All of that exists so dragging and clicking can coexist. Here the fold does the job custom
panning was there for, so there is no drag, the click is an ordinary click, and none of
those traps can come back.

## Winners

One column per season, oldest on the left, each a pyramid of the titles that mattered —
every square the face of whoever won it, sized by the same ladder the honours board uses.
Men's and women's singles, 2007 to now.

**The Olympics and the World Championships share the top row.** Every season holds one or
the other and never neither, so they are the same rung of the calendar even though they are
not the same prize. (2021 held both — Tokyo was postponed into the same year as the Huelva
Worlds — so that row simply holds two.) Below them the World Tour Finals, then the Super
1000s, then the Super 750s.

⚠️ **The two are drawn the same size, and a gold ring is what tells them apart.** Only the
Olympic square wears one: one marked square beside a plain one is the ranking, and ringing
both made them read as a matched pair in two liveries. The world champion had a white ring
for a day, which was the worse of the two mistakes — on a dark ground white is the *brighter*
colour, so the square meant to be the plain case came out looking like the bigger prize.
The Olympic square used to be a rung larger,
which is right on the honours ladder and wrong here: on this page a square is a *face*, and
two faces on one line at two different sizes read as a layout accident rather than as a
ranking. `pyramidScale` overrides the size for this page only — the honours board still
ranks an Olympic gold above a world title, because that is a claim about worth and this is a
row of portraits.

⚠️ **Nothing below the summit is ringed.** There used to be a ring per tier and **not one of
them was ever visible**: they were `inset` box-shadows, and an inset shadow paints *behind*
the element's content — which here is a photograph filling the tile. They showed for the
instant before the images loaded and then went. The one that is left is drawn *outside* the
square, where a photograph cannot cover it, and every other tier says its rank by size,
which is what the page is built on.

⚠️ **No team events, and no regional multi-sport games.** A team title would rank a player
by the country they were born in. The Asian Games, the Commonwealth Games and the European
Games are all in BWF's data and all left out for the same reason more quietly: each is
closed to most of the world, so counting any one of them picks a region — the Asian Games
alone would hand out tiles LEE Chong Wei could not win while deleting the Commonwealth
golds he did.

⚠️ **No doubles.** A doubles title is won by a pair, so one square would have to hold two
faces and would stop meaning what every other square on the page means.

**Every square is named for what it was called at the time.** Hovering a 2013 Super 1000
says *Superseries Premier* and the identical rung in 2023 says *Super 1000*; the Finals is a
*Superseries Finals* until 2017 and a *Tour Finals* after it. The names come out of the same
tables the honours board uses, so the two views cannot drift apart. The summit row also
carries a mark beside the face — the rings for an Olympic champion, a cup for a world
champion — because size alone is a distinction you have to already know to read.

**⁕ marks a title that did not happen when its name says** — a dashed outline on the square
and an asterisk beside the year. Dashed and *outside*, where the tier rings are solid and
inside, so a footnote and a rank can never be read as the same mark; it used to be a gold
ring, which is now what an Olympic champion gets.  The season-ending Finals belongs
to the season it *concludes*, so the 2010 Superseries Finals and the 2020 World Tour Finals
are drawn in 2010 and 2020 although both were played the following January. That is the rule
`tournamentSeason` has always applied to a career grid; until recently the pyramid read
BWF's filing straight and the two pages disagreed about the same fact.

⚠️ **The Tokyo 2020 Olympics stays in 2021.** It is marked, not moved, and the difference is
not that one of them was labelled "(New Dates)". A Finals is *retrospective* — the conclusion
of a season already played, contested by the players that season's results qualified, and the
one event there is exactly one of per season, so two in a column is a contradiction. An
Olympics is not the conclusion of anything, and drawing an Olympic gold in the 2020 column
would say somebody won one in a year nobody played one.

Things that look wrong and are not:

- **2007–2010 have two Super rows of the same size.** There was no Superseries Premier tier
  before 2011 — all twelve Superseries were one rank — so those seasons are dealt across both
  rows at the one square size, earlier half on top. The equal size *is* the statement: a
  larger upper row would assert a tier that did not exist for another four years. (They used
  to be drawn as a twelve-wide slab under an empty row, which is the same claim in a shape
  that reads as a harvest bug.)
- **2020 is nearly bare even with its Finals back.** The calendar entries say "(Cancelled)",
  and a cancelled final has no winner.

### The doubles, and the split square

All five draws are on this page: **MS · WS · MD · WD · XD**. The three doubles ones were
absent for a while on a real objection — a doubles title is won by a *pair*, so one square
would have to hold two faces and would stop meaning what every other square on the page
means.

**The square is split down the middle instead**, half a photograph each, and it stays exactly
the size the ladder says it is. A Super 750 square is the same size in mixed doubles as in
men's singles, because the ladder is about what the *title* was worth and not about how many
people won it.

⚠️ **Each half shows the middle of its own photograph**, not one player's left ear and the
other's right. `object-fit: cover` in a box half as wide as it is tall matches the source on
height and crops the sides, which is the central band — and `object-position: top center`
keeps the crop off the chin, the same rule the full square already followed. The canvas
export does the identical thing with `drawImage`, so a pair looks like itself on screen and
in a poster.

**Above the square, a pair is one competitor**: one tile, one era bar, one line on the score,
one legend chip, and a season's scores still add to a whole season. The alternative —
splitting a title into two half-titles, one per player — would make the chart describe people
rather than teams and draw every partnership as two identical lines.

⚠️ The cost is real and it is the honest one: **a player who changes partner starts again.**
The old team stopped winning and a new one started, and the board says so rather than
pretending a career is continuous through a change of the thing that actually won the titles.

⚠️ **The key sorts, and the drawing order is settled once at the door.** BWF does not list a
partnership the same way twice. Seven pairs across the three doubles boards appear in *both*
orders across their own titles — Kido and Setiawan eleven times one way and once the other,
Cai and Fu thirteen and five, Gao Ling and Zheng Bo four and four — and the split square draws
them in the order the title carries. So the same pair swapped faces from one square to the
next along a single row, and the hover swapped their names to match, which reads as two
different partnerships. Two separate defences:

* **The key sorts a copy of the ids**, so who won was never in doubt however BWF ordered them.
  Keying on the order as sent would have split a pair in half the first time two payloads
  disagreed.
* **`settleWinnerOrder` fixes the drawing order**, once, as the file comes through
  `loadWinners`. Every pair takes **the order BWF used most often for it**, with the earliest
  title breaking a tie.

⚠️ The obvious rule — whichever order the *first* title carried — is wrong twice on this
data: Cai and Fu's first title is one of the five against thirteen the other way, and Lee Hyo
Jung and Lee Yong Dae's is one against six. The majority follows BWF's own usual presentation;
first-title only decides the three genuine ties (1–1, 3–3, 4–4).

⚠️ **No convention is layered on top of that.** It would be easy to put the man first in the
mixed and BWF itself does not — GAO Ling / ZHENG Bo is the majority order for that pair while
Lee Yong Dae leads his. The page says what the federation says, consistently.

⚠️ Settled at the door rather than at harvest time or in each of the four renderers that draw
a pair. The file on disk keeps saying what BWF said — the rule `usableAvatar` already follows —
and *which way round to draw them* is one decision made once, so the board, the era band, the
score chart and every export cannot disagree.

⚠️ **BWF's stand-in for "no photograph" is a photograph.** Rather than an empty avatar it
serves a generic silhouette — `profile_male.jpg` or `profile_female.jpg` — and nine of the
winners across these five boards have one, two of them in the singles files where it had gone
unnoticed. On a singles square that is merely uninformative; on a *pair* it drew the same
blank twice and read as a rendering fault. It is treated as no photograph, so the initials
take over and the half says who it is. Two more winners have a `.tif` avatar, which no
browser renders at all, and get the same treatment. The harvested files still say exactly
what BWF said: whether a URL is worth drawing is a decision about drawing.

⚠️ A half with no photograph **keeps its half of the square**. Dropping it would let the other
photograph slide across and fill the whole square, which would say the pair was one person.

### Following one competitor

**Click a square and the rest recede.** A doubles board is two photographs per square and
several hundred squares, and picking one partnership out of it by eye is genuinely hard.

The same gesture works everywhere a competitor is drawn: a square on the board, a bar in the
eras band, a face on the score chart, a chip in the score's legend. They are the same person
keyed the same way, so they all mean one thing. **Click more to compare them**, click a lit
one again to drop it, or press <kbd>Esc</kbd> to get the whole board back. The pick travels in
the link, so a board with somebody picked out of it can be sent.

⚠️ **What fades is the photographs, not the squares.** Dimming the whole square was the first
implementation and it deletes the board — the square carries the faint ground that draws the
pyramid's silhouette, so the shape of every season went with it. Now twenty grey pyramids
stay standing with the picked faces lit inside them, which says both things at once: who won
this, and how much there was to win. The eras band does the same one level down — the run
keeps its block of colour and its name and face recede.

⚠️ Nothing is ever removed, only dimmed, which is the score chart's own rule: a share means
nothing without the people it was taken from, and the shape of a season means nothing without
the rest of the season.

### Exporting a slice

**Export** takes a range of seasons — the pyramid, the band and all — and draws it to a PNG
at twice the screen's density, with the link and a legend on it. Download it, or **Copy** it
straight to the clipboard where the browser allows that.

**A pick goes into the picture**, because it *is* the picture: an export of a board with one
competitor followed across it is a different claim from an export of the board, and the foot
of the image names who is lit so a reader who gets it in a feed is not looking at an
unexplained dark board. The same rule the score's pins and the compare page's chips follow —
an export draws what is on screen.

It is **drawn from the data, not photographed off the page**. Rasterising the DOM in a
project with no build step means either a library or the `foreignObject` trick — every
stylesheet inlined, every image a data URI — and still comes out at whatever zoom the sender
happened to be on. `poster.js` paints it onto a canvas instead, so an export is the same
size every time and cropped to the seasons that were asked for rather than to the viewport.

Lanes, colours and the shading scale are worked out over the **whole** board and then
cropped, so a poster of 2011–2016 is the picture the sender was looking at rather than a
recoloured one; a run cut by the crop gets a square corner instead of a rounded one, to say
there is more of it off the side.

⚠️ **The photographs need `crossOrigin="anonymous"`.** Measured against the live site: BWF's
image host answers a CORS request and the canvas stays readable, and the very same image
loaded without the attribute draws perfectly and then poisons the canvas — so `toBlob`
throws at the last step and the whole feature is a button that fails. The GitHub avatar is
the opposite case: its URL is a redirect that drops the header, so it is committed to this
repo as `data/avatar.png` and served from our own origin.

### Dominance

Under the pyramid, one bar per **run of consecutive seasons** in which somebody won at least
three of the titles above it — four or five on the picker beside **Eras**, the same shape of
control as the honours board's QF+ / SF+ / F+ / W. Each bar carries the player's face, name
and flag; the totals are on the hover, season by season, rather than printed on the bar.

**One colour per career**, cycled through eight hues in the order the band is sorted — which
is by the season a career opens, so two players share a colour only if eight others opened
between them. A career with two eras keeps one colour for both. The shading *within* a colour
is that season's count, kept deliberately gentle: a wide range turned every season boundary
into a hard edge and a decade read as ten bars.

**The name is `position: sticky`**, so it slides along with the scroll and stays readable for
the whole of a ten-season run rather than only while 2007 is on screen. Repeating it once per
season was the other candidate and is a wall of the same six words. This is why the bar
itself may not clip: an `overflow: hidden` ancestor is a scroll container, and sticky inside
one sticks to a box that never scrolls.

**Bars overlap on purpose, and that is the entire point.** LEE Chong Wei's decade runs
*underneath* LIN Dan's and then CHEN Long's; a chart that named one champion per season would
have drawn three consecutive reigns instead of three simultaneous ones. Lanes are packed
rather than one per player — fifteen women have cleared three titles in a season and the band
is three rows deep — so a lane means only "these two overlapped", and a player with two eras
keeps one lane for both.

⚠️ **Runs are strictly consecutive.** The shelved eras chart, which measures the same thing in
ranking weeks, had to tolerate dips: a rolling 52-week points sum jitters and one week at
sixth would sever a decade. A title count does not jitter, so a dip here is drawn as a gap —
which is why **2020 severs every line on the board**, and why it should.

⚠️ It is also the *opposite* measure from that chart, and for some careers the two disagree
flatly. The ranking rewards entering tournaments and LIN Dan skipped a great many: 14 weeks at
number one to LEE Chong Wei's 310, the other way round from the trophies. Neither is wrong.

### Reading a win

A title is marked **#1** in black, in the grid and on the honours board alike.

⚠️ The result ramp runs from `#1a7f37` for a win to `#3fa34d` for a lost final — one step
apart on the same green, and side by side they are genuinely hard to tell apart. For a
reader with red-green colour vision deficiency the ramp carries almost nothing. The mark is
redundant coding: the same fact said twice, once in colour and once in text, so the board
still reads with the colour ignored entirely.

The mark appears only where the square is at least 16px, because below that two glyphs stop
being a word and start looking like dirt on the square. Every honours row has its own size,
so the Super 300 row and below never carry one — the zoom slider is the way up.

The honours board's zoom will not go below 7 for exactly this reason: a Super 750 square is
`7 × 2.618 = 18.3px`, just clear of the gate. At 6 it is 15.7px and every Super 750 title
silently drops back to being nothing but a darker green.


## The domination score

The Winners page has a second view. **Board** is the pyramid above; **Score** is the same
seasons read as a quantity — one line per career, and the height is how much of that season
they took. It answers the question the board raises and cannot settle: the faces say a name
over and over, and this says how much of the year that name actually was.

**A score of 100 is the whole season** — every title on the board that year, and nobody else
with one. It is a percentage underneath and deliberately not called one: "75% of 2022" invites
"per cent of what?" every single time it is read, and a score out of 100 carries its own
scale. Being a share, one player's rise is always somebody else's fall, and two seasons can be
held against each other however many titles each of them held.

### The ladder, and why it is steep

Not every title counts the same. Each is worth what its rung on the board is worth, and the
rungs step by **φ, the golden ratio — 1.618**:

| | Olympics | Worlds | Tour Finals | Super 1000 | Super 750 |
|---|---|---|---|---|---|
| worth | 6.854 | 4.236 | 2.618 | 1.618 | 1 |

Seven Super 750s to an Olympic gold, which is about the trade anybody who has watched the
sport would make. The rungs come from `honourRung` — the same ladder the photographs on the
board are sized by — so **the score is not a second ranking; it is the board's own ranking,
added up**. All five weights are printed in the page's own note, because a weight nobody can
check is a magic number.

⚠️ **There is no toggle for any of this, and both absences were argued.**

**Counting titles alike** was the other reading and it is gone. It makes an Olympic year look
like a Super 750 year, which is the one thing this project's whole ladder exists to deny.

**A gentler step** was the harder call, and it was settled by measurement rather than taste.
The photographs step by √φ on the *side* of a square, which steps their *area* by φ — both are
"the golden ratio" and they are not the same ladder. Held against the one comparison everybody
already has an opinion about:

| ladder | LEE Chong Wei | LIN Dan |
|---|---|---|
| titles counted alike | 329 | 202 |
| √φ per rung | 313 | 230 |
| **φ per rung** | **285** | **276** |

φ is the reading the eye already has — LCW won more of them, LIN Dan won the big ones — and it
is area that the eye compares on the pyramid. Under it Lin Dan's 2007 is 56.9 against LCW's
best season of 43.4.

A half-step variant, where an Olympic gold is √φ above a world title rather than a full rung,
was built and dropped: it changes **nothing** in three years out of four, and in the fourth it
moves Beijing from 41 to 37 — not worth a second ladder to explain.

⚠️ **The Olympics has always outranked the World Championships here**, 6.854 to 4.236. What
makes them look equal is `pyramidScale`, which draws an Olympic square at the Worlds size and
lets the gold ring carry the difference. That is a decision about a row of faces; it was never
a claim about worth, and `honourRung` — which is what these weights read — has always ranked
them apart.

⚠️ **No era switch here, unlike the Compare page — and none is needed.** That page holds two
careers and the useful question is which vocabulary you want to read *both* of them in. A
whole-board view cannot ask it: this one spans 2007 to 2026 at once, so "call everything
Superseries" is wrong for 2023 and "call everything Super 1000" is wrong for 2013. Each title
is named for **its own season** instead, by the same `pyramidLabel` the board above uses — 2013
reads `12×Superseries` and 2023 reads `6×Super 750`. The ladder in the note keeps the modern
names, because those are the *rungs* rather than any particular title, and a rung has no
season to be named for.

The switch would also be an empty control: it changes no *size* anywhere in this project by
design — `SHARES_RUNG` exists to keep an Olympic square identical in both readings — and the
score is weights over `honourRung`, so every line on the chart would be in exactly the same
place in either era.

### Reading the chart

⚠️ **A player has a point only in the seasons they won something.** There is no column in this
data saying who *entered*, so "nothing in 2013" and "not on the tour in 2013" cannot be told
apart — and a line drawn along the bottom would be asserting the first while knowing only the
second. Runs break at every gap, and somebody who appears in one season stays a single face.

**The marker is the photograph**, ringed in the player's colour. A dot needs a legend and a
face does not, and the whole point of a marker here was that a one-season winner should still
be *someone*. The ring stays because the line has to be traceable between faces, and because a
photograph is not always there — no avatar falls back to a plain dot.

⚠️ **The colours are handed out over the players actually drawn**, not over all forty-four. The
era bands can colour every career from a fixed cycle because two bars of one colour lie far
apart on the page; a line chart draws them through each other, and at one colour per career LEE
Chong Wei, SHI Yu Qi and KIDAMBI Srikanth all came out green. The palette is also its own —
twelve hues walking the colour wheel rather than `REIGN_COLOURS`, which holds two blues and put
Viktor AXELSEN and KIDAMBI Srikanth in near-identical shades a season apart.

⚠️ **The y-axis never moves under the reader.** It is scaled to the best season in *either*
draw. Fitted to what was on screen it rescaled every time a name was clicked — so isolating
somebody made their line climb the page, which is the chart lying about the one thing it was
asked to show — and the men's and women's boards came out at two different heights, so
switching between them compared two pictures at two scales.

⚠️ **Clicking a name dims the rest; it does not remove them.** Drawing only the pinned player
re-ran the palette over a set of one, so the act of picking somebody out *changed their
colour* — and it threw away the context that makes a share chart worth reading at all, which
is who else was in the season. Clicking a second name adds to the selection, and the legend
keeps every name the bar admits: off is a state, not an absence.

**The face on the chart does what the chip below it does.** A marker here *is* a name with a
season attached, so clicking one pins that competitor exactly as clicking their legend chip
would — the reader who has just hovered a face to find out whose line it is should not then
have to go and find the same face again in a list of twenty. `Esc` clears the lot, on this
view and on the board.

### Seasons with a hole in them

An asterisk on the axis marks a season with far fewer titles than the ones around it, so a
score built on one is built on less. **2020** stopped in March; **2022** ran eight of these
against a normal twelve to fifteen, with not one tournament held in China and the Finals moved
out of Guangzhou; and the last year is **ongoing**. Each marked year gets a faint column with
the reason written at its foot, inside the plot, where the line does something strange rather
than in a caption. A leg touching one is **dashed**: a solid line across 2020 asserts a trend
through a year that was barely played.

⚠️ **Short is two thirds of the median, not a fixed count.** The calendar has held fifteen of
these titles and it has held eight, so "fewer than six" means one thing in 2013 and another in
2022 — and the fixed rule called 2022 a normal season while the axis above it said otherwise.

⚠️ **The tables under the chart dim those rows rather than colouring them.** They were amber,
which is this palette's attention colour, so the one season nobody should read at face value
was the brightest line in the table and Anders ANTONSEN's two titles out of three looked like
the find of the chart. A footnote should recede. The mark stays lit, because a mark is a
pointer and not a highlight.

**Under the axis, a bar per season with its title count on it** — the denominator, drawn. A
score is a fraction and the line only shows the numerator; without this, 66.7 in 2020 and 66.7
in 2015 are the same height on the page and one of them is two matches. The count is on
*every* bar, not only the short ones: it was the short seasons' badge, which made a count look
like a warning.

### The clutter bar

**Show** draws everybody whose best season clears it. Forty-four careers on one chart is a
scribble, so the default hides most of them — but it must not hide the person who actually
dominated a year. The rule: take every **finished** season, find who led it, note that
player's best year anywhere, and put the bar as high as it will go without dropping one of
them. It comes out at 40 for the men and 20 for the women, and it stops being derived the
moment the reader touches the slider.

⚠️⚠️ This asked the wrong question until it was looked at: *"is anybody on screen in every
season"*, which any visible player satisfies by winning one thing. The women's bar came out at
35 on a rule meant to hold the leaders, and CHEN Yu Fei — who led 2019 and scored 33 in 2023 —
was not drawn at all. And it is the leader's **peak** that has to clear the bar, not their
score that season, because the bar filters on a career's best year.

⚠️ Covering the top **two** of each season looked safer and collapses: some season's runner-up
is always somebody whose whole career peaks at 10, so the bar falls to 10 and twenty-three
lines come back. Measured on both draws, not guessed.

⚠️ **The season being played is left out of that sum.** In January it is one tournament and one
winner; a part-played season cannot say who led it, so it is not asked — without this the bar
collapses every New Year.

### Dominators: the same scores, ranked

The chart says who dominated **and when**. The table under it says who dominated, full stop —
and there is more than one honest way to answer that, so **both are always on screen and only
the sort moves**.

**Total** is every season's share added up. It rewards staying there: LEE Chong Wei never took
44 of a season and took some of twelve of them, which is a claim about a career that no single
season can make. He is second in the men's singles on the sixth-best peak on the board.

**Peak** is the best single season. It rewards the year nobody else got a look in: KIM / SEO
took 76 of 2025 and appear in two seasons, so they are **first on peak and eighth on total**.

The two orderings disagree, and the disagreement is the point. A table that showed one column
at a time would have hidden it, so both numbers are on every row and the sorted column is
marked rather than moved.

⚠️ **There is deliberately no average**, and the reason is the same one that makes the lines
above break at a gap. This data says who *won*, not who *entered*, so a competitor has a point
only in the seasons they won something — the seasons they played and won nothing are missing
from the divisor rather than sitting in it as zeroes. One good year and nothing else would
out-rank a fifteen-year career, and the number would be describing the hole in the data rather
than the players. A third column that cannot be computed honestly is worse than no third
column.

⚠️ **The pandemic seasons are set aside by default**, and the `2020–22` chip puts them
back. Left in, they put Viktor AXELSEN top of *both* orderings on **184 of his 315 points**,
and TAI Tzu Ying top of the women's peak on an 81 taken in a season that held three titles.
Set aside, the men's singles reads LEE Chong Wei, LIN Dan, CHEN Long — the answer most people
would give, now given by the arithmetic. It is a judgement, so it is a chip rather than a
silent rule, and the seasons stay on the chart either way.

⚠⚠ **Which seasons, and why on participation rather than on the calendar.** A domination
score is a *share*, so what flatters a winner is not where the tour went — it is a thinner
field. If a third of the best players are not competing, everybody else's share of the season
is larger and they did nothing to earn the difference. So the test is who was actually in the
draw. Distinct players in the opening rounds of every event on this board, and how many were
Chinese:

| 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 |
|---|---|---|---|---|---|---|---|
| 12.3% | 14.7% | split | **2.3%** | **9.9%** | 13.3% | 14.1% | 12.6% |

**2021 is the season a count of titles cannot see.** It held ten of these titles, the same as
2018 and 2019, and it ran almost entirely without China: **eight of its eleven events had
literally nobody** — both Thailand Opens, the All England, the French, both Indonesia events
and both World Tour Finals. Only the Olympics, the Denmark Open and the Worlds had any.

**2020 is split by the shutdown.** Three titles. The All England on 11 March was 16.1% Chinese,
an ordinary field played days before everything stopped; the October Denmark Open had none, and
neither did the Finals, played in January 2021.

**2022 is the weakest case and is in on a judgement.** China was present at every event and
reduced rather than absent — 9.9% against a 12–15 baseline. What it also has is a calendar cut
to eight events from twelve, the Asian swing gone bar Indonesia, Malaysia and Japan, and the
Finals moved out of Guangzhou. The chip is there to disagree with.

**2018 and 2019 hold ten titles as well and are deliberately not in the set** — that is the
World Tour restructure, a change to the ladder rather than to whether the season was played,
and their fields are normal.

⚠️ An earlier version of this argued from **which countries hosted**: no Chinese event in
2020–22, both back in 2023. True, and the wrong test — hosting is not competing. 2022 hosted
nothing and had Chinese players at all eight of its tournaments; 2021's Thailand Opens were
held in Bangkok with none.

⚠⚠ **The season being played is weighed against the whole year.** A share of the titles
played *so far* makes whoever wins the first tournament of January a 100, and in September
2026 it inflated every score on the board by half again — eight of the twelve played, 13.71 of
19.33 by weight. Against the planned year the numerator only grows while the denominator
stands still, so a part-played season is a **lower bound** on what it will finish at: it
cannot overstate a total, and a peak, being a maximum, cannot be dragged down by it. That is
the property that makes the running year safe to count at all, and it is why it does count.
The strip under the axis reads **8/12** rather than 8 so the reader can see it, and the
column adds up to less than a whole season on purpose — the titles still to come belong to
nobody yet.

⚠️ **Finished seasons keep the titles actually played.** 2020's denominator is the three
that happened, not the nine still on the calendar when it was abandoned. Weighing a cancelled
season against its plan would rank everybody as having failed to win events that never took
place.

⚠️ The calendar is **harvested into the same static file**, by `tools/harvest-calendar.mjs` —
one call per season, seconds rather than minutes. Not a live call: the score view reads one
file and must keep doing so, or the numbers would depend on whether a request succeeded. It
is the one thing in these files that goes stale, and it can be topped up on its own.

⚠️ **The Show bar still leaves the running season out of its derivation**, and that survives
the better denominator: the bar is set from *who led each season*, and nobody has led a season
that is still being played, however fairly it is weighed.

⚠️ **The Show bar does not reach this table**, and that is not an oversight. The bar filters on
*peak*, so a total ranking cut by it is a different claim: at the men's singles default of 40
it would leave seven names, and it drops BOE / MOGENSEN — eight seasons, seventh on total —
for a best season of 25.5. The bar declutters the chart; the ranking is the whole board. The
top twenty are shown, and one click shows every competitor.

⚠️ Clicking a row picks that competitor everywhere, like clicking a square or a marker or a
chip. **And if the bar was hiding them, the bar comes down to fit** — the table lists everybody
and the chart does not, so a reader who clicks a name in a ranking and gets nothing on the
chart has been told a half-truth. The chart also now ignores a pick it cannot draw rather than
fading every line at once, which is what a link naming somebody below the bar used to do.


### Exporting the score

The same picker, the same range, the same foot as the board's export — only the drawing
differs, so `drawScorePoster()` sits beside `drawPoster()` in `poster.js` and the two share
`POSTER`, the 16384px density guard and the provenance strip at the bottom. The file is named
`badminton-score-<draw>-<from>-<to>.png`, so the two exports never collide in a downloads
folder.

The bar you set and the names you pinned go into the picture, because those are what it is
*about*. ⚠️ **Cropping changes what is shown and never what is counted**: a score is a share of
its own season, so the numbers, the colours and the height of the axis are all settled over the
whole board and then cut to the years asked for. Same rule as the era bars, same reason — an
export of 2011–2016 that recoloured CHEN Long because LEE Chong Wei fell off the left would not
be the picture the sender was looking at.

⚠️ The axis height is **handed in by the page**, because the page scales it across both draws
and `poster.js` is given one file. Without that a men's export and a women's export of the same
seasons come back at two different scales — the bug the page itself already fixed once.

### Why it is a view and not a section

The board and the score answer the same question two ways, which is the split the Compare page
already makes between its grid and its honours board — one pattern to learn rather than two.

⚠️ And this page has a reason of its own: **the pyramid is twenty columns that scroll sideways
and the chart is one fixed-width picture.** Stacked, the reader would be dragging one of them
against the other and the years could never line up.


## Comparing across the eras

LIN Dan and LEE Chong Wei played almost entirely before the World Tour existed, and BWF ships
no name for its pre-2018 tournament categories — so their careers used to arrive as one
undifferentiated "Unmapped" heap with nothing to compare against.

The four old senior tiers are now placed on the modern ladder: **Superseries Premier** as
Super 1000, **Superseries** as Super 750, **Grand Prix Gold** as Super 300 and **Grand Prix**
as Super 100. That is not a guess — `tournament_series_id` survives an edition, so a series
can be followed across the 2018 boundary to see what each old tier actually turned into.

Mapped squares carry a **notch cut out of one corner**, and hovering one says what it really
was. The Seasons page never translates: there a Superseries Premier is called a Superseries
Premier. Two honest edges, both noted under the board — nothing maps to Super 500, because
there were four old tiers and there are five new ones; and before 2011 there was no Premier
tier at all, so a 2008 All England sits a rung below a 2013 one.

### Reading it the other way round

That is the right default and the wrong one for the comparison people actually come here to
make. In World Tour names, *every* square on a LIN Dan / LEE Chong Wei board is a translation
into a structure neither of them ever played in — 116 of Lee Chong Wei's 140 results are
notched.

So the **World Tour / Superseries** switch on the compare page names the ladder in either
vocabulary, on both the grid and the honours board. Nothing about a result changes: rows keep
their sizes, so the two readings are two readings of one board. Only the row names change,
and which squares are the translated ones — in Superseries names the notch moves to the
modern results, and Lee Chong Wei's board drops from 116 marked squares to 4.

| rung | World Tour | Superseries era |
|---|---|---|
| Olympics · Worlds · Continental | unchanged | unchanged |
| Tour Finals | Tour Finals | **Superseries Finals** |
| ▸ | Super 1000 | Superseries Premier |
| ▸ | Super 750 | Superseries |
| ▸ | Super 500 | *— folded up into Superseries —* |
| ▸ | Super 300 | Grand Prix Gold |
| ▸ | Super 100 | Grand Prix |

⚠️ **Backwards is not the same map forwards.** Following the same series across 2018 in the
other direction, the Super 1000 is unanimously the old Premier (4 of 4) and the Super 300 is
the Grand Prix Gold (8 of 9) — but the **Super 500 splits 4–3** between Grand Prix Gold and
Superseries. That is not missing evidence, it is evidence of a split: 2018 was not a
renaming, and one Grand Prix Gold became *both* a Super 500 and a Super 300.

A Super 500 is therefore folded **upward into the Superseries** and drawn one rung higher
than it was. It is the one thing this reading gets wrong, it is not a corner case — ten of
Lin Dan's results are Super 500s — and it is not hidden: those squares carry the notch like
any other translation, and the Super 500's rung is left standing empty rather than closed up,
so the double size step between Superseries and Grand Prix Gold is the gap where a tier used
to not be.

The era travels in the link (`er=ss`), because a board sent in Superseries names is not the
same board in World Tour names.

## What BWF's records can and cannot say

Two things shape every count in this tool, and both are BWF's rather than ours.

**The tool starts in 2006, because that is where BWF's results start.** Their player endpoint
happily returns 2000–2004 — 94 tournaments for Lee Chong Wei, 79 for Lin Dan — with **no
result on a single one of them**. The 2004 All England is in there with nothing beside it.
2005 is about half filled in; 2006 is complete. So comparing two careers against a third-party
site will not tally: measured against BWF's own data, Lee Chong Wei has 62 individual titles
and Lin Dan 52, where sites with a fuller source say 69 each. The missing ones are all in that
2000–2004 blank, and they are not evenly split — which is most of why Lee Chong Wei looks so
far ahead here on Superseries titles and level overall elsewhere.

⚠⚠ **Before 2007 there was no ladder, which is why Unmapped exists.** The Superseries began
that season; until then the circuit was the IBF World Grand Prix, and it graded its events
**6-star down to 1-star by prize money alone**. The money was not the prestige — the 2006 All
England was a **4-star** on $125,000, two rungs under the China Masters at $250,000, and the
same year's Macau Open paid $30,000. Nothing turns a purse into a tier, so pre-2007 titles are
shown together in one section that admits its placing is a guess, and the Winners board does
not draw them at all. Sizing them by what they paid would put an All England below a China
Masters, which is worse than not sizing them.

⚠️ **And the category id carries no tier information there either.** In 2006 the World
Championships, the All England and an International Series are all category **6** — and across
six careers of that era, **77 of 85** pre-2007 tournaments carry that one id, from a world
championship down to a $3,000 satellite. Reading those ids as tiers threw away seven of Lin
Dan's ten 2006 tournaments, an All England title among them, so nothing is read off an id
before 2007: the majors are rescued by name as they always were, and everything else goes to
Unmapped. The ids *below* the World Tour are not
believed until 2008 either, because BWF was still filing Grand Prix events as category 6
through 2007 — which cost exactly one title each, Lin Dan's German Open and Lee Chong Wei's
Philippines Open.

## The regional games

The Asian, Commonwealth, European, Pan American and African Games get a block of their own,
sized with the Continentals. They are individual titles and they belong on a career.

They have to be recognised **by name**, because their id is worthless in every direction: the
Asian Games has arrived as category 1, 16, 74 and with no category at all, and the 2023
European Games under 11 — the Continental Championships' own id. An id-first rule draws one
European Games as a Continental and the next as Unmapped.

The **team** editions stay out, as every team event does. BWF ships them as separate
tournaments under near-identical names — "Asian Games 2018 (Team Event)" beside "Asian Games
2018 ( Individual Event)", *both category 16* — and they are told apart by their draws, which
a tie names bare because the tie is the competitor.

Sub-regional games — East Asian, Mediterranean, SEA — are not in this block. Each is a slice
of one continent, and a row holding both an East Asian Games title and an Asian Games title
says neither.

⚠️ The **Winners pyramid** still excludes all of them, and that is not an inconsistency. The
pyramid asks which titles mattered most in a season across the whole sport, and counting any
regional games there picks a region. A career asks what this player won, and Lin Dan really
did win two Asian Games.

## Searching for a player

Type two letters and the list appears in the same tick, before anything is asked of BWF.
It is matched against the **top 50 of all five ranking tables** — 377 players — held in
memory and refreshed twice a day, plus everybody you have opened before. BWF is then asked
on the usual delay and its answer merged in underneath.

That is not only about speed. **BWF's own search is alphabetical, not relevant**: it returns
page one of a list ordered by given name. Measured 3 September 2026:

| you type | where BWF puts the obvious answer |
|---|---|
| `viktor` | Viktor AXELSEN at **index 13** of 30 |
| `axelsen` | Rikke AXELSEN above him |
| `chen` | CHEN Yu Fei **not in the answer at all** |
| `an` | AN Se Young **not in the answer at all** |

The reigning world number ones, absent from their own names. No amount of re-sorting the
reply fixes that, because they are not in it.

Names match **word by word, in any order**, because the same player is stored both ways
round — the ranking tables say `AN Se Young` and the search endpoint says `Se Young AN`, and
a reader may type either. So `se young`, `an se young` and `se young an` all find her, and
`shi qi` finds SHI Yu Qi.

⚠️ **The roster can never replace the search, only precede it.** Lin Dan and Lee Chong Wei
are retired and in no ranking table, and they are the comparison this whole tool was built
for; Viktor Axelsen has been out injured and is not in the top 50 either. When nothing local
matches, the box says **Searching…** rather than sitting empty — which is what it used to do
for up to ten seconds.

Ten seconds because the search rode the **low** request lane, behind every draw ladder the
career on screen was still fetching, at 320 ms apiece. It is now on the fast lane: the same
uncached search during a career load went from **10.5 s to 0.76 s**.

## Who you start on

With nobody in the link, the app opens on the **world number one in men's singles** — looked
up, not hardcoded, so it is whoever holds it today. An empty strip is a worse first
impression than anybody's.

## The keyboard

Every shortcut drives a control that is already on the page — a faster route through it,
never a hidden feature — and each page's own keys are printed under its notes.

| | |
|---|---|
| <kbd>←</kbd> <kbd>→</kbd> | move between Seasons, Compare, Tournament and Winners (wrapping) |
| **Seasons** | <kbd>↑</kbd> <kbd>↓</kbd> the level chips — up adds the highest that is off, down drops the lowest that is on |
| **Compare** | <kbd>G</kbd> grid · <kbd>H</kbd> honours · <kbd>W</kbd> World Tour names · <kbd>S</kbd> Superseries names |
| **Compare** | <kbd>↑</kbd> <kbd>↓</kbd> the QF+ / SF+ / F+ / W bar on the honours board, and the level chips on the grid |
| **Tournament** | <kbd>O</kbd> order of play · <kbd>B</kbd> bracket · <kbd>S</kbd> starred only |
| **Tournament** | <kbd>↑</kbd> <kbd>↓</kbd> the day, or — in the bracket — how much of the draw |
| **Tournament** | <kbd>M</kbd> <kbd>W</kbd> <kbd>X</kbd> the discipline; press again for that gender's doubles |
| **Winners** | <kbd>B</kbd> board · <kbd>S</kbd> score · <kbd>E</kbd> the dominance band |
| **Winners** | <kbd>M</kbd> <kbd>W</kbd> <kbd>X</kbd> the discipline; press again for that gender's doubles |
| **Winners** | <kbd>↑</kbd> <kbd>↓</kbd> the 3+ / 4+ / 5+ bar while the band is on — or, on the score, the **Show** bar |

Six things about this are deliberate.

**Nothing fires while a modifier is held.** <kbd>Alt</kbd>+arrow is the browser's Back and
Forward, <kbd>Ctrl</kbd>+O opens a file, <kbd>Ctrl</kbd>+S saves the page and
<kbd>Ctrl</kbd>+W closes the tab — every one collides with a key above. A modified
keystroke is not handled *and not prevented*: it goes straight through to the browser.

**Where a page has nothing to step, the arrows are left alone.** They are not merely inert
there — they are not `preventDefault`ed, so the browser still scrolls with them. A shortcut
that swallows a key without doing anything is worse than no shortcut. That now applies only
to a page with no chips and no bar on it at all: before anybody is searched for, the Seasons
page has no level chips, so its arrows still scroll.

**Nothing fires while you are typing**, which matters more than it sounds, because the app
focuses the search box on load — so on a fresh page every letter would land in the box
rather than reaching the page. <kbd>Esc</kbd> leaves the box, and is therefore the way in.

**<kbd>↑</kbd> <kbd>↓</kbd> mean "show me more" everywhere they do anything.** One more round
on the honours board, one more level on the Seasons strip and the career grid, one more line
on the domination score, one more day at a tournament. What differs is what each page has to
give; the direction never does.

On the level chips that is **up adds the highest that is off, down drops the lowest that is
on**. Not "the next one along from wherever you last were": a row of chips has no cursor, and
a key that depended on one would do different things depending on what had been clicked. From
the ends the two keys are exact inverses — every press of down is undone by a press of up —
and it walks the ladder the way somebody narrowing a career actually thinks: *drop the small
ones, keep the big ones.* The order walked is the order **on screen**, so what the key will do
is visible before it is pressed; and the keys reach only the chips the page has drawn, never
the tail of unmapped ids behind the Seasons page's "N more" menu — switching one of those on
would change the strip with nothing on screen moving to explain it.

**The cost is the page scroller**, and it is now paid on every page rather than only on the
tournament one. The wheel, the scrollbar, <kbd>PgUp</kbd>/<kbd>PgDn</kbd>,
<kbd>Home</kbd>/<kbd>End</kbd> and the space bar all still scroll, and a career strip is long
enough that this is a real trade. It is worth it because the arrows are the only keys that
can be *held*: narrowing a fourteen-level strip to the four that matter is four taps of one
key rather than four aimed clicks. <kbd>←</kbd> <kbd>→</kbd> are taken everywhere, which costs
the horizontal scroll of the compare grid and the unfolded bracket to the arrows alone.

**One letter, two draws, two kinds of control.** <kbd>M</kbd> means "show me the men's
singles" in both tournament views, though they hold the discipline differently: the bracket
*picks* one draw, while the order of play *filters* several, any number of which can be on
at once. So in the bracket it picks, and in the order of play it isolates — hides the rest —
and pressing the same letter again moves to that gender's doubles. Clicking the chips undoes
any of it. Stepping the day and the fold **clamps** rather than wraps, unlike the pages:
four pages in a ring beat two dead ends, but the last day of a tournament is the last day.

The Winners page borrows the same double-tap rather than inventing anything: five draws will
not fit five letters anybody would guess, and a reader who has learned it on one page has
learned it on the other. There it simply picks the board, since a board is only ever about
one discipline.

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

## The harvested files

`data/winners-<draw>.json` — one per discipline, all five — is not fetched from BWF at page load.
The app is player-centric — every endpoint it uses is keyed on a player id — and "who won
this tournament" is the opposite question, so it takes a call per tournament per season.
None of it changes once a final has been played, so it happens once, offline, and the result
is committed.

```
node tools/harvest-winners.mjs                 men's singles, 2007..now
node tools/harvest-winners.mjs --draw 2        women's singles
node tools/harvest-winners.mjs --draw 3        men's doubles (4 women's, 5 mixed)
node tools/harvest-winners.mjs --from 2015     a shorter run
```

It resumes from whatever is already on disk and writes one file per discipline, so a
re-run only fetches the seasons that are not there.

```sh
node tools/audit-winners.mjs           # what is missing, per discipline
node tools/audit-winners.mjs --drop    # delete the short seasons, then re-harvest
```

⚠️ **Counting titles per season does not tell you whether the harvest is complete.** A season
that is one short looks exactly like a season that is one short somewhere else, and a missing
Olympic gold is one row in a file of 242. The audit compares the **union of tournament ids**
across the five files: every draw plays the same calendar, so a tournament in one file and
not another is a hole in the other. That is how four of five Olympic golds were found missing
from the doubles boards, and how a 2010 Super Series title was found missing from all five.
Its blind spot is stated on the tin: a tournament missing from *every* file cannot be seen.

⚠️ **The obvious endpoint is the wrong one.** `vue-tournament-draw-data` returns the whole
draw and looks like the answer, but it is 256–407 KB per tournament and **returns HTTP 500
for some of them** — including the Paris 2024 Olympics. `tournaments/day-matches` asked for
the tournament's *last day* is 7–14 KB, answers for those too, and carries the winner's
photograph. Draw data is kept only as a fallback.

## Tools

```sh
node tools/discover.mjs [url…]   # what endpoints does BWF's own frontend call?
node tools/shot.mjs [#hash…]     # screenshot the strip, from fixtures
node tools/probe-draws.mjs       # what tournaments/draws returns per format
node tools/probe-draw.mjs        # which drawId each discipline actually has
node tools/probe-bracket.mjs     # the fold table, and the geometry, against live draws
node tools/audit-winners.mjs     # is the winners harvest complete? (--drop to re-fetch)
```

`discover.mjs` captures the API requests a BWF page makes and scans its JS bundles for
endpoint literals. It is how Parts 3.2 and 3.5 of `HANDOVER.md` were found.

`shot.mjs` renders the app against the recorded fixtures and writes PNGs to
`tests/shots/`, so a change to the strip can be looked at rather than only asserted. Its
defaults cover a singles career, a doubles one, the grid and a two-player comparison; any
`#hash` works, and one carrying `g=1` is captured at the width the compare page needs.
`--top` clips to the chrome — nav, hero, page header — at a scale you can read.

`probe-draw.mjs` lists the draws at the three tournaments the schedule names and prints the
`drawId` BWF gives each one — the measurement behind Part 3.4k, and the way to re-check it
if a bracket ever opens on the wrong discipline. `probe-bracket.mjs` goes further: it runs
the real layout over real draws and reports, per fold, the card and segment counts, the
canvas size, and the worst deviation of any card from the midpoint of the two that feed it.

`probe-draws.mjs` reports the stage layout `tournaments/draws` returns for a knockout, a
draw with qualifying, a group stage and a team event — the shapes the ladder has to handle.

## Etiquette

Non-negotiable, and enforced in `api.js` rather than by convention:

- every request serialised through one queue with a ~320ms gap
- a 5-minute cache, 12 hours for ranking data
- never poll faster than ~30s, even for live scores
- credit BWF visibly, link back to their tournament pages, carry no BWF logo, and say
  plainly that this is unofficial
