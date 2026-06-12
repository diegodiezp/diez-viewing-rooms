const { applyCors } = require("./_lib/cors");

const BASE_ID = "appkTmFvjmDLOQS4p";

// Only these tables can be accessed through the proxy
const ALLOWED_TABLES = [
  "tbl8EUvqiOLudNvjv", // Viewing Rooms
  "tblK8xDtKmakHWt6k", // Artworks
  "tbl3fHryX8bPSYMyN", // Artists
];

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

  const { path, ...queryParams } = req.query;
  if (!path) return res.status(400).json({ error: "Missing path parameter" });

  // Block access to tables not in the whitelist
  if (!ALLOWED_TABLES.includes(path)) {
    return res.status(403).json({ error: "Access denied" });
  }

  const formula = queryParams.filterByFormula;
  if (formula && !ALLOWED_FORMULAS.some((re) => re.test(formula))) {
    return res.status(400).json({ error: "Invalid filter" });
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(queryParams)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  const url = "https://api.airtable.com/v0/" + BASE_ID + "/" + path + (qs ? "?" + qs : "");

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
