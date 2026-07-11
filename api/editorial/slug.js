// api/editorial/[slug].js
// Editorial Rooms endpoint — Diez viewing rooms
// GET /api/editorial/waelder-1993          -> room Live
// GET /api/editorial/waelder-1993?preview=1 -> room en Draft (para revisar antes de publicar)

const BASE = 'appkTmFvjmDLOQS4p';
const T_ROOMS = 'tblAV0zH4VsmLTaJN';   // Editorial Rooms
const T_BLOCKS = 'tblUkJCp25urtPePV';  // Editorial Blocks
const T_ART = 'tblK8xDtKmakHWt6k';     // Artworks

// Nombres de campo de la tabla Artworks.
// Si alguno difiere en tu base, corrígelo AQUÍ y en ningún otro sitio.
const ART_FIELDS = {
  title: 'Title',
  year: 'Year',
  technique: 'Technique',
  height: 'Height (cm)',
  width: 'Width (cm)',
  price: 'Price €',
  image: 'Image',
};

export default async function handler(req, res) {
  const { slug, preview } = req.query;
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: 'Invalid slug' });
  }

  const at = async (path) => {
    const r = await fetch(`https://api.airtable.com/v0/${BASE}/${path}`, {
      headers: { Authorization: `Bearer ${process.env.AIRTABLE_PAT}` },
    });
    if (!r.ok) throw new Error(`Airtable ${r.status}`);
    return r.json();
  };

  try {
    // 1. Room por slug
    const roomData = await at(
      `${T_ROOMS}?filterByFormula=${encodeURIComponent(`{URL slug}='${slug}'`)}&maxRecords=1`
    );
    const room = roomData.records?.[0];
    if (!room) return res.status(404).json({ error: 'Not found' });

    const status = room.fields.Status;
    const expired =
      room.fields.Expires && new Date(room.fields.Expires) < new Date();
    if ((status !== 'Live' || expired) && preview !== '1') {
      return res.status(404).json({ error: 'Not available' });
    }

    // 2. Bloques: via el enlace inverso en Editorial Rooms
    // (ARRAYJOIN de linked records devuelve nombres, no IDs, asi que
    //  pedimos los bloques por RECORD_ID usando la lista del reverse link)
    const blockIds =
      room.fields['Editorial Blocks'] ||
      Object.entries(room.fields).find(
        ([k, v]) =>
          k !== 'Artist' &&
          Array.isArray(v) &&
          v.length &&
          typeof v[0] === 'string' &&
          v[0].startsWith('rec')
      )?.[1] ||
      [];
    let blocks = [];
    if (blockIds.length) {
      const bf = `OR(${blockIds.map((id) => `RECORD_ID()='${id}'`).join(',')})`;
      const blocksData = await at(
        `${T_BLOCKS}?filterByFormula=${encodeURIComponent(bf)}&pageSize=100`
      );
      blocks = (blocksData.records || []).sort(
        (a, b) => (a.fields.Order || 0) - (b.fields.Order || 0)
      );
    }

    // 3. Artworks enlazados, un solo fetch
    const artIds = [...new Set(blocks.flatMap((b) => b.fields.Artwork || []))];
    const artworks = {};
    if (artIds.length) {
      const formula = `OR(${artIds.map((id) => `RECORD_ID()='${id}'`).join(',')})`;
      const artData = await at(
        `${T_ART}?filterByFormula=${encodeURIComponent(formula)}`
      );
      for (const a of artData.records || []) artworks[a.id] = a.fields;
    }

    // 4. Ficha de obra normalizada
    const F = ART_FIELDS;
    const artworkPayload = (id, showPrice) => {
      const f = artworks[id];
      if (!f) return null;
      const dims =
        f[F.height] && f[F.width] ? `${f[F.height]} × ${f[F.width]} cm` : '';
      return {
        title: f[F.title] || '',
        year: f[F.year] || '',
        technique: f[F.technique] || '',
        dims,
        price: showPrice && f[F.price] ? `€ ${Number(f[F.price]).toLocaleString('nl-NL')}` : null,
        image: f[F.image]?.[0]?.url || null,
      };
    };

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.setHeader('Access-Control-Allow-Origin', 'https://rooms.diez.gallery');

    return res.json({
      title: room.fields.Name || '',
      subtitle: room.fields.Subtitle || '',
      meta: room.fields['Meta description'] || '',
      blocks: blocks.map((b) => ({
        type: b.fields['Block type'],
        text: b.fields.Text || '',
        caption: b.fields.Caption || '',
        image: b.fields.Image?.[0]?.url || null,
        image2: b.fields['Image 2']?.[0]?.url || null,
        videoUrl: b.fields['Video URL'] || null,
        artwork: b.fields.Artwork?.[0]
          ? artworkPayload(b.fields.Artwork[0], !!b.fields['Show price'])
          : null,
      })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Server error' });
  }
}
