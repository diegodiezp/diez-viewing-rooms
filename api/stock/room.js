// POST { name, ids[], days } -> creates a private viewing room with those
// works and returns its link. Uses the existing Viewing Rooms table, so the
// room renders on rooms.diez.gallery exactly like one made by hand.
const crypto = require("crypto");
const { T, requireSession, sameOrigin, airtable, readJson, isRecordId } = require("../_lib/stock");

const VR = {
  name: "fldWvjesFEs1xQIp1",
  status: "fld6WQhU1Dw9KQFZP",
  slug: "fldBwTlsehdSDeYWZ",
  private: "fldP55HrhlDaJtmd7",
  expires: "flddjwGCmKOeJka50",
  artworks: "fldBNjOCfpgDmx2x9",
  artist: "fldqwhX5gQNcVq79U",
};

function slugify(s) {
  return String(s)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    .slice(0, 40) || "selection";
}

module.exports = async function handler(req, res) {
  if (!requireSession(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Forbidden" });

  const body = await readJson(req);
  const name = String(body.name || "").replace(/[\r\n]+/g, " ").trim().slice(0, 120);
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids)].filter(isRecordId) : [];
  const artistIds = Array.isArray(body.artistIds) ? [...new Set(body.artistIds)].filter(isRecordId) : [];
  const days = Math.min(Math.max(parseInt(body.days, 10) || 30, 1), 365);

  if (!name) return res.status(400).json({ error: "Give the room a name" });
  if (!ids.length || ids.length > 60) return res.status(400).json({ error: "Select between 1 and 60 works" });

  // Random suffix: private links are not guessable from the name alone
  const slug = slugify(name) + "-" + crypto.randomBytes(3).toString("hex");
  const expires = new Date(Date.now() + days * 86400 * 1000).toISOString().slice(0, 10);

  const fields = {
    [VR.name]: name,
    [VR.slug]: slug,
    [VR.status]: "Active",
    [VR.private]: true,
    [VR.expires]: expires,
    [VR.artworks]: ids,
  };
  if (artistIds.length) fields[VR.artist] = artistIds;

  try {
    const rec = await airtable(T.rooms, {
      method: "POST",
      body: JSON.stringify({ fields }),
    });
    return res.status(200).json({
      ok: true,
      id: rec.id,
      url: "https://rooms.diez.gallery/" + slug,
      expires,
    });
  } catch (err) {
    console.error("stock room error:", err.message);
    return res.status(502).json({ error: "Airtable did not create the room" });
  }
};
