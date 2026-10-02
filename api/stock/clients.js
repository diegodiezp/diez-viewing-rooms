// Buyers (the Clients table in the inventory base), for the "Mark as sold" flow.
//   GET  ?q=anna                    -> up to 10 clients matched on name or email
//   POST { first, last, email? }    -> creates a client and returns it. If the
//                                      email already exists, that client is
//                                      returned instead of a duplicate.
// Admin sessions only: buyers are private.
const { T, C, requireSession, sameOrigin, airtable, readJson } = require("../_lib/stock");

const EMAIL_RE = /^[^\s@"'\\]+@[^\s@"'\\]+\.[^\s@"'\\]+$/;

const shape = (r) => ({
  id: r.id,
  name: [r.fields[C.first], r.fields[C.last]].filter(Boolean).join(" ").trim(),
  email: r.fields[C.email] || "",
});

module.exports = async function handler(req, res) {
  if (!requireSession(req, res, { admin: true })) return;

  if (req.method === "GET") {
    // Only letters, digits, spaces and a few email characters reach the formula
    const q = String(req.query.q || "").toLowerCase().replace(/[^\p{L}\p{N} @._+-]/gu, "").trim().slice(0, 60);
    if (q.length < 2) return res.status(200).json({ clients: [] });
    const formula =
      'OR(SEARCH("' + q + '", LOWER({' + C.first + '} & " " & {' + C.last + '})),' +
      ' SEARCH("' + q + '", LOWER({' + C.email + '})))';
    const p = new URLSearchParams();
    p.set("filterByFormula", formula);
    p.set("maxRecords", "10");
    p.set("returnFieldsByFieldId", "true");
    for (const f of Object.values(C)) p.append("fields[]", f);
    try {
      const data = await airtable(T.clients + "?" + p.toString());
      return res.status(200).json({ clients: data.records.map(shape) });
    } catch (err) {
      console.error("stock clients search error:", err.message);
      return res.status(502).json({ error: "Could not search buyers" });
    }
  }

  if (req.method === "POST") {
    if (!sameOrigin(req)) return res.status(403).json({ error: "Forbidden" });
    const body = await readJson(req);
    const clean = (s) => String(s || "").replace(/[\r\n]+/g, " ").trim().slice(0, 100);
    const first = clean(body.first);
    const last = clean(body.last);
    const email = clean(body.email).toLowerCase();
    if (!first && !last) return res.status(400).json({ error: "Add a name" });
    if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: "That email does not look right" });

    try {
      if (email) {
        const p = new URLSearchParams();
        p.set("filterByFormula", 'LOWER({' + C.email + '}) = "' + email + '"');
        p.set("maxRecords", "1");
        p.set("returnFieldsByFieldId", "true");
        for (const f of Object.values(C)) p.append("fields[]", f);
        const found = await airtable(T.clients + "?" + p.toString());
        if (found.records.length) return res.status(200).json({ client: shape(found.records[0]), existing: true });
      }
      const fields = {};
      if (first) fields[C.first] = first;
      if (last) fields[C.last] = last;
      if (email) fields[C.email] = email;
      const created = await airtable(T.clients, {
        method: "POST",
        body: JSON.stringify({ fields, returnFieldsByFieldId: true }),
      });
      return res.status(200).json({ client: shape(created), existing: false });
    } catch (err) {
      console.error("stock clients create error:", err.message);
      return res.status(502).json({ error: "Airtable did not accept the new buyer" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
};
