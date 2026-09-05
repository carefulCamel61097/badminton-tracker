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
  const k = Math.max(side / im.naturalWidth, side / im.naturalHeight);
  const sw = side / k, sh = side / k;
  ctx.drawImage(im, (im.naturalWidth - sw) / 2, 0, sw, sh, x, y, side, side);
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
  const legend = [
    'Every square is a title, sized by what it was worth',
    bars.length
      ? `A bar spans the seasons somebody won ${reignStep(opts.min).n}+ of them`
      : '',
    columns.some(c => c.rows.some(r => r.tiles.some(t => t.mark)))
      ? 'A dashed square, ⁕ by its year, was played in a different year'
      : '',
  ].filter(Boolean);
  const footH = 24 + Math.max(2, legend.length) * 15;

  return {
    years, from, to, columns, bars, lanes, at, stackH,
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
  for (const col of L.columns) {
    for (const row of col.rows) for (const t of row.tiles) if (t.who && t.who.a) wants.add(t.who.a);
  }
  for (const b of L.bars) {
    if (b.who && b.who.a) wants.add(b.who.a);
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
          drawTile(ctx, t, tx, ty, side, faces);
          // The summit marks hang off the left of the photograph, in the space
          // the slot reserved for them.
          const bw = badgeWidth(side);
          if (String(t.tier) === 'OLY') {
            drawRings(ctx, tx - bw - 3,
              ty + side / 2 - bw * (RING_BOX[1] / RING_BOX[0]) / 2, bw);
          } else if (String(t.tier) === '20') {
            drawCup(ctx, tx - bw - 3, ty + side / 2 - bw / 2, bw);
          }
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
        * (y.n - L.bar) / Math.max(1, L.peak - L.bar)).toFixed(3));
      ctx.fillStyle = b.colour;
      ctx.fillRect(y.x, top, right - y.x, P.laneH);
    }
    ctx.globalAlpha = 1;

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

    const fim = b.who && b.who.a ? faces.get(b.who.a) : null;
    const fs = P.laneH - 10;
    ctx.save();
    ctx.beginPath();
    ctx.arc(b.x + 5 + fs / 2, top + P.laneH / 2, fs / 2, 0, Math.PI * 2);
    ctx.clip();
    if (fim) drawCover(ctx, fim, b.x + 5, top + 5, fs);
    else {
      ctx.fillStyle = 'rgba(255,255,255,.10)';
      ctx.fillRect(b.x + 5, top + 5, fs, fs);
    }
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

  // ---- where it came from ----
  const fy = L.height - L.footH + 10;
  ctx.strokeStyle = 'rgba(255,255,255,.10)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(P.pad, fy - 8.5);
  ctx.lineTo(L.width - P.pad, fy - 8.5);
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

  /* ⚠️ A legend, because an export leaves the page behind. On screen the bars
     have a picker beside them saying 3+ and every square has a tooltip; in a
     feed there is nothing but the picture, and a reader who cannot tell what a
     bar means will read it as a ranking. */
  ctx.textAlign = 'right';
  for (const [i, line] of L.legend.entries()) {
    ctx.fillStyle = P.dim;
    ctx.font = '400 12px "Segoe UI", Roboto, system-ui, sans-serif';
    ctx.fillText(line, L.width - P.pad, fy + 12 + i * 15);
  }
  ctx.textAlign = 'left';

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

function drawTile(ctx, t, x, y, side, faces) {
  const ring = TIER_RING[String(t.tier)];
  ctx.save();
  roundRect(ctx, x, y, side, side, 3);
  ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,.06)';
  ctx.fillRect(x, y, side, side);
  const im = t.who && t.who.a ? faces.get(t.who.a) : null;
  if (im) drawCover(ctx, im, x, y, side);
  else {
    ctx.fillStyle = '#9a9a9a';
    ctx.font = `700 ${Math.max(8, Math.round(side * 0.32))}px "Segoe UI", Roboto, sans-serif`;
    const ini = initialsOf(t.who && t.who.n);
    ctx.fillText(ini, x + (side - ctx.measureText(ini).width) / 2, y + side / 2 + side * 0.12);
  }
  ctx.restore();

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
}
