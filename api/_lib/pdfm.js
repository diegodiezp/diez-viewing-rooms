// "pdfm": the viewing room PDF for phones. URL: /:slug/pdfm (rewritten to
// /api/room?vr=:slug&format=pdfm).
//
// Pages are as wide as a phone screen (390 x 720 pt), so a phone's PDF
// viewer shows them at their real size: text is readable without zooming and
// the reader just scrolls down. Same room data, order and rules as pdf2:
// cover (first installation view + title), installation views two to a
// page, one work per page on an extended wall with the caption under the
// work, the introduction, and a closing page with terms and contact.
const path = require("path");
const PDFDocument = require("pdfkit");
const { loadRoomModel, registerFonts, layout, safeName } = require("./pdf2");
const { mapLimit, MAX_BYTES } = require("./pdf").helpers;
const { extendToPage, findWork } = require("./wallextend");

const { priceText } = layout;
const PM = { w: 390, h: 720, m: 22 };
const FILES = path.join(process.cwd(), "files");
const INK = "#1a1a1a", SOFT = "#444444", GREY = "#8f8f8f";
const CAP_W = PM.w - 2 * PM.m;

// Caption lines under the work: [font, size, colour, text, gap above, opts]
function mobileCaption(w) {
  const L = [];
  if (w.artist) L.push(["Replica-Bold", 15, INK, w.artist, 0]);
  L.push(["Replica-Italic", 15, INK, w.title + (w.year ? ", " + w.year : ""), L.length ? 2 : 0]);
  if (w.medium) L.push(["Replica", 11.5, SOFT, w.medium, 12]);
  w.lines.forEach((ln, i) => L.push(["Replica", 11.5, SOFT, ln, i === 0 && !w.medium ? 12 : 3]));
  if (w.price && w.showPrice) L.push(["Replica-Bold", 12.5, INK, priceText(w), 14]);
  if (w.statusLabel !== "Available") L.push(["Replica", 9, "#777777", w.statusLabel.toUpperCase(), 5, { characterSpacing: 1.2 }]);
  return L;
}
function linesHeight(doc, lines) {
  return lines.reduce((h, [f, s, , t, gap, o]) => {
    doc.font(f).fontSize(s);
    return h + gap + doc.heightOfString(t, Object.assign({ width: CAP_W }, o || {}));
  }, 0);
}

// Where the photo goes: the work (found inside the photo, or the whole photo
// when nothing is found) as large as fits the width and the height left
// above the caption; work + caption centred vertically on the page.
function placeMobile(found, capH, useBox) {
  const r = found.pxW / found.pxH;
  const pad = 0.04, B = useBox && found.box ? found.box : { x0: 0, y0: 0, x1: 1, y1: 1 };
  const a = Math.max(0, B.x0 - (useBox ? pad : 0)), b = Math.min(1, B.x1 + (useBox ? pad : 0));
  const c = Math.max(0, B.y0 - (useBox ? pad : 0)), d = Math.min(1, B.y1 + (useBox ? pad : 0));
  const GAP = 26, TOP = 56, BOTTOM = 44;
  const maxW = CAP_W, maxH = Math.min(420, PM.h - TOP - BOTTOM - GAP - capH);
  const pw = Math.min(maxW / (b - a), maxH * r / (d - c));
  const ph = pw / r, ww = (b - a) * pw, wh = (d - c) * ph;
  const top = Math.max(TOP, (PM.h - 20 - (wh + GAP + capH)) / 2);
  const wx = (PM.w - ww) / 2;
  return { rect: { x: wx - a * pw, y: top - c * ph, w: pw, h: ph }, captionY: top + wh + GAP };
}

function buildPdfMobile({ room, participants, items, imgs, pagesFor, introParas }) {
  return new Promise((resolve, reject) => {
    // Default margins apply to text pages (and to any page the introduction
    // overflows onto); image pages are added with margin 0.
    const doc = new PDFDocument({
      size: [PM.w, PM.h], autoFirstPage: false,
      margins: { top: 44, bottom: 56, left: 24, right: 24 },
      info: { Title: room.title + " - Diez Gallery", Author: "Diez Gallery" },
    });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    registerFonts(doc);

    const imagePage = () => doc.addPage({ size: [PM.w, PM.h], margin: 0 });
    const logo = (x, y, w) => { try { doc.image(path.join(FILES, "logo.png"), x, y, { width: w }); } catch (e) { /* decorative */ } };
    const draw = (buf, opts, x, y) => { try { doc.image(buf, x, y, opts); return true; } catch (e) { return false; } };
    const noBreak = (fn) => { const b = doc.page.margins.bottom; doc.page.margins.bottom = 0; fn(); doc.page.margins.bottom = b; };
    function contactLines(y, colour) {
      noBreak(() => {
        doc.font("Replica").fontSize(7.5).fillColor(colour || GREY);
        doc.text("Gibraltarstraat 74-B, Amsterdam", PM.m, y, { lineBreak: false });
        let x = PM.m;
        [["diego@diez.gallery", "mailto:diego@diez.gallery"], ["+31 6 33261845", "tel:+31633261845"], ["diez.gallery", "https://diez.gallery"]]
          .forEach(([t, link], i) => {
            const txt = t + (i < 2 ? "   ·   " : "");
            doc.text(txt, x, y + 10, { lineBreak: false, link });
            x += doc.widthOfString(txt);
          });
      });
    }

    const views = items.map((it, i) => (it.kind === "view" ? i : -1)).filter((i) => i >= 0);
    const coverIdx = views.length ? views[0] : -1;

    // ---- cover
    imagePage();
    let ty = 70;
    if (coverIdx >= 0 && imgs[coverIdx]) {
      draw(imgs[coverIdx], { cover: [PM.w, 430], align: "center", valign: "center" }, 0, 0);
      ty = 460;
    }
    noBreak(() => {
      doc.font("Replica-Bold").fontSize(34).fillColor(INK).text(room.title, PM.m, ty, { width: CAP_W, lineGap: -3 });
      if (participants.length) doc.font("Replica-Bold").fontSize(14).text(participants.join(", "), PM.m, doc.y + 10, { width: CAP_W, lineGap: 1 });
      if (room.datesLong) doc.font("Replica-Bold").fontSize(11.5).text(room.datesLong, PM.m, doc.y + 10, { width: CAP_W });
    });
    logo(PM.m, PM.h - 46, 62);

    // ---- body, in room order; consecutive landscape views share a page
    let pendingView = null;
    function flushView() {
      if (!pendingView) return;
      imagePage();
      const h = PM.w / pendingView.ratio;
      draw(pendingView.buf, { width: PM.w, height: h }, 0, (PM.h - h) / 2);
      pendingView = null;
    }
    items.forEach((it, i) => {
      if (i === coverIdx) return;
      if (it.kind === "view") {
        if (!imgs[i]) return;
        let ratio = 1.5;
        try { const im = doc.openImage(imgs[i]); ratio = im.width / im.height; } catch (e) { return; }
        if (ratio < 1) {                       // portrait view: its own page
          flushView(); imagePage();
          draw(imgs[i], { fit: [PM.w, PM.h - 40], align: "center", valign: "center" }, 0, 20);
          return;
        }
        if (!pendingView) { pendingView = { buf: imgs[i], ratio }; return; }
        // two landscape views stacked, full width
        imagePage();
        const h1 = PM.w / pendingView.ratio, h2 = PM.w / ratio, gap = 10;
        const y0 = Math.max(0, (PM.h - h1 - h2 - gap) / 2);
        draw(pendingView.buf, { width: PM.w, height: h1 }, 0, y0);
        draw(imgs[i], { width: PM.w, height: h2 }, 0, y0 + h1 + gap);
        pendingView = null;
        return;
      }
      flushView();
      const p = pagesFor(it, i);
      imagePage();
      if (p && p.wall) draw(p.wall, { width: PM.w, height: PM.h }, 0, 0);
      else if (p && p.photo) draw(p.photo, { width: p.rect.w, height: p.rect.h }, p.rect.x, p.rect.y);
      logo(PM.m, 18, 30);
      let y = p ? p.captionY : 460;
      noBreak(() => {
        mobileCaption(it.work).forEach(([f, s, col, t, gap, o]) => {
          y += gap;
          doc.font(f).fontSize(s).fillColor(col).text(t, PM.m, y, Object.assign({ width: CAP_W }, o || {}));
          y = doc.y;
        });
      });
      contactLines(PM.h - 34);
    });
    flushView();

    // ---- introduction (flows over as many pages as it needs)
    if (introParas.length) {
      doc.addPage();
      introParas.forEach((t, k) => {
        doc.font("Replica").fontSize(13).fillColor(INK).text(t, { width: PM.w - 48, lineGap: 4.5, paragraphGap: 0 });
        if (k < introParas.length - 1) doc.moveDown(0.9);
      });
    }

    // ---- closing
    imagePage();
    noBreak(() => {
      doc.font("Replica-Bold").fontSize(15).fillColor(INK)
        .text("All prices exclude 9% VAT and exclude shipping", PM.m, 50, { width: CAP_W })
        .text("Works subject to availability", PM.m, doc.y + 2, { width: CAP_W });
      const LINK = "#4F52D9";
      doc.font("Replica").fontSize(15);
      doc.fillColor(LINK).text("diego@diez.gallery", PM.m, 200, { link: "mailto:diego@diez.gallery", underline: true });
      doc.fillColor(INK).text("+31 6 33261845", PM.m, doc.y + 2, { link: "tel:+31633261845", underline: false });
      doc.fillColor(LINK).text("@diez.gallery", PM.m, doc.y + 18, { link: "https://instagram.com/diez.gallery", underline: true });
      doc.fillColor(LINK).text("www.diez.gallery", PM.m, doc.y + 2, { link: "https://diez.gallery", underline: true });
      doc.font("Replica").fontSize(11).fillColor(GREY).text("Gibraltarstraat 74-B, Amsterdam", PM.m, doc.y + 18);
    });
    logo(PM.m, PM.h - 46, 62);
    doc.end();
  });
}

async function generatePdfMobile({ slug, token, maxBytes = MAX_BYTES, caps = { view: 1500, work: 1300 }, wallMode = true }) {
  const m = await loadRoomModel({ slug, token, maxBytes, caps, reserveKB: wallMode ? 900 : 300 });
  if (m.error) return m;
  const { room, participants, items, imgs, introParas, limited } = m;

  const measure = new PDFDocument({ size: [PM.w, PM.h], margin: 0 });
  registerFonts(measure);
  async function makePages(quality) {
    return mapLimit(items, 2, async (it, i) => {
      if (it.kind !== "work" || !imgs[i]) return null;
      const capH = linesHeight(measure, mobileCaption(it.work));
      try {
        const found = await findWork(imgs[i]);
        if (!found) return null;
        if (wallMode) {
          const pl = placeMobile(found, capH, true);
          const { buf } = await extendToPage(imgs[i], pl.rect, PM, { quality });
          if (buf) return { wall: buf, captionY: pl.captionY };
        }
        // tight crop (or walls off): the photo itself on white
        const pl = placeMobile(found, capH, false);
        return { photo: imgs[i], rect: pl.rect, captionY: pl.captionY };
      } catch (e) {
        console.error("pdfm page error:", e);
        return null;
      }
    });
  }
  const build = (pages) => buildPdfMobile({
    room, participants, items, imgs, introParas,
    pagesFor: (it, i) => pages[i],
  });
  let pages = await makePages(limited ? 80 : 88);
  let pdf = await build(pages);
  if (limited && pdf.length > maxBytes && wallMode) {
    pages = await makePages(64);
    pdf = await build(pages);
  }
  return { pdf, title: room.title, recordId: m.recordId };
}

async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const token = process.env.AIRTABLE_PAT;
  if (!token) return res.status(500).json({ error: "AIRTABLE_PAT not configured" });
  const slug = String(req.query.vr || "").replace(/["\\]/g, "").slice(0, 100);
  if (!slug) return res.status(400).json({ error: "Missing viewing room" });
  try {
    const out = await generatePdfMobile({ slug, token, wallMode: req.query.wall !== "0" });
    if (out.error) return res.status(out.status).json({ error: out.error });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition",
      (req.query.dl === "1" ? "attachment" : "inline") + '; filename="Diez-Gallery-' + safeName(out.title) + '-mobile.pdf"');
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    return res.status(200).send(out.pdf);
  } catch (err) {
    console.error("pdfm error:", err);
    return res.status(500).json({ error: "Could not generate the PDF" });
  }
}

module.exports = handler;
module.exports.generatePdfMobile = generatePdfMobile;
