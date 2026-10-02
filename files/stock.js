// Shared helpers for the private stock tool (/stock).
//
// Everything under /api/stock is internal: it returns prices, locations,
// owners and notes, so every endpoint requires a signed session cookie.
// This is completely separate from the public viewing-room proxy in
// api/airtable.js, whose whitelists stay untouched.
//
// Env vars (Vercel):
//   STOCK_PASSWORD   password typed on the login screen
//   STOCK_SECRET     long random string used to sign the session cookie
//   STOCK_AIRTABLE_PAT  Airtable token with data.records:read + write on
//                       this base. Kept separate from AIRTABLE_PAT so the
//                       public proxy can stay read-only.
//
// All Airtable access uses field IDs, never names, so renaming a field in
// Airtable can never break this tool.

const crypto = require("crypto");

const BASE_ID = "appkTmFvjmDLOQS4p";
const COOKIE = "diez_stock";
const SESSION_DAYS = 30;
// Two kinds of sign-in. "admin" can edit everything. "notes" (fairs,
// assistants) can read the inventory and add notes, nothing else.
// Cookies signed before roles existed carry no role and count as admin,
// because there was only one password then.
const GUEST_SESSION_DAYS = 14;

const T = {
  artworks: "tblK8xDtKmakHWt6k",
  artists: "tbl3fHryX8bPSYMyN",
  clients: "tblKLcT0Vi40JC0eI",
  exhibitions: "tblaJqBPOBDEOF8eZ",
  rooms: "tbl8EUvqiOLudNvjv",
};

// Artworks fields, by ID
const F = {
  title: "fldfto5Djz22GbStf",
  image: "fldNIob58FpKw4Uw2",
  artist: "fldlOEtSLuxK8kqSA",
  medium: "fldlBV50szH09gBQK",
  year: "fldKJ4uBNkeiSiRdm",
  status: "fldSTQdnaskkDxqWR",
  priceUsd: "fld8aYu7QBddSb6QC",
  priceEur: "fldENLSJWzaMZhgml",
  priceGbp: "fldnPcV7M7qkMh96t",
  soldUsd: "fldid0SWKdoi6Mheh",
  soldEur: "flda1P5KbQ56vvvJt",
  soldGbp: "fldL78QhLzhDw6VNG",
  owner: "fldAQZpVAXjdmxpxH",
  location: "fldJoBo5kICdZZ1yf", // optional: the tool hides location if absent
  details: "fldWVB2yL8X6fbCFS",
  install: "fldCLdVFfIRjWYl8W",
  invoiceSale: "fldLp34mXOqtIwllJ",
  certificate: "fldPXHc1x1CAjNm7B",
  notes: "fldm7iINYlNo2BkLh",
  height: "fldXqcePeWLgsXf55",
  width: "fldqmtVZEcpJlgCe7",
  depth: "fldurlI4dpC33ad0p",
  yearEnd: "fldfD6ooA4UTVJnhi",      // optional: second year for works dated between two years
  variableDims: "fldnKMufu6jiGqHQ7", // checkbox: shown as "Variable dimensions"
  framedHeight: "fldPVNqwsdujaKt0P", // cm, work with frame
  framedWidth: "fldPbidu3qbVWaJYL",
  framedDepth: "fldeRKctngOpyBkCh",
  technique: "fldOn5gSWEtFntEZa",
  edition: "fldszNbJnmZ9zBf8K",
  inventory: "fldaTxrlyJ7lM555Y",
  paidArtist: "fldrP97Uk1KYsVWx5",
  archived: "fldg48RttSgnNRA0j",
  exhibitions: "fldSH8zm2vPWCD8Vx",
  exhibitionTags: "fldIbxJLfcsBWs4zs",
};

// Clients table (buyers) fields, by ID
const C = {
  first: "fldbHYdlWIpQSZdd6",
  last: "fldxC6RMIawlYYfsx",
  email: "fldTxtYU6H4t8Pfxs",
};
const PAID_OPTIONS = ["Yes", "No"];

// Exact option names in Airtable (note the trailing space in "Not available ")
const STATUS_OPTIONS = ["Available", "On hold", "Sold", "Consigned", "Not available "];
const LOCATION_OPTIONS = [
  "Gallery Amsterdam", "Gallery Cologne", "Artist studio", "Collector",
  "In transit", "Consigned", "Other gallery, specify",
];

function secret() {
  const s = process.env.STOCK_SECRET;
  if (!s || s.length < 32) throw new Error("STOCK_SECRET missing or too short");
  return s;
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return body + "." + mac;
}

function verify(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

function sessionCookie(value, maxAgeSeconds) {
  return [
    COOKIE + "=" + encodeURIComponent(value),
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    "Max-Age=" + maxAgeSeconds,
  ].join("; ");
}

function newSession(role) {
  const r = role === "notes" ? "notes" : "admin";
  const days = r === "notes" ? GUEST_SESSION_DAYS : SESSION_DAYS;
  const exp = Date.now() + days * 86400 * 1000;
  return sessionCookie(sign({ exp, role: r }), days * 86400);
}

function clearSession() {
  return sessionCookie("", 0);
}

// Returns the session's role ("admin" or "notes") if the request carries a
// valid session; otherwise answers 401 itself and returns false.
// requireSession(req, res, { admin: true }) also answers 403 to a "notes"
// session, so every write endpoint can lock itself to admins in one line.
function requireSession(req, res, opts) {
  noStore(res);
  let payload = null;
  try {
    payload = verify(readCookie(req, COOKIE));
  } catch (err) {
    console.error("stock auth config error:", err.message);
    res.status(500).json({ error: "Stock tool is not configured" });
    return false;
  }
  if (!payload) {
    res.status(401).json({ error: "Not signed in" });
    return false;
  }
  const role = payload.role === "notes" ? "notes" : "admin";
  if (opts && opts.admin && role !== "admin") {
    res.status(403).json({ error: "This account can only add notes" });
    return false;
  }
  return role;
}

// Writes must come from our own page. SameSite=Strict already blocks
// cross-site cookies; this is a second lock.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin fetches from some browsers omit it
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return origin === "https://" + host || origin === "http://" + host;
}

function noStore(res) {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
}

function token() {
  const t = process.env.STOCK_AIRTABLE_PAT;
  if (!t) throw new Error("STOCK_AIRTABLE_PAT not configured");
  return t;
}

// ---- diez-mail base (contacts + tracked links) ----
// The stock tool never signs tracking tokens itself. It only writes a row in
// diez-mail's Short Links table; diez-mail's own /s/[code] route signs the
// token and redirects, exactly like the Manual / WhatsApp links made there.
const MAIL = {
  base: "appFkqvnXlu2Y1Fe4",
  people: "tbl3NlUODD2Ztq3sl",
  shortLinks: "tbliEox0ni0RigKhs",
  manualCampaign: "recCGO12VNM4qbogv", // Campaigns > "Manual / WhatsApp Links"
  p: {
    first: "fldmtHtXN2WIiuEY7",
    last: "fldlW0S7JiqLWNlgh",
    email: "fld7321gIEITgBj0j",
    type: "fld5zbP417mYFvLbZ",
    company: "fldC7TPRIpyatLlWr",
  },
  s: {
    code: "fldgKkl3WRchMjk9i",
    url: "fldHc46WLUWhqi7ub",
    email: "fldhJEdTFk7iCO0RV",
    person: "fldy9CdOpDBY2Cd6x",
    campaign: "fldXS9zrWnITwN8aS",
    tid: "fldYWEVUhm1BRRMqM",
    label: "fldDtMEnvv95QzEHA",
  },
  shortBase: "https://t.diez.gallery/s/",
};

function mailToken() {
  // Either a separate token, or the stock token with the mail base added
  const t = process.env.STOCK_MAIL_PAT || process.env.STOCK_AIRTABLE_PAT;
  if (!t) throw new Error("STOCK_MAIL_PAT not configured");
  return t;
}

async function mail(pathAndQuery, options = {}) {
  return airtable(pathAndQuery, options, MAIL.base, mailToken());
}

async function airtable(pathAndQuery, options = {}, baseId = BASE_ID, tok = null) {
  const res = await fetch("https://api.airtable.com/v0/" + baseId + "/" + pathAndQuery, {
    ...options,
    headers: {
      Authorization: "Bearer " + (tok || token()),
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && (data.error.message || data.error.type)) || res.status;
    throw new Error("Airtable " + res.status + ": " + msg);
  }
  return data;
}

// Fetches every record of a table (Airtable pages at 100), keyed by field ID.
// Pass fieldIds = null to get every field: used for Artworks so a deleted or
// not-yet-created field never makes the whole request fail with a 422.
async function listAll(table, fieldIds) {
  const out = [];
  let offset;
  do {
    const p = new URLSearchParams();
    p.set("pageSize", "100");
    p.set("returnFieldsByFieldId", "true");
    for (const f of fieldIds || []) p.append("fields[]", f);
    if (offset) p.set("offset", offset);
    const data = await airtable(table + "?" + p.toString());
    out.push(...data.records);
    offset = data.offset;
  } while (offset);
  return out;
}

async function readJson(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

const isRecordId = (s) => typeof s === "string" && /^rec[A-Za-z0-9]{14}$/.test(s);

module.exports = {
  BASE_ID, T, F, C, STATUS_OPTIONS, LOCATION_OPTIONS, PAID_OPTIONS,
  newSession, clearSession, requireSession, sameOrigin, noStore,
  airtable, listAll, readJson, isRecordId, MAIL, mail,
};
