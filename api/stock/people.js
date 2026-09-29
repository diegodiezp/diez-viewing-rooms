// GET ?q=anna -> up to 10 contacts from diez-mail's People table, matched on
// name, email or company. Used by the contact picker in the stock tool.
const { MAIL, requireSession, mail } = require("../_lib/stock");

module.exports = async function handler(req, res) {
  if (!requireSession(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // Only letters, digits, spaces and a few email characters reach the formula
  const q = String(req.query.q || "").toLowerCase().replace(/[^\p{L}\p{N} @._+-]/gu, "").trim().slice(0, 60);
  if (q.length < 2) return res.status(200).json({ people: [] });

  const formula =
    'OR(SEARCH("' + q + '", LOWER({First Name} & " " & {Last Name})),' +
    ' SEARCH("' + q + '", LOWER({Email})),' +
    ' SEARCH("' + q + '", LOWER({Company})))';
  const p = new URLSearchParams();
  p.set("filterByFormula", formula);
  p.set("maxRecords", "10");
  p.set("returnFieldsByFieldId", "true");
  for (const f of Object.values(MAIL.p)) p.append("fields[]", f);

  try {
    const data = await mail(MAIL.people + "?" + p.toString());
    const people = data.records.map((r) => ({
      id: r.id,
      name: [r.fields[MAIL.p.first], r.fields[MAIL.p.last]].filter(Boolean).join(" ").trim(),
      email: r.fields[MAIL.p.email] || "",
      type: (r.fields[MAIL.p.type] || []).join(", "),
      company: (r.fields[MAIL.p.company] || "").split("\n")[0],
    }));
    return res.status(200).json({ people });
  } catch (err) {
    console.error("stock people error:", err.message);
    return res.status(502).json({ error: "Could not search contacts" });
  }
};
