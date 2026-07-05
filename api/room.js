// Serves viewing-room.html for /:slug with the OG / Twitter meta tags filled
// in from the room's Airtable record, so links shared over WhatsApp, email or
// social show the actual room title, intro and an installation view instead
// of the generic fallback. If anything fails, the unmodified HTML is served
// and the page still works — the client fetches its own data anyway.
const fs = require("fs");
const path = require("path");

const BASE_ID = "appkTmFvjmDLOQS4p";
const TBL_VR = "tbl8EUvqiOLudNvjv"; // Viewing Rooms

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = async function handler(req, res) {
  let html = fs.readFileSync(path.join(process.cwd(), "viewing-room.html"), "utf8");

  const slug = String(req.query.vr || "").replace(/["\\]/g, "");
  const token = process.env.AIRTABLE_PAT;

  try {
    if (slug && token) {
      const url =
        "https://api.airtable.com/v0/" + BASE_ID + "/" + TBL_VR +
        "?maxRecords=1&filterByFormula=" +
        encodeURIComponent('{URL slug} = "' + slug + '"');
      const atRes = await fetch(url, {
        headers: { Authorization: "Bearer " + token },
      });
      if (atRes.ok) {
        const data = await atRes.json();
        const rec = data.records && data.records[0];
        if (rec) {
          const f = rec.fields;

          const expired = f["Expires"] && new Date(f["Expires"]) < new Date();

          if (f["Private"] || expired) {
            html = html.replace(
              '<meta property="og:type"',
              '<meta name="robots" content="noindex, nofollow">\n<meta property="og:type"'
            );
          }

          // Expired rooms are no longer available, so skip the rest of the
          // OG enrichment (title/description/image would only advertise a
          // room visitors can no longer open).
          if (expired) {
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
            return res.status(200).send(html);
          }

          const title = escapeHtml((f["Name"] || "Viewing Room") + " — diez");
          const rawDesc = String(f["Introduction"] || "Contemporary art — Amsterdam")
            .replace(/\s+/g, " ")
            .trim();
          const desc = escapeHtml(rawDesc.length > 200 ? rawDesc.slice(0, 197) + "…" : rawDesc);

          html = html
            .replace(/<title>[^<]*<\/title>/, "<title>" + title + "</title>")
            .replace(/(property="og:title" content=")[^"]*(")/, "$1" + title + "$2")
            .replace(/(name="twitter:title" content=")[^"]*(")/, "$1" + title + "$2")
            .replace(/(property="og:description" content=")[^"]*(")/, "$1" + desc + "$2")
            .replace(/(name="twitter:description" content=")[^"]*(")/, "$1" + desc + "$2");

          const host = req.headers["x-forwarded-host"] || req.headers.host;
          const origin = "https://" + host;
          let extraTags = '<meta property="og:url" content="' + escapeHtml(origin + "/" + slug) + '">';

          const installViews = f["Installation Views"] || [];
          if (installViews.length > 0) {
            const imgUrl = origin + "/api/attachment?id=" + rec.id + "&field=Installation%20Views&index=0";
            extraTags +=
              '<meta property="og:image" content="' + escapeHtml(imgUrl) + '">' +
              '<meta name="twitter:image" content="' + escapeHtml(imgUrl) + '">';
            html = html.replace(
              /(name="twitter:card" content=")[^"]*(")/,
              "$1summary_large_image$2"
            );
          }
          html = html.replace('<meta property="og:type"', extraTags + '\n<meta property="og:type"');
        }
      }
    }
  } catch (err) {
    // Never block the page on meta enrichment — log and serve the fallback.
    console.error("room og error:", err);
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Same caching strategy as the Airtable proxy: edits appear within ~2 min.
  res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
  return res.status(200).send(html);
};
