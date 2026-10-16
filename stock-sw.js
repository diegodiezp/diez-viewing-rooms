/* diez stock service worker (scope /stock)
 *
 * Makes the stock tool usable on bad fair wifi, or none at all:
 *  - the page itself (HTML, script, fonts, logo) opens from this phone's
 *    cache instantly and refreshes in the background;
 *  - every stock image (/api/image?a=...) is kept forever once seen (its URL
 *    never changes for the same picture), so it is downloaded only once;
 *  - the page saves images ahead of time by simply requesting them (see
 *    "offline" in files/stock.js), so at the gallery, on good wifi, the
 *    whole inventory goes onto the phone.
 * The inventory data itself is kept by the page in localStorage, and every
 * write (status, notes, sales) still needs a connection.
 */
"use strict";

var SHELL = "stock-shell-v1";
var IMAGES = "stock-img-v1";
var SHELL_FILES = [
  "/stock",
  "/files/stock.js",
  "/files/logo.png",
  "/files/favicon.ico",
  "/files/Replica_Regular.woff2",
  "/files/Replica_Italic.woff2",
  "/files/Replica_Bold.woff2",
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(SHELL_FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf("stock-") === 0 && k !== SHELL && k !== IMAGES; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isImage(url) { return url.pathname === "/api/image" && url.searchParams.has("a"); }
function isShell(url) {
  return url.pathname === "/stock" || url.pathname === "/stock.html" || SHELL_FILES.indexOf(url.pathname) >= 0;
}

// Images: from the phone if we have it, otherwise download once and keep it.
function imageFirst(req) {
  return caches.open(IMAGES).then(function (c) {
    return c.match(req.url).then(function (hit) {
      if (hit) return hit;
      return fetch(req.url, { credentials: "omit" }).then(function (res) {
        if (res.ok) c.put(req.url, res.clone());
        return res;
      });
    });
  });
}

// Page files: show the saved copy straight away, update it in the background
// (a new version of the tool is picked up on the next open).
function staleWhileRevalidate(req, key) {
  return caches.open(SHELL).then(function (c) {
    return c.match(key).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res.ok && res.type === "basic") c.put(key, res.clone());
        return res;
      });
      if (hit) { net.catch(function () {}); return hit; }
      return net;
    });
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isImage(url)) { e.respondWith(imageFirst(req)); return; }
  if (req.mode === "navigate" && (url.pathname === "/stock" || url.pathname === "/stock.html")) {
    e.respondWith(staleWhileRevalidate(req, "/stock")); return;
  }
  if (isShell(url)) { e.respondWith(staleWhileRevalidate(req, url.pathname)); return; }
});
