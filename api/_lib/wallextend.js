// Extends the wall of an artwork photo to fill the whole page, so the photo
// has no visible edge: the work appears to hang on a wall that is the page.
//
// How: the photo keeps its place on the page. Beside it, every row of the
// page continues the colour of that row at the photo's edge; above and below
// it, every column continues its column's edge colour. Edge colours are
// medians across a thin band, smoothed along the edge without blurring
// across it, so the wall's light falloff, the floor and the skirting line
// carry on sharp instead of turning into smudges. The photo fades into that
// over a short band and the synthetic part gets a touch of grain.
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

  const s = W / rect.w;
  const CW = Math.round(page.w * s), CH = Math.round(page.h * s);
  const ox = Math.round(rect.x * s), oy = Math.round(rect.y * s);

  // Edge profiles: for every row, the colour of the photo's left and right
  // edge; for every column, the colour of its top and bottom edge. Each is
  // the median across a thin band (so grain and specks don't count), then
  // median-smoothed ALONG the edge, which keeps steps such as the floor line
  // or a skirting board sharp while removing texture.
  const bandX = Math.max(3, Math.round(W * 0.012)), bandY = Math.max(3, Math.round(H * 0.012));
  const median = (arr) => { arr.sort((p, q) => p - q); return arr[arr.length >> 1]; };
  function profile(len, band, pick, radiusFrac) {
    const out = [new Float32Array(len), new Float32Array(len), new Float32Array(len)];
    const tmp = [];
    for (let t = 0; t < len; t++) {
      for (let c = 0; c < 3; c++) {
        tmp.length = 0;
        for (let b = 0; b < band; b++) tmp.push(src[pick(t, b) + c]);
        out[c][t] = median(tmp);
      }
    }
    // smooth along the edge: running median, then a short mean. Sides use a
    // tiny radius so thin horizontal lines (skirting, floor edge) survive;
    // top and bottom a wide one so floor or wall texture doesn't turn into
    // vertical stripes.
    const r = Math.max(2, Math.round(len * radiusFrac));
    return out.map((ch) => {
      const med = new Float32Array(len), win = [];
      for (let t = 0; t < len; t++) {
        win.length = 0;
        for (let k = Math.max(0, t - r); k <= Math.min(len - 1, t + r); k++) win.push(ch[k]);
        med[t] = median(win);
      }
      const m = radiusFrac >= 0.01 ? r : 2;   // wide mean only for top/bottom
      const sm = new Float32Array(len);
      for (let t = 0; t < len; t++) {
        let a = 0, n = 0;
        for (let k = Math.max(0, t - m); k <= Math.min(len - 1, t + m); k++) { a += med[k]; n++; }
        sm[t] = a / n;
      }
      return sm;
    });
  }
  const idx = (x, y) => (y * W + x) * 3;
  const left = profile(H, bandX, (y, b) => idx(b, y), 0.0008);
  const right = profile(H, bandX, (y, b) => idx(W - 1 - b, y), 0.0008);
  const top = profile(W, bandY, (x, b) => idx(x, b), 0.04);
  const bottom = profile(W, bandY, (x, b) => idx(x, H - 1 - b), 0.04);

  // Synthetic wall at a page pixel: rows continue sideways, columns continue
  // up and down; beyond a corner, the two profiles meet at the corner colour.
  const wallAt = (px, py, c) => {
    const inX = px >= 0 && px < W, inY = py >= 0 && py < H;
    const cx = px < 0 ? 0 : px >= W ? W - 1 : px, cy = py < 0 ? 0 : py >= H ? H - 1 : py;
    if (inY && !inX) return (px < 0 ? left : right)[c][cy];
    if (inX && !inY) return (py < 0 ? top : bottom)[c][cx];
    if (!inX && !inY) {
      const row = (px < 0 ? left : right)[c][cy], col = (py < 0 ? top : bottom)[c][cx];
      return (row + col) / 2;
    }
    // inside the photo (feather band): profile of the nearest edge
    const d = [px, W - 1 - px, py, H - 1 - py];
    const m = Math.min(d[0], d[1], d[2], d[3]);
    if (m === d[0]) return left[c][cy];
    if (m === d[1]) return right[c][cy];
    if (m === d[2]) return top[c][cx];
    return bottom[c][cx];
  };

  const F = Math.max(6, Math.round(Math.min(W, H) * 0.02));   // short feather (px)
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
        const i = idx(px, py);
        out[o] = src[i]; out[o + 1] = src[i + 1]; out[o + 2] = src[i + 2];
        continue;
      }
      const grain = rnd() * 2.5 * (1 - alpha);
      const i = alpha > 0 ? idx(px, py) : 0;
      for (let c = 0; c < 3; c++) {
        const v = alpha * (alpha > 0 ? src[i + c] : 0) + (1 - alpha) * wallAt(px, py, c) + grain;
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
