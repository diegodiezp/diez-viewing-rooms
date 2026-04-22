const BASE_ID = "appkTmFvjmDLOQS4p";
const TABLE_ID = "tblK8xDtKmakHWt6k";

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const token = process.env.AIRTABLE_PAT;
  if (!token) return res.status(500).json({ error: "AIRTABLE_PAT not configured" });

  const recordId = req.query.id;
  if (!recordId) return res.status(400).json({ error: "Missing 'id' parameter" });

  try {
    // Obtener el registro de Airtable
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
    const attachments = data.fields.Image;

    if (!attachments || attachments.length === 0) {
      return res.status(404).json({ error: "No image" });
    }

    // Descargar la imagen desde Airtable
    const imageUrl = attachments[0].url;
    const imageRes = await fetch(imageUrl);

    if (!imageRes.ok) return res.status(500).json({ error: "Failed to fetch image" });

    // Servir la imagen
    const contentType = imageRes.headers.get("content-type");
    const buffer = Buffer.from(await imageRes.arrayBuffer());

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.status(200).send(buffer);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
