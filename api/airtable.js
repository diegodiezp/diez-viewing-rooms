const BASE_ID = "appkTmFvjmDLOQS4p";
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  const token = process.env.AIRTABLE_PAT;
  if (!token) return res.status(500).json({ error: "AIRTABLE_PAT not configured" });
  const { path, ...queryParams } = req.query;
  if (!path) return res.status(400).json({ error: "Missing 'path' parameter" });
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(queryParams)) {
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  const url = `https://api.airtable.com/v0/${BASE_ID}/${path}${qs ? "?" + qs : ""}`;
  try {
    const atRes = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    const data = await atRes.json();
    if (!atRes.ok) return res.status(atRes.status).json(data);
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
