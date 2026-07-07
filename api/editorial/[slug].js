export default async function handler(req, res) {
  const { slug } = req.query;
  const BASE = 'appkTmFvjmDLOQS4p';
  const KEY = process.env.AIRTABLE_API_KEY;
  const H = { Authorization: `Bearer ${KEY}` };
  const at = (path) =>
    fetch(`https://api.airtable.com/v0/${BASE}/${path}`, { headers: H })
      .then(r => r.json());

  // 1. Room por slug
  const roomData = await at(
    `tblAV0zH4VsmLTaJN?filterByFormula=${encodeURIComponent(
      `{URL slug}='${slug}'`
    )}&maxRecords=1`
  );
  const room = roomData.records?.[0];
  if (!room) return res.status(404).json({ error: 'Not found' });
  if (room.fields.Status !== 'Live' && req.query.preview !== '1')
    return res.status(404).json({ error: 'Not live' });

  // 2. Bloques de la room, ordenados
  const blocksData = await at(
    `tblUkJCp25urtPePV?filterByFormula=${encodeURIComponent(
      `FIND('${room.id}', ARRAYJOIN({Room}))`
    )}&sort%5B0%5D%5Bfield%5D=Order&sort%5B0%5D%5Bdirection%5D=asc`
  );
  const blocks = blocksData.records || [];

  // 3. Resolver artworks enlazados en un solo fetch
  const artIds = blocks.flatMap(b => b.fields.Artwork || []);
  let artworks = {};
  if (artIds.length) {
    const formula = `OR(${artIds.map(id => `RECORD_ID()='${id}'`).join(',')})`;
    const artData = await at(
      `tblK8xDtKmakHWt6k?filterByFormula=${encodeURIComponent(formula)}`
    );
    for (const a of artData.records || []) artworks[a.id] = a.fields;
  }

  // 4. Payload limpio para el frontend
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  res.json({
    title: room.fields.Name,
    subtitle: room.fields.Subtitle || '',
    meta: room.fields['Meta description'] || '',
    blocks: blocks.map(b => ({
      type: b.fields['Block type'],
      text: b.fields.Text || '',
      caption: b.fields.Caption || '',
      image: b.fields.Image?.[0]?.url || null,
      image2: b.fields['Image 2']?.[0]?.url || null,
      videoUrl: b.fields['Video URL'] || null,
      showPrice: !!b.fields['Show price'],
      artwork: b.fields.Artwork?.[0] ? artworks[b.fields.Artwork[0]] : null,
    })),
  });
}
