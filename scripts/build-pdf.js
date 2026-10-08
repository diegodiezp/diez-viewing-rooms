// Builds viewing-room PDFs on GitHub Actions (see .github/workflows/pdf.yml),
// where there is no 60 s / 4.5 MB limit: same layout as /:slug/pdf2, but with
// full-resolution images. Each PDF is uploaded to Cloudflare R2 and its link
// saved in the room's "PDF" field in Airtable; the room's "Download PDF"
// button then serves that file.
//
//   SLUG=<url slug>   build that room
//   (no SLUG)         refresh every room that already has a PDF; rooms that
//                     have expired get their PDF deleted and the field cleared
//   DRY_RUN=1         write PDFs to ./out instead of uploading
//
// Env: AIRTABLE_PAT (read + write on the base), R2_ACCOUNT_ID,
// R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL.
//
// The repository is public, so its Actions logs are too: this script only
// ever prints slugs, page sizes and timings, never prices or contacts.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { generatePdf2 } = require("../api/_lib/pdf2");
const { airtable, TBL_VR } = require("../api/_lib/pdf").helpers;

const env = process.env;
const DRY = env.DRY_RUN === "1";
const BASE_ID = "appkTmFvjmDLOQS4p";

function need(name) {
  if (!env[name]) { console.error("Missing env " + name); process.exit(1); }
  return env[name];
}

// Stable, unguessable object name per room: the same room always overwrites
// the same file (so links in sent emails keep working), but nobody can guess
// another room's PDF from its slug.
function objectKey(slug) {
  const h = crypto.createHmac("sha256", need("R2_SECRET_ACCESS_KEY")).update(slug).digest("hex").slice(0, 20);
  return "pdfs/" + slug + "-" + h + ".pdf";
}

let r2 = null;
function r2Client() {
  if (!r2) {
    const { AwsClient } = require("aws4fetch");
    r2 = new AwsClient({
      accessKeyId: need("R2_ACCESS_KEY_ID"),
      secretAccessKey: need("R2_SECRET_ACCESS_KEY"),
      service: "s3",
      region: "auto",
    });
  }
  return r2;
}
const r2Url = (key) => "https://" + need("R2_ACCOUNT_ID") + ".r2.cloudflarestorage.com/" + need("R2_BUCKET") + "/" + key;

async function upload(key, body, fileName) {
  const res = await r2Client().fetch(r2Url(key), {
    method: "PUT",
    body,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'inline; filename="' + fileName + '"',
      "Cache-Control": "public, max-age=300",
    },
  });
  if (!res.ok) throw new Error("R2 upload failed: " + res.status);
}

async function remove(key) {
  const res = await r2Client().fetch(r2Url(key), { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error("R2 delete failed: " + res.status);
}

async function setPdfField(token, recordId, value) {
  const res = await fetch("https://api.airtable.com/v0/" + BASE_ID + "/" + TBL_VR + "/" + recordId, {
    method: "PATCH",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { PDF: value } }),
  });
  if (!res.ok) throw new Error("Airtable update failed: " + res.status);
}

async function listRooms(token, slug) {
  const formula = slug ? '{URL slug} = "' + slug + '"' : "NOT({PDF} = '')";
  const out = [];
  let offset;
  do {
    const params = { filterByFormula: formula, fields: ["URL slug", "PDF", "Expires", "Name"] };
    if (offset) params.offset = offset;
    const data = await airtable(token, TBL_VR, params);
    out.push(...(data.records || []));
    offset = data.offset;
  } while (offset);
  return out;
}

const safeName = (t) => (t || "viewing-room").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "viewing-room";

(async () => {
  const token = need("AIRTABLE_PAT");
  const slug = String(env.SLUG || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  const rooms = await listRooms(token, slug);
  if (!rooms.length) {
    console.log(slug ? "No room with slug " + slug : "No rooms with a PDF to refresh");
    if (slug) process.exit(1);
    return;
  }

  let failed = 0;
  for (const rec of rooms) {
    const s = rec.fields["URL slug"];
    const t0 = Date.now();
    try {
      const expired = rec.fields["Expires"] && new Date(rec.fields["Expires"]) < new Date();
      if (expired) {
        if (rec.fields["PDF"] && !DRY) {
          await remove(objectKey(s));
          await setPdfField(token, rec.id, null);
          console.log(s + ": expired, PDF removed");
        }
        continue;
      }
      const out = await generatePdf2({
        slug: s, token, maxBytes: Infinity, caps: { view: 3000, work: 2400 },
      });
      if (out.error) { console.log(s + ": skipped (" + out.error + ")"); continue; }
      const fileName = "Diez-Gallery-" + safeName(out.title) + ".pdf";
      const mb = (out.pdf.length / 1048576).toFixed(1) + " MB";
      if (DRY) {
        fs.mkdirSync("out", { recursive: true });
        fs.writeFileSync(path.join("out", fileName), out.pdf);
        console.log(s + ": " + mb + " written to out/ in " + ((Date.now() - t0) / 1000).toFixed(0) + " s");
        continue;
      }
      const key = objectKey(s);
      await upload(key, out.pdf, fileName);
      const url = need("R2_PUBLIC_URL").replace(/\/$/, "") + "/" + key + "?v=" + Date.now().toString(36);
      await setPdfField(token, rec.id, url);
      console.log(s + ": " + mb + " uploaded in " + ((Date.now() - t0) / 1000).toFixed(0) + " s");
    } catch (e) {
      failed++;
      console.error(s + ": failed (" + e.message + ")");
    }
  }
  if (failed) process.exit(1);
})();
