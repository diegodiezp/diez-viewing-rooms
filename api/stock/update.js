// POST { id, status?, location?, note?, notes? } -> changes one artwork.
//   status / location: only their existing Airtable options
//   note:  adds one dated line on top of Dealer's notes. Done server-side,
//          on the current Airtable value, so it never overwrites a note
//          written elsewhere in the meantime.
//   notes: replaces the whole Dealer's notes field (edit mode)
const {
  T, F, STATUS_OPTIONS, LOCATION_OPTIONS,
  requireSession, sameOrigin, airtable, readJson, isRecordId,
} = require("../_lib/stock");

module.exports = async function handler(req, res) {
  if (!requireSession(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Forbidden" });

  const { id, status, location, note, notes } = await readJson(req);
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
  if (notes !== undefined) {
    if (typeof notes !== "string" || notes.length > 20000) return res.status(400).json({ error: "Notes are too long" });
    fields[F.notes] = notes.trim();
  }
  if (!Object.keys(fields).length && note === undefined) return res.status(400).json({ error: "Nothing to change" });

  try {
    if (note !== undefined) {
      const line = String(note).replace(/\s+/g, " ").trim().slice(0, 2000);
      if (!line) return res.status(400).json({ error: "The note is empty" });
      const current = await airtable(T.artworks + "/" + id + "?returnFieldsByFieldId=true");
      const before = (current.fields && current.fields[F.notes]) || "";
      const day = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Amsterdam" });
      fields[F.notes] = (day + ": " + line + (before ? "\n" + before : "")).trim();
    }
    await airtable(T.artworks + "/" + id, {
      method: "PATCH",
      body: JSON.stringify({ fields }),
    });
    return res.status(200).json({ ok: true, notes: fields[F.notes] });
  } catch (err) {
    console.error("stock update error:", err.message);
    return res.status(502).json({ error: "Airtable did not accept the change" });
  }
};
