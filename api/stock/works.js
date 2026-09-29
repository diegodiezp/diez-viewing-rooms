// GET -> the full inventory in one compact payload, for the stock page.
// Resolves linked records (artists, owners, exhibitions) to names server-side
// so the phone never has to.
const { T, F, requireSession, listAll } = require("../_lib/stock");

// Warm function instances reuse this for a minute. The page asks for
// ?fresh=1 after its own writes and on manual refresh.
let memo = { at: 0, data: null };
const TTL = 60 * 1000;

const thumb = (a, size) =>
  (a.thumbnails && a.thumbnails[size] && a.thumbnails[size].url) || a.url;

function images(list) {
  return (list || [])
    .filter((a) => (a.type || "").startsWith("image/"))
    .map((a) => ({
      s: thumb(a, "large"),   // ~512px, grid
      l: thumb(a, "full"),    // ~3000px, detail view
      w: a.width || null,
      h: a.height || null,
    }));
}

function files(list) {
  return (list || []).map((a) => ({ name: a.filename, url: a.url }));
}

async function build() {
  const [works, artists, clients, exhibitions] = await Promise.all([
    listAll(T.artworks, null),
    listAll(T.artists, ["fldkqPCHZcaYFDyjO"]),
    listAll(T.clients, ["fldbHYdlWIpQSZdd6", "fldxC6RMIawlYYfsx"]),
    listAll(T.exhibitions, ["fld2fYPaVjGsMKZmR", "fldSok60pzC1H7dXb"]),
  ]);

  const artistName = new Map(artists.map((r) => [r.id, (r.fields.fldkqPCHZcaYFDyjO || "").trim()]));
  const clientName = new Map(clients.map((r) => [
    r.id,
    [r.fields.fldbHYdlWIpQSZdd6, r.fields.fldxC6RMIawlYYfsx].filter(Boolean).join(" ").trim(),
  ]));
  const exhibition = new Map(exhibitions.map((r) => [r.id, {
    name: r.fields.fld2fYPaVjGsMKZmR || "",
    date: r.fields.fldSok60pzC1H7dXb || "",
  }]));

  let hasLocation = false;
  const out = works
    .filter((r) => (r.fields[F.title] || "").trim())
    .map((r) => {
      const f = r.fields;
      const linkedExh = (f[F.exhibitions] || []).map((id) => exhibition.get(id)).filter(Boolean);
      const exhNames = linkedExh.length
        ? linkedExh.sort((a, b) => (b.date || "").localeCompare(a.date || "")).map((e) => e.name)
        : (f[F.exhibitionTags] || []).filter((n) => n !== "No exhibition");
      const artistIds = f[F.artist] || [];
      if (f[F.location]) hasLocation = true;
      return {
        id: r.id,
        title: f[F.title].trim(),
        artistIds,
        artist: artistIds.map((id) => artistName.get(id)).filter(Boolean).join(", "),
        year: f[F.year] || null,
        status: (f[F.status] || "").trim(),
        location: f[F.location] || "",
        technique: f[F.technique] || "",
        medium: f[F.medium] || [],
        h: f[F.height] || null,
        w: f[F.width] || null,
        d: f[F.depth] || null,
        edition: f[F.edition] || "",
        eur: f[F.priceEur] ?? null,
        usd: f[F.priceUsd] ?? null,
        gbp: f[F.priceGbp] ?? null,
        soldEur: f[F.soldEur] ?? null,
        soldUsd: f[F.soldUsd] ?? null,
        soldGbp: f[F.soldGbp] ?? null,
        owner: (f[F.owner] || []).map((id) => clientName.get(id)).filter(Boolean).join(", "),
        code: f[F.inventory] || "",
        notes: f[F.notes] || "",
        paidArtist: f[F.paidArtist] || "",
        archived: !!f[F.archived],
        exhibitions: exhNames,
        img: images(f[F.image]),
        details: images(f[F.details]),
        install: images(f[F.install]),
        docs: [
          ...files(f[F.certificate]).map((x) => ({ ...x, kind: "Certificate" })),
          ...files(f[F.invoiceSale]).map((x) => ({ ...x, kind: "Invoice" })),
        ],
        added: r.createdTime,
      };
    });

  return { at: new Date().toISOString(), hasLocation, works: out };
}

module.exports = async function handler(req, res) {
  if (!requireSession(req, res)) return;
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const fresh = req.query.fresh === "1";
    if (!fresh && memo.data && Date.now() - memo.at < TTL) {
      return res.status(200).json(memo.data);
    }
    const data = await build();
    memo = { at: Date.now(), data };
    return res.status(200).json(data);
  } catch (err) {
    console.error("stock works error:", err.message);
    return res.status(502).json({ error: "Could not load the inventory from Airtable" });
  }
};
