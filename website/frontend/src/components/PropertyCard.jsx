// Listing cards and grids used across the site, with loading placeholders.
// Boosted listings (p.sponsored is the place: home, search or city) show "Sponsored" and tell the API when they were
// shown and opened, so the business sees how its boost does (Business → Promote).

import { useEffect, useState } from "react";
import { api } from "../api/endpoints";
import { Link } from "react-router-dom";
import { Heart, MapPin, BedDouble, Bath, Ruler, ChevronLeft, ChevronRight } from "lucide-react";
import { useApp } from "../context/AppContext";
import { fmtPrice, images, isSold, linkOf, purposeOf, specs, titleOf, timeAgo } from "../utils/format";

// Cards shown at the same moment are sent together, once a second.
const seenQueue = new Map();
let seenTimer = null;
function markSeen(place, id) {
  const k = `${place}:${id}`;
  if (seenQueue.has(k)) return;
  seenQueue.set(k, { place, id: Number(id) });
  if (seenTimer) return;
  seenTimer = setTimeout(() => {
    const by = {};
    for (const x of seenQueue.values()) (by[x.place] = by[x.place] || []).push(x.id);
    seenQueue.clear(); seenTimer = null;
    for (const [place, ids] of Object.entries(by)) api.promoSeen({ place, ids: ids.slice(0, 50) }).catch(() => {});
  }, 1000);
}

export function PropertyCard({ p, layout = "grid" }) {
  const { favs, toggleFav } = useApp();
  const imgs = images(p);
  const [i, setI] = useState(0);
  const [broken, setBroken] = useState(false);
  const purpose = purposeOf(p);
  const s = specs(p);
  const sold = isSold(p);
  const fav = favs.has(Number(p.id));
  const isRent = purpose === "Rent";
  const price = isRent ? (p.rent_per_month || p.total_price || p.price) : (p.total_price || p.price);
  useEffect(() => { if (p.sponsored) markSeen(p.sponsored, p.id); }, [p.id, p.sponsored]);
  const opened = () => { if (p.sponsored) api.promoClick({ place: p.sponsored, id: Number(p.id) }).catch(() => {}); };

  return (
    <article className={`pcard fade-in ${layout === "list" ? "list" : ""}`} 
      onMouseMove={(e) => {
        if (imgs.length < 2) return;
        const r = e.currentTarget.querySelector(".pcard-media").getBoundingClientRect();
        if (e.clientY > r.bottom) return;
        setI(Math.min(imgs.length - 1, Math.floor(((e.clientX - r.left) / r.width) * Math.min(imgs.length, 5))));
      }}
      onMouseLeave={() => setI(0)}>
      <div className="pcard-media">
        {imgs.length > 0 && !broken
          ? <img src={imgs[i]} alt={titleOf(p)} loading="lazy" onError={() => setBroken(true)}
              // Cover photo: the small 400 px copy on normal screens, the full one on sharp (retina) screens.
              {...(i === 0 && p.thumbnail ? { srcSet: `${p.thumbnail} 400w, ${imgs[0]} 940w`, sizes: "(max-width: 600px) 100vw, 400px" } : {})} />
          : <div className="sk" style={{ width: "100%", height: "100%", animation: "none" }} />}
        {sold && <div className="pcard-sold"><span>{isRent ? "RENTED" : "SOLD"}</span></div>}
        <div className="pcard-top">
          <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}><span className={purpose === "Sale" ? "tag tag-white" : "tag tag-red"}>{p.price_per === "night" ? "Stay" : `For ${purpose}`}</span>{p.sponsored && <span className="tag tag-white" title="A business paid to show this listing first">Sponsored</span>}</span>
          <button className={`heart ${fav ? "on" : ""}`} aria-label={fav ? "Remove from saved" : "Save"}
            onClick={(e) => { e.stopPropagation(); toggleFav(p.id); }}><Heart size={17} /></button>
        </div>
        {p.property_code && <span className="tag tag-white pcard-code tnum">#{p.property_code}</span>}
        {imgs.length > 1 && <>
          <button type="button" className="pcard-nav l" aria-label="Previous photo" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setI((x) => (x - 1 + Math.min(imgs.length, 5)) % Math.min(imgs.length, 5)); }}><ChevronLeft size={18} /></button>
          <button type="button" className="pcard-nav r" aria-label="Next photo" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setI((x) => (x + 1) % Math.min(imgs.length, 5)); }}><ChevronRight size={18} /></button>
        </>}
        {imgs.length > 1 && <div className="pcard-dots">{imgs.slice(0, 5).map((_, k) => <i key={k} className={k === i ? "on" : ""} />)}</div>}
      </div>
      <div className="pcard-body">
        <Link to={linkOf(p)} className="pcard-title pcard-link" onClick={opened}>{titleOf(p)}</Link>
        {p.property_location && <span className="pcard-loc"><MapPin size={13} />{p.property_location}</span>}
        <div className="pcard-specs">
          {s.beds > 0 && <span><BedDouble size={14} />{s.beds} bed</span>}
          {s.baths > 0 && <span><Bath size={14} />{s.baths} bath</span>}
          {s.area && <span><Ruler size={14} />{s.area}</span>}
          {!s.beds && p.property_type && <span>{p.property_type}</span>}
        </div>
        <div className="row between" style={{ alignItems: "baseline", marginTop: 4 }}>
          <span className="pcard-price tnum">{fmtPrice(price)}{isRent && <small>{p.price_per === "night" ? " / night" : " / month"}</small>}</span>
          {p.created_at && <span className="tiny muted">{timeAgo(p.created_at)}</span>}
        </div>
      </div>
    </article>
  );
}

export const CardSkeleton = () => (
  <div className="pcard">
    <div className="pcard-media sk" />
    <div className="pcard-body" style={{ gap: 8 }}>
      <div className="sk" style={{ height: 14, width: "80%" }} />
      <div className="sk" style={{ height: 12, width: "55%" }} />
      <div className="sk" style={{ height: 20, width: "40%", marginTop: 6 }} />
    </div>
  </div>
);

export const PropertyGrid = ({ items, loading, count = 8, layout = "grid" }) => (
  <div className={layout === "list" ? "stack" : "grid-cards"} style={layout === "list" ? { gap: 24 } : undefined}>
    {loading ? Array.from({ length: count }, (_, i) => <CardSkeleton key={i} />) : items.map((p) => <PropertyCard key={p.id} p={p} layout={layout} />)}
  </div>
);
