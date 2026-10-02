// POST { password } -> sets a signed session cookie and answers { ok, role }.
//   STOCK_PASSWORD        -> role "admin" (edit everything), 30 days
//   STOCK_GUEST_PASSWORD  -> role "notes" (read + add notes), 14 days.
//                            Optional: without it there is no guest sign-in.
// DELETE -> signs out.
const crypto = require("crypto");
const { newSession, clearSession, sameOrigin, noStore, readJson } = require("../_lib/stock");

function equal(a, b) {
  // Compare fixed-length hashes so timing leaks nothing about the password
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = async function handler(req, res) {
  noStore(res);
  if (!sameOrigin(req)) return res.status(403).json({ error: "Forbidden" });

  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", clearSession());
    return res.status(200).json({ ok: true });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const expected = process.env.STOCK_PASSWORD;
  if (!expected) return res.status(500).json({ error: "Stock tool is not configured" });

  const { password } = await readJson(req);
  const guestExpected = process.env.STOCK_GUEST_PASSWORD || "";
  // Both comparisons always run, so timing never reveals which one matched
  const isAdmin = !!password && equal(password, expected);
  const isGuest = !!password && !!guestExpected && equal(password, guestExpected);
  if (!isAdmin && !isGuest) {
    // Slow down guessing; there is no shared store for real rate limiting
    await new Promise((r) => setTimeout(r, 800));
    return res.status(401).json({ error: "Wrong password" });
  }

  try {
    res.setHeader("Set-Cookie", newSession(isAdmin ? "admin" : "notes"));
  } catch (err) {
    console.error("stock login config error:", err.message);
    return res.status(500).json({ error: "Stock tool is not configured" });
  }
  return res.status(200).json({ ok: true, role: isAdmin ? "admin" : "notes" });
};
