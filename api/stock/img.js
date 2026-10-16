// GET /api/stock/img?t=w&r=rec...&a=att...&s=s|l
//
// Stable, light image URLs for the stock tool.
//
// Airtable's attachment links are signed, change on every API call and expire
// after about two hours, so a phone could never reuse an image it had already
// downloaded, and the detail view was pulling Airtable's 3000px "full" file
// (several MB) over fair wifi. This route gives every image a permanent URL
// keyed on its attachment ID (an attachment never changes: replacing the
// image in Airtable creates a new ID), resizes it once with sharp, and lets
// the browser, the stock service worker and Vercel's CDN keep it for a year.
//
//   s  grid and to-scale view, fits 640 x 640, ~30-60 KB
//   l  detail, lightbox, share and print, fits 1600 x 1600, ~150-300 KB
//
// No session cookie on purpose, so the CDN can cache the bytes: the URL only
// works with both the record ID and the attachment ID, which only ever reach
// signed-in phones, and it returns nothing but the picture (the same artwork
// images the public /api/image proxy already serves for viewing rooms).

// Guarded like the PDF helpers: without sharp the picture is passed through
// unresized (still permanent and cached), instead of breaking the grid.
let sharp;
try { sharp = require("sharp"); } catch (e) { sharp = null; }
const { T, F, airtable } = require("../_lib/stock");

const EX_VIEWS = "fldJnsfNpePCHYnd9";
const TABLES = {
  w: { table: T.artworks, fields: [F.image, F.details, F.install] },
  x: { table: T.exhibitions, fields: [EX_VIEWS] },
};
const SIZES = {
  s: { box: 640, quality: 72 },
  l: { box: 1600, quality: 80 },
};

// Signed source links for recently seen attachments, reused for 50 minutes
// (Airtable signs them for about two hours). One record fetch covers every
// image of that work, and parallel requests for the same work share it.
const sources = new Map();
const pending = new Map();
const SOURCE_TTL = 50 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRecord(kind, rec) {
  const { table, fields } = TABLES[kind];
  const q = new URLSearchParams({ returnFieldsByFieldId: "true" });
  for (const f of fields) q.append("fields[]", f);
  for (let attempt = 0; ; attempt++) {
    try {
      // Single-record GET ignores fields[], so filter by RECORD_ID instead
      q.set("filterByFormula", "RECORD_ID()='" + rec + "'");
      q.set("maxRecords", "1");
      const data = await airtable(table + "?" + q.toString());
      const r = data.records && data.records[0];
      if (!r) return;
      const at = Date.now();
      for (const f of fields) {
        for (const a of r.fields[f] || []) {
          const th = a.thumbnails || {};
          sources.set(a.id, {
            full: (th.full && th.full.url) || a.url,
            large: (th.large && th.large.url) || (th.full && th.full.url) || a.url,
            at, rec,
          });
        }
      }
      return;
    } catch (err) {
      // Airtable allows 5 requests a second per base; a phone saving the
      // whole inventory for offline can briefly go over it.
      if (attempt < 3 && /Airtable 429/.test(err.message)) { await sleep(1200 * (attempt + 1)); continue; }
      throw err;
    }
  }
}

async function sourceFor(kind, rec, att) {
  const hit = sources.get(att);
  if (hit && hit.rec === rec && Date.now() - hit.at < SOURCE_TTL) return hit;
  const key = kind + rec;
  if (!pending.has(key)) {
    pending.set(key, fetchRecord(kind, rec).finally(() => pending.delete(key)));
  }
  await pending.get(key);
  const now = sources.get(att);
  return now && now.rec === rec ? now : null;
}

module.exports = async function handler(req, res) {
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (req.method !== "GET") return res.status(405).end();

  const { t, r, a, s } = req.query;
  if (!TABLES[t] || !SIZES[s] ||
      !/^rec[A-Za-z0-9]{14}$/.test(r || "") || !/^att[A-Za-z0-9]{14}$/.test(a || "")) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(400).end();
  }

  try {
    const found = await sourceFor(t, r, a);
    if (!found) {
      res.setHeader("Cache-Control", "public, max-age=60");
      return res.status(404).end();
    }
    const src = await fetch(sharp || s === "l" ? found.full : found.large);
    if (!src.ok) throw new Error("source " + src.status);
    const input = Buffer.from(await src.arrayBuffer());

    if (!sharp) {
      res.setHeader("Content-Type", src.headers.get("content-type") || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=86400");
      return res.status(200).send(input);
    }

    const { box, quality } = SIZES[s];
    const out = await sharp(input, { failOn: "none" })
      .rotate() // honour the camera's orientation before EXIF is stripped
      .resize({ width: box, height: box, fit: "inside", withoutEnlargement: true })
      .toColourspace("srgb")
      // Progressive: on a weak connection a blurry version appears at once
      // and sharpens as it arrives, instead of drawing top to bottom.
      .jpeg({ quality, mozjpeg: true, progressive: true })
      .toBuffer();

    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
    return res.status(200).send(out);
  } catch (err) {
    console.error("stock img error:", err.message);
    res.setHeader("Cache-Control", "no-store");
    return res.status(502).end();
  }
};
