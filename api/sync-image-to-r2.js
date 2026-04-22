module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { recordId, attachments } = req.body;

    if (!recordId || !attachments || attachments.length === 0) {
      return res.status(400).json({ error: 'Missing recordId or attachments' });
    }

    const attachment = attachments[0];
    const imageUrl = attachment.url;
    const fileName = attachment.filename;

    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download: ${imageResponse.statusText}`);
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const ext = fileName.split('.').pop();
    const uuid = Date.now() + Math.random().toString(36).substring(2, 8);
    const r2Key = `artworks/${uuid}.${ext}`;

    const presignedUrlResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${process.env.R2_ACCOUNT_ID}/r2/buckets/${process.env.R2_BUCKET_NAME}/objects/${r2Key}/put-url`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.R2_API_TOKEN}`,
        },
      }
    );

    if (!presignedUrlResponse.ok) {
      const error = await presignedUrlResponse.text();
      throw new Error(`Presigned URL error: ${error}`);
    }

    const presignedData = await presignedUrlResponse.json();
    const presignedUrl = presignedData.result.uploadURL;

    const uploadResponse = await fetch(presignedUrl, {
      method: 'PUT',
      body: imageBuffer,
      headers: {
        'Content-Type': imageResponse.headers.get('content-type'),
      },
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload failed: ${uploadResponse.statusText}`);
    }

    const r2Url = `https://${process.env.R2_BUCKET_NAME}.${process.env.R2_ACCOUNT_ID}.r2.dev/${r2Key}`;

    const updateResponse = await fetch(
      `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_TABLE_ID}/${recordId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${process.env.AIRTABLE_PAT}`,
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
      throw new Error(`Airtable update failed: ${updateResponse.statusText}`);
    }

    return res.status(200).json({ success: true, r2Url });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
