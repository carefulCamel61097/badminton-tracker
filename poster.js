/* A slice of the Winners page, drawn onto a canvas so it can be saved or pasted.
 *
 * ⚠️ **Drawn from the model, not scraped off the page.** The obvious way to do
 * this is to rasterise the DOM, and in a project with no build step that means
 * either a library or the `foreignObject` trick — which needs every stylesheet
 * inlined, every image turned into a data URI, and still comes out at whatever
 * zoom the reader happened to be on. Drawing it here is more code and gives an
 * export that is the same size every time, at twice the pixel density, and
 * cropped to the seasons that were asked for rather than to the viewport.
 *
 * ⚠️ **The photographs need `crossOrigin = 'anonymous'`.** Measured against the
 * live site: BWF's image host answers a CORS request and the canvas stays
 * readable; without the attribute the very same image loads and then poisons
 * the canvas, so `toBlob` throws `SecurityError` and the export silently fails
 * at the last step. The GitHub avatar is the other way round — its URL is a
 * redirect that drops the header — which is why it is committed to this repo
 * and served from our own origin instead.
 */
import {
  winnersSeasons, pyramidSeason, pyramidRowWidth, pyramidScale,
  pyramidReigns, reignLanes, reignStep,
  dominationSeasons, thinSeasons, shortSeasonWhy, covidMode, isCovidSeason,
  gridSections, sectionCells, gridYears, careerHonours, honourSections, honourStep,
} from './model.js';

/* ============================ the shared palette ============================

   ⚠️ These are also in `styles.css`, because the page paints with CSS and the
   export paints with canvas and there is no way to hand one to the other
   without a build step. The suite reads the computed colour off a drawn tile
   and compares it to the constant here, so the two cannot drift apart quietly.
   ==================================================================== */

/* The ring around a tile — **only the two summit tiers have one.**
 *
 * ⚠️ There used to be one per tier, in the export and in the stylesheet, and on
 * the page not one of them was ever visible: they were `inset` box-shadows, and
 * an inset shadow paints behind the element's content, which here is a
 * photograph filling the tile. They showed for the instant before the images
 * loaded and then vanished — so the export drew a set of rings the page did not
 * have, and the check that held the two tables against each other passed
 * happily because it was comparing declarations rather than pixels.
 *
 * The Olympics and the Worlds are the same size and share a row, so a ring is
 * the only thing that can separate them — and only **one** of them needs it.
 * Ringing both made the pair read as equals with two liveries; worse, the white
 * one is the brighter of the two against a dark ground, so the world champion
 * came out looking like the bigger prize. One square is marked out and the other
 * is the plain case. Every other tier says its rank by size, which is what the
 * whole page is built on. */
export const TIER_RING = {
  OLY: { colour: '#ffd24a', width: 2 },
};

/* One colour per player, cycled.
 *
 * ⚠️ Not the green a title is drawn in everywhere else. A bar is not about
 * *what* was won, it is about *who* — and a band in one colour makes two people
 * who overlapped read as one long reign with a step in it. Eight hues, assigned
 * in the order the band is sorted, which is by the season a career opens: two
 * players share a colour only if eight others opened between them.
 *
 * ⚠️ The BWF red and the live-match teal are deliberately absent. Both mean
 * something specific elsewhere in this app and a player who happened to be
 * eighth should not borrow it. */
export const REIGN_COLOURS = [
  '#4f9dff', '#f2994a', '#c77dff', '#57c98a',
  '#ff6b8b', '#f6d34a', '#7fd4d0', '#a3a3ff',
];

/* One colour per line on the domination chart. The same idea as the bars above
 * and not the same list, for two reasons that only apply to a chart.
 *
 * ⚠️ **Adjacent entries have to be unconfusable.** `REIGN_COLOURS` holds
 * `#4f9dff` and `#a3a3ff`, two blues, which is fine for bars lying in different
 * parts of a page and is not fine on a line chart: careers that open in
 * neighbouring seasons are exactly the ones drawn through each other, and it put
 * Viktor AXELSEN and KIDAMBI Srikanth in near-identical blue a season apart. This
 * list walks the colour wheel instead of the band's palette.
 *
 * ⚠️ **Twelve rather than eight**, because a chart draws a dozen careers at once
 * where the band gives each one a lane of its own. */
export const SCORE_COLOURS = [
  '#4f9dff', '#f2994a', '#57c98a', '#ff6b8b',
  '#f6d34a', '#c77dff', '#12b5a5', '#e8734a',
  '#8ad35b', '#ff9ad5', '#d4b483', '#7fd4d0',
];

/* The two summit marks, as SVG path data.
 *
 * ⚠️ One source for both renderers: `app.js` drops these into an inline `<svg>`
 * and this file hands the same strings to `Path2D`, which speaks the same path
 * grammar. Redrawing the trophy in canvas primitives was the alternative and
 * would have been a second trophy to keep in step with the first. */
export const CUP_PATHS = [
  'M7 3h10v6a5 5 0 0 1-10 0V3z',
  'M7 5H4v1.5A3.5 3.5 0 0 0 7.5 10',
  'M17 5h3v1.5A3.5 3.5 0 0 1 16.5 10',
  'M12 14v3',
  'M8.5 21h7l-.8-4h-5.4z',
];
export const CUP_BOX = 24;

/** The five rings, as centres in a 104×54 box with r=15 and a 5-wide stroke. */
export const RING_AT = [[17, 17], [52, 17], [87, 17], [34.5, 34], [69.5, 34]];
export const RING_COLOURS = ['#0081c8', '#e8e8e8', '#ee334e', '#fcb131', '#00a651'];
export const RING_BOX = [104, 54];

/* ============================ the geometry ============================

   Deliberately its own set of numbers rather than the page's zoom. An export is
   a thing somebody else will look at once, at whatever size their feed gives
   it, so it is drawn at a size that reads rather than at the size the sender
   happened to have the slider on.
   ==================================================================== */

export const POSTER = {
  /* ⚠️ The base of the **whole** honours ladder, not the size of a square on
     this page — `honourScale` is measured from the Super 100 rung, and the
     smallest tier the pyramid draws is already 2.62 times that. Set to 30 on
     the first attempt, on the assumption it was a tile size, and six seasons
     came out 3935px wide. 13 puts a Superseries face at 34px and a world
     champion's at 70, which is what the page's own default zoom gives. */
  unit: 13,
  tileGap: 4,
  rowGap: 5,
  colGap: 12,
  colPad: 8,
  pad: 34,
  laneH: 30,
  laneGap: 5,
  headH: 46,
  /* A floor only — the real one is worked out per poster from how many legend
     lines it needs. See `posterLayout`. */
  footH: 54,
  yearH: 26,
  scale: 2,          // device pixels per CSS pixel
  bg: '#1a1a1a',
  ink: '#f2f2f2',
  dim: '#9a9a9a',
};

const KIND_NAME = { MS: 'Men’s singles', WS: 'Women’s singles' };

/** Where this thing came from, printed on every export. */
export const POSTER_LINK = 'carefulcamel61097.github.io/badminton-tracker';
export const POSTER_AVATAR = 'data/avatar.png';

/**
 * Load an image, or resolve to null.
 *
 * ⚠️ Never rejects. One dead photograph must not cost the whole export — the
 * tile falls back to initials, exactly as it does on the page.
 */
function loadImage(src, cors) {
  return new Promise(resolve => {
    if (!src) return resolve(null);
    const im = new Image();
    if (cors) im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

/** The initials the page falls back to when BWF has no photograph. */
function initialsOf(name) {
  return String(name || '?').replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/)
    .map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

/** How wide a mark beside a photograph is drawn, with a floor for small zooms. */
export function badgeWidth(side) {
  return Math.max(15, Math.round(side * 0.5));
}

/**
 * A tile's square, and the space a mark beside it claims on either side.
 *
 * `w` is what the row layout measures; the photograph is drawn `pad` in from
 * the slot's left, so it lands in the middle of the slot whether or not it has
 * a badge.
 */
export function tileSlot(t) {
  const side = Math.round(t.scale * POSTER.unit);
  const badged = String(t.tier) === 'OLY' || String(t.tier) === '20';
  const pad = badged ? badgeWidth(side) + 3 : 0;
  return { side, pad, w: side + pad * 2 };
}

function roundRect(ctx, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

/**
 * A photograph cropped the way the page crops it.
 *
 * ⚠️ `object-fit: cover; object-position: top center` — the top, not the
 * middle. BWF's thumbnails are head-and-shoulders and a centred crop takes the
 * chin off half the board.
 */
function drawCover(ctx, im, x, y, side) {
  drawCoverRect(ctx, im, x, y, side, side);
}

/** The same crop into a box of any shape — what a split square needs. */
function drawCoverRect(ctx, im, x, y, w, h) {
  const k = Math.max(w / im.naturalWidth, h / im.naturalHeight);
  const sw = w / k, sh = h / k;
  ctx.drawImage(im, (im.naturalWidth - sw) / 2, 0, sw, sh, x, y, w, h);
}

/**
 * A competitor's photograph, or **a pair's, split down the middle**.
 *
 * ⚠️ Each half is the *central band* of its photograph, not its left or right
 * side: `drawCoverRect` into a box half as wide as it is tall scales on height
 * and crops the sides, which is exactly what `object-fit: cover` gives the page.
 * One rule, two renderers, so an exported pair looks like the one on screen.
 *
 * ⚠️ Vertically it is top-aligned, like every other face in this file — BWF's
 * thumbnails are head-and-shoulders and a centred crop takes the chin off.
 */
function drawWinnerFaces(ctx, who, x, y, w, h, faces) {
  /* ⚠️ Positional, not filtered: a pair with one photograph between them keeps
     the missing half in its half and gets initials there, rather than letting
     the other photograph slide across and fill the square. */
  const people = (who && who.people) || [who].filter(Boolean);
  const urls = (who && who.faces) || [who && who.a];
  const n = Math.max(1, people.length || urls.length);
  const cw = w / n;
  for (let i = 0; i < n; i++) {
    const im = urls[i] ? faces.get(urls[i]) : null;
    const cx = x + i * cw;
    if (im) { drawCoverRect(ctx, im, cx, y, cw, h); continue; }
    // No photograph: the initials, exactly as the page falls back to them.
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    ctx.fillRect(cx, y, cw, h);
    ctx.fillStyle = '#9a9a9a';
    ctx.font = `700 ${Math.max(7, Math.round(Math.min(cw, h) * 0.4))}px `
      + '"Segoe UI", Roboto, sans-serif';
    const ini = initialsOf(people[i] && people[i].n);
    ctx.fillText(ini, cx + (cw - ctx.measureText(ini).width) / 2, y + h / 2 + h * 0.12);
  }
  /* The seam, so a pair reads as two people rather than one odd photograph. */
  if (n > 1) {
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    for (let i = 1; i < n; i++) ctx.fillRect(x + i * cw - 0.5, y, 1, h);
  }
}

function drawRings(ctx, x, y, w) {
  const k = w / RING_BOX[0];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.lineWidth = 5;
  RING_AT.forEach(([cx, cy], i) => {
    ctx.strokeStyle = RING_COLOURS[i];
    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.restore();
}

function drawCup(ctx, x, y, w) {
  const k = w / CUP_BOX;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.strokeStyle = '#e8e8e8';
  ctx.lineWidth = 2.1;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const d of CUP_PATHS) ctx.stroke(new Path2D(d));
  ctx.restore();
}

/**
 * Lay a slice of the board out, in CSS pixels, without drawing anything.
 *
 * Separate from the drawing so the suite can check where things land without a
 * canvas, and so the caller knows how big the image will be before it makes one.
 *
 * @param {object} file  a `data/winners-*.json`
 * @param {{from, to, kind, min, eras}} opts
 */
export function posterLayout(file, opts) {
  const P = POSTER;
  const seasons = winnersSeasons(file);
  const from = Math.max(opts.from, seasons.years[0]);
  const to = Math.min(opts.to, seasons.years[seasons.years.length - 1]);
  const years = seasons.years.filter(y => y >= from && y <= to);
  const players = file.players || {};

  /* ⚠️ The bars are worked out over **every** season, not just the exported
     ones, and then clipped. Lanes and colours have to match the page a reader
     might have sent this from — an export of 2011–2016 that recoloured CHEN
     Long because LEE Chong Wei was cropped out would not be the same picture. */
  const allLanes = opts.eras
    ? reignLanes(pyramidReigns(seasons, players, reignStep(opts.min).n))
    : [];

  /* Row heights are worked out **per column** and the columns are then
     bottom-aligned, which is what `align-items: flex-end` does on the page. It
     matters before 2011: those seasons put Superseries squares on the Super
     1000 row, so that row is shorter there than it is in 2013, and a height
     table keyed on the row would have left a hole above them. */
  const rowHeight = row => (row.tiles.length
    ? Math.max(...row.tiles.map(t => Math.round(t.scale * P.unit)))
    : Math.round(pyramidScale(row.tiers[row.tiers.length - 1]) * P.unit));
  /* ⚠️ A badged tile is given the badge's width on **both** sides, so the
     photograph sits in the middle of its own slot. That is the same trick the
     page plays with `padding-right` on `.pyrmajor`, and it is not optional:
     2021 holds an Olympics and a Worlds side by side, and without the reserved
     space the cup was drawn on top of the Olympic champion's face. */
  const rowWidth = row => (row.tiles.length
    ? row.tiles.reduce((n, t) => n + tileSlot(t).w, 0)
      + (row.tiles.length - 1) * P.tileGap
    : 0);

  const columns = [];
  let x = P.pad;
  for (const year of years) {
    const rows = pyramidSeason(seasons.byYear.get(year), players, year);
    const rowH = rows.map(rowHeight);
    const inner = Math.max(...rows.map(rowWidth), Math.round(P.unit));
    const w = inner + P.colPad * 2;
    columns.push({
      year, rows, x, w, rowH,
      stackH: rowH.reduce((n, h) => n + h, 0) + P.rowGap * (rows.length - 1),
    });
    x += w + P.colGap;
  }
  const boardW = columns.length ? x - P.colGap - P.pad : 0;
  const stackH = Math.max(...columns.map(c => c.stackH), 1);
  for (const c of columns) c.top = P.headH + (stackH - c.stackH);

  const bars = [];
  const at = new Map(columns.map(c => [c.year, c]));
  allLanes.forEach((p, i) => {
    for (const run of p.runs) {
      if (run.to < from || run.from > to) continue;
      const a = at.get(Math.max(run.from, from));
      const b = at.get(Math.min(run.to, to));
      if (!a || !b) continue;
      bars.push({
        id: p.id, who: p.who, lane: p.lane,
        colour: REIGN_COLOURS[i % REIGN_COLOURS.length],
        from: run.from, to: run.to,
        // Square where a run is cut by the crop, rounded where it really ends:
        // the shape says whether there is more of it off the side of the image.
        openLeft: run.from < from, openRight: run.to > to,
        x: a.x, w: b.x + b.w - a.x,
        years: run.years.filter(y => y.year >= from && y.year <= to)
          .map(y => ({ ...y, x: at.get(y.year).x, w: at.get(y.year).w })),
        total: run.total,
      });
    }
  });
  const lanes = bars.length ? Math.max(...bars.map(b => b.lane)) + 1 : 0;
  const bandH = lanes ? lanes * P.laneH + (lanes - 1) * P.laneGap + 14 : 0;

  /* ⚠️ Worked out before the height, because it decides it. The first version
     had a fixed 54px footer and the third legend line was drawn 4px from the
     bottom edge with its descenders sliced off. */
  /* ⚠️ Three separate statements, so three capitals — run on in lower case they
     read as one sentence broken over three lines. And the third one is *named*
     rather than shown: it led with a ⁕, which is the mark beside the year and
     not the mark on the square, so the line appeared to be explaining a small
     dot when what it is about is a dashed outline. The glyph stays as a pointer
     and the words do the explaining. */
  /* ⚠️ The pick goes into the picture, because it *is* the picture — an export
     of a board with one pair followed across it is a different claim from an
     export of the board. The same rule the score poster follows with its pins
     and the compare poster follows with its chips: an export draws what is on
     screen. */
  const pinned = new Set((opts.only || []).map(String));
  const lit = id => !pinned.size || pinned.has(String(id));
  /* Named at the foot, not left as an unexplained dark board. A reader who gets
     this in a feed has no way to know that the dim squares are dim on purpose. */
  const picked = [...new Set(columns.flatMap(c => c.rows.flatMap(r => r.tiles))
    .filter(t => pinned.has(String(t.id)))
    .map(t => (t.who && t.who.n) || ''))].filter(Boolean);

  const legend = [
    'Every square is a title, sized by what it was worth',
    picked.length
      ? `Lit: ${picked.join(' · ')}`
      : '',
    bars.length
      ? `A bar spans the seasons somebody won ${reignStep(opts.min).n}+ of them`
      : '',
    columns.some(c => c.rows.some(r => r.tiles.some(t => t.mark)))
      ? 'A dashed square, ⁕ by its year, was played in a different year'
      : '',
  ].filter(Boolean);
  const footH = 24 + Math.max(2, legend.length) * 15;

  return {
    years, from, to, columns, bars, lanes, at, stackH, lit, picked,
    width: P.pad * 2 + boardW,
    height: P.headH + stackH + P.yearH + bandH + footH,
    boardTop: P.headH,
    bandTop: P.headH + stackH + P.yearH,
    bandH,
    title: `${KIND_NAME[opts.kind] || opts.kind} · ${from}–${to}`,
    footH,
    legend,
    /* ⚠️ The brightest season on the **whole** board, not on the crop. A poster
       of 2011–2016 has to shade LEE Chong Wei's 2013 exactly as the page does,
       or the same seven titles look like a different year in the export. */
    peak: Math.max(...allLanes.flatMap(p => p.runs.map(r => r.peak)), 1),
    bar: reignStep(opts.min).n,
  };
}

/**
 * Draw a slice of the board and hand back a PNG.
 *
 * @returns {Promise<Blob>}
 */
export async function drawPoster(file, opts) {
  const P = POSTER;
  const L = posterLayout(file, opts);

  /* Every photograph, flag and the avatar, up front. Drawing is synchronous
     once they are here, which is what keeps the ordering of the layers
     obvious — a half-drawn canvas waiting on a network round trip is how
     export code turns into a callback maze. */
  const faces = new Map();
  const wants = new Set();
  /* ⚠️ **Every** face a competitor has, not just the first. A pair is two
     photographs and asking only for `who.a` left the right-hand half of every
     doubles square blank. */
  const facesOf = who => ((who && who.faces) || [who && who.a]).filter(Boolean);
  for (const col of L.columns) {
    for (const row of col.rows) for (const t of row.tiles) for (const u of facesOf(t.who)) wants.add(u);
  }
  for (const b of L.bars) {
    for (const u of facesOf(b.who)) wants.add(u);
    if (b.who && b.who.f) wants.add(b.who.f);
  }
  const urls = [...wants];
  const loaded = await Promise.all(urls.map(u => loadImage(u, true)));
  urls.forEach((u, i) => faces.set(u, loaded[i]));
  const avatar = await loadImage(opts.avatar || POSTER_AVATAR, false);

  const canvas = document.createElement('canvas');
  /* ⚠️ Chrome refuses a canvas wider than 16384 device pixels and hands back a
     blank one rather than an error, so a twenty-season export at twice the
     density would have come out empty. Density is what gives way — the picture
     is still the picture. */
  const density = L.width * P.scale > 16000 ? 1 : P.scale;
  canvas.width = Math.round(L.width * density);
  canvas.height = Math.round(L.height * density);
  const ctx = canvas.getContext('2d');
  ctx.scale(density, density);
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, L.width, L.height);

  // ---- the heading ----
  ctx.fillStyle = P.ink;
  ctx.font = '700 20px "Segoe UI", Roboto, system-ui, sans-serif';
  ctx.fillText('Winners', P.pad, 28);
  ctx.fillStyle = P.dim;
  ctx.font = '400 15px "Segoe UI", Roboto, system-ui, sans-serif';
  ctx.fillText(L.title, P.pad + ctx.measureText('Winners').width + 44, 28);

  // ---- the columns ----
  L.columns.forEach((col, n) => {
    ctx.fillStyle = n % 2 ? 'rgba(255,255,255,.045)' : 'rgba(255,255,255,.022)';
    roundRect(ctx, col.x, col.top - P.colPad, col.w,
      col.stackH + P.colPad + P.yearH - 6, 4);
    ctx.fill();

    let y = col.top;
    col.rows.forEach((row, ri) => {
      const h = col.rowH[ri];
      if (row.tiles.length) {
        const slots = row.tiles.map(tileSlot);
        const wide = slots.reduce((a, sl) => a + sl.w, 0)
          + (slots.length - 1) * P.tileGap;
        let sx = col.x + (col.w - wide) / 2;
        row.tiles.forEach((t, i) => {
          const { side, pad, w } = slots[i];
          const tx = sx + pad;
          // Bottom-aligned inside the row, like the page: a row is a shelf.
          const ty = y + h - side;
          const on = L.lit(t.id);
          drawTile(ctx, t, tx, ty, side, faces, on);
          // The summit marks hang off the left of the photograph, in the space
          // the slot reserved for them — and fade with it, being marks *on* it.
          const bw = badgeWidth(side);
          ctx.save();
          ctx.globalAlpha = on ? 1 : 0.18;
          if (String(t.tier) === 'OLY') {
            drawRings(ctx, tx - bw - 3,
              ty + side / 2 - bw * (RING_BOX[1] / RING_BOX[0]) / 2, bw);
          } else if (String(t.tier) === '20') {
            drawCup(ctx, tx - bw - 3, ty + side / 2 - bw / 2, bw);
          }
          ctx.restore();
          sx += w + P.tileGap;
        });
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,.10)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(col.x + P.colPad, y + h - 0.5);
        ctx.lineTo(col.x + col.w - P.colPad, y + h - 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      y += h + P.rowGap;
    });

    // The year, and its footnote mark if anything in it moved.
    const moved = col.rows.some(r => r.tiles.some(t => t.mark));
    ctx.fillStyle = P.dim;
    ctx.font = '400 13px "Segoe UI", Roboto, system-ui, sans-serif';
    const label = String(col.year) + (moved ? ' ⁕' : '');
    ctx.fillText(label, col.x + (col.w - ctx.measureText(label).width) / 2,
      P.headH + L.stackH + 16);
  });

  // ---- the band ----
  for (const b of L.bars) {
    const top = L.bandTop + b.lane * (P.laneH + P.laneGap);
    ctx.save();
    /* ⚠️ A **multiplier**, not a value. The shading inside a bar sets
       `globalAlpha` per season and then resets it to 1, so a fade set once at
       the top of the loop is wiped out by the first year block. Every alpha in
       here is written as `× fade` instead. */
    const fade = L.lit(b.id) ? 1 : 0.3;
    // Square where the crop cut the run, rounded where it really begins or ends.
    roundRect(ctx, b.x, top, b.w, P.laneH, 5);
    if (b.openLeft || b.openRight) {
      ctx.beginPath();
      const r = 5;
      const x0 = b.x, x1 = b.x + b.w;
      ctx.moveTo(b.openLeft ? x0 : x0 + r, top);
      ctx.lineTo(b.openRight ? x1 : x1 - r, top);
      if (!b.openRight) ctx.arcTo(x1, top, x1, top + r, r);
      ctx.lineTo(x1, top + P.laneH - (b.openRight ? 0 : r));
      if (!b.openRight) ctx.arcTo(x1, top + P.laneH, x1 - r, top + P.laneH, r);
      ctx.lineTo(x0 + (b.openLeft ? 0 : r), top + P.laneH);
      if (!b.openLeft) ctx.arcTo(x0, top + P.laneH, x0, top + P.laneH - r, r);
      ctx.lineTo(x0, top + (b.openLeft ? 0 : r));
      if (!b.openLeft) ctx.arcTo(x0, top, x0 + r, top, r);
      ctx.closePath();
    }
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,.04)';
    ctx.fillRect(b.x, top, b.w, P.laneH);

    for (let i = 0; i < b.years.length; i++) {
      const y = b.years[i];
      const next = b.years[i + 1];
      const right = next ? next.x : y.x + y.w;
      ctx.globalAlpha = Number((0.62 + 0.33
        * (y.n - L.bar) / Math.max(1, L.peak - L.bar)).toFixed(3)) * fade;
      ctx.fillStyle = b.colour;
      ctx.fillRect(y.x, top, right - y.x, P.laneH);
    }
    /* The face, the name and the flag recede further than the block of colour
       does — the run stays legible as a run, and only says whose at a glance
       when it is the one picked. */
    ctx.globalAlpha = fade === 1 ? 1 : 0.22;

    // The label, always at the bar's own left edge — the export does not
    // scroll, so there is nothing for a sticky one to stick to.
    const name = (b.who && b.who.n) || String(b.id);
    ctx.font = '600 13px "Segoe UI", Roboto, system-ui, sans-serif';
    const flagW = b.who && b.who.f && faces.get(b.who.f) ? 20 : 0;
    const pillW = Math.min(b.w - 6,
      26 + ctx.measureText(name).width + flagW + 12);
    ctx.fillStyle = 'rgba(16,16,16,.55)';
    roundRect(ctx, b.x + 3, top + 3, pillW, P.laneH - 6, (P.laneH - 6) / 2);
    ctx.fill();

    const fs = P.laneH - 10;
    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x + 5 + fs / 2, top + P.laneH / 2, fs / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,.10)';
    ctx.fillRect(b.x + 5, top + 5, fs, fs);
    drawWinnerFaces(ctx, b.who, b.x + 5, top + 5, fs, fs, faces);
    ctx.restore();

    ctx.fillStyle = P.ink;
    ctx.font = '600 13px "Segoe UI", Roboto, system-ui, sans-serif';
    ctx.fillText(name, b.x + 9 + fs, top + P.laneH / 2 + 4);
    const flag = b.who && b.who.f ? faces.get(b.who.f) : null;
    if (flag) {
      const fx = b.x + 13 + fs + ctx.measureText(name).width;
      ctx.save();
      ctx.beginPath();
      ctx.arc(fx + 7, top + P.laneH / 2, 7, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(flag, fx, top + P.laneH / 2 - 7, 14, 14);
      ctx.restore();
    }
    ctx.restore();
  }

  drawPosterFoot(ctx, L.width, L.height, L.footH, avatar, L.legend);

  return new Promise((resolve, reject) => {
    /* ⚠️ This is where a tainted canvas shows up, and nowhere earlier: every
       image will have drawn perfectly first. See the note at the top about
       `crossOrigin`. */
    try {
      canvas.toBlob(blob => blob ? resolve(blob)
        : reject(new Error('the browser would not encode the image')), 'image/png');
    } catch (e) {
      reject(new Error('the images would not come back readable (' + e.name + ')'));
    }
  });
}

/**
 * Where it came from, and what its marks mean — the same foot on every export.
 *
 * ⚠️ A legend, because an export leaves the page behind. On screen the bars have
 * a picker beside them saying 3+ and every square has a tooltip; in a feed there
 * is nothing but the picture, and a reader who cannot tell what a bar means will
 * read it as a ranking.
 *
 * ⚠️ Shared by the board and the score deliberately. The avatar, the link and
 * the rule above them are the *provenance*, and two copies of provenance is two
 * places for it to go stale.
 */
function drawPosterFoot(ctx, width, height, footH, avatar, legend) {
  const P = POSTER;
  const fy = height - footH + 10;
  ctx.strokeStyle = 'rgba(255,255,255,.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(P.pad, fy - 8.5);
  ctx.lineTo(width - P.pad, fy - 8.5);
  ctx.stroke();

  if (avatar) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(P.pad + 13, fy + 13, 13, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(avatar, P.pad, fy, 26, 26);
    ctx.restore();
  }
  ctx.fillStyle = P.ink;
  ctx.font = '600 13px "Segoe UI", Roboto, system-ui, sans-serif';
  ctx.fillText('Badminton seasons', P.pad + (avatar ? 34 : 0), fy + 12);
  ctx.fillStyle = P.dim;
  ctx.font = '400 12px "Segoe UI", Roboto, system-ui, sans-serif';
  ctx.fillText(POSTER_LINK, P.pad + (avatar ? 34 : 0), fy + 26);

  ctx.textAlign = 'right';
  for (const [i, line] of (legend || []).entries()) {
    ctx.fillStyle = P.dim;
    ctx.font = '400 12px "Segoe UI", Roboto, system-ui, sans-serif';
    ctx.fillText(line, width - P.pad, fy + 12 + i * 15);
  }
  ctx.textAlign = 'left';
}

/**
 * One square.
 *
 * ⚠️ **When it is not the picked competitor, the photograph fades and the
 * square does not** — the same rule the page follows, and for the same reason:
 * the faint ground is what draws the pyramid's silhouette, so fading the whole
 * square deletes the shape of the season, which is what the board is for.
 */
function drawTile(ctx, t, x, y, side, faces, lit = true) {
  const ring = TIER_RING[String(t.tier)];
  ctx.save();
  roundRect(ctx, x, y, side, side, 3);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,.06)';
  ctx.fillRect(x, y, side, side);
  ctx.globalAlpha = lit ? 1 : 0.16;
  drawWinnerFaces(ctx, t.who, x, y, side, side, faces);
  ctx.restore();

  /* The tier marks go with the face. A full-strength gold ring on a square
     whose photograph has receded reads as the *ring* being what was picked. */
  ctx.save();
  ctx.globalAlpha = lit ? 1 : 0.18;

  /* ⚠️ Outside the square, not inside it, which is what the page does now — an
     inset ring is painted under the photograph and may as well not be there. */
  if (ring) {
    ctx.lineWidth = ring.width;
    ctx.strokeStyle = ring.colour;
    roundRect(ctx, x - ring.width / 2, y - ring.width / 2,
      side + ring.width, side + ring.width, 4);
    ctx.stroke();
  }

  // The footnote mark, dashed and clear of the ring — as on the page.
  if (t.mark) {
    ctx.strokeStyle = 'rgba(255,255,255,.8)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    roundRect(ctx, x - 3.5, y - 3.5, side + 7, side + 7, 5);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

/* ============================ the score, as a picture ============================

   The Winners page's other view, drawn onto a canvas by the same rules as the
   board above it — from the model, at a fixed size, with the link on it.

   ⚠️ **The crop changes what is *shown*, never what is *counted*.** A score is a
   share of its own season, so cropping to 2011–2016 leaves every number exactly
   where it was; and the players, their colours and the axis are all worked out
   over the whole career, then clipped. An export of six seasons that recoloured
   CHEN Long because LEE Chong Wei fell off the left would not be the same
   picture the sender was looking at. Same rule as the bars, same reason.
   ==================================================================== */

export const SCORE_POSTER = {
  plotH: 360,          // the chart itself, above the year labels
  /* ⚠️ Room for the year labels **and** the counts on the strip below them. At
     24 a tall strip bar put its number through the year it belonged to. */
  yearH: 42,
  stripH: 34,
  axisW: 40,           // room for the 0–100 labels
  colMin: 46,          // the narrowest a season may be drawn
  face: 13,            // the radius of a photograph on the line
  chipH: 26,           // a legend chip
  chipGap: 6,
  /* ⚠️ A marker is drawn *on* its year, so the first and last of them hang half
     out of the plot unless the years are inset from its edges. */
  edge: 20,
};

/**
 * Lay the chart out in CSS pixels without drawing anything.
 *
 * @param {object} file  a `data/winners-*.json`
 * @param {{from, to, kind, floor, only, top}} opts  `only` is the pinned set, as
 *   a list of ids; `top` is the height of the y-axis, which the caller supplies
 *   because the page scales it across **both** draws and one file cannot know
 *   about the other. Absent, it is derived from this file alone.
 */
export function scorePosterLayout(file, opts) {
  const P = POSTER, S = SCORE_POSTER;
  /* ⚠️ The page's reading of the pandemic seasons travels with the export, or
     an exported chart quotes different numbers from the one on screen that made
     it. See `COVID_MODES`. */
  const model = dominationSeasons(file, { covid: opts.covid });
  const all = model.years;
  const from = Math.max(opts.from, all[0]);
  const to = Math.min(opts.to, all[all.length - 1]);
  const years = all.filter(y => y >= from && y <= to);
  const thin = thinSeasons(model.seasons);
  const floor = (Number(opts.floor) || 0) / 100;
  const pinned = new Set((opts.only || []).map(String));
  const lit = id => !pinned.size || pinned.has(String(id));

  /* Over the whole career, in the order careers open — the page's rule, so the
     colours in the picture are the colours the sender saw. */
  const shown = model.people.filter(p => p.peak >= floor)
    .map((p, i) => ({ ...p, colour: SCORE_COLOURS[i % SCORE_COLOURS.length] }));

  const top = Math.min(1, Math.max(0.25, opts.top
    || Math.ceil(Math.max(...model.people.map(p => p.peak), 0.01) * 10) / 10));

  const plotW = Math.max(660, (years.length - 1) * S.colMin + 80);
  const width = P.pad * 2 + S.axisW + plotW;
  const left = P.pad + S.axisW;
  const span = plotW - S.edge * 2;
  const x = year => left + S.edge + (years.length < 2
    ? span / 2 : (span * years.indexOf(year)) / (years.length - 1));
  const plotTop = P.headH;
  const y = v => plotTop + S.plotH - S.plotH * (v / top);

  /* One chip per name, wrapped into rows — laid out here so the height of the
     picture is known before a pixel of it is drawn. */
  const chips = shown.slice().sort((a, b) => b.peak - a.peak).map(p => ({
    id: p.id, who: p.who, colour: p.colour, peak: p.peak, lit: lit(p.id),
    w: 0,
  }));
  const stripTop = plotTop + S.plotH + S.yearH;
  const legendTop = stripTop + S.stripH + 16;

  const legend = [
    'A score of 100 is every title of that season, and nobody else with one',
    'Weighted by the board’s own ladder: each tier is φ (1.618) the one below',
    thin.set.size ? 'A * marks a season with far fewer titles than the ones around it' : '',
    /* Said out loud on the picture, because the numbers on it are not the ones a
       reader would get by opening the page — and a chart that quietly used a
       different denominator would be the worst thing this file could ship. */
    model.seasons.some(s => s.whole)
      ? 'The pandemic seasons are weighed against a full season, not what they held'
      : '',
  ].filter(Boolean);

  /* ⚠️ **The union, exactly as the page draws it.** A season is marked for
     either of two reasons — far fewer titles than its neighbours, or the
     pandemic — and 2021 has only the second: it held ten, the same as 2018. On
     `thin` alone the poster left 2021 unmarked and unshaded while the page beside
     it showed a column and the word "Covid". One set, three drawings. */
  const marked = new Set([...thin.set, ...years.filter(isCovidSeason)]);

  return {
    model, years, from, to, thin, marked, top, shown, lit, chips,
    x, y, left, plotW, plotTop, stripTop, legendTop,
    width,
    title: `${KIND_NAME[opts.kind] || opts.kind} · ${from}–${to}`,
    legend,
    // Filled in by the drawing, which is where the chips get measured. A floor
    // of one row, so an empty legend does not close the picture up.
    height: legendTop + S.chipH + 24 + Math.max(2, legend.length) * 15,
    footH: 24 + Math.max(2, legend.length) * 15,
  };
}

/**
 * Draw the score chart and hand back a PNG.
 *
 * @returns {Promise<Blob>}
 */
export async function drawScorePoster(file, opts) {
  const P = POSTER, S = SCORE_POSTER;
  const L = scorePosterLayout(file, opts);

  // Every photograph up front, so the drawing below is straight-line code.
  const wants = new Set();
  // Every face, not just the first: a pair is two. See `drawWinnerFaces`.
  for (const p of L.shown) {
    for (const u of ((p.who && p.who.faces) || [p.who && p.who.a]).filter(Boolean)) wants.add(u);
  }
  const urls = [...wants];
  const loaded = await Promise.all(urls.map(u => loadImage(u, true)));
  const faces = new Map(urls.map((u, i) => [u, loaded[i]]));
  const avatar = await loadImage(opts.avatar || POSTER_AVATAR, false);

  /* The legend chips can only be measured against a real context, so the canvas
     is made first at a provisional height and the rows are counted onto it. */
  const canvas = document.createElement('canvas');
  const ctx0 = canvas.getContext('2d');
  ctx0.font = '600 13px "Segoe UI", Roboto, system-ui, sans-serif';
  for (const c of L.chips) {
    c.w = S.chipH + 8 + ctx0.measureText(c.who.n || String(c.id)).width
      + ctx0.measureText(' ' + Math.round(c.peak * 100)).width + 16;
  }
  const rowsOf = chips => {
    const rows = [[]];
    let used = 0;
    for (const c of chips) {
      if (used && used + c.w > L.plotW + S.axisW) { rows.push([]); used = 0; }
      rows[rows.length - 1].push(c);
      used += c.w + S.chipGap;
    }
    return rows;
  };
  const chipRows = rowsOf(L.chips);
  const legendH = chipRows.length * (S.chipH + S.chipGap);
  const height = L.legendTop + legendH + L.footH;

  /* ⚠️ Chrome refuses a canvas wider than 16384 device pixels and hands back a
     blank one rather than an error. Density is what gives way — the picture is
     still the picture. */
  const density = L.width * P.scale > 16000 ? 1 : P.scale;
  canvas.width = Math.round(L.width * density);
  canvas.height = Math.round(height * density);
  const ctx = canvas.getContext('2d');
  ctx.scale(density, density);
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, L.width, height);

  // ---- the heading ----
  ctx.fillStyle = P.ink;
  ctx.font = '700 20px "Segoe UI", Roboto, system-ui, sans-serif';
  ctx.fillText('Domination score', P.pad, 28);
  ctx.fillStyle = P.dim;
  ctx.font = '400 15px "Segoe UI", Roboto, system-ui, sans-serif';
  ctx.fillText(L.title,
    P.pad + ctx.measureText('Domination score').width + 74, 28);

  // ---- the plot ----
  ctx.fillStyle = 'rgba(255,255,255,.022)';
  roundRect(ctx, L.left - S.axisW + 6, L.plotTop - 10,
    L.plotW + S.axisW - 6, S.plotH + S.yearH + S.stripH + 14, 5);
  ctx.fill();

  /* A faint column for a season with a hole in it, named at the foot of it —
     the strip says how short, this says why. */
  const half = L.years.length > 1
    ? (L.plotW - S.edge * 2) / (L.years.length - 1) / 2 : 20;
  const now = new Date().getUTCFullYear();
  for (const yr of L.years) {
    if (!L.marked.has(yr)) continue;
    ctx.fillStyle = 'rgba(255,188,32,.07)';
    ctx.fillRect(L.x(yr) - half * 0.75, L.plotTop, half * 1.5, S.plotH);
    const why = shortSeasonWhy(yr, now);
    if (!why) continue;
    ctx.fillStyle = 'rgba(255,188,32,.85)';
    ctx.font = '400 11px "Segoe UI", Roboto, system-ui, sans-serif';
    const last = yr === L.years[L.years.length - 1];
    const w = ctx.measureText(why).width;
    ctx.fillText(why, last ? L.left + L.plotW - w : L.x(yr) - w / 2,
      L.plotTop + S.plotH - 7);
  }

  const step = L.top > 0.6 ? 0.2 : L.top > 0.3 ? 0.1 : 0.05;
  ctx.strokeStyle = 'rgba(255,255,255,.07)';
  ctx.lineWidth = 1;
  ctx.font = '400 11px "Segoe UI", Roboto, system-ui, sans-serif';
  for (let v = 0; v <= L.top + 1e-9; v += step) {
    const yy = Math.round(L.y(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(L.left - 6, yy);
    ctx.lineTo(L.left + L.plotW, yy);
    ctx.stroke();
    ctx.fillStyle = P.dim;
    const lab = String(Math.round(v * 100));
    ctx.fillText(lab, L.left - 12 - ctx.measureText(lab).width, yy + 4);
  }

  /* ⚠️ **Every year**, as on the page. A column is never narrower than
     `colMin` — 46px — and a four-digit label at 12px is about 28, so they do
     not collide however long the crop is. Thinning them made the reader count
     gaps to place a point, and had already had to spare the footnoted years
     from the thinning by hand. */
  ctx.font = '400 12px "Segoe UI", Roboto, system-ui, sans-serif';
  L.years.forEach(yr => {
    const marked = L.marked.has(yr);
    const lab = String(yr);
    const w = ctx.measureText(lab).width + (marked ? 6 : 0);
    ctx.fillStyle = P.dim;
    ctx.fillText(lab, L.x(yr) - w / 2, L.plotTop + S.plotH + 16);
    if (marked) {
      ctx.fillStyle = '#ffbc20';
      ctx.fillText('*', L.x(yr) - w / 2 + ctx.measureText(lab).width + 1,
        L.plotTop + S.plotH + 16);
    }
  });

  /* ⚠️ The denominator, drawn. Without it, 66.7 in 2020 and 66.7 in 2015 are the
     same height on the page and one of them is two matches. */
  const bw = Math.max(3, Math.min(11, half * 0.7));
  ctx.font = '400 10px "Segoe UI", Roboto, system-ui, sans-serif';
  for (const yr of L.years) {
    const s = L.model.seasons.find(q => q.year === yr);
    const h = L.thin.max ? (S.stripH * s.total) / L.thin.max : 0;
    ctx.fillStyle = L.thin.set.has(yr) ? 'rgba(255,188,32,.75)' : 'rgba(255,255,255,.14)';
    ctx.fillRect(L.x(yr) - bw / 2, L.stripTop + S.stripH - h, bw,
      Math.max(h, s.total ? 1 : 0));
    /* ⚠️ The **thin** set here and not the union, because this is the page's
       rule: the strip is a count, and what it warns about is a count. 2021 held
       ten titles and its bar is an ordinary bar; what was wrong with 2021 shows
       up in the column behind the plot and the mark beside the year. */
    ctx.fillStyle = L.thin.set.has(yr) ? '#ffbc20' : P.dim;
    /* ⚠️ **Both numbers when the season is weighed against more than it held**,
       which the page has always done and this had not: an exported 2026 column
       said "8" beside a line drawn as a share of twelve, and under `full` a 2020
       column saying "3" is a share of a full season. Same rule as the page. */
    const n = s.planned > s.played ? `${s.played}/${s.planned}` : String(s.total);
    ctx.fillText(n, L.x(yr) - ctx.measureText(n).width / 2,
      L.stripTop + S.stripH - h - 4);
  }
  ctx.fillStyle = P.dim;
  ctx.font = '400 10px "Segoe UI", Roboto, system-ui, sans-serif';
  ctx.fillText('titles', L.left - 12 - ctx.measureText('titles').width,
    L.stripTop + S.stripH);

  // Lines first, faded ones underneath, then every face over every line.
  const order = L.shown.slice()
    .sort((a, b) => Number(L.lit(a.id)) - Number(L.lit(b.id)));
  const inCrop = p => p.pts.filter(pt => pt.year >= L.from && pt.year <= L.to);
  for (const p of order) {
    ctx.globalAlpha = L.lit(p.id) ? 1 : 0.16;
    ctx.strokeStyle = p.colour;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const pts = inCrop(p);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], c = pts[i];
      // ⚠️ Only between consecutive seasons: a gap is a gap, not a trend.
      if (c.year !== a.year + 1) continue;
      // A leg touching a short season is dashed — a solid line across 2020
      // asserts a trend through a year that was barely played.
      ctx.setLineDash(L.thin.set.has(a.year) || L.thin.set.has(c.year) ? [5, 5] : []);
      ctx.beginPath();
      ctx.moveTo(L.x(a.year), L.y(a.score));
      ctx.lineTo(L.x(c.year), L.y(c.score));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  for (const p of order) {
    ctx.globalAlpha = L.lit(p.id) ? 1 : 0.16;
    for (const pt of inCrop(p)) {
      const cx = L.x(pt.year), cy = L.y(pt.score);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, S.face, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = p.colour;
      ctx.fillRect(cx - S.face, cy - S.face, S.face * 2, S.face * 2);
      drawWinnerFaces(ctx, p.who, cx - S.face, cy - S.face, S.face * 2, S.face * 2, faces);
      ctx.restore();
      ctx.strokeStyle = p.colour;
      ctx.lineWidth = L.lit(p.id) ? 2.2 : 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, S.face, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // ---- who the lines are ----
  chipRows.forEach((row, r) => {
    let cx = P.pad;
    const top = L.legendTop + r * (S.chipH + S.chipGap);
    for (const c of row) {
      ctx.globalAlpha = c.lit ? 1 : 0.35;
      ctx.fillStyle = 'rgba(255,255,255,.05)';
      roundRect(ctx, cx, top, c.w, S.chipH, S.chipH / 2);
      ctx.fill();
      const fs = S.chipH - 6;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx + 3 + fs / 2, top + S.chipH / 2, fs / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = c.colour;
      ctx.fillRect(cx + 3, top + 3, fs, fs);
      drawWinnerFaces(ctx, c.who, cx + 3, top + 3, fs, fs, faces);
      ctx.restore();
      ctx.strokeStyle = c.colour;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx + 3 + fs / 2, top + S.chipH / 2, fs / 2, 0, Math.PI * 2);
      ctx.stroke();

      const name = (c.who && c.who.n) || String(c.id);
      ctx.fillStyle = P.ink;
      ctx.font = '600 13px "Segoe UI", Roboto, system-ui, sans-serif';
      ctx.fillText(name, cx + S.chipH + 4, top + S.chipH / 2 + 4.5);
      /* ⚠️ Measured **before** the font changes. Taken after, the name came back
         at the 12px width it was never drawn at, and every long name had its
         peak printed through its last two letters. */
      const nameW = ctx.measureText(name).width;
      ctx.fillStyle = P.dim;
      ctx.font = '400 12px "Segoe UI", Roboto, system-ui, sans-serif';
      ctx.fillText(String(Math.round(c.peak * 100)),
        cx + S.chipH + 10 + nameW, top + S.chipH / 2 + 4.5);
      cx += c.w + S.chipGap;
    }
  });
  ctx.globalAlpha = 1;

  drawPosterFoot(ctx, L.width, height, L.footH, avatar, L.legend);

  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(blob => blob ? resolve(blob)
        : reject(new Error('the browser would not encode the image')), 'image/png');
    } catch (e) {
      reject(new Error('the images would not come back readable (' + e.name + ')'));
    }
  });
}

/* ============================ the compare page ============================

   The grid and the honours board, drawn by the same rules as the two above: from
   the model, at a fixed size, with the link and a legend on it.

   ⚠️ **The careers arrive as `careerRows` output, not as raw seasons.** The page
   has already built them — the Finals reattribution, the era translation and the
   junior and team exclusions all settle in `careerRows`, and doing that twice is
   two chances for the picture and the page to disagree about what a career
   contains. Everything below that is recomputed here, because it is geometry.
   ==================================================================== */

/* ⚠️ The result ramp, which is also in `styles.css` as `--res-*`. Same reason
   `TIER_RING` is in both: the page paints with CSS and the export paints with
   canvas, and there is no way to hand one to the other without a build step.
   The suite reads the computed colour off a drawn cell and holds it against
   this table, so the two cannot drift apart quietly. */
export const RESULT_COLOURS = {
  w: '#1a7f37', f: '#3fa34d', sf: '#7cb342', qf: '#c9a227',
  r16: '#e07b39', r1: '#cf4b3f', q: '#8f5a55',
  unk: '#6e6e6e', na: '#4a4a4a', off: '#292929',
};

export const CARD = {
  /* ⚠️ 20, not the page default of 20-at-zoom or the 16 this started at. An
     export is drawn at a size that reads rather than at the size the sender had
     the slider on — and at 16 a one-slot block was narrower than the three
     letters naming it, so Olympics, Worlds, Tour Finals, Continental and
     Regional Games all lost their labels off the front of the band. */
  cell: 20,            // one grid square
  yearW: 42,           // the season label down the left of a grid
  bandH: 18,           // the strip of level codes over the slots
  profileH: 54,
  cardGap: 30,
  hbase: 12,           // the honours board's bottom rung
  /* The same 0.09 the stylesheet uses between honours squares, kept here
     because the width of the board is computed from it. */
  hgap: 0.09,
  hnW: 24,             // the count beside a row, fixed so the arithmetic is exact
  spineW: 74,          // the level names down the middle of a comparison
};

/**
 * The identity line over a card: photograph, name, and what the page says.
 *
 * ⚠️ **No flag here, unlike the era band's.** Measured 5 Sep 2026: BWF serves
 * player photographs from `img.bwfbadminton.com`, which answers a CORS request,
 * and country flags from `extranet.bwf.sport`, which does **not** — so every
 * flag on this poster failed to load, printed a CORS error into the console and
 * drew nothing. The Winners board's flags come out of the harvested file and are
 * on the photograph host, which is why those are fine and these are not. The
 * country is already in the line under the name, so what is lost is the picture
 * of it and nothing else.
 */
function drawWho(ctx, who, x, y, w, faces, align) {
  const im = who.avatar ? faces.get(who.avatar) : null;
  const size = 38;
  const right = align === 'right';
  const ax = right ? x + w - size : x;
  ctx.save();
  ctx.beginPath();
  ctx.arc(ax + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  if (im) drawCover(ctx, im, ax, y, size);
  else {
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fillRect(ax, y, size, size);
    ctx.fillStyle = POSTER.dim;
    ctx.font = `700 ${Math.round(size * 0.34)}px "Segoe UI", Roboto, sans-serif`;
    const ini = initialsOf(who.name);
    ctx.fillText(ini, ax + (size - ctx.measureText(ini).width) / 2, y + size / 2 + size * 0.12);
  }
  ctx.restore();

  const tx = right ? x + w - size - 10 : x + size + 10;
  ctx.textAlign = right ? 'right' : 'left';
  ctx.fillStyle = POSTER.ink;
  ctx.font = '700 17px "Segoe UI", Roboto, system-ui, sans-serif';
  ctx.fillText(who.name, tx, y + 17);
  ctx.fillStyle = POSTER.dim;
  ctx.font = '400 12px "Segoe UI", Roboto, system-ui, sans-serif';
  ctx.fillText(who.meta, tx, y + 34);
  ctx.textAlign = 'left';
}

/** Every photograph a card needs, loaded once. See `drawWho` about the flags. */
async function facesFor(careers) {
  const wants = new Set();
  for (const c of careers) if (c.avatar) wants.add(c.avatar);
  const urls = [...wants];
  const loaded = await Promise.all(urls.map(u => loadImage(u, true)));
  return new Map(urls.map((u, i) => [u, loaded[i]]));
}

/** A square, with the notch a translated result wears on the page. */
function drawResultCell(ctx, x, y, side, tier, mapped) {
  ctx.fillStyle = RESULT_COLOURS[tier] || RESULT_COLOURS.off;
  ctx.beginPath();
  if (mapped) {
    /* ⚠️ The same notch out of the top-right corner the page cuts with
       `clip-path`, and for the same reason: it costs no colour, survives every
       tier in the ramp, and is legible at 8px as well as at 60. */
    const n = Math.max(3, side * 0.34);
    ctx.moveTo(x, y);
    ctx.lineTo(x + side - n, y);
    ctx.lineTo(x + side, y + n);
    ctx.lineTo(x + side, y + side);
    ctx.lineTo(x, y + side);
    ctx.closePath();
  } else {
    ctx.rect(x, y, side, side);
  }
  ctx.fill();

  /* ⚠️ A win says so, and not only in green. `--res-w` and `--res-f` are one
     step apart on the ramp, and for a reader with red-green colour vision
     deficiency it carries almost nothing — so the same fact is said twice.
     Gated on the square being big enough for the glyphs to be a word rather
     than dirt, which is the page's rule too. */
  if (tier === 'w' && side >= 16) {
    ctx.fillStyle = '#000';
    ctx.font = `700 ${(side * 0.44).toFixed(1)}px "Roboto Mono", Consolas, monospace`;
    const m = ctx.measureText('#1');
    ctx.fillText('#1', x + (side - m.width) / 2, y + side / 2 + side * 0.16);
  }
}

/* ---- the career grid ---- */

/**
 * @param {Array<{id, name, meta, avatar, flag, rows}>} careers  `rows` from `careerRows`
 * @param {{era, hidden}} opts  `hidden` is the set of level groups switched off
 */
export function gridPosterLayout(careers, opts) {
  const P = POSTER, C = CARD;
  const hidden = new Set([...(opts.hidden || [])].map(String));
  const all = gridSections(careers.map(c => c.rows.map(r => r.by)), opts.era);
  const sections = all.filter(s => !hidden.has(String(s.group)));
  const years = gridYears(careers.map(c => c.rows));

  const slots = sections.reduce((n, s) => n + s.n, 0);
  const cardW = C.yearW + slots * C.cell;
  const width = P.pad * 2 + cardW * careers.length
    + C.cardGap * (careers.length - 1);
  const top = P.headH + C.profileH + C.bandH;
  const legend = [
    'A block is one level; a season fills it best result first',
    'Green is a title, red a first-round exit; grey is an event not played',
    careers.some(c => c.rows.some(r => [...r.by.values()]
      .some(list => list.some(t => t.from))))
      ? 'A notched corner is a result drawn on the tier it maps to' : '',
  ].filter(Boolean);
  const footH = 24 + Math.max(2, legend.length) * 15;

  return {
    careers, sections, all, years, slots, cardW, top, width, legend, footH,
    height: top + years.length * C.cell + 18 + footH,
    title: careers.map(c => c.name).join('  ·  '),
  };
}

export async function drawGridPoster(careers, opts) {
  const P = POSTER, C = CARD;
  const L = gridPosterLayout(careers, opts);
  const faces = await facesFor(careers);
  const avatar = await loadImage(opts.avatar || POSTER_AVATAR, false);

  const canvas = document.createElement('canvas');
  const density = L.width * P.scale > 16000 ? 1 : P.scale;
  canvas.width = Math.round(L.width * density);
  canvas.height = Math.round(L.height * density);
  const ctx = canvas.getContext('2d');
  ctx.scale(density, density);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, L.width, L.height);

  ctx.fillStyle = P.ink;
  ctx.font = '700 20px "Segoe UI", Roboto, system-ui, sans-serif';
  ctx.fillText('Career grid', P.pad, 28);

  L.careers.forEach((c, n) => {
    const x0 = P.pad + n * (L.cardW + C.cardGap);
    drawWho(ctx, c, x0, P.headH, L.cardW, faces);

    // The band of level codes over the slots each one owns.
    let bx = x0 + C.yearW;
    ctx.font = '600 9.5px "Roboto Mono", Consolas, monospace';
    for (const s of L.sections) {
      const w = s.n * C.cell;
      ctx.fillStyle = 'rgba(255,255,255,.05)';
      ctx.fillRect(bx, P.headH + C.profileH, w - 1, C.bandH - 3);
      ctx.fillStyle = P.dim;
      const code = String(s.code);
      const tw = ctx.measureText(code).width;
      /* Clipped to its own block rather than spilling into the next: a code
         that overhangs its slots is pointing at the wrong level. */
      if (tw < w - 2) ctx.fillText(code, bx + (w - tw) / 2, P.headH + C.profileH + 12);
      bx += w;
    }

    const byYear = new Map(c.rows.map(r => [r.year, r.by]));
    L.years.forEach((y, i) => {
      const ry = L.top + i * C.cell;
      ctx.fillStyle = P.dim;
      ctx.font = '400 11px "Roboto Mono", Consolas, monospace';
      ctx.fillText(String(y), x0 + 2, ry + C.cell - 4);
      const cells = sectionCells(byYear.get(y), L.sections);
      cells.forEach((cell, k) => {
        const cx = x0 + C.yearW + k * C.cell;
        drawResultCell(ctx, cx, ry, C.cell - 1, cell.tier, !!cell.from);
        /* ⚠️ The tier boundary is drawn *into* the cell, as on the page, so the
           run of colour on either side of it stays unbroken. */
        if (cell.first && k) {
          ctx.fillStyle = P.bg;
          ctx.fillRect(cx, ry, 1, C.cell - 1);
        }
      });
    });
  });

  drawPosterFoot(ctx, L.width, L.height, L.footH, avatar, L.legend);
  return toPng(canvas);
}

/* ---- the honours board ---- */

/**
 * @param {Array<{id, name, meta, avatar, flag, rows}>} careers
 * @param {{era, hidden, bar}} opts  `bar` is an `HONOUR_STEPS` key
 */
export function honoursPosterLayout(careers, opts) {
  const P = POSTER, C = CARD;
  const hidden = new Set([...(opts.hidden || [])].map(String));
  const step = honourStep(opts.bar);
  const list = careers.map(c => ({ ...c, honours: careerHonours(c.rows, step.rank) }));
  const all = honourSections(list.map(c => c.honours), opts.era);
  const sections = all.filter(s => !hidden.has(String(s.group)));
  const two = list.length > 1;

  /* The widest half any row needs — n squares carry n − 1 gaps between them and
     one more out to the count, so a run of n is n × 1.09 squares wide. An empty
     row still needs its ghost. */
  let units = 0;
  for (const s of sections) {
    for (const c of list) {
      const n = (c.honours.by.get(s.group) || []).length;
      units = Math.max(units, s.scale * (n ? (1 + C.hgap) * n : 1));
    }
  }
  const halfW = units * C.hbase + C.hnW;
  const rowGap = 6;
  const rows = sections.map(s => ({
    section: s,
    side: s.scale * C.hbase,
    h: Math.max(s.scale * C.hbase, 14),
  }));
  const boardH = rows.reduce((n, r) => n + r.h + rowGap, 0);

  const width = P.pad * 2 + (two ? halfW * 2 + C.spineW : halfW + C.spineW);
  const top = P.headH + C.profileH;
  const legend = [
    `Every result at ${step.label} or better, one row per level`,
    'A square’s area is what that level is worth — φ per rung',
    two ? 'The two boards mirror, so their best results meet at the spine' : '',
  ].filter(Boolean);
  const footH = 24 + Math.max(2, legend.length) * 15;

  return {
    careers: list, sections, all, rows, halfW, two, rowGap, top, width, step,
    legend, footH,
    height: top + boardH + 14 + footH,
    title: list.map(c => c.name).join('  ·  '),
  };
}

export async function drawHonoursPoster(careers, opts) {
  const P = POSTER, C = CARD;
  const L = honoursPosterLayout(careers, opts);
  const faces = await facesFor(careers);
  const avatar = await loadImage(opts.avatar || POSTER_AVATAR, false);

  const canvas = document.createElement('canvas');
  const density = L.width * P.scale > 16000 ? 1 : P.scale;
  canvas.width = Math.round(L.width * density);
  canvas.height = Math.round(L.height * density);
  const ctx = canvas.getContext('2d');
  ctx.scale(density, density);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, L.width, L.height);

  ctx.fillStyle = P.ink;
  ctx.font = '700 20px "Segoe UI", Roboto, system-ui, sans-serif';
  ctx.fillText('Honours', P.pad, 28);

  /* ⚠️ The left-hand player's results run **outward from the middle**, so the
     two careers' *best* results are the ones meeting at the spine. Reading a
     comparison means reading from the line outwards, and mirroring is what makes
     the two halves the same shape rather than two lists pointing the same way. */
  const leftEnd = P.pad + (L.two ? L.halfW : 0);
  const rightStart = leftEnd + C.spineW;

  if (L.two) drawWho(ctx, L.careers[0], P.pad, P.headH, L.halfW, faces, 'right');
  drawWho(ctx, L.careers[L.two ? 1 : 0], rightStart, P.headH,
    L.width - P.pad - rightStart, faces);

  let y = L.top;
  for (const row of L.rows) {
    const s = row.section;
    const side = row.side;

    ctx.fillStyle = P.dim;
    ctx.font = '400 11px "Segoe UI", Roboto, system-ui, sans-serif';
    const label = String(s.short || s.label);
    const lw = ctx.measureText(label).width;
    ctx.fillText(label, leftEnd + (C.spineW - lw) / 2, y + row.h / 2 + 4);

    L.careers.forEach((c, i) => {
      const mirror = L.two && i === 0;
      const list = c.honours.by.get(s.group) || [];
      const entered = c.honours.entries.get(s.group) || 0;
      const cy = y + (row.h - side) / 2;
      const step = side * (1 + C.hgap);

      // An empty row is not one thing: "entered twenty and never got there" and
      // "never played at this level" are both worth saying. The ghost says which.
      if (!list.length) {
        ctx.fillStyle = entered ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.03)';
        const gx = mirror ? leftEnd - C.hnW - side : rightStart + C.hnW;
        ctx.fillRect(gx, cy, side, side);
        return;
      }

      ctx.fillStyle = P.dim;
      ctx.font = `400 ${Math.min(12, Math.max(9, side * 0.6)).toFixed(0)}px `
        + '"Roboto Mono", Consolas, monospace';
      const n = String(list.length);
      // The count sits on the inside: it is the one piece of text worth having
      // and it should not be the first thing to fall off the end.
      ctx.fillText(n, mirror ? leftEnd - 4 - ctx.measureText(n).width : rightStart + 4,
        y + row.h / 2 + 4);

      list.forEach((cell, k) => {
        const x = mirror
          ? leftEnd - C.hnW - side - k * step
          : rightStart + C.hnW + k * step;
        drawResultCell(ctx, x, cy, side, cell.tier, !!cell.from);
      });
    });

    y += row.h + L.rowGap;
  }

  drawPosterFoot(ctx, L.width, L.height, L.footH, avatar, L.legend);
  return toPng(canvas);
}

/**
 * The last step, and the only one that can fail.
 *
 * ⚠️ A tainted canvas shows up here and nowhere earlier: every image will have
 * drawn perfectly first. See the note at the top about `crossOrigin`.
 */
function toPng(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(blob => blob ? resolve(blob)
        : reject(new Error('the browser would not encode the image')), 'image/png');
    } catch (e) {
      reject(new Error('the images would not come back readable (' + e.name + ')'));
    }
  });
}
