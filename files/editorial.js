(async function () {
  const mount = document.getElementById('room');
  const slug = location.pathname.split('/').filter(Boolean).pop();

  let data;
  try {
    const r = await fetch(`/api/editorial/${slug}${location.search}`);
    if (!r.ok) throw new Error(r.status);
    data = await r.json();
  } catch (e) {
    mount.innerHTML = '<div class="state">This room is not available.</div>';
    return;
  }

  document.title = `${data.title} | Diez`;

  /* ---------------- renderers ---------------- */
  const esc = (s) => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const paras = (t) => t.split(/\n\n+/).map((p) => `<p>${esc(p).replace(/\n/g,'<br>')}</p>`).join('');

  const renderers = {
    Hero(b) {
      // El título termina con el guion animado: quitamos un "–" final del texto si existe
      const raw = (b.text || data.title).replace(/\s*[–-]\s*$/,'');
      const title = esc(raw).replace(/\n/g,'<br>');
      const bg = b.image ? `<div class="bg"><img src="${b.image}" alt=""></div>` : '<div class="bg"></div>';
      const sub = data.subtitle ? `<p class="subtitle">${esc(data.subtitle)}</p>` : '';
      return `<section class="hero">${bg}<h1>${title}<span class="open-dash"></span></h1>${sub}</section>`;
    },
    Text(b) { return `<section class="text reveal">${paras(b.text)}</section>`; },
    Quote(b) { return `<section class="quote reveal">${esc(b.text)}<span class="attr">Ian Waelder</span></section>`; },
    Installation(b) {
      if (!b.image) return '';
      return `<section class="installation reveal"><figure>
        <img src="${b.image}" alt="${esc(b.caption)}" loading="lazy">
        <figcaption>${esc(b.caption)}</figcaption></figure></section>`;
    },
    Artwork(b) {
      const a = b.artwork;
      if (!a) return '';
      const img = a.image ? `<img src="${a.image}" alt="${esc(a.title)}" loading="lazy">` : '';
      const line2 = [a.technique, a.dims].filter(Boolean).join(', ');
      const price = a.price ? `<div class="p">${esc(a.price)}</div>` : '';
      return `<section class="artwork reveal" data-title="${esc(a.title)}"><figure>
        ${img}
        <figcaption>
          <div class="caption-meta">
            <div><span class="t">${esc(a.title)}</span>${a.year ? ', ' + esc(a.year) : ''}</div>
            <div class="d">${esc(line2)}</div>
            ${price}
          </div>
          <button class="inquire" data-title="${esc(a.title)}">Inquire</button>
        </figcaption></figure></section>`;
    },
    Diptych(b) {
      return `<section class="diptych reveal">
        <figure>${b.image ? `<img src="${b.image}" alt="" loading="lazy">` : ''}</figure>
        <figure>${b.image2 ? `<img src="${b.image2}" alt="" loading="lazy">` : ''}</figure></section>`;
    },
    Video(b) {
      if (!b.videoUrl) return '';
      return `<section class="video reveal"><div class="frame">
        <iframe src="${esc(b.videoUrl)}" allow="autoplay; fullscreen" title="Video"></iframe>
      </div></section>`;
    },
  };

  mount.innerHTML = data.blocks
    .map((b) => (renderers[b.type] || (() => ''))(b))
    .join('');

  /* ---------------- dash de progreso: nunca se cierra ---------------- */
  const dash = document.getElementById('dash');
  addEventListener('scroll', () => {
    const h = document.documentElement;
    const p = h.scrollTop / (h.scrollHeight - h.clientHeight);
    dash.style.width = Math.min(p, 1) * 96 + '%';
  }, { passive: true });

  /* ---------------- reveals ---------------- */
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { threshold: 0.12 });
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

  /* ---------------- inquire ----------------
     PASO PENDIENTE: sustituir por el flujo de las grid rooms
     (tracking de Inquire Click + WhatsApp/mail). Fallback: mailto. */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.inquire');
    if (!btn) return;
    const subject = encodeURIComponent(`Inquiry: ${btn.dataset.title} — ${data.title}`);
    location.href = `mailto:info@diez.gallery?subject=${subject}`;
  });

  /* ---------------- Artwork View tracking ----------------
     PASO PENDIENTE: conectar al pipeline de eventos existente. */
  const seen = new Set();
  const viewIo = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting && !seen.has(e.target)) {
      seen.add(e.target);
      // trackEvent('Artwork View', e.target.dataset.title, slug);
    }
  }), { threshold: 0.5 });
  document.querySelectorAll('section.artwork').forEach((el) => viewIo.observe(el));
})();
