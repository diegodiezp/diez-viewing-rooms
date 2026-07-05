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

## Editing the frontend

The JSX is precompiled so visitors don't pay for Babel in the browser.
After changing `src/viewing-room.jsx`:

```sh
npm install        # first time only
npm run compile    # regenerates files/viewing-room.js
```

Commit both the source and the compiled file.

## Environment variables (Vercel)

- `AIRTABLE_PAT` — Airtable personal access token (read for the proxies)
