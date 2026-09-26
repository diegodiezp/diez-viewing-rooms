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

## Environment variables (Vercel)

- `AIRTABLE_PAT`: Airtable personal access token (read for the proxies)
