// Shared CORS helper for all API endpoints.
//
// Note: CORS only restricts which *browser* origins can read responses from
// JS — it does not block direct requests (curl, server-side fetch). The real
// access control is the table/field whitelists in each endpoint.

// Only these origins may consume the API from the browser
const ALLOWED_ORIGINS = [
  "https://rooms.diez.gallery",
  "https://diez.gallery",
  "https://www.diez.gallery",
  "http://localhost:3000", // local development
];

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

module.exports = { applyCors, ALLOWED_ORIGINS };
