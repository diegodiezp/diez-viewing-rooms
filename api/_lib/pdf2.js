// "pdf2": a second PDF layout modelled on the gallery's hand-made exhibition
// PDF (InDesign), to compare against the standard one in pdf.js.
// URL: /:slug/pdf2  (rewritten to /api/room?vr=:slug&format=pdf2).
//
// A4 landscape. Order: first installation view, title page, remaining
// installation views, then one page per work (sectioned rooms keep the room's
// own order: views 1, works 1, views 2, ...), the room introduction as a text
// page, and a closing page with terms and contact details. Same data access,
// status and price rules as pdf.js.
//
// Work pages: the wall of each photo is extended to fill the whole page (see
// wallextend.js), with the work placed as large as possible beside or above a
// caption at the bottom left. Photos cropped tight to the work (no wall
// around it) keep the white, centred layout. ?wall=0 turns this off.
const path = require("path");
const PDFDocument = require("pdfkit");
const {
  airtable, fetchByIds, attachmentTiers, mapLimit,
  TBL_VR, TBL_ARTWORKS, TBL_ARTISTS, ROOM_FIELDS, ARTWORK_FIELDS, MAX_BYTES,
} = require("./pdf").helpers;
const { prepareImages } = require("./pdfimages");
const { extendToPage, findWork } = require("./wallextend");

const P = { w: 841.89, h: 595.28, m: 36 };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return n + "th";
  return n + ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
}

// "September 5th - October 31st, 2026"
function formatDatesLong(start, end) {
  const parse = (d) => {
    if (!d) return null;
    const [y, m, day] = String(d).slice(0, 10).split("-").map(Number);
    return y && m && day ? { y, m, day } : null;
  };
  const f = (d) => MONTHS[d.m - 1] + " " + ordinal(d.day);
  const a = parse(start), b = parse(end);
  if (a && b) return f(a) + (a.y !== b.y ? ", " + a.y : "") + " - " + f(b) + ", " + b.y;
  if (a) return f(a) + ", " + a.y;
  if (b) return "Until " + f(b) + ", " + b.y;
  return "";
}

// "Info (Backup)" is: [medium] blank line, dimensions (+ framed / extra lines).
function splitInfo(info) {
  const parts = String(info || "").split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { medium: "", lines: [] };
  if (parts.length === 1) {
    return /\bcm\b/.test(parts[0])
      ? { medium: "", lines: parts[0].split("\n") }
      : { medium: parts[0], lines: [] };
  }
  return { medium: parts[0], lines: parts.slice(1).join("\n").split("\n").filter(Boolean) };
}

function surname(name) {
  const w = String(name).trim().split(/\s+/);
  return w[w.length - 1] || "";
}

const FILES = path.join(process.cwd(), "files");
function registerFonts(doc) {
  doc.registerFont("Replica", path.join(FILES, "Replica_Regular.woff2"));
  doc.registerFont("Replica-Bold", path.join(FILES, "Replica_Bold.woff2"));
  doc.registerFont("Replica-Italic", path.join(FILES, "Replica_Italic.woff2"));
}

const priceText = (w) => Number(w.price).toLocaleString("de-DE").replace(/\./g, "") + " EUR";

// Caption for the extended-wall work page (bottom left), as drawable lines:
// [font, size, colour, text, gap above, extra options].
const CAPTION_W = 190;
function captionLines(w) {
  const L = [];
  if (w.artist) L.push(["Replica-Bold", 11, "#1a1a1a", w.artist, 0]);
  L.push(["Replica-Italic", 11, "#1a1a1a", w.title + (w.year ? ", " + w.year : ""), L.length ? 1 : 0]);
  if (w.medium) L.push(["Replica", 8.5, "#444444", w.medium, 10]);
  w.lines.forEach((ln, i) => L.push(["Replica", 8.5, "#444444", ln, i === 0 && !w.medium ? 10 : 3]));
  if (w.price && w.showPrice) L.push(["Replica-Bold", 9, "#1a1a1a", priceText(w), 12]);
  if (w.statusLabel !== "Available") L.push(["Replica", 7.5, "#777777", w.statusLabel.toUpperCase(), 4, { characterSpacing: 1 }]);
  return L;
}
function captionHeight(doc, lines) {
  return lines.reduce((h, [f, s, , t, gap, o]) => {
    doc.font(f).fontSize(s);
    return h + gap + doc.heightOfString(t, Object.assign({ width: CAPTION_W }, o || {}));
  }, 0);
}

// Where the photo goes on an extended-wall page. The WORK (found inside the
// photo) is made as large as possible either to the right of the caption or
// above it, within the page margins; the photo's own wall may run off the
// page. It never gets smaller than the plain fitted photo would, and is only
// enlarged while the photo stays at 140 ppi or more.
const CAPTION_BOTTOM = 552;
function placeWork(found, capH) {
  const r = found.pxW / found.pxH;
  const bw = P.w - 2 * P.m, bh = 555;
  const fitW = Math.min(bw, bh * r);
  if (!found.box) {
    const pw = fitW, ph = pw / r;
    return { x: P.m + (bw - pw) / 2, y: 20 + (bh - ph) / 2, w: pw, h: ph };
  }
  const pad = 0.04, B = found.box;
  const a = Math.max(0, B.x0 - pad), b = Math.min(1, B.x1 + pad);
  const c = Math.max(0, B.y0 - pad), d = Math.min(1, B.y1 + pad);
  const cap = { x1: P.m + CAPTION_W + 16, y0: CAPTION_BOTTOM - capH - 16 };
  const top = 40, bot = P.h - 36, left = P.m, right = P.w - P.m;
  const maxPw = Math.max(fitW, found.pxW / 140 * 72);
  const zones = [
    { x0: cap.x1, x1: right, y0: top, y1: bot },   // beside the caption
    { x0: left, x1: right, y0: top, y1: cap.y0 },  // above the caption
  ];
  let best = null;
  zones.forEach((z) => {
    const pw = Math.min((z.x1 - z.x0) / (b - a), (z.y1 - z.y0) * r / (d - c), maxPw);
    if (!(pw > 0)) return;
    const ph = pw / r, ww = (b - a) * pw, wh = (d - c) * ph;
    let wx = (P.w - ww) / 2;                 // centred on the page when it fits
    if (wx < z.x0) wx = z.x0;
    if (wx + ww > z.x1) wx = z.x1 - ww;
    const wy = z.y0 + (z.y1 - z.y0 - wh) / 2;
    if (!best || pw > best.w) best = { x: wx - a * pw, y: wy - c * ph, w: pw, h: ph };
  });
  return best;
}

function buildPdf2({ room, participants, items, imageFor, wallFor, introParas }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: [P.w, P.h],
      margin: 0,
      info: { Title: room.title + " - Diez Gallery", Author: "Diez Gallery" },
    });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const files = FILES;
    registerFonts(doc);
    const INK = "#1a1a1a";

    function drawImage(buf, x, y, w, h, valign) {
      if (!buf) return;
      try {
        doc.image(buf, x, y, { fit: [w, h], align: "center", valign: valign || "center" });
      } catch (e) { /* unsupported image: leave the page blank */ }
    }
    function logo(x, y, w) {
      try { doc.image(path.join(files, "logo.png"), x, y, { width: w }); } catch (e) { /* decorative */ }
    }
    let first = true;
    function newPage() { if (first) first = false; else doc.addPage(); }

    function titlePage() {
      newPage();
      doc.font("Replica-Bold").fillColor(INK).fontSize(58)
        .text(room.title, P.m, 22, { width: 470, lineGap: -6 });
      if (participants.length) {
        doc.font("Replica-Bold").fontSize(26)
          .text(participants.join(", "), P.m, doc.y + 12, { width: 470, lineGap: 2 });
      }
      if (room.datesLong) {
        doc.font("Replica-Bold").fontSize(15)
          .text(room.datesLong, P.m, doc.y + 18, { width: 470 });
      }
      logo(P.m, P.h - 80, 94);
    }

    // Installation views bleed off all four edges: the image is scaled to
    // cover the page and the overflow is cropped (centred). Portrait views
    // would lose most of their content when cropped to landscape, so those
    // are fitted instead.
    function viewPage(buf) {
      newPage();
      if (!buf) return;
      try {
        const img = doc.openImage(buf);
        if (img.width / img.height >= 1) {
          doc.image(img, 0, 0, { cover: [P.w, P.h], align: "center", valign: "center" });
          return;
        }
      } catch (e) { /* fall through to the fitted version */ }
      drawImage(buf, 0, 16, P.w, P.h - 32);
    }

    // Quiet branding for the work pages (the full-bleed views, title page and
    // closing page carry none): a small black logo top left and one
    // line of contact details in light grey at the bottom.
    function workBranding() {
      try {
        doc.image(path.join(files, "logo.png"), P.m, 20, { width: 32 });
      } catch (e) { /* decorative */ }
      const parts = [
        { t: "Gibraltarstraat 74-B, Amsterdam" },
        { t: "diego@diez.gallery", link: "mailto:diego@diez.gallery" },
        { t: "+31 6 33261845", link: "tel:+31633261845" },
        { t: "diez.gallery", link: "https://diez.gallery" },
      ];
      doc.font("Replica").fontSize(6.5).fillColor("#a3a3a3");
      let x = P.m;
      const y = P.h - 24;
      parts.forEach((part, i) => {
        const txt = part.t + (i < parts.length - 1 ? "   ·   " : "");
        doc.text(txt, x, y, { lineBreak: false, link: part.link });
        x += doc.widthOfString(txt);
      });
    }

    function workPage(w, buf) {
      newPage();
      drawImage(buf, 126, 36, 590, 392, "center");
      const cw = 560, cx = (P.w - cw) / 2;
      let y = 448;
      doc.font("Replica-Italic").fontSize(11.5).fillColor(INK);
      if (w.artist) { doc.text(w.artist, cx, y, { width: cw, align: "center" }); y = doc.y; }
      doc.text(w.title + (w.year ? ", " + w.year : ""), cx, y + 1, { width: cw, align: "center" });
      y = doc.y + 7;
      doc.font("Replica").fontSize(9);
      if (w.medium) { doc.text(w.medium, cx, y, { width: cw, align: "center" }); y = doc.y + 4; }
      w.lines.forEach((ln) => { doc.text(ln, cx, y, { width: cw, align: "center" }); y = doc.y + 4; });
      y = Math.max(y + 12, 528);
      if (w.price && w.showPrice) {
        doc.font("Replica-Bold").fontSize(9).fillColor(INK)
          .text(priceText(w), cx, y, { width: cw, align: "center" });
        y = doc.y + 3;
      }
      if (w.statusLabel !== "Available") {
        doc.font("Replica").fontSize(7.5).fillColor("#888888")
          .text(w.statusLabel.toUpperCase(), cx, y, { width: cw, align: "center", characterSpacing: 1 });
      }
      workBranding();
    }

    // Work page on an extended wall: the page image already contains the
    // photo and its wall; caption bottom left, contact bottom right.
    function wallWorkPage(w, wallBuf) {
      newPage();
      doc.image(wallBuf, 0, 0, { width: P.w, height: P.h });
      logo(P.m, 20, 32);
      const lines = captionLines(w);
      let y = CAPTION_BOTTOM - captionHeight(doc, lines);
      lines.forEach(([f, s, col, t, gap, o]) => {
        y += gap;
        doc.font(f).fontSize(s).fillColor(col).text(t, P.m, y, Object.assign({ width: CAPTION_W }, o || {}));
        y = doc.y;
      });
      const parts = [
        { t: "Gibraltarstraat 74-B, Amsterdam" },
        { t: "diego@diez.gallery", link: "mailto:diego@diez.gallery" },
        { t: "+31 6 33261845", link: "tel:+31633261845" },
        { t: "diez.gallery", link: "https://diez.gallery" },
      ];
      doc.font("Replica").fontSize(6.5).fillColor("#8f8f8f");
      const sep = "   ·   ";
      const total = parts.reduce((n, p, i) => n + doc.widthOfString(p.t + (i < parts.length - 1 ? sep : "")), 0);
      let x = P.w - P.m - total;
      parts.forEach((part, i) => {
        const txt = part.t + (i < parts.length - 1 ? sep : "");
        doc.text(txt, x, P.h - 22, { lineBreak: false, link: part.link });
        x += doc.widthOfString(txt);
      });
    }

    function textPage(paras) {
      newPage();
      let y = 40;
      paras.forEach((p, i) => {
        doc.font("Replica").fontSize(11).fillColor(INK)
          .text(p, P.m, y + (i ? 14 : 0), { width: 405, align: "justify", lineGap: 3.4 });
        y = doc.y;
      });
    }

    function closingPage() {
      newPage();
      doc.font("Replica-Bold").fontSize(15).fillColor(INK)
        .text("All prices exclude 9% VAT and exclude shipping", P.m, 40, { width: 600 })
        .text("Works subject to availability", P.m, doc.y + 1, { width: 600 });
      const LINK = "#4F52D9";
      doc.font("Replica").fontSize(15);
      doc.fillColor(LINK).text("diego@diez.gallery", P.m, 190, { link: "mailto:diego@diez.gallery", underline: true });
      doc.fillColor(INK).text("+31 6 33261845", P.m, doc.y + 1, { underline: false });
      doc.fillColor(LINK).text("@diez.gallery", P.m, doc.y + 20, { link: "https://instagram.com/diez.gallery", underline: true });
      doc.fillColor(LINK).text("www.diez.gallery", P.m, doc.y + 1, { link: "https://diez.gallery", underline: true });
      logo(P.m, P.h - 80, 94);
    }

    // First installation view, title page, the rest in order, then closing.
    let titleDone = false;
    const firstViewIdx = items.findIndex((it) => it.kind === "view");
    items.forEach((it, i) => {
      if (it.kind === "view") {
        viewPage(imageFor(it));
        if (i === firstViewIdx) { titlePage(); titleDone = true; }
      } else {
        if (!titleDone) { titlePage(); titleDone = true; }
        const wallBuf = wallFor ? wallFor(it) : null;
        if (wallBuf) wallWorkPage(it.work, wallBuf);
        else workPage(it.work, imageFor(it));
      }
    });
    if (!titleDone) titlePage();
    if (introParas.length) textPage(introParas);
    closingPage();
    doc.end();
  });
}

// Builds the pdf2 file for a room. Used by the Vercel endpoint (with the
// response-size budget) and by scripts/build-pdf.js on GitHub Actions (no
// budget: full-resolution images). Returns { pdf, title } or { error, status }.
async function generatePdf2({ slug, token, wallMode = true, maxBytes = MAX_BYTES, caps = { view: 2200, work: 1600 }, withModel = false }) {
  const vrData = await airtable(token, TBL_VR, {
    filterByFormula: '{URL slug} = "' + slug + '"', maxRecords: 1, fields: ROOM_FIELDS,
  });
  const rec = vrData.records && vrData.records[0];
  if (!rec) return { status: 404, error: "Viewing room not found" };
  const vr = rec.fields;
  if (vr["Expires"] && new Date(vr["Expires"]) < new Date()) {
    return { status: 410, error: "This viewing room is no longer available" };
  }

  const sections = [1, 2, 3].map((no) => ({
    views: vr["Installation Views " + no] || [],
    workIds: vr["Artworks " + no] || [],
  })).filter((s) => s.views.length || s.workIds.length);
  const sectioned = sections.length > 0;

  const allWorkIds = [...new Set(sectioned ? sections.flatMap((s) => s.workIds) : (vr["Artworks"] || []))];
  if (!allWorkIds.length) return { status: 404, error: "This viewing room has no artworks yet" };

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
    const onHold = status === "On hold", sold = status === "Sold";
    const nonPublic = status === "Not available" || status === "Consigned" || status === "Offered";
    const available = !sold && !onHold && !nonPublic;
    const info = splitInfo(f["Info (Backup)"]);
    return [aw.id, {
      id: aw.id,
      title: f["Title"] || "Untitled",
      artist: (f["Artist name"] || []).map((id) => artistMap[id]).filter(Boolean).join(", "),
      year: f["Year (display)"] || f["Year"] || "",
      medium: info.medium, lines: info.lines,
      price: f["Price €"] || null,
      showPrice: available || onHold,
      statusLabel: onHold ? "On hold" : sold ? "Sold" : available ? "Available" : "Not available",
      tiers: attachmentTiers((f["Image"] || [])[0]),
    }];
  }));

  const workItem = (id) => (workById.has(id) ? { kind: "work", work: workById.get(id) } : null);
  const viewItems = (atts) => atts.map((att) => ({ kind: "view", tiers: attachmentTiers(att) }));

  // Sectioned rooms keep their own order. Single rooms: installation views
  // first, then the works (the order of the gallery's hand-made PDFs).
  let items = sectioned
    ? sections.flatMap((s) => [...viewItems(s.views), ...s.workIds.map(workItem).filter(Boolean)])
    : [...viewItems(vr["Installation Views"] || []), ...(vr["Artworks"] || []).map(workItem).filter(Boolean)];
  const seen = new Set();
  items = items.filter((it) => {
    if (it.kind !== "work") return true;
    if (seen.has(it.work.id)) return false;
    seen.add(it.work.id);
    return true;
  });

  // Participants: every artist in the room, alphabetical by surname.
  const names = new Set();
  items.forEach((it) => it.kind === "work" && it.work.artist &&
    it.work.artist.split(", ").forEach((n) => names.add(n)));
  const participants = [...names].sort((a, b) => surname(a).localeCompare(surname(b)));

  const room = {
    title: vr["Name"] || "Viewing Room",
    datesLong: formatDatesLong(vr["Start Date"], vr["End Date"]),
  };
  const introParas = String(vr["Introduction"] || "").split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  // Images: "full" thumbnails re-encoded (see pdfimages.js). Within a size
  // budget the extended walls need some room; without one, nothing shrinks.
  const limited = Number.isFinite(maxBytes);
  const imgs = await prepareImages({
    entries: items.map((it) => ({
      urls: it.kind === "view" ? it.tiers : it.work.tiers,
      cap: it.kind === "view" ? caps.view : caps.work,
    })),
    budgetBytes: limited ? maxBytes - (wallMode ? 1100 : 300) * 1024 : Infinity,
  });

  // Extended-wall pages for the works (null = keep the white layout).
  const measure = new PDFDocument({ size: [P.w, P.h], margin: 0 });
  registerFonts(measure);
  async function makeWalls(quality) {
    return mapLimit(items, 2, async (it, i) => {
      if (!wallMode || it.kind !== "work" || !imgs[i]) return null;
      try {
        const found = await findWork(imgs[i]);
        if (!found) return null;
        const rect = placeWork(found, captionHeight(measure, captionLines(it.work)));
        const { buf } = await extendToPage(imgs[i], rect, P, { quality });
        return buf;
      } catch (e) {
        console.error("pdf2 wall error:", e);
        return null;
      }
    });
  }
  const build = (walls) => buildPdf2({
    room, participants, items, introParas,
    imageFor: (item) => imgs[items.indexOf(item)] || null,
    wallFor: (item) => (walls && walls[items.indexOf(item)]) || null,
  });

  let walls = await makeWalls(limited ? 82 : 88);
  let pdf = await build(walls);
  if (limited && pdf.length > maxBytes && wallMode) {   // too heavy: lighter walls
    walls = await makeWalls(66);
    pdf = await build(walls);
  }
  if (limited && pdf.length > maxBytes && wallMode) pdf = await build(null);
  const out = { pdf, title: room.title, recordId: rec.id };
  // The page model, for the InDesign export (scripts/idml.js).
  if (withModel) out.model = { room, participants, items, imgs, walls, introParas };
  return out;
}

function safeFileName(title) {
  return (title || "viewing-room").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "viewing-room";
}

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const token = process.env.AIRTABLE_PAT;
  if (!token) return res.status(500).json({ error: "AIRTABLE_PAT not configured" });

  const slug = String(req.query.vr || "").replace(/["\\]/g, "").slice(0, 100);
  if (!slug) return res.status(400).json({ error: "Missing viewing room" });

  try {
    const out = await generatePdf2({ slug, token, wallMode: req.query.wall !== "0" });
    if (out.error) return res.status(out.status).json({ error: out.error });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition",
      (req.query.dl === "1" ? "attachment" : "inline") + '; filename="Diez-Gallery-' + safeFileName(out.title) + '-2.pdf"');
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).send(out.pdf);
  } catch (err) {
    console.error("pdf2 error:", err);
    return res.status(500).json({ error: "Could not generate the PDF" });
  }
}

module.exports = handler;
module.exports.generatePdf2 = generatePdf2;
module.exports.safeFileName = safeFileName;
module.exports.layout = { P, CAPTION_W, CAPTION_BOTTOM, captionLines, priceText };
