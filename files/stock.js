/* diez stock: private inventory browser for rooms.diez.gallery/stock
 *
 * Plain JS on purpose: no compile step, loads instantly on a phone.
 * Data comes from /api/stock/works (session cookie required) and is kept in
 * localStorage, so the page opens with the last known inventory at once and
 * refreshes in the background.
 */
(function () {
  "use strict";

  var CACHE_KEY = "diez-stock-data-v3"; // bumped: payload gained ye, vd (year end, variable dimensions) and fh/fw/fd (framed size)
  // Data younger than this is shown as is, without asking Airtable again.
  // Saves API calls when the app is opened many times in a row (fairs).
  // The refresh button always fetches fresh data.
  var FRESH_MS = 3 * 60 * 60 * 1000;
  var PREFS_KEY = "diez-stock-prefs-v1";
  var AIRTABLE_URL = "https://airtable.com/appkTmFvjmDLOQS4p/tblK8xDtKmakHWt6k/";
  var STATUSES = ["Available", "On hold", "Sold", "Consigned", "Not available"];
  var LOCATIONS = ["Gallery Amsterdam", "Gallery Cologne", "Artist studio", "Collector", "In transit", "Consigned", "Other gallery, specify"];
  var SORTS = [
    ["recent", "Recently added"],
    ["artist", "Artist"],
    ["newest", "Year, newest first"],
    ["priceDesc", "Price, high to low"],
    ["priceAsc", "Price, low to high"],
    ["size", "Size, largest first"],
  ];

  var app = document.getElementById("app");

  var state = {
    works: [],
    loadedAt: null,
    hasLocation: false,
    shows: [],
    tab: "works",
    show: null,
    loading: false,
    q: "",
    f: {
      artist: [],
      status: ["Available"],
      location: [],
      medium: [],
      priceMin: null,
      priceMax: null,
      sizeMax: null,
      archived: false,
    },
    sort: "recent",
    view: "grid",
    scale: null,
    selecting: false,
    selected: [],
    detail: null,
  };

  // ---------- utils ----------
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function norm(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }
  var money = {};
  function fmt(v, cur) {
    if (v == null || v === "") return "";
    cur = cur || "EUR";
    if (!money[cur]) money[cur] = new Intl.NumberFormat("en-GB", { style: "currency", currency: cur, maximumFractionDigits: 0 });
    return money[cur].format(v);
  }
  function inch(cm) { return (Math.round((cm / 2.54) * 10) / 10).toString(); }
  // "2019" or "2019\u20132021" when the work is dated between two years.
  function yr(w) {
    return w.year && w.ye && w.ye !== w.year ? w.year + "\u2013" + w.ye : (w.year || "");
  }
  function dims(w, sep) {
    if (w.vd) return "Variable dimensions";
    if (!w.h || !w.w) return "";
    var cm = [w.h, w.w, w.d].filter(Boolean).join(" x ");
    var inches = [w.h, w.w, w.d].filter(Boolean).map(inch).join(" x ");
    return cm + " cm" + (sep || " / ") + inches + " in";
  }
  function rank(list, v) { var i = list.indexOf(v); return i < 0 ? 99 : i; }
  // Size with frame, same format as dims(). Empty unless framed height and width are set.
  function framed(w, sep) {
    if (w.vd || !w.fh || !w.fw) return "";
    var cm = [w.fh, w.fw, w.fd].filter(Boolean).join(" x ");
    var inches = [w.fh, w.fw, w.fd].filter(Boolean).map(inch).join(" x ");
    return cm + " cm" + (sep || " / ") + inches + " in";
  }
  // The frame is part of the work: when a framed size exists it is the size
  // that counts for the scale view, the size filter and the size sort.
  function isFramed(w) { return !w.vd && !!(w.fh && w.fw); }
  function outer(w) {
    if (isFramed(w)) return { h: w.fh, w: w.fw, d: w.fd || 0, framed: true };
    if (!w.vd && w.h && w.w) return { h: w.h, w: w.w, d: w.d || 0, framed: false };
    return null;
  }
  function longest(w) {
    var o = outer(w);
    return o ? Math.max(o.h, o.w, o.d) : Math.max(w.h || 0, w.w || 0, w.d || 0);
  }
  // Size line for the grid card: the work, plus the framed size when there is one.
  function cardSize(w) {
    if (w.vd) return "Variable dimensions";
    var a = w.h && w.w ? w.h + " x " + w.w + " cm" : "";
    var f = isFramed(w) ? w.fh + " x " + w.fw + " cm" : "";
    return a && f ? a + " (framed " + f + ")" : (a || (f ? "Framed " + f : ""));
  }
  function byId(id) { for (var i = 0; i < state.works.length; i++) if (state.works[i].id === id) return state.works[i]; return null; }
  function isSold(w) { return w.status === "Sold"; }
  function isHeld(w) { return w.status === "On hold" || w.status === "Offered"; }
  function caption(w) {
    var lines = [];
    if (w.artist) lines.push(w.artist);
    lines.push(w.title + (yr(w) ? ", " + yr(w) : ""));
    if (w.technique) lines.push(w.technique);
    if (dims(w)) lines.push(dims(w));
    if (framed(w)) lines.push("Framed: " + framed(w));
    if (w.edition) lines.push(w.edition);
    if (w.eur && !isSold(w)) lines.push(fmt(w.eur, "EUR") + " (excl. VAT)");
    return lines.join("\n");
  }
  function toast(msg) {
    var t = document.createElement("div");
    t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ f: state.f, sort: state.sort, view: state.view, scale: state.scale, tab: state.tab }));
    } catch (e) {}
  }
  function loadPrefs() {
    try {
      var p = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
      if (p) {
        Object.assign(state.f, p.f || {});
        state.sort = p.sort || state.sort;
        state.tab = p.tab === "shows" ? "shows" : "works";
        state.view = p.view || state.view;
        state.scale = p.scale || null;
      }
    } catch (e) {}
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return false; });
    }
    return Promise.resolve(false);
  }
  function share(title, text, url) {
    if (navigator.share) {
      return navigator.share({ title: title, text: text, url: url }).then(function () { return true; }, function () { return true; });
    }
    return copy(url ? text + "\n" + url : text).then(function (ok) { toast(ok ? "Copied" : "Could not copy"); return ok; });
  }

  // ---------- send a work (caption + image) ----------
  // The image is fetched as soon as the detail opens, through our own
  // /api/image proxy (same origin, allowed by the CSP). Browsers only allow
  // the share sheet right after a tap, so the file has to be ready before
  // the tap rather than downloaded after it.
  var prepared = { id: null, file: null };
  function prepareImage(w) {
    prepared = { id: w.id, file: null };
    if (!w.img.length || !navigator.canShare) return;
    var slug = norm((w.artist ? w.artist + " " : "") + w.title).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "work";
    function get(size) {
      return fetch("/api/image?id=" + encodeURIComponent(w.id) + "&size=" + size).then(function (r) {
        if (!r.ok) throw new Error("image " + r.status);
        return r.blob();
      });
    }
    get("full").catch(function () { return get("large"); }).then(function (blob) {
      if (prepared.id !== w.id) return;
      var type = blob.type && blob.type.indexOf("image/") === 0 ? blob.type : "image/jpeg";
      var ext = type === "image/png" ? ".png" : type === "image/webp" ? ".webp" : ".jpg";
      var file = new File([blob], slug + ext, { type: type });
      if (navigator.canShare({ files: [file] })) prepared.file = file;
    }).catch(function () {});
  }
  function sendWork(w) {
    var text = caption(w);
    var file = prepared.id === w.id ? prepared.file : null;
    if (file && navigator.share) {
      // Some apps (WhatsApp on iPhone among them) drop the text when an image
      // is attached, so the caption also goes to the clipboard.
      copy(text);
      navigator.share({ files: [file], text: text, title: w.title })
        .then(function () { toast("Sent. The caption is also copied"); }, function (err) {
          if (err && err.name === "AbortError") return;
          share(w.title, text);
        });
      return;
    }
    if (w.img.length && navigator.canShare && prepared.id === w.id && !prepared.file) {
      toast("Image still loading, sending the caption only");
    }
    share(w.title, text);
  }

  // ---------- data ----------
  function readCache() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (c && c.works) { state.works = c.works; state.shows = c.shows || []; state.loadedAt = c.at; state.hasLocation = !!c.hasLocation; return true; }
    } catch (e) {}
    return false;
  }
  function writeCache(data) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch (e) {}
  }
  function api(path, opts) {
    return fetch(path, Object.assign({ credentials: "same-origin", headers: { "Content-Type": "application/json" } }, opts || {}))
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) {
          if (r.status === 401) { var e = new Error("auth"); e.auth = true; throw e; }
          if (!r.ok) throw new Error(body.error || "Something went wrong");
          return body;
        });
      });
  }
  function load(fresh) {
    state.loading = true; paintRefresh();
    return api("/api/stock/works" + (fresh ? "?fresh=1" : ""))
      .then(function (data) {
        state.works = data.works; state.shows = data.shows || []; state.loadedAt = data.at; state.hasLocation = !!data.hasLocation;
        if (!state.hasLocation) state.f.location = [];
        writeCache(data);
        state.loading = false;
        render();
      })
      .catch(function (err) {
        state.loading = false;
        if (err.auth) { renderLogin(); return; }
        paintRefresh();
        toast(state.works.length ? "Offline: showing the last saved inventory" : err.message);
        if (!state.works.length) renderEmptyError(err.message);
      });
  }

  // ---------- filtering ----------
  function matches(w, skip) {
    var f = state.f;
    if (!f.archived && w.archived) return false;
    if (skip !== "artist" && f.artist.length && f.artist.indexOf(w.artist) < 0) return false;
    if (skip !== "status" && f.status.length && f.status.indexOf(w.status || "No status") < 0) return false;
    if (skip !== "location" && f.location.length && f.location.indexOf(w.location || "Unknown") < 0) return false;
    if (skip !== "medium" && f.medium.length && !w.medium.some(function (m) { return f.medium.indexOf(m) >= 0; })) return false;
    if (skip !== "price") {
      if (f.priceMin != null && !(w.eur >= f.priceMin)) return false;
      if (f.priceMax != null && !(w.eur != null && w.eur <= f.priceMax)) return false;
    }
    if (skip !== "size" && f.sizeMax != null && !(longest(w) && longest(w) <= f.sizeMax)) return false;
    if (state.q) {
      var hay = norm([w.title, w.artist, w.technique, w.code, yr(w), w.owner, w.edition, w.exhibitions.join(" "), w.location, w.notes].join(" "));
      var terms = norm(state.q).split(/\s+/).filter(Boolean);
      for (var i = 0; i < terms.length; i++) if (hay.indexOf(terms[i]) < 0) return false;
    }
    return true;
  }
  function sorted(list) {
    var s = state.sort;
    var cmp = {
      recent: function (a, b) { return (b.added || "").localeCompare(a.added || ""); },
      artist: function (a, b) { return (a.artist || "~").localeCompare(b.artist || "~") || (b.year || 0) - (a.year || 0); },
      newest: function (a, b) { return (b.year || 0) - (a.year || 0); },
      priceDesc: function (a, b) { return (b.eur || -1) - (a.eur || -1); },
      priceAsc: function (a, b) { return (a.eur == null ? Infinity : a.eur) - (b.eur == null ? Infinity : b.eur); },
      size: function (a, b) { return longest(b) - longest(a); },
    }[s];
    return list.slice().sort(cmp);
  }
  function visible() { return sorted(state.works.filter(function (w) { return matches(w); })); }
  function counts(key, skip) {
    var map = {};
    state.works.forEach(function (w) {
      if (!matches(w, skip)) return;
      var vals = key === "medium" ? w.medium : [key === "status" ? (w.status || "No status") : key === "location" ? (w.location || "Unknown") : w[key]];
      vals.forEach(function (v) { if (v) map[v] = (map[v] || 0) + 1; });
    });
    return map;
  }

  // ---------- icons ----------
  var I = {
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 5l14 14M19 5L5 19"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.4"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M15 5l-7 7 7 7"/></svg>',
  };

  // ---------- login ----------
  function renderLogin(message) {
    app.innerHTML =
      '<main class="login"><form id="login-form">' +
      '<img src="/files/logo.png" alt="diez">' +
      '<label for="pw">Password</label>' +
      '<input id="pw" type="password" autocomplete="current-password" required autofocus>' +
      '<p class="error" role="alert">' + esc(message || "") + "</p>" +
      '<button class="btn primary" type="submit">Sign in</button>' +
      "</form></main>";
    document.getElementById("login-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = e.target.querySelector("button");
      btn.disabled = true;
      api("/api/stock/login", { method: "POST", body: JSON.stringify({ password: document.getElementById("pw").value }) })
        .then(function () { renderShell(); load(true); })
        .catch(function (err) { renderLogin(err.auth ? "Wrong password" : err.message); });
    });
  }

  // ---------- shell ----------
  function renderShell() {
    app.innerHTML =
      '<header class="head">' +
      '  <div class="bar">' +
      '    <nav class="tabs" role="tablist" aria-label="View">' +
      '      <button role="tab" data-tab="works">Works</button>' +
      '      <button role="tab" data-tab="shows">Shows</button>' +
      "    </nav>" +
      '    <input class="search" id="q" type="search" autocomplete="off" enterkeyhint="search" aria-label="Search">' +
      '    <button class="icon-btn" id="refresh" aria-label="Refresh from Airtable">' + I.refresh + "</button>" +
      "  </div>" +
      '  <nav class="filters" id="filters" aria-label="Filters"></nav>' +
      "</header>" +
      '<section class="summary" id="summary"></section>' +
      '<main id="list"></main>' +
      '<div id="tray-slot"></div>' +
      '<div id="sheet-slot"></div>' +
      '<div id="show-slot"></div>' +
      '<div id="detail-slot"></div>';
    var q = document.getElementById("q");
    q.value = state.q;
    var t;
    q.addEventListener("input", function () {
      clearTimeout(t);
      t = setTimeout(function () { state.q = q.value.trim(); renderBody(); }, 120);
    });
    document.getElementById("refresh").addEventListener("click", function () { load(true); });
    document.querySelector(".tabs").addEventListener("click", function (e) {
      var b = e.target.closest("[data-tab]"); if (!b) return;
      var tab = b.getAttribute("data-tab");
      if (tab === state.tab) return;
      state.tab = tab; state.q = ""; q.value = ""; savePrefs(); render();
      window.scrollTo(0, 0);
    });
    render();
  }

  function paintRefresh() {
    var b = document.getElementById("refresh");
    if (b) b.classList.toggle("spin", !!state.loading);
    paintUpdated();
  }

  function render() {
    if (!document.getElementById("list")) return;
    document.querySelectorAll("[data-tab]").forEach(function (b) { b.setAttribute("aria-selected", b.getAttribute("data-tab") === state.tab); });
    var q = document.getElementById("q");
    q.placeholder = state.tab === "shows" ? "Search shows" : "Search works";
    document.getElementById("filters").hidden = state.tab === "shows";
    renderFilters(); renderBody(); paintRefresh();
  }
  function renderBody() {
    if (state.tab === "shows") { renderShowsSummary(); renderShows(); }
    else { renderSummary(); renderList(); }
    renderTray();
    if (state.show) paintShow();
  }

  function pillLabel(name, values, single) {
    if (!values.length) return name;
    if (values.length === 1) return single ? values[0] : name + ": " + values[0];
    return name + ": " + values.length;
  }
  function renderFilters() {
    var f = state.f;
    var price = f.priceMin != null || f.priceMax != null
      ? "Price: " + (f.priceMin != null ? fmt(f.priceMin) : "0") + " to " + (f.priceMax != null ? fmt(f.priceMax) : "any")
      : "Price";
    var sortName = SORTS.filter(function (s) { return s[0] === state.sort; })[0][1];
    var html = [
      ["artist", pillLabel("Artist", f.artist, true), f.artist.length],
      ["status", pillLabel("Status", f.status, true), f.status.length],
      state.hasLocation ? ["location", pillLabel("Location", f.location, true), f.location.length] : null,
      ["medium", pillLabel("Medium", f.medium, true), f.medium.length],
      ["price", price, f.priceMin != null || f.priceMax != null],
      ["size", f.sizeMax != null ? "Up to " + f.sizeMax + " cm" : "Size", f.sizeMax != null],
      ["sort", sortName, false],
      ["select", state.selecting ? "Done selecting" : "Select", state.selecting],
    ].filter(Boolean).map(function (p) {
      return '<button class="pill' + (p[2] ? " on" : "") + '" data-pill="' + p[0] + '">' + esc(p[1]) + "</button>";
    }).join("");
    var el = document.getElementById("filters");
    el.innerHTML = html;
    el.onclick = function (e) {
      var b = e.target.closest("[data-pill]"); if (!b) return;
      var k = b.getAttribute("data-pill");
      if (k === "select") { state.selecting = !state.selecting; renderFilters(); renderList(); renderTray(); return; }
      openFilter(k);
    };
  }

  function paintUpdated() {
    var el = document.getElementById("updated");
    if (!el) return;
    if (state.loading) { el.textContent = "Updating"; return; }
    var a = age();
    if (a === Infinity) { el.textContent = ""; return; }
    var m = Math.floor(a / 60000);
    el.textContent = m < 1 ? "Updated just now" : m < 60 ? "Updated " + m + " min ago" : "Updated " + Math.floor(m / 60) + " h ago";
  }
  function renderSummary() {
    var list = visible();
    var listed = list.filter(function (w) { return !isSold(w) && w.eur; });
    var total = listed.reduce(function (s, w) { return s + w.eur; }, 0);
    var el = document.getElementById("summary");
    el.innerHTML =
      "<div><strong>" + list.length + "</strong>" + (list.length === 1 ? "work" : "works") +
      (total ? '<div>' + esc(fmt(total)) + " at list price</div>" : "") + '<div class="updated" id="updated"></div>' + "</div>" +
      '<div class="view-switch" role="group" aria-label="View">' +
      '<button data-view="grid" aria-pressed="' + (state.view === "grid") + '">Grid</button>' +
      '<button data-view="scale" aria-pressed="' + (state.view === "scale") + '">To scale</button>' +
      "</div>";
    paintUpdated();
    el.onclick = function (e) {
      var b = e.target.closest("[data-view]"); if (!b) return;
      state.view = b.getAttribute("data-view"); savePrefs(); renderSummary(); renderList();
    };
  }

  function card(w) {
    var img = w.img[0] || w.details[0];
    var picked = state.selected.indexOf(w.id) >= 0;
    var sticker = isSold(w) ? '<span class="sticker sold" title="Sold"></span>' : isHeld(w) ? '<span class="sticker hold" title="' + esc(w.status) + '"></span>' : "";
    var price = isSold(w) ? (w.owner ? esc(w.owner) : "Sold") : w.eur ? esc(fmt(w.eur)) : "";
    return '<button class="card' + (picked ? " picked" : "") + '" data-id="' + w.id + '">' +
      '<div class="frame">' + (img ? '<img loading="lazy" decoding="async" alt="" src="' + esc(img.s) + '">' : '<span class="none">No image</span>') + "</div>" +
      sticker +
      (state.selecting ? '<span class="pick" aria-hidden="true">' + I.check + "</span>" : "") +
      '<div class="meta">' +
      '<span class="artist">' + esc(w.artist || "Unknown artist") + "</span>" +
      '<span class="title">' + esc(w.title) + "</span>" +
      '<span class="row"><span>' + esc([yr(w), cardSize(w)].filter(Boolean).join(", ")) + '</span><span class="price">' + price + "</span></span>" +
      "</div></button>";
  }

  function renderList() {
    var el = document.getElementById("list");
    var list = visible();
    if (!state.works.length && state.loading) { el.innerHTML = '<div class="empty">Loading the inventory</div>'; return; }
    if (!list.length) {
      el.innerHTML = '<div class="empty"><p>No works match these filters.</p><button class="text-btn" id="reset">Clear all filters</button></div>';
      document.getElementById("reset").onclick = resetFilters;
      return;
    }
    if (state.view === "scale") { renderScale(el, list); return; }
    el.innerHTML = '<div class="grid">' + list.map(card).join("") + "</div>";
    el.onclick = onCardClick;
  }

  function onCardClick(e) {
    var c = e.target.closest("[data-id]"); if (!c) return;
    var id = c.getAttribute("data-id");
    if (state.selecting) { toggleSelect(id); return; }
    openDetail(id);
  }

  function toggleSelect(id) {
    var i = state.selected.indexOf(id);
    if (i >= 0) state.selected.splice(i, 1); else state.selected.push(id);
    document.querySelectorAll('.card[data-id="' + id + '"]').forEach(function (c) { c.classList.toggle("picked", i < 0); });
    renderTray();
  }

  // ---------- to scale ----------
  function renderScale(el, list) {
    var sized = list.filter(function (w) { return outer(w); });
    var missing = list.length - sized.length;
    var fit = Math.max(0.4, Math.min(3, (window.innerWidth - 60) / 260));
    var k = state.scale || Math.round(fit * 10) / 10;
    var html = '<div class="scale-wrap">' +
      '<div class="scale-tools"><label for="zoom">Zoom</label><input id="zoom" type="range" min="0.3" max="5" step="0.1" value="' + k + '"></div>' +
      '<div class="scale">' +
      '<div class="ruler" aria-hidden="true"><span class="metre" style="height:' + 100 * k + 'px"></span><span class="cap">1 m<br>&nbsp;</span></div>' +
      sized.map(function (w) {
        var img = w.img[0], o = outer(w);
        return '<button class="piece" data-id="' + w.id + '">' +
          '<span class="box" style="width:' + (o.w * k).toFixed(1) + "px;height:" + (o.h * k).toFixed(1) + 'px">' +
          (img ? '<img loading="lazy" alt="" src="' + esc(img.s) + '">' : "") + "</span>" +
          '<span class="cap"><i>' + esc(w.title) + "</i><br>" + esc(o.h + " x " + o.w + " cm" + (o.framed ? " (framed)" : "")) + "</span></button>";
      }).join("") +
      "</div>" +
      (missing ? '<p class="scale-note">' + missing + " " + (missing === 1 ? "work has" : "works have") + " no fixed dimensions in Airtable and " + (missing === 1 ? "is" : "are") + " not shown.</p>" : "") + "</div>";
    el.innerHTML = html;
    el.onclick = onCardClick;
    document.getElementById("zoom").oninput = function (e) {
      state.scale = parseFloat(e.target.value); savePrefs();
      var sc = state.scale;
      el.querySelectorAll(".piece").forEach(function (p) {
        var w = byId(p.getAttribute("data-id"));
        var box = p.querySelector(".box"), o = outer(w);
        box.style.width = (o.w * sc).toFixed(1) + "px"; box.style.height = (o.h * sc).toFixed(1) + "px";
      });
      el.querySelector(".ruler .metre").style.height = 100 * sc + "px";
    };
  }

  // ---------- filter sheets ----------
  function sheet(inner, onReady) {
    var slot = document.getElementById("sheet-slot");
    slot.innerHTML = '<div class="veil" data-close></div><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>' + inner + "</div>";
    slot.querySelector(".veil").onclick = closeSheet;
    if (onReady) onReady(slot.querySelector(".sheet"));
    var first = slot.querySelector(".sheet button, .sheet input");
    if (first && window.matchMedia("(min-width: 720px)").matches) first.focus();
  }
  function closeSheet() { var s = document.getElementById("sheet-slot"); if (s) s.innerHTML = ""; }

  function openFilter(k) {
    var f = state.f;
    if (k === "artist" || k === "status" || k === "location" || k === "medium") {
      var key = k;
      var c = counts(key, key);
      var names = Object.keys(c);
      if (key === "status") names.sort(function (a, b) { return rank(STATUSES, a) - rank(STATUSES, b); });
      else if (key === "location") names.sort(function (a, b) { return rank(LOCATIONS, a) - rank(LOCATIONS, b); });
      else names.sort(function (a, b) { return a.localeCompare(b); });
      f[key].forEach(function (v) { if (names.indexOf(v) < 0) names.unshift(v); });
      var title = { artist: "Artist", status: "Status", location: "Location", medium: "Medium" }[key];
      sheet(
        "<h2>" + title + "</h2>" +
        names.map(function (n) {
          return '<button class="opt" data-v="' + esc(n) + '" aria-pressed="' + (f[key].indexOf(n) >= 0) + '"><span>' + esc(n) + '</span><span class="n">' + (c[n] || 0) + "</span></button>";
        }).join("") +
        (key === "artist" ? '<button class="opt" data-archived aria-pressed="' + f.archived + '"><span>Include artists I no longer work with</span><span class="n">' + (f.archived ? "On" : "Off") + "</span></button>" : "") +
        '<div class="actions"><button class="btn" data-clear>Clear</button><button class="btn primary" data-done>Show results</button></div>',
        function (s) {
          s.onclick = function (e) {
            var o = e.target.closest(".opt");
            if (o && o.hasAttribute("data-archived")) { f.archived = !f.archived; o.setAttribute("aria-pressed", f.archived); o.querySelector(".n").textContent = f.archived ? "On" : "Off"; apply(); return; }
            if (o) {
              var v = o.getAttribute("data-v"); var arr = f[key]; var i = arr.indexOf(v);
              if (i >= 0) arr.splice(i, 1); else arr.push(v);
              o.setAttribute("aria-pressed", i < 0); apply(); return;
            }
            if (e.target.closest("[data-clear]")) { f[key] = []; s.querySelectorAll(".opt:not([data-archived])").forEach(function (b) { b.setAttribute("aria-pressed", "false"); }); apply(); return; }
            if (e.target.closest("[data-done]")) closeSheet();
          };
        }
      );
      return;
    }
    if (k === "price" || k === "size") {
      var isPrice = k === "price";
      sheet(
        "<h2>" + (isPrice ? "Price in euros" : "Size") + "</h2>" +
        (isPrice
          ? '<div class="two"><div class="field"><label for="pmin">From</label><input id="pmin" inputmode="numeric" placeholder="0" value="' + (f.priceMin != null ? f.priceMin : "") + '"></div>' +
            '<div class="field"><label for="pmax">Up to</label><input id="pmax" inputmode="numeric" placeholder="Any" value="' + (f.priceMax != null ? f.priceMax : "") + '"></div></div>'
          : '<div class="field"><label for="smax">Longest side up to (cm)</label><input id="smax" inputmode="numeric" placeholder="Any" value="' + (f.sizeMax != null ? f.sizeMax : "") + '"></div>') +
        '<div class="actions"><button class="btn" data-clear>Clear</button><button class="btn primary" data-done>Show results</button></div>',
        function (s) {
          function num(id) { var v = (document.getElementById(id).value || "").replace(/[^\d]/g, ""); return v ? parseInt(v, 10) : null; }
          s.onclick = function (e) {
            if (e.target.closest("[data-clear]")) {
              if (isPrice) { f.priceMin = null; f.priceMax = null; } else f.sizeMax = null;
              apply(); closeSheet(); return;
            }
            if (e.target.closest("[data-done]")) {
              if (isPrice) { f.priceMin = num("pmin"); f.priceMax = num("pmax"); } else f.sizeMax = num("smax");
              apply(); closeSheet();
            }
          };
        }
      );
      return;
    }
    if (k === "sort") {
      sheet("<h2>Sort by</h2>" + SORTS.map(function (s) {
        return '<button class="opt" data-sort="' + s[0] + '" aria-pressed="' + (state.sort === s[0]) + '"><span>' + s[1] + "</span></button>";
      }).join(""), function (s) {
        s.onclick = function (e) {
          var o = e.target.closest("[data-sort]"); if (!o) return;
          state.sort = o.getAttribute("data-sort"); apply(); closeSheet();
        };
      });
    }
  }
  function apply() { savePrefs(); renderFilters(); renderBody(); }
  function resetFilters() {
    state.f = { artist: [], status: [], location: [], medium: [], priceMin: null, priceMax: null, sizeMax: null, archived: false };
    state.q = ""; var q = document.getElementById("q"); if (q) q.value = "";
    apply();
  }

  // ---------- selection tray ----------
  function renderTray() {
    var slot = document.getElementById("tray-slot");
    if (!slot) return;
    var n = state.selected.length;
    if (!n) { slot.innerHTML = ""; return; }
    slot.innerHTML =
      '<div class="tray" role="region" aria-label="Selection">' +
      '<span class="count">' + n + (n === 1 ? " work selected" : " works selected") + "</span>" +
      '<button data-a="clear">Clear</button>' +
      '<button data-a="copy">Copy list</button>' +
      '<button data-a="print">Tearsheet</button>' +
      '<button class="primary" data-a="room">Viewing room</button>' +
      "</div>";
    slot.firstChild.onclick = function (e) {
      var b = e.target.closest("[data-a]"); if (!b) return;
      var a = b.getAttribute("data-a");
      var works = state.selected.map(byId).filter(Boolean);
      if (a === "clear") { state.selected = []; renderList(); renderTray(); }
      if (a === "copy") {
        var text = works.map(caption).join("\n\n");
        copy(text).then(function (ok) { if (ok) toast("List copied"); else share("Works", text); });
      }
      if (a === "print") printSheet(works);
      if (a === "room") roomSheet(works);
    };
  }

  // ---------- contact picker (diez-mail People) ----------
  // Renders a search box into `box`. Calls onPick({ personId, name, email })
  // for an existing contact or onPick({ newPerson: {...}, name, email }).
  function contactPicker(box, onPick) {
    box.innerHTML =
      '<div class="field"><label for="who">Send to</label><input id="who" autocomplete="off" placeholder="Search a contact by name or email"></div>' +
      '<div class="people" id="people"></div>';
    var input = box.querySelector("#who");
    var list = box.querySelector("#people");
    var t, seq = 0;
    function newForm(prefill) {
      var looksEmail = prefill.indexOf("@") > 0;
      var parts = looksEmail ? ["", ""] : prefill.split(" ");
      list.innerHTML =
        '<div class="two"><div class="field"><label for="nf">First name</label><input id="nf" value="' + esc(parts[0] || "") + '"></div>' +
        '<div class="field"><label for="nl">Last name</label><input id="nl" value="' + esc(parts.slice(1).join(" ")) + '"></div></div>' +
        '<div class="field"><label for="ne">Email</label><input id="ne" type="email" inputmode="email" value="' + esc(looksEmail ? prefill : "") + '"></div>' +
        '<div class="actions"><button class="btn primary" data-newok>Use this contact</button></div>' +
        '<p class="group-label">It is added to diez-mail. If the email already exists there, that contact is used.</p>';
      list.querySelector("[data-newok]").onclick = function () {
        var n = { first: box.querySelector("#nf").value.trim(), last: box.querySelector("#nl").value.trim(), email: box.querySelector("#ne").value.trim() };
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(n.email)) { toast("Add a valid email"); box.querySelector("#ne").focus(); return; }
        onPick({ newPerson: n, name: (n.first + " " + n.last).trim() || n.email, email: n.email });
      };
    }
    input.addEventListener("input", function () {
      clearTimeout(t);
      var q = input.value.trim();
      if (q.length < 2) { list.innerHTML = ""; return; }
      t = setTimeout(function () {
        var mine = ++seq;
        api("/api/stock/people?q=" + encodeURIComponent(q)).then(function (r) {
          if (mine !== seq) return;
          list.innerHTML = r.people.map(function (p) {
            return '<button class="opt person" data-pid="' + p.id + '" data-name="' + esc(p.name || p.email) + '" data-email="' + esc(p.email) + '"' + (p.email ? "" : " disabled") + ">" +
              "<span>" + esc(p.name || p.email) + '<small>' + esc([p.email || "No email", p.company].filter(Boolean).join(", ")) + "</small></span>" +
              '<span class="n">' + esc(p.type) + "</span></button>";
          }).join("") +
            '<button class="opt" data-new><span>Add "' + esc(q) + '" as a new contact</span></button>';
          list.querySelector("[data-new]").onclick = function () { newForm(q); };
          list.querySelectorAll("[data-pid]").forEach(function (b) {
            b.onclick = function () { onPick({ personId: b.getAttribute("data-pid"), name: b.getAttribute("data-name"), email: b.getAttribute("data-email") }); };
          });
        }).catch(function (err) {
          if (mine === seq) list.innerHTML = '<p class="group-label">' + esc(err.message) + "</p>";
        });
      }, 250);
    });
    setTimeout(function () { input.focus(); }, 50);
  }

  function trackedLink(roomUrl, label, who) {
    var body = { url: roomUrl, label: label };
    if (who.personId) body.personId = who.personId; else body.newPerson = who.newPerson;
    return api("/api/stock/link", { method: "POST", body: JSON.stringify(body) });
  }

  function linkRow(title, url, sub, shareTitle) {
    var row = document.createElement("div");
    row.className = "link-row";
    row.innerHTML =
      '<p class="link-who">' + esc(title) + "</p>" +
      '<p class="link-out"><a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(url) + "</a></p>" +
      (sub ? '<p class="group-label">' + esc(sub) + "</p>" : "") +
      '<div class="actions"><button class="btn" data-copy>Copy link</button><button class="btn primary" data-share>Share</button></div>';
    row.querySelector("[data-copy]").onclick = function () { copy(url).then(function (ok) { toast(ok ? "Link copied" : "Could not copy"); }); };
    row.querySelector("[data-share]").onclick = function () { share(shareTitle, shareTitle, url); };
    return row;
  }

  // "Tracked link for another contact": one more picker per click, each
  // producing its own link row, so one room can go to several people.
  function addAnother(container, roomUrl, roomName) {
    var btn = document.createElement("button");
    btn.className = "text-btn small";
    btn.textContent = "Tracked link for another contact";
    container.appendChild(btn);
    btn.onclick = function () {
      var box = document.createElement("div");
      container.replaceChild(box, btn);
      contactPicker(box, function (p) {
        box.innerHTML = '<p class="group-label">Creating the link for ' + esc(p.name) + "</p>";
        trackedLink(roomUrl, roomName, p).then(function (l) {
          container.replaceChild(linkRow("Tracked link for " + l.name, l.url, "", roomName), box);
          addAnother(container, roomUrl, roomName);
        }).catch(function (err) {
          box.remove(); toast(err.message);
          addAnother(container, roomUrl, roomName);
        });
      });
    };
  }

  function roomSheet(works, presetName) {
    var artists = [];
    works.forEach(function (w) { if (w.artist && artists.indexOf(w.artist) < 0) artists.push(w.artist); });
    var suggestion = presetName || (artists.length === 1 ? artists[0] : "");
    var who = null;
    sheet(
      "<h2>New private viewing room</h2>" +
      '<div class="field"><label for="rname">Name</label><input id="rname" maxlength="120" placeholder="' + esc(suggestion || "e.g. Selection for a collector") + '" value="' + esc(suggestion) + '"></div>' +
      '<div class="field"><label for="rdays">Link works for</label><select id="rdays"><option value="7">1 week</option><option value="14">2 weeks</option><option value="30" selected>30 days</option><option value="90">90 days</option></select></div>' +
      '<div id="who-box"></div>' +
      '<p class="group-label" id="room-hint">' + works.length + (works.length === 1 ? " work" : " works") + ". Pick who it is for and the link is tracked: you see when they open it, which works they look at and for how long.</p>" +
      '<div class="actions" id="room-actions"><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-create>Create room</button></div>' +
      '<div id="room-result"></div>',
      function (s) {
        var whoBox = s.querySelector("#who-box");
        function pickWho() {
          contactPicker(whoBox, function (p) {
            who = p;
            whoBox.innerHTML = '<div class="chosen"><span>For <strong>' + esc(p.name) + "</strong><small>" + esc(p.email) + (p.newPerson ? ", new contact" : "") + '</small></span><button class="text-btn small" data-change>Change</button></div>';
            whoBox.querySelector("[data-change]").onclick = function () { who = null; pickWho(); };
          });
          var skip = document.createElement("button");
          skip.className = "text-btn small"; skip.textContent = "No contact, make an anonymous link";
          skip.onclick = function () { who = null; whoBox.innerHTML = '<div class="chosen"><span>Anonymous link, not tracked</span><button class="text-btn small" data-change>Add a contact</button></div>'; whoBox.querySelector("[data-change]").onclick = pickWho; };
          whoBox.appendChild(skip);
        }
        pickWho();

        s.onclick = function (e) {
          if (e.target.closest("[data-cancel]")) { closeSheet(); return; }
          var cr = e.target.closest("[data-create]");
          if (!cr) return;
          var name = document.getElementById("rname").value.trim();
          if (!name) { document.getElementById("rname").focus(); toast("Give the room a name"); return; }
          cr.disabled = true; cr.textContent = "Creating";
          var artistIds = [];
          works.forEach(function (w) { (w.artistIds || []).forEach(function (id) { if (artistIds.indexOf(id) < 0) artistIds.push(id); }); });
          var room;
          api("/api/stock/room", { method: "POST", body: JSON.stringify({ name: name, ids: works.map(function (w) { return w.id; }), artistIds: artistIds, days: document.getElementById("rdays").value }) })
            .then(function (r) {
              room = r;
              return who ? trackedLink(r.url, name, who).catch(function (err) { return { error: err }; }) : null;
            })
            .then(function (link) {
              s.querySelector("#room-actions").remove();
              s.querySelector("#room-hint").remove();
              whoBox.remove();
              var out = document.getElementById("room-result");
              out.innerHTML = '<p class="group-label">Room open until ' + esc(room.expires) + ".</p>";
              if (link && !link.error) {
                out.appendChild(linkRow("Tracked link for " + link.name, link.url, "Send this one. Opens, works viewed and time spent go to " + link.name + " in diez-mail.", name));
              } else if (link && link.error) {
                toast("Room created, but the tracked link failed: " + link.error.message);
              }
              out.appendChild(linkRow(link && !link.error ? "Anonymous link" : "Link", room.url, link && !link.error ? "Not tracked. Use it for yourself or to post publicly." : "", name));
              addAnother(out, room.url, name);
            })
            .catch(function (err) {
              cr.disabled = false; cr.textContent = "Create room";
              if (err.auth) { closeSheet(); renderLogin("Signed out. Sign in again."); return; }
              toast(err.message);
            });
        };
      }
    );
  }

  function printSheet(works) {
    var el = document.getElementById("print");
    var today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    el.innerHTML =
      '<header><img src="/files/logo.png" alt="diez"><div>diez gallery, Gibraltarstraat 74-B, Amsterdam<br>' + esc(today) + "</div></header>" +
      works.map(function (w) {
        var img = w.img[0];
        return '<div class="item">' + (img ? '<img src="' + esc(img.l) + '" alt="">' : "<div></div>") +
          '<div><div class="a">' + esc(w.artist) + '</div><div class="t">' + esc(w.title) + (yr(w) ? '<span style="font-style:normal">, ' + esc(yr(w)) + "</span>" : "") + "</div>" +
          "<div>" + esc(w.technique) + "</div><div>" + esc(dims(w)) + "</div>" + (framed(w) ? "<div>" + esc("Framed: " + framed(w)) + "</div>" : "") + (w.edition ? "<div>" + esc(w.edition) + "</div>" : "") +
          (w.eur && !isSold(w) ? '<div class="p">' + esc(fmt(w.eur)) + " excl. VAT</div>" : "") +
          "</div></div>";
      }).join("") +
      "<footer>Prices subject to availability.</footer>";
    var imgs = el.querySelectorAll("img");
    var left = imgs.length;
    var done = false;
    function go() { if (done) return; done = true; window.print(); }
    if (!left) return go();
    imgs.forEach(function (i) {
      if (i.complete) { if (--left === 0) go(); }
      else i.onload = i.onerror = function () { if (--left === 0) go(); };
    });
    setTimeout(go, 6000);
  }

  // ---------- shows (exhibitions) ----------
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function showDates(x) {
    function d(iso) { var p = iso.split("-"); return { y: +p[0], m: +p[1] - 1, d: +p[2] }; }
    if (!x.start) return "";
    var a = d(x.start);
    if (!x.end) return a.d + " " + MONTHS[a.m] + " " + a.y;
    var b = d(x.end);
    if (a.y === b.y && a.m === b.m) return a.d + " to " + b.d + " " + MONTHS[b.m] + " " + b.y;
    if (a.y === b.y) return a.d + " " + MONTHS[a.m] + " to " + b.d + " " + MONTHS[b.m] + " " + b.y;
    return a.d + " " + MONTHS[a.m] + " " + a.y + " to " + b.d + " " + MONTHS[b.m] + " " + b.y;
  }
  function isOn(x) {
    var today = new Date().toISOString().slice(0, 10);
    if (!x.start || x.start > today) return false;
    if (x.end) return x.end >= today;
    // No end date in Airtable: count it as running only for its first week,
    // otherwise every old show without an end date would say "Now on"
    var weekLater = new Date(new Date(x.start).getTime() + 6 * 86400000).toISOString().slice(0, 10);
    return today <= weekLater;
  }
  function isUpcoming(x) { return x.start && x.start > new Date().toISOString().slice(0, 10); }
  function showWorks(id) {
    var order = { "Available": 0, "On hold": 1, "Consigned": 2, "Not available": 3, "Sold": 4 };
    return state.works
      .filter(function (w) { return (w.exhibitionIds || []).indexOf(id) >= 0; })
      .sort(function (a, b) { return ((order[a.status] != null ? order[a.status] : 5) - (order[b.status] != null ? order[b.status] : 5)) || (a.artist || "").localeCompare(b.artist || ""); });
  }
  function showById(id) { for (var i = 0; i < state.shows.length; i++) if (state.shows[i].id === id) return state.shows[i]; return null; }
  function visibleShows() {
    var terms = norm(state.q).split(/\s+/).filter(Boolean);
    return state.shows.filter(function (x) {
      if (!terms.length) return true;
      var hay = norm([x.name, x.venue, x.city, x.country, x.artists.join(" "), (x.start || "").slice(0, 4)].join(" "));
      return terms.every(function (t) { return hay.indexOf(t) >= 0; });
    }).sort(function (a, b) {
      // Running now first, then upcoming, then the rest newest first
      var ra = isOn(a) ? 0 : isUpcoming(a) ? 1 : 2, rb = isOn(b) ? 0 : isUpcoming(b) ? 1 : 2;
      return ra - rb || (b.start || "").localeCompare(a.start || "");
    });
  }
  function renderShowsSummary() {
    var n = visibleShows().length;
    document.getElementById("summary").innerHTML = "<div><strong>" + n + "</strong>" + (n === 1 ? "show" : "shows") + '<div class="updated" id="updated"></div></div>';
    paintUpdated();
    document.getElementById("summary").onclick = null;
  }
  function showCover(x, works) {
    if (x.views.length) return x.views[0].s;
    for (var i = 0; i < works.length; i++) if (works[i].img[0]) return works[i].img[0].s;
    return null;
  }
  function renderShows() {
    var el = document.getElementById("list");
    var list = visibleShows();
    if (!list.length) {
      el.innerHTML = '<div class="empty"><p>' + (state.shows.length ? "No shows match your search." : "No exhibitions in Airtable yet.") + "</p></div>";
      return;
    }
    el.innerHTML = '<div class="shows">' + list.map(function (x) {
      var works = showWorks(x.id);
      var avail = works.filter(function (w) { return w.status === "Available"; }).length;
      var cover = showCover(x, works);
      var where = [x.venue, x.city].filter(Boolean).join(", ");
      return '<button class="show" data-show="' + x.id + '">' +
        '<div class="frame wide">' + (cover ? '<img loading="lazy" alt="" src="' + esc(cover) + '">' : '<span class="none">No images</span>') + "</div>" +
        '<div class="meta">' +
        (isOn(x) ? '<span class="now">Now on</span>' : isUpcoming(x) ? '<span class="now soon">Upcoming</span>' : "") +
        '<span class="title">' + esc(x.name) + "</span>" +
        (x.artists.length ? '<span class="artist">' + esc(x.artists.join(", ")) + "</span>" : "") +
        '<span class="row"><span>' + esc([where, showDates(x)].filter(Boolean).join(", ")) + "</span></span>" +
        '<span class="row"><span>' + works.length + (works.length === 1 ? " work" : " works") + (avail ? ", " + avail + " available" : "") + "</span></span>" +
        "</div></button>";
    }).join("") + "</div>";
    el.onclick = function (e) {
      var b = e.target.closest("[data-show]"); if (b) openShow(b.getAttribute("data-show"));
    };
  }

  function openShow(id, fromPop) {
    if (!showById(id)) return;
    state.show = id;
    if (!fromPop) history.pushState({ show: id }, "", location.pathname);
    document.body.style.overflow = "hidden";
    paintShow();
    var el = document.querySelector(".show-page");
    if (el && !fromPop) el.scrollTop = 0;
  }
  function closeShow() {
    state.show = null;
    var slot = document.getElementById("show-slot");
    if (slot) slot.innerHTML = "";
    if (!state.detail) document.body.style.overflow = "";
  }
  // Also called after a refresh or a status change, so counts stay right
  function paintShow() {
    var x = showById(state.show);
    var slot = document.getElementById("show-slot");
    if (!x || !slot) return;
    var prev = slot.querySelector(".show-page");
    var keepScroll = prev ? prev.scrollTop : 0;
    var works = showWorks(x.id);
    var avail = works.filter(function (w) { return w.status === "Available"; });
    var sold = works.filter(isSold);
    var value = avail.reduce(function (t, w) { return t + (w.eur || 0); }, 0);
    var where = [x.venue, x.city, x.country].filter(Boolean).join(", ");
    slot.innerHTML =
      '<article class="detail show-page" role="dialog" aria-modal="true" aria-label="' + esc(x.name) + '">' +
      '<div class="top"><button class="icon-btn" data-back aria-label="Back to shows">' + I.back + '</button><span class="code">Exhibition</span><span class="icon-btn" aria-hidden="true"></span></div>' +
      (x.views.length
        ? '<div class="gallery short">' + x.views.map(function (p, i) { return '<img alt="" loading="lazy" data-zoom="' + i + '" src="' + esc(p.l) + '">'; }).join("") + "</div>" +
          (x.views.length > 1 ? '<p class="gallery-count">' + x.views.length + " installation views, swipe</p>" : "")
        : "") +
      '<div class="info show-info">' +
      "<div>" + (x.artists.length ? '<p class="artist">' + esc(x.artists.join(", ")) + "</p>" : "") +
      "<h1>" + esc(x.name) + "</h1>" +
      '<p class="artist">' + esc([where, showDates(x)].filter(Boolean).join(", ")) + "</p></div>" +
      '<dl class="facts">' +
      '<div class="fact"><dt>Works</dt><dd>' + works.length + "</dd></div>" +
      '<div class="fact"><dt>Available</dt><dd>' + avail.length + (value ? ", " + esc(fmt(value)) + " at list price" : "") + "</dd></div>" +
      (sold.length ? '<div class="fact"><dt>Sold</dt><dd>' + sold.length + "</dd></div>" : "") +
      "</dl>" +
      (x.text ? '<div class="press"><p class="press-text" id="press">' + esc(x.text) + '</p><button class="text-btn small" data-more>Read more</button></div>' : "") +
      '<div class="foot">' +
      (avail.length ? '<button class="btn primary" data-room>Viewing room with the available works</button><button class="btn" data-pickall>Select available</button>' : "") +
      (works.length ? '<button class="btn" data-selmode>' + (state.selecting ? "Done selecting" : "Select works") + "</button>" : "") +
      "</div>" +
      "</div>" +
      (works.length
        ? '<div class="grid">' + works.map(card).join("") + "</div>"
        : '<p class="empty">No works linked to this show in Airtable.</p>') +
      "</article>";
    var page = slot.querySelector(".show-page");
    page.scrollTop = keepScroll;
    var press = slot.querySelector("#press");
    if (press && press.scrollHeight <= press.clientHeight + 2) slot.querySelector("[data-more]").remove();
    page.onclick = function (e) {
      if (e.target.closest("[data-back]")) { history.back(); return; }
      var z = e.target.closest("img[data-zoom]");
      if (z) {
        openLightbox(x.views.map(function (p) { return { src: p.l, caption: "Installation view, " + x.name }; }), +z.getAttribute("data-zoom"));
        return;
      }
      if (e.target.closest("[data-more]")) { press.classList.add("open"); e.target.closest("[data-more]").remove(); return; }
      if (e.target.closest("[data-room]")) { roomSheet(avail, x.name); return; }
      if (e.target.closest("[data-selmode]")) {
        state.selecting = !state.selecting; renderFilters(); renderList(); paintShow(); renderTray();
        return;
      }
      if (e.target.closest("[data-pickall]")) {
        avail.forEach(function (w) { if (state.selected.indexOf(w.id) < 0) state.selected.push(w.id); });
        state.selecting = true; renderFilters(); renderList(); renderTray(); paintShow();
        toast(avail.length + " works selected");
        return;
      }
      var c = e.target.closest(".card[data-id]");
      if (c) { if (state.selecting) toggleSelect(c.getAttribute("data-id")); else openDetail(c.getAttribute("data-id")); }
    };
  }

  // ---------- lightbox: full screen, swipe, pinch / double tap / wheel zoom ----------
  // All gestures are handled here (touch-action: none), so swiping between
  // images and zooming into one never fight each other or zoom the page.
  var lb = null;

  function openLightbox(items, index) {
    if (!items.length) return;
    closeLightbox();
    var root = document.createElement("div");
    root.className = "lb";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Image viewer");
    root.innerHTML =
      '<div class="lb-top"><span class="lb-count" aria-live="polite"></span>' +
      '<button class="icon-btn lb-close" aria-label="Close">' + I.close + "</button></div>" +
      '<div class="lb-stage"><div class="lb-track">' +
      items.map(function (it) { return '<div class="lb-slide"><img alt="" draggable="false" src="' + esc(it.src) + '"></div>'; }).join("") +
      "</div>" +
      (items.length > 1 ? '<button class="lb-arrow prev" aria-label="Previous image">' + I.back + '</button><button class="lb-arrow next" aria-label="Next image">' + I.back + "</button>" : "") +
      "</div>" +
      '<p class="lb-caption"></p>';
    document.body.appendChild(root);
    lb = { root: root, items: items, i: Math.max(0, Math.min(index || 0, items.length - 1)), scale: 1, x: 0, y: 0, dragX: 0 };
    history.pushState(Object.assign({}, history.state || {}, { lb: true }), "", location.pathname);
    bindLightbox();
    lbShow(false);
  }

  function closeLightbox() {
    if (!lb) return;
    lb.root.remove();
    document.removeEventListener("keydown", lbKeys, true);
    lb = null;
  }

  function lbImg() { return lb.root.querySelectorAll(".lb-slide img")[lb.i]; }

  function lbShow(animate) {
    var track = lb.root.querySelector(".lb-track");
    track.style.transition = animate ? "transform .25s ease-out" : "none";
    track.style.transform = "translateX(" + (-lb.i * 100) + "%) translateX(" + lb.dragX + "px)";
    lb.root.querySelector(".lb-count").textContent = lb.items.length > 1 ? (lb.i + 1) + " / " + lb.items.length : "";
    lb.root.querySelector(".lb-caption").textContent = lb.items[lb.i].caption || "";
    var prev = lb.root.querySelector(".lb-arrow.prev"), next = lb.root.querySelector(".lb-arrow.next");
    if (prev) { prev.disabled = lb.i === 0; next.disabled = lb.i === lb.items.length - 1; }
  }

  function lbApplyZoom(animate) {
    var img = lbImg();
    img.style.transition = animate ? "transform .2s ease-out" : "none";
    img.style.transform = "translate(" + lb.x + "px," + lb.y + "px) scale(" + lb.scale + ")";
    lb.root.classList.toggle("zoomed", lb.scale > 1.01);
  }

  // Keep the zoomed image inside the screen
  function lbClamp() {
    var img = lbImg(), stage = lb.root.querySelector(".lb-stage");
    var w = img.clientWidth * lb.scale, h = img.clientHeight * lb.scale;
    var maxX = Math.max(0, (w - stage.clientWidth) / 2), maxY = Math.max(0, (h - stage.clientHeight) / 2);
    lb.x = Math.max(-maxX, Math.min(maxX, lb.x));
    lb.y = Math.max(-maxY, Math.min(maxY, lb.y));
  }

  // Zoom keeping the point under (cx, cy) in place
  function lbZoomAt(newScale, cx, cy) {
    newScale = Math.max(1, Math.min(5, newScale));
    var stage = lb.root.querySelector(".lb-stage").getBoundingClientRect();
    var ox = cx - (stage.left + stage.width / 2), oy = cy - (stage.top + stage.height / 2);
    var k = newScale / lb.scale;
    lb.x = ox - (ox - lb.x) * k;
    lb.y = oy - (oy - lb.y) * k;
    lb.scale = newScale;
    if (lb.scale === 1) { lb.x = 0; lb.y = 0; }
    lbClamp();
  }

  function lbGo(d) {
    var n = lb.i + d;
    if (n < 0 || n >= lb.items.length) { lb.dragX = 0; lbShow(true); return; }
    lb.scale = 1; lb.x = 0; lb.y = 0; lbApplyZoom(false);
    lb.i = n; lb.dragX = 0; lbShow(true);
  }

  function lbKeys(e) {
    if (!lb) return;
    if (e.key === "Escape") { e.stopPropagation(); history.back(); }
    if (e.key === "ArrowRight") lbGo(1);
    if (e.key === "ArrowLeft") lbGo(-1);
  }

  function bindLightbox() {
    var root = lb.root, stage = root.querySelector(".lb-stage");
    var pts = {}, start = null, lastTap = 0, moved = false;

    root.querySelector(".lb-close").onclick = function () { history.back(); };
    var prev = root.querySelector(".lb-arrow.prev");
    if (prev) {
      prev.onclick = function () { lbGo(-1); };
      root.querySelector(".lb-arrow.next").onclick = function () { lbGo(1); };
    }
    document.addEventListener("keydown", lbKeys, true);

    function list() { return Object.keys(pts).map(function (k) { return pts[k]; }); }
    function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

    stage.addEventListener("pointerdown", function (e) {
      if (e.target.closest(".lb-arrow")) return;
      stage.setPointerCapture(e.pointerId);
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var p = list();
      moved = false;
      if (p.length === 1) start = { x: e.clientX, y: e.clientY, lx: lb.x, ly: lb.y, t: Date.now() };
      if (p.length === 2) start = { pinch: dist(p[0], p[1]), scale: lb.scale, cx: (p[0].x + p[1].x) / 2, cy: (p[0].y + p[1].y) / 2 };
    });

    stage.addEventListener("pointermove", function (e) {
      if (!pts[e.pointerId] || !start) return;
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var p = list();
      if (p.length === 2 && start.pinch) {
        moved = true;
        lbZoomAt(start.scale * dist(p[0], p[1]) / start.pinch, start.cx, start.cy);
        lbApplyZoom(false);
        return;
      }
      if (p.length !== 1 || start.pinch) return;
      var dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
      if (lb.scale > 1.01) {
        lb.x = start.lx + dx; lb.y = start.ly + dy; lbClamp(); lbApplyZoom(false);
      } else if (lb.items.length > 1) {
        lb.dragX = dx; lbShow(false);
      }
    });

    function end(e) {
      if (!pts[e.pointerId]) return;
      delete pts[e.pointerId];
      var left = list();
      if (left.length === 1) {
        // From pinch back to one finger: continue as a pan from here
        start = { x: left[0].x, y: left[0].y, lx: lb.x, ly: lb.y, t: Date.now() };
        return;
      }
      if (left.length) return;
      if (start && !start.pinch && lb.scale <= 1.01 && lb.dragX) {
        var fast = Math.abs(lb.dragX) / Math.max(1, Date.now() - start.t) > 0.5;
        var far = Math.abs(lb.dragX) > stage.clientWidth * 0.2;
        if (fast || far) lbGo(lb.dragX < 0 ? 1 : -1); else { lb.dragX = 0; lbShow(true); }
      }
      if (!moved && e.type === "pointerup") {
        var now = Date.now();
        if (now - lastTap < 300) {
          // Double tap: zoom in where tapped, or back out
          if (lb.scale > 1.01) { lb.scale = 1; lb.x = 0; lb.y = 0; } else lbZoomAt(2.5, e.clientX, e.clientY);
          lbApplyZoom(true);
          lastTap = 0;
        } else lastTap = now;
      }
      start = null;
    }
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);

    // Trackpad pinch and mouse wheel on a computer
    stage.addEventListener("wheel", function (e) {
      e.preventDefault();
      var factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
      lbZoomAt(lb.scale * factor, e.clientX, e.clientY);
      lbApplyZoom(false);
    }, { passive: false });
  }

  // ---------- detail ----------
  function openDetail(id, fromPop) {
    var w = byId(id); if (!w) return;
    state.detail = id;
    // History entry so the phone's back gesture closes the work, but the URL
    // itself never changes: a home-screen shortcut saved while a work was
    // open would otherwise reopen that work on every launch.
    if (!fromPop) history.pushState({ work: id }, "", location.pathname);
    var pics = w.img.concat(w.details, w.install);
    prepareImage(w);
    var picked = state.selected.indexOf(id) >= 0;
    var facts = [
      ["Medium", w.technique],
      ["Size", dims(w, "\n")],
      ["Framed", framed(w, "\n")],
      ["Edition", w.edition],
      ["Code", w.code],
      ["Collector", w.owner],
      ["Sold for", [fmt(w.soldEur, "EUR"), fmt(w.soldUsd, "USD"), fmt(w.soldGbp, "GBP")].filter(Boolean).join(", ")],
      ["Paid to artist", isSold(w) ? w.paidArtist || "Not recorded" : ""],
    ].filter(function (r) { return r[1]; });
    var other = [fmt(w.usd, "USD"), fmt(w.gbp, "GBP")].filter(Boolean).join(", ");
    var statusNow = w.status || "";
    var slot = document.getElementById("detail-slot");
    slot.innerHTML =
      '<article class="detail" role="dialog" aria-modal="true" aria-label="' + esc(w.title) + '">' +
      '<div class="top"><button class="icon-btn" data-close aria-label="Back to the list">' + I.back + '</button><span class="code">' + esc(w.code) + '</span><span class="icon-btn" aria-hidden="true"></span></div>' +
      '<div class="detail-body"><div>' +
      (pics.length
        ? '<div class="gallery" id="gal">' + pics.map(function (p, i) { return '<img alt="" data-zoom="' + i + '" src="' + esc(p.l) + '" loading="lazy">'; }).join("") + "</div>" +
          (pics.length > 1 ? '<p class="gallery-count" id="galc">1 of ' + pics.length + ", swipe for details and installation views</p>" : "")
        : '<div class="gallery"><p class="empty">No image in Airtable yet</p></div>') +
      "</div>" +
      '<div class="info">' +
      '<div><p class="artist">' + esc(w.artist) + '</p><h1>' + esc(w.title) + (yr(w) ? '<span class="year">, ' + esc(yr(w)) + "</span>" : "") + "</h1></div>" +
      (w.eur ? '<p class="bigprice">' + esc(fmt(w.eur)) + (other ? "<small>" + esc(other) + "</small>" : "") + "</p>" : "") +
      '<dl class="facts">' + facts.map(function (r) { return '<div class="fact"><dt>' + r[0] + "</dt><dd>" + esc(r[1]) + "</dd></div>"; }).join("") +
      (function () {
        // Linked shows open their page; old tag-only names stay plain text
        var linked = (w.exhibitionIds || []).map(showById).filter(Boolean);
        var items = linked.length
          ? linked.map(function (x) { return '<button class="show-link" data-goshow="' + x.id + '">' + esc(x.name) + "</button>"; }).join("")
          : w.exhibitions.map(esc).join("<br>");
        return items ? '<div class="fact"><dt>Shown in</dt><dd>' + items + "</dd></div>" : "";
      })() +
      "</dl>" +
      '<div><p class="group-label">Status</p><div class="segment" id="seg-status">' +
      STATUSES.map(function (s) { return '<button data-status="' + s + '" aria-pressed="' + (statusNow === s) + '">' + s + "</button>"; }).join("") +
      "</div></div>" +
      (state.hasLocation ? '<div class="field"><label for="loc">Where it is</label><select id="loc"><option value="">Unknown</option>' +
      LOCATIONS.map(function (l) { return "<option" + (w.location === l ? " selected" : "") + ">" + esc(l) + "</option>"; }).join("") +
      "</select></div>" : "") +
      '<div class="notes" id="notes"></div>' +
      (w.docs.length ? '<div class="docs"><p class="group-label">Documents</p>' + w.docs.map(function (d) { return '<a href="' + esc(d.url) + '" target="_blank" rel="noopener">' + esc(d.kind + ": " + d.name) + "</a>"; }).join("") + "</div>" : "") +
      '<div class="foot">' +
      '<button class="btn primary" data-pick>' + (picked ? "Remove from selection" : "Add to selection") + "</button>" +
      '<button class="btn" data-send>Send work</button>' +
      '<a class="btn" href="' + AIRTABLE_URL + w.id + '" target="_blank" rel="noopener">Open in Airtable</a>' +
      "</div></div></div></article>";
    document.body.style.overflow = "hidden";
    var d = slot.firstChild;
    var gal = document.getElementById("gal");
    var galc = document.getElementById("galc");
    if (gal && galc) gal.addEventListener("scroll", function () {
      var i = Math.round(gal.scrollLeft / gal.clientWidth) + 1;
      galc.textContent = i + " of " + pics.length;
    }, { passive: true });
    d.onclick = function (e) {
      if (e.target.closest("[data-close]")) { history.back(); return; }
      var zw = e.target.closest("img[data-zoom]");
      if (zw) {
        var nMain = w.img.length, nDet = w.details.length;
        openLightbox(pics.map(function (p, i) {
          var kind = i < nMain ? "" : i < nMain + nDet ? "Detail, " : "Installation view, ";
          return { src: p.l, caption: kind + (w.artist ? w.artist + ", " : "") + w.title + (yr(w) ? ", " + yr(w) : "") };
        }), +zw.getAttribute("data-zoom"));
        return;
      }
      var gs = e.target.closest("[data-goshow]");
      if (gs) {
        // Replace the work with the show in history, so back returns to the list
        var sid = gs.getAttribute("data-goshow");
        closeDetail();
        history.replaceState({ show: sid }, "", location.pathname);
        state.show = sid; document.body.style.overflow = "hidden"; paintShow();
        var pg = document.querySelector(".show-page"); if (pg) pg.scrollTop = 0;
        return;
      }
      if (e.target.closest("[data-pick]")) {
        toggleSelect(id);
        e.target.closest("[data-pick]").textContent = state.selected.indexOf(id) >= 0 ? "Remove from selection" : "Add to selection";
        return;
      }
      if (e.target.closest("[data-send]")) { sendWork(w); return; }
      var sb = e.target.closest("[data-status]");
      if (sb) {
        var next = sb.getAttribute("data-status");
        if (next === w.status) return;
        if (next === "Sold" && !confirm("Mark this work as sold? Add the collector and sale price in Airtable afterwards.")) return;
        write(w, { status: next }, function () {
          d.querySelectorAll("[data-status]").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-status") === w.status); });
        });
      }
    };
    renderNotes(w);
    var loc = document.getElementById("loc");
    if (loc) loc.onchange = function (e) { write(w, { location: e.target.value }, function () {}); };
  }

  // ---------- notes ----------
  // "Add" puts one dated line on top (dated and merged on the server, so it
  // never overwrites a note written in Airtable meanwhile). "Edit" rewrites
  // the whole field, for corrections.
  function renderNotes(w, editing) {
    var box = document.getElementById("notes");
    if (!box) return;
    if (editing) {
      box.innerHTML =
        '<p class="group-label">Notes</p>' +
        '<textarea id="notes-all" rows="8" aria-label="All notes">' + esc(w.notes) + "</textarea>" +
        '<div class="note-actions"><button class="btn" data-n="cancel">Cancel</button><button class="btn primary" data-n="save">Save notes</button></div>';
      var ta = document.getElementById("notes-all"); ta.focus();
    } else {
      box.innerHTML =
        '<p class="group-label">Notes</p>' +
        '<form class="note-add" id="note-form"><input id="note-new" maxlength="2000" autocomplete="off" enterkeyhint="send" placeholder="Add a note" aria-label="New note">' +
        '<button class="btn primary" type="submit">Add</button></form>' +
        (w.notes ? '<p class="note-text">' + esc(w.notes) + '</p><button class="text-btn small" data-n="edit">Edit notes</button>' : "");
      document.getElementById("note-form").onsubmit = function (e) {
        e.preventDefault();
        var input = document.getElementById("note-new");
        var text = input.value.trim(); if (!text) return;
        var btn = e.target.querySelector("button"); btn.disabled = true; input.disabled = true;
        saveNotes(w, { note: text }, function (ok) { btn.disabled = false; input.disabled = false; if (ok) renderNotes(w); });
      };
    }
    box.onclick = function (e) {
      var b = e.target.closest("[data-n]"); if (!b) return;
      var a = b.getAttribute("data-n");
      if (a === "edit") renderNotes(w, true);
      if (a === "cancel") renderNotes(w);
      if (a === "save") {
        b.disabled = true;
        saveNotes(w, { notes: document.getElementById("notes-all").value }, function (ok) { if (ok) renderNotes(w); else b.disabled = false; });
      }
    };
  }
  function saveNotes(w, change, done) {
    api("/api/stock/update", { method: "POST", body: JSON.stringify(Object.assign({ id: w.id }, change)) })
      .then(function (r) {
        w.notes = r.notes || "";
        writeCache({ at: state.loadedAt, hasLocation: state.hasLocation, works: state.works, shows: state.shows });
        toast(change.note ? "Note added" : "Notes saved");
        done(true);
      })
      .catch(function (err) {
        if (err.auth) { renderLogin("Signed out. Sign in again."); return; }
        toast(err.message); done(false);
      });
  }

  function write(w, change, after) {
    var before = { status: w.status, location: w.location };
    if (change.status !== undefined) w.status = change.status;
    if (change.location !== undefined) w.location = change.location;
    after(); renderBody();
    api("/api/stock/update", { method: "POST", body: JSON.stringify(Object.assign({ id: w.id }, change)) })
      .then(function () {
        toast(change.status ? "Marked " + change.status.toLowerCase() : "Location saved");
        writeCache({ at: state.loadedAt, hasLocation: state.hasLocation, works: state.works, shows: state.shows });
      })
      .catch(function (err) {
        w.status = before.status; w.location = before.location; after(); renderBody();
        if (err.auth) { renderLogin("Signed out. Sign in again."); return; }
        toast(err.message);
      });
  }

  function closeDetail() {
    state.detail = null;
    var slot = document.getElementById("detail-slot");
    if (slot) slot.innerHTML = "";
    if (!state.show) document.body.style.overflow = "";
  }

  window.addEventListener("popstate", function (e) {
    if (lb) { closeLightbox(); return; }
    var st = e.state || {};
    if (st.work) { openDetail(st.work, true); return; }
    closeDetail();
    if (st.show) { if (state.show !== st.show) openShow(st.show, true); }
    else closeShow();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || lb) return;
    if (document.querySelector("#sheet-slot .sheet")) closeSheet();
    else if (state.detail) history.back();
  });

  function renderEmptyError(msg) {
    var el = document.getElementById("list");
    if (!el) return;
    el.innerHTML = '<div class="empty"><p>' + esc(msg) + '</p><button class="text-btn" id="retry">Try again</button></div>';
    document.getElementById("retry").onclick = function () { load(true); };
  }

  // ---------- boot ----------
  // Old shortcuts may still carry "#recXXXX" from the previous version: drop it
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  loadPrefs();
  readCache();
  renderShell();
  function age() { return state.loadedAt ? Date.now() - new Date(state.loadedAt).getTime() : Infinity; }
  if (age() > FRESH_MS) load(false);
  document.addEventListener("visibilitychange", function () {
    // Back to the app after a while: pick up changes made elsewhere
    if (document.visibilityState === "visible") {
      if (age() > FRESH_MS) load(false); else renderBody();
    }
  });
  // Airtable image links expire after about two hours, sooner than the data
  // is considered stale. When one fails to load, fetch fresh links once
  // (at most every 10 minutes) instead of showing broken images.
  var lastImageRetry = 0;
  document.addEventListener("error", function (e) {
    var t = e.target;
    if (!t || t.tagName !== "IMG" || (t.src || "").indexOf("airtableusercontent") < 0) return;
    if (state.loading || Date.now() - lastImageRetry < 10 * 60 * 1000) return;
    lastImageRetry = Date.now();
    load(false);
  }, true);

  // Keeps "Updated n min ago" honest while the app stays open
  setInterval(function () { if (document.visibilityState === "visible" && document.getElementById("updated")) paintUpdated(); }, 60 * 1000);
})();
