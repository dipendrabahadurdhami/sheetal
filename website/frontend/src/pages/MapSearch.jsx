import { PlatformWrap } from "../market/SiteRows";
import { useCatalog, photoFor } from "../market/Market";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams , useNavigate } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Search, MapPin, Map as MapIcon } from "lucide-react";
import { api } from "../api/endpoints";
import { toList, toItem } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { Pagination } from "../components/ui";
import { fmtPrice, purposeOf, images, linkOf, titleOf, specs } from "../utils/format";
import { useSEO } from "../utils/seo";
import { areaOf, PROVINCES, loadLocalLevels } from "../utils/areas";
import { approx, validLatLng } from "../components/LocationMap";

const PER = 24;        // list page size
const BG_PER = 100;    // background loader page size (backend may cap it lower)

// ── coordinates ───────────────────────────────────────────────
// List APIs have no lat/lng; the property detail API does. We fetch details in the
// background (4 at a time) and cache results in the browser, so each property is looked up once.
// v3: pins were corrected in the database (Oct 2026) — old cached pins are dropped. Entries also expire after 7 days.
const GEO_KEY = "sheetal_geo_cache_v4";
try { localStorage.removeItem("sheetal_geo_cache_v2"); localStorage.removeItem("sheetal_geo_cache_v1"); Object.keys(localStorage).filter((k) => k.startsWith("sheetal_maplist_")).forEach((k) => localStorage.removeItem(k)); } catch {}
try { const t = Number(localStorage.getItem(GEO_KEY + "_t") || 0); if (Date.now() - t > 7 * 864e5) { localStorage.removeItem(GEO_KEY); localStorage.setItem(GEO_KEY + "_t", String(Date.now())); } } catch {}
const geo = (() => { try { return JSON.parse(localStorage.getItem(GEO_KEY)) || {}; } catch { return {}; } })();
let saveT; const saveGeo = () => { clearTimeout(saveT); saveT = setTimeout(() => localStorage.setItem(GEO_KEY, JSON.stringify(geo)), 400); };
// Sale and rent pins sit at an approximate spot near the property, never the exact one (see LocationMap).
const own = (p) => {
  if (!p) return null;
  const ll = validLatLng(p.latitude ?? p.lat, p.longitude ?? p.lng ?? p.long);
  return ll ? approx(ll[0], ll[1], p.property_code || p.id) : null;
};
const placeOf = (p) => [p.locality || String(p.property_location || "").split(",")[0], p.district || p.city].filter(Boolean).join(", ").trim().toLowerCase();
const jitter = (id) => [Math.sin(Number(id) * 9301) * 0.006, Math.cos(Number(id) * 49297) * 0.006];
const coordsOf = (p) => {
  const o = own(p) || geo["id:" + p.id]; if (o) return o;
  const g = geo["loc:" + placeOf(p)]; if (g) { const j = jitter(p.id); return [g[0] + j[0], g[1] + j[1]]; }
  return null;
};

async function detailCoords(p) {
  for (const key of [p.url, p.id].filter(Boolean)) {
    try {
      const r = await api.property(key); const d = toItem(r);
      const ll = own(d) || own(d?.property) || own(d?.data) || own(r?.property);
      if (ll) return ll;
    } catch { /* next */ }
  }
  return null;
}
let lastNominatim = 0;
async function placeCoords(name) {
  const wait = Math.max(0, lastNominatim + 1100 - Date.now()); if (wait) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=np&q=${encodeURIComponent(name + ", Nepal")}`);
    const j = await r.json(); return j?.[0] ? [+j[0].lat, +j[0].lon] : null;
  } catch { return null; }
}

// ── cached list of all properties per filter ─────────────────
const LIST_TTL = 6 * 60 * 60 * 1000;
const memLists = {};
const slim = (p) => ({ id: p.id, url: p.url, name: p.name, title: p.title, property_type: p.property_type, category: p.category, property_location: p.property_location, locality: p.locality, district: p.district, city: p.city, location: p.location, tol: p.tol, town: p.town, street: p.street, zone: p.zone, vdc_np_mnp: p.vdc_np_mnp, propertycategory: p.propertycategory, class_type: p.class_type, latitude: p.latitude, longitude: p.longitude, lat: p.lat, lng: p.lng, total_price: p.total_price, rent_per_month: p.rent_per_month, advertisement_purpose: p.advertisement_purpose, purpose: p.purpose, property_purpose: p.property_purpose, feature_image: images(p)[0] || null });
const readList = (k) => {
  if (memLists[k]) return memLists[k];
  try { const v = JSON.parse(localStorage.getItem("sheetal_maplist5_" + k)); if (v && Date.now() - v.t < LIST_TTL) return (memLists[k] = v); } catch {}
  return null;
};
const writeList = (k, items, total) => {
  const v = { t: Date.now(), total, items: items.map(slim) };
  memLists[k] = v;
  try { localStorage.setItem("sheetal_maplist5_" + k, JSON.stringify(v)); } catch { /* storage full: keep in memory */ }
};

// ── map look ──────────────────────────────────────────────────
// category = pin colour + icon; purpose = small letter badge (S / R / I)
export const CATS = {
  house:     { label: "House",            color: "#9D1D21", svg: '<path d="M7 12.5 12 8l5 4.5"/><path d="M8.5 11.5V16h7v-4.5"/>' },
  apartment: { label: "Apartment",        color: "#2F5D8A", svg: '<rect x="9" y="7.5" width="6" height="9"/><path d="M10.8 9.8h.01M13.2 9.8h.01M10.8 12.2h.01M13.2 12.2h.01M11.5 16.5v-2h1v2"/>' },
  flat:      { label: "Flat / Room",      color: "#2E7672", svg: '<rect x="8" y="9" width="8" height="7"/><path d="M8 12.5h8M12 9v7"/>' },
  land:      { label: "Land",             color: "#4C7A35", svg: '<path d="m7 16 3-4 2 2.5 1.5-2L17 16Z"/>' },
  office:    { label: "Office space",     color: "#5F4A86", svg: '<rect x="8" y="10" width="8" height="6"/><path d="M10.5 10V8.5h3V10M8 12.5h8"/>' },
  shop:      { label: "Commercial / Shop", color: "#B06A1E", svg: '<path d="M8 11h8l-.6-2.5H8.6Z"/><path d="M8.7 11v5h6.6v-5M11 16v-2.5h2V16"/>' },
};
export const PURPOSES = { sale: { label: "Sale", letter: "S", color: "#59595B" }, rent: { label: "Rent", letter: "R", color: "#EA2229" } };
const typeKey = (p) => {
  const t = `${p.propertycategory || ""} ${p.property_type || ""} ${p.category || ""} ${p.class_type || ""} ${p.name || ""}`.toLowerCase();
  if (/land|plot|ropani|aana|jagga/.test(t)) return "land";
  if (/office/.test(t)) return "office";
  if (/commercial|shop|shutter|restaurant|hotel|hostel|warehouse|godown|business/.test(t)) return "shop";
  if (/apartment/.test(t)) return "apartment";
  if (/flat|room|bhk|studio/.test(t)) return "flat";
  return "house";
};
const purposeKey = (p) => (purposeOf(p) === "Rent" ? "rent" : "sale");
const pinIcon = (p) => {
  const c = CATS[typeKey(p)], pu = PURPOSES[purposeKey(p)];
  return L.divIcon({
    className: "", iconSize: [30, 38], iconAnchor: [15, 36],
    html: `<svg class="lpin" viewBox="0 0 26 32" width="30" height="38"><path d="M12 30s9-8.6 9-16A9 9 0 0 0 3 14c0 7.4 9 16 9 16Z" fill="${c.color}" stroke="#fff" stroke-width="1.5"/><g transform="translate(0 1)" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${c.svg}</g><circle cx="20.5" cy="6" r="5" fill="#fff" stroke="${pu.color}" stroke-width="1.4"/><text x="20.5" y="8.3" text-anchor="middle" font-family="Poppins,system-ui,sans-serif" font-size="6.6" font-weight="700" fill="${pu.color}">${pu.letter}</text></svg>`,
  });
};
const bubbleIcon = (n, label) => {
  const size = n >= 500 ? 64 : n >= 100 ? 56 : n >= 20 ? 48 : 40;
  return L.divIcon({ className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2], html: `<div class="abub" style="width:${size}px;height:${size}px"><b>${n}</b></div><div class="abub-label">${label}</div>` });
};
const popupHtml = (p, a) => `<a class="tpop" data-pid="${p.id}" href="${linkOf(p)}"><img src="${images(p)[0] || ""}" alt=""/><span><b>${titleOf(p)}</b><small>${[a.locality, a.district].filter(Boolean).join(", ")}</small><em>${fmtPrice(purposeKey(p) === "rent" ? (p.rent_per_month || p.total_price) : p.total_price)}</em></span></a>`;

// real boundary outlines (Nepal / province / district / municipality / tole), cached in the browser
const SHAPES_KEY = "sheetal_shapes_v1";
const shapes = (() => { try { return JSON.parse(localStorage.getItem(SHAPES_KEY)) || {}; } catch { return {}; } })();
const saveShapes = () => { try { localStorage.setItem(SHAPES_KEY, JSON.stringify(shapes)); } catch { /* full */ } };
const pendingShapes = new Set();
async function loadShape(q, tolerance) {
  if (q in shapes || pendingShapes.has(q)) return;
  pendingShapes.add(q);
  const wait = Math.max(0, lastNominatim + 1100 - Date.now()); if (wait) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=np&polygon_geojson=1&polygon_threshold=${tolerance}&q=${encodeURIComponent(q)}`);
    const j = await r.json(); const g = j?.[0]?.geojson;
    shapes[q] = g && /Polygon/.test(g.type) ? g : null;
  } catch { shapes[q] = null; }
  pendingShapes.delete(q); saveShapes();
}
const shapeQueue = []; let shapeBusy = false; const shapeSubs = new Set();
const queueShape = (q, tol) => { if (q in shapes || pendingShapes.has(q) || shapeQueue.some((x) => x[0] === q)) return; shapeQueue.push([q, tol]); runShapes(); };
async function runShapes() {
  if (shapeBusy) return; shapeBusy = true;
  while (shapeQueue.length) { const [q, tol] = shapeQueue.shift(); await loadShape(q, tol); shapeSubs.forEach((f) => f()); }
  shapeBusy = false;
}
// each area gets its own outline (logo colours only) so neighbours are easy to tell apart
// zoom at which every property icon disappears (locations are approximate)
const HIDE_Z = 15; // icons show from zoom 13 (city view) up to here, hidden closer in
const OUTLINES = [
  { color: "#9D1D21", weight: 1.8, fillColor: "#EA2229", fillOpacity: 0.05 },
  { color: "#EA2229", weight: 1.6, dashArray: "6 4", fillColor: "#EA2229", fillOpacity: 0.04 },
  { color: "#59595B", weight: 1.6, fillColor: "#59595B", fillOpacity: 0.05 },
  { color: "#9D1D21", weight: 1.4, dashArray: "2 4", fillColor: "#9D1D21", fillOpacity: 0.04 },
  { color: "#59595B", weight: 1.4, dashArray: "8 3 2 3", fillColor: "#BCBCBF", fillOpacity: 0.08 },
];
const hashOf = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };
const outlineFor = (name) => OUTLINES[hashOf(name) % OUTLINES.length];
const details = {}; // id -> full property (loaded on first hover)
const fillPopup = (popup) => {
  const el = popup.getElement && popup.getElement(); const a = el && el.querySelector(".tpop"); if (!a) return;
  const id = a.dataset.pid; if (!id || details[id] === "loading") return;
  const apply = (d) => { if (!d || !popup.isOpen()) return; popup.setContent(popupHtml(d, areaOf(d))); };
  if (details[id]) return apply(details[id]);
  if (a.querySelector("img")?.getAttribute("src") && a.querySelector("em")?.textContent) return; // already complete
  details[id] = "loading";
  api.property(id).then((r) => { details[id] = r?.data || r; apply(details[id]); }).catch(() => { delete details[id]; });
};
const hoverCard = (mk) => {
  mk.on("popupopen", (e) => fillPopup(e.popup));
  let t; const open = () => { clearTimeout(t); if (!mk.isPopupOpen()) mk.openPopup(); };
  const close = () => { clearTimeout(t); t = setTimeout(() => mk.closePopup(), 220); };
  mk.on("mouseover", open).on("mouseout", close).on("popupopen", (e) => { const el = e.popup.getElement(); if (el) { el.onmouseenter = open; el.onmouseleave = close; } });
  mk.on("add", () => { const el = mk.getElement(); if (el) { el.style.pointerEvents = "auto"; el.onmouseenter = open; el.onmouseleave = close; } });
  return mk;
};
const exactCounts = {};
const exactCount = async (name) => {
  const k = String(name).toLowerCase(); if (k in exactCounts) return exactCounts[k];
  try { const res = toList(await api.search({ keyword: name, page: 1, per_page: 1 })); exactCounts[k] = Number(res.total ?? res.items?.length ?? 0); } catch { exactCounts[k] = null; }
  return exactCounts[k];
};
const nameLabel = (name) => L.divIcon({ className: "", iconSize: [0, 0], html: `<div class="aname">${name}</div>` });

// deterministic scatter inside an area (never the real spot)
// new random seed on every visit: which properties get an icon (and where inside their area) changes each time,
// but stays steady while you zoom/pan during that visit
const SEED = Math.random() * 1000;
const hash = (n) => { const x = Math.sin((Number(n) + SEED) * 12.9898) * 43758.5453; return x - Math.floor(x); };
const scatter = (center, radiusM, id) => {
  const ang = hash(id) * Math.PI * 2, dist = Math.sqrt(hash(Number(id) + 7)) * radiusM * 0.8;
  const dLat = (dist * Math.cos(ang)) / 111320, dLng = (dist * Math.sin(ang)) / (111320 * Math.cos((center[0] * Math.PI) / 180));
  return [center[0] + dLat, center[1] + dLng];
};
const avg = (pts) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
const distM = (a, b) => L.CRS.Earth.distance(L.latLng(a), L.latLng(b));

const CITY_LL = { Pokhara: [28.2096, 83.9856], Kathmandu: [27.7172, 85.324], Lalitpur: [27.6644, 85.3188], Bhaktapur: [27.671, 85.4298], Chitwan: [27.5291, 84.3542], Rupandehi: [27.4952, 83.4566], Tanahun: [27.9447, 84.2279] };
const KINDS = { stay: { label: "Stays", icon: '<path d="M3 19v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6M3 15h18M7 11V8h4v3"/>' }, project: { label: "Projects", icon: '<path d="M6 21V5l6-2v18M12 9h6v12M9 7v.01M9 11v.01M9 15v.01M15 13v.01M15 17v.01"/>' }, invest: { label: "Investments", icon: '<path d="M3 17l6-6 4 4 7-7M14 8h6v6"/>' } };
const fmtK = (n) => (n >= 1e7 ? `Rs. ${+(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `Rs. ${+(n / 1e5).toFixed(2)} Lakh` : `Rs. ${Math.round(n).toLocaleString("en-IN")}`);
const catItems = (kind, cat) => kind === "stay" ? cat.stays.map((x) => ({ id: x.id, to: `/stays/${x.id}`, name: x.name, city: x.city, area: x.area, tag: x.kind, line: `${x.rating} ★ · ${x.reviews} reviews`, price: `${fmtK(x.price)} / night` }))
  : kind === "project" ? cat.projects.map((x) => ({ id: x.id, to: `/project/${x.id}`, name: x.name, city: x.city, area: x.area, tag: x.status, line: `${x.left} of ${x.units} units left`, price: `From ${fmtK(x.from)}` }))
  : cat.invests.map((x) => ({ id: x.id, to: `/investment/${x.id}`, name: x.name, city: x.city, area: x.city, tag: x.raised >= x.target ? "Funded" : "Open", line: `${x.ret} a year, not guaranteed`, price: `Min ${fmtK(x.min)}` }));
const catPos = (it) => { const c = CITY_LL[it.city] || CITY_LL.Kathmandu; let h = 0; for (const ch of String(it.id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; const a = (h % 360) * Math.PI / 180, r = 0.012 + (h % 7) * 0.004; return [c[0] + Math.sin(a) * r, c[1] + Math.cos(a) * r]; };

export default function MapSearch() { return <PlatformWrap><MapSearchInner /></PlatformWrap>; }
function MapSearchInner() {
  useSEO("Map search", "Find properties by area on the map.");
  const [params, setParams] = useSearchParams();
  const purpose = params.get("advertisement_purpose") || "";
  const kind = KINDS[params.get("kind")] ? params.get("kind") : "";
  const catalog = useCatalog();
  const nav = useNavigate();
  const catList = kind ? catItems(kind, catalog).filter((it) => !params.get("keyword") || `${it.name} ${it.city} ${it.area}`.toLowerCase().includes(params.get("keyword").toLowerCase())) : [];
  const keyword = params.get("keyword") || "";
  const page = Number(params.get("page") || 1);

  const source = (pg, per) => {
    if (keyword) return api.search({ keyword, page: pg, per_page: per, ...(purpose ? { advertisement_purpose: purpose } : {}) }).then(toList);
    if (purpose) return api.byPurpose(purpose, pg, per).then(toList);
    return api.allProperties(pg, per).then(toList);
  };

  const { data, loading } = useAsync(() => source(page, PER), [purpose, keyword, page]);
  const items = data?.items || [];

  // ── load every property once (cached) ──
  const [all, setAll] = useState([]);
  const [tick, setTick] = useState(0);
  const [progress, setProgress] = useState({ loaded: 0, total: 0 });
  useEffect(() => {
    let alive = true;
    const cacheKey = (purpose || "all") + "|" + (keyword || "");
    const seen = new Map();
    const queue = []; let running = 0;
    const pump = () => {
      while (alive && running < 4 && queue.length) {
        const p = queue.shift(); running++;
        (async () => {
          if (!(("id:" + p.id) in geo)) { geo["id:" + p.id] = await detailCoords(p); saveGeo(); }
        })().finally(() => { running--; if (alive) { setTick((t) => t + 1); pump(); } });
      }
    };
    const enqueue = () => {}; // coordinates are loaded lazily per visible area (see below)
    const cached = readList(cacheKey);
    const purposeOk = (p) => !purpose || String(p.purpose || p.advertisement_purpose || p.property_purpose || "").toLowerCase().includes(purpose === "sale" ? "sale" : purpose);
    // show the saved list instantly; refresh it quietly in the background when older than 10 min
    if (cached) { setAll(cached.items); setProgress({ loaded: cached.items.length, total: cached.total }); if (Date.now() - (cached.t || 0) < 10 * 60 * 1000) return () => { alive = false; }; }
    else { setAll([]); setProgress({ loaded: 0, total: 0 }); }
    (async () => {
      // fast path: GET /api/map-pins → every property's id + location + type in ONE small gzipped response
      if (!keyword) {
        try {
          const res = await api.mapPins();
          const rows = Array.isArray(res) ? res : res?.data;
          if (Array.isArray(rows) && rows.length) {
            if (!alive) return;
            const list = rows.map(slim).filter(purposeOk);
            setAll(list); setProgress({ loaded: list.length, total: list.length }); writeList(cacheKey, list, list.length);
            return;
          }
        } catch { /* endpoint not added yet → page through the normal list below */ }
      }
      if (cached) { // background refresh: don't flash an empty map
        await new Promise((ok) => (window.requestIdleCallback || setTimeout)(ok, { timeout: 3000 }));
        if (!alive) return;
      }
      // page 1 tells us the real page size + page count, then the rest loads 6 pages at a time (was one by one)
      const get = async (pg) => { for (let t = 0; t < 3; t++) { try { return await source(pg, BG_PER); } catch { await new Promise((ok) => setTimeout(ok, 800 * (t + 1))); } } return null; };
      const first = await get(1); if (!alive || !first) return;
      const total = first.total || first.items.length, size = first.items.length || BG_PER;
      const last = Math.max(first.last || 1, Math.ceil(total / size));
      const add = (r) => r && r.items.forEach((p) => { if (!seen.has(p.id)) seen.set(p.id, p); });
      add(first); if (!cached) { setAll([...seen.values()]); setProgress({ loaded: seen.size, total }); }
      const pages = []; for (let pg = 2; pg <= last; pg++) pages.push(pg);
      const PAR = 6;
      for (let i = 0; i < pages.length && alive; i += PAR) {
        const rs = await Promise.all(pages.slice(i, i + PAR).map(get));
        if (!alive) return;
        rs.forEach(add);
        if (!cached) { setAll([...seen.values()]); setProgress({ loaded: seen.size, total }); }
      }
      if (alive && seen.size >= (total || 0) * 0.95) { writeList(cacheKey, [...seen.values()], seen.size); if (cached) { setAll([...seen.values()]); setProgress({ loaded: seen.size, total }); } }
    })();
    return () => { alive = false; };
  }, [purpose, keyword]);  

  // ── group by province / district / locality ──
  const [geoTick, setGeoTick] = useState(0);
  useEffect(() => { loadLocalLevels().then(() => setGeoTick((x) => x + 1)); }, []);
  const tree = useMemo(() => {
    const prov = {}, dist = {}, muni = {}, loc = {};
    all.forEach((p) => {
      const a = areaOf(p); const ll = own(p) || geo["id:" + p.id];
      const add = (bag, key, extra) => { const g = (bag[key] = bag[key] || { key, n: 0, pts: [], items: [], ...extra }); g.n++; g.items.push(p); if (ll) g.pts.push(ll); return g; };
      if (a.province) add(prov, a.province, { name: a.province });
      if (a.district) add(dist, a.district, { name: a.district, province: a.province });
      if (a.municipality) add(muni, a.district + "|" + a.municipality, { name: a.municipality, district: a.district });
      if (a.locality) add(loc, a.district + "|" + a.locality, { name: a.locality, district: a.district, municipality: a.municipality });
    });
    const centre = (g, fallbackName) => {
      if (g.pts.length) return avg(g.pts);
      const c = geo["loc:" + fallbackName.toLowerCase()]; return c || null;
    };
    Object.values(prov).forEach((g) => (g.c = centre(g, g.name) || PROVINCES[g.name]?.c));
    Object.values(dist).forEach((g) => (g.c = centre(g, `${g.name} district`)));
    Object.values(muni).forEach((g) => (g.c = centre(g, `${g.name}, ${g.district}`)));
    Object.values(loc).forEach((g) => {
      g.c = centre(g, `${g.name}, ${g.district}`);
      g.r = g.c && g.pts.length > 1 ? Math.min(1500, Math.max(350, Math.max(...g.pts.map((p) => distM(g.c, p))) * 1.1)) : 500;
    });
    return { prov: Object.values(prov), dist: Object.values(dist), muni: Object.values(muni), loc: Object.values(loc) };
  }, [all, tick, geoTick]);  

  const [sel, setSel] = useState(null);
  const [view, setView] = useState({ z: 6.5, b: null });
  // load coordinates only for what is on screen (like Google Maps)
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const b = view.b, z = view.z;
      const visibleDist = new Set(tree.dist.filter((g) => g.c && (!b || b.contains(g.c))).map((g) => g.name));
      const need = tree.dist.filter((g) => !g.c).map((g) => `${g.name} district`);
      if (z >= 9) tree.muni.filter((g) => !g.c && visibleDist.has(g.district)).slice(0, 12).forEach((g) => need.push(`${g.name}, ${g.district}`));
      if (z >= 10) tree.loc.filter((g) => !g.c && visibleDist.has(g.district)).slice(0, 15).forEach((g) => need.push(`${g.name}, ${g.district}`));
      for (const n of need) { if (!alive) return; if (("loc:" + n.toLowerCase()) in geo) continue; geo["loc:" + n.toLowerCase()] = await placeCoords(n); saveGeo(); setGeoTick((x) => x + 1); }
      // exact coords for pins only when zoomed into an area
      if (z >= 14) {
        const vis = tree.loc.filter((g) => g.c && (!b || b.contains(g.c))).flatMap((g) => g.items).filter((p) => !own(p) && !(("id:" + p.id) in geo)).slice(0, 24);
        for (let k = 0; k < vis.length; k += 4) { if (!alive) return; await Promise.all(vis.slice(k, k + 4).map(async (p) => { geo["id:" + p.id] = await detailCoords(p); })); saveGeo(); setGeoTick((x) => x + 1); }
      }
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [view, tree.dist.length, tree.loc.length]);  

  // ── map ──
  const mapEl = useRef(null), map = useRef(null), layer = useRef(null);
  useEffect(() => {
    const mp = map.current; if (!mp || !mp._loaded) return;
    const deep = view.z >= HIDE_Z;
    ["focusPane", "markerPane", "popupPane"].forEach((n) => { const el = mp.getPane(n); if (el) el.style.display = deep ? "none" : ""; });
    if (deep) try { mp.closePopup(); } catch {}
  }, [view.z]);
  useEffect(() => {
    map.current = L.map(mapEl.current, { preferCanvas: true, renderer: L.canvas({ padding: 0.5 }), zoomControl: true, minZoom: 6, maxZoom: 19, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90, wheelDebounceTime: 40, zoomAnimationThreshold: 6, zoomAnimation: true, fadeAnimation: true, markerZoomAnimation: true, inertia: true, maxBounds: [[25.8, 79.6], [30.8, 88.6]], maxBoundsViscosity: 0.8 }).setView([28.2, 84.1], 6.5);
    // dynamic zoom speed: fast across Nepal / provinces, slower and finer near toles and streets
    const SPEED = [[8, 45, 1], [10, 70, 0.75], [12, 95, 0.5], [14, 125, 0.5], [99, 160, 0.25]]; // [below zoom, wheel px per level, +/- step]
    const tune = () => {
      const z = map.current.getZoom(), s = SPEED.find(([lim]) => z < lim);
      map.current.options.wheelPxPerZoomLevel = s[1];
      map.current.options.zoomDelta = s[2];
    };
    map.current.on("zoomend", tune); tune();
    const PROVIDERS = [
      ["https://{s}.basemap.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { subdomains: "abcd", attribution: "© OpenStreetMap © CARTO · Local levels: nepali-canonical (CC BY 4.0)" }],
      ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}", { attribution: "© Esri · Local levels: nepali-canonical (CC BY 4.0)" }],
    ];
    let pi = 0, errors = 0, tiles;
    const loadProvider = () => {
      if (tiles) map.current.removeLayer(tiles);
      errors = 0;
      tiles = L.tileLayer(PROVIDERS[pi][0], { ...PROVIDERS[pi][1], maxZoom: 19, keepBuffer: 2, updateWhenZooming: false, updateWhenIdle: true })
        .on("tileerror", () => { if (++errors > 4 && pi < PROVIDERS.length - 1) { pi++; loadProvider(); } })
        .addTo(map.current);
    };
    loadProvider();
    // Satellite view with place + road labels on top (Esri World Imagery, free with attribution)
    const sat = L.layerGroup([
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, maxNativeZoom: 18, keepBuffer: 2, updateWhenZooming: false, updateWhenIdle: true, attribution: "Imagery © Esri, Maxar, Earthstar Geographics" }),
      L.tileLayer("https://{s}.basemap.cartocdn.com/rastertiles/dark_only_labels/{z}/{x}/{y}{r}.png", { subdomains: "abcd", maxZoom: 19, keepBuffer: 2, updateWhenZooming: false, updateWhenIdle: true, attribution: "Labels © OpenStreetMap © CARTO" }),
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, maxNativeZoom: 18, keepBuffer: 2, updateWhenZooming: false, updateWhenIdle: true }),
    ]);
    const ViewSwitch = L.Control.extend({
      options: { position: "bottomright" },
      onAdd() {
        const box = L.DomUtil.create("div", "map-views");
        box.innerHTML = '<button type="button" data-v="map" class="on">Map</button><button type="button" data-v="sat">Satellite</button>';
        L.DomEvent.disableClickPropagation(box);
        box.addEventListener("click", (e) => {
          const v = e.target?.dataset?.v; if (!v) return;
          box.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
          if (v === "sat") { if (tiles) map.current.removeLayer(tiles); sat.addTo(map.current); }
          else { map.current.removeLayer(sat); if (tiles) tiles.addTo(map.current); }
          try { localStorage.setItem("sheetal_map_view", v); } catch {}
        });
        try { if ((localStorage.getItem("sheetal_map_view") || "sat") === "sat") setTimeout(() => box.querySelector('[data-v="sat"]').click(), 0); } catch {}
        return box;
      },
    });
    new ViewSwitch().addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    let ut;
    const upd = () => { clearTimeout(ut); ut = setTimeout(() => { if (!map.current) return; const z = map.current.getZoom(), b = map.current.getBounds().pad(0.4); setView((v) => (v.b && Math.floor(v.z) === Math.floor(z) && v.b.contains(map.current.getBounds()) ? v : { z, b })); }, 180); };
    map.current.on("moveend", upd); upd();
    // hide icons instantly while zooming out (before the layer refresh), show again at street level
    const pinsVis = () => map.current.getContainer().classList.toggle("pins-off", map.current.getZoom() >= HIDE_Z);
    let pr = 0; map.current.on("zoom", () => { if (!pr) pr = requestAnimationFrame(() => { pr = 0; pinsVis(); }); }).on("zoomend", pinsVis); pinsVis();
    const ro = new ResizeObserver(() => map.current.invalidateSize()); ro.observe(mapEl.current);
    return () => { ro.disconnect(); map.current.remove(); };
  }, []);

  const [shapeTick, setShapeTick] = useState(0);
  useEffect(() => { let t; const f = () => { clearTimeout(t); t = setTimeout(() => setShapeTick((x) => x + 1), 600); }; shapeSubs.add(f); return () => { shapeSubs.delete(f); clearTimeout(t); }; }, []);
  const shown = useRef(new Set());
  const prevZ = useRef(null);
  const cache = useRef(new Map()), keyOf = useRef(new WeakMap());
  useEffect(() => {
    const lg = layer.current; if (!lg) return;
    const keep = new Set();
    if (view.z < (prevZ.current ?? view.z) - 0.5) shown.current.clear(); // zooming out: start fresh
    prevZ.current = view.z;
    const z = view.z, inView = (c) => c && (!view.b || view.b.contains(c));
    const zoomTo = (c, nz) => map.current.flyTo(c, nz, { duration: 0.8, easeLinearity: 0.2 });
    const cnt = (g) => g?.items?.length ?? g?.n ?? 0;
    // reuse layers between renders: only add what's new, only remove what left the view
    const put = (key, make) => { keep.add(key); let l = cache.current.get(key); if (!l) { l = make(); if (!l) return; cache.current.set(key, l); keyOf.current.set(l, key); } if (!lg.hasLayer(l)) lg.addLayer(l); };
    const tipTxt = (name, n) => `${name} (${n} ${n === 1 ? "property" : "properties"})`;
    // provinces / districts / municipalities are drawn from official boundaries (see adminLayers below).
    // Here: toles from zoom 12, property icons from zoom 15.
    const notArea = (g) => { const n = String(g.name).toLowerCase(); return n !== String(g.district).toLowerCase() && !(g.municipality && String(g.municipality).toLowerCase().startsWith(n + " ")); };
    const cands = [];
    // a few icons already at country view, more per province → district → municipality as you zoom in
    if (z < 11 || z >= HIDE_Z - 1) {
      // toles not located yet borrow their district centre (spread wider) so every province/district gets icons
      const dc = {}; (tree.dist || []).forEach((d) => { if (d.c) dc[String(d.name).toLowerCase()] = d; });
      tree.loc.forEach((g) => {
        const base = g.c ? g : dc[String(g.district || "").toLowerCase()] ? { ...g, c: dc[String(g.district).toLowerCase()].c, r: 6000 } : null;
        if (base && inView(base.c)) (g.items || []).forEach((p) => cands.push([p, base]));
      });
    }
    if (z >= 11) {
      tree.loc.filter((g) => inView(g.c) && notArea(g)).forEach((g) => {
        const n = cnt(g);
        put(`tole|${g.key}|${n}`, () => L.circle(g.c, { radius: g.r || 500, stroke: false, fillOpacity: 0, interactive: true })
          .bindTooltip(() => tipTxt(g.name, exactCounts[String(g.name).toLowerCase()] ?? n), { sticky: true, direction: "top", className: "atip", opacity: 1 })
          .on("mouseover", (e) => { lvl.current.hoverTole && lvl.current.hoverTole(g); const l = e.target; exactCount(g.name).then((x) => { if (x != null && l.isTooltipOpen()) l.setTooltipContent(tipTxt(g.name, x)); }); })
          .on("mouseout", () => lvl.current.clear && lvl.current.clear())
          .on("click", () => map.current.getZoom() < 13 && zoomTo(g.c, 13.8)));
        // icons only at neighbourhood zoom (15–16.5). Locations are approximate, so closer in the pins
        // would look like they sit on a road / school / office — from 16.5 we hide them and keep the area.
        if (z >= 11 && z < HIDE_Z - 1) (g.items || []).forEach((p) => cands.push([p, g]));
      });
    }
    // only what is in the viewport, one icon per screen cell: fewer at city view, more as you zoom in
    if (cands.length) {
      const mp = map.current, vb = mp.getBounds(), used = new Map();
      // one icon per screen cell, cells sized so icons (≈28px) never touch: ~3–4 per province at country view, filling in as you zoom
      const cell = z < 7.5 ? 54 : z < 9 ? 50 : z < 10.5 ? 46 : z < 11.8 ? 44 : z < 12.5 ? 40 : z < 13.2 ? 38 : z < 14 ? 36 : 32;
      // icons already on the map keep their place when you zoom in; new ones only fill empty space
      const h = (id) => hash(Number(id) * 3.7 + 11);
      cands.sort((a, b) => (shown.current.has(b[0].id) - shown.current.has(a[0].id)) || (h(a[0].id) - h(b[0].id)));
      // last zoom band before icons hide: EVERY property in view gets its icon (nudged apart instead of dropped)
      const showAll = z >= HIDE_Z - 1;
      const placed = [];
      const free = (q) => placed.every((o) => Math.hypot(o.x - q.x, o.y - q.y) >= 26);
      cands.forEach(([p, g]) => {
        let ll = scatter(g.c, g.r, p.id); if (!vb.contains(ll)) return;
        let pt = mp.latLngToContainerPoint(ll);
        if (showAll) {
          if (!free(pt)) { // spiral outwards to the nearest free spot
            let found = null;
            for (let k = 1; k <= 60 && !found; k++) { const ang = k * 2.4, rad = 14 + k * 4; const q = L.point(pt.x + Math.cos(ang) * rad, pt.y + Math.sin(ang) * rad); if (free(q)) found = q; }
            if (found) { pt = found; ll = mp.containerPointToLatLng(pt); }
          }
          placed.push(pt); shown.current.add(p.id);
          put(`pinall|${p.id}|${Math.round(pt.x)}|${Math.round(pt.y)}|${z}`, () => hoverCard(L.marker(ll, { icon: pinIcon(p) })
            .bindPopup(popupHtml(p, { locality: g.name, district: g.district }), { closeButton: false, className: "tpop-wrap", offset: [0, -28], autoPan: false })));
          return;
        }
        const cx = Math.floor(pt.x / cell), cy = Math.floor(pt.y / cell);
        // keep a clear gap: the cell and its 8 neighbours must be free of icons that sit too close
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const o = used.get(`${cx + dx}:${cy + dy}`); if (o && Math.hypot(o.x - pt.x, o.y - pt.y) < cell * 0.8) return; }
        used.set(`${cx}:${cy}`, pt); shown.current.add(p.id);
        put(`pin|${p.id}`, () => hoverCard(L.marker(ll, { icon: pinIcon(p) })
          .bindPopup(popupHtml(p, { locality: g.name, district: g.district }), { closeButton: false, className: "tpop-wrap", offset: [0, -28], autoPan: false })));
      });
    }
    lg.eachLayer((l) => { const k = keyOf.current.get(l); if (k && !keep.has(k)) lg.removeLayer(l); });
  }, [tree, view, shapeTick]);  

  // ── official boundaries for all 7 provinces, 77 districts, 753 local levels (nepali-geo-pro-max, MIT) ──
  const [adm, setAdm] = useState(null);
  useEffect(() => {
    let on = true;
    Promise.all([import("nepali-geo-pro-max"), import("nepali-geo-pro-max/geo/provinces"), import("nepali-geo-pro-max/geo/districts"), import("nepali-geo-pro-max/geo/local-units")])
      .then(([lib, P, D, U]) => on && setAdm({ lib, prov: P.NEPAL_PROVINCES_GEO, dist: D.NEPAL_DISTRICTS_GEO, lu: U.NEPAL_LOCAL_UNITS_GEO }))
      .catch((err) => console.warn("Nepal boundaries could not load — run npm install", err));
    return () => { on = false; };
  }, []);
  const nrm = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
  const luKey = (pr) => pr.id || `${pr.districtId}|${pr.nameEn}`;
  const counts = useMemo(() => {
    const P = {}, D = {}, U = {}, miss = [];
    if (!adm) return { P, D, U, miss };
    const { lib } = adm;
    const distByName = {}; adm.dist.features.forEach((f) => (distByName[nrm(f.properties.nameEn)] = f.properties));
    const luByDist = {}; adm.lu.features.forEach((f) => (luByDist[f.properties.districtId] = luByDist[f.properties.districtId] || []).push(f.properties));
    all.forEach((p) => {
      let d = null, u = null;
      const ll = own(p);
      const dbD = distByName[nrm(p.district)];
      if (dbD) d = { id: dbD.id, provinceId: dbD.provinceId || String(dbD.id).split(".")[0] };
      if (ll && lib.findLocalUnitFeatureByCoords) { const uf = lib.findLocalUnitFeatureByCoords(adm.lu, ll[0], ll[1]); if (uf && (!d || uf.properties.districtId === d.id)) { u = uf.properties; if (!d) d = { id: u.districtId, provinceId: u.provinceId }; } }
      if (!d) {
        const a = areaOf(p);
        const dd = (lib.getDistrict && a.district && lib.getDistrict(a.district)) || distByName[nrm(a.district)];
        let ddd = dd;
        // fallback 1: raw backend fields + any district name written anywhere in the address/title
        if (!ddd) {
          const txt = nrm([p.district, p.town, p.tol, p.street, p.zone, p.vdc_np_mnp, p.property_location, p.location, p.name].filter(Boolean).join(" "));
          const ALIAS = { kavre: "kavrepalanchok", kabhre: "kavrepalanchok", kathamandu: "kathmandu", ktm: "kathmandu", patan: "lalitpur", bhaktaput: "bhaktapur", kritipur: "kathmandu", kirtipur: "kathmandu", nawalparasi: "nawalparasieast", chitawan: "chitwan", pokhara: "kaski", hetauda: "makwanpur", dhulikhel: "kavrepalanchok", banepa: "kavrepalanchok", nagarkot: "bhaktapur", sauraha: "chitwan", bharatpur: "chitwan", butwal: "rupandehi", biratnagar: "morang", dharan: "sunsari", itahari: "sunsari", birgunj: "parsa", nepalgunj: "banke", dhangadhi: "kailali" };
          const key = Object.keys(distByName).sort((x, y) => y.length - x.length).find((k) => k.length > 3 && txt.includes(k))
            || distByName[ALIAS[Object.keys(ALIAS).find((k) => txt.includes(k))]] && ALIAS[Object.keys(ALIAS).find((k) => txt.includes(k))];
          if (key) ddd = distByName[key];
        }
        if (ddd) d = { id: ddd.id, provinceId: ddd.provinceId || String(ddd.id).split(".")[0] };
        if (d && a.municipality) {
          const base = nrm(a.municipality.replace(/sub-?\s*metropolitan city|metropolitan city|rural municipality|municipality/gi, ""));
          u = (luByDist[d.id] || []).find((x) => nrm(x.nameEn) === base) || (luByDist[d.id] || []).find((x) => nrm(x.nameEn).startsWith(base));
        }
      }
      if (d) { D[d.id] = (D[d.id] || 0) + 1; P[d.provinceId] = (P[d.provinceId] || 0) + 1; } else { miss.push(p); }
      if (u) U[luKey(u)] = (U[luKey(u)] || 0) + 1;
    });
    if (miss.length) console.info(`[map] ${miss.length} properties have no recognisable district:`, miss.slice(0, 50).map((p) => `${p.property_code || p.id}: ${p.property_location || ""} | ${p.district || ""}`));
    return { P, D, U, miss };
  }, [adm, all, tick]);  
  const totalRef = useRef(0); totalRef.current = progress.total || data?.total || 0;
  const countsRef = useRef(counts); countsRef.current = counts;
  const lvl = useRef({});
  useEffect(() => {
    if (!adm || !map.current) return;
    // hit areas are invisible; the outline appears only for the hovered area, drawn from detailed OpenStreetMap
    // boundaries (fetched once per area, cached in the browser). Package shapes are only used as hover targets.
    const HIT = { stroke: false, fill: true, fillOpacity: 0 };
    const OUT = { color: "#9D1D21", weight: 2.2, opacity: 1, dashArray: "2 6", lineCap: "round", fillColor: "#EA2229", fillOpacity: 0.07, interactive: false };
    const TYPE = { metropolitan: "Metropolitan City", "sub-metropolitan": "Sub-Metropolitan City", municipality: "Municipality", "rural-municipality": "Rural Municipality" };
    const hl = L.geoJSON(null, { style: (f) => (f && f.properties && f.properties.fillOnly ? { ...OUT, stroke: false } : f && f.properties && f.properties.lineOnly ? { ...OUT, fill: false } : OUT), interactive: false }).addTo(map.current);
    // outer border only (drops the inner district lines that the boundary package keeps inside provinces / Nepal)
    const outerView = (gj) => {
      const feats = gj.type === "FeatureCollection" ? gj.features : [gj];
      const rings = [];
      feats.forEach((f) => { const g = f.geometry || f; const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []; polys.forEach((p) => p.forEach((r) => rings.push(r))); });
      const k = (p) => p[0].toFixed(3) + "," + p[1].toFixed(3), cnt = new Map();
      const ek = (a, b) => { const x = k(a), y = k(b); return x < y ? x + "|" + y : y + "|" + x; };
      rings.forEach((r) => { for (let i = 0; i < r.length - 1; i++) { const e = ek(r[i], r[i + 1]); cnt.set(e, (cnt.get(e) || 0) + 1); } });
      const lines = [];
      rings.forEach((r) => { let run = []; for (let i = 0; i < r.length - 1; i++) { if (cnt.get(ek(r[i], r[i + 1])) === 1) { if (!run.length) run.push(r[i]); run.push(r[i + 1]); } else if (run.length) { lines.push(run); run = []; } } if (run.length) lines.push(run); });
      return { type: "FeatureCollection", features: [
        ...feats.map((f) => ({ type: "Feature", properties: { fillOnly: true }, geometry: f.geometry || f })),
        // keep only long border runs: short pieces are gaps between neighbouring sub-areas (the stray red dashes)
        { type: "Feature", properties: { lineOnly: true }, geometry: { type: "MultiLineString", coordinates: lines.filter((l) => l.length >= 25) } },
      ] };
    };
    let hoverId = 0;
    // outer border only: drop holes and tiny islands so no stray dashes appear inside the area
    const ringArea = (r) => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(s / 2); };
    const cleanShape = (g) => {
      const geo = g.geometry || g;
      if (geo.type === "Polygon") return { type: "Polygon", coordinates: [geo.coordinates[0]] };
      if (geo.type === "MultiPolygon") {
        const outer = geo.coordinates.map((p) => p[0]); const max = Math.max(...outer.map(ringArea));
        return { type: "MultiPolygon", coordinates: outer.filter((r) => ringArea(r) > max * 0.01).map((r) => [r]) };
      }
      return geo;
    };
    // detailed OSM boundary, accepted only if it is the right KIND of area (so "Kathmandu District" never returns the city)
    const KINDS = {
      nepal: ["country"],
      prov: ["state", "province", "region"],
      dist: ["county", "state_district", "district"],
      lu: ["city", "town", "municipality", "village", "city_district", "county"],
      tole: ["suburb", "neighbourhood", "quarter", "city_block", "residential", "village", "hamlet", "borough", "city_district", "isolated_dwelling", "locality"],
    };
    const nomi = async (url) => {
      const wait = Math.max(0, lastNominatim + 1100 - Date.now()); if (wait) await new Promise((r) => setTimeout(r, wait));
      lastNominatim = Date.now();
      try { return await (await fetch(url)).json(); } catch { return null; }
    };
    const save = () => { try { localStorage.setItem(SHAPES_KEY, JSON.stringify(shapes)); } catch {} };
    // match by OSM rank (works even when addresstype is missing): country 4, province ~8, district ~12, municipality ~14-16, ward/tole ~17-22
    const RANK = { nepal: [3, 5], prov: [6, 10], dist: [11, 13], lu: [13, 17], tole: [17, 25] };
    const okPoly = (r, kind) => {
      if (!r || !r.geojson || !/Polygon/.test(r.geojson.type)) return false;
      if (r.addresstype && KINDS[kind].includes(r.addresstype)) return true;
      const pr = Number(r.place_rank ?? r.rank_address); const [a, b] = RANK[kind];
      return pr >= a && pr <= b;
    };
    const precise1 = async (q, tol, kind) => {
      const key = `v2|${kind}|${q}`;
      if (key in shapes) return shapes[key];
      const j = await nomi(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=np&polygon_geojson=1&polygon_threshold=${tol}&q=${encodeURIComponent(q)}`);
      const hit = Array.isArray(j) ? j.find((r) => okPoly(r, kind)) : null;
      shapes[key] = hit ? hit.geojson : null; save();
      return shapes[key];
    };
    // tole fallback: the smallest mapped area (suburb / ward / neighbourhood) that contains the tole centre
    const around = async (c, tol) => {
      const key = `v2|rev|${c[0].toFixed(4)},${c[1].toFixed(4)}`;
      if (key in shapes) return shapes[key];
      let g = null;
      for (const zz of [17, 16, 15, 14]) {
        const r = await nomi(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=${zz}&polygon_geojson=1&polygon_threshold=${tol}&lat=${c[0]}&lon=${c[1]}`);
        if (okPoly(r, "tole")) { g = r.geojson; break; }
      }
      shapes[key] = g; save();
      return g;
    };
    const precise = async (qs, tol, kind) => {
      for (const q of (Array.isArray(qs) ? qs : [qs])) { const g = await precise1(q, tol, kind); if (g) return g; }
      return null;
    };
    // only ever draw a detailed boundary; if none exists, draw nothing (never the rough straight-line shape)
    const showOutline = async (qs, tol, kind, c, rough) => {
      const id = ++hoverId; hl.clearLayers();
      const big = kind === "nepal" || kind === "prov" || kind === "dist";
      const roughShape = kind === "nepal" ? adm.prov : rough;
      // instant border while the detailed one loads: one area = its own clean outline; all Nepal = outer edge of the provinces
      if (big && roughShape) hl.addData(kind === "nepal" ? outerView(roughShape) : cleanShape(roughShape.features ? roughShape.features[0] : roughShape));
      let g = await precise(qs, tol, kind);
      if (!g && big) return;
      if (!g && kind === "tole" && c) g = await around(c, tol);
      if (id !== hoverId || !g) return;
      hl.clearLayers(); hl.addData(cleanShape(g));
    };
    const make = (fc, label, count, query, tol, maxZ, whole, kind) => {
      const tipOf = (pr) => { const n = count(pr) || 0; return `${label(pr)} (${n} ${n === 1 ? "property" : "properties"})`; };
      const grp = L.geoJSON(fc, { style: () => HIT, onEachFeature: whole ? undefined : (f, l) => {
        l.bindTooltip(() => tipOf(f.properties), { sticky: true, direction: "top", className: "atip", opacity: 1 });
        l.on("mouseover", () => showOutline(query(f.properties), tol, kind, null, f)).on("mouseout", () => { hoverId++; hl.clearLayers(); })
          .on("click", () => map.current.flyToBounds(l.getBounds(), { maxZoom: maxZ, padding: [24, 24], duration: 0.8, easeLinearity: 0.2 }));
      } });
      if (whole) {
        grp.bindTooltip(() => tipOf({}), { sticky: true, direction: "top", className: "atip", opacity: 1 });
        grp.on("mouseover", () => showOutline(query({}), tol, kind, null, null)).on("mouseout", () => { hoverId++; hl.clearLayers(); })
          .on("click", () => map.current.flyToBounds(grp.getBounds(), { maxZoom: maxZ, duration: 0.8 }));
      }
      return grp;
    };
    const provName = (pr) => (adm.lib.getProvince && adm.lib.getProvince(pr.id)?.nameEn) || pr.nameEn || pr.id;
    const distName = (id) => adm.dist.features.find((f) => f.properties.id === id)?.properties.nameEn || "";
    lvl.current = {
      nepal: make(adm.prov, () => "Nepal", () => Math.max(all.length, totalRef.current || 0), () => "Nepal", 0.005, 7.5, true, "nepal"),
      prov: make(adm.prov, (pr) => `${provName(pr)} Province`, (pr) => countsRef.current.P[pr.id], (pr) => [`${provName(pr)} Province, Nepal`, `${provName(pr)} Pradesh, Nepal`, `${provName(pr)}, Nepal`], 0.003, 9, false, "prov"),
      dist: make(adm.dist, (pr) => pr.nameEn, (pr) => countsRef.current.D[pr.id], (pr) => [`${pr.nameEn} District, Nepal`, `${pr.nameEn} Jilla, Nepal`, `${pr.nameEn}, Nepal`], 0.0008, 11, false, "dist"),
      lu: make(adm.lu, (pr) => `${pr.nameEn} ${TYPE[pr.type] || ""}`.trim(), (pr) => countsRef.current.U[luKey(pr)], (pr) => [`${pr.nameEn} ${TYPE[pr.type] || ""}, ${distName(pr.districtId)}, Nepal`, `${pr.nameEn} ${TYPE[pr.type] || ""}, Nepal`, `${pr.nameEn}, ${distName(pr.districtId)} District, Nepal`, `${pr.nameEn}, Nepal`], 0.0002, 13, false, "lu"),
      hl,
      // tole hover: its own OSM outline if mapped; otherwise the municipality it sits in
      hoverTole: (g) => showOutline([`${g.name}, ${g.district}, Nepal`, `${g.name}, Nepal`], 0.0001, "tole", g.c),
      clear: () => { hoverId++; hl.clearLayers(); },
    };
    return () => Object.values(lvl.current).forEach((l) => map.current && map.current.removeLayer(l));
  }, [adm]);  
  // hierarchy by zoom: Province (6–7) → District (8–9) → Municipality / Metro (10–11) → Tole (12–14, inside municipality outlines) → icons (15+)
  useEffect(() => {
    const L0 = lvl.current; if (!L0.prov || !map.current) return;
    const z = view.z, want = z < 7 ? "nepal" : z < 8.5 ? "prov" : z < 11.8 ? "dist" : z < 13 ? "lu" : "none";
    if (L0.hl) L0.hl.clearLayers();
    ["nepal", "prov", "dist", "lu"].forEach((k) => { const l = L0[k]; if (k === want) { if (!map.current.hasLayer(l)) l.addTo(map.current); } else if (map.current.hasLayer(l)) map.current.removeLayer(l); });
  }, [view.z, adm]);

  const set = (k, v) => { const n = new URLSearchParams(params); v ? n.set(k, v) : n.delete(k); n.delete("page"); setParams(n); };
  const done = progress.total && progress.loaded >= progress.total;
  // hover a list card: fly there, show THIS property's pin (highlighted) + its 9 nearest neighbours, at any zoom
  const focusLayer = useRef(null);
  const areaPos = (p) => { const g = tree.loc.find((x) => (x.items || []).some((q) => q.id === p.id)); return g && g.c ? scatter(g.c, g.r, p.id) : null; };
  const posOf = (p) => {
    const o = own(p) || geo["id:" + p.id] || areaPos(p); if (o) return o;
    const a = areaOf(p); const g = tree.loc.find((x) => x.key === a.district + "|" + a.locality);
    return g?.c ? scatter(g.c, g.r, p.id) : null;
  };
  // coordinates for one property: saved pin, else fetch its detail once (list API has no lat/lng)
  const ensurePos = async (p) => {
    const have = posOf(p); if (have && (own(p) || geo["id:" + p.id])) return have;
    if (!("id:" + p.id in geo)) { geo["id:" + p.id] = await detailCoords(p); saveGeo(); }
    return posOf(p);
  };
  const hoverTok = useRef(0);
  // clear the "show on map" selection: back to the normal map
  const unfocus = () => { hoverTok.current++; setSel(null); if (map.current) map.current.getContainer().classList.remove("has-sel"); if (focusLayer.current) focusLayer.current.clearLayers(); if (map.current) try { map.current.closePopup(); } catch {} };
  const selRef = useRef(null); selRef.current = sel;
  useEffect(() => {
    const onDown = (e) => {
      if (selRef.current == null) return;
      if (e.target.closest && e.target.closest(".map-show, .map-canvas")) return;
      unfocus();
    };
    const onKey = (e) => { if (e.key === "Escape" && selRef.current != null) unfocus(); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, []);  
  const focus = async (p) => {
    const mp = map.current; if (!mp) return;
    const tok = ++hoverTok.current;
    const c = (await ensurePos(p)) || areaPos(p);
    if (tok !== hoverTok.current) return;
    if (!c) { console.warn("No map position for property", p.id); return; }
    // neighbours: same locality first (fetch their pins if needed), then anything already known nearby
    const a0 = areaOf(p);
    const same = all.filter((q) => q.id !== p.id && areaOf(q).locality === a0.locality).slice(0, 12);
    await Promise.all(same.map((q) => ensurePos(q)));
    if (tok !== hoverTok.current) return;
    if (!focusLayer.current || focusLayer.current._map !== mp) {
      if (!mp.getPane("focusPane")) { mp.createPane("focusPane"); mp.getPane("focusPane").style.zIndex = 660; }
      focusLayer.current = L.layerGroup().addTo(mp);
    }
    const fpane = mp.getPane("focusPane"); if (fpane) { fpane.style.display = ""; fpane.style.zIndex = 660; }
    const fl = focusLayer.current; fl.clearLayers();
    mp.getContainer().classList.add("has-sel");
    const near = all.filter((q) => q.id !== p.id).map((q) => { const qc = posOf(q); return qc ? [q, qc, distM(c, qc)] : null; })
      .filter((n) => n && n[2] <= 2000).sort((x, y) => x[2] - y[2]).slice(0, 6); // only the closest neighbours (within 2 km), max 6
    // neighbours: just their icons at their own spot (no lines); hover any icon for its card
    near.forEach(([q, qc]) => hoverCard(L.marker(qc, { icon: pinIcon(q), pane: "focusPane" })
      .bindPopup(popupHtml(q, areaOf(q)), { closeButton: false, className: "tpop-wrap", offset: [0, -28], autoPan: false })).addTo(fl));
    // selected property: its own look (big red pin, white ring, soft pulse) so it never blends with the neighbours
    const sel = L.divIcon({ className: "", iconSize: [0, 0], html: '<div class="pin-sel"><span class="pin-sel-ring"></span><span class="pin-sel-dot"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg></span></div>' });
    hoverCard(L.marker(c, { icon: sel, pane: "focusPane", zIndexOffset: 1000 })
      .bindPopup(popupHtml(p, areaOf(p)), { closeButton: false, className: "tpop-wrap", offset: [0, -40], autoPan: false })).addTo(fl);
    // gentle zoom: neighbourhood level (max 14.5), and only move if the pin is off-screen or we are far out
    const target = Math.max(mp.getZoom(), 11); // keep the user's zoom (only zoom in if icons wouldn't show yet)
    const fit = near.length ? L.latLngBounds([c, ...near.map((n) => n[1])]).pad(0.25) : null;
    const showAllOnZoom = () => mp.once("zoomstart", () => mp.getContainer().classList.remove("has-sel"));
    const inView = mp.getBounds().pad(-0.15).contains(c);
    if (inView && Math.abs(mp.getZoom() - target) < 0.6) { showAllOnZoom(); return; }
    mp.once("moveend", showAllOnZoom);
    if (target !== mp.getZoom()) mp.flyTo(c, target, { duration: 0.5 }); else mp.panTo(c, { duration: 0.4 });
  };

  const catLayer = useRef(null);
  useEffect(() => {
    const mp = map.current; if (!mp) return;
    if (!mp.getPane("catPane")) { mp.createPane("catPane"); mp.getPane("catPane").style.zIndex = 640; }
    if (!catLayer.current) catLayer.current = L.layerGroup().addTo(mp);
    catLayer.current.clearLayers();
    mp.getContainer().classList.toggle("kind-mode", !!kind);
    if (!kind) return;
    const pts = [];
    catList.forEach((it) => {
      const ll = catPos(it); pts.push(ll);
      const el = document.createElement("a"); el.className = "tpop"; el.href = it.to;
      el.innerHTML = `<img src="${photoFor(it.id)}" alt=""/><span><b>${it.name}</b><small>${[it.area, it.city].filter((v, i, a) => v && a.indexOf(v) === i).join(", ")}</small><small>${it.line}</small><strong>${it.price}</strong></span>`;
      el.onclick = (e) => { e.preventDefault(); nav(it.to); };
      const mk = L.marker(ll, { pane: "catPane", icon: L.divIcon({ className: "", iconSize: [34, 42], iconAnchor: [17, 40], html: `<div class="cat-pin ${kind}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${KINDS[kind].icon}</svg></div>` }) })
        .bindPopup(el, { closeButton: false, className: "tpop-wrap", offset: [0, -32], autoPan: false });
      mk.on("mouseover", () => mk.openPopup());
      mk.addTo(catLayer.current); it._mk = mk;
    });
    if (pts.length) mp.flyToBounds(L.latLngBounds(pts).pad(0.3), { maxZoom: 11, duration: 0.6 });
  }, [kind, params.get("keyword"), catalog]);  
  const pickKind = (k) => { const q = new URLSearchParams(params); q.delete("advertisement_purpose"); q.delete("page"); k ? q.set("kind", k) : q.delete("kind"); setParams(q); };
  const pickPurpose = (v) => { const q = new URLSearchParams(params); q.delete("kind"); q.delete("page"); v ? q.set("advertisement_purpose", v) : q.delete("advertisement_purpose"); setParams(q); };

  return (
    <div className="map-layout">
      <div className="map-list">
        <div className="stack" style={{ gap: 10 }}>
          <div style={{ position: "relative" }}><Search size={16} className="muted" style={{ position: "absolute", left: 14, top: 16 }} /><input className="input" style={{ paddingLeft: 40 }} placeholder="Locality or city" defaultValue={keyword} key={keyword} onKeyDown={(e) => e.key === "Enter" && set("keyword", e.currentTarget.value.trim())} /></div>
          <div className="map-chips">{[["", "All"], ["sale", "Buy"], ["rent", "Rent"]].map(([v, l]) => <button key={l} className={`chip ${!kind && purpose === v ? "active" : ""}`} onClick={() => pickPurpose(v)}>{l}</button>)}<span className="map-chips-sep" />{Object.entries(KINDS).map(([k, x]) => <button key={k} className={`chip ${kind === k ? "active" : ""}`} onClick={() => pickKind(k)}>{x.label}</button>)}</div>
          <span className="small muted tnum">{kind ? `${catList.length} ${KINDS[kind].label.toLowerCase()}` : `${data?.total ?? "…"} properties`}{!kind && !done && progress.total ? ` · loading ${progress.loaded}/${progress.total}` : ""}</span>
        </div>
        {kind ? catList.map((it) => (
          <Link to={it.to} key={it.id} className="map-item">
            <img src={photoFor(it.id)} alt="" loading="lazy" />
            <div className="stack" style={{ gap: 2, minWidth: 0 }}>
              <span className="tiny muted" style={{ textTransform: "uppercase", letterSpacing: ".1em" }}>{it.tag}</span>
              <b style={{ fontWeight: 500, color: "var(--text-strong)", lineHeight: 1.35 }}>{it.name}</b>
              <span className="tiny row" style={{ gap: 4, color: "var(--text)" }}><MapPin size={12} />{[it.area, it.city].filter((v, i, a) => v && a.indexOf(v) === i).join(", ")}</span>
              <span className="tiny muted">{it.line}</span>
              <span className="row between" style={{ gap: 8 }}>
                <span style={{ fontWeight: 600, color: "var(--text-strong)" }} className="tnum">{it.price}</span>
                <button type="button" className="map-show" title="Show on map" aria-label="Show on map" onClick={(e) => { e.preventDefault(); e.stopPropagation(); const mk = catList.find((x) => x.id === it.id)?._mk; if (mk && map.current) { map.current.flyTo(mk.getLatLng(), 13, { duration: 0.6 }); setTimeout(() => mk.openPopup(), 650); } }}><MapIcon size={15} strokeWidth={1.8} /></button>
              </span>
            </div>
          </Link>
        )) : loading ? Array.from({ length: 5 }, (_, i) => <div key={i} className="sk" style={{ height: 100 }} />) : items.map((p) => {
          const s2 = specs(p); const a = areaOf(p);
          return (
            <Link to={linkOf(p)} key={p.id} className={"map-item" + (sel === p.id ? " on" : "")}>
              <img src={images(p)[0] || "/demo/1.jpg"} alt="" loading="lazy" />
              <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                <span className="tiny muted" style={{ textTransform: "uppercase", letterSpacing: ".1em" }}>For {purposeOf(p)}</span>
                <b style={{ fontWeight: 500, color: "var(--text-strong)", lineHeight: 1.35 }}>{titleOf(p)}</b>
                <span className="tiny row" style={{ gap: 4, color: "var(--text)" }}><MapPin size={12} />{[a.locality, a.district, a.province && `${a.province} Province`].filter(Boolean).join(", ")}</span>
                <span className="tiny muted">{s2.beds ? `${s2.beds} bed` : ""}{s2.beds && s2.area ? " · " : ""}{s2.area || ""}</span>
                <span className="row between" style={{ gap: 8 }}>
                  <span style={{ fontWeight: 600, color: "var(--text-strong)" }} className="tnum">{fmtPrice(purposeKey(p) === "rent" ? (p.rent_per_month || p.total_price) : p.total_price)}</span>
                  <button type="button" className="map-show" title="Show on map" aria-label="Show on map" onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (sel === p.id) unfocus(); else { setSel(p.id); focus(p); } }}><MapIcon size={15} strokeWidth={1.8} /></button>
                </span>
              </div>
            </Link>
          );
        })}
        {!kind && <Pagination page={page} last={data?.last} onChange={(n) => { const q = new URLSearchParams(params); q.set("page", n); setParams(q); }} />}
      </div>
      <div className="map-canvas"><div ref={mapEl} className="map-canvas-el" style={{ position: "absolute", inset: 0 }} />
        <div className="map-legend map-key">
          {kind ? Object.entries(KINDS).map(([k, x]) => <span key={k} className={kind === k ? "" : "muted"}><i className={`cat-dot ${k}`} />{x.label}</span>) : <>
          {Object.values(CATS).map((c) => <span key={c.label}><i style={{ background: c.color }} />{c.label}</span>)}
          <span className="map-key-sep" />
          {Object.entries(PURPOSES).map(([k, p]) => <span key={p.label}><b style={{ color: p.color, borderColor: p.color }}>{p.letter}</b>{p.label}</span>)}</>}
          {!kind && <span className="muted">· Locations are approximate</span>}
        </div>
        {view.z >= HIDE_Z && <div className="map-deep-note">Exact addresses are shared by the agency · zoom out to see properties</div>}
      </div>
    </div>
  );
}
