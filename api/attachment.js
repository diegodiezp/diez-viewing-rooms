const BASE_ID = "appkTmFvjmDLOQS4p";
const TABLE_ID = "tbl8EUvqiOLudNvjv";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const token = process.env.AIRTABLE_PAT;
  if (!token) return res.status(500).json({ error: "AIRTABLE_PAT not configured" });

  const recordId = req.query.id;
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
    const attachments = data.fields["Attachments"];

    if (!attachments || attachments.length === 0) {
      return res.status(404).json({ error: "No attachment" });
    }

    const file = attachments[parseInt(req.query.index || "0", 10)] || attachments[0];
    const fileRes = await fetch(file.url);

    if (!fileRes.ok) return res.status(500).json({ error: "Failed to fetch file" });

    const contentType = fileRes.headers.get("content-type") || "application/octet-stream";
    const buffer = Buffer.from(await fileRes.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Content-Disposition", "inline; filename=\"" + (file.filename || "document.pdf") + "\"");
    return res.status(200).send(buffer);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
