import fetch from 'node-fetch';
import { v4 as uuidv4 } from 'uuid';

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_ID = process.env.AIRTABLE_TABLE_ID;
const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_API_TOKEN = process.env.R2_API_TOKEN;

export default async function handler(req, res) {
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

    // Descargar imagen desde Airtable
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download image: ${imageResponse.statusText}`);
    }

    const imageBuffer = await imageResponse.buffer();

    // Generar nombre único para R2
    const ext = fileName.split('.').pop();
    const r2Key = `artworks/${uuidv4()}.${ext}`;

    // Subir a R2 usando presigned URL
    const presignedUrlResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${R2_ACCOUNT_ID}/r2/buckets/${R2_BUCKET_NAME}/objects/${r2Key}/put-url`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${R2_API_TOKEN}`,
        },
      }
    );

    if (!presignedUrlResponse.ok) {
      throw new Error(`Failed to get presigned URL: ${presignedUrlResponse.statusText}`);
    }

    const { result } = await presignedUrlResponse.json();
    const presignedUrl = result.uploadURL;

    // Subir archivo a R2 usando presigned URL
    const uploadResponse = await fetch(presignedUrl, {
      method: 'PUT',
      body: imageBuffer,
      headers: {
        'Content-Type': imageResponse.headers.get('content-type'),
      },
    });

    if (!uploadResponse.ok) {
      throw new Error(`Failed to upload to R2: ${uploadResponse.statusText}`);
    }

    // Generar URL pública de R2
    const r2Url = `https://${R2_BUCKET_NAME}.${R2_ACCOUNT_ID}.r2.dev/${r2Key}`;

    // Actualizar registro en Airtable
    const updateResponse = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${recordId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${AIRTABLE_PAT}`,
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
      throw new Error(`Failed to update Airtable: ${updateResponse.statusText}`);
    }

    return res.status(200).json({
      success: true,
      r2Url,
      r2Key,
    });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
