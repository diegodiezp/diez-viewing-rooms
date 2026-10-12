# diez viewing rooms

Online viewing rooms for [diez.gallery](https://diez.gallery), backed by
Airtable and deployed on Vercel.

## Structure

- `viewing-room.html`: page shell (styles, meta tags, script tags)
- `src/viewing-room.jsx`: the React app **(edit this, not the compiled file)**
- `files/viewing-room.js`: compiled output, the only JS the page loads
- `files/react*.production.min.js`: self-hosted React 18.3.1 UMD builds
- `files/Replica_*.woff2`, `files/logo.png`, `files/favicon.ico`: static assets
- `api/airtable.js`: read-only Airtable proxy (table + field + formula whitelist)
- `api/image.js` / `api/attachment.js`: attachment proxies (field whitelist)
- `api/room.js`: serves `/:slug` with room-specific OG/Twitter meta tags
- `api/_lib/cors.js`: shared CORS helper
- `editorial.html` + `files/editorial.js` + `api/editorial/[slug].js`:
  editorial rooms at `/e/:slug` (tables Editorial Rooms / Editorial Blocks)

## Room layouts

- **Single room**: `Artworks` + `Installation Views`. Works first, then a grid
  of installation views.
- **Sectioned room**: `Installation Views 1..3` + `Artworks 1..3`. Rendered as
  views 1, works 1, views 2, works 2, views 3, works 3. Empty blocks are
  skipped. Used as soon as any of these six fields has content.

A new Airtable field is only visible to the site after it is added to the
whitelist in `api/airtable.js` (and, for attachments, `api/attachment.js`).

## Editing the frontend

The JSX is precompiled so visitors don't pay for Babel in the browser.
After changing `src/viewing-room.jsx`:

```sh
npm install        # first time only
npm run compile    # regenerates files/viewing-room.js
```

Commit both the source and the compiled file, with exactly these names.

## Booth QR (lead capture at fairs)

Open any room with `?via=booth` (that is the URL the stand's QR code points
to) and prices plus the room PDF stay hidden behind a short form: email
and optional name. The form posts to diez-mail
(`https://t.diez.gallery/api/ev/lead`), which stores the contact in People
(Type "Booth QR"), emails them the room and answers with a tracking token.
The room then unlocks and the visit is logged like a campaign recipient's.

- Links with `?t=` (email campaigns) and the plain room URL are never gated.
- The token is kept in the phone's localStorage, so a returning visitor
  isn't asked again; it is not written into the URL, so a forwarded link
  never carries someone else's identity.
- If diez-mail can't be reached, the room unlocks anyway (fair Wi-Fi).
- Related rooms keep `?via=booth` (or the token) when the visitor moves on.
- It is a soft gate: prices still reach the browser through the public proxy.

## Environment variables (Vercel)

- `AIRTABLE_PAT`: Airtable personal access token (read for the proxies)

## Stock (private inventory tool)

`/stock` is a password-protected, phone-first browser for the whole
Artworks table: search, filters (artist, status, medium, price, size),
a to-scale view, work detail with documents, status changes, and a
selection tray that creates a private viewing room, copies a caption
list or prints a tearsheet.

- `stock.html` + `files/stock.js`: page shell and plain-JS front end
  (no compile step)
- `api/_lib/stock.js`: session cookie (HMAC), Airtable helpers, field IDs
- `api/stock/login.js`: POST password, DELETE signs out
- `api/stock/works.js`: full inventory, linked names resolved server-side
- `api/stock/update.js`: status / location of one work (whitelisted options)
- `api/stock/room.js`: creates a private room in the Viewing Rooms table

It never goes through `api/airtable.js`, so the public whitelists stay as
they are. It uses field IDs, so renaming Airtable fields does not break it.

Extra environment variables:

- `STOCK_PASSWORD`: the password typed on the login screen
- `STOCK_SECRET`: 32+ random characters, signs the session cookie
- `STOCK_AIRTABLE_PAT`: token with `data.records:read` and
  `data.records:write` on this base only

## Viewing room PDFs

- `/:slug/pdf`: portrait PDF, generated live on Vercel (`api/_lib/pdf.js`).
- `/:slug/pdf2`: landscape PDF in the gallery's own layout, generated live
  (`api/_lib/pdf2.js`). Works sit on an extended wall
  (`api/_lib/wallextend.js`); `?wall=0` turns that off. Vercel caps the
  response at ~4.5 MB and 60 s, so images are re-encoded to fit
  (`api/_lib/pdfimages.js`).
- `/:slug/pdfm`: the same room for phones (`api/_lib/pdfm.js`): 390 x 720 pt
  pages, so phone PDF viewers show them at real size and the reader scrolls
  down; installation views two to a page, one work per page on the extended
  wall with the caption under it. `?wall=0` turns the wall off.
- Full quality: `.github/workflows/pdf.yml` runs `scripts/build-pdf.js` on
  GitHub Actions (no size or time limit), uploads the PDF to Cloudflare R2
  and writes its link into the room's `PDF` field in Airtable. The room's
  "Download PDF" button uses that link when present, `/:slug/pdf2`
  otherwise. Run it from Actions > "Viewing room PDFs" > Run workflow with
  the room's slug; every night it refreshes the rooms that already have a
  PDF and removes the PDFs of expired rooms.

  Each run also builds an InDesign package (`scripts/idml.js`): a .zip with
  an .idml of the same layout (editable text, named paragraph styles in
  Replica Pro) and a Links folder with every image. Its link goes to the
  room's `InDesign` field in Airtable (internal, not shown on the room).

  Repository secrets: `AIRTABLE_PAT` (read + write), `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY` (R2 token "diez-pdfs-github-actions", Object Read &
  Write on `diez-gallery` only). Bucket, account and public URL are set in
  the workflow file. PDFs live under `pdfs/` in the `diez-gallery` bucket.
  The repository is public, so Actions logs are public: the script only
  prints slugs, sizes and timings.
