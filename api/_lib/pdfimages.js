// Prepares the images for a PDF so the whole file fits in Vercel's ~4.5 MB
// response limit while keeping as much resolution as that allows.
//
// Instead of Airtable's tiny "large" thumbnails (512 px), this downloads the
// "full" ones (up to 3000 px), then re-encodes every image with sharp. All
// images start at their own size cap (cap = longest side in px) and, if the
// total is over budget, are scaled down together by the same factor so the
// relative sizes stay similar. Few works -> near-original quality; 40 pages
// -> about 1000-1300 px each, which is sharp on screen.
//
// If sharp can't be loaded, or an image can't be processed, it falls back to
// the plain "large" thumbnail, so a PDF is always produced.
let sharp = null;
try { sharp = require("sharp"); } catch (e) { sharp = null; }

async function download(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return null;
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function encode(buf, longestSide, quality) {
  return sharp(buf, { failOn: "none" })
    .rotate() // apply EXIF orientation; pdfkit ignores it
    .resize({ width: longestSide, height: longestSide, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" }) // no alpha channel in the PDF
    .jpeg({ quality, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

// entries: [{ urls: { full, large }, cap }]  ->  array of Buffer|null
async function prepareImages({ entries, budgetBytes }) {
  const originals = await mapLimit(entries, 6, async (e) => {
    if (!e || !e.urls) return null;
    return (sharp && e.urls.full && (await download(e.urls.full))) || null;
  });

  async function fallback(i) {
    const url = entries[i] && entries[i].urls && (entries[i].urls.large || entries[i].urls.full);
    return url ? download(url) : null;
  }

  if (!sharp) return mapLimit(entries, 6, (_, i) => fallback(i));

  const q = 82;
  const have = originals.map((b, i) => (b ? i : -1)).filter((i) => i >= 0);
  const encodeAll = (scale, quality) => mapLimit(originals, 4, async (buf, i) => {
    if (!buf) return null;
    try { return await encode(buf, Math.max(300, Math.round(entries[i].cap * scale)), quality); } catch (e) { return null; }
  });
  const total = (arr) => arr.reduce((n, b) => n + (b ? b.length : 0), 0);

  // Probe: encode up to 3 images at full cap to learn how many bytes a
  // typical image costs, then pick one scale for the whole set (bytes grow
  // roughly with pixel count). This avoids encoding every image twice.
  let scale = 1;
  if (have.length) {
    const probe = have.slice(0, 3);
    let probeBytes = 0;
    for (const i of probe) {
      try { probeBytes += (await encode(originals[i], entries[i].cap, q)).length; } catch (e) { /* skip */ }
    }
    const perImage = probeBytes / probe.length;
    const est = perImage * have.length;
    if (est > budgetBytes) scale = Math.max(0.25, Math.sqrt(budgetBytes / est) * 0.95);
  }

  let encoded = await encodeAll(scale, scale < 0.6 ? 76 : q);
  // Safety net: if the real total is still over budget, shrink and redo.
  for (let round = 0; round < 2 && total(encoded) > budgetBytes && scale > 0.25; round++) {
    scale = Math.max(0.25, scale * Math.sqrt(budgetBytes / total(encoded)) * 0.95);
    encoded = await encodeAll(scale, scale < 0.6 ? 74 : q);
  }

  // Anything that failed to process falls back to the small thumbnail.
  return mapLimit(encoded, 6, async (b, i) => b || fallback(i));
}

module.exports = { prepareImages };
