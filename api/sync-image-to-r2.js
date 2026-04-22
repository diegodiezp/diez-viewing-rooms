const crypto = require('crypto');

function signRequest(method, path, headers, accessKey, secretKey, region) {
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 8);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const service = 's3';

  headers['x-amz-date'] = amzDate;
  headers['x-amz-content-sha256'] = 'UNSIGNED-PAYLOAD';

  const signedHeaderKeys = Object.keys(headers).map(k => k.toLowerCase()).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(k => k.toLowerCase() + ':' + headers[k].trim())
    .join('\n') + '\n';

  const canonicalRequest = [method, path, '', canonicalHeaders, signedHeaderKeys, 'UNSIGNED-PAYLOAD'].join('\n');
  const credentialScope = dateStamp + '/' + region + '/' + service + '/aws4_request';
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');

  function hmac(key, data) { return crypto.createHmac('sha256', key).update(data).digest(); }
  let signingKey = hmac('AWS4' + secretKey, dateStamp);
  signingKey = hmac(signingKey, region);
  signingKey = hmac(signingKey, service);
  signingKey = hmac(signingKey, 'aws4_request');

  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  headers['Authorization'] = 'AWS4-HMAC-SHA256 Credential=' + accessKey + '/' + credentialScope + ', SignedHeaders=' + signedHeaderKeys + ', Signature=' + signature;

  return headers;
}

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

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const uuid = Date.now() + '-' + Math.random().toString(36).substring(2, 8);
    const r2Key = 'artworks/' + uuid + '.' + ext;

    // Subir directamente a R2 usando S3 API
    const endpoint = process.env.R2_ACCOUNT_ID + '.r2.cloudflarestorage.com';
    const path = '/' + process.env.R2_BUCKET_NAME + '/' + r2Key;

    const headers = {
      'Host': endpoint,
      'Content-Type': contentType,
      'Content-Length': String(imageBuffer.length),
    };

    const signedHeaders = signRequest('PUT', path, headers, process.env.R2_ACCESS_KEY_ID, process.env.R2_SECRET_ACCESS_KEY, 'auto');

    const uploadResponse = await fetch('https://' + endpoint + path, {
      method: 'PUT',
      headers: signedHeaders,
      body: imageBuffer,
    });

    if (!uploadResponse.ok) {
      const errText = await uploadResponse.text();
      throw new Error('Upload failed: ' + errText);
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
