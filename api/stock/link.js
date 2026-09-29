// POST { url, personId } or { url, newPerson: { first, last, email } }
//   -> a tracked short link (https://t.diez.gallery/s/CODE) for that person.
//
// Writes one row in diez-mail's Short Links table under the "Manual /
// WhatsApp Links" campaign. When the person opens it, diez-mail signs the
// tracking token and redirects to the room, so opens, artwork views and
// active time land on that contact like any link made in diez-mail.
const crypto = require("crypto");
const { MAIL, requireSession, sameOrigin, mail, readJson, isRecordId } = require("../_lib/stock");

const EMAIL_RE = /^[^\s@"]+@[^\s@"]+\.[^\s@"]+$/;

function code() {
  // 7 url-safe characters, same shape as diez-mail's codes
  return crypto.randomBytes(8).toString("base64url").slice(0, 7);
}

async function findByEmail(email) {
  const p = new URLSearchParams();
  p.set("filterByFormula", 'LOWER({Email}) = "' + email + '"');
  p.set("maxRecords", "1");
  p.set("returnFieldsByFieldId", "true");
  const data = await mail(MAIL.people + "?" + p.toString());
  return data.records[0] || null;
}

module.exports = async function handler(req, res) {
  if (!requireSession(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Forbidden" });

  const body = await readJson(req);
  const url = String(body.url || "");
  if (!/^https:\/\/rooms\.diez\.gallery\/[A-Za-z0-9\-_/]+$/.test(url)) {
    return res.status(400).json({ error: "Only viewing room links can be tracked" });
  }
  const label = String(body.label || "").replace(/[\r\n]+/g, " ").trim().slice(0, 100);

  try {
    let person;
    if (body.personId) {
      if (!isRecordId(body.personId)) return res.status(400).json({ error: "Invalid contact" });
      person = await mail(MAIL.people + "/" + body.personId + "?returnFieldsByFieldId=true");
    } else if (body.newPerson) {
      const n = body.newPerson;
      const email = String(n.email || "").trim().toLowerCase().slice(0, 200);
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Add a valid email for the new contact" });
      // Reuse the contact if that email already exists, never duplicate
      person = await findByEmail(email.replace(/["\\]/g, ""));
      if (!person) {
        person = await mail(MAIL.people + "?returnFieldsByFieldId=true", {
          method: "POST",
          body: JSON.stringify({
            fields: {
              [MAIL.p.first]: String(n.first || "").trim().slice(0, 100),
              [MAIL.p.last]: String(n.last || "").trim().slice(0, 100),
              [MAIL.p.email]: email,
            },
          }),
        });
      }
    } else {
      return res.status(400).json({ error: "Pick a contact" });
    }

    const f = person.fields || {};
    const email = f[MAIL.p.email];
    if (!email) return res.status(400).json({ error: "This contact has no email in diez-mail" });
    const name = [f[MAIL.p.first], f[MAIL.p.last]].filter(Boolean).join(" ").trim() || email;

    const c = code();
    await mail(MAIL.shortLinks, {
      method: "POST",
      body: JSON.stringify({
        fields: {
          [MAIL.s.code]: c,
          [MAIL.s.url]: url,
          [MAIL.s.email]: email,
          [MAIL.s.person]: [person.id],
          [MAIL.s.campaign]: [MAIL.manualCampaign],
          [MAIL.s.tid]: crypto.randomBytes(12).toString("hex"),
          [MAIL.s.label]: (label ? label + " / " : "") + name + " (stock)",
        },
      }),
    });

    return res.status(200).json({ ok: true, url: MAIL.shortBase + c, name, email, personId: person.id });
  } catch (err) {
    console.error("stock link error:", err.message);
    return res.status(502).json({ error: "Could not create the tracked link" });
  }
};
