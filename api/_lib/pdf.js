// Generates a PDF of a viewing room: /:slug/pdf  (rewritten to /api/room?vr=:slug&format=pdf).
// Lives in _lib (not a function of its own) because the Hobby plan caps a
// deployment at 12 serverless functions; api/room.js delegates to it.
//
// Mirrors what the room page shows: cover with title, dates and introduction,
// then installation views and one page per work, in the same order as the
// page (single rooms: works first, then installation views; sectioned rooms:
// views 1, works 1, views 2, works 2, views 3, works 3). Prices follow the
// same rule as the page: shown for Available and On hold works, hidden for
// Sold and Not available ones. Expired rooms return 410.
//
// Vercel limits a function response to ~4.5 MB. Images are embedded in the
// highest tier that fits: Airtable's "full" thumbnails for small rooms, and
// "large" for bigger ones (or whenever the first build is too heavy).
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const BASE_ID = "appkTmFvjmDLOQS4p";
const TBL_VR = "tbl8EUvqiOLudNvjv"; // Viewing Rooms
const TBL_ARTWORKS = "tblK8xDtKmakHWt6k";
const TBL_ARTISTS = "tbl3fHryX8bPSYMyN";

const MAX_BYTES = 4.2 * 1024 * 1024; // stay under Vercel's response limit
const FULL_TIER_MAX_IMAGES = 8;

const PAGE = { w: 595.28, h: 841.89, margin: 48 };

const ROOM_FIELDS = [
  "Name", "Start Date", "End Date", "Introduction", "Artworks",
  "Installation Views", "Expires", "URL slug",
  "Artworks 1", "Installation Views 1",
  "Artworks 2", "Installation Views 2",
  "Artworks 3", "Installation Views 3",
];
const ARTWORK_FIELDS = [
  "Title", "Year", "Year (display)", "Info (Backup)", "Status",
  "Price €", "Artist name", "Image",
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

function formatDates(start, end) {
  const parse = (d) => {
    if (!d) return null;
    const [y, m, day] = String(d).slice(0, 10).split("-").map(Number);
    return y && m && day ? { y, m, day } : null;
  };
  const fmt = (d, withYear) => d.day + " " + MONTHS[d.m - 1] + (withYear ? " " + d.y : "");
  const a = parse(start), b = parse(end);
  if (a && b) return fmt(a, a.y !== b.y) + " – " + fmt(b, true);
  if (a) return fmt(a, true);
  if (b) return "Until " + fmt(b, true);
  return "";
}

async function airtable(token, table, params) {
  const qs = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach((x) => qs.append(k + "[]", x));
    else qs.set(k, v);
  });
  const res = await fetch(
    "https://api.airtable.com/v0/" + BASE_ID + "/" + table + "?" + qs.toString(),
    { headers: { Authorization: "Bearer " + token } }
  );
  if (!res.ok) throw new Error("Airtable " + table + " " + res.status);
  return res.json();
}

async function fetchByIds(token, table, ids, fields) {
  const out = [];
  for (let i = 0; i < ids.length; i += 40) {
    const chunk = ids.slice(i, i + 40);
    const data = await airtable(token, table, {
      filterByFormula: "OR(" + chunk.map((id) => 'RECORD_ID()="' + id + '"').join(",") + ")",
      maxRecords: chunk.length,
      "fields": fields,
    });
    out.push(...(data.records || []));
  }
  return out;
}

// Small concurrency-limited map so a 30-work room doesn't open 30 sockets.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// An Airtable attachment -> { large, full } thumbnail URLs (falls back to the
// original file when no thumbnail exists, e.g. non-image files).
function attachmentTiers(att) {
  if (!att) return null;
  const t = att.thumbnails || {};
  return {
    large: (t.large && t.large.url) || att.url,
    full: (t.full && t.full.url) || (t.large && t.large.url) || att.url,
  };
}

async function downloadImage(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return null;
  }
}

function buildPdf({ room, items, imageFor, origin, slug }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: PAGE.margin,
      bufferPages: true,
      info: { Title: room.title + " — Diez Gallery", Author: "Diez Gallery" },
    });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const files = path.join(process.cwd(), "files");
    doc.registerFont("Replica", path.join(files, "Replica_Regular.woff2"));
    doc.registerFont("Replica-Bold", path.join(files, "Replica_Bold.woff2"));
    doc.registerFont("Replica-Italic", path.join(files, "Replica_Italic.woff2"));

    const W = PAGE.w - PAGE.margin * 2;
    const roomUrl = origin + "/" + encodeURIComponent(slug);

    function drawImage(buf, x, y, w, h, valign) {
      if (!buf) {
        doc.font("Replica").fontSize(8).fillColor("#999999")
          .text("NO IMAGE", x, y + h / 2 - 4, { width: w, align: "center", characterSpacing: 1 });
        return;
      }
      try {
        doc.image(buf, x, y, { fit: [w, h], align: "center", valign: valign || "center" });
      } catch (e) {
        doc.font("Replica").fontSize(8).fillColor("#999999")
          .text("IMAGE UNAVAILABLE", x, y + h / 2 - 4, { width: w, align: "center", characterSpacing: 1 });
      }
    }

    // ── Cover ──────────────────────────────────────────────────────────────
    try {
      doc.image(path.join(files, "logo.png"), PAGE.margin, PAGE.margin, { width: 90 });
    } catch (e) { /* logo is decorative */ }

    doc.font("Replica").fontSize(9).fillColor("#666666")
      .text("VIEWING ROOM", PAGE.margin, 170, { width: W, characterSpacing: 1.2 });
    doc.font("Replica-Bold").fontSize(30).fillColor("#000000")
      .text(room.title, PAGE.margin, doc.y + 8, { width: W });
    if (room.dates) {
      doc.font("Replica").fontSize(12).fillColor("#000000")
        .text(room.dates, PAGE.margin, doc.y + 8, { width: W });
    }
    if (room.intro) {
      doc.moveDown(2);
      const paras = room.intro.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
      paras.forEach((p, i) => {
        doc.font("Replica").fontSize(10.5).fillColor("#000000")
          .text(p, PAGE.margin, doc.y + (i ? 10 : 0), { width: Math.min(W, 420), lineGap: 3 });
      });
    }
    doc.font("Replica").fontSize(9).fillColor("#000000")
      .text(roomUrl.replace(/^https?:\/\//, ""), PAGE.margin, PAGE.h - 96, {
        width: W, link: roomUrl, underline: true,
      });

    // ── Pages ──────────────────────────────────────────────────────────────
    const imgBox = { x: PAGE.margin, y: 84, w: W, h: 500 };

    items.forEach((item) => {
      doc.addPage();
      const buf = imageFor(item);

      if (item.kind === "view") {
        // Installation view: image large, small caption.
        drawImage(buf, PAGE.margin, 84, W, PAGE.h - 84 - 110);
        doc.font("Replica").fontSize(8).fillColor("#666666")
          .text("INSTALLATION VIEW", PAGE.margin, PAGE.h - 86, {
            width: W, characterSpacing: 1,
          });
        return;
      }

      drawImage(buf, imgBox.x, imgBox.y, imgBox.w, imgBox.h, "bottom");

      const w = item.work;
      let y = imgBox.y + imgBox.h + 26;
      const colW = Math.min(W, 380);

      if (w.artist) {
        doc.font("Replica").fontSize(9).fillColor("#000000")
          .text(w.artist.toUpperCase(), PAGE.margin, y, { width: colW, characterSpacing: 1.1 });
      }
      doc.font("Replica-Bold").fontSize(17).fillColor("#000000")
        .text(w.title, PAGE.margin, doc.y + 4, { width: colW });
      if (w.year) {
        doc.font("Replica").fontSize(10.5).fillColor("#000000")
          .text(String(w.year), PAGE.margin, doc.y + 8, { width: colW });
      }
      if (w.info) {
        doc.font("Replica").fontSize(9.5).fillColor("#333333")
          .text(w.info, PAGE.margin, doc.y + 3, { width: colW, lineGap: 2 });
      }

      // Price + status block, same rules as the room page.
      doc.y += 12;
      if (w.price && w.showPrice) {
        doc.font("Replica-Bold").fontSize(11).fillColor("#000000")
          .text("€ " + Number(w.price).toLocaleString("de-DE"), PAGE.margin, doc.y, { width: colW });
        doc.y += 4;
      }
      doc.font("Replica").fontSize(8).fillColor(w.statusColor)
        .text(w.statusLabel.toUpperCase(), PAGE.margin, doc.y, { width: colW, characterSpacing: 1 });

      if (w.showPrice) {
        doc.font("Replica").fontSize(8.5).fillColor("#000000")
          .text("View online", PAGE.margin, doc.y + 10, {
            width: colW, link: roomUrl + "?work=" + w.id, underline: true,
          });
      }
    });

    // ── Header logo (pages after the cover) + contact footer (every page) ──
    const CONTACT = {
      address: "Gibraltarstraat 74-B, Amsterdam",
      email: "diego@diez.gallery",
      phone: "+31 633261845",
      web: "diez.gallery",
    };
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      const prevBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // allow writing in the bottom margin without a page break

      if (i > 0) {
        try {
          doc.image(path.join(files, "logo.png"), PAGE.margin, 30, { width: 44 });
        } catch (e) { /* logo is decorative */ }
      }

      const fy = PAGE.h - 34;
      doc.font("Replica").fontSize(7.5).fillColor("#666666");
      let x = PAGE.margin;
      const parts = [
        { t: CONTACT.address },
        { t: CONTACT.email, link: "mailto:" + CONTACT.email },
        { t: CONTACT.phone, link: "tel:" + CONTACT.phone.replace(/\s/g, "") },
        { t: CONTACT.web, link: "https://" + CONTACT.web },
      ];
      parts.forEach((part, idx) => {
        const txt = part.t + (idx < parts.length - 1 ? "   ·   " : "");
        doc.text(txt, x, fy, { lineBreak: false, link: part.link });
        x += doc.widthOfString(txt);
      });
      if (i > 0) {
        doc.text(String(i + 1), PAGE.w - PAGE.margin - 40, fy, {
          width: 40, align: "right", lineBreak: false,
        });
      }
      doc.page.margins.bottom = prevBottom;
    }

    doc.end();
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const token = process.env.AIRTABLE_PAT;
  if (!token) return res.status(500).json({ error: "AIRTABLE_PAT not configured" });

  const slug = String(req.query.vr || "").replace(/["\\]/g, "").slice(0, 100);
  if (!slug) return res.status(400).json({ error: "Missing viewing room" });

  try {
    // 1. Room record
    const vrData = await airtable(token, TBL_VR, {
      filterByFormula: '{URL slug} = "' + slug + '"',
      maxRecords: 1,
      fields: ROOM_FIELDS,
    });
    const rec = vrData.records && vrData.records[0];
    if (!rec) return res.status(404).json({ error: "Viewing room not found" });
    const vr = rec.fields;

    if (vr["Expires"] && new Date(vr["Expires"]) < new Date()) {
      return res.status(410).json({ error: "This viewing room is no longer available" });
    }

    // 2. Layout: sectioned rooms use Installation Views N + Artworks N,
    // otherwise Artworks + Installation Views (works first, then views).
    const sections = [1, 2, 3].map((no) => ({
      views: vr["Installation Views " + no] || [],
      workIds: vr["Artworks " + no] || [],
    })).filter((s) => s.views.length || s.workIds.length);
    const sectioned = sections.length > 0;

    const allWorkIds = [...new Set(
      sectioned ? sections.flatMap((s) => s.workIds) : (vr["Artworks"] || [])
    )];
    if (!allWorkIds.length) return res.status(404).json({ error: "This viewing room has no artworks yet" });

    // 3. Artworks + artist names
    const artworkRecs = await fetchByIds(token, TBL_ARTWORKS, allWorkIds, ARTWORK_FIELDS);
    const artistIds = [...new Set(artworkRecs.flatMap((a) => a.fields["Artist name"] || []))];
    const artistMap = {};
    if (artistIds.length) {
      (await fetchByIds(token, TBL_ARTISTS, artistIds, ["Name"])).forEach((a) => {
        artistMap[a.id] = a.fields["Name"] || "";
      });
    }

    const workById = new Map(artworkRecs.map((aw) => {
      const f = aw.fields;
      const status = (f["Status"] || "").trim();
      const onHold = status === "On hold";
      const sold = status === "Sold";
      const nonPublic = status === "Not available" || status === "Consigned" || status === "Offered";
      const available = !sold && !onHold && !nonPublic;
      let statusLabel = "Available", statusColor = "#5A7A5A";
      if (onHold) { statusLabel = "On hold"; statusColor = "#8A7A4A"; }
      else if (sold) { statusLabel = "Sold"; statusColor = "#999999"; }
      else if (!available) { statusLabel = "Not available"; statusColor = "#8A8072"; }
      return [aw.id, {
        id: aw.id,
        title: f["Title"] || "Untitled",
        artist: (f["Artist name"] || []).map((id) => artistMap[id]).filter(Boolean).join(", "),
        year: f["Year (display)"] || f["Year"] || "",
        info: f["Info (Backup)"] || "",
        price: f["Price €"] || null,
        showPrice: available || onHold,
        statusLabel, statusColor,
        tiers: attachmentTiers((f["Image"] || [])[0]),
      }];
    }));

    // Ordered work ids follow the drag order of the linked field, like the page.
    const workItem = (id) => (workById.has(id) ? { kind: "work", work: workById.get(id) } : null);
    const viewItems = (atts) => atts.map((att) => ({ kind: "view", tiers: attachmentTiers(att) }));

    let items;
    if (sectioned) {
      items = sections.flatMap((s) => [
        ...viewItems(s.views),
        ...s.workIds.map(workItem).filter(Boolean),
      ]);
    } else {
      items = [
        ...(vr["Artworks"] || []).map(workItem).filter(Boolean),
        ...viewItems(vr["Installation Views"] || []),
      ];
    }
    // A work linked twice only appears once.
    const seen = new Set();
    items = items.filter((it) => {
      if (it.kind !== "work") return true;
      if (seen.has(it.work.id)) return false;
      seen.add(it.work.id);
      return true;
    });

    // 4. Images, lazily per tier and cached.
    const cache = { large: new Map(), full: new Map() };
    async function loadTier(tier) {
      await mapLimit(items, 6, async (item, i) => {
        const url = item.kind === "view" ? item.tiers && item.tiers[tier] : item.work.tiers && item.work.tiers[tier];
        if (!url || cache[tier].has(i)) return;
        cache[tier].set(i, await downloadImage(url));
      });
    }

    const room = {
      title: vr["Name"] || "Viewing Room",
      dates: formatDates(vr["Start Date"], vr["End Date"]),
      intro: vr["Introduction"] || "",
    };
    const host = req.headers["x-forwarded-host"] || req.headers.host;
    const origin = "https://" + host;

    const imageCount = items.length;
    let tier = req.query.hq === "0" || imageCount > FULL_TIER_MAX_IMAGES ? "large" : "full";
    await loadTier(tier);
    let pdf = await buildPdf({
      room, items, origin, slug,
      imageFor: (item) => cache[tier].get(items.indexOf(item)) || null,
    });

    if (pdf.length > MAX_BYTES && tier === "full") {
      tier = "large";
      await loadTier(tier);
      pdf = await buildPdf({
        room, items, origin, slug,
        imageFor: (item) => cache[tier].get(items.indexOf(item)) || null,
      });
    }

    const safeName = (room.title || "viewing-room")
      .replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "viewing-room";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      (req.query.dl === "1" ? "attachment" : "inline") + '; filename="Diez-Gallery-' + safeName + '.pdf"'
    );
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).send(pdf);
  } catch (err) {
    console.error("pdf error:", err);
    return res.status(500).json({ error: "Could not generate the PDF" });
  }
};

// Shared with pdf2.js (same data access, different layout).
module.exports.helpers = {
  airtable, fetchByIds, mapLimit, attachmentTiers, downloadImage,
  TBL_VR, TBL_ARTWORKS, TBL_ARTISTS, ROOM_FIELDS, ARTWORK_FIELDS, MAX_BYTES, FULL_TIER_MAX_IMAGES,
};
