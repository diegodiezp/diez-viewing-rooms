const { applyCors } = require("./_lib/cors");

const BASE_ID = "appkTmFvjmDLOQS4p";

// Only these tables can be accessed through the proxy
const ALLOWED_TABLES = [
  "tbl8EUvqiOLudNvjv", // Viewing Rooms
  "tblK8xDtKmakHWt6k", // Artworks
  "tbl3fHryX8bPSYMyN", // Artists
];

// Only the fields the frontend actually renders are ever returned. This is
// enforced server-side: whatever the client sends as fields[] is ignored.
// Internal fields (costs, collector notes, locations, ...) can never leave
// Airtable through this proxy, even for records the caller can address.
const ALLOWED_FIELDS = {
  "tbl8EUvqiOLudNvjv": [
    "Name", "Start Date", "End Date", "Introduction", "Artworks",
    "Attachments", "Installation Views", "Expires", "Private", "URL slug",
  ],
  "tblK8xDtKmakHWt6k": [
    "Title", "Year", "Info (Backup)", "Status",
    "Price €", "Artist name", "Artist Index", "Details",
  ],
  "tbl3fHryX8bPSYMyN": ["Name"],
};

// Only these filterByFormula shapes are allowed through the proxy. The
// frontend only ever sends a slug lookup or a RECORD_ID() OR-chain; anything
// else (formula injection via a crafted slug, probing other fields) is
// rejected before it reaches Airtable.
const ALLOWED_FORMULAS = [
  /^\{URL slug\} = "[^"\\]*"$/,
  /^OR\(RECORD_ID\(\)="rec[a-zA-Z0-9]+"(,RECORD_ID\(\)="rec[a-zA-Z0-9]+")*\)$/,
];

module.exports = async function handler(req, res) {
  applyCors(req, res);

  if (req.method === "OPTIONS") return res.status(200).end();

  const token = process.env.AIRTABLE_PAT;
  if (!token) return res.status(500).json({ error: "AIRTABLE_PAT not configured" });

  const { path } = req.query;
  if (!path) return res.status(400).json({ error: "Missing path parameter" });

  // Block access to tables not in the whitelist
  if (!ALLOWED_TABLES.includes(path)) {
    return res.status(403).json({ error: "Access denied" });
  }

  // A formula is now MANDATORY. Without this, a bare request would dump the
  // whole table (and Airtable's offset param would paginate the entire base).
  const formula = req.query.filterByFormula;
  if (!formula || !ALLOWED_FORMULAS.some((re) => re.test(formula))) {
    return res.status(400).json({ error: "Invalid filter" });
  }

  // Rebuild the query string from scratch. Only known-safe params survive;
  // everything else the client sent (offset, view, sort, fields, ...) is
  // dropped on the floor.
  const params = new URLSearchParams();
  params.set("filterByFormula", formula);

  const maxRecords = parseInt(req.query.maxRecords || "100", 10);
  params.set("maxRecords", String(Math.min(Math.max(maxRecords, 1), 100)));

  for (const field of ALLOWED_FIELDS[path]) {
    params.append("fields[]", field);
  }

  const url = "https://api.airtable.com/v0/" + BASE_ID + "/" + path + "?" + params.toString();

  try {
    const atRes = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json"
      }
    });
    const data = await atRes.json();
    if (!atRes.ok) return res.status(atRes.status).json(data);

    // CDN caching: 2 min fresh on Vercel's edge, then up to 10 min serving
    // stale while revalidating in background. Absorbs traffic spikes after a
    // mailing (many visitors = 1 Airtable call) and keeps us far from
    // Airtable's 5 req/s limit. Edits in Airtable appear within ~2 minutes.
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=120, stale-while-revalidate=600"
    );
    return res.status(200).json(data);
  } catch (err) {
    console.error("airtable proxy error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
};
