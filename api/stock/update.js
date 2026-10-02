// POST { id, status?, location?, note?, notes?, set? } -> changes one artwork.
//
//   note:  adds one dated line on top of Dealer's notes. Done server-side,
//          on the current Airtable value, so it never overwrites a note
//          written elsewhere in the meantime. The ONLY thing a "notes"
//          session (fairs, assistants) is allowed to send.
//
//   Everything below is admin only:
//   status / location: only their existing Airtable options
//   notes: replaces the whole Dealer's notes field (edit mode)
//   set:   { key: value, ... } for the editable fields in EDITABLE below.
//          Unknown keys are rejected, every value is validated by type, and
//          an empty value clears the field. Only send what changed.
const {
  T, F, STATUS_OPTIONS, LOCATION_OPTIONS, PAID_OPTIONS,
  requireSession, sameOrigin, airtable, readJson, isRecordId,
} = require("../_lib/stock");

// Fields the stock tool may write, by key. Prices and relations other than
// the buyer are deliberately not here yet.
const EDITABLE = {
  title:           { id: F.title,           type: "text", max: 200, required: true },
  year:            { id: F.year,            type: "int", min: 1000, max: 2200 },
  yearEnd:         { id: F.yearEnd,         type: "int", min: 1000, max: 2200 },
  technique:       { id: F.technique,       type: "text", max: 500 },
  edition:         { id: F.edition,         type: "text", max: 200 },
  height:          { id: F.height,          type: "dim" },
  width:           { id: F.width,           type: "dim" },
  depth:           { id: F.depth,           type: "dim" },
  framedHeight:    { id: F.framedHeight,    type: "dim" },
  framedWidth:     { id: F.framedWidth,     type: "dim" },
  framedDepth:     { id: F.framedDepth,     type: "dim" },
  variableDims:    { id: F.variableDims,    type: "bool" },
  soldEur:         { id: F.soldEur,         type: "money" },
  soldUsd:         { id: F.soldUsd,         type: "money" },
  soldGbp:         { id: F.soldGbp,         type: "money" },
  paidArtist:      { id: F.paidArtist,      type: "select", options: PAID_OPTIONS },
  owner:           { id: F.owner,           type: "links" },
};

const empty = (v) => v === null || v === undefined || v === "";

// Returns the value to send to Airtable (null clears the field) or throws an
// Error whose message is safe to show on the phone.
function clean(key, spec, v) {
  switch (spec.type) {
    case "text": {
      if (empty(v)) {
        if (spec.required) throw new Error("The " + key + " cannot be empty");
        return null;
      }
      if (typeof v !== "string") throw new Error("Invalid " + key);
      const t = v.replace(/\s*[\r\n]+\s*/g, " ").trim();
      if (!t) {
        if (spec.required) throw new Error("The " + key + " cannot be empty");
        return null;
      }
      if (t.length > spec.max) throw new Error("The " + key + " is too long");
      return t;
    }
    case "int": {
      if (empty(v)) return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < spec.min || n > spec.max) throw new Error("Invalid " + key);
      return n;
    }
    case "dim": {
      if (empty(v)) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0 || n > 2000) throw new Error("Invalid size for " + key);
      return Math.round(n * 10) / 10;
    }
    case "money": {
      if (empty(v)) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1e9) throw new Error("Invalid amount");
      return Math.round(n * 100) / 100;
    }
    case "bool":
      return v === true;
    case "select": {
      if (empty(v)) return null;
      if (!spec.options.includes(v)) throw new Error("Invalid " + key);
      return v;
    }
    case "links": {
      if (!Array.isArray(v) || v.length > 5 || !v.every(isRecordId)) throw new Error("Invalid " + key);
      return v;
    }
  }
  throw new Error("Invalid " + key);
}

module.exports = async function handler(req, res) {
  const role = requireSession(req, res);
  if (!role) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Forbidden" });

  const { id, status, location, note, notes, set } = await readJson(req);
  if (!isRecordId(id)) return res.status(400).json({ error: "Invalid artwork" });

  // A "notes" session may add dated notes and nothing else. Checked before
  // anything is read, so no other field can slip through.
  if (role !== "admin" && (status !== undefined || location !== undefined || notes !== undefined || set !== undefined)) {
    return res.status(403).json({ error: "This account can only add notes" });
  }

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
  if (set !== undefined) {
    if (!set || typeof set !== "object" || Array.isArray(set)) return res.status(400).json({ error: "Invalid changes" });
    try {
      for (const [key, value] of Object.entries(set)) {
        const spec = EDITABLE[key];
        if (!spec) return res.status(400).json({ error: "Unknown field: " + key });
        fields[spec.id] = clean(key, spec, value);
      }
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
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
