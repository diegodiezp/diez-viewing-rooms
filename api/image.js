const BASE_ID = "appkTmFvjmDLOQS4p";
const TABLE_ID = "tblK8xDtKmakHWt6k";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const token = process.env.AIRTABLE_PAT;
  if (!token) return res.status(500).json({ error: "AIRTABLE_PAT not configured" });

  const recordId = req.query.id;
  const field = req.query.field || "Image";
  const index = parseInt(req.query.index || "0", 10);
  // size: small (36px) | large (512px) | full (3000px) | original. Default: large.
  const size = (req.query.size || "large").toLowerCase();
  if (!recordId) return res.status(400).json({ error: "Missing 'id' parameter" });

  try {
    const atRes = await fetch(
      "https://api.airtable.com/v0/" + BASE_ID + "/" + TABLE_ID + "/" + recordId,
      {
        headers: {
          "Authorization": "Bearer " + token,
        },
      }
    );

    if (!atRes.ok) return res.status(atRes.status).json({ error: "Record not found" });

    const data = await atRes.json();
    const attachments = data.fields[field];

    if (!attachments || attachments.length === 0) {
      return res.status(404).json({ error: "No image" });
    }

    const file = attachments[index] || attachments[0];

    // Pick the right URL based on size, with fallback to original.
    let targetUrl = file.url;
    if (size !== "original" && file.thumbnails && file.thumbnails[size]) {
      targetUrl = file.thumbnails[size].url;
    }

    const imageRes = await fetch(targetUrl);

    if (!imageRes.ok) return res.status(500).json({ error: "Failed to fetch image" });

    const contentType = imageRes.headers.get("content-type");
    const buffer = Buffer.from(await imageRes.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    // Aggressive caching: 1h fresh on Vercel CDN, 24h stale-while-revalidate,
    // 7d in browser. Saves API calls dramatically when multiple visitors hit
    // the same viewing room.
    res.setHeader(
      "Cache-Control",
      "public, max-age=604800, s-maxage=3600, stale-while-revalidate=86400"
    );
    return res.status(200).send(buffer);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
