// POST { id, status?, location? } -> changes status and/or location of one
// artwork. Only these two fields, only their existing options.
const {
  T, F, STATUS_OPTIONS, LOCATION_OPTIONS,
  requireSession, sameOrigin, airtable, readJson, isRecordId,
} = require("../_lib/stock");

module.exports = async function handler(req, res) {
  if (!requireSession(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Forbidden" });

  const { id, status, location } = await readJson(req);
  if (!isRecordId(id)) return res.status(400).json({ error: "Invalid artwork" });

  const fields = {};
  if (status !== undefined) {
    // The page sends trimmed names; map back to the exact Airtable option
    const match = STATUS_OPTIONS.find((o) => o.trim() === String(status).trim());
    if (!match) return res.status(400).json({ error: "Unknown status" });
    fields[F.status] = match;
  }
  if (location !== undefined) {
    if (location !== "" && !LOCATION_OPTIONS.includes(location)) {
      return res.status(400).json({ error: "Unknown location" });
    }
    fields[F.location] = location || null;
  }
  if (!Object.keys(fields).length) return res.status(400).json({ error: "Nothing to change" });

  try {
    await airtable(T.artworks + "/" + id, {
      method: "PATCH",
      body: JSON.stringify({ fields }),
    });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("stock update error:", err.message);
    return res.status(502).json({ error: "Airtable did not accept the change" });
  }
};
