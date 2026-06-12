// Source for the viewing room app. viewing-room.html loads the compiled
// version from /files/viewing-room.js — after editing this file, regenerate
// it with `npm run build` and commit both files.
const {
  useState,
  useEffect,
  useCallback,
  useRef
} = React;
const PROXY = '/api/airtable';
const TBL_VR = 'tbl8EUvqiOLudNvjv';
const TBL_ARTWORKS = 'tblK8xDtKmakHWt6k';
const TBL_ARTISTS = 'tbl3fHryX8bPSYMyN';
const EMAIL = 'diego@diez.gallery';

// Engagement tracking endpoint (lives in diez-mail, not in this project)
const ENGAGEMENT_URL = 'https://t.diez.gallery/api/ev';

// Read the tracking token once. If absent, the visitor is anonymous and
// nothing will be logged.
const TRACKING_TOKEN = new URLSearchParams(window.location.search).get('t');

// Fire an engagement event without blocking navigation. Uses sendBeacon when
// available so it survives page transitions, falls back to fetch keepalive.
function trackEngagement(event_type, artwork_id, artwork_title) {
  if (!TRACKING_TOKEN) return;
  const payload = JSON.stringify({
    t: TRACKING_TOKEN,
    event_type,
    artwork_id: artwork_id || null,
    artwork_title: artwork_title || null
  });
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([payload], {
        type: 'application/json'
      });
      navigator.sendBeacon(ENGAGEMENT_URL, blob);
      return;
    }
    fetch(ENGAGEMENT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: payload,
      keepalive: true
    }).catch(() => {});
  } catch (err) {
    // Tracking must never break the user experience
    console.warn('Engagement tracking failed:', err);
  }
}
async function atFetch(tableId, qp = {}) {
  const parts = [PROXY + '?path=' + encodeURIComponent(tableId)];
  Object.entries(qp).forEach(([k, v]) => {
    if (v != null) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  });
  const res = await fetch(parts.join('&'));
  if (!res.ok) throw new Error('API error: ' + res.status);
  return res.json();
}

// Single shared viewport hook so components don't each register their own
// resize listener.
function useViewport() {
  const get = () => ({
    isMobile: window.innerWidth < 768,
    isTablet: window.innerWidth >= 768 && window.innerWidth < 1024
  });
  const [vp, setVp] = useState(get);
  useEffect(() => {
    const handleResize = () => setVp(get());
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  return vp;
}

// Status indicator: three states — Available (green), On Hold (amber), Sold (grey).
function Dot({
  status,
  available
}) {
  const onHold = status === 'On hold';
  let color, dotColor, label;
  if (onHold) {
    color = '#8A7A4A';
    dotColor = '#C4A24C';
    label = 'On Hold';
  } else if (available) {
    color = '#5A7A5A';
    dotColor = '#7AB07A';
    label = 'Available';
  } else {
    color = '#999999';
    dotColor = '#CCCCCC';
    label = 'Sold';
  }
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      fontSize: 11,
      letterSpacing: '0.07em',
      textTransform: 'uppercase',
      color
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 5,
      height: 5,
      borderRadius: '50%',
      display: 'inline-block',
      background: dotColor
    }
  }), label);
}

// Inquire / Waitlist button. On Hold works show "Join waitlist" and use a
// "Waitlist:" email subject so incoming emails are easy to triage.
function InquireBtn({
  small,
  artist,
  title,
  artworkId,
  onHold
}) {
  const [h, setH] = useState(false);
  const subjectPrefix = onHold ? 'Waitlist: ' : 'Inquiry: ';
  const subject = encodeURIComponent(subjectPrefix + artist + ' — ' + title);
  const label = onHold ? 'Join waitlist' : 'Inquire';
  return /*#__PURE__*/React.createElement("a", {
    href: `mailto:${EMAIL}?subject=${subject}`,
    onMouseEnter: () => setH(true),
    onMouseLeave: () => setH(false),
    onClick: e => {
      e.stopPropagation();
      trackEngagement('Inquire Click', artworkId, title);
    },
    style: {
      display: 'inline-block',
      background: h ? '#000000' : 'transparent',
      color: h ? '#FFFFFF' : '#000000',
      border: '1px solid #000000',
      padding: small ? '6px 14px' : '9px 22px',
      fontSize: small ? 10 : 11,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      fontFamily: "'Replica', sans-serif",
      fontWeight: 400,
      cursor: 'pointer',
      borderRadius: 1,
      transition: 'all 0.18s',
      textDecoration: 'none',
      whiteSpace: 'nowrap'
    }
  }, label);
}

// ── LIGHTBOX ──────────────────────────────────────────────────────────────────
function Lightbox({
  images,
  startIndex,
  onClose
}) {
  const [idx, setIdx] = useState(startIndex);
  const total = images.length;
  useEffect(() => {
    const h = e => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') setIdx(i => Math.min(i + 1, total - 1));
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') setIdx(i => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [total, onClose]);
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.94)',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      animation: 'fadeIn 0.2s ease both'
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onClose,
    style: {
      position: 'absolute',
      top: 20,
      right: 24,
      background: 'none',
      border: 'none',
      color: '#FFFFFF',
      fontSize: 22,
      cursor: 'pointer',
      fontFamily: "'Replica', sans-serif",
      letterSpacing: '0.08em',
      opacity: 0.6,
      transition: 'opacity 0.15s',
      padding: '4px 8px'
    },
    onMouseEnter: e => e.currentTarget.style.opacity = '1',
    onMouseLeave: e => e.currentTarget.style.opacity = '0.6'
  }, "\u2715"), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 24,
      left: 28,
      fontSize: 10,
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      color: 'rgba(255,255,255,0.45)'
    }
  }, String(idx + 1).padStart(2, '0'), " / ", String(total).padStart(2, '0')), /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      maxWidth: '90vw',
      maxHeight: '90vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("img", {
    key: idx,
    src: images[idx].url,
    alt: 'Installation view ' + (idx + 1),
    style: {
      maxWidth: '100%',
      maxHeight: '90vh',
      objectFit: 'contain',
      display: 'block',
      animation: 'fadeIn 0.25s ease both'
    }
  })), idx > 0 && /*#__PURE__*/React.createElement("button", {
    onClick: e => {
      e.stopPropagation();
      setIdx(i => i - 1);
    },
    style: {
      position: 'absolute',
      left: 20,
      top: '50%',
      transform: 'translateY(-50%)',
      background: 'none',
      border: 'none',
      color: 'rgba(255,255,255,0.55)',
      cursor: 'pointer',
      fontSize: 28,
      fontFamily: 'serif',
      transition: 'color 0.15s',
      padding: '8px 12px'
    },
    onMouseEnter: e => e.currentTarget.style.color = '#FFFFFF',
    onMouseLeave: e => e.currentTarget.style.color = 'rgba(255,255,255,0.55)'
  }, "\u2190"), idx < total - 1 && /*#__PURE__*/React.createElement("button", {
    onClick: e => {
      e.stopPropagation();
      setIdx(i => i + 1);
    },
    style: {
      position: 'absolute',
      right: 20,
      top: '50%',
      transform: 'translateY(-50%)',
      background: 'none',
      border: 'none',
      color: 'rgba(255,255,255,0.55)',
      cursor: 'pointer',
      fontSize: 28,
      fontFamily: 'serif',
      transition: 'color 0.15s',
      padding: '8px 12px'
    },
    onMouseEnter: e => e.currentTarget.style.color = '#FFFFFF',
    onMouseLeave: e => e.currentTarget.style.color = 'rgba(255,255,255,0.55)'
  }, "\u2192"));
}

// ── INSTALLATION VIEWS ────────────────────────────────────────────────────────
function InstallationViews({
  images,
  isMobile
}) {
  const [lightbox, setLightbox] = useState(null); // null or index

  if (!images || !images.length) return null;
  return /*#__PURE__*/React.createElement(React.Fragment, null, lightbox !== null && /*#__PURE__*/React.createElement(Lightbox, {
    images: images,
    startIndex: lightbox,
    onClose: () => setLightbox(null)
  }), /*#__PURE__*/React.createElement("section", {
    id: "installation-views",
    style: {
      maxWidth: 1200,
      margin: '0',
      padding: isMobile ? '40px 20px 60px' : '30px 48px 80px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "subtitle-gray",
    style: {
      marginBottom: 24
    }
  }, "Installation Views"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
      gap: isMobile ? '2px' : '3px'
    }
  }, images.map((img, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    onClick: () => setLightbox(i),
    style: {
      overflow: 'hidden',
      cursor: 'pointer',
      background: '#F5F5F5',
      aspectRatio: '4/3'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: img.url,
    alt: 'Installation view ' + (i + 1),
    loading: "lazy",
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      display: 'block',
      transition: 'transform 0.6s cubic-bezier(0.22,0.68,0,1)'
    },
    onMouseEnter: e => e.currentTarget.style.transform = 'scale(1.04)',
    onMouseLeave: e => e.currentTarget.style.transform = 'scale(1)'
  }))))));
}

// ── LANDING ───────────────────────────────────────────────────────────────────
function Landing({
  room,
  works,
  onSelect
}) {
  const {
    isMobile
  } = useViewport();
  return /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: '100vh',
      background: '#FFFFFF'
    }
  }, /*#__PURE__*/React.createElement("header", {
    style: {
      maxWidth: 1200,
      margin: '0',
      padding: isMobile ? '32px 20px 24px' : '56px 48px 36px'
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "https://diez.gallery",
    target: "_blank",
    rel: "noopener noreferrer",
    style: {
      display: 'inline-block',
      marginBottom: 20,
      marginLeft: -4
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "/files/logo.png",
    alt: "diez",
    style: {
      height: isMobile ? 32 : 48,
      width: 'auto'
    }
  })), /*#__PURE__*/React.createElement("div", {
    className: "subtitle-gray"
  }, room.booth ? `${room.booth}` : '', room.booth && room.dates ? ' · ' : '', room.dates ? `${room.dates}` : ''), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontFamily: "'Replica', sans-serif",
      fontSize: isMobile ? 24 : 32,
      fontWeight: 400,
      letterSpacing: '0',
      lineHeight: 1.15
    }
  }, room.title), /*#__PURE__*/React.createElement("div", {
    className: "divider",
    style: {
      marginTop: 28
    }
  }), room.intro && /*#__PURE__*/React.createElement("p", {
    className: "body-text",
    style: {
      marginTop: 16,
      whiteSpace: 'pre-line'
    }
  }, room.intro), (room.files?.length > 0 || room.installViews?.length > 0) && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }
  }, room.files && room.files.map((file, i) => /*#__PURE__*/React.createElement("a", {
    key: i,
    href: file.url,
    target: "_blank",
    rel: "noopener noreferrer",
    download: file.filename,
    style: {
      display: 'inline-block',
      fontSize: 12,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: '#666666',
      textDecoration: 'none',
      transition: 'color 0.15s'
    },
    onMouseEnter: e => e.target.style.color = '#000000',
    onMouseLeave: e => e.target.style.color = '#666666'
  }, "\u2193 ", file.filename)), room.installViews?.length > 0 && /*#__PURE__*/React.createElement("a", {
    href: "#installation-views",
    onClick: e => {
      e.preventDefault();
      document.getElementById('installation-views')?.scrollIntoView({
        behavior: 'smooth'
      });
    },
    style: {
      display: 'inline-block',
      fontSize: 12,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: '#000000',
      textDecoration: 'none',
      transition: 'color 0.15s',
      fontWeight: 400,
      borderBottom: '1px solid #000000',
      paddingBottom: 1,
      width: 'fit-content'
    },
    onMouseEnter: e => {
      e.target.style.color = '#666666';
      e.target.style.borderBottomColor = '#666666';
    },
    onMouseLeave: e => {
      e.target.style.color = '#000000';
      e.target.style.borderBottomColor = '#000000';
    }
  }, "\u2193 Installation Views"))), /*#__PURE__*/React.createElement("main", {
    style: {
      maxWidth: 1200,
      margin: '0',
      padding: isMobile ? '0 20px 80px' : '0 48px 80px'
    }
  }, works.map((work, i) => /*#__PURE__*/React.createElement(WorkRow, {
    key: work.id,
    work: work,
    index: i,
    onSelect: () => onSelect(i)
  }))), room.installViews?.length > 0 && /*#__PURE__*/React.createElement(InstallationViews, {
    images: room.installViews,
    isMobile: isMobile
  }), /*#__PURE__*/React.createElement("footer", {
    style: {
      padding: isMobile ? '40px 20px' : '48px 48px',
      display: 'flex',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: isMobile ? '12px' : '24px',
      fontSize: 13,
      color: '#333333'
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "https://airtable.com/appkTmFvjmDLOQS4p/pageOJZwubCWxkwCs/form",
    target: "_blank",
    rel: "noopener noreferrer",
    style: {
      color: '#333333',
      textDecoration: 'none'
    }
  }, "Subscribe to our newsletter!"), /*#__PURE__*/React.createElement("a", {
    href: "mailto:diego@diez.gallery",
    style: {
      color: '#333333',
      textDecoration: 'none'
    }
  }, "diego@diez.gallery"), /*#__PURE__*/React.createElement("a", {
    href: "tel:+31633261845",
    style: {
      color: '#333333',
      textDecoration: 'none'
    }
  }, "+31 633261845"), /*#__PURE__*/React.createElement("a", {
    href: "https://instagram.com/diez.gallery",
    target: "_blank",
    rel: "noopener noreferrer",
    style: {
      color: '#333333',
      textDecoration: 'none'
    }
  }, "Instagram"), /*#__PURE__*/React.createElement("span", null, "Open Fri - Sun from 12-5pm or by appointment")));
}

// ── WORK ROW (landing) ────────────────────────────────────────────────────────
function WorkRow({
  work,
  index,
  onSelect
}) {
  const [hov, setHov] = useState(false);
  const {
    isMobile
  } = useViewport();

  // A work that is On Hold is not "available" for direct sale but should still
  // show its price and a (waitlist) Inquire button.
  const onHold = work.status === 'On hold';
  const showInquire = work.available || onHold;
  const showPrice = work.status !== 'Sold';
  return /*#__PURE__*/React.createElement("div", {
    onClick: onSelect,
    onMouseEnter: () => setHov(true),
    onMouseLeave: () => setHov(false),
    style: {
      display: 'grid',
      gridTemplateColumns: isMobile ? '1fr' : '400px 1fr',
      gap: isMobile ? '16px' : '48px',
      padding: '25px 0',
      borderBottom: '1px solid #000000',
      cursor: 'pointer',
      transition: 'opacity 0.2s',
      animation: `fadeUp 0.4s ${index * 0.07}s both cubic-bezier(0.22,0.68,0,1)`
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      overflow: 'hidden',
      borderRadius: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, work.imageUrl ? /*#__PURE__*/React.createElement("img", {
    src: work.imageUrl,
    alt: work.title,
    loading: "lazy",
    style: {
      width: '100%',
      height: 'auto',
      maxHeight: isMobile ? '70vh' : '480px',
      objectFit: 'contain',
      display: 'block',
      transform: hov ? 'scale(1.03)' : 'scale(1)',
      transition: 'transform 0.5s cubic-bezier(0.22,0.68,0,1)'
    }
  }) : /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      aspectRatio: '4/3',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 9,
      color: '#999999',
      letterSpacing: '0.1em',
      textTransform: 'uppercase'
    }
  }, "No image"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      paddingTop: 4
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "artist-name"
  }, work.artist), /*#__PURE__*/React.createElement("h2", {
    className: "work-title"
  }, work.title), work.year && /*#__PURE__*/React.createElement("div", {
    className: "year-value",
    style: {
      marginTop: 14
    }
  }, work.year), work.info && /*#__PURE__*/React.createElement("div", {
    className: "details-value",
    style: {
      marginTop: 3
    }
  }, work.info), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 20
    }
  }, work.price && showPrice && /*#__PURE__*/React.createElement("div", {
    className: "price",
    style: {
      marginBottom: 8
    }
  }, `€ ${Number(work.price).toLocaleString('de-DE')}`), /*#__PURE__*/React.createElement(Dot, {
    status: work.status,
    available: work.available
  })), showInquire && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16
    }
  }, /*#__PURE__*/React.createElement(InquireBtn, {
    small: false,
    artist: work.artist,
    title: work.title,
    artworkId: work.id,
    onHold: onHold
  }))));
}

// ── DETAIL SPLIT ──────────────────────────────────────────────────────────────
function DetailSplit({
  works,
  workIdx,
  onBack,
  onPrev,
  onNext,
  onJump
}) {
  const work = works[workIdx];
  const total = works.length;
  const idx = workIdx;
  const {
    isMobile,
    isTablet
  } = useViewport();
  const [detailIndex, setDetailIndex] = useState(-1); // -1 = main image, 0+ = detail images
  const [zoomActive, setZoomActive] = useState(false);
  const [zoomPos, setZoomPos] = useState({
    x: 0,
    y: 0,
    visible: false
  });
  const imgRef = React.useRef(null);

  // ESC key disables zoom mode
  useEffect(() => {
    if (!zoomActive) return;
    const onKey = e => {
      if (e.key === 'Escape') setZoomActive(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomActive]);

  // Reset to main image when changing artwork
  useEffect(() => {
    setDetailIndex(-1);
    setZoomActive(false);
  }, [workIdx]);
  const hasDetails = work.detailUrls && work.detailUrls.length > 0;
  const totalImages = hasDetails ? 1 + work.detailUrls.length : 1;
  const currentSrc = detailIndex === -1 ? work.imageUrlFull || work.imageUrl : work.detailUrls[detailIndex];
  const currentLabel = detailIndex === -1 ? hasDetails ? 'Click to see detail' : null : detailIndex < work.detailUrls.length - 1 ? 'Click for next detail' : 'Click to see full view';

  // On Hold logic mirrors the landing row.
  const onHold = work.status === 'On hold';
  const showInquire = work.available || onHold;
  const showPrice = work.status !== 'Sold';
  function cycleImage() {
    if (!hasDetails) return;
    setDetailIndex(prev => prev < work.detailUrls.length - 1 ? prev + 1 : -1);
  }
  const stackLayout = isMobile || isTablet;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: '#FFFFFF'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: isMobile ? '10px 16px' : '14px 32px',
      borderBottom: '1px solid #000000',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: isMobile ? 16 : 28
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "https://diez.gallery",
    target: "_blank",
    rel: "noopener noreferrer",
    style: {
      display: 'inline-flex',
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "/files/logo.png",
    alt: "diez",
    style: {
      height: isMobile ? 18 : 22,
      width: 'auto',
      display: 'block'
    }
  })), /*#__PURE__*/React.createElement("button", {
    onClick: onBack,
    className: "button-back"
  }, "\u2190 All works")), /*#__PURE__*/React.createElement("span", {
    className: "counter-text"
  }, String(idx + 1).padStart(2, '0'), " / ", String(total).padStart(2, '0'))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: stackLayout ? 'column' : 'row',
      overflow: stackLayout ? 'auto' : 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: stackLayout ? 'none' : '0 0 60%',
      background: '#FFFFFF',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0',
      position: 'relative',
      overflow: stackLayout ? 'visible' : 'hidden'
    }
  }, work.imageUrl ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      width: '100%',
      padding: isMobile ? '16px' : '20px',
      cursor: zoomActive ? 'none' : hasDetails ? 'pointer' : 'default',
      position: 'relative'
    },
    onClick: zoomActive ? () => setZoomActive(false) : cycleImage,
    onMouseMove: e => {
      if (!zoomActive || !imgRef.current) return;
      const r = imgRef.current.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const visible = x >= 0 && x <= r.width && y >= 0 && y <= r.height;
      setZoomPos({
        x,
        y,
        visible,
        w: r.width,
        h: r.height
      });
    },
    onMouseLeave: () => setZoomPos(p => ({
      ...p,
      visible: false
    }))
  }, /*#__PURE__*/React.createElement("img", {
    src: currentSrc,
    ref: imgRef,
    key: currentSrc,
    alt: work.title + (detailIndex >= 0 ? ' detail ' + (detailIndex + 1) : ''),
    style: stackLayout ? {
      width: '100%',
      height: 'auto',
      maxHeight: isTablet ? '60vh' : '80vh',
      objectFit: 'contain',
      display: 'block',
      animation: 'fadeIn 0.35s ease both'
    } : {
      maxWidth: '100%',
      maxHeight: 'calc(100vh - 100px)',
      width: 'auto',
      height: 'auto',
      objectFit: 'contain',
      display: 'block',
      animation: 'fadeIn 0.35s ease both'
    }
  }), zoomActive && zoomPos.visible && imgRef.current && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: imgRef.current.offsetLeft + zoomPos.x - 90,
      top: imgRef.current.offsetTop + zoomPos.y - 90,
      width: 180,
      height: 180,
      borderRadius: '50%',
      border: '1px solid rgba(0,0,0,0.4)',
      boxShadow: '0 4px 18px rgba(0,0,0,0.18)',
      pointerEvents: 'none',
      backgroundImage: `url(${currentSrc})`,
      backgroundRepeat: 'no-repeat',
      backgroundSize: `${zoomPos.w * 2.5}px ${zoomPos.h * 2.5}px`,
      backgroundPosition: `-${zoomPos.x * 2.5 - 90}px -${zoomPos.y * 2.5 - 90}px`,
      zIndex: 5
    }
  }), currentLabel && !zoomActive && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      fontSize: 9,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color: '#999999'
    }
  }, currentLabel, totalImages > 2 ? ` (${detailIndex + 2}/${totalImages})` : ''), !stackLayout && /*#__PURE__*/React.createElement("button", {
    onClick: e => {
      e.stopPropagation();
      setZoomActive(z => !z);
    },
    title: zoomActive ? 'Disable zoom (ESC)' : 'Enable zoom',
    style: {
      position: 'absolute',
      bottom: 16,
      right: 16,
      width: 34,
      height: 34,
      borderRadius: '50%',
      border: '1px solid rgba(0,0,0,0.2)',
      background: zoomActive ? '#000000' : 'rgba(255,255,255,0.9)',
      color: zoomActive ? '#FFFFFF' : '#444444',
      cursor: 'pointer',
      fontSize: 14,
      fontFamily: 'serif',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      transition: 'all 0.18s',
      zIndex: 6
    }
  }, "\u2315"), !stackLayout && zoomActive && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      bottom: 22,
      right: 60,
      zIndex: 6,
      fontSize: 9,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color: '#666666',
      background: 'rgba(255,255,255,0.9)',
      padding: '4px 8px',
      borderRadius: 2,
      pointerEvents: 'none'
    }
  }, "Click or ESC to exit")) : /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      height: '100%',
      background: '#FFFFFF',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: '#BBB',
      letterSpacing: '0.1em',
      textTransform: 'uppercase'
    }
  }, "No image")), !stackLayout && [{
    fn: onPrev,
    dis: idx === 0,
    lbl: '←',
    pos: 'left'
  }, {
    fn: onNext,
    dis: idx === total - 1,
    lbl: '→',
    pos: 'right'
  }].map(a => /*#__PURE__*/React.createElement("button", {
    key: a.pos,
    onClick: a.fn,
    disabled: a.dis,
    style: {
      position: 'absolute',
      [a.pos]: 16,
      top: '50%',
      transform: 'translateY(-50%)',
      width: 38,
      height: 38,
      borderRadius: '50%',
      border: 'none',
      background: 'rgba(255,255,255,0.85)',
      color: a.dis ? '#CCC' : '#444',
      cursor: a.dis ? 'default' : 'pointer',
      fontSize: 16,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 2px 10px rgba(0,0,0,0.09)',
      transition: 'all 0.15s',
      fontFamily: 'serif'
    }
  }, a.lbl))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: stackLayout ? '0 0 auto' : '0 0 40%',
      overflowY: 'auto',
      borderLeft: stackLayout ? 'none' : '1px solid #000000',
      borderTop: stackLayout ? '1px solid #000000' : 'none',
      display: 'flex',
      flexDirection: 'column',
      animation: 'slideRight 0.35s ease both',
      maxHeight: stackLayout ? 'none' : 'auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: isMobile ? '16px 16px 0' : '32px 36px 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "artist-name"
  }, work.artist), /*#__PURE__*/React.createElement("h1", {
    className: "work-title"
  }, work.title)), /*#__PURE__*/React.createElement("div", {
    className: "divider",
    style: {
      margin: isMobile ? '16px 16px' : '24px 36px'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: isMobile ? '0 16px' : '0 36px'
    }
  }, [work.year ? ['Year', work.year] : null, work.info ? ['Details', work.info] : null].filter(Boolean).map(([k, v]) => /*#__PURE__*/React.createElement("div", {
    key: k,
    style: {
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "year-label",
    style: {
      marginBottom: 4
    }
  }, k), /*#__PURE__*/React.createElement("div", {
    className: "details-value"
  }, v)))), !stackLayout && /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "divider",
    style: {
      padding: isMobile ? '16px 16px' : '20px 36px 28px',
      margin: 0,
      display: 'flex',
      flexDirection: isMobile ? 'column' : 'row',
      justifyContent: 'space-between',
      alignItems: isMobile ? 'flex-start' : 'center',
      gap: isMobile ? 12 : 0
    }
  }, /*#__PURE__*/React.createElement("div", null, work.price && showPrice && /*#__PURE__*/React.createElement("div", {
    className: "price"
  }, "\u20AC ", Number(work.price).toLocaleString('de-DE')), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 5
    }
  }, /*#__PURE__*/React.createElement(Dot, {
    status: work.status,
    available: work.available
  }))), showInquire && /*#__PURE__*/React.createElement(InquireBtn, {
    artist: work.artist,
    title: work.title,
    artworkId: work.id,
    onHold: onHold
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: isMobile ? '0 16px 100px' : isTablet ? '0 36px 60px' : '0 36px 28px',
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap',
      overflowX: isMobile ? 'auto' : 'visible'
    }
  }, works.map((w, i) => /*#__PURE__*/React.createElement("div", {
    key: w.id,
    onClick: () => onJump(i),
    className: `thumbnail ${i === idx ? 'active' : ''}`
  }, w.imageUrl ? /*#__PURE__*/React.createElement("img", {
    src: w.imageUrl,
    alt: w.title,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      display: 'block'
    }
  }) : /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      height: '100%',
      background: '#DDDDDD'
    }
  })))))));
}

// ── LOADING / ERROR ───────────────────────────────────────────────────────────
function Loading() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 24,
      height: 24,
      border: '2px solid #E0DDD8',
      borderTopColor: '#1C1C1A',
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite'
    }
  }), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 10,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: '#AAA'
    }
  }, "Loading"), /*#__PURE__*/React.createElement("style", null, `@keyframes spin { to { transform: rotate(360deg); } }`));
}
function ErrorView({
  msg
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh'
    }
  }, /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 12,
      color: '#999',
      letterSpacing: '0.06em'
    }
  }, msg));
}

// ── APP ───────────────────────────────────────────────────────────────────────
function App() {
  const [status, setStatus] = useState('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [room, setRoom] = useState(null);
  const [works, setWorks] = useState([]);
  const [screen, setScreen] = useState('landing');
  const [workIdx, setWorkIdx] = useState(0);

  // Strip quotes/backslashes so the slug can never break out of the Airtable
  // formula string (the proxy validates this server-side too).
  const rawSlug = new URLSearchParams(window.location.search).get('vr') || window.location.pathname.split('/').pop();
  const slug = rawSlug ? rawSlug.replace(/["\\]/g, '') : rawSlug;
  useEffect(() => {
    if (!slug) {
      setStatus('error');
      setErrorMsg('No viewing room specified.');
      return;
    }
    load(slug);
  }, []);
  async function load(slug) {
    try {
      const vrData = await atFetch(TBL_VR, {
        filterByFormula: `{URL slug} = "${slug}"`,
        maxRecords: 1
      });
      if (!vrData.records?.length) {
        setStatus('error');
        setErrorMsg('Viewing room not found.');
        return;
      }
      const vr = vrData.records[0].fields;
      const vrRecordId = vrData.records[0].id;
      const artworkIds = vr['Artworks'] || [];
      if (!artworkIds.length) {
        setStatus('error');
        setErrorMsg('This viewing room has no artworks yet.');
        return;
      }
      const attachments = vr['Attachments'] || [];
      const installAttachments = vr['Installation Views'] || [];
      setRoom({
        gallery: 'Diez Gallery',
        title: vr['Name'] || 'Viewing Room',
        dates: vr['Dates'] || '',
        booth: vr['Booth'] || '',
        intro: vr['Introduction'] || '',
        files: attachments.map((att, i) => ({
          url: '/api/attachment?id=' + vrRecordId + '&index=' + i,
          filename: att.filename || 'Document'
        })),
        installViews: installAttachments.map((att, i) => ({
          url: '/api/attachment?id=' + vrRecordId + '&field=Installation%20Views&index=' + i,
          filename: att.filename || 'Installation view'
        }))
      });
      const awFormula = 'OR(' + artworkIds.map(id => `RECORD_ID()="${id}"`).join(',') + ')';
      const awData = await atFetch(TBL_ARTWORKS, {
        filterByFormula: awFormula,
        maxRecords: artworkIds.length
      });
      const artworks = awData.records || [];
      const artistIds = {};
      artworks.forEach(aw => (aw.fields['Artist name'] || []).forEach(id => artistIds[id] = true));
      const artistMap = {};
      const uniqueIds = Object.keys(artistIds);
      if (uniqueIds.length) {
        const aFormula = 'OR(' + uniqueIds.map(id => `RECORD_ID()="${id}"`).join(',') + ')';
        const aData = await atFetch(TBL_ARTISTS, {
          filterByFormula: aFormula,
          maxRecords: uniqueIds.length
        });
        (aData.records || []).forEach(a => {
          artistMap[a.id] = a.fields['Name'] || 'Unknown';
        });
      }
      artworks.sort((a, b) => (a.fields['Artist Index'] || 0) - (b.fields['Artist Index'] || 0));
      const mapped = artworks.map(aw => {
        const f = aw.fields;
        const artistLinks = f['Artist name'] || [];
        const artistName = artistLinks.map(id => artistMap[id] || 'Unknown').join(', ');
        const status = f['Status'] || '';
        const available = status !== 'Sold' && status !== 'On hold';
        const price = f['Price €'] || f['Price'] || null;
        return {
          id: aw.id,
          title: f['Title'] || 'Untitled',
          artist: artistName,
          year: f['Year'] || '',
          info: f['Info (Backup)'] || '',
          imageUrl: f['Image URL'] || '/api/image?id=' + aw.id + '&size=large',
          imageUrlFull: f['Image URL'] || '/api/image?id=' + aw.id + '&size=full',
          detailUrls: f['Details'] ? Array.from({
            length: f['Details'].length
          }, (_, i) => '/api/image?id=' + aw.id + '&field=Details&index=' + i + '&size=full') : [],
          status,
          available,
          price
        };
      });
      document.title = (vr['Name'] || 'Viewing Room') + ' — Diez Gallery';
      setWorks(mapped);
      setStatus('ready');

      // Funnel entry point: log that this identified recipient opened the room.
      // Anonymous visitors (no ?t= in URL) are silently ignored by the helper.
      trackEngagement('Viewing Room Open');

      // Preload detail images in background
      mapped.forEach(w => {
        w.detailUrls.forEach(url => {
          const img = new Image();
          img.src = url;
        });
      });
    } catch (err) {
      console.error(err);
      setStatus('error');
      setErrorMsg('Could not load the viewing room. Please try again.');
    }
  }
  const openWork = useCallback(i => {
    setWorkIdx(i);
    setScreen('detail');
  }, []);
  const go = useCallback(dir => {
    setWorkIdx(prev => {
      const next = prev + dir;
      if (next < 0 || next >= works.length) return prev;
      return next;
    });
  }, [works.length]);

  // Track every artwork actually shown in the detail view. Centralising the
  // event here means it fires no matter how the visitor got to the work:
  // clicking from the landing, arrow keys, prev/next buttons or the thumbnail
  // strip. One event per work shown, deduplicated against the previous index.
  const lastTrackedIdx = useRef(-1);
  useEffect(() => {
    if (screen !== 'detail') {
      lastTrackedIdx.current = -1;
      return;
    }
    if (lastTrackedIdx.current === workIdx) return;
    const w = works[workIdx];
    if (w) {
      trackEngagement('Artwork View', w.id, w.title);
      lastTrackedIdx.current = workIdx;
    }
  }, [screen, workIdx, works]);
  useEffect(() => {
    const h = e => {
      if (screen !== 'detail') return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') go(1);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') go(-1);
      if (e.key === 'Escape') setScreen('landing');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [screen, go]);
  if (status === 'loading') return /*#__PURE__*/React.createElement(Loading, null);
  if (status === 'error') return /*#__PURE__*/React.createElement(ErrorView, {
    msg: errorMsg
  });
  if (screen === 'landing') {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        height: '100vh',
        overflowY: 'auto'
      }
    }, /*#__PURE__*/React.createElement(Landing, {
      room: room,
      works: works,
      onSelect: openWork
    }));
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: '100vh',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement(DetailSplit, {
    works: works,
    workIdx: workIdx,
    onBack: () => setScreen('landing'),
    onPrev: () => go(-1),
    onNext: () => go(1),
    onJump: i => setWorkIdx(i)
  }));
}
ReactDOM.createRoot(document.getElementById('root')).render(/*#__PURE__*/React.createElement(App, null));
