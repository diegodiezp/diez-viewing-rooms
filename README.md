# diez viewing rooms

Online viewing rooms for [diez.gallery](https://diez.gallery), backed by
Airtable and deployed on Vercel.

## Structure

- `viewing-room.html` — page shell (styles, meta tags, script tags)
- `src/viewing-room.jsx` — the React app **(edit this, not the compiled file)**
- `files/viewing-room.js` — compiled output, loaded by the HTML
- `files/react*.production.min.js` — self-hosted React 18.3.1 UMD builds
- `api/airtable.js` — read-only Airtable proxy (table + formula whitelist)
- `api/image.js` / `api/attachment.js` — attachment proxies (field whitelist)
- `api/room.js` — serves `/:slug` with room-specific OG/Twitter meta tags
- `api/sync-image-to-r2.js` — copies an Airtable image to R2 (authenticated)

## Editing the frontend

The JSX is precompiled so visitors don't pay for Babel in the browser.
After changing `src/viewing-room.jsx`:

```sh
npm install        # first time only
npm run build      # regenerates files/viewing-room.js
```

Commit both the source and the compiled file.

## Environment variables (Vercel)

- `AIRTABLE_PAT` — Airtable personal access token (read for the proxies,
  write for the R2 sync)
- `SYNC_SECRET` — shared secret for `api/sync-image-to-r2.js`; callers must
  send it in the `x-sync-secret` header
- `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_ID` — used by
  the R2 sync endpoint
