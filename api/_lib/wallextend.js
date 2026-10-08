// Extends the wall of an artwork photo to fill the whole page, so the photo
// has no visible edge: the work appears to hang on a wall that is the page.
//
// How: the photo keeps its place on the page; every page pixel outside it
// takes the colour of the nearest point on the photo's edge, read from a
// heavily smoothed copy of the photo (so lighting gradients continue but
// texture and small details do not), getting smoother with distance. Near
// the photo's edge the real pixels fade into that smoothed wall, and a touch
// of grain is added to the synthetic wall so it matches the photograph.
//
// It only works when there is plain wall (or floor) around the work. If the
// photo is cropped tight to the work, it returns null and the caller falls
// back to the normal layout.
let sharp = null;
try { sharp = require("sharp"); } catch (e) { sharp = null; }

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (t) => t * t * (3 - 2 * t);

// How much fine detail sits in the outer 4% of the photo: the share of
// pixels with a clear local edge (pencil line, brushstroke, object), measured
// on a 400 px greyscale copy. A photo with wall around the work has almost
// none there; a photo cropped tight to the work has plenty. Measured on the
// Eyes and Ears photos: wall photos 0 to 2.4%, tight crops 12 to 39%.
async function borderDetail(src, W, H) {
  const sw = 400, sh = Math.max(40, Math.round(400 * H / W));
  const g = await sharp(src, { raw: { width: W, height: H, channels: 3 } })
    .resize(sw, sh, { fit: "fill" }).greyscale().blur(0.8).raw().toBuffer();
  const band = Math.max(3, Math.round(Math.min(sw, sh) * 0.04));
  let strong = 0, n = 0;
  for (let y = 0; y < sh - 1; y++) {
    const inY = y < band || y >= sh - 1 - band;
    for (let x = 0; x < sw - 1; x++) {
      if (!inY && x >= band && x < sw - 1 - band) continue;
      const i = y * sw + x;
      const grad = Math.abs(g[i + 1] - g[i]) + Math.abs(g[i + sw] - g[i]);
      if (grad > 6) strong++;
      n++;
    }
  }
  return strong / n;
}

// Median colour of the border band: the plain wall colour the page drifts
// to far from the photo.
function borderColour(px, w, h, band) {
  const r = [], g = [], b = [];
  const add = (x, y) => { const i = (y * w + x) * 3; r.push(px[i]); g.push(px[i + 1]); b.push(px[i + 2]); };
  for (let k = 0; k < band; k++) {
    for (let x = 0; x < w; x++) { add(x, k); add(x, h - 1 - k); }
    for (let y = band; y < h - band; y++) { add(k, y); add(w - 1 - k, y); }
  }
  const med = (arr) => { arr.sort((p, q) => p - q); return arr[arr.length >> 1]; };
  return [med(r), med(g), med(b)];
}

// photoBuf: encoded image. rect: where the photo sits on the page (points).
// page: { w, h } in points. Returns { buf, detail } with a JPEG of the whole
// page, or { buf: null, detail } when the photo has no plain wall around the
// work (cropped tight), in which case the caller uses the normal layout.
async function extendToPage(photoBuf, rect, page, opts = {}) {
  if (!sharp) return { buf: null, detail: null };

  const { data: src, info } = await sharp(photoBuf).rotate().removeAlpha()
    .raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;

  // Tight crop (detail up to the edge): don't extend.
  const detail = await borderDetail(src, W, H);
  if (detail > (opts.maxDetail || 0.05)) return { buf: null, detail };

  // Small copies of the photo: plain (wall colour) and two smoothed ones.
  const k = 8;
  const sw = Math.max(16, Math.round(W / k)), sh = Math.max(16, Math.round(H / k));
  const base = sharp(src, { raw: { width: W, height: H, channels: 3 } }).resize(sw, sh, { fit: "fill" });
  const plain = await base.clone().raw().toBuffer();
  const WALL = borderColour(plain, sw, sh, 2);

  const near = await base.clone().blur(2.5).raw().toBuffer();
  const far = await base.clone().blur(9).raw().toBuffer();

  const s = W / rect.w;
  const CW = Math.round(page.w * s), CH = Math.round(page.h * s);
  const ox = Math.round(rect.x * s), oy = Math.round(rect.y * s);
  const F = Math.max(8, Math.round(Math.min(W, H) * 0.07)); // feather width (px)
  const reach = Math.min(W, H) * 0.25;                      // distance to full smoothing
  const settle = Math.min(W, H) * 0.6;                      // distance to the plain wall colour

  // Bilinear sample of a small smoothed copy at full-resolution coords.
  function sample(buf, px, py, out) {
    const fx = clamp((px + 0.5) / W * sw - 0.5, 0, sw - 1);
    const fy = clamp((py + 0.5) / H * sh - 0.5, 0, sh - 1);
    const x0 = fx | 0, y0 = fy | 0, x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1);
    const ax = fx - x0, ay = fy - y0;
    const i00 = (y0 * sw + x0) * 3, i10 = (y0 * sw + x1) * 3, i01 = (y1 * sw + x0) * 3, i11 = (y1 * sw + x1) * 3;
    for (let c = 0; c < 3; c++) {
      const top = buf[i00 + c] * (1 - ax) + buf[i10 + c] * ax;
      const bot = buf[i01 + c] * (1 - ax) + buf[i11 + c] * ax;
      out[c] = top * (1 - ay) + bot * ay;
    }
  }

  // 1) The synthetic wall is smooth, so it is computed at 1/4 resolution and
  //    scaled up by sharp (16x fewer pixels in JavaScript).
  const q = 4;
  const LW = Math.ceil(CW / q), LH = Math.ceil(CH / q);
  const low = Buffer.alloc(LW * LH * 3);
  const a = [0, 0, 0], b = [0, 0, 0];
  for (let ly = 0; ly < LH; ly++) {
    const py = ly * q + q / 2 - oy;
    for (let lx = 0; lx < LW; lx++) {
      const px = lx * q + q / 2 - ox;
      const cx = clamp(px, 0, W - 1), cy = clamp(py, 0, H - 1);
      // Smoothed edge colour, smoother further out, drifting to the plain
      // wall colour so edge shadows and vignetting don't get stretched.
      const dist = Math.hypot(px - cx, py - cy);
      const t = Math.min(1, dist / reach);
      const u = dist > 0 ? smoothstep(Math.min(1, dist / settle)) : 0;
      sample(near, cx, cy, a);
      if (t > 0) sample(far, cx, cy, b);
      const o = (ly * LW + lx) * 3;
      for (let c = 0; c < 3; c++) {
        const edge = a[c] * (1 - t) + b[c] * t;
        low[o + c] = edge * (1 - u) + WALL[c] * u;
      }
    }
  }
  const wall = await sharp(low, { raw: { width: LW, height: LH, channels: 3 } })
    .resize(CW, CH, { fit: "fill", kernel: "cubic" }).raw().toBuffer();

  // 2) Full resolution: the photo fades into the wall over its outer band,
  //    and the synthetic wall gets a little grain to match the photograph.
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  const out = Buffer.alloc(CW * CH * 3);
  for (let y = 0; y < CH; y++) {
    const py = y - oy;
    for (let x = 0; x < CW; x++) {
      const px = x - ox;
      const o = (y * CW + x) * 3;
      let alpha = 0;
      if (px >= 0 && py >= 0 && px < W && py < H) {
        const d = Math.min(px, py, W - 1 - px, H - 1 - py);
        alpha = d >= F ? 1 : smoothstep(d / F);
      }
      if (alpha === 1) {
        const i = (py * W + px) * 3;
        out[o] = src[i]; out[o + 1] = src[i + 1]; out[o + 2] = src[i + 2];
        continue;
      }
      const grain = rnd() * 3 * (1 - alpha);
      const i = alpha > 0 ? (py * W + px) * 3 : 0;
      for (let c = 0; c < 3; c++) {
        const v = alpha * (alpha > 0 ? src[i + c] : 0) + (1 - alpha) * wall[o + c] + grain;
        out[o + c] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }

  const buf = await sharp(out, { raw: { width: CW, height: CH, channels: 3 } })
    .jpeg({ quality: opts.quality || 82, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toBuffer();
  return { buf, detail };
}

// Where the work is inside the photo: { box, pxW, pxH }, with box as
// fractions of the photo's width and height ({ x0, y0, x1, y1 }). Pixels count as "work" when they differ from
// the wall colour or carry a clear local edge; rows and columns with only a
// few such pixels (noise, a nail) are ignored. Used to keep the caption off
// the work. box is null if nothing stands out.
async function findWork(photoBuf) {
  if (!sharp) return null;
  const meta = await sharp(photoBuf).rotate().metadata();
  const rotated = (meta.orientation || 1) >= 5;
  const pxW = rotated ? meta.height : meta.width, pxH = rotated ? meta.width : meta.height;
  const sw = 400;
  const { data: px, info } = await sharp(photoBuf).rotate().removeAlpha()
    .resize({ width: sw }).blur(0.8).raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const wall = borderColour(px, w, h, 3);
  const rows = new Array(h).fill(0), cols = new Array(w).fill(0);
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = (y * w + x) * 3;
      const diff = Math.max(Math.abs(px[i] - wall[0]), Math.abs(px[i + 1] - wall[1]), Math.abs(px[i + 2] - wall[2]));
      const lum = (j) => 0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2];
      const grad = Math.abs(lum(i + 3) - lum(i)) + Math.abs(lum(i + w * 3) - lum(i));
      if (diff > 22 || grad > 8) { rows[y]++; cols[x]++; }
    }
  }
  const first = (arr, min) => arr.findIndex((v) => v > min);
  const last = (arr, min) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] > min) return i; return -1; };
  const y0 = first(rows, w * 0.02), y1 = last(rows, w * 0.02);
  const x0 = first(cols, h * 0.02), x1 = last(cols, h * 0.02);
  const box = y0 < 0 || x0 < 0 ? null : { x0: x0 / w, y0: y0 / h, x1: (x1 + 1) / w, y1: (y1 + 1) / h };
  return { box, pxW, pxH };
}

module.exports = { extendToPage, findWork };
