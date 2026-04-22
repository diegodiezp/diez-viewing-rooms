import fetch from 'node-fetch';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_ID = process.env.AIRTABLE_TABLE_ID;
const AIRTABLE_PAT = process.env.AIRTABLE_PAT;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;

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

    // Subir a R2
    const uploadCommand = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: r2Key,
      Body: imageBuffer,
      ContentType: imageResponse.headers.get('content-type'),
    });

    await s3Client.send(uploadCommand);

    // Generar URL pública de R2
    const r2Url = `https://${R2_BUCKET_NAME}.${process.env.R2_ACCOUNT_ID}.r2.dev/${r2Key}`;

    // Actualizar registro en Airtable con la URL de R2
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
