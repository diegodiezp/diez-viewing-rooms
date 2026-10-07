// "pdf2": a second PDF layout modelled on the gallery's hand-made exhibition
// PDF (InDesign), to compare against the standard one in pdf.js.
// URL: /:slug/pdf2  (rewritten to /api/room?vr=:slug&format=pdf2).
//
// A4 landscape. Order: first installation view, title page, remaining
// installation views, then one page per work (sectioned rooms keep the room's
// own order: views 1, works 1, views 2, ...), the room introduction as a text
// page, and a closing page with terms and contact details. No running
// header/footer. Same data access, status and price rules as pdf.js.
const path = require("path");
const PDFDocument = require("pdfkit");
const {
  airtable, fetchByIds, mapLimit, attachmentTiers, downloadImage,
  TBL_VR, TBL_ARTWORKS, TBL_ARTISTS, ROOM_FIELDS, ARTWORK_FIELDS, MAX_BYTES, FULL_TIER_MAX_IMAGES,
} = require("./pdf").helpers;

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

function buildPdf2({ room, participants, items, imageFor, introParas }) {
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

    const files = path.join(process.cwd(), "files");
    doc.registerFont("Replica", path.join(files, "Replica_Regular.woff2"));
    doc.registerFont("Replica-Bold", path.join(files, "Replica_Bold.woff2"));
    doc.registerFont("Replica-Italic", path.join(files, "Replica_Italic.woff2"));
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

    function viewPage(buf) {
      newPage();
      drawImage(buf, 0, 16, P.w, P.h - 32);
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
          .text(Number(w.price).toLocaleString("de-DE").replace(/\./g, "") + " EUR", cx, y, { width: cw, align: "center" });
        y = doc.y + 3;
      }
      if (w.statusLabel !== "Available") {
        doc.font("Replica").fontSize(7.5).fillColor("#888888")
          .text(w.statusLabel.toUpperCase(), cx, y, { width: cw, align: "center", characterSpacing: 1 });
      }
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
        workPage(it.work, imageFor(it));
      }
    });
    if (!titleDone) titlePage();
    if (introParas.length) textPage(introParas);
    closingPage();
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
    const vrData = await airtable(token, TBL_VR, {
      filterByFormula: '{URL slug} = "' + slug + '"', maxRecords: 1, fields: ROOM_FIELDS,
    });
    const rec = vrData.records && vrData.records[0];
    if (!rec) return res.status(404).json({ error: "Viewing room not found" });
    const vr = rec.fields;
    if (vr["Expires"] && new Date(vr["Expires"]) < new Date()) {
      return res.status(410).json({ error: "This viewing room is no longer available" });
    }

    const sections = [1, 2, 3].map((no) => ({
      views: vr["Installation Views " + no] || [],
      workIds: vr["Artworks " + no] || [],
    })).filter((s) => s.views.length || s.workIds.length);
    const sectioned = sections.length > 0;

    const allWorkIds = [...new Set(sectioned ? sections.flatMap((s) => s.workIds) : (vr["Artworks"] || []))];
    if (!allWorkIds.length) return res.status(404).json({ error: "This viewing room has no artworks yet" });

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

    const cache = { large: new Map(), full: new Map() };
    async function loadTier(tier) {
      await mapLimit(items, 6, async (item, i) => {
        const url = item.kind === "view" ? item.tiers && item.tiers[tier] : item.work.tiers && item.work.tiers[tier];
        if (!url || cache[tier].has(i)) return;
        cache[tier].set(i, await downloadImage(url));
      });
    }

    let tier = req.query.hq === "0" || items.length > FULL_TIER_MAX_IMAGES ? "large" : "full";
    await loadTier(tier);
    const make = () => buildPdf2({
      room, participants, items, introParas,
      imageFor: (item) => cache[tier].get(items.indexOf(item)) || null,
    });
    let pdf = await make();
    if (pdf.length > MAX_BYTES && tier === "full") {
      tier = "large";
      await loadTier(tier);
      pdf = await make();
    }

    const safeName = (room.title || "viewing-room").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "viewing-room";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition",
      (req.query.dl === "1" ? "attachment" : "inline") + '; filename="Diez-Gallery-' + safeName + '-2.pdf"');
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).send(pdf);
  } catch (err) {
    console.error("pdf2 error:", err);
    return res.status(500).json({ error: "Could not generate the PDF" });
  }
};
