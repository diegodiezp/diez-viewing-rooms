module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { recordId, imageUrl } = req.body;

    if (!recordId || !imageUrl) {
      return res.status(400).json({ error: 'Missing recordId or imageUrl' });
    }

    // Descargar imagen desde Airtable
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error('Failed to download: ' + imageResponse.statusText);
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const contentType = imageResponse.headers.get('content-type');
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const uuid = Date.now() + '-' + Math.random().toString(36).substring(2, 8);
    const r2Key = 'artworks/' + uuid + '.' + ext;

    // Obtener presigned URL de R2
    const presignedResponse = await fetch(
      'https://api.cloudflare.com/client/v4/accounts/' + process.env.R2_ACCOUNT_ID + '/r2/buckets/' + process.env.R2_BUCKET_NAME + '/objects/' + r2Key + '/put-url',
      {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + process.env.R2_API_TOKEN,
        },
      }
    );

    if (!presignedResponse.ok) {
      const errText = await presignedResponse.text();
      throw new Error('Presigned URL error: ' + errText);
    }

    const presignedData = await presignedResponse.json();
    const uploadUrl = presignedData.result.uploadURL;

    // Subir a R2
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      body: imageBuffer,
      headers: {
        'Content-Type': contentType,
      },
    });

    if (!uploadResponse.ok) {
      throw new Error('Upload failed: ' + uploadResponse.statusText);
    }

    // URL pública
    const r2Url = 'https://' + process.env.R2_BUCKET_NAME + '.' + process.env.R2_ACCOUNT_ID + '.r2.dev/' + r2Key;

    // Actualizar Airtable
    const updateResponse = await fetch(
      'https://api.airtable.com/v0/' + process.env.AIRTABLE_BASE_ID + '/' + process.env.AIRTABLE_TABLE_ID + '/' + recordId,
      {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer ' + process.env.AIRTABLE_PAT,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fields: {
            'Image URL': r2Url,
          },
        }),
      }
    );

    if (!updateResponse.ok) {
      throw new Error('Airtable update failed: ' + updateResponse.statusText);
    }

    return res.status(200).json({ success: true, r2Url: r2Url });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
